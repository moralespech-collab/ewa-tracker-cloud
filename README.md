# EWA Tracker Cloud — Hito 0: IaC del esqueleto

Portafolio personal: gestión en la nube del backlog de EarlyWatch Alerts (EWA) de SAP,
construido como vehículo de aprendizaje de IaC, automatización, identidad y administración
de Azure/SAP BTP. Ver `../Roadmap EWA Tracker Cloud.cd` para el plan completo (Fase 1 y Fase 2).

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

## Después de este hito

Este scaffold queda pensado para que seas tú quien ejecute `terraform apply` la primera vez —
es tu propia suscripción y tus propias credenciales. El Hito 1 (CI/CD) mueve este mismo
`terraform apply` a un workflow de GitHub Actions, usando un Service Principal con permisos
acotados en vez de tu cuenta personal — y es también donde agregamos la carpeta `/api` con las
managed functions de Static Web Apps.
