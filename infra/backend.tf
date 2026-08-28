terraform {
  backend "azurerm" {
    # Completa estos tres valores con los outputs de `infra/bootstrap` (Paso 1 del README).
    resource_group_name  = "rg-ewatracker-state"
    storage_account_name = "stewatrackerstate9z4rek"
    container_name       = "tfstate"
    key                  = "ewa-tracker.tfstate"

    # Alternativa sin editar este archivo: deja los TODO y corre
    #   terraform init \
    #     -backend-config="resource_group_name=<...>" \
    #     -backend-config="storage_account_name=<...>" \
    #     -backend-config="container_name=<...>" \
    #     -backend-config="key=ewa-tracker.tfstate"
  }
}
