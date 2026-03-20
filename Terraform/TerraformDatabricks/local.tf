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
}