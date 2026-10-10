# Deployment Topology

This document details the physical and orchestration topologies for both local development and cloud production deployments of the **Multi-Tenant AI Inference Platform**.

---

## 1. Local Development Topology (Docker Compose)

The local environment provides full architectural fidelity without requiring active cloud credentials or paid managed services. All services run within Docker Compose, with optional hardware passthrough for host GPU acceleration.

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    subgraph Host["Developer Workstation (Linux / RTX 5070 Ti)"]
        Browser["Web Browser (localhost:3000)"]
        HostGPU["Host GPU Driver & NVIDIA Container Toolkit"]

        subgraph Compose["Docker Compose Network"]
            Dashboard["dashboard (React / Vite)\n:3000"]
            API["api (Fastify Node.js)\n:8080"]
            Worker["worker (Python / PyTorch)\n(Host GPU Passthrough)"]
            Postgres["postgres (PostgreSQL 16)\n:5432"]
            RedisSvc["redis (Redis 7)\n:6379"]
            MinIO["minio (S3 Compatible)\n:9000 / :9001"]
            QueueBroker["elasticmq / localstack (SQS API)\n:9324"]
            OTelCol["otel-collector\n:4317 / :4318"]
            Prometheus["prometheus\n:9090"]
            Grafana["grafana\n:3001"]
        end
    end

    Browser --> Dashboard
    Browser --> API
    Browser --> Grafana
    Dashboard --> API
    API --> Postgres
    API --> RedisSvc
    API --> QueueBroker
    API --> MinIO
    API --> OTelCol

    QueueBroker --> Worker
    Worker --> HostGPU
    Worker --> Postgres
    Worker --> MinIO
    Worker --> OTelCol

    OTelCol --> Prometheus
    Prometheus --> Grafana
```

### Local Dev Port Allocation

| Service | Internal Port | Host Port | Purpose |
|---|---|---|---|
| `dashboard` | 3000 | 3000 | React Product Dashboard |
| `api` | 8080 | 8080 | Fastify Control Plane API |
| `grafana` | 3000 | 3001 | Operational Monitoring Dashboards |
| `postgres` | 5432 | 5432 | Primary Relational Database |
| `redis` | 6379 | 6379 | Ephemeral State & Cache |
| `minio` | 9000, 9001 | 9000, 9001 | S3 API & MinIO Console |
| `elasticmq` | 9324 | 9324 | SQS-Compatible Message Queue |
| `prometheus` | 9090 | 9090 | Prometheus Metrics Storage |
| `otel-collector` | 4317, 4318 | 4317, 4318 | OTel gRPC / HTTP Ingestion |

---

## 2. Cloud Production Topology (AWS EKS & Managed Services)

The cloud production topology targets AWS using Amazon Elastic Kubernetes Service (EKS) managed with Terraform and reconciled via Argo CD. Stateless API and worker components run inside EKS, while stateful tiers rely on managed AWS infrastructure.

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true }}}%%
flowchart TD
    subgraph Clients["Public Internet"]
        Users["Tenant Applications & Dashboard Users"]
    end

    subgraph AWSCloud["AWS Region (eu-central-1)"]
        subgraph Edge["Edge & Load Balancing"]
            CF["Amazon CloudFront (Dashboard Assets)"]
            WAF["AWS WAF (Rate Limiting & DDoS)"]
            ALB["Application Load Balancer (ALB)"]
        end

        subgraph EKSCluster["Amazon EKS Cluster (v1.30+)"]
            subgraph IngressNamespace["Namespace: ingress-system"]
                AWSLoadBalancerController["AWS Load Balancer Controller"]
            end

            subgraph PlatformNamespace["Namespace: inference-platform"]
                APIDeployment["api Pods (Fastify)\nHorizontal Pod Autoscaler (HPA)"]
                KEDAOperator["KEDA Autoscaler Operator"]
                KueueOperator["Kueue Batch Admission"]
            end

            subgraph WorkerNamespace["Namespace: inference-workers"]
                WorkerGPU["worker Pods (Local GPU)\nScaled by KEDA on SQS depth"]
                WorkerCPU["worker Pods (Cloud Dispatcher)"]
            end

            subgraph MonitoringNamespace["Namespace: observability"]
                OTelDaemon["OTel Collector DaemonSet / Deployment"]
                PrometheusOperator["Prometheus Operator & DCGM Exporter"]
            end
        end

        subgraph ManagedServices["AWS Managed Infrastructure"]
            RDS[("Amazon RDS PostgreSQL (Multi-AZ)")]
            ElastiCache[("Amazon ElastiCache Redis")]
            SQSMain["Amazon SQS (Async Inference Queue)"]
            SQSDLQ["Amazon SQS (Dead-Letter Queue)"]
            S3Bucket[("Amazon S3 (Artifacts & Models)")]
        end

        subgraph ExternalCloud["Cloud Inference Providers"]
            RunPod["RunPod Serverless"]
            Bedrock["AWS Bedrock"]
            SageMaker["AWS SageMaker Endpoints"]
        end
    end

    Users --> CF
    Users --> WAF
    WAF --> ALB
    ALB --> APIDeployment

    APIDeployment --> RDS
    APIDeployment --> ElastiCache
    APIDeployment --> SQSMain
    SQSMain -.->|"Redrive"| SQSDLQ

    KEDAOperator -->|"Polls Queue Length"| SQSMain
    KEDAOperator -->|"Scales Pods"| WorkerGPU
    KEDAOperator -->|"Scales Pods"| WorkerCPU
    KueueOperator -->|"Admits Batches to GPUs"| WorkerGPU

    WorkerGPU --> SQSMain
    WorkerGPU --> RDS
    WorkerGPU --> S3Bucket

    WorkerCPU --> SQSMain
    WorkerCPU --> RDS
    WorkerCPU --> S3Bucket
    WorkerCPU --> RunPod
    WorkerCPU --> Bedrock
    WorkerCPU --> SageMaker

    APIDeployment --> OTelDaemon
    WorkerGPU --> OTelDaemon
    WorkerCPU --> OTelDaemon
    PrometheusOperator --> OTelDaemon
```

---

## 3. Kubernetes Autoscaling Architecture

The platform separates real-time API scaling from heavy batch/inference scaling:

1. **Control Plane Scaling**:
   - `api` pods scale via standard Kubernetes Horizontal Pod Autoscaler (HPA) based on CPU and HTTP request rates.
2. **Worker Queue-Depth Autoscaling (KEDA)**:
   - Inference workers scale from 0 to N replicas using KEDA (Kubernetes Event-driven Autoscaling) measuring SQS queue depth (`ApproximateNumberOfMessagesVisible`).
   - Enables rapid scale-out during batch bursts and scale-to-zero when queues are idle to prevent idle GPU compute costs.
3. **Batch Admission & Fair Sharing (Kueue)**:
   - Multi-tenant GPU quota sharing and queuing are managed by Kueue.
   - Prevents GPU out-of-memory (OOM) faults by queuing workload admissions rather than allowing uncontrolled concurrent pod launches.

