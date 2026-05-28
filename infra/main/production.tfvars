# terraform workspace select production
# terraform apply -var-file=production.tfvars

app_instance_type = "t3.medium"
db_instance_class = "db.t3.small"
redis_node_type   = "cache.t3.small"
