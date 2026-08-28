terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.0, < 5.0" # revisa la versión más reciente 4.x en el Terraform Registry antes de aplicar
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
  # Autenticación vía Azure CLI: usa la sesión de `az login` de tu máquina.
  # (El Hito 1 la reemplaza por un Service Principal para que corra en GitHub Actions.)
}
