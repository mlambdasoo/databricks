# ------------------ data --------------------#

data "aws_availability_zones" "available" {
  state = "available"
}

# ------------------ VPC --------------------#

module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "4.0.1"

  name = "${local.tags.Name}-vpc-01"
  cidr = local.vpc_cidr
  azs  = data.aws_availability_zones.available.names
  tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-vpc-01"
    Environment = local.tags.Environment
  }

  enable_dns_hostnames = true

  # ------------------ NAT Gateway --------------------#

  enable_nat_gateway = true

  single_nat_gateway = true

  one_nat_gateway_per_az = false

  nat_gateway_tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-nat-gateway-01"
    Environment = local.tags.Environment
  }   

  nat_eip_tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-elastic-ip-01"
    Environment = local.tags.Environment
  }

  # ------------------ Internet Gateway --------------------#

  create_igw = true
  
  igw_tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-internet-gateway-01"
    Environment = local.tags.Environment
  }
  
  # ------------------ Public Subnet --------------------#

  public_subnets = [cidrsubnet(local.vpc_cidr,3,0)]

  public_subnet_tags_per_az = {
      "${var.region}a" = {
      Owner = local.tags.Owner
      Name = "${local.tags.Name}-public-subnet-01"
      Environment = local.tags.Environment
    }
  }

  # ------------------ Private Subnet --------------------#

  private_subnets = [
                    cidrsubnet(local.vpc_cidr,3,1),
                    cidrsubnet(local.vpc_cidr,3,2),
                    cidrsubnet(local.vpc_cidr,3,3)
  ]
    
  private_subnet_tags_per_az = {
      "${var.region}a" = {
      Owner = local.tags.Owner
      Name = "${local.tags.Name}-private-subnet-01"
      Environment = local.tags.Environment
    },
      "${var.region}b" = {
      Owner = local.tags.Owner
      Name = "${local.tags.Name}-private-subnet-02"
      Environment = local.tags.Environment
    },
      "${var.region}c" = {
      Owner = local.tags.Owner
      Name = "${local.tags.Name}-private-subnet-03"
      Environment = local.tags.Environment
    }
  }

  #private_acl_tags = {Name = "demo-e2-private-acl-01"}

  #public_acl_tags = {Name = "demo-e2-public-acl-01"}

  # ------------------ Public Route Table --------------------#

  default_route_table_name = "${local.tags.Name}-default-route-table-01"

  default_route_table_tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-default-route-table-01"
    Environment = local.tags.Environment
  }

  # ------------------ Public Route Table --------------------#

  public_route_table_tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-public-route-table-01"
    Environment = local.tags.Environment
  }

  # ------------------ Private Route Table --------------------#

  private_route_table_tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-private-route-table-01"
    Environment = local.tags.Environment
  }  

  # ------------------ Default Network ACL --------------------#

  default_network_acl_name = "${local.tags.Name}-network-acl-01"
  
  default_network_acl_egress = [
    {
      protocol   = -1
      rule_no    = 100
      action     = "allow"
      cidr_block = "${local.vpc_cidr}"
      from_port  = 0
      to_port    = 0
    },
    {
      protocol   = "tcp"
      rule_no    = 200
      action     = "allow"
      cidr_block = "0.0.0.0/0"
      from_port  = 443
      to_port    = 443
    },
    {
      protocol   = "tcp"
      rule_no    = 300
      action     = "allow"
      cidr_block = "0.0.0.0/0"
      from_port  = 3306
      to_port    = 3306
    }
    /*
    ,
      {
      protocol   = -1
      rule_no    = 400
      action     = "deny"
      cidr_block = "0.0.0.0/0"
      from_port  = 0
      to_port    = 0
    }
  */
  ]
  
  default_network_acl_ingress = [
    {
      protocol   = -1
      rule_no    = 100
      action     = "allow"
      cidr_block = "0.0.0.0/0"
      from_port  = 0
      to_port    = 0
    }
  ]

  default_network_acl_tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-network-acl-01"
    Environment = local.tags.Environment
  }

} #-- module VPC --#

# ------------------ Security Group --------------------#

resource "aws_security_group" "databricks_sg" {

  name = "${local.tags.Name}-security-group-01"
    
  vpc_id = module.vpc.vpc_id
  
  egress {
            from_port = 443
            to_port = 443
            protocol = "tcp"
            cidr_blocks = ["0.0.0.0/0"]
        }
  egress {
            from_port = 3306
            to_port = 3306
            protocol = "tcp"
            cidr_blocks = ["0.0.0.0/0"]
        }
  egress {
            from_port = 6666
            to_port = 6666
            protocol = "tcp"
            cidr_blocks = ["0.0.0.0/0"]
        }

  egress {
            self = true
            from_port = 0
            to_port = 65535
            protocol = "tcp"
    }
  egress {
            self = true
            from_port = 0
            to_port = 65535
            protocol = "udp"
    }

  ingress {
            self = true
            from_port = 0
            to_port = 65535
            protocol = "tcp"
    }
  ingress {
            self = true
            from_port = 0
            to_port = 65535
            protocol = "udp"
    }

  tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-security-group-01"
    Environment = local.tags.Environment
  }
}

# ------------------ S3 Endpoint --------------------#

resource "aws_vpc_endpoint" "s3" {
  service_name = "com.amazonaws.${var.region}.s3"
  vpc_id = module.vpc.vpc_id
  route_table_ids = module.vpc.private_route_table_ids
  tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-endpoint-s3-01"
    Environment = local.tags.Environment
  }
  vpc_endpoint_type = "Gateway"
}

# ------------------ Kinesis Endpoint --------------------#

resource "aws_vpc_endpoint" "kinesis" {
  service_name = "com.amazonaws.${var.region}.kinesis-streams"
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets
  tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-endpoint-kinesis-01"
    Environment = local.tags.Environment
  }
  vpc_endpoint_type = "Interface"
  security_group_ids = [aws_security_group.databricks_sg.id]
  private_dns_enabled = true
}

# ------------------ STS Endpoint --------------------#

resource "aws_vpc_endpoint" "sts" {
  service_name = "com.amazonaws.${var.region}.sts"
  vpc_id = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets
  tags = {
    Owner = local.tags.Owner
    Name = "${local.tags.Name}-endpoint-sts-01"
    Environment = local.tags.Environment
  }
  vpc_endpoint_type = "Interface"
  security_group_ids = [aws_security_group.databricks_sg.id]
  private_dns_enabled = true
}