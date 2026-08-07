// Exportador Prometheus de CPU/memoria/red/disco por contenedor, leyendo
// directamente la API de stats de Docker (equivalente a `docker stats`).
//
// Se usa en la capa host en lugar de cAdvisor porque este host expone su
// almacenamiento via el snapshotter de containerd (Driver "overlayfs" +
// driver-type "io.containerd.snapshotter.v1"), un layout que cAdvisor no
// sabe resolver para calcular el read-write layer de contenedores Docker
// clasicos, y termina sin poder registrar ninguno. La API de stats de
// Docker no depende de ese detalle interno, asi que funciona igual sin
// importar el storage driver.
const express = require('express');
const client = require('prom-client');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15000);

const cpuPercent = new client.Gauge({ name: 'docker_container_cpu_percent', help: 'CPU usage (%, puede superar 100 con varios cores)', labelNames: ['name'] });
const memUsage = new client.Gauge({ name: 'docker_container_memory_usage_bytes', help: 'Memoria en uso', labelNames: ['name'] });
const memLimit = new client.Gauge({ name: 'docker_container_memory_limit_bytes', help: 'Limite de memoria', labelNames: ['name'] });
const netRx = new client.Gauge({ name: 'docker_container_network_receive_bytes_total', help: 'Bytes de red recibidos (acumulado)', labelNames: ['name'] });
const netTx = new client.Gauge({ name: 'docker_container_network_transmit_bytes_total', help: 'Bytes de red enviados (acumulado)', labelNames: ['name'] });
const blkRead = new client.Gauge({ name: 'docker_container_blkio_read_bytes_total', help: 'Bytes leidos de disco (acumulado)', labelNames: ['name'] });
const blkWrite = new client.Gauge({ name: 'docker_container_blkio_write_bytes_total', help: 'Bytes escritos a disco (acumulado)', labelNames: ['name'] });
const scrapeErrors = new client.Counter({ name: 'docker_stats_exporter_scrape_errors_total', help: 'Errores al pedir stats de un contenedor' });

client.collectDefaultMetrics();

function cpuPercentFrom(stats) {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const sysDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpus = stats.cpu_stats.online_cpus || (stats.cpu_stats.cpu_usage.percpu_usage || []).length || 1;
  if (sysDelta > 0 && cpuDelta > 0) return (cpuDelta / sysDelta) * cpus * 100;
  return 0;
}

async function collectOne(containerInfo) {
  const name = containerInfo.Names[0].replace(/^\//, '');
  const stats = await docker.getContainer(containerInfo.Id).stats({ stream: false });

  cpuPercent.set({ name }, cpuPercentFrom(stats));
  memUsage.set({ name }, stats.memory_stats.usage || 0);
  memLimit.set({ name }, stats.memory_stats.limit || 0);

  let rx = 0, tx = 0;
  for (const iface of Object.values(stats.networks || {})) {
    rx += iface.rx_bytes || 0;
    tx += iface.tx_bytes || 0;
  }
  netRx.set({ name }, rx);
  netTx.set({ name }, tx);

  let read = 0, write = 0;
  for (const entry of (stats.blkio_stats && stats.blkio_stats.io_service_bytes_recursive) || []) {
    if (entry.op === 'Read') read += entry.value;
    if (entry.op === 'Write') write += entry.value;
  }
  blkRead.set({ name }, read);
  blkWrite.set({ name }, write);
}

async function collectAll() {
  const containers = await docker.listContainers();
  await Promise.all(containers.map((c) => collectOne(c).catch((err) => {
    scrapeErrors.inc();
    console.error(`stats error (${c.Names[0]}):`, err.message);
  })));
}

setInterval(() => { collectAll().catch((err) => console.error('collectAll error:', err.message)); }, POLL_INTERVAL_MS);
collectAll().catch((err) => console.error('collectAll error:', err.message));

const app = express();
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 9200;
app.listen(PORT, () => console.log(`docker-stats-exporter listening on ${PORT}`));
