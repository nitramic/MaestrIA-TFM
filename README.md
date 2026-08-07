# FireGuard — Docker-in-Docker Swarm (3 nodos)

Levanta 3 contenedores `docker:dind` (1 manager + 2 workers) sobre una red bridge
propia, los une en un clúster Swarm, y despliega ahí la webapp **FireGuard**
(gestión de extintores, multi-empresa) junto con su base de datos de directorio.

## Requisitos

- Docker Engine con soporte para contenedores `privileged` (necesario para DinD).
- Docker Compose v2 (`docker compose`).

## 0. Generar secretos

Antes de desplegar nada, generar `secrets.env` (fuera de git, no se commitea):

```bash
./generate-secrets.sh
```

Genera valores random para `JWT_SECRET`, `INTERNAL_ADMIN_TOKEN`,
`DIRECTORY_DB_PASSWORD`, el password de Grafana, y el password/hash del
superadmin y de la empresa demo. `deploy-webapp.sh`, `deploy-demo.sh` y
`scale-out.sh` lo leen automáticamente — sin este archivo, no despliegan.

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

## 3. Dar de alta empresas

Cada empresa tiene su propia base Postgres, aislada de las demás, registrada
en `pg-directory`. Las altas se hacen desde el panel `/admin` (botón "Nueva
Empresa") o por línea de comandos:

```bash
./add-company.sh <slug> [nombre_visible] [admin_password]
```

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

`deploy-postgres.sh` (usado internamente por `add-company.sh` / `deploy-demo.sh`,
o directamente si hace falta una base suelta) crea, cada vez que se ejecuta,
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
