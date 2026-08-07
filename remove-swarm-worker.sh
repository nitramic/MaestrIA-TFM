#!/usr/bin/env bash
# Inverso de add-swarm-worker.sh: vacia swarm-worker3, lo saca del swarm y
# apaga el contenedor (no solo lo deja idle).
#
# Usado por scale-in.sh cuando ya no queda ningun nodo de app (app5/app6)
# alojado ahi. add-swarm-worker.sh vuelve a levantarlo y unirlo al swarm
# la proxima vez que scale-out.sh necesite un 5to/6to nodo.
set -euo pipefail

COMPOSE="docker compose"
WORKER="swarm-worker3"

if ! $COMPOSE ps -q "${WORKER}" 2>/dev/null | grep -q .; then
  echo "    ${WORKER} ya esta detenido."
  exit 0
fi

state=$($COMPOSE exec -T "${WORKER}" docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo "inactive")
if [ "${state}" = "active" ]; then
  echo "==> Vaciando ${WORKER} (drain) antes de sacarlo del swarm..."
  $COMPOSE exec -T swarm-manager docker node update --availability drain "${WORKER}" >/dev/null 2>&1 || true
  sleep 2

  echo "==> ${WORKER} abandona el swarm..."
  $COMPOSE exec -T "${WORKER}" docker swarm leave >/dev/null 2>&1 || true

  echo "==> Removiendo ${WORKER} del listado de nodos del manager..."
  tries=15
  until $COMPOSE exec -T swarm-manager docker node rm "${WORKER}" >/dev/null 2>&1; do
    tries=$((tries - 1))
    if [ "${tries}" -le 0 ]; then
      echo "    ADVERTENCIA: no se pudo remover ${WORKER} del listado de nodos (quedo como 'Down')." >&2
      break
    fi
    sleep 2
  done
else
  echo "    ${WORKER} no estaba unido al swarm."
fi

echo "==> Apagando el contenedor ${WORKER}..."
$COMPOSE stop "${WORKER}" >/dev/null

echo "    ${WORKER} apagado y fuera del swarm."
