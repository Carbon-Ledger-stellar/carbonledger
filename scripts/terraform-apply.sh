#!/bin/bash

set -e

ENVIRONMENT=${1:-staging}

echo "🚀 Applying Terraform configuration for ${ENVIRONMENT}..."

cd terraform/environments/${ENVIRONMENT}

# Initialize Terraform
echo "📦 Initializing Terraform..."
terraform init

# Validate configuration
echo "🔍 Validating configuration..."
terraform validate

# Plan changes
echo "📊 Planning changes..."
terraform plan -out=tfplan

terraform show tfplan
echo
read -r -p "Apply this exact Terraform plan? Type 'yes' to continue: " confirmation
if [[ "$confirmation" != "yes" ]]; then
  echo "Terraform apply cancelled."
  exit 1
fi

echo "✅ Applying reviewed plan..."
terraform apply tfplan

echo "🎉 Terraform apply completed for ${ENVIRONMENT}!"
