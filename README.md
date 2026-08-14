# FireGuard — Docker-in-Docker Swarm (3 nodos)

Levanta 3 contenedores `docker:dind` (1 manager + 2 workers) sobre una red bridge
propia, los une en un clúster Swarm, y despliega ahí la webapp **FireGuard**
(gestión de extintores, multi-empresa) junto con su base de datos de directorio.

## Requisitos

- Docker Engine con soporte para contenedores `privileged` (necesario para DinD).
- Docker Compose v2 (`docker compose`).

En una VM Linux recien instalada (Ubuntu/Debian) sin Docker todavia:

```bash
./install-docker.sh
```

Instala Docker Engine + Compose v2 desde el repositorio oficial (idempotente:
si ya esta instalado, no hace nada) y agrega el usuario actual al grupo
`docker`. Para otras distros, instalar Docker manualmente
(https://docs.docker.com/engine/install/) antes de seguir.

Todo el resto del stack (scripts, `docker-compose.yml`, `docker-stack.yml`)
no asume nada de la maquina donde corre -- IPs, hostnames y URLs salen todos
de variables de entorno con defaults sensatos (`localhost:8081`), asi que
cualquier VM Linux con Docker sirve como entorno nuevo.

## 0. Generar secretos

Antes de desplegar nada, generar `secrets.env` (fuera de git, no se commitea):

```bash
./generate-secrets.sh
```

Genera valores random para `JWT_SECRET`, `INTERNAL_ADMIN_TOKEN`,
`DIRECTORY_DB_PASSWORD`, el password de Grafana, y el password/hash del
superadmin y de la empresa demo. `deploy-webapp.sh`, `deploy-demo.sh` y
`scale-out.sh` lo leen automáticamente — sin este archivo, no despliegan.

**Migrar un `secrets.env` ya probado a otra VM** (por ejemplo, uno con la
`BREVO_API_KEY` ya verificada): al estar fuera de git, no viaja con `git
clone` — copialo aparte:

```bash
scp secrets.env usuario@vm-nueva:/ruta/al/repo/secrets.env
```

`monitoring/.env` (con `SLACK_WEBHOOK_URL`) es opcional y tampoco viaja con
git; copialo igual si lo tenés configurado, o dejalo afuera (Grafana arranca
igual, sin ese contact point).

## 1. Levantar el swarm

```bash
docker compose up -d
```

Espera a que los 3 contenedores estén `healthy` y arranca el swarm:

```bash
./init-swarm.sh
```

Verifica el clúster:

```bash
docker compose exec swarm-manager docker node ls
```

## 2. Desplegar la webapp

`deploy-webapp.sh` construye y publica la imagen de FireGuard en el registry
local, crea la red overlay `fireguard-net` y el servicio `pg-directory`
(base de datos de directorio: empresa ↔ conexión a su propia base), y
despliega el stack `fireguard` (2 réplicas de la app + balanceador Apache +
un worker interno de administración):

```bash
./deploy-webapp.sh
```

No hace falta ninguna empresa dada de alta para arrancar — el arranque
mínimo es swarm + registry + `pg-directory` + la webapp.

La app queda disponible en:

- Webapp: http://localhost:8081
- Estado del balanceador: http://localhost:8081/balancer-manager
- Panel de administración: http://localhost:8081/admin
  (usuario: `superadmin@fireguard.local`, password: ver `SUPERADMIN_PASSWORD`
  en `secrets.env`, o la salida de `./deploy-webapp.sh`)

Servicios y réplicas del stack:

```bash
docker compose exec swarm-manager docker stack services fireguard
docker compose exec swarm-manager docker stack ps fireguard
```

Eliminar solo el stack de la app (mantiene el swarm vivo):

```bash
docker compose exec swarm-manager docker stack rm fireguard
```

### Escalar la webapp

El stack arranca con 2 nodos de app (`app1`, `app2`). `scale-out.sh` /
`scale-in.sh` agregan o quitan nodos `appN` uno a la vez, respetando un
mínimo de 2 y un máximo de 6, y regeneran la configuración del balanceador
Apache (`stack/webapp/lb/lb.conf`) para incluir/excluir el nodo:

```bash
./scale-out.sh   # agrega el siguiente nodo (hasta app6)
./scale-in.sh    # quita el nodo mas alto (nunca por debajo de app1/app2)
```

`app1`-`app4` se reparten entre los 2 workers existentes (`swarm-worker1`,
`swarm-worker2`). A partir de `app5`, `scale-out.sh` levanta bajo demanda un
tercer worker (`swarm-worker3`, ver `add-swarm-worker.sh`) y aloja ahí
`app5` y `app6` en exclusiva. Al escalar hacia adentro, `swarm-worker3` se
deja corriendo (inactivo) para poder volver a escalar rápido.

Para probar el escalado a las 6 instancias y el reparto de carga del
balanceador de punta a punta:

```bash
./test-scale-balancer.sh
```

Ese script prueba reparto de carga con requests anónimos. Para generar
tráfico autenticado real (logins válidos de la empresa demo) y que los
paneles de login/uso del dashboard "FireGuard - App" en Grafana tengan
datos para mostrar:

```bash
./test-app-logins.sh              # 20 ciclos de login/logout, 1 por segundo
./test-app-logins.sh 50 0.5       # 50 ciclos, medio segundo de pausa
```

## 3. Dar de alta empresas

Cada empresa tiene su propia base Postgres, aislada de las demás, registrada
en `pg-directory`. Las altas se hacen desde el panel `/admin` (botón "Nueva
Empresa").

El login de cada empresa es `admin@<slug>` (y cualquier otro usuario que se
cree luego desde el panel de la empresa, en Ajustes → Usuarios).

Empresa de ejemplo con datos precargados (sitios, extintores, historial de
inspecciones) — siempre queda última en el listado del panel admin:

```bash
./deploy-demo.sh
```

Login demo: `admin@demo` (también `inspector@demo` y `locked@demo`, para
probar roles y desbloqueo de cuenta) / password: ver `DEMO_ADMIN_PASSWORD`
en `secrets.env`, o la salida de `./deploy-demo.sh`.

Desde el panel de administración también se puede:

- Ver los usuarios de cada empresa y su última conexión.
- Restablecer la contraseña del administrador o de cualquier usuario puntual.
- Ver y resolver solicitudes de "olvidé mi contraseña" pendientes.
- Suspender / reanudar / eliminar una empresa.

## 4. Desplegar bases PostgreSQL individuales (puertos desde 5001)

`deploy-postgres.sh` (usado internamente por `deploy-demo.sh`, o directamente
si hace falta una base suelta) crea, cada vez que se ejecuta,
un servicio Swarm independiente para una base de datos (`pg-<nombre_db>`),
con su propio volumen y su propio puerto publicado. En vez del `5432` por
defecto, el primer servicio usa el `5001`, el siguiente el `5002`, etc. (el
script busca automáticamente el primer puerto libre en ese rango, que va del
`5001` al `5020` según lo publicado en `docker-compose.yml`).

```bash
./deploy-postgres.sh miapp
./deploy-postgres.sh otraapp otraPasswordSegura otroUsuario
```

Cada servicio queda fijado al nodo `swarm-manager` (`node.hostname==swarm-manager`)
para que su volumen (almacenamiento `local`, no compartido entre nodos) no se
pierda si Swarm reprograma la tarea en otro nodo.

Conectarse:

```bash
psql -h localhost -p 5001 -U postgres -d miapp
```

Listar / eliminar:

```bash
docker compose exec swarm-manager docker service ls --filter name=pg-
docker compose exec swarm-manager docker service rm pg-miapp
```

## 5. Publicar con Cloudflare Tunnel

Expone la webapp (`localhost:8081`) en un dominio propio (ej.
`fireguard.nitramic.com`) via un túnel saliente de `cloudflared` — no hace
falta abrir ningún puerto entrante en el firewall de la VM.

1. En el dashboard de Cloudflare Zero Trust: `Networks` → `Tunnels` →
   `Create a tunnel`, conector `Cloudflared`. Copiá el **token** del paso
   "Install and run connector" (no corras el comando que muestra ahí).
2. En la misma pantalla, `Public Hostname`: tu subdominio, tipo `HTTP`, URL
   `localhost:8081`.
3. Pegá el token en `CLOUDFLARE_TUNNEL_TOKEN` en `secrets.env`.
4. Levantalo:

   ```bash
   ./deploy-tunnel.sh
   ```

Corre `cloudflared` como container en la capa host (`docker-compose.yml`,
profile `tunnel`, `network_mode: host`), con reinicio automático. Bajarlo
sin tocar el resto del stack:

```bash
docker compose --profile tunnel down cloudflared
```

## 6. Encendido/apagado (VM de demo remota)

`start-demo.sh` levanta todo sin recrear nada (mismos datos, mismos
contenedores) — útil como `@reboot` en cron si la VM llega a reiniciarse y
querés que el stack vuelva a estar arriba solo:

```bash
sudo crontab -e
```

```
@reboot /ruta/al/repo/start-demo.sh >> /var/log/fireguard-start.log 2>&1
```

`stop-demo.sh` frena el stack (conserva los datos) y apaga la máquina
(power off). No se programa solo — se corre a mano, o lo invoca quien sea
que administre el ciclo de vida de la VM (por ejemplo, un script/notebook
externo que la crea con un tiempo de vida fijo vía la API del proveedor
cloud). Ninguno de los dos scripts programa un apagado automático por su
cuenta.

**Importante:** si el apagado se dispara con un `poweroff` desde adentro
de la VM (en vez de vía la API del proveedor cloud), confirmá que la
instancia esté configurada para "stop" (no "terminate"/"delete") cuando el
SO se apaga desde adentro — si no, se pierde el disco entero.

## Notas

- Cada nodo es un demonio Docker independiente (`docker:dind`), aislado del
  Docker del host, con su propio volumen (`manager-data`, `worker1-data`,
  `worker2-data`) para persistir `/var/lib/docker`.
- `DOCKER_TLS_CERTDIR` se deja vacío para desactivar TLS entre los daemons:
  válido para un laboratorio local en una red bridge privada, **no usar así
  en producción o en una red expuesta**.
- El puerto de gestión del swarm (2377), discovery (7946) y overlay (4789/udp)
  del manager se publican al host solo como referencia; no son necesarios
  para que el clúster funcione entre los propios contenedores.
- Visualizador opcional del estado del swarm (http://localhost:8080):

  ```bash
  docker compose --profile viz up -d visualizer
  ```
- Incluye un `registry` local (`registry:2`) en `dind-net`: cada nodo DinD
  tiene su propio almacén de imágenes aislado, así que necesitan un registro
  compartido para poder ejecutar en cualquier nodo del swarm una imagen
  construida en el manager. Los tres daemons arrancan con
  `--insecure-registry=registry:5000` porque el registry no tiene TLS
  (solo válido para este laboratorio local).
- El directorio `./stack` se monta en `swarm-manager` como `/stack`, para
  poder construir imágenes y desplegar el stack sin salir del contenedor.

## Limpiar todo

```bash
docker compose down -v
```
