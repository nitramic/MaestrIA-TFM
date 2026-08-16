#!/usr/bin/env bash
# Prueba SOLO el balanceo de carga -- no escala nada. Usa los nodos appN que
# esten desplegados en ese momento (2 a 6, lo que sea que haya dejado
# scale-out.sh/scale-in.sh), asi se puede correr en cualquier punto del
# ciclo de escalado, tantas veces como haga falta, sin efectos secundarios
# sobre la cantidad de nodos:
#  1. Detecta los nodos appN actualmente desplegados.
#  2. Verifica que esten 1/1 via `docker service ls`.
#  3. Dispara una rafada de requests contra el balanceador
#     (http://localhost:8081/) y verifica que todas respondan 200/OK.
#  4. Lee /balancer-manager antes y despues de la rafada y compara los
#     contadores de "Elected" (hits) de cada BalancerMember para confirmar
#     que todos los nodos recibieron trafico.
#
# Para probar en una cantidad de nodos en particular, escala primero con
# ./scale-out.sh / ./scale-in.sh (o corre este script antes y despues de
# escalar, para comparar).
#
# Requiere que el stack ya este desplegado (./deploy-webapp.sh corrido).
set -euo pipefail

COMPOSE="docker compose"
STACK="fireguard"
LB_URL="http://localhost:8081"
REQUESTS=120
CONCURRENCY=10

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

mapfile -t apps < <(exec_manager docker service ls --filter "label=com.docker.stack.namespace=${STACK}" --format '{{.Name}}' \
  | grep -E "^${STACK}_app[0-9]+$" | sed -E "s/^${STACK}_//" | sort -V)

if [ "${#apps[@]}" -eq 0 ]; then
  echo "ERROR: no hay nodos de app desplegados en el stack '${STACK}'. Corre ./deploy-webapp.sh primero." >&2
  exit 1
fi

echo "==> 1/3 Nodos de app actualmente desplegados: ${#apps[@]} (${apps[*]})"

echo "==> 2/3 Verificando que esten 1/1..."
fail=0
for app in "${apps[@]}"; do
  replicas=$(exec_manager docker service ls --filter "name=${STACK}_${app}" --format '{{.Replicas}}')
  echo "    ${STACK}_${app}: ${replicas}"
  if [ "${replicas}" != "1/1" ]; then
    echo "    ERROR: ${STACK}_${app} no esta 1/1" >&2
    fail=1
  fi
done
[ "${fail}" -eq 0 ] || { echo "FALLO: no todos los nodos de app estan sanos."; exit 1; }

echo "==> 3/3 Disparando ${REQUESTS} requests (concurrencia ${CONCURRENCY}) contra ${LB_URL}/..."
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

echo "==> Comparando hits por nodo en /balancer-manager (antes vs despues)..."
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
for app in "${apps[@]}"; do
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
  echo "OK: los ${#apps[@]} nodo(s) respondieron y el balanceador repartio trafico entre todos."
else
  echo "REVISAR: no todos los nodos mostraron trafico nuevo, o hubo errores HTTP."
  echo "         El parseo de /balancer-manager es best-effort; inspecciona a mano en:"
  echo "         ${LB_URL}/balancer-manager"
  exit 1
fi
