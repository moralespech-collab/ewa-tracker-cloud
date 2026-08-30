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
- ✅ **Hito 4** — API real contra Azure SQL (lectura, actualización, historial de cambios en
  `ActivityLog`) y la vitrina ya conectada a él: panorama, filtros, buscador y edición
  (estado, persona responsable, notas, fecha de compromiso) todos con datos reales.
- ✅ **Hito 5** — gráficas y reportes de actividad: `ActivityLog` ahora se ve, no solo se guarda.
  Gráfica de actividad por mes/categoría, informe mensual con el detalle campo por campo de cada
  item, y dos bugs reales de la vitrina encontrados y corregidos en el camino.
- ✅ **Hito 6** — panel de navegación: la vitrina se reorganiza en dos páginas (Vitrina / Reporteo)
  dentro de la misma app, sin recargar, más filtros de categoría/item en el informe.
- ✅ **Hito 7** — notas de seguimiento como bitácora (tabla `NotasSeguimiento`, ya no un campo que
  se sobreescribe) y máquina de estados sobre `Items.estado` (Pendiente es irreversible una vez que
  se sale de ahí; Cancelado/Finalizado quedan terminales). El informe mensual se rediseñó como
  "Avance de items": una foto del estado actual de cada item en seguimiento, no un log por mes.
- ✅ **Hito 8** — `ejecutor` y `dueno_seguimiento` resultaron ser el mismo concepto en la práctica;
  se fusionaron en un solo campo editable (`dueno_seguimiento`), con migración de datos para no
  perder las asignaciones que venían del Excel original.
- ✅ **Hito 9** — botón "Descargar CSV" en la vitrina: exporta el backlog (respetando los filtros
  activos) tal como se ve en pantalla, sin necesidad de un endpoint nuevo.
- ⏭️ Próximo: por definir (candidatos: exportar "Avance de items" a documento, autorización por
  persona responsable, ingesta de reportes EWA semanales, deduplicación de items repetidos).

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

## Hito 4 — API real + vitrina conectada

Con el Hito 3 cerrado había datos reales en Azure SQL, pero nada que los sirviera todavía. Este
hito construye el API y reescribe la vitrina para que lo consuma — de HTML estático con datos
embebidos a una app que lee y escribe contra la base de datos real.

### Alcance: lectura + actualización, sin crear ni borrar desde la UI

A diferencia de un CRUD completo, este hito se acotó a **Read + Update**: la vitrina lista,
filtra, muestra el detalle y edita `estado` / `dueno_seguimiento` (persona responsable) /
`notas_seguimiento` / `fecha_compromiso` de un item — pero no crea ni borra items desde ahí. Los
items nacen del proceso de carga del Hito 3 (`db/import-seed.ts`, a partir del Excel real de cada
EWA), no de la vitrina.

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
  código. Incluye `sistema` (`JOIN` hasta `Sistemas`) para que el tile "Sistema" del panorama sea
  dato real, no algo fijo en el HTML.
- `items-detail.ts` — trae un item por `codigo_item`, con un `JOIN` a `EWAs` para incluir
  `codigo_ewa`/`fecha_desde`/`fecha_hasta`, más los campos de texto largo que la lista omite a
  propósito (`evidencia`, `actividad_propuesta`, `notas_seguimiento`). 404 si el código no existe.

Ambos con `authLevel: "anonymous"` — la protección real ya la da `staticwebapp.config.json`
desde el Hito 2 (todo `/api/*` exige el rol `colaborador` antes de que la petición llegue aquí).

### `PATCH /api/items/{codigo}` — la actualización

`items-update.ts` acepta un body JSON parcial con cualquier combinación de `estado`,
`dueno_seguimiento`, `notas_seguimiento` y `fecha_compromiso` (whitelist fija de columnas
editables — nunca se arma SQL con nombres de campo que vengan del body). `estado` se valida
contra los 5 valores del `CHECK` del esquema. Todo corre dentro de una transacción SQL:

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

### "Persona responsable": reusar `dueno_seguimiento`, no una columna nueva

Al usar la vitrina por primera vez con datos reales, surgió la necesidad de poder asignar quién
da seguimiento a cada item. En vez de agregar una columna nueva, se aprovechó que el esquema ya
tenía `dueno_seguimiento` — poblado desde el Excel del Hito 3 pero hasta entonces de solo
lectura, y con varios items ya trayendo literalmente `"(por asignar)"` como valor. Se agregó a la
whitelist de campos editables del `PATCH`, con su propio registro en `ActivityLog` cuando cambia.

Pensado a futuro (no en este hito): la persona responsable eventualmente necesitará su propia
cuenta de Microsoft con el rol `colaborador`, y la autorización debería restringirse a que cada
quien solo pueda editar los items que tiene asignados. Por ahora `dueno_seguimiento` es texto
libre, sin ligarlo todavía a una cuenta real ni restringir quién puede editar qué — es
simplemente una forma de dejar registrado que un item ya tiene dueño.

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

### Verificación del API (vía DevTools)

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

### La vitrina (`web/index.html`) — de HTML estático a app conectada

Reescrita para consumir el API en vez de traer los datos embebidos:

- **Carga inicial:** `fetch('/api/items')` al abrir la página, con un mensaje de "Cargando…" que
  avisa que el primer request puede tardar si la base de datos estaba dormida (mismo fenómeno del
  bug de timeout, explicado del lado del usuario en vez de solo del código).
- **Detalle bajo demanda (*lazy*):** `GET /api/items` no trae `evidencia`/`actividad_propuesta` a
  propósito, así que la primera vez que se abre el detalle de una fila se hace un segundo
  `fetch` puntual a `GET /api/items/{codigo}` — una sola vez por item, con el resultado cacheado
  en memoria (`DETAIL_CACHE`) para no repetirlo si se cierra y se vuelve a abrir la misma fila.
- **Edición real:** el detalle expandido trae un formulario (estado, persona responsable, notas,
  fecha de compromiso) con un botón "Guardar cambios" que manda el `PATCH`. Al guardar, se
  actualiza tanto esa fila como los stat tiles, el gráfico por categoría y los tiles de prioridad
  — por si el cambio afecta esos totales (por ejemplo, marcar como "Finalizado" un item de
  prioridad Alta).
- **Bug propio detectado y corregido antes de mergear:** si el usuario guardaba sin cambios
  reales, `items-update.ts` responde solo con un mensaje (sin los campos del item, ver arriba) —
  el primer borrador del código de la vitrina intentaba leer `estado`/`fecha_compromiso` de esa
  respuesta igual, lo que habría sobrescrito esos valores en pantalla con `undefined`. Se corrigió
  antes de desplegarlo, chequeando explícitamente si la respuesta trae un item real.

Verificado en vivo (preview y producción): carga del panorama con los 48 items reales, filtros y
buscador (incluyendo búsqueda por persona responsable), apertura de detalle con carga diferida, y
guardado de cambios reflejado de inmediato en pantalla.

## Hito 5 — Gráficas y reportes de actividad (`ActivityLog`)

Con Hito 4 cerrado, `ActivityLog` ya llevaba varios cambios reales guardados (incluida la
asignación real de Roberto Ortiz a `ABAP-11`), pero esa información solo era consultable a mano
en el Query Editor del Portal. Este hito la pone a la vista, en dos formas distintas: una gráfica
agregada y un informe mensual con el detalle por item.

### Decisiones antes de escribir código

Dos preguntas abiertas se resolvieron antes de tocar el API:

- **Qué métrica graficar.** Se consideraron "items finalizados por mes" contra "actividad por
  mes/categoría" (cualquier cambio de campo, no solo llegar a `Finalizado`). Se eligió la segunda:
  con tan pocos items reales todavía, contar solo finalizaciones habría dado una gráfica casi vacía
  por meses.
- **Limpiar los datos de prueba de `ActivityLog` antes de graficar.** Al revisar las 8 filas que
  había (`javiermp2002@hotmail.com` y pruebas de PATCH de sesiones anteriores, mezcladas con la
  asignación real de Roberto Ortiz), se decidió borrar la tabla completa —**incluida la fila
  real**— para arrancar la gráfica desde cero y no tener que distinguir a mano cuáles filas eran
  reales: `DELETE FROM ActivityLog;`. La asignación vigente de Roberto Ortiz en
  `Items.dueno_seguimiento` no se tocó — el borrado es solo del historial, no del estado actual.

### `GET /api/activity-summary` — la gráfica

`activity-summary.ts` agrega `ActivityLog` (unido a `Items` por `categoria`) agrupado por mes y
categoría, contando cualquier cambio de campo:

```sql
SELECT FORMAT(al.[timestamp], 'yyyy-MM') AS mes, i.categoria, COUNT(*) AS cantidad
FROM ActivityLog al
JOIN Items i ON i.id = al.item_id
GROUP BY FORMAT(al.[timestamp], 'yyyy-MM'), i.categoria
ORDER BY mes, i.categoria
```

La vitrina arma con esas filas planas una barra apilada por mes (SVG a mano, sin librería —
mismo criterio que el resto de la vitrina), siguiendo el skill de dataviz del proyecto: paleta de
categoría validada con su script de checks (pasa en modo claro y oscuro; 3 de los 6 colores dan
un `WARN` de contraste contra el fondo, lo que obliga a no depender solo del color — de ahí que la
gráfica siempre traiga leyenda, tooltip al pasar el mouse/foco, y un botón "Ver como tabla" que
muestra los mismos datos en texto), segmentos con 2px de separación y esquinas redondeadas solo en
el tope de cada barra, y el total del mes como única etiqueta directa.

### Dos bugs reales de la vitrina, encontrados al probar la gráfica

Ninguno de los dos es nuevo de este hito — ya estaban en la vitrina desde el Hito 4 — pero salieron
a la luz al reutilizar el color de categoría para la gráfica nueva:

1. **`light-dark()` de CSS no se resolvía en el navegador del usuario.** El color de cada barra se
   fijaba con `background: light-dark(#2a78d6, #3987e5)` directo en el `style` del elemento. En
   algunos navegadores/webviews esa función CSS no se reconoce, y el navegador descarta toda la
   declaración como inválida — el elemento se queda sin fondo (transparente), sin ningún aviso
   visible. Afectaba las barras de "Por categoría", el punto de color de la tabla del backlog, y
   los dos usos nuevos de la gráfica. **Fix:** resolver el color en JavaScript con
   `window.matchMedia('(prefers-color-scheme: dark)')` — el mismo mecanismo, mucho más viejo y
   soportado, que ya usaban `PRIORITY_META`/`ESTADO_COLOR` (por eso esos sí se veían bien). Un solo
   hex fijo por render, en vez de dejarle la resolución a una función CSS de 2023-2024.
2. **`.bar-fill` es un `<span>`, y un `<span>` es `display: inline` por defecto — los elementos
   inline ignoran `width` y `height`.** Ese `width: 31%` que sí se calculaba bien (verificado en
   DevTools) nunca se dibujaba: el elemento tenía tamaño cero, invisible. Lo que se veía en pantalla
   era solo el fondo gris de `.bar-track`, el contenedor — por eso todas las barras se veían del
   mismo largo, sin relación con el conteo real. Diagnosticado inspeccionando el DOM en vivo (ancho
   correcto en el atributo `style`, pero sin rastro visual) antes de sospechar de un problema de
   layout en vez de datos. **Fix:** `display: block;` en `.bar-fill`.

Los dos se confirmaron en el preview con datos reales — "Por categoría" mostrando a Basis (13) en
azul con la barra más larga y a Integraciones/UX (4) en verde con la más corta, proporcional y
coloreado correctamente.

### `GET /api/activity-detail` — el informe mensual

Después de ver la gráfica funcionando, surgió una necesidad más concreta: un informe mensual del
avance por item, para reportar hacia Cuprum/Accenture. Tres decisiones (por `AskUserQuestion`):
vista dentro de la vitrina primero (exportar a documento queda para después), con **todos** los
campos que cambiaron (no solo estado), y solo los items que tuvieron actividad ese mes (no los 48
completos).

`activity-detail.ts` no agrega nada — regresa cada fila de `ActivityLog` tal cual, unida a `Items`
para categoría y hallazgo; la vitrina agrupa por mes (con un `<select>`) y luego por item del lado
del cliente. Cada campo cambiado se muestra como "Campo: valor anterior (tachado) → valor nuevo",
con quién lo hizo y cuándo.

Verificado en vivo, editando de verdad `ABAP-01` (estado, responsable, notas y fecha en un solo
guardado) y un item de Basis: el informe de agosto 2026 mostró 8 cambios en Basis y 4 en
ABAP/Desarrollo — que al principio parecía un conteo raro ("¿por qué sube de 1 en 1 si edité un
item?"), hasta confirmar que es el diseño esperado: **una fila de `ActivityLog` por cada campo que
realmente cambió, no una por cada clic en "Guardar"** — 2 items de Basis × 4 campos = 8, 1 item de
ABAP × 4 campos = 4. Coincide exactamente con la métrica que se eligió para la gráfica.

### Nota de flujo: un PR se mergeó a medio camino

Al llegar a este punto se mergeó el PR de la gráfica (con los dos bugs ya corregidos) directo a
`main`, y el informe mensual se siguió desarrollando y empujando sobre la misma rama
(`hito4-actividad-por-mes`) sin darse cuenta de que el PR asociado ya estaba cerrado. GitHub no
reabre un PR mergeado solo porque le sigas haciendo `push` — y como el ambiente de preview de
Azure Static Web Apps se destruye cuando el PR se cierra, el link de preview que se venía usando
dejó de reflejar cambios nuevos. Solución: abrir un **PR nuevo** desde la misma rama hacia `main`
— con los commits que ya estaban en producción sin diferencia, solo trae el commit pendiente — lo
que genera un ambiente de preview nuevo. Lección: confirmar en la lista de Pull Requests (no solo
en los workflows de Actions) si un PR sigue abierto antes de asumir que un `push` va a actualizar
su preview.

## Hito 6 — Reorganizar la app: panel de navegación

Con Hito 5 cerrado, la vitrina mezclaba backlog, gráficas e informe en una sola pantalla larga.
En una conversación sobre el uso real del proceso (los reportes EWA se bajan **semanalmente** de
`me.sap.com`, no una sola vez como el seed de Hito 3) salió una lista de 7 mejoras pendientes; este
hito ataca la primera: separar "ver el backlog" de "reportar avance", sin tocar nada del API.

- Un panel lateral (`.sidebar`) con dos botones, "Vitrina" y "Reporteo", que alternan
  `style.display` entre `#page-vitrina` (panorama, categoría/prioridad, backlog completo) y
  `#page-reporteo` (la gráfica de actividad y el informe mensual, movidos aquí desde donde vivían
  sueltos en Hito 5) — client-side puro, sin recargar la página ni volver a pedir datos al
  cambiar de página.
- Filtros de categoría e ID de item agregados a la barra del informe mensual, preservando la
  selección al recargar.

Verificado en vivo en preview (`-10`): sidebar funcionando, panorama y barras de categoría
coloreadas y proporcionales (los bugs de Hito 5 seguían corregidos), Reporteo mostrando gráfica e
informe correctamente.

## Hito 7 — Notas de seguimiento como bitácora + máquina de estados

Este hito arrancó como un ajuste chico de UI ("colapsar el campo de notas detrás de un botón +")
y terminó siendo el más grande del proyecto hasta ahora: en cuanto se armó esa primera versión,
quedó claro que el problema de fondo no era visual — `notas_seguimiento` era un solo campo de
texto que **se sobreescribía** en cada guardado, sin dejar rastro de las notas anteriores. Esa
primera versión (un `<textarea>` colapsado detrás de "+ Agregar nueva nota") se descartó antes de
mergear, a favor de lo que sigue.

### `NotasSeguimiento`: una tabla, no un campo

```sql
CREATE TABLE NotasSeguimiento (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    item_id     INT NOT NULL REFERENCES Items(id),
    usuario     VARCHAR(100) NOT NULL,
    fecha       DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    comentario  NVARCHAR(500) NOT NULL
);
```

Uno-a-muchos con `Items`: cada nota es su propia fila, nunca se pisa con la siguiente. El límite
de 500 caracteres (no 100, la primera cifra que se consideró) salió de revisar una nota real ya
guardada de 121 caracteres — 100 la habría truncado. `Items.notas_seguimiento` **no se borró** de
la base de datos (tumbar una columna no se puede deshacer sin restaurar un backup) pero dejó de
leerse y escribirse desde el API — es dato muerto a propósito, documentado como tal en
`db/schema.sql`.

`db/migration-hito7-notas-seguimiento.sql` crea la tabla y migra las notas que ya existían en la
columna vieja, con un detalle importante: en vez de migrar a mano los items que "se recordaban"
con nota, la migración es **data-driven** — toma cualquier item con texto en `notas_seguimiento` y
le busca en `ActivityLog` la última vez que ese campo cambió, para heredar el usuario y la fecha
reales (no un valor genérico de "migración"). Al correrla, salieron 3 filas, no las 2 que se
esperaban — `BAS-02` también tenía una nota que nadie había mencionado. Verificado con un
`SELECT` directo contra la tabla nueva, con usuario y fechas reales.

### Los endpoints

- `GET /api/items/{codigo}/notas` y `POST /api/items/{codigo}/notas` (`notas-list.ts` /
  `notas-add.ts`) — listar y agregar notas de un item.
- `GET /api/notas` (`notas-list-todas.ts`) — todas las notas de todos los items de una sola vez,
  con su `codigo_item`, para no tener que pedirlas item por item al armar el reporte de avance.
- Cada `POST` de nota también inserta una fila en `ActivityLog` (`campo_cambiado =
  'nota_seguimiento'`, usando la columna `comentario` que la tabla ya tenía desde Hito 3 pero
  nunca se había usado) — así la nota aparece sola en la gráfica de actividad, sin tocar ese
  endpoint.

### Máquina de estados sobre `Items.estado`

En paralelo, surgió la necesidad de reglas de negocio sobre `estado` que hasta entonces no
existían (cualquier transición era válida). Las reglas, fijadas en conversación:

- Un item nunca puede volver a **Pendiente** una vez que salió de ahí — pero desde Pendiente sí
  puede pasar directo a cualquier otro estado, sin obligar a pasar por "En progreso" primero.
- **Cancelado** y **Finalizado** son terminales: el item queda de solo lectura por completo (ni
  estado, ni responsable, ni fecha, ni notas nuevas).
- Agregar una nota, o poner fecha de compromiso, a un item que sigue Pendiente lo pasa **solo a
  "En progreso"** — automático, sin que nadie toque el selector de Estado. Ojo con un caso borde
  que no era obvio a primera vista: esta auto-transición solo dispara si el item sigue en
  Pendiente — agregarle una nota a un item ya **Bloqueado** no lo desbloquea solo.

Las tres reglas se aplican en `items-update.ts` y `notas-add.ts` **del lado del servidor**
(rechazo con 400 o 409), no solo escondiendo botones en la vitrina — una pestaña vieja abierta o
una llamada directa al API no puede saltárselas. La vitrina además quita "Pendiente" del
`<select>` de Estado en cuanto deja de ser el valor actual, y deshabilita todo el formulario con
un aviso cuando el item ya es terminal.

### El informe mensual se convierte en "Avance de items"

El informe campo-por-campo de Hito 5 (con "antes → después" y filtro de mes) resultó confuso una
vez que había notas de por medio: mezclaba una auditoría con una vista de progreso. Se separaron:
la gráfica "Actividad por mes" **no cambió**, sigue siendo el log agregado; lo que era "Informe
mensual" se rediseñó como **"Avance de items"** — sin selector de mes, solo los items que ya
salieron de Pendiente, con la cabecera (estado, responsable, fecha de compromiso) separada
visualmente de la bitácora de notas (fecha + texto, sin decir quién la escribió, más reciente
primero). `GET /api/activity-detail` no se borró — solo dejó de alimentar esta pantalla; queda
disponible para cuando se aborde "exportar el avance a documento".

Todo verificado en vivo por Javi en el preview: migración con datos reales, agregar una nota
nueva y verla aparecer sin perder las anteriores, el cambio automático de estado reflejado en la
tabla y el panorama, el candado de items terminales, y el reporte "Avance de items" mostrando
cabecera + notas correctamente.

## Hito 8 — Fusionar `ejecutor` en `dueno_seguimiento`

Un ajuste chico, pero que valía la pena documentar porque el origen del problema no estaba en el
código de este proyecto, sino en un dato heredado que nadie había cuestionado.

### Cómo se detectó

Revisando el detalle de un item en la vitrina, Javi notó que el bloque de cabecera mostraba
**"Ejecutor: Basis (Javier)"** como dato fijo, y justo debajo, en el formulario de seguimiento,
**"Persona responsable: Javier Morales"** como campo editable — la misma persona, dos veces, con
dos formatos de texto distintos. Su pregunta fue directa: *"para mí el ejecutor y el responsable
es el mismo campo, ¿en qué punto nos equivocamos?"*

### De dónde salió la separación

Rastreando el origen: `ejecutor`, `aprobador` y `dueno_seguimiento` no se diseñaron para este
proyecto — los tres ya venían como columnas separadas en el Excel real de Cuprum
(`Cuprum_PS4_EWA_Backlog.xlsx`, hoja "Backlog EWA", columnas "Ejecutor propuesto" y "Aprobador").
El Hito 3 los importó tal cual, sin preguntarse si esas columnas representaban roles realmente
distintos en el proceso de Javi o si eran remanentes de una plantilla genérica. El Hito 4, al
construir la edición de seguimiento, escogió `dueno_seguimiento` como el campo editable por su
nombre literal ("dueño del seguimiento") — pero nunca se reconcilió con `ejecutor`, que se quedó
como dato de solo lectura del import original.

Javi confirmó que, en su operación real, **responsable y ejecutor son el mismo concepto**: quien
da seguimiento es quien dispara la acción (una transacción, un ticket, un caso con SAP), sin
importar quién la ejecuta materialmente en el sistema. También aclaró el rango real de valores que
ese campo necesita: puede estar vacío, ser una persona, cambiar de una persona a otra a lo largo
del tiempo, o ser una entidad como "Basis Accenture" o "SAP ECS" (mucho menos común en Basis, casi
todo recae en él o en Carlos Sánchez, más raro en Roberto/Ricardo Ortiz, rarísimo en David
Navarro) — y que debe seguir siendo editable desde la vitrina salvo cuando el item ya es terminal.

### La solución no necesitó lógica nueva

Lo notable: `dueno_seguimiento` ya cumplía **todo** lo anterior sin tocar una línea de lógica —
ya es texto libre sin `CHECK` que lo restrinja, ya acepta `NULL`, ya es editable desde la vitrina,
y ya queda bloqueado en Cancelado/Finalizado por la máquina de estados del Hito 7. El trabajo real
fue de limpieza, no de construcción:

- **`db/migration-hito8-fusion-responsable.sql`** — para cada item donde `dueno_seguimiento`
  seguía vacío (nunca se editó desde el import de Hito 3) pero `ejecutor` sí traía un valor real,
  copia ese valor a `dueno_seguimiento`, así no se pierde la asignación original del Excel. Si un
  item ya tenía `dueno_seguimiento` editado a mano (como Roberto Ortiz en ABAP-11), ese valor gana
  — no se pisa un dato editado con el valor viejo del Excel. A diferencia de la migración de notas
  del Hito 7, esta **no genera fila en `ActivityLog`**: ahí sí existía un usuario y una fecha
  reales (tomados del historial de ediciones por API); aquí `ejecutor` nunca se editó por la API,
  llegó directo de un import que tampoco quedó loggeado — inventar un usuario/fecha habría sido un
  dato falso en el historial.
- `ejecutor` salió de las respuestas de `items-list.ts`, `items-detail.ts` e `items-update.ts`, y
  del bloque "Ejecutor:" en el detalle de la vitrina (solo queda "Aprobador", que sigue siendo un
  rol distinto y no se tocó) y del índice de búsqueda del buscador.
- La columna `Items.ejecutor` se queda en la tabla, sin borrarse — mismo criterio que
  `notas_seguimiento` en el Hito 7: tumbar una columna no se puede deshacer sin restaurar un
  backup. `db/import-seed.ts` (el script de carga del Hito 3, ya corrido una sola vez) tampoco se
  tocó — es histórico.

Verificado por Javi en producción tras correr la migración: "Persona responsable" ya trae los
valores rescatados de `ejecutor` donde no se había editado nada, y el campo "Ejecutor" ya no
aparece en el detalle.

## Hito 9 — Descargar el backlog como CSV

Con Hito 8 cerrado, la prioridad pasó a darle al equipo (Javi, Carlos y el resto de Basis) algo
concreto con qué trabajar la semana siguiente: un CSV descargable del backlog completo, tal como se
ve en la vitrina. La ingesta/alimentación semanal de reportes EWA (el diseño de CSV estandarizado
que se venía conversando) se dejó explícitamente para después — este hito es solo la mitad de
"salida" (export), no la de "entrada" (import).

### Dos decisiones de alcance, antes de construir

Se resolvieron por `AskUserQuestion` antes de tocar código, porque cambiaban qué tan grande era el
trabajo:

- **Columnas**: no el detalle completo estilo Excel original (con evidencia y actividad propuesta,
  texto largo), sino solo lo que ya se ve en la tabla de la vitrina sin dar click — ID, Categoría,
  Hallazgo, Prioridad, Estado — más dos que Javi pidió agregar: Responsable y Fecha de compromiso.
- **Alcance**: el CSV respeta los filtros activos en pantalla (categoría/prioridad/estado y el
  buscador) en vez de exportar siempre el backlog completo — "solo imprimirá lo que el filtro
  muestre actualmente en la vitrina".

### Todo client-side, sin endpoint nuevo

`GET /api/items` ya carga en memoria (`BACKLOG`) todas las columnas que hacían falta, así que no
se necesitó tocar el API — el CSV se arma en el navegador:

- Un botón **"Descargar CSV"** junto a los filtros del Backlog completo.
- `FILTERED_ACTUAL` — variable nueva a nivel de módulo que `render()` actualiza en cada pasada con
  el mismo arreglo `filtered` que ya calculaba para pintar la tabla — es lo que el botón exporta,
  para que el CSV sea exactamente lo que está en pantalla, filtros incluidos.
- Escapado CSV real (comillas dobles alrededor de cualquier campo con coma, comilla o salto de
  línea — `hallazgo` es texto libre y puede traer cualquiera de los tres) y un BOM de UTF-8 al
  inicio del archivo, para que Excel en Windows no rompa los acentos y la ñ.
- Nombre de archivo `ewa-backlog_YYYY-MM-DD.csv`.

Verificado por Javi en producción: descargó el CSV con y sin filtros activos, y confirmó que abre
correcto en Excel.

## Después de este hito

Con Hito 9 cerrado, el equipo ya tiene una fotografía exportable del backlog para trabajar la
semana siguiente. De la lista original de 7 mejoras, quedan pendientes:

- **Exportar "Avance de items" a documento** (Word/Excel/PDF), para enviarlo sin depender de que
  alguien abra la vitrina.
- **Autorización por persona responsable**: hoy `dueno_seguimiento` es texto libre; el siguiente
  paso natural es ligarlo a una cuenta real de Microsoft con rol `colaborador` (empezando por
  invitar a Carlos Sánchez como colaborador) y restringir la edición de cada item a quien lo tiene
  asignado.
- **Ingesta semanal de reportes EWA**: hoy la base solo refleja el seed de Hito 3 (una carga
  única); falta el formato estándar de CSV y la pantalla de carga dentro de la app. Ya hay un
  análisis hecho comparando dos reportes EWA reales de periodos distintos (mayo y agosto 2026):
  SAP no asigna un ID estable a cada alerta — solo los números de SAP Note (pares
  causa/solución) son identificadores confiables entre periodos; el resto se compara por texto
  normalizado.
- **Detalle enriquecido de items** desde el archivo/blob del EWA original.
- **Deduplicación de items repetidos** entre reportes semanales consecutivos.
- Seguir explorando TypeScript con mini-laboratorios (tema aparte, ya conversado, para retomar
  cuando convenga).
