# Arquitectura Docker, de adentro hacia afuera

Tres niveles de anidamiento, cada uno detallado en su propio diagrama:

1. **Servicios dentro del Swarm** — qué corre en los stacks `fireguard` y `monitoring`, y dónde vive cada pieza de monitoreo (algunas dentro del swarm, otras un nivel más arriba).
2. **El Swarm dentro de los DinD** — cómo 4 contenedores `docker:dind`, cada uno con su propio demonio Docker, se unen entre sí para formar un único clúster Swarm, corriendo sobre un solo Docker real.
3. **Ese Docker dentro de la VM de Clouding** — el proveedor, la VM y cómo se expone y administra el ciclo de vida.

## 1. Servicios anidados en Docker Swarm

Registry y Grafana **no viven dentro del swarm** — corren en el `docker-compose.yml` de nivel superior (Diagrama 2/3). Lo único que sí vive adentro del swarm, del lado del monitoreo, es su propio stack `monitoring` (node-exporter + cadvisor + un Prometheus interno), que Grafana consulta desde afuera.

```mermaid
flowchart TB
    subgraph HOST["Docker real de la VM — docker-compose.yml (detalle → Diagrama 2 y 3)"]
        REG[("registry:2\ndind-registry")]
        DSE["docker-stats-exporter\nstats de los 4 contenedores DinD"]
        NEH["node-exporter\n(host real)"]
        PH["prometheus-host :9090"]
        GRAF["grafana :3001\ndashboards + alerting"]
        DIND["swarm-manager / worker1 / worker2 (/worker3)\ncontenedores docker:dind"]
        DSE --> PH
        NEH --> PH
        PH --> GRAF
    end

    subgraph SWARM["Dentro de los DinD → un único Docker Swarm (overlay fireguard-net)"]
        subgraph STACKFG["docker stack deploy fireguard"]
            LB["lb (Apache)\n:8081 routing mesh"]
            APPS["app1 .. app6"]
            AW["admin-worker\n(unico con docker.sock)"]
            PGD[("pg-directory")]
            PGC[("pg-&lt;empresa&gt;")]
            LB --> APPS
            AW -. "crea/borra" .-> PGC
        end
        subgraph STACKMON["docker stack deploy monitoring"]
            NES["node-exporter\nmode: global (1 por nodo swarm)"]
            CAD["cadvisor\nmode: global (1 por nodo swarm)"]
            PS["prometheus :9091→9090\npinned a swarm-manager"]
            NES --> PS
            CAD --> PS
            APPS -. "/metrics" .-> PS
            AW -. "/metrics" .-> PS
        end
    end

    DIND -. "cada DinD corre un\ndockerd propio, adentro" .-> SWARM
    DIND -- "docker pull/push\n--insecure-registry=registry:5000" --> REG
    GRAF -- "datasource Prometheus-Swarm\nhttp://swarm-manager:9091" --> PS
    GRAF -- "datasource Prometheus-Host" --> PH
```

## 2. El Swarm corriendo dentro de los DinD, sobre un solo Docker

Cuatro contenedores `docker:dind` (`privileged`, `DOCKER_TLS_CERTDIR` vacío), cada uno con su **propio** demonio Docker y su propio `/var/lib/docker` — aislados entre sí como si fueran 4 máquinas. Se unen entre ellos (`docker swarm init` / `join`) sobre la red bridge `dind-net`, y como cada uno tiene su almacén de imágenes aislado, comparten un `registry` local para poder correr en cualquier nodo una imagen construida en el manager.

```mermaid
flowchart TB
    subgraph VMHOST["Un solo Docker real (el de la VM) — docker compose up -d"]
        subgraph SM_BOX["swarm-manager · 172.19.0.10\ndocker:27-dind"]
            SMD["dockerd interno\n(su propio /var/lib/docker)"]
        end
        subgraph W1_BOX["swarm-worker1 · 172.19.0.11"]
            W1D["dockerd interno"]
        end
        subgraph W2_BOX["swarm-worker2 · 172.19.0.12"]
            W2D["dockerd interno"]
        end
        subgraph W3_BOX["swarm-worker3 · 172.19.0.13\nbajo demanda (profile scale)"]
            W3D["dockerd interno"]
        end
        REG2[("registry:2\nimagenes compartidas")]
    end

    SMD == "docker swarm init" ==> CLUSTER{{"Docker Swarm\n1 manager + hasta 3 workers"}}
    W1D == "docker swarm join" ==> CLUSTER
    W2D == "docker swarm join" ==> CLUSTER
    W3D -. "join bajo demanda\n(scale-out.sh → add-swarm-worker.sh)" .-> CLUSTER

    SMD -- "pull/push" --> REG2
    W1D -- "pull/push" --> REG2
    W2D -- "pull/push" --> REG2

    CLUSTER -- "docker stack deploy" --> NOTE["stacks fireguard + monitoring\n(detalle → Diagrama 1)"]
```

## 3. Ese Docker corriendo en la VM, dentro de Clouding.io

```mermaid
flowchart TB
    subgraph CLOUDING["Clouding.io — proveedor cloud"]
        subgraph VM["VM Linux (Ubuntu/Debian)"]
            subgraph DOCKERENGINE["Docker Engine + Compose v2 (install-docker.sh)"]
                COMPOSE["docker-compose.yml\n(un unico docker compose up -d)"]
                subgraph GROUP1["4 nodos DinD → Docker Swarm\n(detalle → Diagrama 2)"]
                    NODES["swarm-manager / worker1 / worker2 / worker3"]
                end
                REGX[("registry")]
                subgraph MONHOST["monitoreo de la capa host"]
                    DSE2["docker-stats-exporter"]
                    NEH2["node-exporter"]
                    PH2["prometheus-host"]
                    GRAF2["grafana :3001"]
                end
                CF["cloudflared\nnetwork_mode: host"]
                COMPOSE --> GROUP1
                COMPOSE --> REGX
                COMPOSE --> MONHOST
                COMPOSE --> CF
            end
        end
    end

    USERS(["usuarios\n(navegador)"]) -- HTTPS --> CFEDGE["Cloudflare Edge\ndominio publico"]
    CFEDGE -- "tunel saliente\nsin puertos entrantes" --> CF
    CF --> NODES

    GRAF2 -- alertas --> SLACKINFRA["Slack · canal infra"]

    ADMIN(["quien administra\nla demo"]) -- "cron @reboot\nstart-demo.sh" --> COMPOSE
    ADMIN -- "stop-demo.sh +\nAPI del proveedor\n(power off, no delete)" --> CLOUDING
```

`start-demo.sh` no recrea nada (mismos datos, mismos contenedores); `stop-demo.sh` frena el stack y apaga la VM — el apagado debe ir por la API del proveedor (o una VM configurada en modo "stop" ante un `poweroff` interno), nunca un `poweroff` liso, para no perder el disco.
