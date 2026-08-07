#!/usr/bin/env bash
# Despliega la capa de monitoreo de infraestructura:
#
#  - Capa host (docker-compose.yml): cAdvisor + node-exporter + Prometheus
#    + Grafana, viendo los 4 contenedores DinD del host real (swarm-manager,
#    swarm-worker1, swarm-worker2, registry).
#  - Capa swarm (stack "monitoring"): node-exporter + cAdvisor en modo
#    global (uno por nodo) + Prometheus con auto-descubrimiento via la API
#    de Swarm, viendo los servicios que corren dentro del swarm (app1, app2,
#    admin-worker, lb, pg-directory, pg-<empresa>...).
#
# Requiere el swarm ya inicializado (./init-swarm.sh) y la red overlay
# "fireguard-net" ya creada (./deploy-webapp.sh).
set -euo pipefail

COMPOSE="docker compose"

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

echo "==> Levantando monitoreo de capa host (cAdvisor, node-exporter, Prometheus, Grafana)..."
$COMPOSE up -d cadvisor node-exporter prometheus-host grafana

echo "==> Verificando red overlay 'fireguard-net'..."
if ! exec_manager docker network inspect fireguard-net >/dev/null 2>&1; then
  echo "    ERROR: fireguard-net no existe. Ejecuta ./deploy-webapp.sh primero." >&2
  exit 1
fi

echo "==> Desplegando stack 'monitoring' dentro del swarm (node-exporter + cAdvisor global + Prometheus)..."
exec_manager sh -c "cd /stack/monitoring && docker stack deploy -c docker-stack.yml monitoring"

echo
echo "Servicios del stack 'monitoring':"
exec_manager docker stack services monitoring

cat <<'EOF'

Listo.

  Grafana (host + swarm, dos datasources ya provisionados):
    http://localhost:3001
    Usuario:  admin
    Password: admin  (cambiar en produccion)

  Prometheus capa host (contenedores del host real):
    docker compose exec prometheus-host wget -qO- http://localhost:9090
    (o vía Grafana, datasource "Prometheus-Host")

  Prometheus capa swarm (nodos y servicios internos del swarm):
    http://localhost:9091   (publicado via routing mesh en swarm-manager)
    (o vía Grafana, datasource "Prometheus-Swarm")
EOF
