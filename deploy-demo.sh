#!/usr/bin/env bash
# Onboards the "demo" company: a real company (like any added via the
# /admin panel) but pre-loaded with sample sites/extinguishers/users, and
# pinned to always sort last in the admin panel's company list (which is
# ordered by created_at DESC) via a fixed, old created_at.
#
# Not required to start the stack -- run this only if you want the demo
# data available. Run after ./init-swarm.sh and ./deploy-webapp.sh.
#
# Uso: ./deploy-demo.sh
set -euo pipefail

COMPOSE="docker compose"
NETWORK="fireguard-net"
SLUG="demo"
SECRETS_FILE="secrets.env"

if [ ! -f "${SECRETS_FILE}" ]; then
  echo "ERROR: falta ${SECRETS_FILE}. Ejecuta ./generate-secrets.sh primero." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "${SECRETS_FILE}"
set +a
if [ -z "${DEMO_ADMIN_PASSWORD_HASH:-}" ] || [ -z "${DEMO_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: DEMO_ADMIN_PASSWORD/_HASH vacío en ${SECRETS_FILE}. Corre ./generate-secrets.sh --force." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT
DISPLAY_NAME="Empresa Demo"
# Fixed, old timestamp so "demo" always sorts last regardless of when other
# companies are added (companies list is ORDER BY created_at DESC).
DEMO_CREATED_AT="2000-01-01T00:00:00Z"

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

echo "==> Desplegando base de datos para '${SLUG}'..."
DEPLOY_OUT=$(./deploy-postgres.sh "${SLUG}")
echo "${DEPLOY_OUT}"
DB_USER=postgres
DB_PASSWORD=$(echo "${DEPLOY_OUT}" | grep -oP '(?<=Password: ).*')
if [ -z "${DB_PASSWORD}" ]; then
  echo "ERROR: no se pudo leer el password generado por deploy-postgres.sh." >&2
  exit 1
fi

echo "==> Adjuntando '${NETWORK}' a pg-${SLUG}..."
exec_manager docker service update --network-add "${NETWORK}" "pg-${SLUG}" >/dev/null

wait_for_container() {
  local name_filter="$1" tries=30 cid=""
  while [ "${tries}" -gt 0 ]; do
    cid=$(exec_manager sh -c "docker ps -q -f name=${name_filter} -f status=running" | tr -d '\r')
    if [ -n "${cid}" ] && exec_manager sh -c "docker exec ${cid} pg_isready -U postgres" >/dev/null 2>&1; then
      echo "${cid}"
      return 0
    fi
    tries=$((tries - 1))
    sleep 2
  done
  echo ""
}

echo "==> Esperando a pg-${SLUG}..."
CID=$(wait_for_container "pg-${SLUG}")
if [ -z "${CID}" ]; then
  echo "pg-${SLUG} no respondió a tiempo." >&2
  exit 1
fi

echo "==> Creando esquema en '${SLUG}'..."
$COMPOSE exec -T swarm-manager sh -c "docker exec -i ${CID} psql -U ${DB_USER} -d ${SLUG} -v ON_ERROR_STOP=1" \
  < stack/webapp/sql/company_schema.sql

echo "==> Cargando datos de ejemplo..."
sed -e "s|__DEMO_PASSWORD_HASH__|${DEMO_ADMIN_PASSWORD_HASH}|" \
  stack/webapp/sql/seed_demo.sql > "${TMP_DIR}/seed_demo.sql"
$COMPOSE exec -T swarm-manager sh -c "docker exec -i ${CID} psql -U ${DB_USER} -d ${SLUG} -v ON_ERROR_STOP=1" \
  < "${TMP_DIR}/seed_demo.sql"

echo "==> Esperando a pg-directory..."
DIR_CID=$(wait_for_container "pg-directory")
if [ -z "${DIR_CID}" ]; then
  echo "pg-directory no respondió a tiempo." >&2
  exit 1
fi

echo "==> Registrando '${SLUG}' en el directorio (created_at fijo para quedar último en el listado)..."
$COMPOSE exec -T swarm-manager sh -c "docker exec -i ${DIR_CID} psql -U postgres -d directory -v ON_ERROR_STOP=1" <<SQL
INSERT INTO companies (slug, display_name, db_host, db_port, db_name, db_user, db_password, created_at)
VALUES ('${SLUG}', '${DISPLAY_NAME}', 'pg-${SLUG}', 5432, '${SLUG}', '${DB_USER}', '${DB_PASSWORD}', '${DEMO_CREATED_AT}')
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  db_host = EXCLUDED.db_host,
  db_port = EXCLUDED.db_port,
  db_name = EXCLUDED.db_name,
  db_user = EXCLUDED.db_user,
  db_password = EXCLUDED.db_password,
  created_at = EXCLUDED.created_at;
SQL

cat <<EOF

Empresa '${SLUG}' lista (con datos de ejemplo).
  Login admin:      admin@${SLUG} / ${DEMO_ADMIN_PASSWORD}
  Login inspector:  inspector@${SLUG} / ${DEMO_ADMIN_PASSWORD}
  Login bloqueado:  locked@${SLUG} / ${DEMO_ADMIN_PASSWORD} (para probar el desbloqueo desde /admin)
EOF
