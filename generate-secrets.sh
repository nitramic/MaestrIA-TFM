#!/usr/bin/env bash
# Genera secrets.env (fuera de git) con todos los secretos/credenciales que
# usa el proyecto. Pensado para correr UNA VEZ por entorno (local, VM de
# staging, VM remota) y despues copiar secrets.env a mano a donde haga
# falta -- por eso este script solo IMPRIME/GUARDA valores, nunca los
# aplica solo al stack.
#
# IMPORTANTE -- esto es una fotografia de "que secretos existen", no un
# cableado automatico:
#   - GF_SECURITY_ADMIN_PASSWORD ya esta conectado (docker-compose.yml lee
#     monitoring/.env). Si generas uno nuevo ahi, alcanza con reiniciar
#     grafana.
#   - JWT_SECRET, INTERNAL_ADMIN_TOKEN y DIRECTORY_DB_PASSWORD estan
#     hardcodeados directo en stack/webapp/docker-stack.yml y scale-out.sh
#     (no leen env todavia). Regenerarlos ACA no cambia nada por si solo:
#     hay que llevarlos a mano a esos archivos, y si el stack ya esta
#     desplegado, coordinar el cambio (rotar JWT_SECRET desloguea a todos;
#     cambiar DIRECTORY_DB_PASSWORD rompe la conexion si el Postgres
#     'pg-directory' ya fue creado con el valor viejo).
#   - Los passwords de superadmin/demo estan hasheados (bcrypt) en
#     stack/webapp/sql/directory_schema.sql y seed_demo.sql. Regenerarlos
#     ACA da un password en texto plano + su hash bcrypt para reemplazar
#     a mano en el SQL; solo tiene efecto en un deploy nuevo (re-sembrar
#     una base ya existente requiere un UPDATE manual).
#   - SLACK_WEBHOOK_URL no se puede generar: hay que pegarlo a mano
#     (Slack -> Incoming Webhooks de tu workspace).
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

# --- Grafana (ya cableado: docker-compose.yml lee monitoring/.env) ---
# Si copias esto a monitoring/.env junto con SLACK_WEBHOOK_URL, alcanza
# con "docker compose restart grafana".
GF_SECURITY_ADMIN_USER=admin
GF_SECURITY_ADMIN_PASSWORD=${GF_SECURITY_ADMIN_PASSWORD}

# --- App fireguard (NO cableado todavia -- hoy hardcodeado en ---
# --- stack/webapp/docker-stack.yml y scale-out.sh; ver comentario ---
# --- arriba antes de rotar esto en un entorno ya desplegado) ---
JWT_SECRET=${JWT_SECRET}
INTERNAL_ADMIN_TOKEN=${INTERNAL_ADMIN_TOKEN}
DIRECTORY_DB_PASSWORD=${DIRECTORY_DB_PASSWORD}

# --- Login superadmin (panel /admin) -- reemplazar a mano en ---
# --- stack/webapp/sql/directory_schema.sql (email + hash), y usar ---
# --- SUPERADMIN_PASSWORD para loguearse. Solo aplica en un deploy nuevo. ---
SUPERADMIN_EMAIL=superadmin@fireguard.local
SUPERADMIN_PASSWORD=${SUPERADMIN_PASSWORD}
SUPERADMIN_PASSWORD_HASH=${SUPERADMIN_PASSWORD_HASH}

# --- Login empresa demo (admin@demo) -- reemplazar a mano en ---
# --- stack/webapp/sql/seed_demo.sql. Solo aplica en un deploy nuevo. ---
DEMO_ADMIN_PASSWORD=${DEMO_ADMIN_PASSWORD}
DEMO_ADMIN_PASSWORD_HASH=${DEMO_ADMIN_PASSWORD_HASH}

# --- Alertas (no se puede generar -- pegar a mano) ---
# Slack -> workspace -> Incoming Webhooks -> crear/copiar URL.
SLACK_WEBHOOK_URL=
EOF

chmod 600 "$OUT_FILE"

cat <<EOF

Listo: ${OUT_FILE} generado (permisos 600, excluido de git).

Resumen de que hacer con cada valor:
  - GF_SECURITY_ADMIN_USER / GF_SECURITY_ADMIN_PASSWORD:
      copialos a monitoring/.env junto con SLACK_WEBHOOK_URL, y
      "docker compose restart grafana".
  - JWT_SECRET / INTERNAL_ADMIN_TOKEN / DIRECTORY_DB_PASSWORD:
      hoy estan hardcodeados en stack/webapp/docker-stack.yml y
      scale-out.sh. Pedime si queres que los cablee a variables de
      entorno (requiere coordinar el redeploy si el stack ya esta
      corriendo).
  - SUPERADMIN_PASSWORD_HASH / DEMO_ADMIN_PASSWORD_HASH:
      van en directory_schema.sql / seed_demo.sql en vez de los hashes
      actuales, ANTES del primer deploy (./deploy-webapp.sh /
      ./deploy-demo.sh). En una base ya sembrada, hace falta un UPDATE
      manual sobre la tabla users.
  - SLACK_WEBHOOK_URL: completalo a mano.
EOF
