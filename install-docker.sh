#!/usr/bin/env bash
# Bootstrap de Docker Engine + Compose v2 en una VM Linux recien instalada
# (Ubuntu/Debian). Idempotente: si docker ya esta instalado, no hace nada.
# Correr una sola vez, antes de "docker compose up -d" (ver README).
#
# Uso:
#   ./install-docker.sh          # instala si hace falta
#   sudo ./install-docker.sh     # si el usuario actual no tiene sudo passwordless
set -euo pipefail

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || { echo "ERROR: se necesita root o sudo." >&2; exit 1; }
  SUDO="sudo"
fi

# El entrypoint de Grafana corre como uid 472 (usuario "grafana" de la
# imagen), pero su GRUPO PRIMARIO es 0/root (ver /etc/passwd de la
# imagen: "grafana:x:472:0:..."), no 472. Un "git clone" fresco deja
# este directorio en root:root -- como el gid efectivo del proceso (0)
# coincide con el grupo dueno del directorio, el kernel evalua por
# GRUPO (r-x, sin escritura) y ni siquiera llega a mirar "otros", asi
# que un simple "o+w" no alcanza (verificado: con go solo "o+w" el
# contenedor sigue fallando con "Permission denied" al crear
# contactpoints.yaml; con "g+w" funciona). Sin esto, el contenedor
# muere al arrancar. Grafana no tiene profile restringido en
# docker-compose.yml, asi que el primer "docker compose up -d" (sea el
# de este mismo README o el de cualquier otro script) ya lo levanta --
# por eso este ajuste va aca, antes de cualquier otra cosa, en vez de en
# deploy-monitoring.sh (que corre demasiado tarde para la primera vez).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "${SCRIPT_DIR}/monitoring/grafana/provisioning/alerting" ]; then
  chmod -R go+w "${SCRIPT_DIR}/monitoring/grafana/provisioning/alerting"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Docker Engine + Compose v2 ya estan instalados:"
  docker --version
  docker compose version
  exit 0
fi

if [ ! -f /etc/os-release ]; then
  echo "ERROR: no se pudo detectar la distro (/etc/os-release ausente)." >&2
  echo "       Instala Docker manualmente: https://docs.docker.com/engine/install/" >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
DISTRO_ID="${ID:-}"
case "${DISTRO_ID}" in
  ubuntu|debian) ;;
  *)
    echo "ERROR: distro '${DISTRO_ID}' no soportada por este script (solo Ubuntu/Debian)." >&2
    echo "       Instala Docker manualmente: https://docs.docker.com/engine/install/" >&2
    exit 1
    ;;
esac

echo "==> Instalando dependencias..."
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq ca-certificates curl gnupg

echo "==> Agregando la clave GPG y el repositorio oficial de Docker (${DISTRO_ID})..."
$SUDO install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/${DISTRO_ID}/gpg" | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
$SUDO chmod a+r /etc/apt/keyrings/docker.gpg

ARCH=$(dpkg --print-architecture)
CODENAME="${VERSION_CODENAME:-$(. /etc/os-release && echo "$VERSION_CODENAME")}"
echo \
  "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DISTRO_ID} ${CODENAME} stable" |
  $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

echo "==> Instalando Docker Engine + plugins (buildx, compose)..."
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> Habilitando y arrancando el servicio docker..."
$SUDO systemctl enable --now docker >/dev/null 2>&1 || true

if [ -n "${SUDO}" ] && [ "${SUDO_USER:-${USER:-}}" != "root" ]; then
  TARGET_USER="${SUDO_USER:-${USER:-}}"
  if [ -n "${TARGET_USER}" ] && ! id -nG "${TARGET_USER}" | grep -qw docker; then
    echo "==> Agregando ${TARGET_USER} al grupo 'docker' (para no necesitar sudo)..."
    $SUDO usermod -aG docker "${TARGET_USER}"
    echo "    Cerra sesion y volve a entrar (o 'newgrp docker') para que tome efecto."
  fi
fi

echo
echo "Listo:"
docker --version
docker compose version
echo
echo "Si tuviste que agregarte al grupo 'docker' recien, abri una sesion nueva"
echo "antes de seguir con 'docker compose up -d' (ver README)."
