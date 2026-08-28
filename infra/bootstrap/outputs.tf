output "resource_group_name" {
  value = azurerm_resource_group.state.name
}

output "storage_account_name" {
  value = azurerm_storage_account.state.name
}

output "container_name" {
  value = azurerm_storage_container.tfstate.name
}

output "next_step" {
  value = "Copia estos tres valores en infra/backend.tf (o pásalos con -backend-config) antes de correr 'terraform init' en infra/."
}
