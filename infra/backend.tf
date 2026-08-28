terraform {
  backend "azurerm" {
    resource_group_name  = "rg-ewatracker-state"
    storage_account_name = "stewatrackerstate9z4rek"
    container_name       = "tfstate"
    key                  = "ewa-tracker.tfstate"

    # Autenticación vía Azure AD (no con la clave del Storage Account).
    # Localmente usa tu sesión de `az login`; en GitHub Actions usa OIDC
    # (ver .github/workflows/terraform.yml — variables ARM_* + ARM_USE_OIDC).
    use_azuread_auth = true
  }
}
