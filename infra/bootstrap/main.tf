# Bootstrap: crea únicamente lo necesario para alojar el state remoto de
# Terraform del resto del proyecto. Se aplica UNA vez, con state local.
# No vuelvas a correr `terraform apply` aquí salvo que quieras recrear el backend.

resource "random_string" "state_suffix" {
  length  = 6
  special = false
  upper   = false
}

resource "azurerm_resource_group" "state" {
  name     = "rg-${var.prefix}-state"
  location = var.location

  tags = {
    proyecto = "ewa-tracker-cloud"
    hito     = "0-bootstrap"
  }
}

resource "azurerm_storage_account" "state" {
  name                     = "st${var.prefix}state${random_string.state_suffix.result}"
  resource_group_name      = azurerm_resource_group.state.name
  location                 = azurerm_resource_group.state.location
  account_tier             = "Standard"
  account_replication_type = "LRS" # el más barato; suficiente para un state de un solo proyecto

  # Entra dentro de la cuota gratuita de 12 meses de tu suscripción (Blob storage,
  # bajo volumen de datos y operaciones). No es el recurso "always free" — vigílalo
  # en Cost Management igual que el resto, aunque a este tamaño el costo es marginal.

  blob_properties {
    versioning_enabled = true # protege el state si algo sale mal en un apply
  }

  tags = {
    proyecto = "ewa-tracker-cloud"
    hito     = "0-bootstrap"
  }
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_name  = azurerm_storage_account.state.name
  container_access_type = "private"
}
