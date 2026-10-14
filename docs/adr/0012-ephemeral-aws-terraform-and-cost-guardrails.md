# ADR-0012: Ephemeral-First AWS Terraform Architecture, OIDC/IRSA Least-Privilege IAM, and Cost Guardrails

- **Status**: Accepted
- **Date**: 2026-10-12
- **Deciders**: Architecture Team

---

## Context & Problem Statement

Deploying a multi-tenant AI inference platform to AWS carries three major operational and financial risks if not bounded by architectural controls:
1. **Always-On Compute & Control-Plane Bleed**: Leaving an Amazon EKS control plane (`$0.10/hr` = `~$73/month`), NAT Gateways, or GPU worker instances (`g5.xlarge` / `g6.xlarge`) running permanently during development and verification creates continuous cloud spend even when zero inference jobs are executing.
2. **Long-Lived Cloud Credentials & Over-Permissive IAM**: Storing static AWS Access Keys (`AKIA...`) in CI/CD or granting broad `s3:*`, `sqs:*`, or `*` resource wildcards to control-plane and worker pods violates least-privilege security and increases the blast radius of any container compromise.
3. **Unbounded Spend on Traffic or Retry Loops**: Without automated AWS Budgets alerts, hard node-group scaling ceilings, S3 artifact lifecycle expiration, and ephemeral TTL tags, a runaway benchmark or poison-pill loop can exceed monthly development budgets before billing dashboards update.

We need a reproducible, modular Terraform cloud deployment path that decouples the stateless **TypeScript API on AWS ECS Fargate** from the **Python/PyTorch/TorchScript GPU workers on Kubernetes (EKS)**, serves artifacts through **S3 + CloudFront**, separates **SQS task dispatch** from **Kinesis + Lambda event/metering streams**, and enforces hard budget guardrails and ephemeral teardown.

## Decision Drivers

- **Zero permanent GPU/EKS dependency**: Developers and CI must be able to deploy the core serverless AWS stack (`S3 + CloudFront`, `SQS`, `ECS Fargate` with `desired_count = 0`, `IAM OIDC/IRSA`, and `AWS Budgets`) in seconds at `$0.00/hr` idle cost, and opt-in to `EKS` (`enable_eks = true`) or `Kinesis + Lambda` (`enable_kinesis = true`) only when executing full cluster/stream tests.
- **Short-lived federated credentials**: Authenticate GitHub Actions via OpenID Connect (`aws_iam_openid_connect_provider`), ECS Fargate tasks via task IAM roles, and Kubernetes service accounts via IAM Roles for Service Accounts (IRSA) scoped to exact S3 bucket/prefix ARNs, SQS queue ARNs, Kinesis stream ARNs, and Bedrock/SageMaker model ARNs.
- **Offline & CI verifiability**: Every Terraform module and environment root must pass formatting, structural validation, IAM least-privilege static analysis, and cost/budget guardrail verification via `make validate-terraform` (`scripts/validate_terraform.py`) without requiring live AWS credentials.

## Considered Options

1. **Modular Terraform (`s3-artifacts` + CloudFront, `sqs-async-queue`, `ecs-fargate-api`, `kinesis-event-stream` + Lambda, `iam-least-privilege`, `cost-guardrails`, conditional `eks-cluster`) with `ephemeral` and `production` roots**
2. **Monolithic Single-Stack Terraform with Always-On EKS and Static Node Groups**
3. **AWS CDK / CloudFormation Templates**
4. **Manual AWS CLI Scripts without Declarative State**

## Decision Outcome

**Chosen option: Modular Terraform with Ephemeral-First Defaults (`enable_eks = false`, `enable_gpu_node_group = false`, `enable_kinesis = false`, ECS `desired_count = 0` in ephemeral root) and Enforced Cost/IAM Guardrails**.

### Module Boundaries ([`infrastructure/terraform/modules/`](../../infrastructure/terraform/modules/))

1. **`s3-artifacts` (S3 + CloudFront CDN)**:
   - Provisions the tenant artifact bucket with `aws_s3_bucket_public_access_block` (all 4 public blocks enabled), `aws_s3_bucket_server_side_encryption_configuration` (`aws:kms` or `AES256`), `aws_s3_bucket_lifecycle_configuration` (`ephemeral_retention_days`), and a pay-per-use **Amazon CloudFront distribution** (`aws_cloudfront_distribution` + `aws_cloudfront_origin_access_control` OAC, `$0.00/hr` fixed cost).
2. **`sqs-async-queue` (Task Dispatch + DLQ)**:
   - Provisions the primary async inference queue (`inference-jobs`) and dead-letter queue (`inference-jobs-dlq`) with `sqs_managed_sse_enabled = true`, long polling (`receive_wait_time_seconds = 20`), visibility timeout aligned with worker heartbeat, and redrive policy (`maxReceiveCount = 3`).
3. **`ecs-fargate-api` (TypeScript Control Plane on AWS Fargate)**:
   - Provisions an `aws_ecs_cluster` (`$0.00/hr` cluster fee), `FARGATE` / `FARGATE_SPOT` capacity providers, and an `aws_ecs_task_definition` + `aws_ecs_service` (`assign_public_ip = false`) for the TypeScript Fastify API, decoupling control-plane availability from GPU worker clusters.
4. **`kinesis-event-stream` (Kinesis Data Stream + AWS Lambda Metering Consumer)**:
   - Provisions a KMS-encrypted `aws_kinesis_stream` (`ON_DEMAND` mode) for real-time job lifecycle and token-usage event fan-out, paired with an `aws_lambda_function` and `aws_lambda_event_source_mapping` consumer.
5. **`iam-least-privilege` (OIDC + ECS Task Role + EKS IRSA + Lambda Role)**:
   - Configures GitHub OIDC federation (`token.actions.githubusercontent.com`) restricted to `repo:<org>/<repo>:*` with `sts:AssumeRoleWithWebIdentity`.
   - Defines least-privilege IAM roles and policies for the API (`api-irsa`), Worker (`worker-irsa`), KEDA scaler (`keda-irsa`), and Lambda metering processor (`lambda-metering-role`) with zero wildcard actions or wildcard resources.
6. **`cost-guardrails` (AWS Budgets + TTL Governance)**:
   - Provisions `aws_budgets_budget` (`COST` budget) with forecasted (`80%`) and actual (`100%`) spend alert notifications, plus mandatory cost-allocation tags (`Environment`, `EphemeralTTLHours`, `ManagedBy = "terraform"`).
7. **`eks-cluster` (Conditional via `enable_eks`)**:
   - Provisions the EKS control plane, a bounded CPU system node group, and a scale-to-zero GPU node group (`min_size = 0`, `desired_size = 0`, `max_size = gpu_max_nodes`, `capacity_type = "SPOT"`).

## Consequences

- **Positive**:
  - Ephemeral deployments (`deploy` → `verify` → `destroy`) complete quickly, require zero permanent EKS or GPU capacity, and guarantee clean teardown (`0` surviving billable resources).
  - Static security analysis in [`scripts/validate_terraform.py`](../../scripts/validate_terraform.py) rejects any IAM policy containing wildcard actions (`*`, `s3:*`, `sqs:*`, `ecs:*`, `kinesis:*`, `lambda:*`), wildcard resources (`*`), public S3 buckets, unencrypted queues/streams, or GPU node groups with `min_size > 0`.
- **Negative / Trade-offs**:
  - When `enable_eks = true` is explicitly toggled for full-cluster cloud runs, AWS EKS control plane provisioning adds ~10–12 minutes to initial bootstrap time.
