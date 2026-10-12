terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

variable "name_prefix" {
  description = "Resource name prefix (e.g. inference-platform-ephemeral)"
  type        = string
}

variable "environment" {
  description = "Deployment environment name (ephemeral, staging, production)"
  type        = string
}

variable "aws_region" {
  description = "Target AWS region for scoped Bedrock and SageMaker model ARNs"
  type        = string
}

variable "aws_account_id" {
  description = "Target AWS account ID for scoped resource ARNs"
  type        = string
}

variable "github_repository" {
  description = "GitHub repository in 'owner/repo' format allowed to assume OIDC role"
  type        = string
}

variable "eks_oidc_provider_arn" {
  description = "ARN of the EKS OIDC provider for IRSA trust policies (placeholder when EKS is disabled)"
  type        = string
}

variable "eks_oidc_issuer_hostpath" {
  description = "EKS OIDC issuer hostpath without https:// prefix for IRSA sub/aud conditions"
  type        = string
}

variable "s3_bucket_arn" {
  description = "ARN of the S3 artifact bucket"
  type        = string
}

variable "sqs_main_queue_arn" {
  description = "ARN of the primary async inference SQS queue"
  type        = string
}

variable "sqs_dlq_arn" {
  description = "ARN of the dead-letter SQS queue"
  type        = string
}

variable "kinesis_stream_arn" {
  description = "ARN of the Kinesis real-time telemetry and metering stream"
  type        = string
}

variable "tags" {
  description = "Common cost-allocation and governance tags"
  type        = map(string)
  default     = {}
}

# 1. GitHub Actions OIDC Identity Provider (Short-Lived Federated CI/CD Credentials)
resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = merge(var.tags, {
    Name        = "${var.name_prefix}-github-oidc"
    Environment = var.environment
    Component   = "iam-oidc"
  })
}

resource "aws_iam_role" "github_oidc_deployer" {
  name                 = "${var.name_prefix}-github-oidc-deployer"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GitHubActionsOIDCFederation"
        Effect = "Allow"
        Principal = {
          Federated = aws_iam_openid_connect_provider.github_actions.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:*"
          }
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.name_prefix}-github-oidc-deployer"
    Environment = var.environment
    Component   = "iam-oidc"
  })
}

# 2. Control Plane TypeScript API Role (ECS Fargate Task Role + EKS IRSA)
resource "aws_iam_role" "api_irsa" {
  name                 = "${var.name_prefix}-api-irsa"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ApiServiceAccountIRSA"
        Effect = "Allow"
        Principal = {
          Federated = var.eks_oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${var.eks_oidc_issuer_hostpath}:aud" = "sts.amazonaws.com"
            "${var.eks_oidc_issuer_hostpath}:sub" = "system:serviceaccount:inference-platform:inference-api-sa"
          }
        }
      },
      {
        Sid    = "EcsFargateApiTaskTrust"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.name_prefix}-api-irsa"
    Environment = var.environment
    Component   = "iam-irsa-api"
  })
}

resource "aws_iam_role_policy" "api_least_privilege" {
  name = "${var.name_prefix}-api-least-privilege"
  role = aws_iam_role.api_irsa.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowQueueEnqueueAndDepthInspection"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [var.sqs_main_queue_arn]
      },
      {
        Sid    = "AllowDlqReadInspection"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [var.sqs_dlq_arn]
      },
      {
        Sid    = "AllowTenantScopedArtifactReadWrite"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = ["${var.s3_bucket_arn}/tenants/*"]
      },
      {
        Sid    = "AllowBucketHeadReadinessCheck"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [var.s3_bucket_arn]
        Condition = {
          StringLike = {
            "s3:prefix" = ["tenants/*"]
          }
        }
      },
      {
        Sid    = "AllowKinesisLifecycleEventPublish"
        Effect = "Allow"
        Action = [
          "kinesis:PutRecord",
          "kinesis:PutRecords"
        ]
        Resource = [var.kinesis_stream_arn]
      }
    ]
  })
}

# 3. Inference Worker Role (IRSA) — Scoped to Queue Consumption, Tenant Artifacts, Kinesis Metering & Cloud Models
resource "aws_iam_role" "worker_irsa" {
  name                 = "${var.name_prefix}-worker-irsa"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WorkerServiceAccountIRSA"
        Effect = "Allow"
        Principal = {
          Federated = var.eks_oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${var.eks_oidc_issuer_hostpath}:aud" = "sts.amazonaws.com"
            "${var.eks_oidc_issuer_hostpath}:sub" = "system:serviceaccount:inference-workers:inference-worker-sa"
          }
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.name_prefix}-worker-irsa"
    Environment = var.environment
    Component   = "iam-irsa-worker"
  })
}

resource "aws_iam_role_policy" "worker_least_privilege" {
  name = "${var.name_prefix}-worker-least-privilege"
  role = aws_iam_role.worker_irsa.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowQueueLeaseAndAcknowledge"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [var.sqs_main_queue_arn]
      },
      {
        Sid    = "AllowDeadLetterQuarantineEnqueue"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = [var.sqs_dlq_arn]
      },
      {
        Sid    = "AllowTenantArtifactPersistence"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = ["${var.s3_bucket_arn}/tenants/*"]
      },
      {
        Sid    = "AllowKinesisTokenMeteringEmit"
        Effect = "Allow"
        Action = [
          "kinesis:PutRecord",
          "kinesis:PutRecords"
        ]
        Resource = [var.kinesis_stream_arn]
      },
      {
        Sid    = "AllowScopedCloudInferenceAdapters"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "sagemaker:InvokeEndpoint"
        ]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/meta.llama3-*",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/mistral.*",
          "arn:aws:sagemaker:${var.aws_region}:${var.aws_account_id}:endpoint/inference-platform-*"
        ]
      }
    ]
  })
}

# 4. KEDA Operator Role (IRSA) — Strictly Read-Only Queue Depth Polling
resource "aws_iam_role" "keda_irsa" {
  name                 = "${var.name_prefix}-keda-irsa"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KedaOperatorIRSA"
        Effect = "Allow"
        Principal = {
          Federated = var.eks_oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${var.eks_oidc_issuer_hostpath}:aud" = "sts.amazonaws.com"
            "${var.eks_oidc_issuer_hostpath}:sub" = "system:serviceaccount:inference-platform:keda-operator"
          }
        }
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.name_prefix}-keda-irsa"
    Environment = var.environment
    Component   = "iam-irsa-keda"
  })
}

resource "aws_iam_role_policy" "keda_least_privilege" {
  name = "${var.name_prefix}-keda-least-privilege"
  role = aws_iam_role.keda_irsa.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowReadOnlyQueueMetricsForScaling"
        Effect = "Allow"
        Action = [
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [var.sqs_main_queue_arn]
      }
    ]
  })
}

# 5. AWS Lambda Kinesis Metering Consumer Role
resource "aws_iam_role" "lambda_metering" {
  name                 = "${var.name_prefix}-lambda-metering-role"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "LambdaExecutionTrust"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(var.tags, {
    Name        = "${var.name_prefix}-lambda-metering-role"
    Environment = var.environment
    Component   = "iam-lambda-metering"
  })
}

resource "aws_iam_role_policy" "lambda_metering_least_privilege" {
  name = "${var.name_prefix}-lambda-metering-least-privilege"
  role = aws_iam_role.lambda_metering.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowScopedKinesisStreamRead"
        Effect = "Allow"
        Action = [
          "kinesis:GetRecords",
          "kinesis:GetShardIterator",
          "kinesis:DescribeStream",
          "kinesis:DescribeStreamSummary",
          "kinesis:ListShards"
        ]
        Resource = [var.kinesis_stream_arn]
      }
    ]
  })
}

output "github_oidc_role_arn" {
  description = "ARN of the short-lived GitHub Actions OIDC deployment role"
  value       = aws_iam_role.github_oidc_deployer.arn
}

output "api_irsa_role_arn" {
  description = "ARN of the least-privilege Control Plane API role (ECS Fargate + EKS IRSA)"
  value       = aws_iam_role.api_irsa.arn
}

output "worker_irsa_role_arn" {
  description = "ARN of the least-privilege Inference Worker IRSA role"
  value       = aws_iam_role.worker_irsa.arn
}

output "keda_irsa_role_arn" {
  description = "ARN of the read-only KEDA SQS scaler IRSA role"
  value       = aws_iam_role.keda_irsa.arn
}

output "lambda_metering_role_arn" {
  description = "ARN of the least-privilege AWS Lambda Kinesis metering role"
  value       = aws_iam_role.lambda_metering.arn
}
