const Docker = require('dockerode');
const { Client } = require('pg');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const NETWORK_NAME = process.env.FIREGUARD_NETWORK || 'fireguard-net';

const docker = new Docker({ socketPath: DOCKER_SOCKET });

async function getNetworkId(name) {
  const networks = await docker.listNetworks({ filters: JSON.stringify({ name: [name] }) });
  const net = networks.find((n) => n.Name === name);
  if (!net) throw new Error(`Red '${name}' no encontrada`);
  return net.Id;
}

async function createCompanyPostgres(slug, password) {
  const networkId = await getNetworkId(NETWORK_NAME);
  await docker.createService({
    Name: `pg-${slug}`,
    TaskTemplate: {
      ContainerSpec: {
        Image: 'postgres:16',
        Env: [`POSTGRES_DB=${slug}`, 'POSTGRES_USER=postgres', `POSTGRES_PASSWORD=${password}`],
        Mounts: [{ Type: 'volume', Source: `pg-${slug}-data`, Target: '/var/lib/postgresql/data' }],
      },
      Placement: { Constraints: ['node.hostname==swarm-manager'] },
      Networks: [{ Target: networkId }],
      RestartPolicy: { Condition: 'any' },
    },
    Mode: { Replicated: { Replicas: 1 } },
  });
}

async function waitForPgReady(host, port, user, password, database, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    const client = new Client({ host, port, user, password, database, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return true;
    } catch (err) {
      lastErr = err;
      try { await client.end(); } catch (e) { /* ignore */ }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`Timed out waiting for ${host}:${port} (${lastErr && lastErr.message})`);
}

async function waitForServiceGone(serviceName, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  const ACTIVE_STATES = ['new', 'allocated', 'pending', 'assigned', 'accepted', 'preparing', 'ready', 'starting', 'running'];
  while (Date.now() < deadline) {
    let tasks = [];
    try {
      tasks = await docker.listTasks({ filters: JSON.stringify({ service: [serviceName] }) });
    } catch (err) {
      return; // service/tasks gone already
    }
    const active = tasks.filter((t) => ACTIVE_STATES.includes(t.Status && t.Status.State));
    if (active.length === 0) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function removeCompanyPostgres(slug) {
  const serviceName = `pg-${slug}`;

  try {
    await docker.getService(serviceName).remove();
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  await waitForServiceGone(serviceName);

  // Even after the task shows as no longer active, the node's docker daemon
  // can take a moment longer to actually detach the volume, so a 409
  // ("volume is in use") right after removal is expected transient noise.
  const volumeName = `${serviceName}-data`;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      await docker.getVolume(volumeName).remove();
      break;
    } catch (err) {
      if (err.statusCode === 404) break;
      if (err.statusCode === 409 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw err;
    }
  }
}

module.exports = { docker, createCompanyPostgres, waitForPgReady, removeCompanyPostgres, getNetworkId };
