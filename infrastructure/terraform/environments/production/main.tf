terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "multi-tenant-ai-inference-platform"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}

variable "aws_region" {
  description = "AWS region for production topology"
  type        = string
  default     = "eu-central-1"
}

variable "aws_account_id" {
  description = "AWS account ID injected via TF_VAR_aws_account_id"
  type        = string
  default     = "000000000000"
}

variable "github_repository" {
  description = "GitHub repository in 'owner/repo' format for OIDC federation"
  type        = string
  default     = "org/multi-tenant-AI-inference-platform"
}

variable "enable_eks" {
  description = "Enable EKS control plane and scale-to-zero GPU node group in production"
  type        = bool
  default     = true
}

variable "monthly_budget_limit_usd" {
  description = "Monthly cost guardrail cap in USD for production environment"
  type        = string
  default     = "250.0"
}

variable "alert_subscriber_emails" {
  description = "Operator email list for AWS Budget threshold alerts"
  type        = list(string)
  default     = ["finops-alerts@example.invalid"]
}

variable "subnet_ids" {
  description = "Private VPC subnet IDs for production ECS Fargate API and EKS cluster"
  type        = list(string)
  default     = ["subnet-00000101", "subnet-00000102", "subnet-00000103"]
}

locals {
  name_prefix = "inference-platform-prod"
  common_tags = {
    Environment = "production"
    ManagedBy   = "terraform"
    CostCenter  = "ai-platform-prod"
  }
}

module "s3_artifacts" {
  source = "../../modules/s3-artifacts"

  bucket_name              = "${local.name_prefix}-artifacts"
  environment              = "production"
  force_destroy            = false
  ephemeral_retention_days = 30
  tags                     = local.common_tags
}

module "sqs_async_queue" {
  source = "../../modules/sqs-async-queue"

  queue_name                 = "${local.name_prefix}-jobs"
  dlq_name                   = "${local.name_prefix}-jobs-dlq"
  environment                = "production"
  visibility_timeout_seconds = 180
  max_receive_count          = 3
  message_retention_seconds  = 345600
  dlq_retention_seconds      = 1209600
  tags                       = local.common_tags
}

module "iam_least_privilege" {
  source = "../../modules/iam-least-privilege"

  name_prefix              = local.name_prefix
  environment              = "production"
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  github_repository        = var.github_repository
  eks_oidc_provider_arn    = "arn:aws:iam::${var.aws_account_id}:oidc-provider/oidc.eks.${var.aws_region}.amazonaws.com/id/PROD0000000000"
  eks_oidc_issuer_hostpath = "oidc.eks.${var.aws_region}.amazonaws.com/id/PROD0000000000"
  s3_bucket_arn            = module.s3_artifacts.bucket_arn
  sqs_main_queue_arn       = module.sqs_async_queue.queue_arn
  sqs_dlq_arn              = module.sqs_async_queue.dlq_arn
  kinesis_stream_arn       = "arn:aws:kinesis:${var.aws_region}:${var.aws_account_id}:stream/${local.name_prefix}-events"
  tags                     = local.common_tags
}

module "ecs_fargate_api" {
  source = "../../modules/ecs-fargate-api"

  service_name        = "${local.name_prefix}-api"
  environment         = "production"
  task_role_arn       = module.iam_least_privilege.api_irsa_role_arn
  execution_role_arn  = module.iam_least_privilege.api_irsa_role_arn
  subnet_ids          = var.subnet_ids
  desired_count       = 2
  s3_bucket_name      = module.s3_artifacts.bucket_id
  sqs_queue_url       = module.sqs_async_queue.queue_url
  kinesis_stream_name = "${local.name_prefix}-events"
  tags                = local.common_tags
}

module "kinesis_event_stream" {
  source = "../../modules/kinesis-event-stream"

  stream_name          = "${local.name_prefix}-events"
  lambda_function_name = "${local.name_prefix}-metering-processor"
  lambda_role_arn      = module.iam_least_privilege.lambda_metering_role_arn
  environment          = "production"
  tags                 = local.common_tags
}

module "cost_guardrails" {
  source = "../../modules/cost-guardrails"

  budget_name             = "${local.name_prefix}-budget"
  environment             = "production"
  monthly_limit_usd       = var.monthly_budget_limit_usd
  ephemeral_ttl_hours     = 0
  alert_subscriber_emails = var.alert_subscriber_emails
  tags                    = local.common_tags
}

module "eks_cluster" {
  count  = var.enable_eks ? 1 : 0
  source = "../../modules/eks-cluster"

  cluster_name          = "${local.name_prefix}-eks"
  environment           = "production"
  subnet_ids            = var.subnet_ids
  cpu_min_nodes         = 2
  cpu_max_nodes         = 6
  enable_gpu_node_group = true
  gpu_min_nodes         = 0
  gpu_max_nodes         = 4
  gpu_capacity_type     = "SPOT"
  tags                  = local.common_tags
}

output "s3_bucket_name" {
  description = "Production S3 artifact bucket name"
  value       = module.s3_artifacts.bucket_id
}

output "cloudfront_domain_name" {
  description = "Production CloudFront CDN domain name"
  value       = module.s3_artifacts.cloudfront_domain_name
}

output "sqs_queue_url" {
  description = "Production SQS main queue URL"
  value       = module.sqs_async_queue.queue_url
}

output "ecs_api_service_name" {
  description = "Production ECS Fargate TypeScript API service name"
  value       = module.ecs_fargate_api.ecs_service_name
}

output "eks_enabled" {
  description = "Whether EKS cluster is enabled in production"
  value       = var.enable_eks
}
