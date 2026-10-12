import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AwsPlatformController,
  evaluateAwsDeploymentGuardrails,
  TERRAFORM_MODULES_CATALOG,
} from '../../src/domain/aws-platform.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/domain/errors.js';

describe('AWS Platform Domain: Least-Privilege IAM, Cost Guardrails & Ephemeral Lifecycle (M07)', () => {
  test('evaluateAwsDeploymentGuardrails approves compliant ephemeral serverless deployment ($0/hr fixed cost)', () => {
    const result = evaluateAwsDeploymentGuardrails({
      ephemeralRunId: 'ci-ephemeral-01',
    });

    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
    assert.equal(result.costEstimation.label, 'estimated');
    assert.equal(result.costEstimation.hourlyFixedUsd, 0.0);
    assert.equal(result.costEstimation.ephemeralTtlHours, 4);
    assert.equal(result.costEstimation.estimatedRunCostUsd, 0.0);
    assert.equal(result.costEstimation.monthlyBudgetLimitUsd, 25.0);
    assert.equal(result.costEstimation.withinBudgetGuardrail, true);
  });

  test('evaluateAwsDeploymentGuardrails approves opt-in EKS with scale-to-zero GPU node group and approved production', () => {
    const eksEphemeral = evaluateAwsDeploymentGuardrails({
      ephemeralRunId: 'ci-eks-01',
      environment: 'ephemeral',
      enableEks: true,
      enableGpuNodeGroup: true,
      gpuMinNodes: 0,
      gpuMaxNodes: 1,
      monthlyBudgetLimitUsd: 25.0,
      ephemeralTtlHours: 4,
    });

    assert.equal(eksEphemeral.passed, true);
    assert.equal(eksEphemeral.costEstimation.hourlyFixedUsd, 0.133);
    assert.equal(eksEphemeral.costEstimation.estimatedRunCostUsd, 0.53);

    const prodApproved = evaluateAwsDeploymentGuardrails({
      ephemeralRunId: 'prod-release-01',
      environment: 'production',
      enableEks: true,
      enableGpuNodeGroup: true,
      gpuMinNodes: 0,
      gpuMaxNodes: 4,
      monthlyBudgetLimitUsd: 250.0,
      ephemeralTtlHours: 0,
      confirmProductionApply: true,
    });

    assert.equal(prodApproved.passed, true);
    assert.equal(prodApproved.costEstimation.hourlyFixedUsd, 0.266);
    assert.equal(prodApproved.costEstimation.estimatedRunCostUsd, 194.18);
    assert.equal(prodApproved.costEstimation.withinBudgetGuardrail, true);
  });

  test('evaluateAwsDeploymentGuardrails rejects long-lived keys, wildcard IAM, public S3, permanent GPUs, and budget overruns', () => {
    const invalid = evaluateAwsDeploymentGuardrails({
      ephemeralRunId: 'bad-deploy-01',
      environment: 'production',
      enableEks: false,
      enableGpuNodeGroup: true,
      gpuMinNodes: 2,
      gpuMaxNodes: 12,
      monthlyBudgetLimitUsd: 0,
      ephemeralTtlHours: 48,
      useLongLivedAccessKeys: true,
      iamActions: ['s3:*', '*'],
      iamResources: ['*'],
      s3PublicAccessBlocked: false,
      confirmProductionApply: false,
    });

    assert.equal(invalid.passed, false);
    const rules = invalid.violations.map((v) => v.rule);
    assert.ok(rules.includes('short-lived-oidc-credentials'));
    assert.ok(rules.includes('least-privilege-iam'));
    assert.ok(rules.includes('s3-public-access-block'));
    assert.ok(rules.includes('no-permanent-gpu-or-eks'));
    assert.ok(rules.includes('production-approval-gate'));
    assert.ok(rules.includes('budget-cost-guardrail'));
    assert.equal(invalid.costEstimation.budgetUtilizationRatio, 1.0);
  });

  test('AwsPlatformController manages ephemeral deploy -> status -> destroy lifecycle and enforces error boundaries', () => {
    const controller = new AwsPlatformController();
    assert.equal(TERRAFORM_MODULES_CATALOG.length, 7);

    // 1. Deploy ephemeral stack (serverless default)
    const { stack: s1 } = controller.deployEphemeralStack({
      ephemeralRunId: 'run-serverless-01',
    });
    assert.equal(s1.status, 'DEPLOYED');
    assert.equal(s1.resourcesCreated, 18);
    assert.equal(s1.survivingResources, 18);
    assert.equal(s1.permanentGpuOrEksDependency, false);
    assert.ok(s1.cloudfrontDomainName.endsWith('.cloudfront.net'));
    assert.equal(s1.ecsServiceName, 'inference-ephemeral-run-serverless-01-api');

    // 2. Deploy ephemeral stack with EKS + scale-to-zero GPU node group
    const { stack: s2 } = controller.deployEphemeralStack({
      ephemeralRunId: 'run-eks-02',
      enableEks: true,
      enableGpuNodeGroup: true,
    });
    assert.equal(s2.resourcesCreated, 21);

    const activeStatus = controller.getPlatformStatus();
    assert.equal(activeStatus.activeDeploymentsCount, 2);
    assert.equal(activeStatus.activeHourlyCostUsd, 0.133);

    // 3. Destroy both ephemeral stacks
    const destroyed1 = controller.destroyEphemeralStack('run-serverless-01');
    assert.equal(destroyed1.status, 'DESTROYED');
    assert.equal(destroyed1.survivingResources, 0);
    assert.equal(destroyed1.costEstimation.hourlyFixedUsd, 0.0);
    assert.ok(destroyed1.destroyedAt !== null);

    const destroyed2 = controller.destroyEphemeralStack('run-eks-02');
    assert.equal(destroyed2.survivingResources, 0);

    const postDestroyStatus = controller.getPlatformStatus();
    assert.equal(postDestroyStatus.activeDeploymentsCount, 0);
    assert.equal(postDestroyStatus.activeHourlyCostUsd, 0.0);

    const prodServerless = evaluateAwsDeploymentGuardrails({
      ephemeralRunId: 'prod-serverless-01',
      environment: 'production',
      enableEks: false,
      confirmProductionApply: true,
    });
    assert.equal(prodServerless.passed, true);
    assert.equal(prodServerless.costEstimation.hourlyFixedUsd, 0.0);

    // 4. Error boundaries: duplicate active stack, destroy non-existent, destroy already-destroyed, and guardrail rejection
    assert.throws(
      () =>
        controller.deployEphemeralStack({
          ephemeralRunId: 'run-duplicate-active',
        }) &&
        controller.deployEphemeralStack({
          ephemeralRunId: 'run-duplicate-active',
        }),
      (err: unknown) => err instanceof ConflictError && err.code === 'STACK_ALREADY_EXISTS'
    );

    assert.throws(
      () => controller.destroyEphemeralStack('missing-run-id'),
      (err: unknown) => err instanceof NotFoundError
    );

    assert.throws(
      () => controller.destroyEphemeralStack('run-serverless-01'),
      (err: unknown) => err instanceof ConflictError && err.code === 'STACK_ALREADY_DESTROYED'
    );

    assert.throws(
      () =>
        controller.deployEphemeralStack({
          ephemeralRunId: 'rejected-wildcard',
          iamActions: ['s3:*'],
        }),
      (err: unknown) => err instanceof ValidationError && err.code === 'AWS_GUARDRAIL_VIOLATION'
    );

    // 5. Execute Two-Path Architecture workflows: Path A (SQS+KEDA) and Path B (Flyte+Kueue+Kyverno DAG)
    const pathA = controller.executeTwoPathWorkflow({
      path: 'path_a_sqs_keda',
      jobId: 'job-path-a-01',
      tenantId: 'tenant-01',
      modelId: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      prompt: 'Low latency single-hop inference',
    });
    assert.equal(pathA.path, 'path_a_sqs_keda');
    assert.equal(pathA.backend, 'pytorch_torchscript_cpu');
    assert.equal(pathA.stages.length, 3);
    assert.equal(pathA.artifacts.flytePreprocessingCacheKey, null);
    assert.equal(pathA.kueueKyvernoAdmission.enforced, false);

    const pathB = controller.executeTwoPathWorkflow({
      path: 'path_b_flyte_dag',
      jobId: 'job-path-b-01',
      tenantId: 'tenant-01',
      modelId: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      prompt: 'Multi-stage Flyte media pipeline',
      useTorchscript: false,
      maxNewTokens: 32,
    });
    assert.equal(pathB.path, 'path_b_flyte_dag');
    assert.equal(pathB.backend, 'pytorch_cpu');
    assert.equal(pathB.stages.length, 3);
    assert.ok(pathB.artifacts.flytePreprocessingCacheKey?.includes('flyte-cache'));
    assert.equal(pathB.kueueKyvernoAdmission.enforced, true);
    assert.equal(pathB.kueueKyvernoAdmission.localQueueName, 'tenant-default-gpu-queue');
  });
});

