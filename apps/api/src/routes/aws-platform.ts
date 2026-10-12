import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../domain/errors.js';
import {
  type AwsPlatformController,
  evaluateAwsDeploymentGuardrails,
} from '../domain/aws-platform.js';
import type { MetricsRegistry } from '../infrastructure/telemetry/metrics.js';

export interface AwsPlatformRoutesOptions {
  metrics: MetricsRegistry;
  awsController: AwsPlatformController;
}

const DeployEphemeralSchema = z.object({
  ephemeral_run_id: z.string().min(1),
  environment: z.enum(['ephemeral', 'production']).default('ephemeral'),
  aws_region: z.string().min(1).default('eu-central-1'),
  enable_eks: z.boolean().default(false),
  enable_gpu_node_group: z.boolean().default(false),
  gpu_min_nodes: z.number().int().nonnegative().default(0),
  gpu_max_nodes: z.number().int().positive().default(1),
  monthly_budget_limit_usd: z.number().positive().default(25.0),
  ephemeral_ttl_hours: z.number().int().nonnegative().default(4),
  use_long_lived_access_keys: z.boolean().default(false),
  iam_actions: z.array(z.string()).optional(),
  iam_resources: z.array(z.string()).optional(),
  s3_public_access_blocked: z.boolean().default(true),
  confirm_production_apply: z.boolean().default(false),
});

const ExecuteTwoPathWorkflowSchema = z.object({
  path: z.enum(['path_a_sqs_keda', 'path_b_flyte_dag']),
  job_id: z.string().min(1),
  tenant_id: z.string().min(1).default('tenant-enterprise-01'),
  model_id: z.string().min(1).default('TinyLlama/TinyLlama-1.1B-Chat-v1.0'),
  prompt: z.string().min(1),
  asset_uri: z.string().optional(),
  use_torchscript: z.boolean().default(true),
  max_new_tokens: z.number().int().positive().default(24),
});

export const awsPlatformRoutes: FastifyPluginAsync<AwsPlatformRoutesOptions> = async (
  fastify,
  options
) => {
  const { metrics, awsController } = options;

  // GET /v1/cloud/aws/status - Inspect Terraform modules, cost guardrails, and active ephemeral runs
  fastify.get('/v1/cloud/aws/status', async (_req, reply) => {
    const status = awsController.getPlatformStatus();
    const defaultGuardrails = evaluateAwsDeploymentGuardrails({
      ephemeralRunId: 'default-ephemeral-preview',
      environment: 'ephemeral',
      enableEks: false,
    });

    metrics.setGauge(
      'aws_ephemeral_active_deployments',
      { environment: 'ephemeral' },
      status.activeDeploymentsCount
    );
    metrics.setGauge(
      'aws_estimated_hourly_cost_usd',
      { environment: 'ephemeral', label: 'estimated' },
      status.activeHourlyCostUsd
    );

    return reply.status(200).send({
      status,
      default_ephemeral_guardrails: defaultGuardrails,
    });
  });

  // POST /v1/cloud/aws/ephemeral/deploy - Validate least-privilege IAM & budget guardrails and provision ephemeral stack
  fastify.post('/v1/cloud/aws/ephemeral/deploy', async (req, reply) => {
    const parsed = DeployEphemeralSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid AWS ephemeral deployment request payload',
        parsed.error.flatten()
      );
    }

    const body = parsed.data;
    try {
      const { stack, guardrails } = awsController.deployEphemeralStack({
        ephemeralRunId: body.ephemeral_run_id,
        environment: body.environment,
        awsRegion: body.aws_region,
        enableEks: body.enable_eks,
        enableGpuNodeGroup: body.enable_gpu_node_group,
        gpuMinNodes: body.gpu_min_nodes,
        gpuMaxNodes: body.gpu_max_nodes,
        monthlyBudgetLimitUsd: body.monthly_budget_limit_usd,
        ephemeralTtlHours: body.ephemeral_ttl_hours,
        useLongLivedAccessKeys: body.use_long_lived_access_keys,
        iamActions: body.iam_actions,
        iamResources: body.iam_resources,
        s3PublicAccessBlocked: body.s3_public_access_blocked,
        confirmProductionApply: body.confirm_production_apply,
      });

      metrics.incCounter('aws_iam_policy_evaluations_total', { result: 'pass' });
      metrics.incCounter('aws_ephemeral_deployments_total', {
        action: 'deploy',
        environment: stack.environment,
      });

      const platformStatus = awsController.getPlatformStatus();
      metrics.setGauge(
        'aws_ephemeral_active_deployments',
        { environment: stack.environment },
        platformStatus.activeDeploymentsCount
      );
      metrics.setGauge(
        'aws_estimated_hourly_cost_usd',
        { environment: stack.environment, label: 'estimated' },
        platformStatus.activeHourlyCostUsd
      );
      metrics.setGauge(
        'aws_budget_utilization_ratio',
        { environment: stack.environment },
        guardrails.costEstimation.budgetUtilizationRatio
      );

      return reply.status(201).send({
        stack,
        guardrails,
      });
    } catch (err) {
      if (err instanceof ValidationError && err.code === 'AWS_GUARDRAIL_VIOLATION') {
        metrics.incCounter('aws_iam_policy_evaluations_total', { result: 'fail' });
      }
      throw err;
    }
  });

  // POST /v1/cloud/aws/ephemeral/:runId/destroy - Destroy ephemeral cloud deployment and verify 0 surviving resources
  fastify.post<{ Params: { runId: string } }>(
    '/v1/cloud/aws/ephemeral/:runId/destroy',
    async (req, reply) => {
      const destroyed = awsController.destroyEphemeralStack(req.params.runId);

      metrics.incCounter('aws_ephemeral_deployments_total', {
        action: 'destroy',
        environment: destroyed.environment,
      });

      const platformStatus = awsController.getPlatformStatus();
      metrics.setGauge(
        'aws_ephemeral_active_deployments',
        { environment: destroyed.environment },
        platformStatus.activeDeploymentsCount
      );
      metrics.setGauge(
        'aws_estimated_hourly_cost_usd',
        { environment: destroyed.environment, label: 'estimated' },
        platformStatus.activeHourlyCostUsd
      );

      return reply.status(200).send({
        destroyed,
        surviving_resources: destroyed.survivingResources,
        post_destroy_hourly_cost_usd: destroyed.costEstimation.hourlyFixedUsd,
      });
    }
  );

  // POST /v1/cloud/aws/workflows/execute - Execute a workload across either Path A (SQS+KEDA) or Path B (Flyte+Kueue+Kyverno DAG)
  fastify.post('/v1/cloud/aws/workflows/execute', async (req, reply) => {
    const parsed = ExecuteTwoPathWorkflowSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid Two-Path workflow execution request payload',
        parsed.error.flatten()
      );
    }

    const body = parsed.data;
    const workflowResult = awsController.executeTwoPathWorkflow({
      path: body.path,
      jobId: body.job_id,
      tenantId: body.tenant_id,
      modelId: body.model_id,
      prompt: body.prompt,
      assetUri: body.asset_uri,
      useTorchscript: body.use_torchscript,
      maxNewTokens: body.max_new_tokens,
    });

    return reply.status(200).send(workflowResult);
  });
};

