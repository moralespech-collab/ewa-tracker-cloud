terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.0, < 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Sin bloque "backend" a propósito: este módulo se aplica una sola vez,
  # con state local, y crea el Storage Account que usará el backend remoto
  # del resto del proyecto (infra/backend.tf).
}

provider "azurerm" {
  features {}
  # Autenticación vía Azure CLI: usa la sesión de `az login` de tu máquina.
}
