#!/usr/bin/env bash
# Frena todo el stack (docker compose stop -- conserva los volumenes: bases
# de datos, imagenes del registry, todo) y apaga la maquina por completo
# (power off). No pide confirmacion: pensado para correr desatendido.
#
# NO hace falta agregarlo a cron: start-demo.sh lo programa solo, 3h50m
# despues de cada arranque (via systemd-run). Este script tambien se puede
# correr a mano en cualquier momento si hace falta frenar antes de esas 3h50m:
#   ./stop-demo.sh
#
# IMPORTANTE: confirma en el proveedor cloud que la instancia este
# configurada para "stop" (no "terminate"/"delete") cuando el SO se apaga
# desde adentro -- si no, se pierde el disco entero, no solo se apaga.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

cd "${REPO_DIR}"

log "==> Deteniendo stack en ${REPO_DIR}..."
docker compose stop || log "AVISO: docker compose stop devolvio error, continuo igual."
docker compose --profile tunnel stop cloudflared 2>/dev/null || true

log "==> Stack detenido. Apagando la maquina (power off)..."
sync

if [ "$(id -u)" -eq 0 ]; then
  poweroff
else
  sudo poweroff
fi
