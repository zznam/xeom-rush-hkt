terraform {
  required_version = ">= 1.10, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
  }
}
provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Application = "xeom-rush", Environment = var.environment, ManagedBy = "terraform"
    }
  }
}
