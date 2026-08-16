# Esquema de base de datos

FireGuard usa dos tipos de base PostgreSQL: **una única base de directorio** (`pg-directory`) que administra el catálogo de empresas y a los superadmins, y **una base independiente por empresa** (`pg-<slug>`), todas con el mismo esquema. `pg-demo` es la empresa de ejemplo — el mismo diagrama aplica a cualquier otra empresa dada de alta.

## 1. Base de directorio (`pg-directory`)

Sin relación entre sí: `companies` mapea cada empresa a su propia conexión Postgres; `admin_users` son las cuentas del panel `/admin`, no pertenecen a ninguna empresa.

```mermaid
erDiagram
    COMPANIES {
        int id PK
        varchar slug UK "usuario@slug"
        varchar display_name
        varchar db_host
        int db_port
        varchar db_name
        varchar db_user
        varchar db_password
        boolean active
        varchar status "ready / suspended / ..."
        text status_message
        varchar contact_email
        int license_count "tope de usuarios"
        timestamptz created_at
    }

    ADMIN_USERS {
        int id PK
        varchar email UK
        varchar password_hash
        varchar full_name
        int failed_attempts
        timestamptz locked_until
        timestamptz created_at
    }
```

## 2. Base por empresa (`pg-demo`, y una por cada cliente)

```mermaid
erDiagram
    USERS ||--o{ SESSIONS : abre
    USERS ||--o{ INSPECTION_HISTORY : registra
    SITES ||--o{ EXTINGUISHERS : ubica
    EXTINGUISHERS ||--o{ INSPECTION_HISTORY : historial

    USERS {
        int id PK
        varchar email UK "usuario@slug"
        varchar password_hash
        varchar full_name
        varchar role "admin / inspector"
        boolean locked
        int failed_attempts
        timestamptz locked_until
        varchar timezone
        varchar notification_email "casilla real, opcional"
        boolean email_verified
        boolean email_notifications_enabled
        timestamptz last_login_at
        timestamptz password_reset_requested_at
        timestamptz created_at
    }

    SESSIONS {
        int id PK
        int user_id FK
        varchar jti UK
        timestamptz created_at
        timestamptz expires_at
    }

    SITES {
        int id PK
        varchar name UK
        numeric lat
        numeric lng
        timestamptz created_at
    }

    EXTINGUISHERS {
        int id PK
        varchar code UK
        int site_id FK
        varchar location
        varchar type
        numeric weight_kg
        numeric pressure_bar
        varchar serial_number
        date last_inspected
        date next_due
        timestamptz created_at
        timestamptz updated_at
    }

    INSPECTION_HISTORY {
        int id PK
        int extinguisher_id FK
        varchar action "inspected / status_change"
        varchar previous_status
        varchar new_status
        int performed_by FK
        timestamptz performed_at
    }
```

`sessions` acota usuarios concurrentes contra `companies.license_count`; `inspection_history` es el log de auditoría detrás de Reportes.
