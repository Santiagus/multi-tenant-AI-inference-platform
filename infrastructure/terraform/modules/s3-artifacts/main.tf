terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

variable "bucket_name" {
  description = "Globally unique name for the S3 inference artifacts bucket"
  type        = string
}

variable "environment" {
  description = "Deployment environment name (ephemeral, staging, production)"
  type        = string
}

variable "force_destroy" {
  description = "Allow Terraform destroy to delete non-empty bucket in ephemeral environments"
  type        = bool
  default     = false
}

variable "ephemeral_retention_days" {
  description = "Days before tenant artifacts automatically expire to bound storage spend"
  type        = number
  default     = 7
}

variable "kms_key_arn" {
  description = "Optional customer-managed KMS key ARN for SSE-KMS encryption (defaults to AES256)"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Common cost-allocation and governance tags"
  type        = map(string)
  default     = {}
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = var.bucket_name
  force_destroy = var.force_destroy

  tags = merge(var.tags, {
    Name        = var.bucket_name
    Environment = var.environment
    Component   = "artifact-storage"
  })
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = var.environment == "production" ? "Enabled" : "Suspended"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.kms_key_arn != "" ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_key_arn != "" ? var.kms_key_arn : null
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-ephemeral-tenant-artifacts"
    status = "Enabled"

    filter {
      prefix = "tenants/"
    }

    expiration {
      days = var.ephemeral_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_cloudfront_origin_access_control" "artifacts_oac" {
  name                              = "${var.bucket_name}-oac"
  description                       = "Origin Access Control for private S3 inference and media artifacts"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "artifacts_cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Pay-per-use CloudFront edge CDN for ${var.bucket_name}"
  price_class         = "PriceClass_100"
  wait_for_deployment = false

  origin {
    domain_name              = aws_s3_bucket.artifacts.bucket_regional_domain_name
    origin_id                = "s3-artifacts-origin"
    origin_access_control_id = aws_cloudfront_origin_access_control.artifacts_oac.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-artifacts-origin"
    viewer_protocol_policy = "https-only"
    compress               = true
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  tags = merge(var.tags, {
    Name        = "${var.bucket_name}-cdn"
    Environment = var.environment
    Component   = "cloudfront-artifact-cdn"
  })
}

output "bucket_id" {
  description = "Name/ID of the S3 artifact bucket"
  value       = aws_s3_bucket.artifacts.id
}

output "bucket_arn" {
  description = "ARN of the S3 artifact bucket"
  value       = aws_s3_bucket.artifacts.arn
}

output "cloudfront_domain_name" {
  description = "Pay-per-use CloudFront distribution domain name for artifact delivery"
  value       = aws_cloudfront_distribution.artifacts_cdn.domain_name
}
