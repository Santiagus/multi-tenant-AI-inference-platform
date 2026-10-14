# AWS Cloud Deployment, Two-Path Orchestration, Least-Privilege IAM & Ephemeral Cost Controls (M07)

This document defines the modular Terraform architecture, **Two-Path Orchestration** (`SQS + KEDA` vs. `Flyte + Kueue + Kyverno`), short-lived OIDC/IRSA identity model, budget guardrails, and ephemeral deploy/destroy lifecycle for running the **Multi-Tenant AI Inference Platform** on AWS (see [ADR-0008](../adr/0008-keda-and-kueue-workload-responsibilities.md) and [ADR-0012](../adr/0012-ephemeral-aws-terraform-and-cost-guardrails.md)).

---

## 1. Two-Path Workload & Cloud Orchestration Architecture

The platform separates the **TypeScript Control Plane API (AWS ECS Fargate)** from the **Python PyTorch / TorchScript Inference Backend (Kubernetes / EKS)**, and routes workloads along two specialized execution paths:

1. **Path A — Low-Latency Async Inference (`SQS + KEDA`)**:
   - Single-step inference requests (`POST /v1/jobs`) are dispatched via **Amazon SQS** (`sqs-async-queue`), scaling warm Python worker pods (`0 -> N -> 0`) via **KEDA** for sub-second pickup.
2. **Path B — Multi-Stage Media & Batch DAGs (`Flyte + Kueue + Kyverno`)**:
   - Multi-step pipelines ([`apps/worker/flyte_workflow.py`](../../apps/worker/flyte_workflow.py)) execute as typed `@workflow` DAGs (`Step 1 @task CPU preprocess` $\rightarrow$ `Step 2 @task GPU=1 PyTorch/TorchScript` $\rightarrow$ `Step 3 @task CPU artifact packaging`), where only the GPU stage requests an `nvidia.com/gpu` pod admitted by **Kueue** (`ClusterQueue`) and enforced by **Kyverno** (`ClusterPolicy`).
3. **Edge Delivery & Real-Time Event Streaming (`S3 + CloudFront` & `Kinesis + Lambda`)**:
   - Artifacts are stored in private **Amazon S3** and served globally via pay-per-use **Amazon CloudFront** with Origin Access Control (OAC).
   - Out-of-band lifecycle transitions and token/cost metering events stream through **Amazon Kinesis** to an **AWS Lambda** processor so billing and real-time feeds never block GPU workers.

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    Clients["Tenant Applications & Real-Time Collaboration Clients"]
    API["TypeScript Control Plane API\n(AWS ECS Fargate / Fargate Spot)"]

    Clients --> API

    subgraph FastPath["Path A: Low-Latency Async Inference (SQS + KEDA)"]
        SQS["Amazon SQS + DLQ\n(Per-Job Lease & Retry)"]
        KEDA["KEDA Queue Autoscaler\n(0 -> N -> 0 Pods)"]
        WarmWorker["Warm Python Worker Pod\n(PyTorch / TorchScript)"]
        SQS --> KEDA
        KEDA --> WarmWorker
    end

    subgraph DagPath["Path B: Multi-Stage Media & Batch Pipeline (Flyte + Kueue + Kyverno)"]
        FlyteDAG["Flyte Workflow DAG (@workflow)\nmulti_stage_inference_workflow"]
        Stage1["Stage 1: @task (CPU Pod)\npreprocess_media_asset (S3 Cache)"]
        KueueGate["Kueue ClusterQueue + Kyverno Policy\n(GPU Quota Admission & Non-Root Check)"]
        Stage2["Stage 2: @task (GPU = 1 Pod)\nrun_torchscript_gpu_inference"]
        Stage3["Stage 3: @task (CPU Pod)\npackage_s3_cloudfront_artifact"]

        FlyteDAG --> Stage1
        Stage1 --> KueueGate
        KueueGate --> Stage2
        Stage2 --> Stage3
    end

    API -->|"Single-Hop Job"| SQS
    API -->|"Multi-Stage Pipeline"| FlyteDAG

    subgraph StorageAndStream["AWS Artifact Edge & Real-Time Metering"]
        S3CF["Amazon S3 + CloudFront CDN (OAC)\n(Private Bucket + Pay-Per-Use Edge)"]
        Kinesis["Amazon Kinesis Data Stream\n(Ordered Lifecycle & Token Events)"]
        Lambda["AWS Lambda Metering Processor\n(Cost Accounting & DLQ Alerts)"]
        Kinesis --> Lambda
    end

    WarmWorker --> S3CF
    Stage3 --> S3CF
    WarmWorker --> Kinesis
    Stage3 --> Kinesis
```

---

## 2. Ephemeral-First Cloud Architecture (No Permanent EKS/GPU Dependency)

To eliminate idle cloud compute bleed (`$0.10/hr` EKS control plane and `$1.00+/hr` GPU instances), the Terraform stacks separate **serverless/pay-per-use primitives** from **optional Kubernetes/GPU compute**:

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    subgraph GitHubCI["GitHub Actions / Developer CLI"]
        OIDCToken["Short-Lived OIDC JWT\n(token.actions.githubusercontent.com)"]
        LifecycleCLI["ephemeral-lifecycle.sh\n(validate / plan / deploy / destroy)"]
    end

    subgraph TerraformStack["Terraform Environment (ephemeral / production)"]
        ModIAM["Module: iam-least-privilege\nGitHub OIDC + ECS Task + EKS IRSA + Lambda Role"]
        ModS3["Module: s3-artifacts\nS3 SSE + Public Block + CloudFront CDN (OAC)"]
        ModSQS["Module: sqs-async-queue\nMain Queue + DLQ Redrive + SSE"]
        ModECS["Module: ecs-fargate-api\nTypeScript API on AWS Fargate / Fargate Spot"]
        ModKinesis["Module: kinesis-event-stream (opt-in)\nKinesis Stream + AWS Lambda Consumer"]
        ModCost["Module: cost-guardrails\nAWS Budgets (80% Forecast / 100% Actual)"]
        ModEKS["Module: eks-cluster (count = enable_eks ? 1 : 0)\nCPU Spot Nodes + Scale-to-Zero GPU NodeGroup"]
    end

    OIDCToken -->|"sts:AssumeRoleWithWebIdentity"| ModIAM
    LifecycleCLI --> ModIAM
    LifecycleCLI --> ModS3
    LifecycleCLI --> ModSQS
    LifecycleCLI --> ModECS
    LifecycleCLI --> ModCost
    LifecycleCLI -.->|"Opt-in: enable_kinesis=true"| ModKinesis
    LifecycleCLI -.->|"Opt-in: enable_eks=true"| ModEKS
```

---

## 3. Terraform Module Catalog

All infrastructure-as-code lives under [`infrastructure/terraform/`](../../infrastructure/terraform/) and is validated offline via `make validate-terraform` ([`scripts/validate_terraform.py`](../../scripts/validate_terraform.py)):

| Module / Root | Path | AWS Resources | Key Guardrails |
|---|---|---|---|
| **`s3-artifacts`** | [`modules/s3-artifacts/main.tf`](../../infrastructure/terraform/modules/s3-artifacts/main.tf) | `aws_s3_bucket`, `aws_s3_bucket_public_access_block`, `aws_s3_bucket_server_side_encryption_configuration`, `aws_s3_bucket_lifecycle_configuration`, `aws_cloudfront_origin_access_control`, `aws_cloudfront_distribution` | Blocks all public ACLs/policies, enforces `AES256`/`aws:kms` SSE, serves artifacts via pay-per-use CloudFront OAC (`$0.00/hr` fixed cost), and expires `tenants/*` objects after `ephemeral_retention_days`. |
| **`sqs-async-queue`** | [`modules/sqs-async-queue/main.tf`](../../infrastructure/terraform/modules/sqs-async-queue/main.tf) | `aws_sqs_queue.main`, `aws_sqs_queue.dlq`, `aws_sqs_queue_redrive_allow_policy` | Enables `sqs_managed_sse_enabled = true`, 20s long polling, and `maxReceiveCount = 3` DLQ redrive policy. |
| **`ecs-fargate-api`** | [`modules/ecs-fargate-api/main.tf`](../../infrastructure/terraform/modules/ecs-fargate-api/main.tf) | `aws_ecs_cluster`, `aws_ecs_cluster_capacity_providers`, `aws_ecs_task_definition`, `aws_ecs_service` | Runs TypeScript Fastify API on `FARGATE` / `FARGATE_SPOT` with `$0.00/hr` cluster control-plane fee, `assign_public_ip = false`, and `desired_count = 0` in ephemeral mode. |
| **`kinesis-event-stream`** | [`modules/kinesis-event-stream/main.tf`](../../infrastructure/terraform/modules/kinesis-event-stream/main.tf) | `aws_kinesis_stream`, `aws_lambda_function`, `aws_lambda_event_source_mapping` | KMS-encrypted (`alias/aws/kinesis`) `ON_DEMAND` event stream paired with a Node.js 20 Lambda metering processor. |
| **`iam-least-privilege`** | [`modules/iam-least-privilege/main.tf`](../../infrastructure/terraform/modules/iam-least-privilege/main.tf) | `aws_iam_openid_connect_provider`, `aws_iam_role` (`github_oidc_deployer`, `api_irsa`, `worker_irsa`, `keda_irsa`, `lambda_metering`), `aws_iam_role_policy` | Zero static IAM keys (`aws_iam_access_key` prohibited); zero wildcard actions (`*`, `s3:*`, `sqs:*`, `ecs:*`, `kinesis:*`, `lambda:*`) or wildcard resources (`*`). |
| **`cost-guardrails`** | [`modules/cost-guardrails/main.tf`](../../infrastructure/terraform/modules/cost-guardrails/main.tf) | `aws_budgets_budget.platform_cost_guardrail` | Enforces monthly USD cap (`$25` ephemeral / `$250` prod), 80% forecasted & 100% actual email alerts, and `EphemeralTTLHours` tags. |
| **`eks-cluster`** | [`modules/eks-cluster/main.tf`](../../infrastructure/terraform/modules/eks-cluster/main.tf) | `aws_eks_cluster`, `aws_eks_node_group` (`cpu_system`, `gpu_workers`) | Conditional via `enable_eks`; GPU node group enforces `desired_size = 0` and `gpu_min_nodes = 0`. |

---

## 4. Least-Privilege IAM Matrix (OIDC, ECS Task Role, EKS IRSA & Lambda)

Static long-lived AWS credentials (`AKIA...`) are prohibited across GitHub Actions, ECS Fargate, and Kubernetes workloads:

| Principal Role | Federation / Service Trust | Permitted Actions | Scoped Resource ARNs |
|---|---|---|---|
| **`github-oidc-deployer`** | `token.actions.githubusercontent.com:sub` $\in$ `repo:<org>/<repo>:*` | `sts:AssumeRoleWithWebIdentity` (`max_session_duration = 3600s`) | Ephemeral/production Terraform state & tagged stack resources |
| **`api-irsa`** | `ecs-tasks.amazonaws.com` + `system:serviceaccount:inference-platform:inference-api-sa` | `sqs:SendMessage`, `sqs:GetQueueAttributes`, `sqs:GetQueueUrl` (main); `sqs:ReceiveMessage` (DLQ); `s3:GetObject`, `s3:PutObject`, conditional `s3:ListBucket`; `kinesis:PutRecord`, `kinesis:PutRecords` | `${sqs_main_queue_arn}`, `${sqs_dlq_arn}`, `${s3_bucket_arn}/tenants/*`, `${kinesis_stream_arn}` |
| **`worker-irsa`** | `system:serviceaccount:inference-workers:inference-worker-sa` | `sqs:ReceiveMessage`, `sqs:DeleteMessage`, `sqs:ChangeMessageVisibility` (main); `sqs:SendMessage` (DLQ); `s3:GetObject`, `s3:PutObject`; `kinesis:PutRecord`, `kinesis:PutRecords`; `bedrock:InvokeModel`, `sagemaker:InvokeEndpoint` | `${sqs_main_queue_arn}`, `${sqs_dlq_arn}`, `${s3_bucket_arn}/tenants/*`, `${kinesis_stream_arn}`, `arn:aws:bedrock:${region}::foundation-model/meta.llama3-*` |
| **`keda-irsa`** | `system:serviceaccount:inference-platform:keda-operator` | Read-only `sqs:GetQueueAttributes`, `sqs:GetQueueUrl` | `${sqs_main_queue_arn}` |
| **`lambda-metering-role`** | `lambda.amazonaws.com` | `kinesis:GetRecords`, `kinesis:GetShardIterator`, `kinesis:DescribeStream`, `kinesis:DescribeStreamSummary`, `kinesis:ListShards` | `${kinesis_stream_arn}` |

---

## 5. Budget & Cost Guardrails

All cost numbers below are labeled **Estimated** (based on `eu-central-1` on-demand/Spot pricing and Terraform configuration defaults):

| Profile | `enable_eks` | `gpu_min_nodes` | Fixed Hourly Cost (Estimated) | 4-Hour Ephemeral Run Cost (Estimated) | Monthly Budget Cap (`aws_budgets_budget`) |
|---|---|---|---|---|---|
| **Ephemeral Default (S3 + CloudFront + SQS + ECS Fargate `0` tasks + IAM)** | `false` | `0` | **`$0.000 / hr`** | **`$0.00`** (pay-per-request only) | `$25.00 / month` |
| **Ephemeral + EKS Opt-In (CPU Spot + Scale-to-Zero GPU)** | `true` | `0` | **`$0.133 / hr`** (`$0.10` EKS + `$0.033` Spot `t3.large`) | **`$0.53`** | `$25.00 / month` |
| **Production Baseline (Idle Queue, Scale-to-Zero GPU)** | `true` | `0` | **`$0.266 / hr`** (`$0.10` EKS + 2x `$0.083` `t3.large`) | N/A (`$194.18 / month`) | `$250.00 / month` |

---

## 6. Ephemeral Deploy / Verify / Destroy Workflow

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
sequenceDiagram
    autonumber
    actor Dev as Developer / CI Runner
    participant Script as ephemeral-lifecycle.sh
    participant Validator as validate_terraform.py
    participant AWS as AWS Cloud (S3 / CloudFront / SQS / ECS / IAM / Budgets)
    participant API as Control Plane (/v1/cloud/aws/*)

    Dev->>Script: ./ephemeral-lifecycle.sh validate
    Script->>Validator: Validate HCL fmt, 7 modules, IAM wildcards & budget guardrails
    Validator-->>Script: Validation PASSED (18 ephemeral resources, $0.00/hr fixed cost)
    Dev->>Script: EPHEMERAL_RUN_ID=pr-42 ./ephemeral-lifecycle.sh deploy ephemeral
    Script->>AWS: terraform init && terraform apply (enable_eks=false, TTL=4h)
    AWS-->>Script: Outputs: s3_bucket_name, cloudfront_domain_name, sqs_queue_url, ecs_api_service_name
    Dev->>API: POST /v1/cloud/aws/ephemeral/deploy (verify guardrails & active state)
    API-->>Dev: 201 Created (status=DEPLOYED, withinBudgetGuardrail=true)
    Dev->>API: POST /v1/cloud/aws/ephemeral/pr-42/destroy
    API-->>Dev: 200 OK (status=DESTROYED, surviving_resources=0, post_destroy_hourly_cost_usd=0)
    Dev->>Script: EPHEMERAL_RUN_ID=pr-42 ./ephemeral-lifecycle.sh destroy ephemeral
    Script->>AWS: terraform destroy (force_destroy=true on ephemeral S3 bucket)
    AWS-->>Script: Destroy complete! 0 surviving billable resources
```

### Verification & Execution Commands

```bash
# 1. Offline static analysis, IAM least-privilege check, cost guardrail check & lifecycle simulation
make validate-terraform

# 2. Validate via the ephemeral lifecycle CLI wrapper
./infrastructure/terraform/scripts/ephemeral-lifecycle.sh validate

# 3. Ephemeral cloud plan / deploy / destroy (uses Terraform CLI when installed + AWS OIDC credentials)
EPHEMERAL_RUN_ID=smoke-01 ./infrastructure/terraform/scripts/ephemeral-lifecycle.sh plan ephemeral
EPHEMERAL_RUN_ID=smoke-01 ./infrastructure/terraform/scripts/ephemeral-lifecycle.sh deploy ephemeral
EPHEMERAL_RUN_ID=smoke-01 ./infrastructure/terraform/scripts/ephemeral-lifecycle.sh destroy ephemeral
```
