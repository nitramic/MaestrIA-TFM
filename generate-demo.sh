#!/usr/bin/env bash
# Genera secrets.env (fuera de git) con credenciales FIJAS de demo/practica
# (no aleatorias), para entornos de trabajo practico donde se necesita saber
# el usuario/password de antemano. NO usar en produccion -- para eso esta
# generate-secrets.sh, que genera valores aleatorios por entorno.
#
# Deja los mismos nombres de variable que generate-secrets.sh, consumidos
# por deploy-webapp.sh / deploy-demo.sh / scale-out.sh de la misma forma:
#   - GF_SECURITY_ADMIN_USER/PASSWORD: copialos a monitoring/.env.
#   - SUPERADMIN_EMAIL/PASSWORD(_HASH): login panel /admin (deploy-webapp.sh).
#   - DEMO_ADMIN_PASSWORD(_HASH): login empresa demo admin@demo (deploy-demo.sh).
#
# Uso:
#   ./generate-demo.sh              # genera secrets.env (si no existe)
#   ./generate-demo.sh --force      # regenera TODO, pisando el anterior
set -euo pipefail

OUT_FILE="secrets.env"
FORCE="${1:-}"

if [ -f "$OUT_FILE" ] && [ "$FORCE" != "--force" ]; then
  echo "ERROR: ${OUT_FILE} ya existe. Usa --force si realmente queres" >&2
  echo "       regenerarlo con las credenciales de demo." >&2
  exit 1
fi

DEMO_PASSWORD='DemoAdmin1234!'

# bcrypt del password, con la misma libreria (bcryptjs, costo 10) que usa el
# server en runtime. Tres caminos, en orden: node local + bcryptjs ya
# instalado / node local + bcryptjs al vuelo / contenedor node:20-alpine.
bcrypt_hash() {
  local password="$1" webapp_dir
  webapp_dir="$(cd "$(dirname "$0")/stack/webapp" && pwd)"

  if command -v node >/dev/null 2>&1 && [ -d "${webapp_dir}/node_modules/bcryptjs" ]; then
    (cd "$webapp_dir" && node -e "
      const bcrypt = require('bcryptjs');
      process.stdout.write(bcrypt.hashSync(process.argv[1], 10));
    " "$password")
    return
  fi

  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    node -e "
      const bcrypt = require((() => { try { return require.resolve('bcryptjs'); } catch { return 'bcryptjs'; } })());
      process.stdout.write(bcrypt.hashSync(process.argv[1], 10));
    " "$password" 2>/dev/null && return
  fi

  if command -v docker >/dev/null 2>&1; then
    docker run --rm -e PW="$password" node:20-alpine sh -c \
      "mkdir -p /tmp/bcrypt && cd /tmp/bcrypt && npm install --silent bcryptjs >/dev/null 2>&1 && node -e \"const b=require('bcryptjs'); process.stdout.write(b.hashSync(process.env.PW,10));\""
    return
  fi

  echo ""
}

echo "==> Generando secrets.env de DEMO (credenciales fijas, no producir)..."

SUPERADMIN_PASSWORD_HASH=$(bcrypt_hash "$DEMO_PASSWORD")
DEMO_ADMIN_PASSWORD_HASH=$(bcrypt_hash "$DEMO_PASSWORD")

if [ -z "$SUPERADMIN_PASSWORD_HASH" ] || [ -z "$DEMO_ADMIN_PASSWORD_HASH" ]; then
  echo "    AVISO: no se pudo calcular el hash bcrypt (sin node ni docker disponibles)." >&2
  SUPERADMIN_PASSWORD_HASH="${SUPERADMIN_PASSWORD_HASH:-(no calculado -- instala node+bcryptjs o docker y volve a correr el script)}"
  DEMO_ADMIN_PASSWORD_HASH="${DEMO_ADMIN_PASSWORD_HASH:-(no calculado -- instala node+bcryptjs o docker y volve a correr el script)}"
fi

cat > "$OUT_FILE" <<EOF
# Generado por generate-demo.sh el $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Credenciales de DEMO/PRACTICA -- fijas y conocidas, NO usar en produccion.
# NO commitear este archivo (ya esta en .gitignore).

# --- Grafana (copiar a monitoring/.env junto con SLACK_WEBHOOK_URL) ---
GF_SECURITY_ADMIN_USER='admin'
GF_SECURITY_ADMIN_PASSWORD='${DEMO_PASSWORD}'

# --- App fireguard: leidos por deploy-webapp.sh / scale-out.sh ---
JWT_SECRET='demo-jwt-secret-not-for-production'
INTERNAL_ADMIN_TOKEN='demo-internal-admin-token'
DIRECTORY_DB_PASSWORD='DemoAdmin1234!'

# --- Login superadmin (panel /admin) -- aplicado por deploy-webapp.sh ---
SUPERADMIN_EMAIL='superadmin@fireguard.local'
SUPERADMIN_PASSWORD='${DEMO_PASSWORD}'
SUPERADMIN_PASSWORD_HASH='${SUPERADMIN_PASSWORD_HASH}'

# --- Login empresa demo (admin@demo) -- aplicado por deploy-demo.sh ---
DEMO_ADMIN_PASSWORD='${DEMO_PASSWORD}'
DEMO_ADMIN_PASSWORD_HASH='${DEMO_ADMIN_PASSWORD_HASH}'

# --- Alertas (no se puede generar -- pegar a mano) ---
SLACK_WEBHOOK_URL=''

# --- Email de bienvenida y notificaciones, via API HTTPS de Brevo, no SMTP
# --- (opcional -- vacio = no se envia el mail) ---
APP_BASE_URL='http://localhost:8081'
BREVO_API_KEY=''
SMTP_FROM='FireGuard <no-reply@fireguard.local>'

# --- Tunel de Cloudflare (opcional -- pegar a mano, ver deploy-tunnel.sh) ---
CLOUDFLARE_TUNNEL_TOKEN=''
EOF

chmod 600 "$OUT_FILE"

cat <<EOF

Listo: ${OUT_FILE} generado (permisos 600, excluido de git).

Credenciales de demo (usuario / password):
  - Grafana:            admin / ${DEMO_PASSWORD}
  - Consola admin:       superadmin@fireguard.local / ${DEMO_PASSWORD}
  - Empresa demo:        admin@demo / ${DEMO_PASSWORD}

Orden sugerido:
  ./generate-demo.sh
  docker compose up -d && ./init-swarm.sh
  ./deploy-webapp.sh
  ./deploy-demo.sh   # opcional
EOF
