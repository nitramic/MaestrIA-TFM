#!/usr/bin/env bash
# Bootstraps a 3-node Docker Swarm on top of the docker-compose DinD services
# (1 manager + 2 workers). Run after `docker compose up -d`.
set -euo pipefail

COMPOSE="docker compose"

wait_healthy() {
  local service="$1"
  echo "Waiting for ${service} to be healthy..."
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "${service}" 2>/dev/null)" = "healthy" ]; do
    sleep 2
  done
}

wait_healthy swarm-manager
wait_healthy swarm-worker1
wait_healthy swarm-worker2

echo "Initializing swarm on swarm-manager..."
$COMPOSE exec -T swarm-manager docker swarm init --advertise-addr eth0 >/dev/null

WORKER_TOKEN=$($COMPOSE exec -T swarm-manager docker swarm join-token -q worker)
MANAGER_IP=$($COMPOSE exec -T swarm-manager sh -c "hostname -i")

echo "Joining swarm-worker1..."
$COMPOSE exec -T swarm-worker1 docker swarm join --token "${WORKER_TOKEN}" "${MANAGER_IP}:2377" >/dev/null

echo "Joining swarm-worker2..."
$COMPOSE exec -T swarm-worker2 docker swarm join --token "${WORKER_TOKEN}" "${MANAGER_IP}:2377" >/dev/null

echo
echo "Swarm ready. Node list:"
$COMPOSE exec -T swarm-manager docker node ls
