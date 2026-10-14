---
name: terraform
description: Terraform structure, validation, static analysis and safe plan/apply for AWS infrastructure.
---

# Terraform

Use modules only where they improve reuse (`infrastructure/terraform/modules/{s3-artifacts,sqs-async-queue,ecs-fargate-api,kinesis-event-stream,iam-least-privilege,cost-guardrails,eks-cluster}`).

Every change supports: fmt · validate · lint · security/static analysis · plan review via `make validate-terraform` (`python3 scripts/validate_terraform.py`).

Never hardcode secrets. Production apply requires explicit approval (`CONFIRM_PRODUCTION_APPLY=yes` in `./infrastructure/terraform/scripts/ephemeral-lifecycle.sh` and `confirm_production_apply: true` in `/v1/cloud/aws/ephemeral/deploy`).

