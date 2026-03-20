## -------------------- terraform -------------------- ##

terraform {
  required_providers {
      databricks = {
          source = "databricks/databricks"
	  version = "=1.14.0"
      }
      aws = {
          source = "hashicorp/aws"
	  version ="=4.57.0"
      }
  }
}

## -------------------- variable -------------------- ##

variable "env_name" {
  type = string
  default = "databricks workspace"
}

variable "user_name" {
    type = string
    description = "firstname.lastname"
}

variable "region" { 
  type = string
  default = "ap-northeast-2"
}

variable "databricks_account_id" {
  type = string
  description = "Databricks account id from accounts console"
}

# variable "cross_account_arn" {
#   type = string
#   description = "ARN of cross-account role"
# }

variable "client_id" {
  type = string
}    
variable "client_secret" {
  type = string
}

variable "databricks_aws_account_id" {
  type = string
  description = "Databricks AWS account id"
  default ="414351767826"
}

variable "aws_access_key_id" {
    type= string
}

variable "aws_secret_access_key" {
    type = string    
}

variable "root_bucket_name" {
    type = string    
}

variable "vpc_cidr" {
    type = string    
}

variable "prefix" {
    type = string    
}

## -------------------- provider -------------------- ##

provider "aws" {
    region = var.region
    access_key = var.aws_access_key_id
    secret_key = var.aws_secret_access_key
}

provider "databricks" {
  alias         = "mws"
  host          = "https://accounts.cloud.databricks.com"
  //account_id    = var.databricks_account_id
  client_id     = var.client_id
  client_secret = var.client_secret
  account_id = var.databricks_account_id
}

