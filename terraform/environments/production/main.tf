terraform {
    backend "s3" {
        bucket         = "carbonledger-terraform-state"
        key            = "production/terraform.tfstate"
        region         = "us-east-1"
        encrypt        = true
        dynamodb_table = "terraform-state-lock"
    }
}

provider "aws" {
    region = var.aws_region
}

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

    identifier = "carbonledger-production"
    db_name    = "carbonledger"
    username   = var.db_username
    password   = var.db_password

    instance_class = "db.t4g.large"
    allocated_storage = 200
    max_allocated_storage = 2000

    vpc_id     = data.aws_vpc.default.id
    subnet_ids = data.aws_subnets.default.ids

    ingress_security_group_id = module.load_balancer.security_group_id

    backup_retention_period = 30
    deletion_protection     = true
    skip_final_snapshot     = false

    replicate_to_region = "us-west-2"

    tags = {
        Environment = "production"
        Project     = "CarbonLedger"
    }
}

module "redis" {
    source = "../../modules/redis"

    identifier  = "carbonledger-production"
    environment = "production"

    node_type             = "cache.t4g.small"
    num_cache_clusters    = 2
    automatic_failover_enabled = true
    multi_az_enabled          = true

    snapshot_retention_limit = 7

    vpc_id     = data.aws_vpc.default.id
    subnet_ids = data.aws_subnets.default.ids

    ingress_security_group_id = module.load_balancer.security_group_id

    tags = {
        Environment = "production"
        Project     = "CarbonLedger"
    }
}

module "load_balancer" {
    source = "../../modules/load-balancer"

    identifier = "carbonledger-production"
    vpc_id     = data.aws_vpc.default.id
    public_subnet_ids = data.aws_subnets.default.ids

    enable_deletion_protection = true
    certificate_arn = var.certificate_arn

    tags = {
        Environment = "production"
        Project     = "CarbonLedger"
    }
}

module "cdn" {
    source = "../../modules/cdn"

    identifier  = "carbonledger"
    environment = "production"
    aliases     = ["carbonledger.com", "www.carbonledger.com"]

    tags = {
        Environment = "production"
        Project     = "CarbonLedger"
    }
}
