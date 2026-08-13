#!/usr/bin/env bash
# Despliega la capa de monitoreo de infraestructura:
#
#  - Capa host (docker-compose.yml): docker-stats-exporter + node-exporter +
#    Prometheus + Grafana, viendo los 4 contenedores DinD del host real
#    (swarm-manager, swarm-worker1, swarm-worker2, registry).
#  - Capa swarm (stack "monitoring"): node-exporter + cAdvisor en modo
#    global (uno por nodo) + Prometheus con auto-descubrimiento via la API
#    de Swarm, viendo los servicios que corren dentro del swarm (app1, app2,
#    admin-worker, lb, pg-directory, pg-<empresa>...).
#
# Requiere el swarm ya inicializado (./init-swarm.sh) y la red overlay
# "fireguard-net" ya creada (./deploy-webapp.sh).
set -euo pipefail

COMPOSE="docker compose"
SECRETS_FILE="secrets.env"

# secrets.env es opcional aca (a diferencia de deploy-webapp.sh/deploy-demo.sh):
# GF_SECURITY_ADMIN_USER/PASSWORD tienen un default sensato en
# docker-compose.yml (${..:-admin} / ${..:-DemoAdmin1234!}) si el archivo
# no existe o no los define.
if [ -f "${SECRETS_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  source "${SECRETS_FILE}"
  set +a
fi

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

# Redundante con el chmod que ya hace install-docker.sh (que corre antes
# del primer "docker compose up -d", el que realmente crea el contenedor
# de Grafana por primera vez). Se repite aca por las dudas -- si este
# script se corre en una maquina que ya tenia Docker instalado y por eso
# se salteo install-docker.sh, o si alguien restauro los permisos por
# error -- pero ya no deberia hacer falta en el flujo normal. El grupo
# primario de la imagen es 0/root (no 472), por eso "g+w" y no "o+w"
# (ver comentario en install-docker.sh).
echo "==> Verificando permisos de monitoring/grafana/provisioning/alerting (uid 472 del contenedor Grafana)..."
chmod -R go+w monitoring/grafana/provisioning/alerting

echo "==> Levantando monitoreo de capa host (docker-stats-exporter, node-exporter, Prometheus, Grafana)..."
$COMPOSE up -d docker-stats-exporter node-exporter prometheus-host grafana

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

cat <<EOF

Listo.

  Grafana (host + swarm, dos datasources ya provisionados):
    http://localhost:3001
    Usuario:  ${GF_SECURITY_ADMIN_USER:-admin}
    Password: ${GF_SECURITY_ADMIN_PASSWORD:-DemoAdmin1234!}

  Prometheus capa host (contenedores del host real):
    docker compose exec prometheus-host wget -qO- http://localhost:9090
    (o vía Grafana, datasource "Prometheus-Host")

  Prometheus capa swarm (nodos y servicios internos del swarm):
    http://localhost:9091   (publicado via routing mesh en swarm-manager)
    (o vía Grafana, datasource "Prometheus-Swarm")
EOF
