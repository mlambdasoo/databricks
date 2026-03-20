# ------------------ Databricks Credentials --------------------#
resource "databricks_mws_credentials" "this" {
  provider         = databricks.mws
  account_id       = var.databricks_account_id
  role_arn         = aws_iam_role.cross_account_role.arn
  credentials_name = "${local.prefix}-credentials-01"
  depends_on       = [time_sleep.wait]
}

# ------------------ Databricks Storage Configuration --------------------#
resource "databricks_mws_storage_configurations" "this" {
  provider                   = databricks.mws
  account_id                 = var.databricks_account_id
  storage_configuration_name = "${local.prefix}-storage-01"
  bucket_name                = aws_s3_bucket.root_storage_bucket.bucket

  depends_on = [aws_s3_bucket_policy.root_bucket_policy]
}

# ------------------ Databricks Network Configuration --------------------#
resource "databricks_mws_networks" "this" {
  provider = databricks.mws
  account_id = var.databricks_account_id
  network_name = "${local.prefix}-network-01"
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets
  security_group_ids = [aws_security_group.databricks_sg.id]
}

# ------------------ Databricks Workspace --------------------#
resource "databricks_mws_workspaces" "this" {
  provider = databricks.mws
  account_id = var.databricks_account_id
  workspace_name = local.prefix  # Account Console상 보이는 설정정보 
  #deployment_name = local.prefix # 접속 URL 
  aws_region = var.region

  credentials_id = databricks_mws_credentials.this.credentials_id
  storage_configuration_id = databricks_mws_storage_configurations.this.storage_configuration_id
  network_id = databricks_mws_networks.this.network_id
}


