#!/usr/bin/env bash
# Escala hacia adentro la webapp FireGuard: elimina el nodo "appN" con
# numero mas alto (nunca por debajo de MIN_APPS) y actualiza el
# balanceador para que deje de enviarle trafico.
#
# Regla de negocio: minimo MIN_APPS / maximo MAX_APPS nodos de app activos
# (ver tambien scale-out.sh). app1/app2 son la base fija del stack
# (stack/webapp/docker-stack.yml) y nunca se eliminan por este script.
#
# Nota: si se quita el ultimo nodo alojado en el 3er worker (app5), ese
# worker (swarm-worker3, levantado por add-swarm-worker.sh) se saca del
# swarm y se apaga por completo (remove-swarm-worker.sh) en vez de dejarlo
# idle. scale-out.sh lo vuelve a levantar y unir automaticamente la
# proxima vez que se necesite un 5to/6to nodo.
set -euo pipefail

COMPOSE="docker compose"
STACK="fireguard"
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
  exit 1
fi

if [ "${count}" -le "${MIN_APPS}" ]; then
  echo "Ya hay el minimo de ${MIN_APPS} nodo(s) de app activos. Nada que reducir."
  exit 0
fi

max_num=${nums[-1]}
target="app${max_num}"

new_count=$((count - 1))

echo "==> Eliminando servicio ${STACK}_${target} (quedaran ${new_count}/${MAX_APPS} nodos, minimo ${MIN_APPS})..."
exec_manager docker service rm "${STACK}_${target}" >/dev/null

echo "==> Regenerando configuracion del balanceador..."
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${DIR}/stack/webapp/lb/generate-lb-conf.sh" "${STACK}"

if [ "${max_num}" -ge "${WORKER3_FROM}" ] && [ "${new_count}" -lt "${WORKER3_FROM}" ]; then
  echo "==> ${target} era el ultimo nodo alojado en ${EXTRA_WORKER}, sacandolo del swarm y apagandolo..."
  "${DIR}/remove-swarm-worker.sh"
fi

echo
echo "Listo. Nodos de app activos: ${new_count}/${MAX_APPS}"
exec_manager docker stack services "${STACK}"
