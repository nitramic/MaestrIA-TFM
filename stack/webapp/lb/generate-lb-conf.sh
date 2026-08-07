#!/usr/bin/env bash
# Regenera stack/webapp/lb/lb.conf a partir de los servicios appN
# actualmente desplegados en el stack, y actualiza el servicio "lb" para
# que recargue esa configuracion.
#
# Los configs de Swarm son inmutables: no se puede editar uno existente,
# hay que crear uno nuevo con sufijo de version y reenganchar el servicio
# a el (--config-rm + --config-add), lo que ademas fuerza un rolling
# update del contenedor lb (recarga sin downtime, con 2+ nodos activos).
#
# Uso interno de scale-out.sh / scale-in.sh; no se ejecuta a mano.
set -euo pipefail

STACK="${1:-fireguard}"
COMPOSE="docker compose"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="${DIR}/lb.conf"
VERSION_FILE="${DIR}/.lb_config_version"

exec_manager() { $COMPOSE exec -T swarm-manager "$@"; }

mapfile -t apps < <(exec_manager docker service ls --filter "label=com.docker.stack.namespace=${STACK}" --format '{{.Name}}' \
  | grep -E "^${STACK}_app[0-9]+$" | sed -E "s/^${STACK}_//" | sort -V)

if [ "${#apps[@]}" -eq 0 ]; then
  echo "ERROR: no hay servicios appN desplegados en el stack '${STACK}'." >&2
  exit 1
fi

members=""
for app in "${apps[@]}"; do
  members+="    BalancerMember \"http://${app}:3000\" route=${app}"$'\n'
done

cat > "${CONF_FILE}" <<EOF
# Balanceo de carga hacia los nodos de la app FireGuard.
# Generado automaticamente por generate-lb-conf.sh (via scale-out.sh /
# scale-in.sh) -- no editar a mano, se sobrescribe en el siguiente escalado.
#
# No se usa sticky session (stickysession=ROUTEID): la app no guarda estado
# de sesion en memoria del proceso. La autenticacion es un JWT firmado en
# una cookie httpOnly, verificado sin estado por cualquier nodo, y el
# bloqueo por intentos fallidos de login vive en Postgres (compartido por
# todos los nodos), no en memoria local. Por eso cualquier request puede
# caer en cualquiera de los nodos sin romper el login ni la sesion.
<Proxy "balancer://fireguardcluster">
${members}    ProxySet lbmethod=byrequests
</Proxy>

ProxyPreserveHost On
ProxyPass "/balancer-manager" "!"
ProxyPass "/metrics" "!"
ProxyPass "/" "balancer://fireguardcluster/"
ProxyPassReverse "/" "balancer://fireguardcluster/"

<Location "/balancer-manager">
    SetHandler balancer-manager
    Require all granted
</Location>
EOF

old_version=$(cat "${VERSION_FILE}" 2>/dev/null || echo 1)
new_version=$((old_version + 1))

echo "    -> ${#apps[@]} nodo(s) de app activos: ${apps[*]}"
echo "==> Publicando lb.conf como fireguard-lb-config-v${new_version} y actualizando el servicio lb..."
exec_manager docker config create "fireguard-lb-config-v${new_version}" "/stack/webapp/lb/lb.conf" >/dev/null
exec_manager docker service update \
  --config-rm "fireguard-lb-config-v${old_version}" \
  --config-add "source=fireguard-lb-config-v${new_version},target=/usr/local/apache2/conf/extra/lb.conf" \
  "${STACK}_lb" >/dev/null

echo "${new_version}" > "${VERSION_FILE}"
