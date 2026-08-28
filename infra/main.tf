# Hito 0: esqueleto de la Fase 1 (ver Roadmap EWA Tracker Cloud.cd).
# Crea: Resource Group, Static Web App (Free) y Azure SQL Database en el free
# offer serverless (perpetuo).
#
# La API (Azure Functions) NO se crea aquí como recurso aparte: usamos el
# modelo de "managed functions" de Static Web Apps (carpeta /api en el repo,
# desplegada vía GitHub Actions) — el propio servicio de Static Web Apps
# aprovisiona ese cómputo, sin pegarle a la cuota de VMs/App Service Plan de
# la suscripción. Un Function App independiente (azurerm_linux_function_app +
# azurerm_service_plan) sí cuenta contra esa cuota, y fue justo lo que chocó
# con el límite "Total VMs: 0" de una suscripción recién pasada a pago. Si en
# el futuro necesitas más control del que dan las managed functions, ahí sí
# se vuelve a evaluar el Function App independiente ("bring your own
# functions").

resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_resource_group" "app" {
  name     = "rg-${var.prefix}-app"
  location = var.location

  tags = {
    proyecto = "ewa-tracker-cloud"
    hito     = "0"
  }
}

# ---------------------------------------------------------------------------
# Frontend: Azure Static Web Apps (plan Free — incluye SSL, dominio y auth integrada)
# ---------------------------------------------------------------------------

resource "azurerm_static_web_app" "frontend" {
  name                = "swa-${var.prefix}-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.app.name
  location             = azurerm_resource_group.app.location
  sku_tier              = "Free"
  sku_size              = "Free"

  tags = {
    proyecto = "ewa-tracker-cloud"
    hito     = "0"
  }
}

# ---------------------------------------------------------------------------
# Base de datos: Azure SQL Database — free offer serverless (PERPETUO)
# Ojo: esto NO es el "SQL Database, Single Standard, S0 DTUs" de tu cuota de
# 12 meses — es el modelo vCore/Serverless con free offer, que no vence.
#
# Este servidor y esta base se crearon a mano desde el Portal (ver
# Troubleshooting en el README: la cuota "Region access" bloqueaba a
# Terraform/CLI en eastus2 y eastus por igual; West US 2 sí tenía acceso, y
# el asistente del Portal deja aplicar el free offer con un botón, cosa que
# el provider azurerm todavía no expone). Los valores de abajo son literales
# a propósito, en vez de generados con random_string — deben coincidir
# exactamente con lo que ya existe en Azure para poder importarlos
# (`terraform import`, ver README) sin que Terraform intente recrearlos.
# ---------------------------------------------------------------------------

resource "azurerm_mssql_server" "sql" {
  name                         = "sql-ewatracker-portal01"
  resource_group_name          = azurerm_resource_group.app.name
  location                      = var.compute_location # West US 2 — la única región que aceptó SQL en esta suscripción
  version                        = "12.0"
  administrator_login          = var.sql_admin_login
  administrator_login_password = var.sql_admin_password

  # El asistente del Portal, en modo de autenticación mixto (SQL + Microsoft
  # Entra), asigna automáticamente tu propia cuenta como administrador de
  # Entra del servidor. Lo declaramos aquí tal cual quedó para no perderlo al
  # importar — es una forma extra (y más segura, sin contraseña) de entrar al
  # servidor con tu cuenta de Microsoft en vez de usuario/contraseña SQL.
  azuread_administrator {
    login_username = "javiermp2002@hotmail.com"
    object_id      = "76761b84-d7be-445f-822f-4a32388041ea"
    tenant_id      = "39c4937b-5808-4110-8551-b713eff750ab"
  }

  tags = {
    proyecto = "ewa-tracker-cloud"
    hito     = "0"
  }
}

resource "azurerm_mssql_firewall_rule" "allow_azure_services" {
  # Nombre fijo: es el nombre que Azure le da automáticamente a esta regla
  # cuando activas "Permitir que los servicios y recursos de Azure accedan a
  # este servidor" desde el Portal — hay que usar el mismo para importarla.
  name             = "AllowAllWindowsAzureIps"
  server_id         = azurerm_mssql_server.sql.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_mssql_database" "sql" {
  name      = "sqldb-${var.prefix}"
  server_id = azurerm_mssql_server.sql.id

  sku_name    = "GP_S_Gen5_2" # General Purpose, Serverless, Gen5, hasta 2 vCores
  min_capacity = 0.5
  auto_pause_delay_in_minutes = 60

  max_size_gb = 32 # tope del free offer

  storage_account_type = "Local" # así quedó configurado desde el asistente del Portal

  # El free offer en sí (useFreeLimit / freeLimitExhaustionBehavior en la API de
  # Azure) todavía NO está expuesto por el provider azurerm — hay un PR abierto y
  # sin mergear (hashicorp/terraform-provider-azurerm#32055). Esta base se creó
  # con el free offer activado desde el asistente del Portal (botón "Apply
  # offer") — Terraform no lo gestiona, pero tampoco lo va a desactivar al
  # importar: esa propiedad simplemente no aparece en este recurso.

  tags = {
    proyecto = "ewa-tracker-cloud"
    hito     = "0"
  }
}
