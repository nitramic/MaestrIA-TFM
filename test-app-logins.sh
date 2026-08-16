#!/usr/bin/env bash
# Genera trafico de logins (admin@demo / inspector@demo) contra el
# balanceador, para que el dashboard "FireGuard - App" de Grafana tenga
# datos reales para mostrar: "Logins exitosos", "Logins fallidos",
# "Requests por segundo (por servicio)", "Requests por endpoint" y
# "Latencia p95" -- hasta que corre esto, esos paneles quedan vacios
# porque nadie usa la app de verdad.
#
# La mayoria de los ciclos son login/logout validos; opcionalmente, los
# ultimos "fallidos" ciclos usan una password incorrecta a proposito
# (mismo usuario, result=invalid_credentials en fireguard_login_attempts_total)
# para que el panel de "Logins fallidos" tambien tenga algo que mostrar.
# Mantenelo bajo (1-2): auth.js bloquea la cuenta a los 5 intentos fallidos
# consecutivos (MAX_ATTEMPTS en routes/auth.js).
#
# Complementa a test-scale-balancer.sh (que prueba reparto de carga con
# requests anonimos a "/") con trafico autenticado real: cada ciclo valido
# hace login, un par de requests autenticados (/api/auth/me, /api/sites) y
# logout, para no acumular sesiones y pisar el limite de licencias de la
# empresa demo (5, ver company_schema.sql).
#
# Requiere que el stack este desplegado (./deploy-webapp.sh) y la empresa
# demo cargada (./deploy-demo.sh) -- usa DEMO_ADMIN_PASSWORD de secrets.env
# (misma password para admin@demo/inspector@demo/locked@demo, ver
# deploy-demo.sh).
#
# Uso: ./test-app-logins.sh [iteraciones] [pausa_segundos] [fallidos]
set -euo pipefail

LB_URL="http://localhost:8081"
SECRETS_FILE="secrets.env"
ITERATIONS="${1:-20}"
DELAY="${2:-1}"
FAILED_COUNT="${3:-0}"
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

if [ "${FAILED_COUNT}" -gt "${ITERATIONS}" ]; then
  echo "ERROR: fallidos (${FAILED_COUNT}) no puede ser mayor que iteraciones (${ITERATIONS})." >&2
  exit 1
fi

echo "==> Generando ${ITERATIONS} intentos de login contra ${LB_URL}"
echo "    (usuarios: ${USERS[*]}, pausa ${DELAY}s entre ciclos, ${FAILED_COUNT} fallido(s) a proposito)..."

ok=0
fail_expected=0
fail_unexpected=0

for i in $(seq 1 "${ITERATIONS}"); do
  user="${USERS[$(( (i - 1) % ${#USERS[@]} ))]}"
  jar=$(mktemp)

  # Los ultimos FAILED_COUNT ciclos usan password incorrecta a proposito
  # (asi el resto de la corrida ya reflejo trafico normal antes de fallar).
  if [ "$((ITERATIONS - i + 1))" -le "${FAILED_COUNT}" ]; then
    password="password-incorrecta-a-proposito"
    expect_fail=1
  else
    password="${DEMO_ADMIN_PASSWORD}"
    expect_fail=0
  fi

  status=$(curl -s -o /dev/null -w '%{http_code}' -c "${jar}" -X POST "${LB_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${user}\",\"password\":\"${password}\"}")

  if [ "${expect_fail}" -eq 1 ]; then
    if [ "${status}" != "200" ]; then
      fail_expected=$((fail_expected + 1))
      echo "  [${i}/${ITERATIONS}] ${user}: login fallo como se esperaba (${status})"
    else
      fail_unexpected=$((fail_unexpected + 1))
      echo "  [${i}/${ITERATIONS}] ${user}: ADVERTENCIA -- se esperaba que fallara y devolvio 200" >&2
    fi
  else
    if [ "${status}" = "200" ]; then
      ok=$((ok + 1))
      curl -s -o /dev/null -b "${jar}" "${LB_URL}/api/auth/me" || true
      curl -s -o /dev/null -b "${jar}" "${LB_URL}/api/sites" || true
      curl -s -o /dev/null -b "${jar}" -X POST "${LB_URL}/api/auth/logout" || true
      echo "  [${i}/${ITERATIONS}] ${user}: login OK"
    else
      fail_unexpected=$((fail_unexpected + 1))
      echo "  [${i}/${ITERATIONS}] ${user}: login devolvio ${status} (revisa DEMO_ADMIN_PASSWORD en ${SECRETS_FILE})" >&2
    fi
  fi

  rm -f "${jar}"
  sleep "${DELAY}"
done

echo
if [ "${fail_unexpected}" -eq 0 ]; then
  echo "OK: ${ok} login(s) validos, ${fail_expected} fallido(s) a proposito (segun lo esperado)."
else
  echo "REVISAR: ${ok} login(s) validos, ${fail_expected} fallido(s) a proposito, ${fail_unexpected} inesperados."
fi
echo "Dashboard 'FireGuard - App' en Grafana (http://localhost:3001): los paneles"
echo "'Logins exitosos', 'Logins fallidos' y 'Latencia p95' deberian mostrar actividad"
echo "(puede tardar hasta scrape_interval, 15s, en reflejarse)."
