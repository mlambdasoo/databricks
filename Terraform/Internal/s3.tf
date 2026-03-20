# ------------------ Root Storage Bucket Data --------------------#
# Databricks 기본 버킷 정책 (Databricks AWS 계정 414351767826 접근 허용)
data "databricks_aws_bucket_policy" "this" {
  bucket = aws_s3_bucket.root_storage_bucket.bucket
}

# ------------------ Combined Bucket Policy (Databricks + UC Storage IAM Role) --------------------#
data "aws_iam_policy_document" "combined_bucket_policy" {
  # 기존 Databricks 기본 정책 statements를 그대로 포함
  source_policy_documents = [data.databricks_aws_bucket_policy.this.json]

  # UC Storage IAM Role에 대한 S3 접근 추가
  statement {
    sid    = "UCStorageRoleAccess"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.uc_storage_role.arn]
    }

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

# ------------------ Root Storage Bucket --------------------#
resource "aws_s3_bucket" "root_storage_bucket" {
  bucket = local.root_bucket_name
  force_destroy = true
  tags = local.tags
}

# ------------------ Root Storage Bucket Versioning --------------------#
resource "aws_s3_bucket_versioning" "root_bucket_versioning" {
  bucket = aws_s3_bucket.root_storage_bucket.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ------------------ Root Storage Bucket Encryption --------------------#
resource "aws_s3_bucket_server_side_encryption_configuration" "root_storage_bucket" {
  bucket = aws_s3_bucket.root_storage_bucket.bucket

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ------------------ Root Storage Bucket Access Block --------------------#
resource "aws_s3_bucket_public_access_block" "root_storage_bucket" {
  bucket                  = aws_s3_bucket.root_storage_bucket.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
  depends_on              = [aws_s3_bucket.root_storage_bucket]
}

# ------------------ Root Storage Bucket Policy --------------------#
resource "aws_s3_bucket_policy" "root_bucket_policy" {
  bucket     = aws_s3_bucket.root_storage_bucket.id
  policy     = data.aws_iam_policy_document.combined_bucket_policy.json
  depends_on = [aws_s3_bucket_public_access_block.root_storage_bucket]
}
