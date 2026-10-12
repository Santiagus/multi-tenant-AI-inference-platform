terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

variable "stream_name" {
  description = "Name of the Amazon Kinesis Data Stream for real-time job lifecycle and token metering events"
  type        = string
}

variable "lambda_function_name" {
  description = "Name of the AWS Lambda function processing Kinesis metering and DLQ alert events"
  type        = string
}

variable "lambda_role_arn" {
  description = "Least-privilege IAM role ARN for the Lambda metering consumer"
  type        = string
}

variable "environment" {
  description = "Deployment environment name (ephemeral, staging, production)"
  type        = string
}

variable "retention_period_hours" {
  description = "Kinesis stream retention period in hours (24h default)"
  type        = number
  default     = 24
}

variable "tags" {
  description = "Common cost-allocation and governance tags"
  type        = map(string)
  default     = {}
}

resource "aws_kinesis_stream" "telemetry_events" {
  name             = var.stream_name
  retention_period = var.retention_period_hours
  encryption_type  = "KMS"
  kms_key_id       = "alias/aws/kinesis"

  stream_mode_details {
    stream_mode = "ON_DEMAND"
  }

  tags = merge(var.tags, {
    Name        = var.stream_name
    Environment = var.environment
    Component   = "kinesis-event-stream"
  })
}

resource "aws_lambda_function" "metering_processor" {
  function_name = var.lambda_function_name
  role          = var.lambda_role_arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "metering-processor.zip"
  timeout       = 30
  memory_size   = 128

  environment {
    variables = {
      ENVIRONMENT         = var.environment
      KINESIS_STREAM_NAME = aws_kinesis_stream.telemetry_events.name
    }
  }

  tags = merge(var.tags, {
    Name        = var.lambda_function_name
    Environment = var.environment
    Component   = "lambda-metering-processor"
  })
}

resource "aws_lambda_event_source_mapping" "kinesis_to_lambda" {
  event_source_arn  = aws_kinesis_stream.telemetry_events.arn
  function_name     = aws_lambda_function.metering_processor.arn
  starting_position = "LATEST"
  batch_size        = 100
  enabled           = true
}

output "stream_name" {
  description = "Name of the Kinesis real-time telemetry and metering stream"
  value       = aws_kinesis_stream.telemetry_events.name
}

output "stream_arn" {
  description = "ARN of the Kinesis real-time telemetry and metering stream"
  value       = aws_kinesis_stream.telemetry_events.arn
}

output "lambda_function_arn" {
  description = "ARN of the AWS Lambda metering & event processor function"
  value       = aws_lambda_function.metering_processor.arn
}

