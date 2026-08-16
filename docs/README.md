# Documentación de FireGuard

Guía de lectura para quien llega al proyecto sin contexto previo — de la historia general a los detalles técnicos.

## 1. [Presentación](https://docs.google.com/presentation/d/1RxDmtTsTzwtj3sFXQBI8up5idwrgrJk_sOg9Abvpw3w/edit?usp=sharing)

La historia del proyecto: del mockup en [Banani.co](https://app.banani.co/preview/lS6OIWLGsO2A) a la app construida con Claude, sus funcionalidades, y la infraestructura donde corre. 15 diapositivas, en Google Slides.
si quieres ver en la carpeta mockup encontraras los exports usados, sino en el siguiente [link](https://app.banani.co/preview/lS6OIWLGsO2A)

## 2. [Arquitectura Docker](docker-architecture.md)

Cómo está desplegada la infraestructura, en tres diagramas de adentro hacia afuera: qué corre dentro del Swarm, cómo ese Swarm vive dentro de contenedores `docker:dind`, y cómo todo eso corre sobre una única VM en Clouding.io.

## 3. [Esquema de base de datos](db-schema.md)

Diagramas entidad-relación: la base de directorio (`pg-directory`, catálogo de empresas) y la base por empresa (`pg-demo` como plantilla — cada cliente tiene la suya, aislada).

## 4. [Lógica de la app y del panel admin](flow-logic.md)

Diagramas de flujo: login y uso diario de la app (extintores, reportes, gestión de usuarios de la empresa), y el alta/ciclo de vida de una empresa desde el panel `/admin`.

---

Los diagramas de los puntos 2 a 4 están en Mermaid y se renderizan directamente en la vista de GitHub.
