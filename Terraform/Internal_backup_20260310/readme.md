# 테라폼 초기화
terraform init

# 테라폼 계획
terraform plan --var-file=input.tfvars

# 테라폼 적용
terraform apply --var-file=input.tfvars -auto-approve

# 테라폼 삭제
terraform destroy --var-file=input.tfvars -auto-approve