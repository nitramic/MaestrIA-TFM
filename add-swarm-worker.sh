#!/usr/bin/env bash
# Levanta swarm-worker3 (definido en docker-compose.yml pero no arrancado
# por defecto) y lo une al swarm, si todavia no esta unido.
#
# Usado por scale-out.sh cuando se necesita el nodo de app #5 o #6: los
# workers dedicados swarm-worker1/swarm-worker2 ya alojan app1..app4, asi
# que app5/app6 se alojan en este 3er worker (ver docker-compose.yml y
# init-swarm.sh para el resto de la topologia).
set -euo pipefail

COMPOSE="docker compose"
WORKER="swarm-worker3"

echo "==> Levantando ${WORKER} (docker compose up -d)..."
$COMPOSE up -d "${WORKER}"

echo "    Esperando a que ${WORKER} este healthy..."
tries=30
until [ "$(docker inspect -f '{{.State.Health.Status}}' "${WORKER}" 2>/dev/null)" = "healthy" ]; do
  tries=$((tries - 1))
  if [ "${tries}" -le 0 ]; then
    echo "ERROR: ${WORKER} no llego a healthy a tiempo." >&2
    exit 1
  fi
  sleep 2
done

# Si ya esta unido al swarm (ej. se corrio este script antes y luego se
# escalo hacia adentro sin tirar el nodo), no repetir el join.
if $COMPOSE exec -T "${WORKER}" docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "^active$"; then
  echo "    ${WORKER} ya esta unido al swarm."
  exit 0
fi

echo "==> Uniendo ${WORKER} al swarm..."
WORKER_TOKEN=$($COMPOSE exec -T swarm-manager docker swarm join-token -q worker)
MANAGER_IP=$($COMPOSE exec -T swarm-manager sh -c "hostname -i")
$COMPOSE exec -T "${WORKER}" docker swarm join --token "${WORKER_TOKEN}" "${MANAGER_IP}:2377" >/dev/null

echo "    ${WORKER} unido al swarm."
