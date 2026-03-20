# ------------------ Local Variables --------------------#
locals {
  vpc_cidr = "${var.vpc_cidr}"
  root_bucket_name = "${var.root_bucket_name}"
  prefix = "${var.prefix}"
  tags = {
    Owner = "${var.user_name}"
    Name = "${var.prefix}"
    Environment = "${var.env_name}"
  }
  force_destroy = true #destroy root bucket when deleting stack?

  # UC Storage IAM Role name (self-assumption을 위해 ARN을 미리 구성)
  uc_storage_role_name = "${var.prefix}-uc-storage-role-01"
}