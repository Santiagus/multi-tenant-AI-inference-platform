terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

variable "queue_name" {
  description = "Name of the primary asynchronous inference SQS queue"
  type        = string
}

variable "dlq_name" {
  description = "Name of the dead-letter SQS queue for poison-pill isolation"
  type        = string
}

variable "environment" {
  description = "Deployment environment name (ephemeral, staging, production)"
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "Visibility timeout in seconds aligned with inference worker execution lease"
  type        = number
  default     = 120
}

variable "max_receive_count" {
  description = "Maximum delivery attempts before routing poison message to DLQ"
  type        = number
  default     = 3
}

variable "message_retention_seconds" {
  description = "Retention period for primary queue messages in seconds"
  type        = number
  default     = 86400
}

variable "dlq_retention_seconds" {
  description = "Retention period for dead-letter queue messages in seconds (7 days default)"
  type        = number
  default     = 604800
}

variable "tags" {
  description = "Common cost-allocation and governance tags"
  type        = map(string)
  default     = {}
}

resource "aws_sqs_queue" "dlq" {
  name                      = var.dlq_name
  message_retention_seconds = var.dlq_retention_seconds
  sqs_managed_sse_enabled   = true

  tags = merge(var.tags, {
    Name        = var.dlq_name
    Environment = var.environment
    Component   = "async-queue-dlq"
  })
}

resource "aws_sqs_queue" "main" {
  name                       = var.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = merge(var.tags, {
    Name        = var.queue_name
    Environment = var.environment
    Component   = "async-queue-main"
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main.arn]
  })
}

output "queue_url" {
  description = "URL of the primary async inference SQS queue"
  value       = aws_sqs_queue.main.url
}

output "queue_arn" {
  description = "ARN of the primary async inference SQS queue"
  value       = aws_sqs_queue.main.arn
}

output "dlq_url" {
  description = "URL of the dead-letter SQS queue"
  value       = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  description = "ARN of the dead-letter SQS queue"
  value       = aws_sqs_queue.dlq.arn
}
