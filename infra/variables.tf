variable "prefix" {
  description = "Prefijo corto para nombrar todos los recursos del proyecto."
  type        = string
  default     = "ewatracker"
}

variable "location" {
  description = "Región para Resource Group, Storage Account y Static Web App."
  type        = string
  default     = "eastus2"
}

variable "compute_location" {
  description = "Región para el SQL Server. Separada de 'location' porque en suscripciones Azure recién pasadas a Pay-As-You-Go, algunas regiones quedan con el aprovisionamiento de SQL restringido por antifraude hasta que la cuenta 'madura'. eastus2 y eastus estaban bloqueadas para esta suscripción; West US 2 sí tuvo acceso (probado directo en el asistente del Portal, que valida la región al instante)."
  type        = string
  default     = "westus2"
}

variable "sql_admin_login" {
  description = "Usuario administrador del Azure SQL Server lógico."
  type        = string
  default     = "ewaadmin"
}

variable "sql_admin_password" {
  description = "Password del administrador de SQL. Sin default a propósito: pásala por TF_VAR_sql_admin_password o de forma interactiva. Nunca la subas al repo."
  type        = string
  sensitive   = true
}
