---
name: aws
description: AWS services (IAM, S3, CloudFront, SQS, ECS Fargate, Kinesis, Lambda, EKS, Bedrock, SageMaker), credentials and cloud cost controls.
---

# AWS

- Least-privilege IAM and short-lived credentials (`sts:AssumeRoleWithWebIdentity` via GitHub Actions OIDC, ECS Task Roles, and EKS IRSA).
- Expected services: S3 + CloudFront OAC (`s3-artifacts`), SQS (`sqs-async-queue`), ECS Fargate (`ecs-fargate-api`), Kinesis + Lambda (`kinesis-event-stream`), conditional EKS (`eks-cluster`), AWS Budgets (`cost-guardrails`), Bedrock, SageMaker.
- GitHub OIDC (`https://token.actions.githubusercontent.com`) instead of long-lived AWS access keys (`aws_iam_access_key` is prohibited).
- Cloud resources are cost-controlled and ephemeral by default (`enable_eks = false`, `fargate_desired_count = 0`, and `gpu_min_nodes = 0` in `infrastructure/terraform/environments/ephemeral`).
- Verification: `make validate-terraform` (`python3 scripts/validate_terraform.py`) and `./infrastructure/terraform/scripts/ephemeral-lifecycle.sh validate`.

