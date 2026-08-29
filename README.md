# EWA Tracker Cloud

Portafolio personal: gestión en la nube del backlog de EarlyWatch Alerts (EWA) de SAP,
construido como vehículo de aprendizaje de IaC, automatización, identidad y administración
de Azure/SAP BTP. Ver `../Roadmap EWA Tracker Cloud.cd` para el plan completo (Fase 1 y Fase 2).

**Estado actual:**

- ✅ **Hito 0** — esqueleto de infraestructura con Terraform, aplicado a mano desde tu máquina.
- ✅ **Hito 1** — CI/CD con GitHub Actions: el mismo `terraform apply`, más el despliegue del
  frontend y una API de prueba, corren automáticamente al hacer merge a `main`.
- ✅ **Hito 2** — identidad básica: todo el sitio (vitrina + API) requiere login, solo entra
  quien tú invites explícitamente — sin gastar un centavo del plan Free.
- ✅ **Hito 3** — modelo de datos: las 4 tablas reales creadas en Azure SQL, con el backlog real
  de Cuprum cargado y verificado (48 items).
- 🔄 **Hito 4 (en progreso)** — API real contra Azure SQL: lectura (`GET /api/items`,
  `GET /api/items/{codigo}`) y actualización (`PATCH /api/items/{codigo}`) con historial de
  cambios en `ActivityLog`. Falta conectar la vitrina a este API (sigue mostrando el HTML
  estático de Hito 0).

## Hito 0 — IaC del esqueleto

Este Hito 0 crea, con Terraform, el esqueleto de infraestructura de la Fase 1:

- Un **Storage Account** que guarda el *state* de Terraform como backend remoto (dentro de tu
  cuota gratuita de 12 meses de Azure).
- Un **Azure Static Web App** (plan Free) para el frontend.
- Un **Azure SQL Database** en el modelo **free offer serverless** (perpetuo) — no el
  DTU-based Standard S0 que también aparece como "gratis" en tu suscripción, ese vence al año.

**La API (Azure Functions) no se crea aquí como recurso aparte.** Usamos el modelo de
*managed functions* de Static Web Apps: pones una carpeta `/api` en el repo, la despliegas vía
GitHub Actions (Hito 1), y el propio servicio de Static Web Apps aprovisiona ese cómputo — sin
que tú crees un App Service Plan ni una Function App independientes, y sin pegarle a la cuota
de VMs de tu suscripción. Un Function App independiente sí cuenta contra esa cuota, y fue
justo lo que chocó con el límite "Total VMs: 0" la primera vez que corrimos este Hito 0 (ver
Troubleshooting). Si más adelante necesitas más control del que dan las managed functions,
ahí se evalúa un Function App independiente ("bring your own functions").

## Por qué dos carpetas (`bootstrap/` y la raíz de `infra/`)

Hay un problema del huevo y la gallina: para usar un backend remoto de Terraform necesitas que
el Storage Account ya exista, pero normalmente ese Storage Account también lo crea Terraform.
La solución estándar es aplicar esa pieza una sola vez con **state local**, y luego apuntar
todo lo demás al backend remoto que acaba de crear:

1. `infra/bootstrap/` — crea el Resource Group + Storage Account + contenedor para el state.
   Se aplica una sola vez, con state local (nunca se vuelve a tocar después).
2. `infra/` (raíz) — crea el Static Web App y el Azure SQL Database. Su state vive en el
   Storage Account que creó el bootstrap.

## Prerrequisitos (en tu máquina)

- [Terraform CLI](https://developer.hashicorp.com/terraform/install) instalado (`terraform -version`).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) instalado y logueado:
  `az login`, luego `az account show` para confirmar que apunta a la suscripción correcta
  (la misma donde ya validaste los servicios gratuitos).
- Si tienes más de una suscripción: `az account set --subscription "<nombre o id>"`.

Terraform usa las credenciales de tu sesión de `az login` automáticamente (proveedor `azurerm`
con autenticación por Azure CLI) — no necesitas crear un Service Principal para este hito.

## Paso 1 — Bootstrap del backend de state

```bash
cd infra/bootstrap
terraform init
terraform apply
```

Revisa el plan antes de confirmar: debe crear únicamente un Resource Group, un Storage Account
y un contenedor de blobs. Al terminar, anota los outputs (`resource_group_name`,
`storage_account_name`, `container_name`) — los necesitas en el paso 2.

## Paso 2 — Backend remoto + recursos de la app

Edita `infra/backend.tf` y reemplaza los tres valores `TODO` con los outputs del paso 1
(o pasa `-backend-config` en el init, ver comentario en el archivo). Luego:

```bash
cd ../         # infra/
terraform init
terraform plan
```

Antes de aplicar, revisa el plan con lupa (es tu primer `apply` real de este proyecto):

- ¿El `azurerm_mssql_database` muestra `sku_name = "GP_S_Gen5_2"` (Serverless)? Eso ya te pone
  sobre el modelo correcto — no el S0 DTU-based. (El *free offer* propiamente dicho se activa
  aparte, ver Paso 3 abajo: el provider `azurerm` todavía no expone esa bandera en Terraform.)
- ¿El Static Web App queda en `sku_tier = "Free"`?

Si todo coincide:

```bash
terraform apply
```

## Paso 3 — Activar el free offer en el SQL Database (fuera de Terraform, por ahora)

Este es un detalle que vale la pena entender, no solo ejecutar: el free offer de Azure SQL se
controla con dos propiedades de la API de Azure (`useFreeLimit` y `freeLimitExhaustionBehavior`),
pero el provider `azurerm` de Terraform todavía no las expone — hay una propuesta abierta y sin
mergear en su repo ([issue #23438](https://github.com/hashicorp/terraform-provider-azurerm/issues/23438),
[PR #32055](https://github.com/hashicorp/terraform-provider-azurerm/pull/32055)) al momento de
escribir esto. Pasa seguido con proveedores de Terraform: la API de la nube avanza más rápido que
la cobertura del provider.

Por ahora, actívalo con un comando de Azure CLI justo después del `apply` (usando los outputs que
Terraform ya te dio):

```bash
terraform output -raw resource_group_name
terraform output -raw sql_server_name
terraform output -raw sql_database_name

az sql db update \
  --resource-group "<resource_group_name>" \
  --server "<sql_server_name>" \
  --name "<sql_database_name>" \
  --use-free-limit \
  --free-limit-exhaustion-behavior AutoPause
```

Dos caminos si más adelante quieres que esto quede 100% en Terraform:

1. **Simple:** dejarlo como un paso manual documentado (lo que hace este README) — es un comando
   que corres una sola vez por base de datos, no algo que cambie seguido.
2. **Más avanzado:** usar el provider [`azapi`](https://registry.terraform.io/providers/Azure/azapi/latest)
   (el provider oficial de Microsoft para llamar directo a la API de Azure Resource Manager, sin
   esperar a que `azurerm` la cubra) con un recurso `azapi_update_resource` apuntando a este mismo
   SQL Database para setear esas dos propiedades. Es el patrón real que se usa en equipos que
   necesitan una feature nueva de Azure antes de que `azurerm` la soporte — buena pieza para
   agregar más adelante si quieres profundizar en IaC, pero no es necesaria para este hito.

## Variables sensibles

`sql_admin_password` no tiene default — Terraform te la va a pedir de forma interactiva, o
puedes definirla como variable de entorno antes de aplicar (recomendado, así no queda en tu
shell history en texto plano dentro de un comando):

```bash
export TF_VAR_sql_admin_password="<una contraseña fuerte>"
```

Nunca subas un `.tfvars` con contraseñas al repo — `.gitignore` ya excluye `*.tfvars` y
`*.auto.tfvars`.

## Verificación de costo (hazlo siempre después de aplicar)

- Portal de Azure → el recurso SQL Database → pestaña "Compute + storage": debe decir
  "Serverless" y mostrar el free offer activo, no "S0".
- Cost Management + Billing → confirma que el costo acumulado del día sigue en $0.
- Marca el checklist correspondiente en el roadmap.

## Troubleshooting

**"ProvisioningDisabled... Provisioning is restricted in this region" (SQL Server), en más
de una región.**

Si te pasa en una sola región, prueba otra con `-var="compute_location=..."` (ver abajo). Pero
si te pasa igual en dos o más regiones distintas (como aquí: falló idéntico en `eastus2` y en
`eastus`), no es un tema de qué región elegiste — es la cuota de **"Region access"** de Azure
SQL, que se otorga por separado en cada suscripción nueva y, en una suscripción recién pasada a
Pay-As-You-Go, puede no estar habilitada en ninguna región todavía. Cambiar de región a ciegas
no lo arregla; hay que pedirla:

1. Portal de Azure → `Ayuda + soporte técnico` → `Crear una solicitud de soporte técnico`.
2. Busca "quota" → servicio: `Ninguna de las anteriores` → `Service and subscription limits (quotas)`.
3. Selecciona tu suscripción → Siguiente → Tipo de problema: `SQL Database` → `Crear una solicitud de soporte`.
4. En "Detalles de cuota": **Quota type = Region access**, **Location** = la región que quieras
   usar, **Expected Consumption** = 1 vCore.
5. Completa y envía. Es gratis, típicamente se resuelve en 24-48h.

Mientras se resuelve, el resto del proyecto no está bloqueado — Resource Group, Storage Account
y Static Web App no dependen de esta cuota y ya quedaron creados. `terraform apply` va a seguir
fallando solo en el SQL Server hasta que Azure apruebe la cuota; es esperado, no hace falta
seguir diagnosticándolo cada vez.

**"Operation cannot be completed without additional quota" (App Service Plan / Total VMs: 0).**

Pasó en la primera corrida de este proyecto, justo después de pasar la suscripción a
Pay-As-You-Go: bloqueo temporal antifraude de Azure sobre suscripciones nuevas o recién
cambiadas a pago (cuota de cómputo en 0 hasta que la cuenta "madura", a veces 24-48h). Probamos
cambiar de región y el error persistió — es decir, no era cosa de la región, era la suscripción
completa. La solución real fue quitar el Function App independiente de este hito por completo
(ver la explicación arriba, sección de managed functions): sin App Service Plan propio, no hay
nada que choque contra esa cuota. Si en un hito futuro vuelves a necesitar un Function App
independiente y te topas con esto otra vez, las opciones son: (a) probar otra región con
`-var="compute_location=..."`, (b) abrir un ticket gratuito de soporte en el portal de Azure con
tipo de problema "Service and subscription limits (quotas)" pidiendo aumentar "Total Regional
vCPUs", o (c) simplemente esperar a que la cuenta madure.

**"InvalidResourceLocation: ... already exists in location 'X' ... cannot be created in
location 'Y'" (SQL Server).**

Si un `apply` anterior falló durante el SQL Server (por ejemplo con `ProvisioningDisabled`,
como pasó aquí en `eastus2`), a veces Azure ya alcanzó a reservar el **nombre** del recurso
antes de que la creación terminara de fallar. Ojo: eso no significa que el recurso vaya a
aparecer en el Resource Group — los nombres de SQL Server son únicos a nivel global (como los
de Storage Account), y la reserva puede quedar "colgada" sin que el objeto llegue a existir de
forma visible en ningún lado del Portal. Buscarlo ahí para borrarlo no funciona; si te vuelve a
pasar, lo más simple es usar un nombre nuevo en vez de pelear por liberar el anterior.

## Cómo terminamos creando el SQL Server (y cómo se importó a Terraform)

En esta primera corrida, ni `eastus2` ni `eastus` tenían la cuota "Region access" habilitada
para esta suscripción — confirmado tanto por `terraform apply` como, más rápido, por el propio
asistente de creación en el Portal (el desplegable de región valida al instante, sin tener que
enviar nada). **West US 2 sí tuvo acceso.** Como además el Portal deja aplicar el free offer
con un botón ("Apply offer") sin pelearse con los argumentos que `azurerm` todavía no soporta
(ver arriba), terminamos creando el SQL Server y la base **a mano desde el Portal** en lugar de
con `terraform apply` — y luego los "adoptamos" en el state de Terraform con `terraform import`,
para que de aquí en adelante sigan bajo control de IaC como el resto del proyecto.

Por eso `main.tf` tiene el nombre del servidor (`sql-ewatracker-portal01`), la región
(`westus2`, ahora el default de `compute_location`) y el nombre de la regla de firewall
(`AllowAllWindowsAzureIps`, el que Azure le pone automáticamente al activar "Permitir que los
servicios de Azure accedan a este servidor" desde el Portal) escritos tal cual coinciden con lo
que ya existe — si no coincidieran, Terraform intentaría destruir y recrear el recurso al
importar o en el siguiente `apply`.

Para importarlos (ajusta el ID de suscripción y los nombres si los tuyos son distintos):

```bash
terraform import azurerm_mssql_server.sql \
  "/subscriptions/<tu-subscription-id>/resourceGroups/rg-ewatracker-app/providers/Microsoft.Sql/servers/sql-ewatracker-portal01"

terraform import azurerm_mssql_firewall_rule.allow_azure_services \
  "/subscriptions/<tu-subscription-id>/resourceGroups/rg-ewatracker-app/providers/Microsoft.Sql/servers/sql-ewatracker-portal01/firewallRules/AllowAllWindowsAzureIps"

terraform import azurerm_mssql_database.sql \
  "/subscriptions/<tu-subscription-id>/resourceGroups/rg-ewatracker-app/providers/Microsoft.Sql/servers/sql-ewatracker-portal01/databases/sqldb-ewatracker"
```

Después de importar, corre `terraform plan` y revísalo con cuidado antes de aplicar nada:

- Es normal ver ruido alrededor de `administrator_login_password` — Azure no expone la
  contraseña de vuelta por API, así que Terraform no sabe si coincide con `var.sql_admin_password`.
  **Antes de correr `terraform apply` después de importar, exporta la variable con la MISMA
  contraseña que pusiste en el Portal** (`export TF_VAR_sql_admin_password="..."`), para que no
  intente cambiártela por accidente.
- Si aparece algo marcado como "forces replacement" (recrear en vez de actualizar) en `name`,
  `location` o `administrator_login`, detente y pégame el plan antes de aplicar — significa que
  algo no quedó exactamente igual a lo que existe en Azure.
- Otros campos (como `min_capacity` o `auto_pause_delay_in_minutes`) sí se pueden actualizar sin
  recrear nada, así que si el plan solo muestra cambios ahí, no hay riesgo en aplicarlos.

## Hito 1 — CI/CD con GitHub Actions

Este scaffold del Hito 0 estaba pensado para que tú corrieras `terraform apply` a mano, con tu
propia suscripción y tus propias credenciales. El Hito 1 mueve eso a dos workflows de GitHub
Actions, para que la infraestructura y el código se desplieguen solos al hacer merge a `main` —
sin que nadie tenga que ejecutar nada desde su máquina.

### Autenticación: OIDC federado (sin secretos guardados)

En vez de crear un Service Principal con un secreto de larga duración guardado como GitHub
Secret (la opción más común, pero también la que más riesgo carga si se filtra), este proyecto
usa **OIDC federado**: Azure AD confía en un token de identidad que GitHub emite automáticamente
en cada corrida del workflow, sin que ningún secreto viva guardado en ningún lado.

Piezas que se crearon una sola vez (fuera de Terraform, con Azure CLI):

1. Un **App Registration / Service Principal** dedicado a este proyecto (no tu cuenta personal).
2. **Roles RBAC acotados** para ese Service Principal — `Contributor` sobre los resource groups
   específicos del proyecto (no sobre toda la suscripción) — y además, por la razón que se
   explica más abajo, `Storage Blob Data Contributor` sobre el Storage Account del state.
3. Dos **credenciales federadas** (`az ad app federated-credential create`), una por cada
   "sujeto" que necesita confiar: una para el branch `main` (dispara el `apply`) y otra para
   `pull_request` (dispara el `plan`).

En GitHub, solo quedan como **Secrets** los identificadores (no son secretos en el sentido
tradicional, son públicos por diseño de OIDC, pero igual conviene no hardcodearlos en el
workflow): `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. A eso se suman dos
secretos que sí son sensibles de verdad: `SQL_ADMIN_PASSWORD` (la contraseña del SQL Server que
ya existe) y `AZURE_STATIC_WEB_APPS_API_TOKEN` (el token de despliegue del Static Web App —
equivalente a una contraseña de publicación, se obtiene con
`terraform output -raw static_web_app_api_key`).

### Workflow 1 — `terraform.yml`: infraestructura (GitOps)

Dispara con cambios en `infra/**`:

- **Pull request** → `terraform plan` y comenta el resultado directamente en el PR (vía
  `actions/github-script`), para revisarlo con calma antes de aprobar el merge — el mismo hábito
  de "revisa el plan con lupa" del Hito 0, ahora automático.
- **Push a `main`** (o sea, cuando se mergea el PR) → `terraform apply` con el plan ya revisado.

Un detalle de diseño que vale la pena entender: el paso de `plan` usa `continue-on-error: true`
para que, aunque el plan falle, el workflow siga hasta el paso que publica el comentario en el
PR — así siempre ves el motivo del fallo ahí, no solo un check en rojo sin contexto. Justo
después hay un paso que revisa `steps.plan.outcome` y detiene el job con `exit 1` si falló, para
que un plan roto nunca llegue a la etapa de `apply`.

### Workflow 2 — `swa-deploy.yml`: frontend + API

Dispara con cambios en `web/**` o `api/**`:

- **Push a `main`** → construye y despliega el frontend y la API juntos a producción, con la
  acción oficial `Azure/static-web-apps-deploy@v1` (`app_location: "web"`,
  `api_location: "api"`).
- **Pull request abierto/actualizado** → Azure crea automáticamente un **entorno de vista
  previa** (una URL aparte, para probar los cambios antes de mergear).
- **Pull request cerrado** → un segundo job (`close_pull_request_job`) le avisa a Azure que
  destruya ese entorno de vista previa. Importante: este job es el que aparece en los checks del
  PR al momento de mergear — **no** es el que despliega a producción; el despliegue real ocurre
  en la corrida disparada por el push a `main` que el propio merge genera.

La API vive en `/api` como una Azure Function (Node.js/TypeScript, modelo de programación v4):
`host.json` fija el `routePrefix` en `"api"`, y `.funcignore` excluye el código fuente `.ts` del
paquete final (solo se despliega lo compilado en `dist/`). Localmente se prueba con:

```bash
cd api
npm install
npm run build   # compila TypeScript a dist/, sin desplegar nada
```

### RBAC: por qué no basta con "Contributor"

`backend.tf` usa `use_azuread_auth = true` para que el acceso al state de Terraform se controle
con roles de Azure AD en vez de la clave del Storage Account. Eso trae una distinción importante
de Azure que vale la pena tener clara: **`Contributor` es un rol de plano de control** (crear,
modificar, borrar el recurso Storage Account en sí) **pero no otorga acceso al plano de datos**
(leer o escribir los blobs que hay dentro). Para eso hace falta el rol
`Storage Blob Data Contributor`, asignado aparte — y esto aplica por igual al Service Principal
de CI *y* a tu propia cuenta personal cuando corres Terraform desde tu máquina, aunque seas el
dueño de la suscripción.

### Verificación (no te quedes solo con el check verde)

El mismo hábito de este proyecto: un ✔️ en GitHub confirma que un *paso* corrió sin error, no
necesariamente que el resultado es el esperado. Antes de dar un despliegue por bueno:

1. Revisa el log del paso relevante (no solo el ícono), especialmente el que corre la acción de
   despliegue.
2. Prueba el resultado real — por ejemplo, visita `https://<tu-static-web-app>.azurestaticapps.net/api/hello`
   y confirma que responde el JSON esperado, no solo que el workflow terminó en verde.

### Troubleshooting

**"AADSTS700213: No matching federated identity record found for presented assertion..." en la
primera corrida del workflow.**

A partir del 15 de julio de 2026, GitHub cambió el formato de los "subject claims" de OIDC para
repos nuevos: ahora son **inmutables** e incluyen los IDs numéricos del owner y del repo
(`repo:owner@ownerId/repo@repoId:ref...`), no solo los nombres como antes. Si configuraste la
credencial federada con el formato viejo (`repo:owner/repo:ref...`), Azure AD no encuentra
coincidencia. **Fix:** actualizar las credenciales federadas con el subject correcto —
`az ad app federated-credential update`, incluyendo el `ownerId` y `repoId` de tu repo (los
puedes confirmar en la respuesta de `gh api repos/<owner>/<repo>` o en el propio mensaje de
error, que los expone).

**"Error: No value for required variable - sql_admin_password" en el paso `terraform plan` de
CI, aunque localmente funciona.**

Localmente, `TF_VAR_sql_admin_password` vive como variable de entorno en tu sesión de
PowerShell — el runner de GitHub Actions no la tiene. **Fix:** agregar la contraseña como GitHub
Secret (`SQL_ADMIN_PASSWORD`, con el mismo valor que ya está en el SQL Server real) y mapearla en
el workflow con `TF_VAR_sql_admin_password: ${{ secrets.SQL_ADMIN_PASSWORD }}`.

**"Backend initialization required... Backend configuration block has changed" y luego
`403 AuthorizationPermissionMismatch`, al correr Terraform en tu máquina después de este hito.**

Editar `backend.tf` para agregar `use_azuread_auth = true` deja desactualizada la caché local de
`.terraform/`. **Fix parte 1:** `terraform init -reconfigure` (seguro — solo refresca la
configuración de conexión al backend, no mueve ni toca el state). Eso destapa el problema real:
tu cuenta personal, igual que el Service Principal de CI, necesita el rol
`Storage Blob Data Contributor` sobre el Storage Account del state (ver sección de RBAC arriba).
**Fix parte 2:** asignarte ese rol con `az role assignment create`, esperar ~1 minuto a que
propague, y reintentar.

## Hito 2 — Identidad básica: login con Microsoft Entra ID

Con el Hito 1 cerrado, el sitio se desplegaba solo pero seguía completamente abierto — cualquiera
con la URL podía ver la vitrina y llamar a `/api/hello`. Este hito le pone una puerta: solo
entra quien tú invites explícitamente.

### Dos caminos, y por qué elegimos el gratuito

Static Web Apps ofrece dos formas de manejar login:

1. **Autenticación personalizada** — registras tu propia app en Microsoft Entra ID (con su
   propio Client ID y secreto) y Static Web Apps valida contra ese registro específico. Es el
   camino "de manual de empresa", más parecido a un SSO corporativo real.
2. **Proveedores integrados** (`azureActiveDirectory` o `github`, sin registro propio) +
   **Role management por invitación** — usas el login genérico de Microsoft o GitHub que
   Static Web Apps ya trae, y restringes el acceso invitando explícitamente a cuentas
   específicas con un rol personalizado.

La sorpresa real de este hito: **la autenticación personalizada (opción 1) solo está disponible
en el plan Standard** (~$9 USD/mes por app) — el plan Free, que hemos cuidado desde el Hito 0,
no la soporta. Elegimos la opción 2 para quedarnos en $0, sin perder la protección real.

Sí llegamos a crear un App Registration propio (`ewa-tracker-login`, con su Client ID y secreto
guardados como Application Settings del Static Web App) antes de toparnos con esta limitación.
Lo dejamos ahí sin usar — no cuesta nada tenerlo, y si algún día se sube al plan Standard, se
reactiva sin rehacer nada.

### Cómo quedó configurado (plan Free)

`web/staticwebapp.config.json`:

```json
{
  "routes": [
    { "route": "/*", "allowedRoles": ["colaborador"] }
  ],
  "responseOverrides": {
    "401": { "redirect": "/.auth/login/aad", "statusCode": 302 }
  }
}
```

- `"route": "/*"` protege **todo** el sitio, no solo la API — se decidió así porque el backlog
  de EWA de Cuprum se considera información interna, no una pieza para mostrar públicamente tal
  cual.
- El rol es `colaborador`, no el genérico `"authenticated"` — con `"authenticated"` cualquier
  cuenta de Microsoft del mundo entraría con solo loguearse. Con un rol propio, solo entra quien
  aparece invitado en **Role management** (Azure Portal → el recurso → Configuración →
  Administración de roles), con ese rol exacto asignado.
- Un visitante sin sesión llega primero a un 401, que la regla de `responseOverrides` redirige
  al login de Microsoft (`/.auth/login/aad`, el proveedor integrado y gratuito). Si inicia
  sesión pero su cuenta no tiene el rol `colaborador`, Static Web Apps lo bloquea con un 403 —
  verificado en vivo con una segunda cuenta de Microsoft sin invitar.

### Troubleshooting

**"The 'auth' configuration in staticwebapp.config.json is only supported on the Standard SKU.
This Static Web App is not on the Standard SKU." al desplegar.**

Pasa si el `staticwebapp.config.json` incluye un bloque `auth.identityProviders` (autenticación
personalizada) en un Static Web App del plan Free. **Fix:** quitar el bloque `auth` por completo
y usar en su lugar el proveedor integrado (`/.auth/login/aad`) más Role management por
invitación, como se describe arriba — sin tocar el plan de precio.

## Hito 3 — Modelo de datos

Hasta aquí, los datos de la vitrina estaban escritos directo en el HTML — una foto fija, no una
fuente de verdad real. Este hito crea el esquema real en Azure SQL y carga ahí el backlog
verdadero de Cuprum (`Cuprum_PS4_EWA_Backlog.xlsx`) como datos semilla.

### El esquema (`db/schema.sql`)

Cuatro tablas, pensadas para servir tanto al MVP actual como a las gráficas de avance que
vienen más adelante (Hito 6):

- **Sistemas** — para que el tracker crezca a más de un sistema del landscape, no solo `PS4`.
- **EWAs** — un registro por cada reporte EWA incorporado (equivalente a tu hoja "EWAs
  procesados").
- **Items** — el backlog en sí (equivalente a tu hoja "Backlog EWA"), con `categoria` y
  `prioridad` restringidos por `CHECK` a los valores reales que usa el proceso, y `estado` con
  un `CHECK` de cinco valores (`Pendiente`, `En progreso`, `Finalizado`, `Bloqueado`,
  `Cancelado`) y default `'Pendiente'`.
- **ActivityLog** — arranca vacía a propósito; se llena sola a partir del Hito 4, cuando exista
  edición real de items. Una fila por cada cambio de campo da el histórico por item *y*, en el
  momento de consulta, la materia prima para las gráficas por mes — sin tabla de resúmenes
  aparte que haya que recalcular.

El DDL se aplicó a mano, una sola vez, desde el **Query Editor del propio Portal de Azure**
(sin instalar nada) — no es parte del pipeline de CI/CD, es una migración inicial de esquema.

### La carga de datos (`db/import-seed.ts`)

Un script de TypeScript (independiente de `/api` y `/web`, con su propio `package.json`) que lee
el Excel real con la librería `xlsx` y hace `INSERT` directo contra Azure SQL con `mssql` —
también corrido a mano, una sola vez, no en cada despliegue.

**Un error real en la primera corrida:** la hoja "EWAs procesados" trae, además de la fila real
(`EWA-01`), una fila en blanco y una fila de instrucciones con texto largo en la columna "ID
EWA" (algo como "Agregar una fila por cada nuevo EWA que se incorpore..."). El primer filtro del
script solo revisaba que esa columna no viniera vacía, así que coló esa fila de instrucciones
como si fuera un EWA real — y como su texto mide más de 140 caracteres contra una columna
`VARCHAR(20)`, el driver de SQL truena a medio insertar. **Fix:** filtro más estricto, que exige
que "ID EWA" tenga el formato real (`EWA-01`, `EWA-02`, ...) *y* que la fila traiga un Sistema.
Antes de reintentar, se limpiaron a mano (con `DELETE`) las filas basura que alcanzaron a
insertarse — gracias a los `UNIQUE` del esquema, un reintento a ciegas sin limpiar habría
fallado con un error de llave duplicada en vez de duplicar datos silenciosamente.

### Verificación

No basta con que el script termine sin error — se verificó contra los números reales del propio
Excel: `SELECT categoria, prioridad, COUNT(*) ... GROUP BY categoria, prioridad` dio 48 items en
total, con los mismos conteos por categoría y prioridad que la hoja "Resumen" del Excel (por
ejemplo, `Basis`: 13 items, 6 Alta / 5 Media / 2 Baja — exacto).

## Hito 4 (en progreso) — API de lectura y actualización

Con el Hito 3 cerrado había datos reales en Azure SQL, pero nada que los sirviera todavía.
Este hito construye el API que la vitrina va a consumir — por ahora, solo el API; la vitrina en
sí sigue pendiente (ver "Después de este hito").

### Alcance: lectura + actualización, sin crear ni borrar desde la UI

A diferencia de un CRUD completo, este hito se acotó a **Read + Update**: la vitrina va a poder
listar, filtrar, ver el detalle y editar `estado` / `notas_seguimiento` / `fecha_compromiso` de
un item — pero no crear ni borrar items desde ahí. Los items nacen del proceso de carga del
Hito 3 (`db/import-seed.ts`, a partir del Excel real de cada EWA), no de la vitrina.

### Managed functions + contraseña SQL, en vez de Managed Identity

Antes de escribir el primer endpoint se investigó si las *managed functions* de Static Web Apps
(el mismo modelo del Hito 0/1, sin Function App independiente) soportan **Managed Identity**
para conectarse a Azure SQL sin guardar contraseña en ningún lado. La respuesta, confirmada
contra la [documentación oficial de Microsoft](https://learn.microsoft.com/azure/static-web-apps/apis-functions)
y un [issue de GitHub todavía abierto desde 2020](https://github.com/Azure/static-web-apps/issues/88):
**no la soportan** — ni system- ni user-assigned. Tampoco Key Vault references ni Durable
Functions; solo triggers HTTP.

La alternativa ("bring your own functions", un Function App independiente) sí soporta Managed
Identity, pero es la misma pieza de infraestructura que causó el bloqueo de cuota de VMs en el
Hito 0 (ver Troubleshooting de ese hito). Para no arriesgarse a repetir ese problema por una
mejora de seguridad que no es indispensable en un proyecto de portafolio, se optó por **seguir
con managed functions**, conectándose con el usuario `ewaadmin` + una contraseña guardada como
Application Setting (`SQL_ADMIN_PASSWORD`, nunca en el código ni en el repo) — el mismo patrón
de secretos ya usado desde el Hito 1.

### `api/src/db.ts` — el pool de conexión

Un singleton a nivel de módulo: la primera invocación de cualquier endpoint crea el
`sql.ConnectionPool` y las siguientes, mientras la instancia de la Function siga "caliente", lo
reutilizan — abrir una conexión nueva en cada request sería lento y, bajo carga, agotaría las
conexiones que la base serverless permite.

### `GET /api/items` y `GET /api/items/{codigo}`

- `items-list.ts` — lista con filtros opcionales por query string (`?categoria=&estado=&prioridad=`),
  parametrizados con `.input()` (nunca concatenación de strings), ordenada por prioridad y luego
  código.
- `items-detail.ts` — trae un item por `codigo_item`, con un `JOIN` a `EWAs` para incluir
  `codigo_ewa`/`fecha_desde`/`fecha_hasta`, más los campos de texto largo que la lista omite a
  propósito (`evidencia`, `actividad_propuesta`, `notas_seguimiento`). 404 si el código no existe.

Ambos con `authLevel: "anonymous"` — la protección real ya la da `staticwebapp.config.json`
desde el Hito 2 (todo `/api/*` exige el rol `colaborador` antes de que la petición llegue aquí).

### `PATCH /api/items/{codigo}` — la actualización

`items-update.ts` acepta un body JSON parcial con cualquier combinación de `estado`,
`notas_seguimiento` y `fecha_compromiso` (whitelist fija de columnas editables — nunca se arma
SQL con nombres de campo que vengan del body). `estado` se valida contra los 5 valores del
`CHECK` del esquema. Todo corre dentro de una transacción SQL:

1. Lee los valores actuales del item (404 si no existe).
2. Por cada campo que de verdad cambió de valor (comparado contra lo que ya había), arma el
   `UPDATE` y prepara una fila de log — si el valor enviado es igual al que ya tenía, no genera
   ni `UPDATE` ni log, para no ensuciar el historial con "cambios" que no cambiaron nada.
3. Inserta una fila en `ActivityLog` **por cada campo realmente cambiado** (no una fila por
   request), con el usuario que hizo el cambio — leído del header `x-ms-client-principal` que
   Static Web Apps agrega automáticamente a cada request ya autenticada por el login del Hito 2 —
   y el valor anterior/nuevo de ese campo puntual.
4. Hace `commit` y devuelve el item ya actualizado.

Verificado en vivo: tras varios `PATCH` de prueba sobre `BAS-01` (cambiando `estado` y
`notas_seguimiento`, incluyendo mandar `null`), una consulta a `ActivityLog` mostró una fila por
cada cambio real, con `usuario` igual a la cuenta de Microsoft invitada de verdad (no
"desconocido"), y los valores anterior/nuevo correctos.

### Bug real encontrado y corregido: timeout de conexión contra la base serverless

Al probar `GET /api/items` por primera vez (en el entorno de vista previa del PR), la respuesta
fue un 500 sin cuerpo. El log de Application Insights (habilitado en este hito, con su capa
gratuita) mostró el error real:

```
ConnectionError: Failed to connect to sql-ewatracker-portal01.database.windows.net:1433 in 15000ms
```

Azure SQL serverless, si lleva un rato sin uso, se pausa — y Microsoft documenta que puede
tardar hasta ~60 segundos en "despertar" con la siguiente conexión. El valor por defecto de la
librería `mssql`/`tedious` para `connectionTimeout` (15 segundos) no alcanzaba para ese caso.
**Fix en `db.ts`:** subir `connectionTimeout` y `requestTimeout` a 60000 ms. De paso, se corrigió
un problema relacionado: el `poolPromise` (el singleton del pool) se guardaba en una variable de
módulo aunque la conexión fallara, dejando esa promesa rechazada cacheada para siempre mientras
la instancia de la Function siguiera caliente — se agregó un `.catch()` que la resetea a `null`
para que el siguiente request pueda reintentar limpio.

Un efecto secundario observado al probar el fix: en un intento, el navegador recibió
`"Backend call failure"` (un error genérico del *gateway* de Static Web Apps, no un 500 con
detalle) — pero una consulta posterior mostró que el `PATCH` sí se había aplicado del lado del
servidor. Lección: un timeout del lado del cliente no garantiza que el servidor no haya
terminado el trabajo: el gateway se cansó de esperar la respuesta, no la conexión SQL en sí.

### Verificación

Como el navegador no puede mandar `PATCH` desde la barra de direcciones, se probó con `fetch()`
desde la consola de DevTools (aprovechando que el navegador ya trae la sesión autenticada del
Hito 2, sin manejar tokens a mano):

```js
fetch('/api/items/BAS-01', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ estado: 'En progreso', notas_seguimiento: 'texto de prueba' })
}).then(r => r.json()).then(console.log)
```

Confirmado en preview y en producción: `GET`/`PATCH` devuelven datos reales, y `ActivityLog`
registra cada cambio con el usuario correcto. Los datos de prueba se revirtieron a su estado
original (`Pendiente`, notas en `null`) al terminar, para no dejar basura en el backlog real.

## Después de este hito

El API de Hito 4 (lectura + actualización) ya está en producción y verificado, pero la vitrina
todavía no lo consume — sigue mostrando el HTML estático del Hito 0. Lo que falta para cerrar
Hito 4 del todo: reescribir la vitrina para que llame a estos endpoints (lista filtrable por
categoría/estado/prioridad, vista de detalle por item, edición de estado/notas). Después de eso,
la puerta queda abierta para Hito 5 en adelante (por ejemplo, gráficas de avance por mes usando
`ActivityLog` como fuente).
