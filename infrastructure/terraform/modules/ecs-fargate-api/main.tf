terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

variable "service_name" {
  description = "Name of the ECS Fargate TypeScript API service"
  type        = string
}

variable "environment" {
  description = "Deployment environment name (ephemeral, staging, production)"
  type        = string
}

variable "api_image" {
  description = "Container image URI for the TypeScript Fastify Control Plane API"
  type        = string
  default     = "ghcr.io/multi-tenant-ai-inference-platform/api:0.6.0"
}

variable "task_role_arn" {
  description = "Least-privilege IAM role ARN assumed by the TypeScript API container"
  type        = string
}

variable "execution_role_arn" {
  description = "IAM execution role ARN for ECS Fargate agent to pull images and emit logs"
  type        = string
}

variable "subnet_ids" {
  description = "Private VPC subnet IDs for the ECS Fargate tasks"
  type        = list(string)
}

variable "desired_count" {
  description = "Desired task count (0 in ephemeral default so idle compute cost is $0.00/hr)"
  type        = number
  default     = 0
}

variable "cpu_units" {
  description = "Fargate task CPU units (256 = 0.25 vCPU, 512 = 0.5 vCPU)"
  type        = string
  default     = "256"
}

variable "memory_mib" {
  description = "Fargate task memory in MiB"
  type        = string
  default     = "512"
}

variable "s3_bucket_name" {
  description = "Name of the S3 artifact bucket injected into the API container"
  type        = string
}

variable "sqs_queue_url" {
  description = "URL of the primary SQS queue injected into the API container"
  type        = string
}

variable "kinesis_stream_name" {
  description = "Name of the Kinesis telemetry/metering stream injected into the API container"
  type        = string
}

variable "tags" {
  description = "Common cost-allocation and governance tags"
  type        = map(string)
  default     = {}
}

resource "aws_ecs_cluster" "control_plane" {
  name = "${var.service_name}-cluster"

  setting {
    name  = "containerInsights"
    value = var.environment == "production" ? "enabled" : "disabled"
  }

  tags = merge(var.tags, {
    Name        = "${var.service_name}-cluster"
    Environment = var.environment
    Component   = "ecs-fargate-api"
  })
}

resource "aws_ecs_cluster_capacity_providers" "control_plane" {
  cluster_name       = aws_ecs_cluster.control_plane.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 0
    weight            = 100
    capacity_provider = var.environment == "production" ? "FARGATE" : "FARGATE_SPOT"
  }
}

resource "aws_ecs_task_definition" "typescript_api" {
  family                   = "${var.service_name}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu_units
  memory                   = var.memory_mib
  task_role_arn            = var.task_role_arn
  execution_role_arn       = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name      = "inference-control-plane-api"
      image     = var.api_image
      essential = true
      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "S3_BUCKET"
          value = var.s3_bucket_name
        },
        {
          name  = "SQS_QUEUE_URL"
          value = var.sqs_queue_url
        },
        {
          name  = "KINESIS_STREAM_NAME"
          value = var.kinesis_stream_name
        }
      ]
    }
  ])

  tags = merge(var.tags, {
    Name        = "${var.service_name}-task"
    Environment = var.environment
    Component   = "ecs-fargate-api"
  })
}

resource "aws_ecs_service" "typescript_api" {
  name            = var.service_name
  cluster         = aws_ecs_cluster.control_plane.id
  task_definition = aws_ecs_task_definition.typescript_api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    assign_public_ip = false
  }

  tags = merge(var.tags, {
    Name        = var.service_name
    Environment = var.environment
    Component   = "ecs-fargate-api"
  })
}

output "ecs_cluster_name" {
  description = "Name of the ECS Fargate cluster hosting the TypeScript API"
  value       = aws_ecs_cluster.control_plane.name
}

output "ecs_service_name" {
  description = "Name of the ECS Fargate service for the TypeScript API"
  value       = aws_ecs_service.typescript_api.name
}

