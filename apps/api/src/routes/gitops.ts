import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../domain/errors.js';
import {
  type GitOpsController,
  type EnvironmentName,
} from '../domain/gitops.js';
import type { MetricsRegistry } from '../infrastructure/telemetry/metrics.js';

export interface GitOpsRoutesOptions {
  metrics: MetricsRegistry;
  gitOpsController: GitOpsController;
}

const EnvironmentParamSchema = z.object({
  environment: z.enum(['staging', 'production']),
});

const PromoteEnvironmentSchema = z.object({
  environment: z.enum(['staging', 'production']),
  image_tag: z.string().min(1),
  target_revision: z.string().default('HEAD'),
  approver: z.string().optional(),
  approval_token: z.string().optional(),
  direct_cluster_apply: z.boolean().default(false),
});

export const gitOpsRoutes: FastifyPluginAsync<GitOpsRoutesOptions> = async (
  fastify,
  options
) => {
  const { metrics, gitOpsController } = options;

  // GET /v1/gitops/status - Overall GitOps controller status, OIDC config and active environments
  fastify.get(
    '/v1/gitops/status',
    {
      schema: {
        tags: ['GitOps'],
        summary: 'Inspect GitOps Controller & Reconciliation Status',
        description:
          'Returns current Argo CD controller status, GitHub OIDC IAM trust configuration, and declared environment overlays.',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              gitops_reconciler: { type: 'string' },
              github_oidc_role_arn: { type: 'string' },
              repository_url: { type: 'string' },
              app_of_apps: { type: 'string' },
              environments: { type: 'object', additionalProperties: true },
              bypass_policy: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      metrics.incCounter('gitops_status_inspections_total', { status: 'success' });
      const status = gitOpsController.getStatus();
      return reply.code(200).send(status);
    }
  );

  // GET /v1/gitops/environments - List all declared environments and their reconciliation states
  fastify.get(
    '/v1/gitops/environments',
    {
      schema: {
        tags: ['GitOps'],
        summary: 'List Declared GitOps Environments',
        description:
          'Lists all declared environments (staging, production) along with their sync policies, revisions, and approval requirements.',
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                environment: { type: 'string' },
                target_cluster: { type: 'string' },
                namespace: { type: 'string' },
                current_revision: { type: 'string' },
                desired_revision: { type: 'string' },
                image_tag: { type: 'string' },
                sync_status: { type: 'string' },
                health_status: { type: 'string' },
                sync_policy: { type: 'string' },
                approval_required: { type: 'boolean' },
                last_synced_at: { type: 'string' },
                last_promoted_by: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      const envs = gitOpsController.getEnvironments();
      return reply.code(200).send(envs);
    }
  );

  // GET /v1/gitops/environments/:environment - Get single environment details
  fastify.get(
    '/v1/gitops/environments/:environment',
    {
      schema: {
        tags: ['GitOps'],
        summary: 'Get Specific Environment Details',
        params: {
          type: 'object',
          required: ['environment'],
          properties: {
            environment: { type: 'string', enum: ['staging', 'production'] },
          },
        },
      },
    },
    async (req, reply) => {
      const parsed = EnvironmentParamSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new ValidationError('Invalid environment parameter', parsed.error.issues);
      }
      const env = gitOpsController.getEnvironment(parsed.data.environment as EnvironmentName);
      return reply.code(200).send(env);
    }
  );

  // POST /v1/gitops/promote - Promote release to staging or production with mandatory approval gate
  fastify.post(
    '/v1/gitops/promote',
    {
      schema: {
        tags: ['GitOps'],
        summary: 'Promote Release to Target Environment',
        description:
          'Promotes a validated container image tag to staging or production. Requires explicit approver sign-off for production. Rejects direct cluster apply attempts (GitOps non-bypass invariant).',
      },
    },
    async (req, reply) => {
      const parsed = PromoteEnvironmentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid promotion request body', parsed.error.issues);
      }

      const result = gitOpsController.promoteEnvironment(parsed.data);
      metrics.incCounter('gitops_promotions_total', {
        environment: result.environment,
        status: 'promoted',
      });
      return reply.code(200).send(result);
    }
  );

  // POST /v1/gitops/sync/:environment - Trigger declarative reconciliation cycle
  fastify.post(
    '/v1/gitops/sync/:environment',
    {
      schema: {
        tags: ['GitOps'],
        summary: 'Trigger Argo CD Declarative Sync',
        description:
          'Triggers a declarative Argo CD reconciliation cycle for the declared target environment manifests.',
      },
    },
    async (req, reply) => {
      const parsed = EnvironmentParamSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new ValidationError('Invalid environment parameter', parsed.error.issues);
      }

      const env = gitOpsController.syncEnvironment(parsed.data.environment as EnvironmentName);
      metrics.incCounter('gitops_sync_cycles_total', {
        environment: env.environment,
        status: 'synced',
      });
      return reply.code(200).send({
        synced: true,
        environment: env.environment,
        sync_status: env.sync_status,
        health_status: env.health_status,
        synced_at: env.last_synced_at,
        current_revision: env.current_revision,
      });
    }
  );
};

