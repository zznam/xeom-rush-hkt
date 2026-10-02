variable "region" {
  type = string
}

variable "environment" {
  type    = string
  default = "production"
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Use staging or production."
  }
}
variable "image" {
  type = string
  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Deploy an immutable ECR image digest."
  }
}
variable "release_sha" {
  type = string
}

variable "hosted_zone_id" {
  type = string
}

variable "api_domain" {
  type = string
}

variable "allowed_origins" {
  type = list(string)
  validation {
    condition     = length(var.allowed_origins) > 0 && alltrue([for origin in var.allowed_origins : can(regex("^https://[^/]+$", origin))])
    error_message = "Supply explicit HTTPS frontend origins, without a trailing slash."
  }
}
variable "regions" {
  type = list(object({ id = string, label = string, apiUrl = string }))
  validation {
    condition     = length(var.regions) > 0 && length(var.regions) <= 20 && length(distinct([for r in var.regions : r.id])) == length(var.regions)
    error_message = "Configure 1-20 unique regions."
  }
}
variable "room_ids" {
  type    = set(string)
  default = ["city-01", "city-02"]
  validation {
    condition     = length(var.room_ids) >= 2 && length(var.room_ids) <= 40 && alltrue([for id in var.room_ids : can(regex("^[a-z0-9-]{1,24}$", id)) && id != "matchmaker"])
    error_message = "Provide 2-40 distinct city IDs (lowercase letters, numbers and hyphens)."
  }
}
variable "room_capacity" {
  type    = number
  default = 64
  validation {
    condition     = var.room_capacity >= 2 && var.room_capacity <= 200 && floor(var.room_capacity) == var.room_capacity
    error_message = "Capacity must be an integer from 2 to 200; load-test before increasing."
  }
}
variable "guest_secret_arn" {
  type        = string
  description = "Existing regional Secrets Manager secret containing a random string of at least 32 characters. Never place its value in tfvars."
}
variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
variable "alarm_email" {
  type        = string
  description = "Operator email for CloudWatch alerts; AWS sends a subscription confirmation."
}
