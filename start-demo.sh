#!/usr/bin/env bash
# Levanta todo el stack tras un arranque de la VM (misma data, mismos
# contenedores -- no recrea nada) y programa el apagado automatico 4 horas
# despues via un timer transitorio de systemd. Idempotente: si ya esta
# todo arriba, no rompe nada.
#
# Pensado para @reboot en cron. El apagado (stop-demo.sh) NO va en cron:
# lo programa este script cada vez que corre, siempre +4h desde ESE
# arranque puntual (el encendido puede pasar en cualquier momento via la
# API del proveedor cloud, asi que un horario fijo de cron para el stop
# no serviria).
#
# Instalar en cron (recomendado: crontab de root, para no depender de
# sudo sin password en un contexto sin terminal):
#   sudo crontab -e
#   @reboot /ruta/al/repo/start-demo.sh >> /var/log/fireguard-start.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOP_SCRIPT="${REPO_DIR}/stop-demo.sh"
AUTOSTOP_HOURS="4h"

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

log "==> Programando apagado automatico en ${AUTOSTOP_HOURS}..."
UNIT="fireguard-autostop-$(date +%s)"
if [ ! -x "${STOP_SCRIPT}" ]; then
  log "ERROR: no encuentro ${STOP_SCRIPT} o no es ejecutable."
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  systemd-run --on-active="${AUTOSTOP_HOURS}" --unit="${UNIT}" "${STOP_SCRIPT}"
else
  sudo systemd-run --on-active="${AUTOSTOP_HOURS}" --unit="${UNIT}" "${STOP_SCRIPT}"
fi

log "Listo. La VM se apagara sola en ${AUTOSTOP_HOURS} (unidad systemd: ${UNIT})."
log "Para cancelar ese apagado puntual: sudo systemctl stop ${UNIT}"
