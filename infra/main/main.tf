terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Populated via -backend-config or terraform.tfvars
    # bucket         = "carbonledger-terraform-state-<account-id>"
    # key            = "carbonledger/<workspace>/terraform.tfstate"
    # region         = "us-east-1"
    # dynamodb_table = "carbonledger-terraform-lock"
    # encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "carbonledger"
      Environment = terraform.workspace
      ManagedBy   = "terraform"
    }
  }
}
