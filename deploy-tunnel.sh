#!/usr/bin/env bash
# Publica la webapp (localhost:8081) hacia afuera via un tunel saliente de
# Cloudflare (cloudflared), sin abrir ningun puerto entrante en el firewall
# de la VM. Requiere:
#   1. Un tunel creado en Zero Trust -> Networks -> Tunnels (conector
#      "Cloudflared"), con un Public Hostname -> HTTP -> localhost:8081.
#   2. El token de ese tunel pegado en CLOUDFLARE_TUNNEL_TOKEN, en
#      secrets.env (ver generate-secrets.sh).
#
# Corre cloudflared como container Docker en la capa host (docker-compose.yml,
# profile "tunnel"), con --network host para que alcance localhost:8081.
set -euo pipefail

COMPOSE="docker compose"
SECRETS_FILE="secrets.env"

if [ ! -f "${SECRETS_FILE}" ]; then
  echo "ERROR: falta ${SECRETS_FILE}. Ejecuta ./generate-secrets.sh primero." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "${SECRETS_FILE}"
set +a

if [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_TUNNEL_TOKEN vacío en ${SECRETS_FILE}." >&2
  echo "       Crea el tunel en Zero Trust -> Networks -> Tunnels y pega el token." >&2
  exit 1
fi

echo "==> Levantando cloudflared (profile 'tunnel')..."
$COMPOSE --profile tunnel up -d cloudflared

echo
echo "Listo. Estado del conector:"
$COMPOSE logs --tail=20 cloudflared

cat <<'EOF'

Si en los logs ves "Registered tunnel connection", el tunel esta activo.
Verificar desde afuera (puede tardar unos segundos en propagar):

  curl -I https://fireguard.nitramic.com

Logs en vivo:
  docker compose logs -f cloudflared

Bajar el tunel (sin tocar el resto del stack):
  docker compose --profile tunnel down cloudflared
EOF
