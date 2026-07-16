# terraform workspace select staging
# terraform apply -var-file=staging.tfvars

app_instance_type = "t3.small"
db_instance_class = "db.t3.micro"
redis_node_type   = "cache.t3.micro"
