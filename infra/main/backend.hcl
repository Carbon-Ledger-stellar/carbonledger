# Pass this file to terraform init:
#   terraform init -backend-config=backend.hcl
#
# Replace <ACCOUNT_ID> with your AWS account ID after running the bootstrap module.
#
# The key uses the Terraform workspace name so staging and production each get
# their own isolated state file:
#   carbonledger/staging/terraform.tfstate
#   carbonledger/production/terraform.tfstate
#
# Terraform automatically substitutes ${terraform.workspace} in the key when
# workspaces are used, so a single backend.hcl covers both environments.

bucket         = "carbonledger-terraform-state-<ACCOUNT_ID>"
key            = "carbonledger/${terraform.workspace}/terraform.tfstate"
region         = "us-east-1"
dynamodb_table = "carbonledger-terraform-lock"
encrypt        = true
