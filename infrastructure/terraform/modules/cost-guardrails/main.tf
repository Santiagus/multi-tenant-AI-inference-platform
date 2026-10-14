terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

variable "budget_name" {
  description = "Name of the AWS Cost Budget guardrail"
  type        = string
}

variable "environment" {
  description = "Deployment environment name (ephemeral, staging, production)"
  type        = string
}

variable "monthly_limit_usd" {
  description = "Hard monthly USD spend budget threshold before triggering alerts"
  type        = string
  default     = "25.0"
}

variable "ephemeral_ttl_hours" {
  description = "Maximum allowed time-to-live (hours) for ephemeral deployments before auto-destroy"
  type        = number
  default     = 4
}

variable "alert_subscriber_emails" {
  description = "List of operator email addresses notified at 80% forecasted and 100% actual spend"
  type        = list(string)
}

variable "tags" {
  description = "Common cost-allocation and governance tags"
  type        = map(string)
  default     = {}
}

resource "aws_budgets_budget" "platform_cost_guardrail" {
  name              = var.budget_name
  budget_type       = "COST"
  limit_amount      = var.monthly_limit_usd
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-10-01_00:00"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Environment$${var.environment}"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.alert_subscriber_emails
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = var.alert_subscriber_emails
  }

  tags = merge(var.tags, {
    Name              = var.budget_name
    Environment       = var.environment
    EphemeralTTLHours = tostring(var.ephemeral_ttl_hours)
    Component         = "cost-guardrails"
  })
}

output "budget_id" {
  description = "ID of the AWS Cost Budget guardrail"
  value       = aws_budgets_budget.platform_cost_guardrail.id
}

output "monthly_limit_usd" {
  description = "Configured monthly USD budget cap"
  value       = var.monthly_limit_usd
}

output "ephemeral_ttl_hours" {
  description = "Configured ephemeral time-to-live in hours"
  value       = var.ephemeral_ttl_hours
}
