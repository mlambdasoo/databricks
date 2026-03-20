# ------------------ AWS Account ID --------------------#
data "aws_caller_identity" "current" {}

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

# ==================== UC Storage IAM Role ====================

# ------------------ UC Storage Role Trust Policy --------------------#
# Databricks UC Master Role + Self-Assumption 허용
data "aws_iam_policy_document" "uc_storage_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type = "AWS"
      identifiers = [
        # Databricks Unity Catalog 서비스가 이 Role을 Assume할 수 있도록 허용
        "arn:aws:iam::414351767826:role/unity-catalog-prod-UCMasterRole-14S5ZJVKOTYTL",
        # Self-Assumption: 순환 참조 방지를 위해 ARN을 직접 구성
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${local.uc_storage_role_name}"
      ]
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.databricks_account_id]
    }
  }
}

# ------------------ UC Storage IAM Role --------------------#
resource "aws_iam_role" "uc_storage_role" {
  name               = local.uc_storage_role_name
  assume_role_policy = data.aws_iam_policy_document.uc_storage_trust.json
  tags = {
    Owner       = local.tags.Owner
    Name        = "${local.tags.Name}-uc-storage-role-01"
    Environment = local.tags.Environment
  }
}

# ------------------ UC Storage S3 Permission Policy --------------------#
data "aws_iam_policy_document" "uc_storage_s3_policy" {
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
      "s3:GetBucketLocation"
    ]
    resources = [
      aws_s3_bucket.root_storage_bucket.arn,
      "${aws_s3_bucket.root_storage_bucket.arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "uc_storage_policy" {
  name   = "${local.tags.Name}-uc-storage-policy-01"
  role   = aws_iam_role.uc_storage_role.id
  policy = data.aws_iam_policy_document.uc_storage_s3_policy.json
}


