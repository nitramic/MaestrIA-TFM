#!/usr/bin/env bash
# Genera secrets.env (fuera de git) con todos los secretos/credenciales que
# usa el proyecto. Correr UNA VEZ por entorno (local, VM de staging, VM
# remota), ANTES de desplegar infra y app -- deploy-webapp.sh, deploy-demo.sh
# y scale-out.sh lo leen automaticamente (y fallan con un mensaje claro si
# no existe). secrets.env tambien se puede copiar a mano a otro entorno.
#
# Que hace cada valor, y quien lo consume:
#   - GF_SECURITY_ADMIN_USER/PASSWORD: copialos a monitoring/.env junto con
#     SLACK_WEBHOOK_URL (docker-compose.yml ya lee ese archivo).
#   - JWT_SECRET / INTERNAL_ADMIN_TOKEN / DIRECTORY_DB_PASSWORD: los leen
#     deploy-webapp.sh y scale-out.sh (interpolados en
#     stack/webapp/docker-stack.yml al correr `docker stack deploy`).
#   - SUPERADMIN_PASSWORD_HASH / DEMO_ADMIN_PASSWORD_HASH: deploy-webapp.sh /
#     deploy-demo.sh los sustituyen en directory_schema.sql / seed_demo.sql
#     antes de aplicarlos.
#   - SLACK_WEBHOOK_URL no se puede generar: hay que pegarlo a mano
#     (Slack -> Incoming Webhooks de tu workspace).
#
# IMPORTANTE sobre --force en un entorno YA desplegado: regenerar
# JWT_SECRET desloguea a todos los usuarios; regenerar DIRECTORY_DB_PASSWORD
# rompe la conexion si el Postgres 'pg-directory' ya fue creado con el
# valor viejo (no hay rotacion automatica del password ya aplicado a un
# Postgres corriendo); regenerar los hashes de superadmin/demo no tiene
# efecto en una base ya sembrada (hace falta un UPDATE manual). Para un
# primer deploy (el caso normal) no hay ningun problema.
#
# Uso:
#   ./generate-secrets.sh              # genera secrets.env (si no existe)
#   ./generate-secrets.sh --force      # regenera TODO, pisando el anterior
set -euo pipefail

OUT_FILE="secrets.env"
FORCE="${1:-}"

if [ -f "$OUT_FILE" ] && [ "$FORCE" != "--force" ]; then
  echo "ERROR: ${OUT_FILE} ya existe. Usa --force si realmente queres" >&2
  echo "       regenerar TODO (esto rota JWT_SECRET/INTERNAL_ADMIN_TOKEN/" >&2
  echo "       DIRECTORY_DB_PASSWORD -- ver los comentarios del script" >&2
  echo "       sobre el impacto de rotarlos en un entorno ya desplegado)." >&2
  exit 1
fi

command -v openssl >/dev/null 2>&1 || { echo "ERROR: falta openssl." >&2; exit 1; }

rand_hex() { openssl rand -hex "$1"; }
rand_pass() { openssl rand -base64 "$1" | tr -d '=+/\n' | cut -c1-"$2"; }

# bcrypt del password de superadmin/demo, con la misma libreria (bcryptjs,
# costo 10) que usa el server en runtime. Tres caminos, en orden:
#   1. node local + node_modules/bcryptjs ya instalado en stack/webapp
#   2. node local + bcryptjs instalado al vuelo (npm disponible)
#   3. sin node local: un contenedor node:20-alpine efimero (requiere
#      docker y salida a internet para bajar el paquete una vez)
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

echo "==> Generando secretos..."

JWT_SECRET=$(rand_hex 32)
INTERNAL_ADMIN_TOKEN=$(rand_hex 24)
DIRECTORY_DB_PASSWORD=$(rand_pass 24 20)
GF_SECURITY_ADMIN_PASSWORD=$(rand_pass 16 14)
SUPERADMIN_PASSWORD=$(rand_pass 16 14)
DEMO_ADMIN_PASSWORD=$(rand_pass 16 14)

SUPERADMIN_PASSWORD_HASH=$(bcrypt_hash "$SUPERADMIN_PASSWORD")
DEMO_ADMIN_PASSWORD_HASH=$(bcrypt_hash "$DEMO_ADMIN_PASSWORD")

if [ -z "$SUPERADMIN_PASSWORD_HASH" ] || [ -z "$DEMO_ADMIN_PASSWORD_HASH" ]; then
  echo "    AVISO: no se pudo calcular el hash bcrypt (sin node ni docker disponibles)." >&2
  SUPERADMIN_PASSWORD_HASH="${SUPERADMIN_PASSWORD_HASH:-(no calculado -- instala node+bcryptjs o docker y volve a correr el script)}"
  DEMO_ADMIN_PASSWORD_HASH="${DEMO_ADMIN_PASSWORD_HASH:-(no calculado -- instala node+bcryptjs o docker y volve a correr el script)}"
fi

cat > "$OUT_FILE" <<EOF
# Generado por generate-secrets.sh el $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# NO commitear este archivo (ya esta en .gitignore).

# --- Grafana (docker-compose.yml lee monitoring/.env, no este archivo ---
# --- directamente -- copia estas dos lineas ahi junto con SLACK_WEBHOOK_URL) ---
GF_SECURITY_ADMIN_USER='admin'
GF_SECURITY_ADMIN_PASSWORD='${GF_SECURITY_ADMIN_PASSWORD}'

# --- App fireguard: leidos por deploy-webapp.sh / scale-out.sh ---
JWT_SECRET='${JWT_SECRET}'
INTERNAL_ADMIN_TOKEN='${INTERNAL_ADMIN_TOKEN}'
DIRECTORY_DB_PASSWORD='${DIRECTORY_DB_PASSWORD}'

# --- Login superadmin (panel /admin) -- aplicado por deploy-webapp.sh ---
SUPERADMIN_EMAIL='superadmin@fireguard.local'
SUPERADMIN_PASSWORD='${SUPERADMIN_PASSWORD}'
SUPERADMIN_PASSWORD_HASH='${SUPERADMIN_PASSWORD_HASH}'

# --- Login empresa demo (admin@demo) -- aplicado por deploy-demo.sh ---
DEMO_ADMIN_PASSWORD='${DEMO_ADMIN_PASSWORD}'
DEMO_ADMIN_PASSWORD_HASH='${DEMO_ADMIN_PASSWORD_HASH}'

# --- Alertas (no se puede generar -- pegar a mano). Este archivo se hace
# --- "source" como script bash, asi que envolve el valor en comillas
# --- simples si lo completas a mano (para que un $ en la URL no se
# --- interprete como variable).
# Slack -> workspace -> Incoming Webhooks -> crear/copiar URL.
SLACK_WEBHOOK_URL=''

# --- Email de bienvenida (opcional -- si SMTP_HOST queda vacio, el alta de
# --- empresa funciona igual pero no se envia el mail). Completar a mano con
# --- las credenciales SMTP del proveedor que uses.
APP_BASE_URL='http://localhost:8081'
SMTP_HOST=''
SMTP_PORT='587'
SMTP_USER=''
SMTP_PASSWORD=''
SMTP_FROM='FireGuard <no-reply@fireguard.local>'
EOF

chmod 600 "$OUT_FILE"

cat <<EOF

Listo: ${OUT_FILE} generado (permisos 600, excluido de git).

  - GF_SECURITY_ADMIN_USER / GF_SECURITY_ADMIN_PASSWORD: copialos a
    monitoring/.env junto con SLACK_WEBHOOK_URL (completalo a mano), y
    "docker compose restart grafana".
  - JWT_SECRET / INTERNAL_ADMIN_TOKEN / DIRECTORY_DB_PASSWORD /
    SUPERADMIN_PASSWORD_HASH / DEMO_ADMIN_PASSWORD_HASH: se aplican solos
    al correr ./deploy-webapp.sh, ./deploy-demo.sh y ./scale-out.sh.

Orden sugerido:
  ./generate-secrets.sh
  docker compose up -d && ./init-swarm.sh
  ./deploy-webapp.sh
  ./deploy-demo.sh   # opcional
EOF
