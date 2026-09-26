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

# Apply changes
echo "✅ Applying changes..."
terraform apply tfplan

echo "🎉 Terraform apply completed for ${ENVIRONMENT}!"
