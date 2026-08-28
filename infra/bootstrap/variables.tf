variable "prefix" {
  description = "Prefijo corto para nombrar todos los recursos del proyecto."
  type        = string
  default     = "ewatracker"
}

variable "location" {
  description = "Región de Azure donde se crean los recursos."
  type        = string
  default     = "eastus2"
}
