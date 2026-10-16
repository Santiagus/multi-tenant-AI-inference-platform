import { ConflictError, NotFoundError, ValidationError } from './errors.js';

export type RoutingPreference =
  | 'local_first'
  | 'cost_optimized'
  | 'latency_optimized'
  | 'tenant_pinned';

export interface WorkloadRequirements {
  modelId: string;
  promptTokens?: number;
  maxNewTokens?: number;
  estimatedVramMb?: number;
  modality?: string;
  requiresVpc?: boolean;
  isProprietary?: boolean;
}

export interface CapacityConstraints {
  localVramTotalMb?: number;
  localVramAllocatedMb?: number;
  localQueueDepth?: number;
  localQueueThreshold?: number;
  workerConcurrency?: number;
  estimatedJobComputeMs?: number;
}

export interface LatencySlo {
  latencySloMs?: number;
}

export interface ProviderProfile {
  name: string;
  healthy: boolean;
  latencyP95Ms: number;
  costMicrocentsPerToken: number;
  isExternalGpu: boolean;
  isCloudApi: boolean;
  supportsVpc: boolean;
  mockMode?: boolean;
}

export interface TenantRoutingPolicy {
  tenantId?: string;
  tenantTier?: 'free' | 'standard' | 'pro' | 'enterprise';
  routingPreference?: RoutingPreference;
  pinnedProvider?: string;
  allowedProviders?: string[];
  disallowedProviders?: string[];
  maxCostMicrocents?: number;
  billedRateMicrocentsPerToken?: number;
}

export interface EconomicsConstraints {
  targetGrossMargin?: number; // e.g. 0.40 = 40% target gross margin
  allowMarginDegradationForSlo?: boolean;
}

export interface RoutingStageTrace {
  stage: string;
  passed: string[];
  rejected: Array<{
    provider: string;
    reason: string;
    details?: string;
    [key: string]: unknown;
  }>;
}

export interface RoutingDecision {
  selectedProvider: string;
  routingPreference: RoutingPreference;
  decisionCode: string;
  explanation: string;
  stages: RoutingStageTrace[];
  candidateMargins: Record<string, number>;
  candidateCosts: Record<string, number>;
  projectedRevenueMicrocents: number;
  sloRiskDetected: boolean;
  localQueueSaturated: boolean;
}

export const DEFAULT_PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  local_pytorch: {
    name: 'local_pytorch',
    healthy: true,
    latencyP95Ms: 120,
    costMicrocentsPerToken: 5,
    isExternalGpu: false,
    isCloudApi: false,
    supportsVpc: true,
    mockMode: false,
  },
  runpod: {
    name: 'runpod',
    healthy: true,
    latencyP95Ms: 180,
    costMicrocentsPerToken: 12,
    isExternalGpu: true,
    isCloudApi: false,
    supportsVpc: false,
    mockMode: true,
  },
  bedrock: {
    name: 'bedrock',
    healthy: true,
    latencyP95Ms: 350,
    costMicrocentsPerToken: 25,
    isExternalGpu: false,
    isCloudApi: true,
    supportsVpc: false,
    mockMode: true,
  },
  sagemaker: {
    name: 'sagemaker',
    healthy: true,
    latencyP95Ms: 220,
    costMicrocentsPerToken: 20,
    isExternalGpu: true,
    isCloudApi: false,
    supportsVpc: true,
    mockMode: true,
  },
};

export const DEFAULT_CAPACITY: Required<CapacityConstraints> = {
  localVramTotalMb: 16384,
  localVramAllocatedMb: 4096,
  localQueueDepth: 0,
  localQueueThreshold: 10,
  workerConcurrency: 4,
  estimatedJobComputeMs: 150,
};

export const DEFAULT_SLO: Required<LatencySlo> = {
  latencySloMs: 1500,
};

export const DEFAULT_ECONOMICS: Required<EconomicsConstraints> = {
  targetGrossMargin: 0.4,
  allowMarginDegradationForSlo: false,
};

export const DEFAULT_TENANT_POLICY: Required<TenantRoutingPolicy> = {
  tenantId: 'tenant-default',
  tenantTier: 'standard',
  routingPreference: 'local_first',
  pinnedProvider: '',
  allowedProviders: ['local_pytorch', 'runpod', 'bedrock', 'sagemaker'],
  disallowedProviders: [],
  maxCostMicrocents: 500000,
  billedRateMicrocentsPerToken: 40,
};

/**
 * Deterministic Routing Policy Engine.
 * Evaluates workload requirements, VRAM/capacity, queue backlog, latency SLO,
 * provider health, tenant policy, estimated cost, and target gross margin.
 */
export function evaluateProviderRouting(
  workload: WorkloadRequirements,
  capacityInput?: CapacityConstraints,
  sloInput?: LatencySlo,
  tenantPolicyInput?: TenantRoutingPolicy,
  economicsInput?: EconomicsConstraints,
  providerOverrides?: Record<string, ProviderProfile>
): RoutingDecision {
  if (!workload.modelId || !workload.modelId.trim()) {
    throw new ValidationError('modelId is required for routing evaluation', {
      modelId: ['must not be empty'],
    });
  }

  const capacity = { ...DEFAULT_CAPACITY, ...(capacityInput ?? {}) };
  const slo = { ...DEFAULT_SLO, ...(sloInput ?? {}) };
  const tenantPolicy = { ...DEFAULT_TENANT_POLICY, ...(tenantPolicyInput ?? {}) };
  const economics = { ...DEFAULT_ECONOMICS, ...(economicsInput ?? {}) };

  const profiles: Record<string, ProviderProfile> = {
    ...DEFAULT_PROVIDER_PROFILES,
    ...(providerOverrides ?? {}),
  };

  const stages: RoutingStageTrace[] = [];
  const candidateNames = Object.keys(profiles);

  // Stage 1: Tenant Policy & Model Governance
  const tenantPassed: string[] = [];
  const tenantRejected: RoutingStageTrace['rejected'] = [];

  const lowerModel = workload.modelId.toLowerCase();
  const isClaude = lowerModel.includes('claude') || lowerModel.startsWith('anthropic.');
  const effectiveProprietary = Boolean(workload.isProprietary || isClaude);

  for (const name of candidateNames) {
    if (tenantPolicy.disallowedProviders.includes(name)) {
      tenantRejected.push({ provider: name, reason: 'tenant_disallowed_provider' });
      continue;
    }
    if (!tenantPolicy.allowedProviders.includes(name)) {
      tenantRejected.push({ provider: name, reason: 'tenant_unauthorized_provider' });
      continue;
    }
    if (tenantPolicy.pinnedProvider && name !== tenantPolicy.pinnedProvider) {
      tenantRejected.push({
        provider: name,
        reason: `pinned_to_${tenantPolicy.pinnedProvider}`,
      });
      continue;
    }
    if (effectiveProprietary && name !== 'bedrock') {
      tenantRejected.push({
        provider: name,
        reason: 'proprietary_model_requires_bedrock',
      });
      continue;
    }
    if (workload.requiresVpc && !profiles[name]?.supportsVpc) {
      tenantRejected.push({
        provider: name,
        reason: 'vpc_isolation_required',
      });
      continue;
    }
    tenantPassed.push(name);
  }

  stages.push({ stage: 'tenant_policy', passed: tenantPassed, rejected: tenantRejected });

  // Stage 2: Hardware Capacity & Queue/SLO Pressure
  const capPassed: string[] = [];
  const capRejected: RoutingStageTrace['rejected'] = [];

  const localHeadroomMb = Math.max(0, capacity.localVramTotalMb - capacity.localVramAllocatedMb);
  const estimatedVram = workload.estimatedVramMb ?? 8192;
  const vramExceeded =
    estimatedVram > localHeadroomMb || estimatedVram > capacity.localVramTotalMb;

  const concurrency = Math.max(1, capacity.workerConcurrency);
  const estimatedQueueWaitMs =
    (capacity.localQueueDepth / concurrency) * capacity.estimatedJobComputeMs;
  const totalEstimatedLocalMs = estimatedQueueWaitMs + capacity.estimatedJobComputeMs;

  const localQueueSaturated = capacity.localQueueDepth >= capacity.localQueueThreshold;
  const sloRiskDetected =
    totalEstimatedLocalMs > slo.latencySloMs || localQueueSaturated;

  for (const name of tenantPassed) {
    if (name === 'local_pytorch') {
      if (vramExceeded) {
        capRejected.push({
          provider: name,
          reason: 'local_vram_exceeded',
          details: `req=${estimatedVram}MB > headroom=${localHeadroomMb}MB`,
        });
        continue;
      }
      if (sloRiskDetected && tenantPassed.length > 1) {
        capRejected.push({
          provider: name,
          reason: 'local_queue_saturated_and_slo_risk',
          details: `queue_depth=${capacity.localQueueDepth} >= thresh=${capacity.localQueueThreshold}, est_latency=${Math.round(totalEstimatedLocalMs)}ms > slo=${Math.round(slo.latencySloMs)}ms`,
        });
        continue;
      }
    }
    capPassed.push(name);
  }

  stages.push({ stage: 'hardware_capacity', passed: capPassed, rejected: capRejected });

  // Stage 3: Provider Health & Availability
  const healthPassed: string[] = [];
  const healthRejected: RoutingStageTrace['rejected'] = [];
  const poolForHealth = capPassed.length > 0 ? capPassed : tenantPassed;

  for (const name of poolForHealth) {
    const prof = profiles[name];
    if (!prof || !prof.healthy) {
      healthRejected.push({ provider: name, reason: 'provider_unhealthy' });
    } else {
      healthPassed.push(name);
    }
  }

  stages.push({ stage: 'provider_health', passed: healthPassed, rejected: healthRejected });

  // Stage 4: Economics, Costs & Target Gross Margin
  const promptTokens = workload.promptTokens ?? 16;
  const maxNewTokens = workload.maxNewTokens ?? 32;
  const totalTokens = Math.max(1, promptTokens + maxNewTokens);
  const projectedRevenue = totalTokens * tenantPolicy.billedRateMicrocentsPerToken;

  const candidateCosts: Record<string, number> = {};
  const candidateMargins: Record<string, number> = {};
  const econPassed: string[] = [];
  const econRejected: RoutingStageTrace['rejected'] = [];

  for (const name of healthPassed) {
    const prof = profiles[name]!;
    const cost = totalTokens * prof.costMicrocentsPerToken;
    candidateCosts[name] = cost;
    const margin =
      projectedRevenue > 0
        ? Number(((projectedRevenue - cost) / projectedRevenue).toFixed(4))
        : 0;
    candidateMargins[name] = margin;

    if (cost > tenantPolicy.maxCostMicrocents) {
      econRejected.push({
        provider: name,
        reason: 'exceeds_tenant_max_cost',
        details: `cost=${cost} > limit=${tenantPolicy.maxCostMicrocents}`,
      });
      continue;
    }

    const marginOk = margin >= economics.targetGrossMargin;
    if (!marginOk) {
      if (economics.allowMarginDegradationForSlo && sloRiskDetected && margin > 0) {
        econPassed.push(name);
      } else {
        econRejected.push({
          provider: name,
          reason: 'target_gross_margin_unacceptable',
          details: `margin=${(margin * 100).toFixed(1)}% < target=${(economics.targetGrossMargin * 100).toFixed(1)}%`,
        });
      }
    } else {
      econPassed.push(name);
    }
  }

  stages.push({ stage: 'economics_and_margin', passed: econPassed, rejected: econRejected });

  // Stage 5: Final Deterministic Selection
  const preference = tenantPolicy.routingPreference;
  let selectedProvider: string;
  let decisionCode: string;
  let explanation: string;

  if (preference === 'tenant_pinned' && tenantPolicy.pinnedProvider) {
    selectedProvider = tenantPolicy.pinnedProvider;
    decisionCode = 'TENANT_PINNED_PROVIDER';
    explanation = `tenant pinned to '${selectedProvider}' -> dispatched directly`;
  } else if (effectiveProprietary) {
    selectedProvider = 'bedrock';
    const margin = candidateMargins.bedrock ?? 0;
    decisionCode = 'PROPRIETARY_MODEL_BEDROCK';
    explanation = `model proprietary (${workload.modelId}) + provider available (bedrock=healthy) + margin acceptable (margin=${(margin * 100).toFixed(1)}%) -> external managed provider`;
  } else if (workload.requiresVpc) {
    if (!vramExceeded && !sloRiskDetected && econPassed.includes('local_pytorch')) {
      selectedProvider = 'local_pytorch';
      decisionCode = 'VPC_LOCAL_PREFERRED';
      explanation = 'VPC workload fits local GPU capacity -> routed to local worker';
    } else if (econPassed.includes('sagemaker')) {
      selectedProvider = 'sagemaker';
      decisionCode = 'VPC_SAGEMAKER_DISPATCH';
      const margin = candidateMargins.sagemaker ?? 0;
      explanation = `VPC isolation required + external endpoint available (sagemaker) + margin acceptable (margin=${(margin * 100).toFixed(1)}%) -> external VPC provider`;
    } else {
      selectedProvider = 'local_pytorch';
      decisionCode = 'VPC_FALLBACK_LOCAL';
      explanation =
        'VPC workload fallback to local worker (external VPC endpoint unavailable/unprofitable)';
    }
  } else if (preference === 'local_first') {
    if (!vramExceeded && !sloRiskDetected && econPassed.includes('local_pytorch')) {
      selectedProvider = 'local_pytorch';
      decisionCode = 'LOCAL_CAPACITY_OPTIMAL';
      const margin = candidateMargins.local_pytorch ?? 0;
      explanation = `local VRAM available (headroom=${Math.round(localHeadroomMb)}MB) + queue within capacity (depth=${capacity.localQueueDepth} < threshold=${capacity.localQueueThreshold}) + margin acceptable (margin=${(margin * 100).toFixed(1)}%) -> local GPU worker`;
    } else {
      const externalGpuCandidates = econPassed.filter((p) =>
        ['runpod', 'sagemaker', 'bedrock'].includes(p)
      );
      if (externalGpuCandidates.length > 0) {
        selectedProvider = externalGpuCandidates.includes('runpod')
          ? 'runpod'
          : externalGpuCandidates[0]!;
        decisionCode = 'SLO_RISK_SPILLOVER_EXTERNAL_GPU';
        const reasonClause = vramExceeded ? 'local VRAM exceeded' : 'local queue high';
        explanation = `${reasonClause} + SLO risk + provider available + margin acceptable -> external GPU provider (${selectedProvider})`;
      } else {
        selectedProvider = 'local_pytorch';
        decisionCode = 'LOCAL_QUEUE_RETAIN_MARGIN_PROTECTION';
        explanation = `local queue high + SLO risk, but external providers unavailable or fail target gross margin (target=${(economics.targetGrossMargin * 100).toFixed(1)}%) -> retain on local queue`;
      }
    }
  } else if (preference === 'cost_optimized') {
    const pool = econPassed.length > 0 ? econPassed : healthPassed;
    if (pool.length > 0) {
      selectedProvider = pool.reduce((minP, curP) =>
        (candidateCosts[curP] ?? 999999) < (candidateCosts[minP] ?? 999999) ? curP : minP
      );
      decisionCode = 'COST_OPTIMIZED_SELECTION';
      explanation = `cost optimized preference -> selected lowest cost provider '${selectedProvider}' (${candidateCosts[selectedProvider]} microcents)`;
    } else {
      selectedProvider = 'local_pytorch';
      decisionCode = 'FALLBACK_LOCAL';
      explanation = 'fallback to local worker';
    }
  } else if (preference === 'latency_optimized') {
    const pool = econPassed.length > 0 ? econPassed : healthPassed;
    if (pool.length > 0) {
      selectedProvider = pool.reduce((minP, curP) =>
        (profiles[curP]?.latencyP95Ms ?? 9999) < (profiles[minP]?.latencyP95Ms ?? 9999)
          ? curP
          : minP
      );
      decisionCode = 'LATENCY_OPTIMIZED_SELECTION';
      explanation = `latency optimized preference -> selected lowest P95 latency provider '${selectedProvider}' (${profiles[selectedProvider]?.latencyP95Ms}ms)`;
    } else {
      selectedProvider = 'local_pytorch';
      decisionCode = 'FALLBACK_LOCAL';
      explanation = 'fallback to local worker';
    }
  } else {
    selectedProvider = 'local_pytorch';
    decisionCode = 'DEFAULT_LOCAL';
    explanation = 'routed to default local worker';
  }

  return {
    selectedProvider,
    routingPreference: preference,
    decisionCode,
    explanation,
    stages,
    candidateMargins,
    candidateCosts,
    projectedRevenueMicrocents: projectedRevenue,
    sloRiskDetected,
    localQueueSaturated,
  };
}

/**
 * Controller providing provider catalog and evaluation endpoints.
 */
export class ProviderRouterController {
  private profiles: Record<string, ProviderProfile>;

  constructor(profiles: Record<string, ProviderProfile> = DEFAULT_PROVIDER_PROFILES) {
    this.profiles = { ...profiles };
  }

  public getProviderCatalog(): Record<string, ProviderProfile> {
    return { ...this.profiles };
  }

  public setProviderHealth(provider: string, healthy: boolean): void {
    if (!this.profiles[provider]) {
      throw new NotFoundError(`Provider '${provider}' not found in catalog`);
    }
    this.profiles[provider] = {
      ...this.profiles[provider]!,
      healthy,
    };
  }

  public evaluate(
    workload: WorkloadRequirements,
    capacity?: CapacityConstraints,
    slo?: LatencySlo,
    tenantPolicy?: TenantRoutingPolicy,
    economics?: EconomicsConstraints
  ): RoutingDecision {
    return evaluateProviderRouting(
      workload,
      capacity,
      slo,
      tenantPolicy,
      economics,
      this.profiles
    );
  }
}

