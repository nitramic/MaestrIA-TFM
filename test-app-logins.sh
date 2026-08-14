#!/usr/bin/env bash
# Genera trafico de logins VALIDOS (admin@demo / inspector@demo) contra el
# balanceador, para que el dashboard "FireGuard - App" de Grafana tenga
# datos reales para mostrar: "Logins exitosos", "Requests por segundo (por
# servicio)", "Requests por endpoint" y "Latencia p95" -- hasta que corre
# esto, esos paneles quedan vacios porque nadie usa la app de verdad.
#
# Complementa a test-scale-balancer.sh (que prueba reparto de carga con
# requests anonimos a "/") con trafico autenticado real: cada ciclo hace
# login, un par de requests autenticados (/api/auth/me, /api/sites) y
# logout, para no acumular sesiones y pisar el limite de licencias de la
# empresa demo (5, ver company_schema.sql).
#
# Requiere que el stack este desplegado (./deploy-webapp.sh) y la empresa
# demo cargada (./deploy-demo.sh) -- usa DEMO_ADMIN_PASSWORD de secrets.env
# (misma password para admin@demo/inspector@demo/locked@demo, ver
# deploy-demo.sh).
#
# Uso: ./test-app-logins.sh [iteraciones] [pausa_segundos]
set -euo pipefail

LB_URL="http://localhost:8081"
SECRETS_FILE="secrets.env"
ITERATIONS="${1:-20}"
DELAY="${2:-1}"
USERS=("admin@demo" "inspector@demo")

if [ ! -f "${SECRETS_FILE}" ]; then
  echo "ERROR: falta ${SECRETS_FILE}. Ejecuta ./generate-secrets.sh primero." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "${SECRETS_FILE}"
set +a

if [ -z "${DEMO_ADMIN_PASSWORD:-}" ]; then
  echo "ERROR: DEMO_ADMIN_PASSWORD vacío en ${SECRETS_FILE}. Corre ./deploy-demo.sh primero." >&2
  exit 1
fi

echo "==> Generando ${ITERATIONS} ciclos de login/logout validos contra ${LB_URL}"
echo "    (usuarios: ${USERS[*]}, pausa ${DELAY}s entre ciclos)..."

ok=0
fail=0

for i in $(seq 1 "${ITERATIONS}"); do
  user="${USERS[$(( (i - 1) % ${#USERS[@]} ))]}"
  jar=$(mktemp)

  status=$(curl -s -o /dev/null -w '%{http_code}' -c "${jar}" -X POST "${LB_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${user}\",\"password\":\"${DEMO_ADMIN_PASSWORD}\"}")

  if [ "${status}" = "200" ]; then
    ok=$((ok + 1))
    curl -s -o /dev/null -b "${jar}" "${LB_URL}/api/auth/me" || true
    curl -s -o /dev/null -b "${jar}" "${LB_URL}/api/sites" || true
    curl -s -o /dev/null -b "${jar}" -X POST "${LB_URL}/api/auth/logout" || true
    echo "  [${i}/${ITERATIONS}] ${user}: login OK"
  else
    fail=$((fail + 1))
    echo "  [${i}/${ITERATIONS}] ${user}: login devolvio ${status} (revisa DEMO_ADMIN_PASSWORD en ${SECRETS_FILE})" >&2
  fi

  rm -f "${jar}"
  sleep "${DELAY}"
done

echo
if [ "${fail}" -eq 0 ]; then
  echo "OK: ${ok}/${ITERATIONS} logins validos."
else
  echo "REVISAR: ${ok}/${ITERATIONS} logins validos, ${fail} fallidos inesperados."
fi
echo "Dashboard 'FireGuard - App' en Grafana (http://localhost:3001): los paneles"
echo "'Logins exitosos', 'Requests por segundo' y 'Latencia p95' deberian mostrar actividad"
echo "(puede tardar hasta scrape_interval, 15s, en reflejarse)."
