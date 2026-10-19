/**
 * OpenAPI endpoint request schemas, parameter definitions, and realistic default examples.
 * Used by Swagger UI to automatically pre-populate valid test payloads and parameters.
 */

export interface EndpointDocsConfig {
  tags?: string[];
  summary?: string;
  description?: string;
  params?: Record<string, any>;
  querystring?: Record<string, any>;
  headers?: Record<string, any>;
  body?: Record<string, any>;
}

export const ENDPOINT_OPENAPI_CONFIGS: Record<string, EndpointDocsConfig> = {
  // =========================================================================
  // Health
  // =========================================================================
  'GET /healthz': {
    tags: ['Health'],
    summary: 'Liveness Probe',
    description: 'Returns HTTP 200 if the Fastify API process is running and accepting connections.',
  },
  'GET /readyz': {
    tags: ['Health'],
    summary: 'Readiness Probe',
    description: 'Verifies active connectivity to backing dependencies: PostgreSQL, MinIO (S3), and ElasticMQ (SQS).',
  },

  // =========================================================================
  // Jobs Lifecycle & Queue
  // =========================================================================
  'POST /v1/jobs': {
    tags: ['Jobs'],
    summary: 'Submit Asynchronous Inference Job',
    description:
      'Enqueues an asynchronous inference job with idempotency support, bounded backoff, and S3 payload offloading.',
    body: {
      type: 'object',
      required: ['model_id'],
      properties: {
        model_id: {
          type: 'string',
          description: 'Model identifier from curated repository or provider catalog',
          example: 'meta-llama/Llama-3-8B-Instruct',
        },
        routing_preference: {
          type: 'string',
          enum: ['auto', 'local', 'cloud', 'cost_optimized', 'low_latency'],
          default: 'auto',
          example: 'auto',
          description: 'Routing policy preference for compute placement',
        },
        priority: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 5,
          example: 5,
          description: 'Job execution priority (1-10, higher is prioritized)',
        },
        max_retries: {
          type: 'integer',
          minimum: 0,
          maximum: 10,
          default: 3,
          example: 3,
          description: 'Maximum transient error retry attempts before routing to DLQ',
        },
        input: {
          type: 'object',
          description: 'Inline inference payload',
          properties: {
            prompt: {
              type: 'string',
              example: 'Explain Raft consensus protocol in distributed databases.',
            },
            media_asset_uri: {
              type: 'string',
              example: 'tests/fixtures/media/fernando_alonso_f1.jpg',
              description: 'Local path or S3 URI to binary media asset (image, video, document)',
            },
            parameters: {
              type: 'object',
              example: {
                temperature: 0.7,
                max_new_tokens: 256,
              },
            },
          },
        },
        input_uri: {
          type: 'string',
          description: 'S3 URI for offloaded or large input payloads',
          example: 's3://platform-artifacts/inputs/prompt-sample.json',
        },
      },
      example: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        routing_preference: 'auto',
        priority: 5,
        max_retries: 3,
        input: {
          prompt: 'Explain Raft consensus protocol in distributed databases.',
          parameters: {
            temperature: 0.7,
            max_new_tokens: 256,
          },
        },
      },
      'x-examples': {
        runway_text_reasoning: {
          summary: 'Text Prompt Reasoning (Llama-3-8B-Instruct, Local GPU)',
          description:
            'Autoregressive high-throughput reasoning on RTX 5070 Ti CUDA tensor cores.',
          value: {
            model_id: 'meta-llama/Llama-3-8B-Instruct',
            routing_preference: 'local/gpu',
            priority: 5,
            max_retries: 3,
            input: {
              prompt:
                'Compare Raft and Multi-Paxos consensus algorithms for distributed state machine replication. Specifically analyze: 1) Leader election mechanisms and heartbeat overhead, 2) Log replication and commitment invariants, 3) Split-brain prevention under network partitions, and 4) Joint consensus configuration changes.',
              parameters: {
                temperature: 0.7,
                max_new_tokens: 256,
              },
            },
          },
        },
        image_generation: {
          summary: 'Image Generation (FLUX.1-schnell)',
          description:
            'Generates high-resolution images using 4-step rectified flow diffusion transformers (MMDiT).',
          value: {
            model_id: 'black-forest-labs/FLUX.1-schnell',
            routing_preference: 'local/gpu',
            priority: 6,
            max_retries: 3,
            input: {
              prompt:
                'Cinematic wide-angle 8k photograph of a futuristic AI inference datacenter server hall, glowing cyan and amber fiber-optic cables illuminated beneath transparent raised flooring, frosted glass liquid-cooling manifolds on high-density GPU server racks, volumetric atmospheric haze.',
              parameters: {
                num_inference_steps: 4,
                guidance_scale: 7.5,
                width: 1024,
                height: 1024,
              },
            },
          },
        },
        image_processing: {
          summary: 'Image VLM Analysis (Qwen2.5-VL-7B-Instruct)',
          description:
            'Multimodal vision-language model analyzing visual telemetry with local/S3 image fixture.',
          value: {
            model_id: 'Qwen/Qwen2.5-VL-7B-Instruct',
            routing_preference: 'local/gpu',
            priority: 5,
            max_retries: 3,
            input: {
              prompt:
                'Inspect this Formula 1 telemetry photo. Identify driver posture, helmet aerodynamics, front wing vortex generators, and tire degradation status.',
              media_asset_uri: 'tests/fixtures/media/fernando_alonso_f1.jpg',
              parameters: {
                temperature: 0.2,
                max_new_tokens: 256,
              },
            },
            input_uri:
              's3://platform-artifacts/tenants/tenant-default/inputs/fernando_alonso_f1.jpg',
          },
        },
        runway_image_vlm: {
          summary: 'Image VLM Analysis (Qwen2.5-VL-7B-Instruct)',
          description:
            'Multimodal vision-language model analyzing visual telemetry with local/S3 image fixture.',
          value: {
            model_id: 'Qwen/Qwen2.5-VL-7B-Instruct',
            routing_preference: 'local/gpu',
            priority: 5,
            max_retries: 3,
            input: {
              prompt:
                'Inspect this Formula 1 telemetry photo. Identify driver posture, helmet aerodynamics, front wing vortex generators, and tire degradation status.',
              media_asset_uri: 'tests/fixtures/media/fernando_alonso_f1.jpg',
              parameters: {
                temperature: 0.2,
                max_new_tokens: 256,
              },
            },
            input_uri:
              's3://platform-artifacts/tenants/tenant-default/inputs/fernando_alonso_f1.jpg',
          },
        },
        runway_keyframe_diffusion: {
          summary: 'Keyframe Diffusion (FLUX.1-schnell, 4 Steps)',
          description:
            'Generates high-resolution keyframe latents using 4-step rectified flow diffusion transformers (MMDiT).',
          value: {
            model_id: 'black-forest-labs/FLUX.1-schnell',
            routing_preference: 'local/gpu',
            priority: 6,
            max_retries: 3,
            input: {
              prompt:
                'Cinematic wide-angle 8k photograph of a futuristic AI inference datacenter server hall, glowing cyan and amber fiber-optic cables illuminated beneath transparent raised flooring, frosted glass liquid-cooling manifolds on high-density GPU server racks, volumetric atmospheric haze.',
              parameters: {
                num_inference_steps: 4,
                guidance_scale: 7.5,
                width: 1024,
                height: 1024,
              },
            },
          },
        },
        runway_video_synthesis: {
          summary: 'Video Spatiotemporal Synthesis (Wan2.1-T2V-1.3B)',
          description:
            '3D spatiotemporal tubelet diffusion synthesizing video frames conditioned on reference clip.',
          value: {
            model_id: 'Wan-AI/Wan2.1-T2V-1.3B',
            routing_preference: 'local/gpu',
            priority: 7,
            max_retries: 3,
            input: {
              prompt:
                'Transform reference video with fluid cinematic lighting, realistic volumetric shadows, and 60fps spatiotemporal consistency.',
              media_asset_uri: 'tests/fixtures/media/sample_bunny_clip.mp4',
              parameters: {
                denoising_steps: 4,
                fps: 24,
              },
            },
            input_uri:
              's3://platform-artifacts/tenants/tenant-default/inputs/sample_bunny_clip.mp4',
          },
        },
        auto: {
          summary: 'Auto (Distributed Consensus: Raft vs Multi-Paxos)',
          description:
            'Default dynamic routing: runs on local worker when queue depth and VRAM fit; spills over to external GPU on queue saturation or SLO risk.',
          value: {
            model_id: 'meta-llama/Llama-3-8B-Instruct',
            routing_preference: 'auto',
            priority: 5,
            max_retries: 3,
            input: {
              prompt:
                'Compare Raft and Multi-Paxos consensus algorithms for distributed state machine replication. Specifically analyze: 1) Leader election mechanisms and heartbeat overhead, 2) Log replication and commitment invariants, 3) Split-brain prevention under network partitions, and 4) Joint consensus configuration changes. Provide concrete trade-offs for latency-sensitive storage engines.',
              parameters: {
                temperature: 0.7,
                max_new_tokens: 384,
              },
            },
          },
        },
        local: {
          summary: 'Local (Pinned Local GPU: PostgreSQL Query Plan Optimization)',
          description:
            'Strictly pins inference to local PyTorch / TorchScript workers on RTX 5070 Ti or CPU with zero cloud egress cost.',
          value: {
            model_id: 'meta-llama/Llama-3-8B-Instruct',
            routing_preference: 'local',
            priority: 7,
            max_retries: 3,
            input: {
              prompt:
                'Analyze the following PostgreSQL execution plan for a 20-million row multi-tenant table experiencing sequential scans. Provide 3 specific indexing and partitioning strategies to achieve sub-10ms point lookups:\n\nEXPLAIN ANALYZE\nSELECT tenant_id, date_trunc(\'hour\', created_at), status, COUNT(*), SUM(cost_microcents)\nFROM jobs\nWHERE tenant_id = \'tenant-prod-42\'\n  AND status IN (\'SUCCEEDED\', \'FAILED\')\n  AND created_at >= NOW() - INTERVAL \'7 days\'\nGROUP BY 1, 2, 3\nORDER BY 2 DESC;',
              parameters: {
                temperature: 0.2,
                max_new_tokens: 384,
              },
            },
          },
        },
        cloud: {
          summary: 'Cloud (External GPU: AWS Cloud FinOps Audit & Anomaly Detection)',
          description:
            'Directs workload immediately to cloud GPU capacity (e.g. RunPod serverless worker or AWS GPU node group) for high-throughput analytical workloads.',
          value: {
            model_id: 'meta-llama/Llama-3-8B-Instruct',
            routing_preference: 'cloud',
            priority: 5,
            max_retries: 3,
            input: {
              prompt:
                'Review the following cloud billing breakdown across ECS Fargate, EKS GPU worker nodes, S3 storage, and CloudFront egress. Identify top cost drivers, quantify anomalous spending spikes compared to baseline, and provide actionable FinOps recommendations.',
              parameters: {
                temperature: 0.5,
                max_new_tokens: 384,
              },
            },
          },
        },
        cost_optimized: {
          summary: 'Cost Optimized (Batch Support Tickets Sentiment & Priority Classification)',
          description:
            'Evaluates healthy providers to select the lowest-cost option while strictly enforcing tenant target gross margin and spot price efficiency.',
          value: {
            model_id: 'meta-llama/Llama-3-8B-Instruct',
            routing_preference: 'cost_optimized',
            priority: 3,
            max_retries: 5,
            input: {
              prompt:
                'Classify the sentiment (Positive / Neutral / Negative), urgency priority (P1-Urgent / P2-Normal / P3-Low), and suggested routing team for customer support tickets.',
              parameters: {
                temperature: 0.1,
                max_new_tokens: 384,
              },
            },
          },
        },
        low_latency: {
          summary: 'Low Latency (Real-Time Resilient TypeScript Client Synthesis)',
          description:
            'Prioritizes fastest time-to-first-token and lowest overall response latency, skipping saturated queues with elevated dispatch priority.',
          value: {
            model_id: 'meta-llama/Llama-3-8B-Instruct',
            routing_preference: 'low_latency',
            priority: 10,
            max_retries: 2,
            input: {
              prompt:
                'Write a production-grade TypeScript resilient HTTP client wrapper with exponential backoff and traceparent propagation.',
              parameters: {
                temperature: 0.2,
                max_new_tokens: 512,
              },
            },
          },
        },
      },
    },
  },

  'POST /v1/jobs/upload-url': {
    tags: ['Jobs'],
    summary: 'Generate Presigned S3 Media Upload URL',
    description:
      'Generates a presigned S3 PUT URL for tenant-isolated binary media upload (images, videos, documents).',
    body: {
      type: 'object',
      required: ['filename', 'content_type'],
      properties: {
        filename: {
          type: 'string',
          example: 'fernando_alonso_f1.jpg',
          description: 'Name of the binary media asset to upload',
        },
        content_type: {
          type: 'string',
          example: 'image/jpeg',
          description: 'MIME type: image/jpeg, image/png, image/webp, video/mp4, video/quicktime, application/pdf',
        },
        expires_in_seconds: {
          type: 'integer',
          default: 3600,
          example: 3600,
          description: 'Presigned URL expiration in seconds',
        },
      },
      example: {
        filename: 'fernando_alonso_f1.jpg',
        content_type: 'image/jpeg',
        expires_in_seconds: 3600,
      },
    },
  },

  'GET /v1/jobs/:id': {
    tags: ['Jobs'],
    summary: 'Get Job Status & Artifacts',
    description: 'Queries the current lifecycle state, execution metrics, and signed artifact download URLs for a job.',
    params: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Job UUID',
          example: '40ecad89-bd24-426a-8b33-5be40ba9fe0a',
        },
      },
      required: ['id'],
    },
  },

  'POST /v1/jobs/:id/cancel': {
    tags: ['Jobs'],
    summary: 'Cancel In-Flight Job',
    description: 'Transitions an in-flight or queued job to CANCELLED and halts background worker processing.',
    params: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Job UUID to cancel',
          example: '40ecad89-bd24-426a-8b33-5be40ba9fe0a',
        },
      },
      required: ['id'],
    },
  },

  'POST /v1/jobs/:id/transition': {
    tags: ['Jobs'],
    summary: 'Transition Job Lifecycle State',
    description:
      'Worker execution hook to transition job state (PROCESSING, SUCCEEDED, FAILED, RETRYING) with telemetry metrics.',
    params: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Job UUID',
          example: '40ecad89-bd24-426a-8b33-5be40ba9fe0a',
        },
      },
      required: ['id'],
    },
    body: {
      type: 'object',
      required: ['status'],
      properties: {
        status: {
          type: 'string',
          enum: ['QUEUED', 'PROCESSING', 'RETRYING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
          example: 'SUCCEEDED',
        },
        provider: {
          type: 'string',
          example: 'local_pytorch',
        },
        output: {
          type: 'object',
          example: {
            generated_text: 'Raft is a consensus algorithm designed as an alternative to Paxos.',
          },
        },
        duration_ms: {
          type: 'integer',
          example: 142,
        },
        tokens_in: {
          type: 'integer',
          example: 48,
        },
        tokens_out: {
          type: 'integer',
          example: 128,
        },
        cost_microcents: {
          type: 'integer',
          example: 160,
        },
      },
      example: {
        status: 'SUCCEEDED',
        provider: 'local_pytorch',
        output: {
          generated_text: 'Raft is a consensus algorithm designed as an alternative to Paxos.',
        },
        duration_ms: 142,
        tokens_in: 48,
        tokens_out: 128,
        cost_microcents: 160,
      },
    },
  },

  'GET /v1/jobs/dlq': {
    tags: ['Jobs'],
    summary: 'List Dead-Letter Queue Messages',
    description: 'Retrieves messages that exhausted maximum retry attempts and were routed to the Dead-Letter Queue.',
  },

  'POST /v1/worker/process-next': {
    tags: ['Jobs'],
    summary: 'Process Next Queued Job (Worker Trigger)',
    description: 'Deterministically triggers execution of the next queued job from ElasticMQ / SQS.',
  },

  // =========================================================================
  // Observability
  // =========================================================================
  'GET /metrics': {
    tags: ['Observability'],
    summary: 'Prometheus Metrics Exposition',
    description:
      'Exposes Prometheus text exposition format metrics for request latencies, queue depths, job durations, and status counts.',
  },

  'GET /v1/jobs/:id/trace': {
    tags: ['Observability'],
    summary: 'Inspect Distributed Job Trace',
    description:
      'Retrieves end-to-end W3C distributed trace spans linking API submission -> authZ -> queue -> worker -> inference -> artifact.',
    params: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Job UUID',
          example: '40ecad89-bd24-426a-8b33-5be40ba9fe0a',
        },
      },
      required: ['id'],
    },
  },

  'GET /v1/traces/by-correlation/:correlationId': {
    tags: ['Observability'],
    summary: 'Query Trace Spans by Correlation ID',
    description: 'Finds all distributed spans and job IDs associated with a cross-service correlation ID.',
    params: {
      type: 'object',
      properties: {
        correlationId: {
          type: 'string',
          description: 'Correlation UUID or tracking identifier',
          example: 'corr-e2e-trace-001',
        },
      },
      required: ['correlationId'],
    },
  },

  // =========================================================================
  // Provider Routing
  // =========================================================================
  'GET /v1/routing/providers': {
    tags: ['Provider Routing'],
    summary: 'List Available Inference Providers',
    description:
      'Returns catalog of available inference providers (local PyTorch, RunPod, Bedrock, SageMaker) with health and pricing.',
  },

  'POST /v1/routing/evaluate': {
    tags: ['Provider Routing'],
    summary: 'Evaluate Routing Decision with Policy Engine',
    description:
      'Evaluates dynamic policy rules (SLO, VRAM, margin, VPC) to select optimal provider with full explainability ledger.',
    body: {
      type: 'object',
      required: ['workload'],
      properties: {
        workload: {
          type: 'object',
          required: ['model_id'],
          properties: {
            model_id: { type: 'string', example: 'meta-llama/Llama-3-8B-Instruct' },
            prompt_tokens: { type: 'integer', example: 128 },
            max_new_tokens: { type: 'integer', example: 64 },
            estimated_vram_mb: { type: 'integer', example: 4096 },
            modality: { type: 'string', example: 'text_to_text' },
            requires_vpc: { type: 'boolean', example: false },
            is_proprietary: { type: 'boolean', example: false },
          },
        },
        capacity: {
          type: 'object',
          properties: {
            local_vram_total_mb: { type: 'integer', example: 16384 },
            local_vram_allocated_mb: { type: 'integer', example: 4096 },
            local_queue_depth: { type: 'integer', example: 2 },
            local_queue_threshold: { type: 'integer', example: 10 },
          },
        },
        slo: {
          type: 'object',
          properties: {
            latency_slo_ms: { type: 'integer', example: 1500 },
          },
        },
        tenant_policy: {
          type: 'object',
          properties: {
            routing_preference: { type: 'string', example: 'auto' },
            billed_rate_microcents_per_token: { type: 'integer', example: 40 },
          },
        },
        economics: {
          type: 'object',
          properties: {
            target_gross_margin: { type: 'number', example: 0.4 },
          },
        },
      },
      example: {
        workload: {
          model_id: 'meta-llama/Llama-3-8B-Instruct',
          prompt_tokens: 128,
          max_new_tokens: 64,
          estimated_vram_mb: 4096,
          modality: 'text_to_text',
          requires_vpc: false,
          is_proprietary: false,
        },
        capacity: {
          local_vram_total_mb: 16384,
          local_vram_allocated_mb: 4096,
          local_queue_depth: 2,
          local_queue_threshold: 10,
        },
        slo: {
          latency_slo_ms: 1500,
        },
        tenant_policy: {
          routing_preference: 'auto',
          billed_rate_microcents_per_token: 40,
        },
        economics: {
          target_gross_margin: 0.4,
        },
      },
    },
  },

  'POST /v1/routing/simulate': {
    tags: ['Provider Routing'],
    summary: 'Simulate Queue Depth Spillover Sweep',
    description:
      'Simulates increasing local queue depths to determine the precise threshold where spillover to external GPU providers occurs.',
    body: {
      type: 'object',
      required: ['workload', 'queue_depth_range'],
      properties: {
        workload: {
          type: 'object',
          properties: {
            model_id: { type: 'string', example: 'meta-llama/Llama-3-8B-Instruct' },
            prompt_tokens: { type: 'integer', example: 128 },
            max_new_tokens: { type: 'integer', example: 64 },
            estimated_vram_mb: { type: 'integer', example: 4096 },
          },
        },
        queue_depth_range: {
          type: 'array',
          items: { type: 'integer' },
          example: [0, 2, 5, 8, 10, 12, 15, 20],
        },
      },
      example: {
        workload: {
          model_id: 'meta-llama/Llama-3-8B-Instruct',
          prompt_tokens: 128,
          max_new_tokens: 64,
          estimated_vram_mb: 4096,
        },
        queue_depth_range: [0, 2, 5, 8, 10, 12, 15, 20],
      },
    },
  },

  'PATCH /v1/routing/providers/:name/health': {
    tags: ['Provider Routing'],
    summary: 'Toggle Provider Health Status',
    description: 'Updates provider health (healthy/unhealthy) for failover routing and chaos testing.',
    params: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Provider name identifier',
          example: 'local_pytorch',
        },
      },
      required: ['name'],
    },
    body: {
      type: 'object',
      required: ['healthy'],
      properties: {
        healthy: { type: 'boolean', example: true },
      },
      example: {
        healthy: true,
      },
    },
  },

  // =========================================================================
  // Kubernetes Scheduling
  // =========================================================================
  'GET /v1/k8s/autoscaling/status': {
    tags: ['Kubernetes'],
    summary: 'Evaluate KEDA Autoscaling & Kueue Status',
    description:
      'Evaluates KEDA queue-depth scaling decisions (0 -> N -> 0) and Kueue cluster queue GPU quota status.',
    querystring: {
      type: 'object',
      properties: {
        queue_depth: { type: 'integer', description: 'Simulated queue depth override', example: 0 },
        in_flight_jobs: { type: 'integer', description: 'Simulated in-flight jobs', example: 0 },
        current_replicas: { type: 'integer', description: 'Simulated current replicas', example: 0 },
        seconds_since_last_active: { type: 'integer', description: 'Seconds idle', example: 0 },
      },
    },
  },

  'POST /v1/k8s/kueue/workloads': {
    tags: ['Kubernetes'],
    summary: 'Submit Batch Workload to Kueue',
    description:
      'Validates workload security constraints via Kyverno policies and submits to Kueue for GPU quota admission or cohort borrowing.',
    body: {
      type: 'object',
      required: ['workload_id'],
      properties: {
        workload_id: { type: 'string', example: 'wl-batch-001' },
        local_queue_name: { type: 'string', example: 'default-queue' },
        priority_class: { type: 'string', example: 'batch-medium' },
        gpu_count: { type: 'integer', example: 1 },
        cpu_millicores: { type: 'integer', example: 2000 },
        memory_mb: { type: 'integer', example: 4096 },
        allow_cohort_borrowing: { type: 'boolean', example: true },
      },
      example: {
        workload_id: 'wl-batch-001',
        local_queue_name: 'default-queue',
        priority_class: 'batch-medium',
        gpu_count: 1,
        cpu_millicores: 2000,
        memory_mb: 4096,
        allow_cohort_borrowing: true,
      },
    },
  },

  'POST /v1/k8s/kueue/workloads/:id/release': {
    tags: ['Kubernetes'],
    summary: 'Release Kueue Workload & Reclaim GPU Quota',
    description: 'Releases GPU quota allocated to a completed workload and awakens pending queued workloads.',
    params: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Workload identifier to release',
          example: 'wl-batch-001',
        },
      },
      required: ['id'],
    },
  },

  // =========================================================================
  // AWS Cloud Platform
  // =========================================================================
  'GET /v1/cloud/aws/status': {
    tags: ['AWS Cloud'],
    summary: 'Get AWS Infrastructure Status & Cost Guardrails',
    description:
      'Inspects Terraform modules, least-privilege IAM policies, active ephemeral deployments, and cost guardrails.',
  },

  'POST /v1/cloud/aws/ephemeral/deploy': {
    tags: ['AWS Cloud'],
    summary: 'Deploy Ephemeral Cloud Stack',
    description:
      'Validates budget guardrails and least-privilege IAM policies, provisioning an ephemeral serverless AWS stack with auto-destroy schedule.',
    body: {
      type: 'object',
      required: ['ephemeral_run_id'],
      properties: {
        ephemeral_run_id: { type: 'string', example: 'run-preview-001' },
        environment: { type: 'string', example: 'ephemeral' },
        aws_region: { type: 'string', example: 'us-east-1' },
        enable_eks: { type: 'boolean', example: false },
        enable_gpu_node_group: { type: 'boolean', example: false },
        monthly_budget_limit_usd: { type: 'integer', example: 50 },
        ephemeral_ttl_hours: { type: 'integer', example: 2 },
      },
      example: {
        ephemeral_run_id: 'run-preview-001',
        environment: 'ephemeral',
        aws_region: 'us-east-1',
        enable_eks: false,
        enable_gpu_node_group: false,
        monthly_budget_limit_usd: 50,
        ephemeral_ttl_hours: 2,
      },
    },
  },

  'POST /v1/cloud/aws/ephemeral/:runId/destroy': {
    tags: ['AWS Cloud'],
    summary: 'Destroy Ephemeral Stack',
    description:
      'Tears down all ephemeral cloud resources for a given runId and verifies zero surviving resources.',
    params: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'Ephemeral deployment run ID',
          example: 'run-preview-001',
        },
      },
      required: ['runId'],
    },
  },

  'POST /v1/cloud/aws/workflows/execute': {
    tags: ['AWS Cloud'],
    summary: 'Execute Multi-Tenant Workload Path',
    description:
      'Executes Path A (SQS+KEDA single-hop) or Path B (Flyte+Kueue multi-stage DAG) with strict tenant boundary isolation.',
    body: {
      type: 'object',
      required: ['path', 'modality', 'job_id', 'tenant_id'],
      properties: {
        path: {
          type: 'string',
          enum: ['path_a_sqs_keda', 'path_b_flyte_kueue'],
          example: 'path_a_sqs_keda',
        },
        modality: {
          type: 'string',
          enum: ['text_to_text', 'text_to_image', 'media_photo', 'media_video'],
          example: 'text_to_text',
        },
        job_id: { type: 'string', example: 'job-sample-001' },
        tenant_id: { type: 'string', example: 'tenant-default' },
        model_id: { type: 'string', example: 'meta-llama/Llama-3-8B-Instruct' },
        prompt: { type: 'string', example: 'Explain Raft consensus protocol in distributed databases.' },
      },
      example: {
        path: 'path_a_sqs_keda',
        modality: 'text_to_text',
        job_id: 'job-sample-001',
        tenant_id: 'tenant-default',
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        prompt: 'Explain Raft consensus protocol in distributed databases.',
      },
    },
  },
};

