terraform {
    backend "s3" {
        bucket         = "carbonledger-terraform-state"
        key            = "staging/terraform.tfstate"
        region         = "us-east-1"
        encrypt        = true
        dynamodb_table = "terraform-state-lock"
    }
}

provider "aws" {
    region = var.aws_region
}

# VPC (simplified - in production use a VPC module)
data "aws_vpc" "default" {
    default = true
}

data "aws_subnets" "default" {
    filter {
        name   = "vpc-id"
        values = [data.aws_vpc.default.id]
    }
}

module "postgres" {
    source = "../../modules/postgres"

    identifier = "carbonledger-staging"
    db_name    = "carbonledger"
    username   = var.db_username
    password   = var.db_password

    instance_class = "db.t4g.medium"
    allocated_storage = 100

    vpc_id     = data.aws_vpc.default.id
    subnet_ids = data.aws_subnets.default.ids

    ingress_security_group_id = module.load_balancer.security_group_id

    backup_retention_period = 7
    deletion_protection     = false
    skip_final_snapshot     = true

    tags = {
        Environment = "staging"
        Project     = "CarbonLedger"
    }
}

module "redis" {
    source = "../../modules/redis"

    identifier  = "carbonledger-staging"
    environment = "staging"

    node_type             = "cache.t4g.micro"
    num_cache_clusters    = 1

    vpc_id     = data.aws_vpc.default.id
    subnet_ids = data.aws_subnets.default.ids

    ingress_security_group_id = module.load_balancer.security_group_id

    tags = {
        Environment = "staging"
        Project     = "CarbonLedger"
    }
}

module "load_balancer" {
    source = "../../modules/load-balancer"

    identifier = "carbonledger-staging"
    vpc_id     = data.aws_vpc.default.id
    public_subnet_ids = data.aws_subnets.default.ids

    certificate_arn = var.certificate_arn

    tags = {
        Environment = "staging"
        Project     = "CarbonLedger"
    }
}

module "cdn" {
    source = "../../modules/cdn"

    identifier  = "carbonledger"
    environment = "staging"
    aliases     = ["staging.carbonledger.com"]

    tags = {
        Environment = "staging"
        Project     = "CarbonLedger"
    }
}
