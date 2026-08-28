output "static_web_app_default_host_name" {
  value = azurerm_static_web_app.frontend.default_host_name
}

output "static_web_app_api_key" {
  value     = azurerm_static_web_app.frontend.api_key
  sensitive = true
}

output "resource_group_name" {
  value = azurerm_resource_group.app.name
}

output "sql_server_name" {
  value = azurerm_mssql_server.sql.name
}

output "sql_server_fqdn" {
  value = azurerm_mssql_server.sql.fully_qualified_domain_name
}

output "sql_database_name" {
  value = azurerm_mssql_database.sql.name
}
