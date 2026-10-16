import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROVIDER_PROFILES,
  evaluateProviderRouting,
  ProviderRouterController,
} from '../../src/domain/provider-routing.js';
import { NotFoundError, ValidationError } from '../../src/domain/errors.js';

describe('Provider Routing Domain: Deterministic Policy Engine & Explainability (M08)', () => {
  test('evaluateProviderRouting throws ValidationError when modelId is empty', () => {
    assert.throws(
      () =>
        evaluateProviderRouting({
          modelId: '',
        }),
      (err: unknown) => err instanceof ValidationError
    );
  });

  test('Local capacity optimal: routes to local_pytorch when queue is low and VRAM fits', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'meta-llama/Llama-3-8B-Instruct',
        promptTokens: 64,
        maxNewTokens: 32,
        estimatedVramMb: 4096,
      },
      {
        localVramTotalMb: 16384,
        localVramAllocatedMb: 4096,
        localQueueDepth: 2,
        localQueueThreshold: 10,
      },
      { latencySloMs: 1500 },
      {
        routingPreference: 'local_first',
        billedRateMicrocentsPerToken: 40,
      },
      { targetGrossMargin: 0.4 }
    );

    assert.equal(decision.selectedProvider, 'local_pytorch');
    assert.equal(decision.decisionCode, 'LOCAL_CAPACITY_OPTIMAL');
    assert.equal(decision.sloRiskDetected, false);
    assert.equal(decision.localQueueSaturated, false);
    assert.match(decision.explanation, /local VRAM available/);
    assert.match(decision.explanation, /local GPU worker/);
    assert.equal(decision.stages.length, 4);
    assert.ok((decision.candidateMargins.local_pytorch ?? 0) >= 0.4);
  });

  test('SLO risk spillover: spills over to external GPU (RunPod) when local queue exceeds threshold', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'meta-llama/Llama-3-8B-Instruct',
        promptTokens: 128,
        maxNewTokens: 64,
        estimatedVramMb: 4096,
      },
      {
        localQueueDepth: 14,
        localQueueThreshold: 10,
        workerConcurrency: 4,
        estimatedJobComputeMs: 150,
      },
      { latencySloMs: 1500 },
      {
        routingPreference: 'local_first',
        billedRateMicrocentsPerToken: 40,
      },
      { targetGrossMargin: 0.4 }
    );

    assert.equal(decision.selectedProvider, 'runpod');
    assert.equal(decision.decisionCode, 'SLO_RISK_SPILLOVER_EXTERNAL_GPU');
    assert.equal(decision.localQueueSaturated, true);
    assert.equal(decision.sloRiskDetected, true);
    assert.equal(
      decision.explanation,
      'local queue high + SLO risk + provider available + margin acceptable -> external GPU provider (runpod)'
    );
  });

  test('VRAM overflow spillover: spills over to external GPU when model VRAM exceeds local headroom', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'large-deepseek-67b',
        promptTokens: 256,
        maxNewTokens: 64,
        estimatedVramMb: 32000, // Exceeds 16GB local VRAM
      },
      {
        localVramTotalMb: 16384,
        localVramAllocatedMb: 2048,
        localQueueDepth: 1,
        localQueueThreshold: 10,
      }
    );

    assert.equal(decision.selectedProvider, 'runpod');
    assert.equal(decision.decisionCode, 'SLO_RISK_SPILLOVER_EXTERNAL_GPU');
    assert.match(decision.explanation, /local VRAM exceeded/);
  });

  test('Proprietary model routing: Anthropic Claude models route to AWS Bedrock', () => {
    const decision = evaluateProviderRouting({
      modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
      isProprietary: true,
      promptTokens: 256,
      maxNewTokens: 128,
    });

    assert.equal(decision.selectedProvider, 'bedrock');
    assert.equal(decision.decisionCode, 'PROPRIETARY_MODEL_BEDROCK');
    assert.match(decision.explanation, /model proprietary/);
    assert.match(decision.explanation, /external managed provider/);
  });

  test('VPC enterprise constraint: routes to SageMaker when local is saturated and VPC is required', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'sagemaker-llama3-endpoint',
        requiresVpc: true,
        promptTokens: 128,
        maxNewTokens: 64,
      },
      {
        localQueueDepth: 15,
        localQueueThreshold: 10,
      },
      undefined,
      {
        allowedProviders: ['local_pytorch', 'sagemaker'],
        billedRateMicrocentsPerToken: 50,
      }
    );

    assert.equal(decision.selectedProvider, 'sagemaker');
    assert.equal(decision.decisionCode, 'VPC_SAGEMAKER_DISPATCH');
    assert.match(decision.explanation, /VPC isolation required/);
  });

  test('VPC enterprise constraint: prefers local worker when within local GPU capacity', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'custom-internal-model',
        requiresVpc: true,
        estimatedVramMb: 4096,
      },
      {
        localQueueDepth: 1,
        localQueueThreshold: 10,
      }
    );

    assert.equal(decision.selectedProvider, 'local_pytorch');
    assert.equal(decision.decisionCode, 'VPC_LOCAL_PREFERRED');
    assert.match(decision.explanation, /VPC workload fits local GPU capacity/);
  });

  test('VPC fallback to local worker if external VPC endpoint is unavailable', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'custom-internal-model',
        requiresVpc: true,
        estimatedVramMb: 30000,
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...DEFAULT_PROVIDER_PROFILES,
        sagemaker: { ...DEFAULT_PROVIDER_PROFILES.sagemaker, healthy: false },
      }
    );

    assert.equal(decision.selectedProvider, 'local_pytorch');
    assert.equal(decision.decisionCode, 'VPC_FALLBACK_LOCAL');
    assert.match(decision.explanation, /VPC workload fallback to local worker/);
  });

  test('Gross margin protection: retains on local queue when external providers fail target gross margin', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'meta-llama/Llama-3-8B-Instruct',
        promptTokens: 100,
        maxNewTokens: 50,
      },
      {
        localQueueDepth: 15,
        localQueueThreshold: 10,
      },
      undefined,
      {
        billedRateMicrocentsPerToken: 15, // Low customer rate: cloud costs will exceed 60% margin
      },
      {
        targetGrossMargin: 0.6,
        allowMarginDegradationForSlo: false,
      }
    );

    assert.equal(decision.selectedProvider, 'local_pytorch');
    assert.equal(decision.decisionCode, 'LOCAL_QUEUE_RETAIN_MARGIN_PROTECTION');
    assert.match(decision.explanation, /retain on local queue/);
  });

  test('Gross margin degradation: allows lower margin when allowMarginDegradationForSlo is true under SLO risk', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'meta-llama/Llama-3-8B-Instruct',
        promptTokens: 100,
        maxNewTokens: 50,
      },
      {
        localQueueDepth: 15,
        localQueueThreshold: 10,
      },
      undefined,
      {
        billedRateMicrocentsPerToken: 16, // At 16 microcents/token, RunPod cost (12) gives margin 0.25 < target 0.40
      },
      {
        targetGrossMargin: 0.4,
        allowMarginDegradationForSlo: true,
      }
    );

    assert.equal(decision.selectedProvider, 'runpod');
    assert.equal(decision.decisionCode, 'SLO_RISK_SPILLOVER_EXTERNAL_GPU');
  });

  test('Tenant pinned provider: strictly enforces pinned provider choice', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'generic-model',
      },
      undefined,
      undefined,
      {
        routingPreference: 'tenant_pinned',
        pinnedProvider: 'sagemaker',
      }
    );

    assert.equal(decision.selectedProvider, 'sagemaker');
    assert.equal(decision.decisionCode, 'TENANT_PINNED_PROVIDER');
    assert.match(decision.explanation, /tenant pinned to 'sagemaker'/);
  });

  test('Tenant disallowed provider: rejects disallowed provider at stage 1', () => {
    const decision = evaluateProviderRouting(
      {
        modelId: 'generic-model',
      },
      {
        localQueueDepth: 15,
        localQueueThreshold: 10,
      },
      undefined,
      {
        disallowedProviders: ['runpod'], // Compliance forbids RunPod
        allowedProviders: ['local_pytorch', 'bedrock', 'sagemaker'],
      }
    );

    assert.notEqual(decision.selectedProvider, 'runpod');
    const stage1 = decision.stages.find((s) => s.stage === 'tenant_policy');
    assert.ok(stage1?.rejected.some((r) => r.provider === 'runpod'));
  });

  test('Cost optimized and Latency optimized preferences select expected providers', () => {
    const costDecision = evaluateProviderRouting(
      { modelId: 'm1' },
      undefined,
      undefined,
      { routingPreference: 'cost_optimized' }
    );
    assert.equal(costDecision.selectedProvider, 'local_pytorch');
    assert.equal(costDecision.decisionCode, 'COST_OPTIMIZED_SELECTION');

    const latencyDecision = evaluateProviderRouting(
      { modelId: 'm1' },
      undefined,
      undefined,
      { routingPreference: 'latency_optimized' }
    );
    assert.equal(latencyDecision.selectedProvider, 'local_pytorch');
    assert.equal(latencyDecision.decisionCode, 'LATENCY_OPTIMIZED_SELECTION');
  });

  test('ProviderRouterController manages catalog and dynamic health updates', () => {
    const controller = new ProviderRouterController();
    const catalog = controller.getProviderCatalog();
    assert.equal(Object.keys(catalog).length, 4);
    assert.equal(catalog.runpod.healthy, true);

    controller.setProviderHealth('runpod', false);
    const updated = controller.getProviderCatalog();
    assert.equal(updated.runpod.healthy, false);

    assert.throws(
      () => controller.setProviderHealth('non_existent', false),
      (err: unknown) => err instanceof NotFoundError
    );

    // Evaluation through controller uses updated health
    const decision = controller.evaluate(
      { modelId: 'm1' },
      { localQueueDepth: 15, localQueueThreshold: 10 }
    );
    // RunPod is unhealthy, so it should not pick RunPod
    assert.notEqual(decision.selectedProvider, 'runpod');
  });

  test('Boundary tests: maxCost limit, empty pools, and alternative external GPU provider', () => {
    // 1. maxCostMicrocents exceeded
    const maxCostDecision = evaluateProviderRouting(
      { modelId: 'm1', promptTokens: 1000, maxNewTokens: 500 },
      undefined,
      undefined,
      { maxCostMicrocents: 10 } // tiny cap
    );
    assert.equal(maxCostDecision.selectedProvider, 'local_pytorch');

    // 2. Fallback when cost_optimized pool is empty
    const emptyCostDecision = evaluateProviderRouting(
      { modelId: 'm1' },
      undefined,
      undefined,
      {
        routingPreference: 'cost_optimized',
        allowedProviders: [], // all unauthorized
      }
    );
    assert.equal(emptyCostDecision.selectedProvider, 'local_pytorch');
    assert.equal(emptyCostDecision.decisionCode, 'FALLBACK_LOCAL');

    // 3. Fallback when latency_optimized pool is empty
    const emptyLatencyDecision = evaluateProviderRouting(
      { modelId: 'm1' },
      undefined,
      undefined,
      {
        routingPreference: 'latency_optimized',
        allowedProviders: [],
      }
    );
    assert.equal(emptyLatencyDecision.selectedProvider, 'local_pytorch');
    assert.equal(emptyLatencyDecision.decisionCode, 'FALLBACK_LOCAL');

    // 4. Default fallback when preference is unknown
    const defaultDecision = evaluateProviderRouting(
      { modelId: 'm1' },
      undefined,
      undefined,
      {
        routingPreference: 'unrecognized_preference' as any,
      }
    );
    assert.equal(defaultDecision.selectedProvider, 'local_pytorch');
    assert.equal(defaultDecision.decisionCode, 'DEFAULT_LOCAL');

    // 5. External spillover when RunPod is disallowed but SageMaker is allowed
    const altExternalDecision = evaluateProviderRouting(
      {
        modelId: 'm1',
        promptTokens: 128,
        maxNewTokens: 64,
      },
      { localQueueDepth: 15, localQueueThreshold: 10 },
      undefined,
      {
        allowedProviders: ['local_pytorch', 'sagemaker'],
        disallowedProviders: ['runpod'],
        billedRateMicrocentsPerToken: 40,
      }
    );
    assert.equal(altExternalDecision.selectedProvider, 'sagemaker');
    assert.equal(altExternalDecision.decisionCode, 'SLO_RISK_SPILLOVER_EXTERNAL_GPU');
  });
});
