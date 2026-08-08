#!/usr/bin/env bash
# Da de baja la empresa "demo" (creada por ./deploy-demo.sh) y deja todo
# limpio para poder relanzarla desde cero con ./deploy-demo.sh en cualquier
# momento: elimina el servicio pg-demo, su volumen de datos (pg-demo-data,
# para que el proximo deploy-demo.sh no reutilice datos viejos) y la fila
# 'demo' en la tabla companies de pg-directory.
#
# No toca pg-directory, app1/app2/admin-worker ni ninguna otra empresa --
# solo la infraestructura propia de la demo.
#
# Uso: ./teardown-demo.sh
set -euo pipefail

COMPOSE="docker compose"
SLUG="demo"
SERVICE_NAME="pg-${SLUG}"
VOLUME_NAME="${SERVICE_NAME}-data"

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

echo "==> Eliminando servicio '${SERVICE_NAME}'..."
if exec_manager docker service inspect "${SERVICE_NAME}" >/dev/null 2>&1; then
  exec_manager docker service rm "${SERVICE_NAME}" >/dev/null
else
  echo "    no existe, nada que hacer."
fi

echo "==> Esperando a que el servicio termine de desaparecer..."
tries=30
while [ "${tries}" -gt 0 ] && exec_manager docker service inspect "${SERVICE_NAME}" >/dev/null 2>&1; do
  tries=$((tries - 1))
  sleep 2
done

echo "==> Eliminando volumen '${VOLUME_NAME}'..."
# El daemon puede tardar un instante en soltar el volumen tras remover el
# servicio (409 "volume is in use" transitorio) -- reintenta unos segundos.
deadline=$(( $(date +%s) + 20 ))
until exec_manager docker volume rm "${VOLUME_NAME}" >/dev/null 2>&1; do
  if ! exec_manager docker volume inspect "${VOLUME_NAME}" >/dev/null 2>&1; then
    echo "    no existe, nada que hacer."
    break
  fi
  if [ "$(date +%s)" -ge "${deadline}" ]; then
    echo "    AVISO: no se pudo eliminar el volumen (sigue en uso). Volvé a correr este script." >&2
    break
  fi
  sleep 2
done

echo "==> Quitando '${SLUG}' del directorio (pg-directory)..."
DIR_CID=$(exec_manager sh -c "docker ps -q -f name=pg-directory -f status=running" | tr -d '\r')
if [ -n "${DIR_CID}" ]; then
  exec_manager sh -c "docker exec -i ${DIR_CID} psql -U postgres -d directory -v ON_ERROR_STOP=1" <<SQL
DELETE FROM companies WHERE slug = '${SLUG}';
SQL
else
  echo "    AVISO: pg-directory no está corriendo, no se pudo limpiar la fila del directorio." >&2
  echo "           Corré este script de nuevo (o borrala a mano) antes de relanzar la demo." >&2
fi

cat <<EOF

Listo: la empresa '${SLUG}' fue dada de baja (servicio, volumen y registro
en el directorio eliminados). Para relanzarla desde cero:
  ./deploy-demo.sh
EOF
