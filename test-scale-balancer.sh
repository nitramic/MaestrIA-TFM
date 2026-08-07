#!/usr/bin/env bash
# Prueba end-to-end de escalado + balanceo:
#  1. Escala la webapp hasta MAX_APPS (6) nodos con scale-out.sh (agregando
#     swarm-worker3 para app5/app6 si hace falta).
#  2. Verifica que los 6 servicios app1..app6 esten desplegados y con su
#     replica corriendo (1/1) via `docker service ls`.
#  3. Dispara una rafada de requests contra el balanceador
#     (http://localhost:8081/) y verifica que todas respondan 200/OK.
#  4. Lee /balancer-manager antes y despues de la rafada y compara los
#     contadores de "Elected" (hits) de cada BalancerMember para confirmar
#     que los 6 nodos recibieron trafico.
#
# Requiere que el stack ya este desplegado (./deploy-webapp.sh corrido).
# No hace scale-in al terminar -- corre ./scale-in.sh manualmente las
# veces que haga falta para volver a 2 nodos.
set -euo pipefail

COMPOSE="docker compose"
STACK="fireguard"
LB_URL="http://localhost:8081"
TARGET_APPS=6
REQUESTS=120
CONCURRENCY=10
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

current_count() {
  exec_manager docker service ls --filter "label=com.docker.stack.namespace=${STACK}" --format '{{.Name}}' \
    | grep -cE "^${STACK}_app[0-9]+$" || true
}

echo "==> 1/4 Escalando hasta ${TARGET_APPS} nodos de app..."
count=$(current_count)
while [ "${count}" -lt "${TARGET_APPS}" ]; do
  "${DIR}/scale-out.sh"
  count=$(current_count)
done
echo "    Nodos de app activos: ${count}/${TARGET_APPS}"

echo "==> 2/4 Verificando que los ${TARGET_APPS} servicios esten 1/1..."
fail=0
for n in $(seq 1 "${TARGET_APPS}"); do
  replicas=$(exec_manager docker service ls --filter "name=${STACK}_app${n}" --format '{{.Replicas}}')
  echo "    ${STACK}_app${n}: ${replicas}"
  if [ "${replicas}" != "1/1" ]; then
    echo "    ERROR: ${STACK}_app${n} no esta 1/1" >&2
    fail=1
  fi
done
[ "${fail}" -eq 0 ] || { echo "FALLO: no todos los nodos de app estan sanos."; exit 1; }

echo "==> 3/4 Disparando ${REQUESTS} requests (concurrencia ${CONCURRENCY}) contra ${LB_URL}/..."
before=$(mktemp)
after=$(mktemp)
curl -s "${LB_URL}/balancer-manager" -o "${before}" || true

results_file=$(mktemp)
seq 1 "${REQUESTS}" | xargs -P "${CONCURRENCY}" -I{} curl -s -o /dev/null -w '%{http_code}\n' "${LB_URL}/" > "${results_file}"
ok=$(grep -c '^200$' "${results_file}" || true)
errors=$(grep -vc '^200$' "${results_file}" || true)
rm -f "${results_file}"
echo "    Respuestas 200: ${ok} / ${REQUESTS} (errores: ${errors})"
[ "${errors}" -eq 0 ] || echo "    ADVERTENCIA: hubo ${errors} respuestas no-200."

curl -s "${LB_URL}/balancer-manager" -o "${after}" || true

echo "==> 4/4 Comparando hits por nodo en /balancer-manager (antes vs despues)..."
extract_hits() {
  # Aisla, para cada worker, el bloque de su fila y se queda con el primer
  # numero que sigue al nombre de ruta (columna "Elected" en mod_proxy_balancer).
  local file="$1" app="$2"
  grep -o "route=${app}\"[^>]*>.\{0,400\}" "${file}" 2>/dev/null \
    | head -1 \
    | grep -oE '[0-9]+' \
    | sed -n '2p'
}

all_moved=1
for n in $(seq 1 "${TARGET_APPS}"); do
  app="app${n}"
  b=$(extract_hits "${before}" "${app}")
  a=$(extract_hits "${after}" "${app}")
  b=${b:-0}
  a=${a:-0}
  delta=$((a - b))
  status="sin trafico"
  if [ "${delta}" -gt 0 ]; then status="+${delta} hits"; else all_moved=0; fi
  echo "    ${app}: antes=${b} despues=${a} (${status})"
done

rm -f "${before}" "${after}"

echo
if [ "${all_moved}" -eq 1 ] && [ "${errors}" -eq 0 ]; then
  echo "OK: los ${TARGET_APPS} nodos respondieron y el balanceador repartio trafico entre todos."
else
  echo "REVISAR: no todos los nodos mostraron trafico nuevo, o hubo errores HTTP."
  echo "         El parseo de /balancer-manager es best-effort; inspecciona a mano en:"
  echo "         ${LB_URL}/balancer-manager"
  exit 1
fi
