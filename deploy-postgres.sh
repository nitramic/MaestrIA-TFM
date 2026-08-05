#!/usr/bin/env bash
# Despliega una nueva instancia de PostgreSQL como servicio individual en el
# swarm. Cada base recibe su propio servicio (pg-<nombre_db>) y su propio
# puerto publicado, empezando en 5001 (5002, 5003, ...) en lugar del 5432
# por defecto.
#
# Uso: ./deploy-postgres.sh <nombre_db> [password] [usuario]
set -euo pipefail

COMPOSE="docker compose"
BASE_PORT=5001
MAX_PORT=5020

if [ $# -lt 1 ]; then
  echo "Uso: $0 <nombre_db> [password] [usuario]" >&2
  exit 1
fi

DB_NAME="$1"
DB_PASSWORD="${2:-$(openssl rand -hex 12)}"
DB_USER="${3:-postgres}"
SERVICE_NAME="pg-${DB_NAME}"

if ! [[ "${DB_NAME}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "Nombre de base inválido: '${DB_NAME}' (usa minúsculas, dígitos, '-' o '_')" >&2
  exit 1
fi

if $COMPOSE exec -T swarm-manager docker service inspect "${SERVICE_NAME}" >/dev/null 2>&1; then
  echo "Ya existe un servicio '${SERVICE_NAME}'." >&2
  exit 1
fi

echo "Buscando el siguiente puerto libre a partir de ${BASE_PORT}..."
USED_PORTS=$($COMPOSE exec -T swarm-manager sh -c \
  "docker service ls --filter name=pg- --format '{{.Name}}' | xargs -r -I{} docker service inspect {} --format '{{range .Endpoint.Ports}}{{.PublishedPort}} {{end}}'" \
  | tr -s ' \n' '\n' | grep -E '^[0-9]+$' || true)

PORT=$BASE_PORT
while echo "${USED_PORTS}" | grep -qx "${PORT}"; do
  PORT=$((PORT + 1))
done

if [ "${PORT}" -gt "${MAX_PORT}" ]; then
  echo "No quedan puertos libres en el rango ${BASE_PORT}-${MAX_PORT}." >&2
  exit 1
fi

echo "Desplegando '${SERVICE_NAME}' en el puerto ${PORT} (usuario=${DB_USER}, db=${DB_NAME})..."

$COMPOSE exec -T swarm-manager docker service create \
  --name "${SERVICE_NAME}" \
  --constraint "node.hostname==swarm-manager" \
  --mount "type=volume,source=${SERVICE_NAME}-data,destination=/var/lib/postgresql/data" \
  --env POSTGRES_DB="${DB_NAME}" \
  --env POSTGRES_USER="${DB_USER}" \
  --env POSTGRES_PASSWORD="${DB_PASSWORD}" \
  --publish "published=${PORT},target=5432" \
  postgres:16 >/dev/null

echo
echo "Servicio '${SERVICE_NAME}' desplegado."
echo "  Host:     localhost"
echo "  Puerto:   ${PORT}"
echo "  DB:       ${DB_NAME}"
echo "  Usuario:  ${DB_USER}"
echo "  Password: ${DB_PASSWORD}"
echo
echo "Conexión: psql -h localhost -p ${PORT} -U ${DB_USER} -d ${DB_NAME}"
echo "Eliminar: docker compose exec swarm-manager docker service rm ${SERVICE_NAME}"
