// export host to be used by other modules
output "databricks_host" {
  value = databricks_mws_workspaces.this.workspace_url
}

output "arn" {
  value = aws_iam_role.cross_account_role.arn
}

output "uc_storage_role_arn" {
  value       = aws_iam_role.uc_storage_role.arn
  description = "UC Storage IAM Role ARN - databricks_storage_credential 등록 시 사용"
}

