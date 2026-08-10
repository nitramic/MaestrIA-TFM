#!/usr/bin/env bash
# Frena todo el stack (docker compose stop -- conserva los volumenes: bases
# de datos, imagenes del registry, todo) y apaga la maquina por completo
# (power off). No pide confirmacion: pensado para correr desatendido.
#
# No se programa solo desde ningun otro script del repo: correlo a mano
# cuando haga falta frenar la VM, o invocalo desde donde sea que se
# gestione el apagado automatico (por ejemplo, un script/notebook externo
# que administra el ciclo de vida de la VM vía la API del proveedor cloud):
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
