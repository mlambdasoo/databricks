# databricks

Personal workspace for Databricks demos, infrastructure, and experiments.

## Contents

| Path | Description |
|------|-------------|
| `Terraform/` | Terraform configurations for provisioning Databricks workspaces and supporting cloud infrastructure. |
| `mcp-excel/` | A sample MCP server app for working with Excel files. |
| `secret-dlp-test/` | Test fixtures for validating MCP service policies (repo allow-list and secret DLP). |
| `app-templates/` | Reference app templates (submodule). |

## Getting started

```bash
# Provision infrastructure
cd Terraform/Internal
terraform init
terraform plan --var-file=input.tfvars
terraform apply --var-file=input.tfvars
```

## Notes

- This repository is used for demos and prototyping only.
- Configuration values and state files are excluded via `.gitignore`.
