import { ConflictError, NotFoundError, ValidationError } from './errors.js';

export interface KedaScalerConfig {
  scaledObjectName: string;
  targetDeployment: string;
  minReplicaCount: number;
  maxReplicaCount: number;
  targetQueueDepthPerReplica: number;
  activationThreshold: number;
  cooldownPeriodSeconds: number;
}

export interface KedaScalerInput {
  queueDepth: number;
  inFlightJobs: number;
  currentReplicas: number;
  secondsSinceLastActive: number;
}

export type KedaScaleAction =
  | 'scale_up'
  | 'scale_down'
  | 'scale_to_zero'
  | 'cooldown_hold'
  | 'steady';

export interface KedaScaleDecision {
  scaledObjectName: string;
  targetDeployment: string;
  queueDepth: number;
  inFlightJobs: number;
  effectiveBacklog: number;
  currentReplicas: number;
  desiredReplicas: number;
  minReplicaCount: number;
  maxReplicaCount: number;
  targetQueueDepthPerReplica: number;
  activationThreshold: number;
  scaleAction: KedaScaleAction;
}

export const DEFAULT_KEDA_CONFIG: KedaScalerConfig = {
  scaledObjectName: 'inference-worker-queue-scaler',
  targetDeployment: 'inference-worker',
  minReplicaCount: 0,
  maxReplicaCount: 8,
  targetQueueDepthPerReplica: 5,
  activationThreshold: 1,
  cooldownPeriodSeconds: 30,
};

export function evaluateKedaScaling(
  input: KedaScalerInput,
  config: KedaScalerConfig = DEFAULT_KEDA_CONFIG
): KedaScaleDecision {
  const queueDepth = Math.max(0, Math.floor(input.queueDepth));
  const inFlightJobs = Math.max(0, Math.floor(input.inFlightJobs));
  const currentReplicas = Math.max(0, Math.floor(input.currentReplicas));
  const effectiveBacklog = queueDepth + inFlightJobs;

  let desiredReplicas: number;
  let scaleAction: KedaScaleAction;

  if (effectiveBacklog < config.activationThreshold) {
    if (
      currentReplicas > config.minReplicaCount &&
      input.secondsSinceLastActive < config.cooldownPeriodSeconds
    ) {
      desiredReplicas = currentReplicas;
      scaleAction = 'cooldown_hold';
    } else {
      desiredReplicas = config.minReplicaCount;
      scaleAction = currentReplicas > config.minReplicaCount ? 'scale_to_zero' : 'steady';
    }
  } else {
    const rawDesired = Math.ceil(effectiveBacklog / config.targetQueueDepthPerReplica);
    const minActive = Math.max(1, config.minReplicaCount);
    desiredReplicas = Math.min(config.maxReplicaCount, Math.max(minActive, rawDesired));

    if (desiredReplicas > currentReplicas) {
      scaleAction = 'scale_up';
    } else if (desiredReplicas < currentReplicas) {
      scaleAction = 'scale_down';
    } else {
      scaleAction = 'steady';
    }
  }

  return {
    scaledObjectName: config.scaledObjectName,
    targetDeployment: config.targetDeployment,
    queueDepth,
    inFlightJobs,
    effectiveBacklog,
    currentReplicas,
    desiredReplicas,
    minReplicaCount: config.minReplicaCount,
    maxReplicaCount: config.maxReplicaCount,
    targetQueueDepthPerReplica: config.targetQueueDepthPerReplica,
    activationThreshold: config.activationThreshold,
    scaleAction,
  };
}

export interface KyvernoWorkloadSpec {
  name: string;
  namespace: string;
  kind: 'Pod' | 'Deployment' | 'Job';
  tenantId: string;
  partOfLabel: string;
  runAsNonRoot: boolean;
  allowPrivilegeEscalation: boolean;
  droppedCapabilities: string[];
  cpuRequestMillicores: number;
  memoryRequestMb: number;
  cpuLimitMillicores: number;
  memoryLimitMb: number;
  gpuCount: number;
  kueueQueueName?: string;
  suspendOnCreate?: boolean;
}

export interface KyvernoPolicyViolation {
  policy: string;
  rule: string;
  message: string;
}

export interface KyvernoEvaluationResult {
  allowed: boolean;
  evaluatedPolicies: string[];
  violations: KyvernoPolicyViolation[];
}

function checkSecurityPolicy(spec: KyvernoWorkloadSpec): KyvernoPolicyViolation[] {
  const violations: KyvernoPolicyViolation[] = [];
  const dropsAll = spec.droppedCapabilities.some((cap) => cap.toUpperCase() === 'ALL');
  if (!spec.runAsNonRoot || spec.allowPrivilegeEscalation || !dropsAll) {
    violations.push({
      policy: 'require-non-root-and-drop-capabilities',
      rule: 'enforce-non-root-and-no-privilege-escalation',
      message:
        'Containers must set runAsNonRoot=true, allowPrivilegeEscalation=false, and drop ALL capabilities.',
    });
  }
  return violations;
}

function checkResourceBoundsPolicy(spec: KyvernoWorkloadSpec): KyvernoPolicyViolation[] {
  const violations: KyvernoPolicyViolation[] = [];
  const hasValidBounds =
    spec.cpuRequestMillicores > 0 &&
    spec.memoryRequestMb > 0 &&
    spec.cpuLimitMillicores >= spec.cpuRequestMillicores &&
    spec.memoryLimitMb >= spec.memoryRequestMb &&
    spec.gpuCount >= 0;

  if (!hasValidBounds) {
    violations.push({
      policy: 'require-workload-resource-bounds',
      rule: 'require-cpu-and-memory-requests-and-limits',
      message:
        'Every container must declare positive CPU/memory requests and limits with limits >= requests.',
    });
  }

  if (spec.kind === 'Job' || spec.gpuCount > 0) {
    const hasQueueLabel = Boolean(spec.kueueQueueName && spec.kueueQueueName.trim().length > 0);
    const isSuspended = spec.kind !== 'Job' || spec.suspendOnCreate === true;
    if (!hasQueueLabel || !isSuspended) {
      violations.push({
        policy: 'require-workload-resource-bounds',
        rule: 'require-kueue-queue-label-for-batch-gpu-jobs',
        message:
          'GPU and batch Job workloads must declare kueue.x-k8s.io/queue-name and set suspend=true on Job creation.',
      });
    }
  }
  return violations;
}

function checkTenancyLabelsPolicy(spec: KyvernoWorkloadSpec): KyvernoPolicyViolation[] {
  const violations: KyvernoPolicyViolation[] = [];
  const hasTenant = Boolean(spec.tenantId && spec.tenantId.trim().length > 0);
  const validPartOf = spec.partOfLabel === 'multi-tenant-ai-inference-platform';
  if (!hasTenant || !validPartOf) {
    violations.push({
      policy: 'require-tenant-isolation-labels',
      rule: 'require-tenant-and-part-of-labels',
      message:
        'Workloads must declare platform.ai/tenant and app.kubernetes.io/part-of=multi-tenant-ai-inference-platform labels.',
    });
  }
  return violations;
}

export function evaluateKyvernoPolicies(spec: KyvernoWorkloadSpec): KyvernoEvaluationResult {
  const evaluatedPolicies = [
    'require-non-root-and-drop-capabilities',
    'require-workload-resource-bounds',
    'require-tenant-isolation-labels',
  ];
  const violations = [
    ...checkSecurityPolicy(spec),
    ...checkResourceBoundsPolicy(spec),
    ...checkTenancyLabelsPolicy(spec),
  ];
  return {
    allowed: violations.length === 0,
    evaluatedPolicies,
    violations,
  };
}

export type KueuePriorityClass =
  | 'inference-realtime-high'
  | 'inference-batch-standard'
  | 'inference-batch-backfill';

export const KUEUE_PRIORITY_VALUES: Record<KueuePriorityClass, number> = {
  'inference-realtime-high': 1000,
  'inference-batch-standard': 500,
  'inference-batch-backfill': 100,
};

export interface KueueQuotaConfig {
  clusterQueueName: string;
  cohortName: string;
  nominalGpuQuota: number;
  borrowingLimitGpu: number;
  nominalCpuMillicores: number;
  nominalMemoryMb: number;
}

export const DEFAULT_KUEUE_QUOTA: KueueQuotaConfig = {
  clusterQueueName: 'gpu-inference-cluster-queue',
  cohortName: 'tenant-shared-gpu-cohort',
  nominalGpuQuota: 2,
  borrowingLimitGpu: 2,
  nominalCpuMillicores: 16000,
  nominalMemoryMb: 65536,
};

export interface KueueWorkloadRequest {
  workloadId: string;
  tenantId: string;
  localQueueName: string;
  priorityClass: KueuePriorityClass;
  gpuCount: number;
  cpuMillicores: number;
  memoryMb: number;
  allowCohortBorrowing?: boolean;
  securityContext?: {
    runAsNonRoot: boolean;
    allowPrivilegeEscalation: boolean;
    droppedCapabilities: string[];
  };
}

export type KueueWorkloadState = 'ADMITTED' | 'QUEUED' | 'FINISHED';

export interface KueueWorkloadRecord {
  workloadId: string;
  tenantId: string;
  localQueueName: string;
  clusterQueueName: string;
  priorityClass: KueuePriorityClass;
  priorityValue: number;
  gpuCount: number;
  cpuMillicores: number;
  memoryMb: number;
  allowCohortBorrowing: boolean;
  status: KueueWorkloadState;
  suspended: boolean;
  borrowedGpuCount: number;
  submittedSequence: number;
  admittedAt?: string;
  finishedAt?: string;
}

export interface KueueClusterStatus {
  clusterQueueName: string;
  cohortName: string;
  nominalGpuQuota: number;
  borrowingLimitGpu: number;
  maxEffectiveGpuQuota: number;
  usedGpuQuota: number;
  usedCpuMillicores: number;
  usedMemoryMb: number;
  admittedCount: number;
  pendingCount: number;
  admittedWorkloads: KueueWorkloadRecord[];
  pendingWorkloads: KueueWorkloadRecord[];
}

export class KueueAdmissionController {
  private readonly quota: KueueQuotaConfig;
  private readonly workloads = new Map<string, KueueWorkloadRecord>();
  private sequenceCounter = 0;

  constructor(quota: KueueQuotaConfig = DEFAULT_KUEUE_QUOTA) {
    this.quota = quota;
  }

  getQuotaConfig(): KueueQuotaConfig {
    return { ...this.quota };
  }

  private getUsedResources(): { gpu: number; cpu: number; memory: number } {
    let gpu = 0;
    let cpu = 0;
    let memory = 0;
    for (const w of this.workloads.values()) {
      if (w.status === 'ADMITTED') {
        gpu += w.gpuCount;
        cpu += w.cpuMillicores;
        memory += w.memoryMb;
      }
    }
    return { gpu, cpu, memory };
  }

  private canFitWorkload(record: KueueWorkloadRecord): { fits: boolean; borrowedGpu: number } {
    const used = this.getUsedResources();
    const maxGpu = record.allowCohortBorrowing
      ? this.quota.nominalGpuQuota + this.quota.borrowingLimitGpu
      : this.quota.nominalGpuQuota;

    const fitsGpu = used.gpu + record.gpuCount <= maxGpu;
    const fitsCpu = used.cpu + record.cpuMillicores <= this.quota.nominalCpuMillicores;
    const fitsMem = used.memory + record.memoryMb <= this.quota.nominalMemoryMb;

    if (!fitsGpu || !fitsCpu || !fitsMem) {
      return { fits: false, borrowedGpu: 0 };
    }

    const totalGpuAfter = used.gpu + record.gpuCount;
    const borrowedGpu = Math.max(0, totalGpuAfter - this.quota.nominalGpuQuota);
    return { fits: true, borrowedGpu };
  }

  private getSortedPendingWorkloads(): KueueWorkloadRecord[] {
    return Array.from(this.workloads.values())
      .filter((w) => w.status === 'QUEUED')
      .sort((a, b) => {
        if (b.priorityValue !== a.priorityValue) {
          return b.priorityValue - a.priorityValue;
        }
        return a.submittedSequence - b.submittedSequence;
      });
  }

  submitWorkload(req: KueueWorkloadRequest): {
    workload: KueueWorkloadRecord;
    kyvernoResult: KyvernoEvaluationResult;
  } {
    if (this.workloads.has(req.workloadId)) {
      throw new ConflictError(
        `Workload '${req.workloadId}' already exists in ClusterQueue '${this.quota.clusterQueueName}'`,
        'WORKLOAD_ALREADY_EXISTS'
      );
    }

    const sec = req.securityContext ?? {
      runAsNonRoot: true,
      allowPrivilegeEscalation: false,
      droppedCapabilities: ['ALL'],
    };

    const kyvernoResult = evaluateKyvernoPolicies({
      name: req.workloadId,
      namespace: 'inference-workers',
      kind: 'Job',
      tenantId: req.tenantId,
      partOfLabel: 'multi-tenant-ai-inference-platform',
      runAsNonRoot: sec.runAsNonRoot,
      allowPrivilegeEscalation: sec.allowPrivilegeEscalation,
      droppedCapabilities: sec.droppedCapabilities,
      cpuRequestMillicores: req.cpuMillicores,
      memoryRequestMb: req.memoryMb,
      cpuLimitMillicores: req.cpuMillicores,
      memoryLimitMb: req.memoryMb,
      gpuCount: req.gpuCount,
      kueueQueueName: req.localQueueName,
      suspendOnCreate: true,
    });

    if (!kyvernoResult.allowed) {
      throw new ValidationError(
        `Kyverno admission policy rejected workload '${req.workloadId}'`,
        kyvernoResult.violations,
        'KYVERNO_POLICY_VIOLATION'
      );
    }

    const maxClusterGpu = this.quota.nominalGpuQuota + this.quota.borrowingLimitGpu;
    if (
      req.gpuCount > maxClusterGpu ||
      req.cpuMillicores > this.quota.nominalCpuMillicores ||
      req.memoryMb > this.quota.nominalMemoryMb
    ) {
      throw new ValidationError(
        `Requested resources exceed maximum ClusterQueue capacity (${maxClusterGpu} GPUs, ${this.quota.nominalCpuMillicores}m CPU)`,
        undefined,
        'KUEUE_QUOTA_EXCEEDED'
      );
    }

    this.sequenceCounter += 1;
    const priorityValue = KUEUE_PRIORITY_VALUES[req.priorityClass];
    const record: KueueWorkloadRecord = {
      workloadId: req.workloadId,
      tenantId: req.tenantId,
      localQueueName: req.localQueueName,
      clusterQueueName: this.quota.clusterQueueName,
      priorityClass: req.priorityClass,
      priorityValue,
      gpuCount: req.gpuCount,
      cpuMillicores: req.cpuMillicores,
      memoryMb: req.memoryMb,
      allowCohortBorrowing: req.allowCohortBorrowing ?? false,
      status: 'QUEUED',
      suspended: true,
      borrowedGpuCount: 0,
      submittedSequence: this.sequenceCounter,
    };

    const pending = this.getSortedPendingWorkloads();
    const higherOrEqualWaiting = pending.some((p) => p.priorityValue >= record.priorityValue);
    const fitCheck = this.canFitWorkload(record);

    if (!higherOrEqualWaiting && fitCheck.fits) {
      record.status = 'ADMITTED';
      record.suspended = false;
      record.borrowedGpuCount = fitCheck.borrowedGpu;
      record.admittedAt = new Date().toISOString();
    }

    this.workloads.set(record.workloadId, record);
    return { workload: { ...record }, kyvernoResult };
  }

  releaseWorkload(workloadId: string): {
    released: KueueWorkloadRecord;
    newlyAdmitted: KueueWorkloadRecord[];
  } {
    const existing = this.workloads.get(workloadId);
    if (!existing) {
      throw new NotFoundError(
        `Workload '${workloadId}' not found in ClusterQueue '${this.quota.clusterQueueName}'`,
        'WORKLOAD_NOT_FOUND'
      );
    }

    existing.status = 'FINISHED';
    existing.suspended = false;
    existing.borrowedGpuCount = 0;
    existing.finishedAt = new Date().toISOString();

    const newlyAdmitted: KueueWorkloadRecord[] = [];
    for (const candidate of this.getSortedPendingWorkloads()) {
      const fitCheck = this.canFitWorkload(candidate);
      if (fitCheck.fits) {
        candidate.status = 'ADMITTED';
        candidate.suspended = false;
        candidate.borrowedGpuCount = fitCheck.borrowedGpu;
        candidate.admittedAt = new Date().toISOString();
        newlyAdmitted.push({ ...candidate });
      }
    }

    return { released: { ...existing }, newlyAdmitted };
  }

  getClusterStatus(): KueueClusterStatus {
    const used = this.getUsedResources();
    const admittedWorkloads = Array.from(this.workloads.values())
      .filter((w) => w.status === 'ADMITTED')
      .map((w) => ({ ...w }));
    const pendingWorkloads = this.getSortedPendingWorkloads().map((w) => ({ ...w }));

    return {
      clusterQueueName: this.quota.clusterQueueName,
      cohortName: this.quota.cohortName,
      nominalGpuQuota: this.quota.nominalGpuQuota,
      borrowingLimitGpu: this.quota.borrowingLimitGpu,
      maxEffectiveGpuQuota: this.quota.nominalGpuQuota + this.quota.borrowingLimitGpu,
      usedGpuQuota: used.gpu,
      usedCpuMillicores: used.cpu,
      usedMemoryMb: used.memory,
      admittedCount: admittedWorkloads.length,
      pendingCount: pendingWorkloads.length,
      admittedWorkloads,
      pendingWorkloads,
    };
  }
}

