#!/usr/bin/env bash
# Escala hacia afuera la webapp FireGuard: agrega un nuevo nodo "appN" al
# stack (hasta un maximo de MAX_APPS) y actualiza el balanceador para que
# reparta trafico entre todos los nodos activos.
#
# Regla de negocio: minimo MIN_APPS / maximo MAX_APPS nodos de app activos
# (ver tambien scale-in.sh). app1..app4 se reparten entre los 2 workers
# fisicos existentes (swarm-worker1/2, sin constraint fijo salvo app1/app2);
# a partir del nodo #5 (WORKER3_FROM) ya no alcanza esa capacidad "comoda",
# asi que se levanta bajo demanda un 3er worker (swarm-worker3, ver
# add-swarm-worker.sh) y ahi se alojan app5 y app6 en exclusiva.
#
# Requiere que ./deploy-webapp.sh ya se haya ejecutado (app1/app2 + lb
# desplegados) y que la imagen registry:5000/fireguard-webapp:latest exista.
set -euo pipefail

COMPOSE="docker compose"
STACK="fireguard"
NETWORK="fireguard-net"
MIN_APPS=2
MAX_APPS=6
WORKER3_FROM=5
EXTRA_WORKER="swarm-worker3"

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

mapfile -t nums < <(exec_manager docker service ls --filter "label=com.docker.stack.namespace=${STACK}" --format '{{.Name}}' \
  | grep -E "^${STACK}_app[0-9]+$" | sed -E "s/^${STACK}_app//" | sort -n)
count=${#nums[@]}

if [ "${count}" -eq 0 ]; then
  echo "ERROR: no se encontraron servicios app1/app2 del stack '${STACK}'." >&2
  echo "       Ejecuta ./deploy-webapp.sh primero." >&2
  exit 1
fi

if [ "${count}" -ge "${MAX_APPS}" ]; then
  echo "Ya hay ${count} nodo(s) de app activos (maximo ${MAX_APPS}). Nada que escalar."
  exit 0
fi

max_num=${nums[-1]}
new_num=$((max_num + 1))
new_name="app${new_num}"

placement_args=()
if [ "${new_num}" -ge "${WORKER3_FROM}" ]; then
  echo "==> Nodo #${new_num} requiere el 3er worker dedicado (${EXTRA_WORKER})..."
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/add-swarm-worker.sh"
  placement_args=(--constraint "node.hostname==${EXTRA_WORKER}")
fi

echo "==> Creando servicio ${STACK}_${new_name} (nodo $((count + 1)) de ${MAX_APPS}, minimo ${MIN_APPS})..."
exec_manager docker service create \
  --name "${STACK}_${new_name}" \
  --label "com.docker.stack.namespace=${STACK}" \
  --network "name=${NETWORK},alias=${new_name}" \
  --env DIRECTORY_DB_HOST=pg-directory \
  --env DIRECTORY_DB_PORT=5432 \
  --env DIRECTORY_DB_NAME=directory \
  --env DIRECTORY_DB_USER=postgres \
  --env DIRECTORY_DB_PASSWORD=postgres \
  --env JWT_SECRET=62b960ad53e105c1ea31bce0b7ac0b44e1d0b7fe6d988c1f3a66848cf9d28c0c \
  --env INTERNAL_ADMIN_TOKEN=01ce3c0c69e0c106c298a176383b52274a2dc51652b22c88 \
  --restart-condition any \
  "${placement_args[@]}" \
  registry:5000/fireguard-webapp:latest >/dev/null

echo "==> Regenerando configuracion del balanceador..."
"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/stack/webapp/lb/generate-lb-conf.sh" "${STACK}"

echo
echo "Listo. Nodos de app activos: $((count + 1))/${MAX_APPS}"
exec_manager docker stack services "${STACK}"
