#!/usr/bin/env bash
# Onboards a new company for the FireGuard webapp:
#   1. deploys its own postgres db (via deploy-postgres.sh)
#   2. attaches it to the fireguard-net overlay network
#   3. creates the users/extinguishers schema
#   4. registers it in the "directory" database (pg-directory)
#   5. creates an admin user (email admin@<slug>) with a bcrypt-hashed password
#
# Uso: ./add-company.sh <slug> [nombre_visible] [admin_password]
#
# <slug> es lo que va después de la '@' en el email de login, ej.
# admin@<slug> (o admin@<slug>.com, se toma solo hasta el primer punto).
set -euo pipefail

COMPOSE="docker compose"
NETWORK="fireguard-net"

if [ $# -lt 1 ]; then
  echo "Uso: $0 <slug> [nombre_visible] [admin_password]" >&2
  exit 1
fi

SLUG="$1"
DISPLAY_NAME="${2:-$SLUG}"
ADMIN_PASSWORD="${3:-$(openssl rand -base64 12)}"
ADMIN_EMAIL="admin@${SLUG}"

if ! [[ "${SLUG}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Slug inválido: '${SLUG}' (usa minúsculas, dígitos, '-' o '_')" >&2
  exit 1
fi

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

echo "==> Desplegando base de datos para '${SLUG}'..."
DEPLOY_OUT=$(./deploy-postgres.sh "${SLUG}")
echo "${DEPLOY_OUT}"
DB_PASSWORD=$(echo "${DEPLOY_OUT}" | grep '^  Password:' | awk '{print $2}')
DB_USER=$(echo "${DEPLOY_OUT}" | grep '^  Usuario:' | awk '{print $2}')

if [ -z "${DB_PASSWORD}" ] || [ -z "${DB_USER}" ]; then
  echo "No se pudo leer usuario/password de deploy-postgres.sh" >&2
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

echo "==> Generando hash bcrypt de la contraseña de administrador..."
HASH=$(docker run --rm node:20-alpine sh -c \
  "mkdir -p /tmp/w && cd /tmp/w && npm install bcryptjs >/dev/null 2>&1 && node -e \"console.log(require('bcryptjs').hashSync(process.argv[1],10))\" '${ADMIN_PASSWORD}'")

echo "==> Creando usuario administrador ${ADMIN_EMAIL}..."
$COMPOSE exec -T swarm-manager sh -c "docker exec -i ${CID} psql -U ${DB_USER} -d ${SLUG} -v ON_ERROR_STOP=1" <<SQL
INSERT INTO users (email, password_hash, full_name, role)
VALUES ('${ADMIN_EMAIL}', '${HASH}', 'Admin ${DISPLAY_NAME}', 'admin')
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
SQL

echo "==> Esperando a pg-directory..."
DIR_CID=$(wait_for_container "pg-directory")
if [ -z "${DIR_CID}" ]; then
  echo "pg-directory no respondió a tiempo." >&2
  exit 1
fi

echo "==> Registrando '${SLUG}' en el directorio..."
$COMPOSE exec -T swarm-manager sh -c "docker exec -i ${DIR_CID} psql -U postgres -d directory -v ON_ERROR_STOP=1" <<SQL
INSERT INTO companies (slug, display_name, db_host, db_port, db_name, db_user, db_password)
VALUES ('${SLUG}', '${DISPLAY_NAME}', 'pg-${SLUG}', 5432, '${SLUG}', '${DB_USER}', '${DB_PASSWORD}')
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  db_host = EXCLUDED.db_host,
  db_port = EXCLUDED.db_port,
  db_name = EXCLUDED.db_name,
  db_user = EXCLUDED.db_user,
  db_password = EXCLUDED.db_password;
SQL

cat <<EOF

Empresa '${SLUG}' lista.
  Login:    ${ADMIN_EMAIL}
  Password: ${ADMIN_PASSWORD}

No hay extintores cargados todavía para esta empresa (tabla vacía).
EOF
