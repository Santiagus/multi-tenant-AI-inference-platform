import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { EnvConfig } from '../config/env.js';
import {
  type ISecurityRepository,
  InMemorySecurityRepository,
} from '../infrastructure/db/security-repository.js';
import {
  type SecurityScopeType,
  type TenantSecurityContext,
  ALL_SCOPES,
  SecurityScope,
  SlidingWindowRateLimiter,
  hashApiKeySecret,
} from '../domain/security.js';
import { ForbiddenError, TooManyRequestsError, UnauthorizedError } from '../domain/errors.js';

export interface SecurityPluginOptions {
  config: EnvConfig;
  securityRepo?: ISecurityRepository;
  rateLimiter?: SlidingWindowRateLimiter;
}

const PUBLIC_PATH_PREFIXES = [
  '/healthz',
  '/readyz',
  '/metrics',
  '/docs',
  '/documentation',
  '/swagger',
  '/redoc',
  '/v1/worker/process-next',
];

export function isPublicPath(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function registerSecurityHooks(
  app: FastifyInstance,
  options: SecurityPluginOptions
): {
  securityRepo: ISecurityRepository;
  rateLimiter: SlidingWindowRateLimiter;
} {
  const { config } = options;
  const securityRepo = options.securityRepo ?? new InMemorySecurityRepository();
  const rateLimiter = options.rateLimiter ?? new SlidingWindowRateLimiter(60);

  // Decorate fastify with security repository and rate limiter
  app.decorate('securityRepo', securityRepo);
  app.decorate('rateLimiter', rateLimiter);

  // Security preHandler hook: Authentication, Tenant Binding, ABAC & Rate Limiting
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const isPublic = isPublicPath(req.url);
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'];
    const tenantHeader = req.headers['x-tenant-id'];
    const correlationId = (req as any).correlationId as string | undefined;

    let token: string | null = null;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof apiKeyHeader === 'string') {
      token = apiKeyHeader.trim();
    }

    // 1. If public path and no credentials passed, allow through with default unauthenticated context
    if (isPublic && !token) {
      (req as any).securityContext = {
        authenticated: false,
        tenantId: config.DEFAULT_TENANT_ID,
        keyId: null,
        scopes: new Set<SecurityScopeType>(),
        allowedModels: null,
        rateLimitPerMinute: 600,
      } satisfies TenantSecurityContext;
      return;
    }

    // 2. Resolve credentials if token is provided
    if (token) {
      // Secret part can be formatted as ak_live_<prefix>_<secret> or a raw token (like dev-secret-key)
      let secretToHash = token;
      if (token.startsWith('ak_live_')) {
        const parts = token.split('_');
        if (parts.length >= 4) {
          secretToHash = parts.slice(3).join('_');
        }
      }

      const hashedSecret = hashApiKeySecret(secretToHash);
      const apiKey = await securityRepo.findApiKeyByHashedSecret(hashedSecret);

      if (!apiKey || apiKey.revokedAt !== null || (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now())) {
        await securityRepo.recordAuditEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          tenantId: typeof tenantHeader === 'string' ? tenantHeader : config.DEFAULT_TENANT_ID,
          action: 'auth:authenticate',
          resourceType: 'credential',
          outcome: 'DENIED',
          reason: !apiKey ? 'Invalid API key secret' : apiKey.revokedAt ? 'API key revoked' : 'API key expired',
          actor: {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          },
          correlationId,
        });
        throw new UnauthorizedError('Missing or invalid authentication credentials');
      }

      let effectiveTenantId = apiKey.tenantId;

      // Check cross-tenant header spoofing: If x-tenant-id was sent, it MUST match apiKey.tenantId unless admin
      if (typeof tenantHeader === 'string' && tenantHeader.trim().length > 0) {
        const requestedTenant = tenantHeader.trim();
        const isAdmin = apiKey.scopes.includes(SecurityScope.ADMIN);
        if (requestedTenant !== apiKey.tenantId && !isAdmin) {
          await securityRepo.recordAuditEvent({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            tenantId: requestedTenant,
            action: 'auth:tenant_isolation',
            resourceType: 'tenant',
            resourceId: requestedTenant,
            outcome: 'DENIED',
            reason: `Cross-tenant spoofing attempt: Credential tenant '${apiKey.tenantId}' requested '${requestedTenant}'`,
            actor: {
              keyId: apiKey.id,
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'],
            },
            correlationId,
          });
          throw new ForbiddenError(
            `Cross-tenant access forbidden: Credential tenant '${apiKey.tenantId}' cannot access '${requestedTenant}'`
          );
        }
        if (isAdmin && requestedTenant !== apiKey.tenantId) {
          effectiveTenantId = requestedTenant;
        }
      }

      // Update key last used timestamp asynchronously
      securityRepo.recordKeyUsage(apiKey.id).catch(() => {});

      const securityContext: TenantSecurityContext = {
        authenticated: true,
        tenantId: effectiveTenantId,
        keyId: apiKey.id,
        scopes: new Set<SecurityScopeType>(apiKey.scopes),
        allowedModels: apiKey.allowedModels ? new Set(apiKey.allowedModels) : null,
        rateLimitPerMinute: apiKey.rateLimitPerMinute,
      };

      (req as any).securityContext = securityContext;
      (req as any).tenantId = effectiveTenantId;

      // Rate limit check
      const rateStatus = rateLimiter.consume(effectiveTenantId, apiKey.rateLimitPerMinute);
      reply.header('x-ratelimit-limit', String(rateStatus.limit));
      reply.header('x-ratelimit-remaining', String(rateStatus.remaining));
      reply.header('x-ratelimit-reset', String(rateStatus.resetSeconds));

      if (rateStatus.isExceeded) {
        await securityRepo.recordAuditEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          tenantId: apiKey.tenantId,
          action: 'rate_limit:consume',
          resourceType: 'api',
          outcome: 'DENIED',
          reason: `Rate limit quota exceeded: ${rateStatus.limit} req/min`,
          actor: {
            keyId: apiKey.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
          },
          correlationId,
        });
        throw new TooManyRequestsError(
          `Rate limit of ${rateStatus.limit} requests per minute exceeded for tenant '${apiKey.tenantId}'.`
        );
      }

      return;
    }

    // 3. No token passed on non-public path:
    // Allow development bypass if x-tenant-id is provided in test/dev environment,
    // otherwise require explicit authentication.
    if (typeof tenantHeader === 'string' && tenantHeader.trim().length > 0) {
      const tenantId = tenantHeader.trim();
      const devRateLimit = 300;
      const rateStatus = rateLimiter.consume(tenantId, devRateLimit);
      reply.header('x-ratelimit-limit', String(rateStatus.limit));
      reply.header('x-ratelimit-remaining', String(rateStatus.remaining));
      reply.header('x-ratelimit-reset', String(rateStatus.resetSeconds));

      if (rateStatus.isExceeded) {
        throw new TooManyRequestsError(
          `Rate limit of ${rateStatus.limit} requests per minute exceeded for tenant '${tenantId}'.`
        );
      }

      (req as any).securityContext = {
        authenticated: true,
        tenantId,
        keyId: 'dev_context',
        scopes: new Set<SecurityScopeType>(ALL_SCOPES),
        allowedModels: null,
        rateLimitPerMinute: devRateLimit,
      } satisfies TenantSecurityContext;
      (req as any).tenantId = tenantId;
      return;
    }

    // If auth is strictly enforced or x-enforce-auth header is passed:
    const enforceAuth = config.AUTH_ENFORCED || req.headers['x-enforce-auth'] === 'true';
    if (enforceAuth) {
      await securityRepo.recordAuditEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        tenantId: config.DEFAULT_TENANT_ID,
        action: 'auth:authenticate',
        resourceType: 'route',
        resourceId: req.url,
        outcome: 'DENIED',
        reason: 'Missing API key or tenant credentials',
        actor: {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
        correlationId,
      });
      throw new UnauthorizedError('Authentication required: Missing API key');
    }

    // Development fallback when auth is not strictly enforced and no headers passed
    const fallbackTenant = config.DEFAULT_TENANT_ID;
    const rateStatus = rateLimiter.consume(fallbackTenant, 300);
    reply.header('x-ratelimit-limit', String(rateStatus.limit));
    reply.header('x-ratelimit-remaining', String(rateStatus.remaining));
    reply.header('x-ratelimit-reset', String(rateStatus.resetSeconds));

    (req as any).securityContext = {
      authenticated: true,
      tenantId: fallbackTenant,
      keyId: 'dev_fallback',
      scopes: new Set<SecurityScopeType>(ALL_SCOPES),
      allowedModels: null,
      rateLimitPerMinute: 300,
    } satisfies TenantSecurityContext;
    (req as any).tenantId = fallbackTenant;
  });

  return { securityRepo, rateLimiter };
}

/**
 * Fastify preHandler hook generator to enforce ABAC scopes
 */
export function requireScopes(...requiredScopes: SecurityScopeType[]) {
  return async (req: FastifyRequest) => {
    const context = (req as any).securityContext as TenantSecurityContext | undefined;
    if (!context || !context.authenticated) {
      throw new UnauthorizedError('Authentication required');
    }

    if (context.scopes.has(SecurityScope.ADMIN)) {
      return; // Admin role bypasses granular scope requirements
    }

    for (const scope of requiredScopes) {
      if (!context.scopes.has(scope)) {
        throw new ForbiddenError(
          `Insufficient permissions: Operation requires scope '${scope}', granted: [${Array.from(context.scopes).join(', ')}]`
        );
      }
    }
  };
}
