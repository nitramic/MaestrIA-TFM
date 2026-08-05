# Docker-in-Docker Swarm (3 nodos)

Levanta 3 contenedores `docker:dind` (1 manager + 2 workers) sobre una red bridge
propia y los une en un clúster Swarm.

## Requisitos

- Docker Engine con soporte para contenedores `privileged` (necesario para DinD).
- Docker Compose v2 (`docker compose`).

## Uso

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

## Desplegar Apache + PHP (2 nodos) tras un balanceador Apache2

Contenido en `stack/`:

- `stack/app`: imagen `php:8.2-apache` con un `index.php` que muestra el
  hostname del contenedor que respondió (para comprobar el balanceo).
- `stack/lb`: imagen basada en `httpd:2.4` con `mod_proxy_balancer` /
  `mod_lbmethod_byrequests` configurado en `stack/lb/lb.conf`, balanceando
  entre `web1` y `web2`.
- `stack/docker-stack.yml`: define los servicios `web1`, `web2` (cada uno con
  `placement: node.role == worker`, es decir, cada uno cae en uno de los dos
  workers) y `lb` (publicado en el `8081`).

Con el swarm ya inicializado (`./init-swarm.sh`), construye las imágenes,
súbelas al registry local y despliega el stack:

```bash
./deploy-app.sh
```

Comprueba el balanceo (el hostname debería alternar entre los dos nodos):

```bash
curl http://localhost:8081/
curl http://localhost:8081/
```

Estado del balanceador de Apache: http://localhost:8081/balancer-manager

Servicios y réplicas del stack:

```bash
docker compose exec swarm-manager docker stack services phpstack
docker compose exec swarm-manager docker stack ps phpstack
```

Eliminar solo el stack de la app (mantiene el swarm vivo):

```bash
docker compose exec swarm-manager docker stack rm phpstack
```

## Desplegar bases PostgreSQL individuales (puertos desde 5001)

`deploy-postgres.sh` crea, cada vez que se ejecuta, un servicio Swarm
independiente para una base de datos (`pg-<nombre_db>`), con su propio
volumen y su propio puerto publicado. En vez del `5432` por defecto, el
primer servicio usa el `5001`, el siguiente el `5002`, etc. (el script busca
automáticamente el primer puerto libre en ese rango, que va del `5001` al
`5020` según lo publicado en `docker-compose.yml`).

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

## Limpiar todo

```bash
docker compose down -v
```
