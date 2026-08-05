#!/usr/bin/env bash
# Builds and deploys the FireGuard webapp (PWA) into the existing swarm.
#
# Sets up (idempotently):
#  - an overlay network "fireguard-net" shared by the webapp and the
#    per-company postgres services
#  - a "pg-directory" postgres service (db "directory") holding the
#    company slug -> db connection mapping used at login time
#  - applies sql/directory_schema.sql
#  - builds+pushes the webapp image (2 replicas: app1 on swarm-worker1,
#    app2 on swarm-worker2) and the Apache load-balancer image in front of
#    them, and deploys the "fireguard" stack (published on
#    http://localhost:8081)
#
# Run after ./init-swarm.sh. Companies (and their per-company postgres
# service) are onboarded afterwards via the /admin panel or add-company.sh.
set -euo pipefail

COMPOSE="docker compose"
NETWORK="fireguard-net"

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

echo "==> Ensuring overlay network '${NETWORK}' exists..."
if ! exec_manager docker network inspect "${NETWORK}" >/dev/null 2>&1; then
  exec_manager docker network create -d overlay "${NETWORK}" >/dev/null
  echo "    created."
else
  echo "    already exists."
fi

echo "==> Ensuring 'pg-directory' service exists..."
if ! exec_manager docker service inspect pg-directory >/dev/null 2>&1; then
  exec_manager docker service create \
    --name pg-directory \
    --network "${NETWORK}" \
    --constraint "node.hostname==swarm-manager" \
    --mount "type=volume,source=pg-directory-data,destination=/var/lib/postgresql/data" \
    --env POSTGRES_DB=directory \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_PASSWORD=postgres \
    postgres:16 >/dev/null
  echo "    created."
else
  echo "    already exists."
fi

wait_for_container() {
  local name_filter="$1" tries=30
  local cid=""
  while [ "${tries}" -gt 0 ]; do
    cid=$(exec_manager sh -c "docker ps -q -f name=${name_filter} -f status=running" | tr -d '\r')
    if [ -n "${cid}" ] && exec_manager sh -c "docker exec ${cid} pg_isready -U postgres" >/dev/null 2>&1; then
      echo "${cid}"
      return 0
    fi
    tries=$((tries - 1))
    sleep 2
  done
  echo "" # not found
}

run_sql() {
  local name_filter="$1" db="$2" file="$3"
  echo "==> Applying $(basename "${file}") to ${name_filter} (db=${db})..."
  local cid
  cid=$(wait_for_container "${name_filter}")
  if [ -z "${cid}" ]; then
    echo "    ERROR: ${name_filter} container not ready, skipping ${file}." >&2
    return 1
  fi
  $COMPOSE exec -T swarm-manager sh -c "docker exec -i ${cid} psql -U postgres -d ${db} -v ON_ERROR_STOP=1" < "${file}"
}

run_sql "pg-directory" "directory" "stack/webapp/sql/directory_schema.sql"

echo "==> Building registry:5000/fireguard-webapp image..."
exec_manager docker build -t registry:5000/fireguard-webapp:latest /stack/webapp
exec_manager docker push registry:5000/fireguard-webapp:latest

echo "==> Building registry:5000/fireguard-lb image..."
exec_manager docker build -t registry:5000/fireguard-lb:latest /stack/webapp/lb
exec_manager docker push registry:5000/fireguard-lb:latest

echo "==> Deploying 'fireguard' stack (app1 + app2 + lb + admin-worker)..."
exec_manager docker stack deploy -c /stack/webapp/docker-stack.yml fireguard

echo
echo "Servicios del stack:"
exec_manager docker stack services fireguard

cat <<'EOF'

Listo. La webapp deberia quedar disponible balanceada entre 2 nodos en:
  http://localhost:8081

Estado del balanceador: http://localhost:8081/balancer-manager

Panel de administracion (alta/baja/suspension de empresas):
  http://localhost:8081/admin
  Usuario:  superadmin@fireguard.local
  Password: SuperAdmin1234!

Sin empresas dadas de alta todavia. Usa el panel de administracion o
./add-company.sh para dar de alta la primera.
EOF
