import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ISecurityRepository } from '../infrastructure/db/security-repository.js';
import {
  type SecurityScopeType,
  type SlidingWindowRateLimiter,
  ALL_SCOPES,
  SecurityScope,
} from '../domain/security.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { requireScopes } from '../plugins/security.js';

const CreateApiKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(100),
  scopes: z
    .array(z.string())
    .min(1, 'At least one scope is required')
    .refine((scopes) => scopes.every((s) => ALL_SCOPES.includes(s as SecurityScopeType)), {
      message: `Invalid scope specified. Valid scopes: ${ALL_SCOPES.join(', ')}`,
    }),
  allowed_models: z.array(z.string()).optional(),
  rate_limit_per_minute: z.number().int().min(1).max(10000).optional().default(60),
  expires_in_days: z.number().int().positive().max(365).optional(),
});

export interface SecurityRoutesOptions {
  securityRepo: ISecurityRepository;
  rateLimiter: SlidingWindowRateLimiter;
}

export const securityRoutes: FastifyPluginAsync<SecurityRoutesOptions> = async (fastify, options) => {
  const { securityRepo, rateLimiter } = options;

  // POST /v1/auth/api-keys - Issue a new scoped API key
  fastify.post(
    '/v1/auth/api-keys',
    {
      preHandler: [requireScopes(SecurityScope.ADMIN)],
      schema: {
        tags: ['Security'],
        summary: 'Issue New Scoped API Key',
        description:
          'Generates a new API key bound to the authenticated tenant with explicit ABAC scopes, rate limits, and model allowances.',
      },
    },
    async (req, reply) => {
      const parseResult = CreateApiKeySchema.safeParse(req.body);
      if (!parseResult.success) {
        throw new ValidationError(
          'API key creation parameters validation failed',
          parseResult.error.flatten().fieldErrors
        );
      }

      const tenantId = (req as any).tenantId || 'tenant-default';
      const body = parseResult.data;

      const result = await securityRepo.createApiKey({
        tenantId,
        name: body.name,
        scopes: body.scopes as SecurityScopeType[],
        allowedModels: body.allowed_models,
        rateLimitPerMinute: body.rate_limit_per_minute,
        expiresInDays: body.expires_in_days,
      });

      return reply.status(201).send({
        api_key: {
          id: result.apiKey.id,
          tenant_id: result.apiKey.tenantId,
          name: result.apiKey.name,
          key_prefix: result.apiKey.keyPrefix,
          scopes: result.apiKey.scopes,
          allowed_models: result.apiKey.allowedModels,
          rate_limit_per_minute: result.apiKey.rateLimitPerMinute,
          expires_at: result.apiKey.expiresAt?.toISOString() ?? null,
          created_at: result.apiKey.createdAt.toISOString(),
        },
        plaintext_key: result.plaintextKey,
      });
    }
  );

  // GET /v1/auth/api-keys - List API keys for tenant
  fastify.get(
    '/v1/auth/api-keys',
    {
      preHandler: [requireScopes(SecurityScope.ADMIN)],
      schema: {
        tags: ['Security'],
        summary: 'List Tenant API Keys',
        description: 'Lists active and revoked API keys belonging to the authenticated tenant (secrets masked).',
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const keys = await securityRepo.listApiKeys(tenantId);

      return reply.status(200).send({
        api_keys: keys.map((k) => ({
          id: k.id,
          tenant_id: k.tenantId,
          name: k.name,
          key_prefix: k.keyPrefix,
          scopes: k.scopes,
          allowed_models: k.allowedModels,
          rate_limit_per_minute: k.rateLimitPerMinute,
          revoked: k.revokedAt !== null,
          revoked_at: k.revokedAt?.toISOString() ?? null,
          expires_at: k.expiresAt?.toISOString() ?? null,
          last_used_at: k.lastUsedAt?.toISOString() ?? null,
          created_at: k.createdAt.toISOString(),
        })),
      });
    }
  );

  // DELETE /v1/auth/api-keys/:id - Revoke an API key
  fastify.delete<{ Params: { id: string } }>(
    '/v1/auth/api-keys/:id',
    {
      preHandler: [requireScopes(SecurityScope.ADMIN)],
      schema: {
        tags: ['Security'],
        summary: 'Revoke API Key',
        description: 'Immediately revokes an active API key, blocking subsequent authenticated requests.',
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'API Key ID' },
          },
          required: ['id'],
        },
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const revoked = await securityRepo.revokeApiKey(tenantId, req.params.id);

      if (!revoked) {
        throw new NotFoundError(`API key '${req.params.id}' not found or already revoked`);
      }

      return reply.status(200).send({
        revoked: true,
        key_id: revoked.id,
        revoked_at: revoked.revokedAt?.toISOString(),
      });
    }
  );

  // GET /v1/security/audit-events - Query Security Audit Logs
  fastify.get<{ Querystring: { limit?: string; action?: string; outcome?: string } }>(
    '/v1/security/audit-events',
    {
      preHandler: [requireScopes(SecurityScope.ADMIN)],
      schema: {
        tags: ['Security'],
        summary: 'Query Security Audit Logs',
        description:
          'Queries structured security audit logs for the authenticated tenant, tracking authentication events, authorization denials, and lifecycle operations.',
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const limit = req.query.limit ? Number.parseInt(req.query.limit, 10) : 50;
      const logs = await securityRepo.listAuditEvents(tenantId, {
        limit,
        action: req.query.action,
        outcome: req.query.outcome,
      });

      return reply.status(200).send({
        tenant_id: tenantId,
        events: logs,
      });
    }
  );

  // GET /v1/security/rate-limits - Query current tenant rate limit status
  fastify.get(
    '/v1/security/rate-limits',
    {
      schema: {
        tags: ['Security'],
        summary: 'Query Rate Limit Status',
        description: 'Returns the current sliding window rate limit status, remaining quota, and reset seconds.',
      },
    },
    async (req, reply) => {
      const tenantId = (req as any).tenantId || 'tenant-default';
      const context = (req as any).securityContext;
      const limit = context?.rateLimitPerMinute ?? 60;
      const status = rateLimiter.checkLimit(tenantId, limit);

      return reply.status(200).send({
        tenant_id: tenantId,
        limit: status.limit,
        remaining: status.remaining,
        reset_seconds: status.resetSeconds,
        is_exceeded: status.isExceeded,
      });
    }
  );
};

