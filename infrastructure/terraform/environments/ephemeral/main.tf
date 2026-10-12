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
      Project           = "multi-tenant-ai-inference-platform"
      Environment       = "ephemeral"
      ManagedBy         = "terraform"
      EphemeralTTLHours = tostring(var.ephemeral_ttl_hours)
    }
  }
}

variable "aws_region" {
  description = "AWS region for ephemeral cloud verification"
  type        = string
  default     = "eu-central-1"
}

variable "aws_account_id" {
  description = "AWS account ID placeholder or injected via TF_VAR_aws_account_id"
  type        = string
  default     = "000000000000"
}

variable "ephemeral_run_id" {
  description = "Unique identifier for the ephemeral run (used to isolate S3/SQS/ECS/Kinesis names)"
  type        = string
  default     = "dev-ephemeral-01"
}

variable "github_repository" {
  description = "GitHub repository in 'owner/repo' format for OIDC federation"
  type        = string
  default     = "org/multi-tenant-AI-inference-platform"
}

variable "enable_eks" {
  description = "Opt-in toggle for EKS cluster (false by default so no permanent EKS/GPU dependency exists)"
  type        = bool
  default     = false
}

variable "enable_gpu_node_group" {
  description = "Opt-in toggle for scale-to-zero GPU node group when enable_eks is true"
  type        = bool
  default     = false
}

variable "enable_kinesis" {
  description = "Opt-in toggle for Kinesis + Lambda telemetry stream (false by default in ephemeral mode)"
  type        = bool
  default     = false
}

variable "monthly_budget_limit_usd" {
  description = "Monthly cost guardrail cap in USD for ephemeral cloud environments"
  type        = string
  default     = "25.0"
}

variable "ephemeral_ttl_hours" {
  description = "Maximum time-to-live (hours) before ephemeral stack is automatically destroyed"
  type        = number
  default     = 4
}

variable "alert_subscriber_emails" {
  description = "Operator email list for AWS Budget threshold alerts"
  type        = list(string)
  default     = ["finops-alerts@example.invalid"]
}

variable "subnet_ids" {
  description = "Private subnet IDs used for ECS Fargate tasks and optional EKS nodes"
  type        = list(string)
  default     = ["subnet-00000001", "subnet-00000002"]
}

locals {
  name_prefix = "inference-ephemeral-${var.ephemeral_run_id}"
  common_tags = {
    Environment       = "ephemeral"
    EphemeralRunId    = var.ephemeral_run_id
    EphemeralTTLHours = tostring(var.ephemeral_ttl_hours)
    ManagedBy         = "terraform"
  }
}

module "s3_artifacts" {
  source = "../../modules/s3-artifacts"

  bucket_name              = "${local.name_prefix}-artifacts"
  environment              = "ephemeral"
  force_destroy            = true
  ephemeral_retention_days = 1
  tags                     = local.common_tags
}

module "sqs_async_queue" {
  source = "../../modules/sqs-async-queue"

  queue_name                 = "${local.name_prefix}-jobs"
  dlq_name                   = "${local.name_prefix}-jobs-dlq"
  environment                = "ephemeral"
  visibility_timeout_seconds = 120
  max_receive_count          = 3
  message_retention_seconds  = 14400
  dlq_retention_seconds      = 86400
  tags                       = local.common_tags
}

module "iam_least_privilege" {
  source = "../../modules/iam-least-privilege"

  name_prefix              = local.name_prefix
  environment              = "ephemeral"
  aws_region               = var.aws_region
  aws_account_id           = var.aws_account_id
  github_repository        = var.github_repository
  eks_oidc_provider_arn    = "arn:aws:iam::${var.aws_account_id}:oidc-provider/oidc.eks.${var.aws_region}.amazonaws.com/id/EPHEMERAL000000"
  eks_oidc_issuer_hostpath = "oidc.eks.${var.aws_region}.amazonaws.com/id/EPHEMERAL000000"
  s3_bucket_arn            = module.s3_artifacts.bucket_arn
  sqs_main_queue_arn       = module.sqs_async_queue.queue_arn
  sqs_dlq_arn              = module.sqs_async_queue.dlq_arn
  kinesis_stream_arn       = "arn:aws:kinesis:${var.aws_region}:${var.aws_account_id}:stream/${local.name_prefix}-events"
  tags                     = local.common_tags
}

module "ecs_fargate_api" {
  source = "../../modules/ecs-fargate-api"

  service_name        = "${local.name_prefix}-api"
  environment         = "ephemeral"
  task_role_arn       = module.iam_least_privilege.api_irsa_role_arn
  execution_role_arn  = module.iam_least_privilege.api_irsa_role_arn
  subnet_ids          = var.subnet_ids
  desired_count       = 0
  s3_bucket_name      = module.s3_artifacts.bucket_id
  sqs_queue_url       = module.sqs_async_queue.queue_url
  kinesis_stream_name = "${local.name_prefix}-events"
  tags                = local.common_tags
}

module "kinesis_event_stream" {
  count  = var.enable_kinesis ? 1 : 0
  source = "../../modules/kinesis-event-stream"

  stream_name          = "${local.name_prefix}-events"
  lambda_function_name = "${local.name_prefix}-metering-processor"
  lambda_role_arn      = module.iam_least_privilege.lambda_metering_role_arn
  environment          = "ephemeral"
  tags                 = local.common_tags
}

module "cost_guardrails" {
  source = "../../modules/cost-guardrails"

  budget_name             = "${local.name_prefix}-budget"
  environment             = "ephemeral"
  monthly_limit_usd       = var.monthly_budget_limit_usd
  ephemeral_ttl_hours     = var.ephemeral_ttl_hours
  alert_subscriber_emails = var.alert_subscriber_emails
  tags                    = local.common_tags
}

module "eks_cluster" {
  count  = var.enable_eks ? 1 : 0
  source = "../../modules/eks-cluster"

  cluster_name          = "${local.name_prefix}-eks"
  environment           = "ephemeral"
  subnet_ids            = var.subnet_ids
  cpu_min_nodes         = 1
  cpu_max_nodes         = 2
  enable_gpu_node_group = var.enable_gpu_node_group
  gpu_min_nodes         = 0
  gpu_max_nodes         = 1
  gpu_capacity_type     = "SPOT"
  tags                  = local.common_tags
}

output "s3_bucket_name" {
  description = "Ephemeral S3 artifact bucket name"
  value       = module.s3_artifacts.bucket_id
}

output "cloudfront_domain_name" {
  description = "Pay-per-use CloudFront edge CDN domain name"
  value       = module.s3_artifacts.cloudfront_domain_name
}

output "sqs_queue_url" {
  description = "Ephemeral SQS main queue URL"
  value       = module.sqs_async_queue.queue_url
}

output "sqs_dlq_url" {
  description = "Ephemeral SQS dead-letter queue URL"
  value       = module.sqs_async_queue.dlq_url
}

output "ecs_api_service_name" {
  description = "ECS Fargate TypeScript API service name"
  value       = module.ecs_fargate_api.ecs_service_name
}

output "api_irsa_role_arn" {
  description = "Least-privilege API role ARN (ECS Fargate + EKS IRSA)"
  value       = module.iam_least_privilege.api_irsa_role_arn
}

output "worker_irsa_role_arn" {
  description = "Least-privilege Worker IRSA role ARN"
  value       = module.iam_least_privilege.worker_irsa_role_arn
}

output "eks_enabled" {
  description = "Whether optional EKS cluster provisioning was enabled"
  value       = var.enable_eks
}
