# ------------------ Cross Account Role Data --------------------#
data "databricks_aws_assume_role_policy" "this" {
  external_id = var.databricks_account_id
}

# ------------------ Cross Account Policy Data --------------------#
data "databricks_aws_crossaccount_policy" "this" {
}

# ------------------ Cross Account Role --------------------#
resource "aws_iam_role" "cross_account_role" {
  name = "${local.tags.Name}-cross-account-role-01"
  assume_role_policy = data.databricks_aws_assume_role_policy.this.json
  tags = {
      Owner = local.tags.Owner
      Name = "${local.tags.Name}-cross-account-role-01"
      Environment = local.tags.Environment
    }
}

# ------------------ Cross Account Policy --------------------#
resource "aws_iam_role_policy" "this" {
  name = "${local.tags.Name}-cross-account-policy-01"
  role   = aws_iam_role.cross_account_role.id
  policy = data.databricks_aws_crossaccount_policy.this.json
}

# ------------------ Sleeping to wait for the role to be created --------------------#
resource "time_sleep" "wait" {
  depends_on = [
    aws_iam_role.cross_account_role
  ]
  create_duration = "10s"
}


