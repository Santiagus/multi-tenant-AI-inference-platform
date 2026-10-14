# M07 — AWS Platform

Depends on: M06 | Read: `.agents/skills/aws/SKILL.md`, `.agents/skills/terraform/SKILL.md`

## Objective

Create a cost-controlled cloud deployment path.

## Deliverables

- Terraform modules;
- least-privilege IAM;
- S3, SQS, EKS where justified;
- cloud deployment documentation;
- budget/cost guardrails;
- ephemeral deploy/destroy workflow.

## Acceptance criteria

Cloud deployment is reproducible and can be destroyed. No permanent GPU/EKS dependency.

## Out of scope

Always-on expensive infrastructure.

## Outcome

- Entry points: `make validate-terraform` (`scripts/validate_terraform.py`), `./infrastructure/terraform/scripts/ephemeral-lifecycle.sh`, `GET /v1/cloud/aws/status`, `POST /v1/cloud/aws/ephemeral/deploy`, `POST /v1/cloud/aws/ephemeral/:runId/destroy`, and `POST /v1/cloud/aws/workflows/execute` (`apps/api/src/routes/aws-platform.ts`).
- Terraform modules & environments: `infrastructure/terraform/modules/{s3-artifacts,sqs-async-queue,ecs-fargate-api,kinesis-event-stream,iam-least-privilege,cost-guardrails,eks-cluster}`, `infrastructure/terraform/environments/{ephemeral,production}`, and `deploy/helm/inference-platform/values-aws-ephemeral.yaml` per [ADR-0012](../../docs/adr/0012-ephemeral-aws-terraform-and-cost-guardrails.md).
- Two-Path Orchestration & TorchScript: Path A (`SQS + KEDA` fast single-hop inference) and Path B (`Flyte + Kueue + Kyverno` multi-stage CPU/GPU DAG in `apps/worker/flyte_workflow.py` per [ADR-0008](../../docs/adr/0008-keda-and-kueue-workload-responsibilities.md)), plus `TorchScript` (`torch.jit.trace`) in `apps/worker/models.py`.
- Least-privilege IAM & security: GitHub Actions OIDC (`token.actions.githubusercontent.com`), ECS Task/EKS IRSA roles (`api-irsa`, `worker-irsa`, `keda-irsa`, `lambda-metering-role`) scoped to `${bucket_arn}/tenants/*`, specific SQS/Kinesis ARNs, and Bedrock/SageMaker model ARNs with zero static keys or wildcards.
- Cost/budget guardrails & ephemeral workflow: `aws_budgets_budget` (80% forecasted / 100% actual alerts), S3 + CloudFront OAC (`$0.00/hr` fixed cost), ECS Fargate (`desired_count = 0` ephemeral), Kinesis `ON_DEMAND` + Lambda, and `enable_eks = false` / `gpu_min_nodes = 0` default (zero permanent GPU/EKS dependency).
- Documentation & verification: `docs/architecture/aws-deployment.md` (with vertical `flowchart TD` Two-Path Mermaid diagram), 57 Python tests and 61 TypeScript tests (100% coverage on `aws-platform.ts` and `routes/aws-platform.ts`), verified via `make ci`.
- Deviations & stubs: None; always-on expensive infrastructure remains out of scope per milestone spec.

