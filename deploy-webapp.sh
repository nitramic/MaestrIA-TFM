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
# service) are onboarded afterwards via the /admin panel.
set -euo pipefail

COMPOSE="docker compose"
NETWORK="fireguard-net"
SECRETS_FILE="secrets.env"

if [ ! -f "${SECRETS_FILE}" ]; then
  echo "ERROR: falta ${SECRETS_FILE}. Ejecuta ./generate-secrets.sh primero." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "${SECRETS_FILE}"
set +a
for var in JWT_SECRET INTERNAL_ADMIN_TOKEN DIRECTORY_DB_PASSWORD SUPERADMIN_PASSWORD_HASH; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: ${var} vacío en ${SECRETS_FILE}. Corre ./generate-secrets.sh --force." >&2
    exit 1
  fi
done

TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

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
    --env POSTGRES_PASSWORD="${DIRECTORY_DB_PASSWORD}" \
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

sed -e "s|__SUPERADMIN_PASSWORD_HASH__|${SUPERADMIN_PASSWORD_HASH}|" \
  stack/webapp/sql/directory_schema.sql > "${TMP_DIR}/directory_schema.sql"
run_sql "pg-directory" "directory" "${TMP_DIR}/directory_schema.sql"

echo "==> Building registry:5000/fireguard-webapp image..."
exec_manager docker build -t registry:5000/fireguard-webapp:latest /stack/webapp
exec_manager docker push registry:5000/fireguard-webapp:latest

echo "==> Building registry:5000/fireguard-lb image..."
exec_manager docker build -t registry:5000/fireguard-lb:latest /stack/webapp/lb
exec_manager docker push registry:5000/fireguard-lb:latest

echo "==> Deploying 'fireguard' stack (app1 + app2 + lb + admin-worker)..."
# docker-stack.yml interpola ${JWT_SECRET}/${INTERNAL_ADMIN_TOKEN}/
# ${DIRECTORY_DB_PASSWORD} con el entorno del proceso que corre DENTRO de
# swarm-manager, asi que hay que reenviarlas explicitamente con -e (un
# "docker compose exec" no hereda las variables del shell del host).
$COMPOSE exec -T \
  -e JWT_SECRET="${JWT_SECRET}" \
  -e INTERNAL_ADMIN_TOKEN="${INTERNAL_ADMIN_TOKEN}" \
  -e DIRECTORY_DB_PASSWORD="${DIRECTORY_DB_PASSWORD}" \
  -e APP_BASE_URL="${APP_BASE_URL:-http://localhost:8081}" \
  -e SMTP_HOST="${SMTP_HOST:-}" \
  -e SMTP_PORT="${SMTP_PORT:-587}" \
  -e SMTP_USER="${SMTP_USER:-}" \
  -e SMTP_PASSWORD="${SMTP_PASSWORD:-}" \
  -e SMTP_FROM="${SMTP_FROM:-FireGuard <no-reply@fireguard.local>}" \
  -e SLACK_APP_EVENTS_WEBHOOK_URL="${SLACK_APP_EVENTS_WEBHOOK_URL:-}" \
  swarm-manager docker stack deploy -c /stack/webapp/docker-stack.yml fireguard

echo
echo "Servicios del stack:"
exec_manager docker stack services fireguard

cat <<EOF

Listo. La webapp deberia quedar disponible balanceada entre 2 nodos en:
  http://localhost:8081

Estado del balanceador: http://localhost:8081/balancer-manager

Panel de administracion (alta/baja/suspension de empresas):
  http://localhost:8081/admin
  Usuario:  superadmin@fireguard.local
  Password: ${SUPERADMIN_PASSWORD:-(ver SUPERADMIN_PASSWORD en secrets.env)}

Sin empresas dadas de alta todavia. Usa el panel de administracion para
dar de alta la primera.
EOF
