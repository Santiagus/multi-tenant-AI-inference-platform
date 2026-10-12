import { ConflictError, NotFoundError, ValidationError } from './errors.js';

export type AwsEnvironmentType = 'ephemeral' | 'production';
export type EphemeralStackStatus = 'DEPLOYED' | 'DESTROYED';

export interface AwsDeploymentSpec {
  ephemeralRunId: string;
  environment?: AwsEnvironmentType;
  awsRegion?: string;
  enableEks?: boolean;
  enableGpuNodeGroup?: boolean;
  gpuMinNodes?: number;
  gpuMaxNodes?: number;
  monthlyBudgetLimitUsd?: number;
  ephemeralTtlHours?: number;
  useLongLivedAccessKeys?: boolean;
  iamActions?: string[];
  iamResources?: string[];
  s3PublicAccessBlocked?: boolean;
  confirmProductionApply?: boolean;
}

export interface AwsCostEstimation {
  label: 'estimated';
  hourlyFixedUsd: number;
  ephemeralTtlHours: number;
  estimatedRunCostUsd: number;
  monthlyBudgetLimitUsd: number;
  budgetUtilizationRatio: number;
  withinBudgetGuardrail: boolean;
}

export interface AwsGuardrailViolation {
  rule:
    | 'least-privilege-iam'
    | 'short-lived-oidc-credentials'
    | 's3-public-access-block'
    | 'no-permanent-gpu-or-eks'
    | 'budget-cost-guardrail'
    | 'production-approval-gate';
  message: string;
}

export interface AwsGuardrailEvaluationResult {
  passed: boolean;
  violations: AwsGuardrailViolation[];
  costEstimation: AwsCostEstimation;
}

export interface EphemeralStackRecord {
  ephemeralRunId: string;
  environment: AwsEnvironmentType;
  awsRegion: string;
  status: EphemeralStackStatus;
  enableEks: boolean;
  enableGpuNodeGroup: boolean;
  permanentGpuOrEksDependency: false;
  resourcesCreated: number;
  survivingResources: number;
  s3BucketName: string;
  cloudfrontDomainName: string;
  sqsQueueUrl: string;
  sqsDlqUrl: string;
  ecsServiceName: string;
  kinesisStreamName: string;
  iamRoles: {
    githubOidcRoleArn: string;
    apiIrsaRoleArn: string;
    workerIrsaRoleArn: string;
    kedaIrsaRoleArn: string;
    lambdaMeteringRoleArn: string;
  };
  costEstimation: AwsCostEstimation;
  deployedAt: string;
  ttlExpiresAt: string;
  destroyedAt: string | null;
}

const DEFAULT_SCOPED_IAM_ACTIONS = [
  'sqs:SendMessage',
  'sqs:ReceiveMessage',
  'sqs:DeleteMessage',
  'sqs:ChangeMessageVisibility',
  'sqs:GetQueueAttributes',
  'sqs:GetQueueUrl',
  's3:GetObject',
  's3:PutObject',
  's3:ListBucket',
  'kinesis:PutRecord',
  'kinesis:PutRecords',
  'bedrock:InvokeModel',
  'sagemaker:InvokeEndpoint',
];

const DEFAULT_SCOPED_IAM_RESOURCES = [
  'arn:aws:s3:::inference-ephemeral-artifacts/tenants/*',
  'arn:aws:sqs:eu-central-1:000000000000:inference-ephemeral-jobs',
  'arn:aws:sqs:eu-central-1:000000000000:inference-ephemeral-jobs-dlq',
  'arn:aws:kinesis:eu-central-1:000000000000:stream/inference-ephemeral-events',
];

export const TERRAFORM_MODULES_CATALOG = [
  {
    name: 's3-artifacts',
    path: 'infrastructure/terraform/modules/s3-artifacts',
    services: ['S3', 'CloudFront'],
    securityControls: ['PublicAccessBlock', 'CloudFront-OAC', 'SSE-AES256/KMS', 'LifecycleExpiration'],
  },
  {
    name: 'sqs-async-queue',
    path: 'infrastructure/terraform/modules/sqs-async-queue',
    services: ['SQS'],
    securityControls: ['SQS-Managed-SSE', 'DLQRedrivePolicy', 'LongPolling'],
  },
  {
    name: 'iam-least-privilege',
    path: 'infrastructure/terraform/modules/iam-least-privilege',
    services: ['IAM', 'STS-OIDC'],
    securityControls: ['GitHubOIDC', 'ECS-TaskRole', 'IRSA-Scoped-ARNs', 'NoWildcardActions'],
  },
  {
    name: 'ecs-fargate-api',
    path: 'infrastructure/terraform/modules/ecs-fargate-api',
    services: ['ECS', 'Fargate'],
    securityControls: ['ZeroControlPlaneFee', 'FargateSpot', 'PrivateSubnetsNoPublicIP'],
  },
  {
    name: 'kinesis-event-stream',
    path: 'infrastructure/terraform/modules/kinesis-event-stream',
    services: ['Kinesis', 'Lambda'],
    securityControls: ['KMS-Encryption', 'OnDemandMode', 'ScopedLambdaEventSource'],
  },
  {
    name: 'cost-guardrails',
    path: 'infrastructure/terraform/modules/cost-guardrails',
    services: ['AWSBudgets'],
    securityControls: ['80PctForecastAlert', '100PctActualAlert', 'EphemeralTTLTag'],
  },
  {
    name: 'eks-cluster',
    path: 'infrastructure/terraform/modules/eks-cluster',
    services: ['EKS', 'EC2-Spot'],
    securityControls: ['OptionalToggle', 'ScaleToZeroGPUNodeGroup', 'BoundedMaxNodes'],
  },
] as const;

export function evaluateAwsDeploymentGuardrails(
  spec: AwsDeploymentSpec
): AwsGuardrailEvaluationResult {
  const environment = spec.environment ?? 'ephemeral';
  const enableEks = spec.enableEks ?? false;
  const enableGpuNodeGroup = spec.enableGpuNodeGroup ?? false;
  const gpuMinNodes = spec.gpuMinNodes ?? 0;
  const gpuMaxNodes = spec.gpuMaxNodes ?? 1;
  const monthlyBudgetLimitUsd = spec.monthlyBudgetLimitUsd ?? (environment === 'ephemeral' ? 25.0 : 250.0);
  const ephemeralTtlHours = spec.ephemeralTtlHours ?? (environment === 'ephemeral' ? 4 : 0);
  const useLongLivedAccessKeys = spec.useLongLivedAccessKeys ?? false;
  const iamActions = spec.iamActions ?? DEFAULT_SCOPED_IAM_ACTIONS;
  const iamResources = spec.iamResources ?? DEFAULT_SCOPED_IAM_RESOURCES;
  const s3PublicAccessBlocked = spec.s3PublicAccessBlocked ?? true;

  const violations: AwsGuardrailViolation[] = [];

  if (useLongLivedAccessKeys) {
    violations.push({
      rule: 'short-lived-oidc-credentials',
      message:
        'Static AWS access keys are prohibited; use GitHub Actions OIDC and EKS IRSA short-lived credentials.',
    });
  }

  const wildcardActions = iamActions.filter(
    (action) => action === '*' || action.endsWith(':*')
  );
  const wildcardResources = iamResources.filter((res) => res.trim() === '*');
  if (wildcardActions.length > 0 || wildcardResources.length > 0) {
    violations.push({
      rule: 'least-privilege-iam',
      message:
        'IAM policy violates least-privilege: wildcard actions (* or service:*) and wildcard resources (*) are prohibited.',
    });
  }

  if (!s3PublicAccessBlocked) {
    violations.push({
      rule: 's3-public-access-block',
      message:
        'S3 artifact bucket must enforce all public access blocks (block_public_acls, block_public_policy, ignore_public_acls, restrict_public_buckets).',
    });
  }

  if (gpuMinNodes > 0 || gpuMaxNodes > 8) {
    violations.push({
      rule: 'no-permanent-gpu-or-eks',
      message:
        'GPU node group must set gpuMinNodes = 0 (scale-to-zero when idle) and gpuMaxNodes <= 8 so no permanent GPU dependency exists.',
    });
  }

  if (environment === 'production' && !spec.confirmProductionApply) {
    violations.push({
      rule: 'production-approval-gate',
      message:
        'Production Terraform apply requires explicit approval (confirmProductionApply: true).',
    });
  }

  // Cost calculation (labeled as estimated per AGENTS.md)
  const eksHourly = enableEks ? (environment === 'ephemeral' ? 0.133 : 0.266) : 0.0;
  const gpuFixedHourly = gpuMinNodes * 1.006;
  const hourlyFixedUsd = Number((eksHourly + gpuFixedHourly).toFixed(4));
  const durationHours = ephemeralTtlHours > 0 ? ephemeralTtlHours : 730;
  const estimatedRunCostUsd = Number((hourlyFixedUsd * durationHours).toFixed(2));
  const budgetUtilizationRatio =
    monthlyBudgetLimitUsd > 0
      ? Number((estimatedRunCostUsd / monthlyBudgetLimitUsd).toFixed(4))
      : 1.0;
  const withinBudgetGuardrail =
    monthlyBudgetLimitUsd > 0 &&
    estimatedRunCostUsd <= monthlyBudgetLimitUsd &&
    (environment !== 'ephemeral' || (ephemeralTtlHours >= 1 && ephemeralTtlHours <= 24));

  if (!withinBudgetGuardrail) {
    violations.push({
      rule: 'budget-cost-guardrail',
      message: `Estimated cloud spend ($${estimatedRunCostUsd.toFixed(2)}) or TTL (${ephemeralTtlHours}h) exceeds budget guardrail ($${monthlyBudgetLimitUsd.toFixed(2)}, max TTL 24h).`,
    });
  }

  // Ensure enableGpuNodeGroup without enableEks is flagged if inconsistent
  if (enableGpuNodeGroup && !enableEks) {
    violations.push({
      rule: 'no-permanent-gpu-or-eks',
      message: 'enableGpuNodeGroup cannot be true when enableEks is false.',
    });
  }

  return {
    passed: violations.length === 0,
    violations,
    costEstimation: {
      label: 'estimated',
      hourlyFixedUsd,
      ephemeralTtlHours,
      estimatedRunCostUsd,
      monthlyBudgetLimitUsd,
      budgetUtilizationRatio,
      withinBudgetGuardrail,
    },
  };
}

export type OrchestrationPathType = 'path_a_sqs_keda' | 'path_b_flyte_dag';
export type GenerativeModalityType = 'text_to_image' | 'text_to_video' | 'video_to_video';
export type VideoEditOperationType =
  | 'style_transfer'
  | 'inpainting'
  | 'motion_brush'
  | 'camera_control';

export interface TwoPathWorkflowRequest {
  path: OrchestrationPathType;
  modality?: GenerativeModalityType;
  jobId: string;
  tenantId: string;
  modelId: string;
  prompt: string;
  assetUri?: string;
  resolution?: string;
  fps?: number;
  durationSeconds?: number;
  editOperation?: VideoEditOperationType;
  editStrength?: number;
  useTorchscript?: boolean;
  maxNewTokens?: number;
}

export interface TwoPathStageRecord {
  stage: string;
  computeClass: 'ecs_fargate_cpu' | 'k8s_cpu_spot' | 'k8s_gpu_kueue';
  orchestrator: 'SQS + KEDA' | 'Flyte + Kueue + Kyverno' | 'S3 + CloudFront + Kinesis';
  status: 'SUCCEEDED';
  details: Record<string, unknown>;
}

export interface TwoPathWorkflowResult {
  path: OrchestrationPathType;
  modality: GenerativeModalityType;
  architecturePattern:
    | 'Path A: Low-Latency Queue (ECS Fargate -> SQS -> KEDA GPU Worker -> S3/CloudFront -> Kinesis)'
    | 'Path B: Multi-Stage DAG (ECS Fargate -> Flyte [CPU Preprocess -> Kueue/Kyverno TorchScript GPU -> CPU Package] -> S3/CloudFront -> Kinesis)';
  jobId: string;
  tenantId: string;
  modelId: string;
  backend: 'pytorch_torchscript_cpu' | 'pytorch_cpu';
  torchscriptCompiled: boolean;
  stages: TwoPathStageRecord[];
  artifacts: {
    s3ArtifactKey: string;
    s3MediaKey: string;
    cloudfrontDeliveryUrl: string;
    cloudfrontMediaUrl: string;
    cloudfrontPosterUrl: string;
    flytePreprocessingCacheKey: string | null;
  };
  usageAndBilling: {
    label: 'estimated';
    promptTokens: number;
    completionTokens: number;
    spatiotemporalPatchTokens: number;
    totalTokens: number;
    framesGenerated: number;
    resolution: string;
    fps: number;
    durationSeconds: number;
    gpuSeconds: number;
    estimatedCostUsd: number;
  };
  kueueKyvernoAdmission: {
    enforced: boolean;
    localQueueName: string | null;
    initialSuspend: boolean | null;
    kyvernoNonRootVerified: boolean;
  };
  kinesisMeteringEvent: {
    streamName: string;
    partitionKey: string;
    eventType: 'INFERENCE_COMPLETED';
    orchestrationPath: OrchestrationPathType;
    modality: GenerativeModalityType;
    tokensGenerated: number;
    framesGenerated: number;
    estimatedCostUsd: number;
  };
}

export class AwsPlatformController {
  private stacks = new Map<string, EphemeralStackRecord>();

  executeTwoPathWorkflow(req: TwoPathWorkflowRequest): TwoPathWorkflowResult {
    const useTorchscript = req.useTorchscript ?? true;
    const maxNewTokens = req.maxNewTokens ?? 24;
    const modality: GenerativeModalityType =
      req.modality ?? (req.path === 'path_a_sqs_keda' ? 'text_to_image' : 'text_to_video');
    const resolution = req.resolution ?? '1280x720';
    const fps = modality === 'text_to_image' ? 1 : (req.fps ?? 24);
    const durationSeconds = modality === 'text_to_image' ? 0 : (req.durationSeconds ?? 4);
    const framesGenerated = modality === 'text_to_image' ? 1 : Math.max(1, fps * durationSeconds);
    const promptTokens = Math.max(4, req.prompt.trim().split(/\s+/).length * 2);
    const spatiotemporalPatchTokens = framesGenerated * 16;
    const totalTokens = promptTokens + maxNewTokens + spatiotemporalPatchTokens;
    const gpuSeconds = Number((framesGenerated * 0.12).toFixed(2));
    const estimatedCostUsd = Number((totalTokens * 0.000002 + gpuSeconds * 0.00028).toFixed(6));

    const backend = useTorchscript ? 'pytorch_torchscript_cpu' : 'pytorch_cpu';
    const mediaExt = modality === 'text_to_image' ? 'png' : 'mp4';
    const s3ArtifactKey = `tenants/${req.tenantId}/jobs/${req.jobId}/result.json`;
    const s3MediaKey = `tenants/${req.tenantId}/jobs/${req.jobId}/output.${mediaExt}`;
    const s3PosterKey = `tenants/${req.tenantId}/jobs/${req.jobId}/poster.webp`;
    const cdnBase = 'https://d111111abcdef8.cloudfront.net';
    const cloudfrontDeliveryUrl = `${cdnBase}/${s3ArtifactKey}`;
    const cloudfrontMediaUrl = `${cdnBase}/${s3MediaKey}`;
    const cloudfrontPosterUrl = `${cdnBase}/${s3PosterKey}`;
    const streamName = 'inference-ephemeral-events';

    if (req.path === 'path_a_sqs_keda') {
      return {
        path: 'path_a_sqs_keda',
        modality,
        architecturePattern:
          'Path A: Low-Latency Queue (ECS Fargate -> SQS -> KEDA GPU Worker -> S3/CloudFront -> Kinesis)',
        jobId: req.jobId,
        tenantId: req.tenantId,
        modelId: req.modelId,
        backend,
        torchscriptCompiled: useTorchscript,
        stages: [
          {
            stage: '1_sqs_enqueue_and_keda_poll',
            computeClass: 'ecs_fargate_cpu',
            orchestrator: 'SQS + KEDA',
            status: 'SUCCEEDED',
            details: {
              queueName: 'inference-ephemeral-jobs',
              kedaTargetQueueDepthPerReplica: 5,
              modality,
            },
          },
          {
            stage: '2_single_hop_gpu_inference',
            computeClass: 'k8s_gpu_kueue',
            orchestrator: 'SQS + KEDA',
            status: 'SUCCEEDED',
            details: {
              backend,
              modality,
              resolution,
              framesGenerated,
              tokensGenerated: totalTokens,
            },
          },
          {
            stage: '3_s3_cloudfront_and_kinesis_metering',
            computeClass: 'ecs_fargate_cpu',
            orchestrator: 'S3 + CloudFront + Kinesis',
            status: 'SUCCEEDED',
            details: {
              s3ArtifactKey,
              s3MediaKey,
              cloudfrontDeliveryUrl,
              cloudfrontMediaUrl,
              kinesisStream: streamName,
            },
          },
        ],
        artifacts: {
          s3ArtifactKey,
          s3MediaKey,
          cloudfrontDeliveryUrl,
          cloudfrontMediaUrl,
          cloudfrontPosterUrl,
          flytePreprocessingCacheKey: null,
        },
        usageAndBilling: {
          label: 'estimated',
          promptTokens,
          completionTokens: maxNewTokens,
          spatiotemporalPatchTokens,
          totalTokens,
          framesGenerated,
          resolution,
          fps,
          durationSeconds,
          gpuSeconds,
          estimatedCostUsd,
        },
        kueueKyvernoAdmission: {
          enforced: false,
          localQueueName: null,
          initialSuspend: null,
          kyvernoNonRootVerified: true,
        },
        kinesisMeteringEvent: {
          streamName,
          partitionKey: req.tenantId,
          eventType: 'INFERENCE_COMPLETED',
          orchestrationPath: 'path_a_sqs_keda',
          modality,
          tokensGenerated: totalTokens,
          framesGenerated,
          estimatedCostUsd,
        },
      };
    }

    const cacheKey = `tenants/${req.tenantId}/flyte-cache/${req.jobId}/preprocessed.json`;
    const editOperation =
      modality === 'video_to_video' ? (req.editOperation ?? 'style_transfer') : null;
    const editStrength = modality === 'video_to_video' ? (req.editStrength ?? 0.75) : null;

    return {
      path: 'path_b_flyte_dag',
      modality,
      architecturePattern:
        'Path B: Multi-Stage DAG (ECS Fargate -> Flyte [CPU Preprocess -> Kueue/Kyverno TorchScript GPU -> CPU Package] -> S3/CloudFront -> Kinesis)',
      jobId: req.jobId,
      tenantId: req.tenantId,
      modelId: req.modelId,
      backend,
      torchscriptCompiled: useTorchscript,
      stages: [
        {
          stage: '1_flyte_cpu_preprocess_media_asset',
          computeClass: 'k8s_cpu_spot',
          orchestrator: 'Flyte + Kueue + Kyverno',
          status: 'SUCCEEDED',
          details: {
            flyteTask: 'preprocess_media_asset',
            modality,
            assetUri:
              req.assetUri ??
              `s3://inference-ephemeral-artifacts/tenants/${req.tenantId}/inputs/${req.jobId}.mp4`,
            editOperation,
            editStrength,
            s3MemoizationCacheKey: cacheKey,
            gpuAllocated: 0,
          },
        },
        {
          stage: '2_flyte_kueue_torchscript_gpu_inference',
          computeClass: 'k8s_gpu_kueue',
          orchestrator: 'Flyte + Kueue + Kyverno',
          status: 'SUCCEEDED',
          details: {
            flyteTask: 'run_torchscript_gpu_inference',
            kueueLocalQueue: 'tenant-default-gpu-queue',
            kyvernoPolicyValidated: true,
            backend,
            modality,
            resolution,
            fps,
            durationSeconds,
            framesGenerated,
            tokensGenerated: totalTokens,
            gpuAllocated: 1,
          },
        },
        {
          stage: '3_flyte_cpu_package_s3_cloudfront_artifact',
          computeClass: 'k8s_cpu_spot',
          orchestrator: 'S3 + CloudFront + Kinesis',
          status: 'SUCCEEDED',
          details: {
            flyteTask: 'package_s3_cloudfront_artifact',
            s3ArtifactKey,
            s3MediaKey,
            cloudfrontDeliveryUrl,
            cloudfrontMediaUrl,
            cloudfrontPosterUrl,
            kinesisStream: streamName,
            gpuAllocated: 0,
          },
        },
      ],
      artifacts: {
        s3ArtifactKey,
        s3MediaKey,
        cloudfrontDeliveryUrl,
        cloudfrontMediaUrl,
        cloudfrontPosterUrl,
        flytePreprocessingCacheKey: cacheKey,
      },
      usageAndBilling: {
        label: 'estimated',
        promptTokens,
        completionTokens: maxNewTokens,
        spatiotemporalPatchTokens,
        totalTokens,
        framesGenerated,
        resolution,
        fps,
        durationSeconds,
        gpuSeconds,
        estimatedCostUsd,
      },
      kueueKyvernoAdmission: {
        enforced: true,
        localQueueName: 'tenant-default-gpu-queue',
        initialSuspend: true,
        kyvernoNonRootVerified: true,
      },
      kinesisMeteringEvent: {
        streamName,
        partitionKey: req.tenantId,
        eventType: 'INFERENCE_COMPLETED',
        orchestrationPath: 'path_b_flyte_dag',
        modality,
        tokensGenerated: totalTokens,
        framesGenerated,
        estimatedCostUsd,
      },
    };
  }


  deployEphemeralStack(spec: AwsDeploymentSpec): {
    stack: EphemeralStackRecord;
    guardrails: AwsGuardrailEvaluationResult;
  } {
    const existing = this.stacks.get(spec.ephemeralRunId);
    if (existing && existing.status === 'DEPLOYED') {
      throw new ConflictError(
        `Ephemeral AWS stack '${spec.ephemeralRunId}' is already deployed`,
        'STACK_ALREADY_EXISTS'
      );
    }

    const guardrails = evaluateAwsDeploymentGuardrails(spec);
    if (!guardrails.passed) {
      throw new ValidationError(
        `AWS deployment rejected by platform guardrails: ${guardrails.violations.map((v) => v.message).join(' ')}`,
        {
          rules_violated: guardrails.violations.map((v) => v.rule),
          violations: guardrails.violations,
          cost_estimation: guardrails.costEstimation,
        },
        'AWS_GUARDRAIL_VIOLATION'
      );
    }

    const environment = spec.environment ?? 'ephemeral';
    const awsRegion = spec.awsRegion ?? 'eu-central-1';
    const enableEks = spec.enableEks ?? false;
    const enableGpuNodeGroup = spec.enableGpuNodeGroup ?? false;
    const prefix = `inference-${environment}-${spec.ephemeralRunId}`;
    const resourcesCreated = 18 + (enableEks ? 2 : 0) + (enableGpuNodeGroup ? 1 : 0);

    const now = new Date();
    const ttlHours = guardrails.costEstimation.ephemeralTtlHours;
    const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);

    const stack: EphemeralStackRecord = {
      ephemeralRunId: spec.ephemeralRunId,
      environment,
      awsRegion,
      status: 'DEPLOYED',
      enableEks,
      enableGpuNodeGroup,
      permanentGpuOrEksDependency: false,
      resourcesCreated,
      survivingResources: resourcesCreated,
      s3BucketName: `${prefix}-artifacts`,
      cloudfrontDomainName: `${prefix}-cdn.cloudfront.net`,
      sqsQueueUrl: `https://sqs.${awsRegion}.amazonaws.com/000000000000/${prefix}-jobs`,
      sqsDlqUrl: `https://sqs.${awsRegion}.amazonaws.com/000000000000/${prefix}-jobs-dlq`,
      ecsServiceName: `${prefix}-api`,
      kinesisStreamName: `${prefix}-events`,
      iamRoles: {
        githubOidcRoleArn: `arn:aws:iam::000000000000:role/${prefix}-github-oidc-deployer`,
        apiIrsaRoleArn: `arn:aws:iam::000000000000:role/${prefix}-api-irsa`,
        workerIrsaRoleArn: `arn:aws:iam::000000000000:role/${prefix}-worker-irsa`,
        kedaIrsaRoleArn: `arn:aws:iam::000000000000:role/${prefix}-keda-irsa`,
        lambdaMeteringRoleArn: `arn:aws:iam::000000000000:role/${prefix}-lambda-metering-role`,
      },
      costEstimation: guardrails.costEstimation,
      deployedAt: now.toISOString(),
      ttlExpiresAt: expiresAt.toISOString(),
      destroyedAt: null,
    };

    this.stacks.set(spec.ephemeralRunId, stack);
    return { stack, guardrails };
  }

  destroyEphemeralStack(ephemeralRunId: string): EphemeralStackRecord {
    const existing = this.stacks.get(ephemeralRunId);
    if (!existing) {
      throw new NotFoundError(`Ephemeral AWS stack '${ephemeralRunId}' not found`);
    }
    if (existing.status === 'DESTROYED') {
      throw new ConflictError(
        `Ephemeral AWS stack '${ephemeralRunId}' is already in DESTROYED state`,
        'STACK_ALREADY_DESTROYED'
      );
    }

    existing.status = 'DESTROYED';
    existing.survivingResources = 0;
    existing.destroyedAt = new Date().toISOString();
    existing.costEstimation = {
      ...existing.costEstimation,
      hourlyFixedUsd: 0.0,
      estimatedRunCostUsd: 0.0,
      budgetUtilizationRatio: 0.0,
    };
    return existing;
  }

  getPlatformStatus() {
    const allStacks = Array.from(this.stacks.values());
    const activeStacks = allStacks.filter((s) => s.status === 'DEPLOYED');
    const activeHourlyCostUsd = Number(
      activeStacks
        .reduce((sum, s) => sum + s.costEstimation.hourlyFixedUsd, 0)
        .toFixed(4)
    );

    return {
      executionMode: 'Simulated' as const,
      permanentGpuOrEksDependency: false,
      modules: TERRAFORM_MODULES_CATALOG,
      activeDeploymentsCount: activeStacks.length,
      activeHourlyCostUsd,
      deployments: allStacks,
    };
  }
}

