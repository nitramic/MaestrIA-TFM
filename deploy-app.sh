#!/usr/bin/env bash
# Construye las imágenes de la app (php-apache) y del balanceador (apache-lb)
# dentro del nodo manager, las sube al registry local y despliega el stack
# en el swarm ya inicializado (ejecutar después de ./init-swarm.sh).
set -euo pipefail

COMPOSE="docker compose"

echo "Construyendo imagen registry:5000/php-apache..."
$COMPOSE exec -T swarm-manager docker build -t registry:5000/php-apache:latest /stack/app

echo "Construyendo imagen registry:5000/apache-lb..."
$COMPOSE exec -T swarm-manager docker build -t registry:5000/apache-lb:latest /stack/lb

echo "Publicando imágenes en el registry local..."
$COMPOSE exec -T swarm-manager docker push registry:5000/php-apache:latest
$COMPOSE exec -T swarm-manager docker push registry:5000/apache-lb:latest

echo "Desplegando el stack en el swarm..."
$COMPOSE exec -T swarm-manager docker stack deploy -c /stack/docker-stack.yml phpstack

echo
echo "Servicios del stack:"
$COMPOSE exec -T swarm-manager docker stack services phpstack

cat <<'EOF'

Prueba el balanceo (deberías ver alternar "web1"/"web2" en el hostname):
  curl http://localhost:8081/
  curl http://localhost:8081/
EOF
