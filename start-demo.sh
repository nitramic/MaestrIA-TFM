#!/usr/bin/env bash
# Levanta todo el stack tras un arranque de la VM (misma data, mismos
# contenedores -- no recrea nada). Idempotente: si ya esta todo arriba,
# no rompe nada.
#
# El apagado automatico de la VM (si aplica) es responsabilidad de quien
# la aprovisiona (por ejemplo, un script/notebook externo que crea la VM
# con un tiempo de vida fijo vía la API del proveedor cloud) -- este
# script ya NO programa ningun apagado propio. stop-demo.sh sigue
# disponible para frenar el stack y apagar la maquina a mano.
#
# Util para @reboot en cron si la VM se reinicia y queres que el stack
# vuelva a estar arriba solo:
#   sudo crontab -e
#   @reboot /ruta/al/repo/start-demo.sh >> /var/log/fireguard-start.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "==> Esperando a que Docker este listo..."
tries=60
until docker info >/dev/null 2>&1; do
  tries=$((tries - 1))
  if [ "${tries}" -le 0 ]; then
    log "ERROR: Docker no respondio a tiempo (2 minutos)."
    exit 1
  fi
  sleep 2
done

cd "${REPO_DIR}"

log "==> Levantando stack (docker compose start)..."
docker compose start

log "==> Levantando tunel de Cloudflare (profile 'tunnel')..."
docker compose --profile tunnel start cloudflared

echo
log "Servicios:"
docker compose ps

log "Listo. El apagado de la VM (si corresponde) lo maneja quien la aprovisiono."
