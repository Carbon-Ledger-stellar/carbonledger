terraform {
    required_version = ">= 1.0.0"

    required_providers {
        aws = {
            source  = "hashicorp/aws"
            version = "~> 5.0"
        }
        random = {
            source  = "hashicorp/random"
            version = "~> 3.0"
        }
    }

    # Backend configuration (S3 for state storage)
    backend "s3" {
        bucket         = "carbonledger-terraform-state"
        key            = "terraform.tfstate"
        region         = "us-east-1"
        encrypt        = true
        dynamodb_table = "terraform-state-lock"
    }
}
