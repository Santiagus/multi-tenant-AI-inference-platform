---
name: aws
description: AWS services (IAM, S3, SQS, EKS, Bedrock, SageMaker), credentials and cloud cost controls.
---

# AWS

- Least-privilege IAM and short-lived credentials.
- Expected services: S3, SQS, EKS, Bedrock, SageMaker.
- GitHub OIDC instead of long-lived AWS access keys in GitHub.
- Cloud resources are cost-controlled and preferably ephemeral during development.
