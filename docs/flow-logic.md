# Lógica de la aplicación

Dos flujos, calcados del código: el de la app (login de usuario, extintores, gestión de usuarios de la propia empresa) y el del panel `/admin` (login de superadmin, alta y ciclo de vida de empresas vía `admin-worker`).

## 1. App — login y uso diario (`src/routes/auth.js`, `extinguishers.js`, `settings.js`)

```mermaid
flowchart TD
    Start(["POST /auth/login"]) --> RL{"Rate limit:\n30 intentos / 5 min por IP"}
    RL -- excedido --> RL1["429 Demasiadas solicitudes"]
    RL -- ok --> V{"email y password\npresentes?"}
    V -- no --> V1["400 Datos no válidos"]
    V -- sí --> Slug["slugFromEmail(email)\nusuario@slug → empresa"]
    Slug --> Comp{"empresa existe\nen pg-directory?"}
    Comp -- no --> Dummy["bcrypt contra dummy hash\n(mismo tiempo de respuesta)"]
    Dummy --> Unk1["401 Datos no válidos"]
    Comp -- sí --> User{"usuario existe\nen la empresa?"}
    User -- no --> Dummy
    User -- sí --> Locked{"locked = true\n(bloqueo manual)?"}
    Locked -- sí --> Locked1["423 Cuenta bloqueada\npor el administrador"]
    Locked -- no --> Temp{"locked_until\nvigente?"}
    Temp -- sí --> Temp1["429 Reintentar en N min"]
    Temp -- no --> Pass{"bcrypt.compare\npassword?"}
    Pass -- no --> Fail["failed_attempts += 1"]
    Fail --> Five{">= 5 intentos?"}
    Five -- sí --> Lock5["Bloqueo temporal 5 min\nmail 'cuenta bloqueada' + Slack #app-events"]
    Five -- no --> Fail1["401 Datos no válidos"]
    Pass -- sí --> Lic{"sesiones activas\n>= license_count?"}
    Lic -- sí --> Lic1["403 Límite de licencias\nde la empresa"]
    Lic -- no --> Ok["reset intentos, last_login_at\nINSERT sessions, cookie JWT (8h)"]
    Ok --> Dash["Dashboard de la empresa"]

    Dash --> Ext["Extintores:\nlistar · detalle · inspect-now"]
    Ext --> Hist["cambia estado?\nINSERT inspection_history"]
    Dash --> Rep["Reportes:\nresumen · actividad · pronóstico"]
    Dash --> Role{"session.role\n= admin?"}
    Role -- inspector --> Self["Ajustes → mi perfil\ny mi contraseña"]
    Role -- admin --> Users["Ajustes → Usuarios de la empresa"]

    Users --> UAdd["Alta de usuario\n(tope: license_count)"]
    Users --> UReset["Reset de password\nmail + Slack #app-events"]
    Users --> ULock["Bloquear / desbloquear\nmail al desbloquear"]

    Forgot(["POST /auth/forgot-password"]) --> ForgotF["misma respuesta siempre\n(no revela si existe)"]
    ForgotF -.-> Flag["marca password_reset_requested_at\n→ cola visible en /admin"]
```

## 2. Panel `/admin` — superadmin y ciclo de vida de empresas (`admin.js`, `internal.js`)

`admin.js` corre en `app1`/`app2`; las operaciones que tocan Docker (crear o borrar la base de una empresa) se delegan al servicio interno `admin-worker`, el único con acceso a `docker.sock`, autenticado con un token compartido.

```mermaid
flowchart TD
    ALogin(["POST /admin/login"]) --> ARL{"Rate limit +\nbloqueo tras 5 intentos\n(igual que el login de app)"}
    ARL -- ok --> APass{"admin_users:\npassword correcta?"}
    APass -- no --> AFail["401 / 429 según intentos"]
    APass -- sí --> ACookie["cookie JWT scope=admin"]
    ACookie --> Panel["Panel /admin"]

    Panel --> List["GET /companies\n+ resets pendientes por empresa"]
    Panel --> New["Alta de empresa"]
    Panel --> Manage["Gestión de una empresa"]

    New --> NVal{"slug / nombre / email\n/ licencias válidos?"}
    NVal -- no --> NVal1["400"]
    NVal -- sí --> NDup{"slug ya\nexiste?"}
    NDup -- sí --> NDup1["409 Ya existe"]
    NDup -- no --> Internal["callInternal → admin-worker\nPOST /internal/companies\n(X-Internal-Token + docker.sock)"]

    Internal --> IRow["INSERT companies\nstatus = provisioning"]
    IRow --> IDocker["docker service create\npg-&lt;slug&gt; (Postgres propio)"]
    IDocker --> IWait["esperar Postgres listo"]
    IWait --> ISchema["ejecutar company_schema.sql\n+ crear admin@slug"]
    ISchema --> IReady["UPDATE companies\nstatus = ready"]
    IReady --> IMail["mail de bienvenida (Brevo)\nsi hay email de contacto"]
    IMail --> ISlack["Slack #app-events:\nempresa creada"]
    ISlack --> ICreds["devuelve credenciales\nal panel /admin"]
    IDocker -. error .-> IErr["UPDATE companies\nstatus = error + mensaje"]

    Manage --> Toggle["PATCH active\nsuspender / reanudar"]
    Manage --> Delete["DELETE → admin-worker\nborra servicio Postgres + fila\nSlack #app-events"]
    Manage --> Users2["Usuarios de la empresa"]
    Users2 --> Reset2["Reset password\n(usuario puntual o admin@slug)\npassword random + mail + Slack"]
```

Los dos paneles comparten el mismo patrón de defensa: límite de intentos por cuenta (5, con bloqueo de 5 min), respuesta idéntica ante cuenta inexistente o password incorrecta (`bcrypt` contra un hash *dummy* para no filtrar tiempos), y un aviso a Slack por cada evento sensible.
