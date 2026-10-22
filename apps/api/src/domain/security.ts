import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenError, UnauthorizedError, ValidationError } from './errors.js';

export const SecurityScope = {
  JOBS_READ: 'jobs:read',
  JOBS_WRITE: 'jobs:write',
  MODELS_EXECUTE: 'models:execute',
  BILLING_READ: 'billing:read',
  STORAGE_READ: 'storage:read',
  STORAGE_WRITE: 'storage:write',
  ROUTING_EVALUATE: 'routing:evaluate',
  ADMIN: 'admin',
} as const;

export type SecurityScopeType = (typeof SecurityScope)[keyof typeof SecurityScope];

export const ALL_SCOPES: SecurityScopeType[] = Object.values(SecurityScope);

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  hashedSecret: string;
  scopes: SecurityScopeType[];
  allowedModels?: string[] | null;
  rateLimitPerMinute: number;
  revokedAt: Date | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewApiKeyInput {
  tenantId: string;
  name: string;
  scopes: SecurityScopeType[];
  allowedModels?: string[];
  rateLimitPerMinute?: number;
  expiresInDays?: number;
}

export interface ApiKeyCreationResult {
  apiKey: ApiKey;
  plaintextKey: string;
}

export interface TenantSecurityContext {
  authenticated: boolean;
  tenantId: string;
  keyId: string | null;
  scopes: Set<SecurityScopeType>;
  allowedModels: Set<string> | null;
  rateLimitPerMinute: number;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  tenantId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  reason?: string | null;
  actor: {
    keyId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  correlationId?: string | null;
}

export interface RateLimitStatus {
  tenantId: string;
  limit: number;
  remaining: number;
  resetSeconds: number;
  isExceeded: boolean;
}

/**
 * Hash secret with SHA-256 for deterministic lookup & safe storage
 */
export function hashApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret.trim()).digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks
 */
export function secureTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform dummy comparison against self to avoid leaking length via timing
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Generates an API key with format: ak_live_<16 hex prefix>_<32 hex secret>
 */
export function generatePlaintextApiKey(): { plaintext: string; keyPrefix: string; secret: string } {
  const prefix = randomBytes(8).toString('hex');
  const secret = randomBytes(16).toString('hex');
  const plaintext = `ak_live_${prefix}_${secret}`;
  return {
    plaintext,
    keyPrefix: `ak_live_${prefix}`,
    secret,
  };
}

/**
 * Validates scope format and membership
 */
export function validateScopes(scopes: string[]): SecurityScopeType[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new ValidationError('At least one security scope must be specified');
  }
  for (const s of scopes) {
    if (!ALL_SCOPES.includes(s as SecurityScopeType)) {
      throw new ValidationError(`Invalid security scope '${s}'. Valid scopes: ${ALL_SCOPES.join(', ')}`);
    }
  }
  return scopes as SecurityScopeType[];
}

/**
 * Attribute-Based Access Control (ABAC) Policy Evaluator
 */
export class AbacPolicyEngine {
  /**
   * Evaluates if context has the required permission for a resource and operation
   */
  static evaluateAccess(params: {
    context: TenantSecurityContext;
    targetTenantId: string;
    requiredScopes: SecurityScopeType[];
    modelId?: string;
  }): { allowed: boolean; reason?: string } {
    const { context, targetTenantId, requiredScopes, modelId } = params;

    if (!context.authenticated) {
      return { allowed: false, reason: 'Unauthenticated context: Missing or invalid API key' };
    }

    // Admin scope grants universal access across all resources within the tenant (or platform-wide if system tenant)
    const isAdmin = context.scopes.has(SecurityScope.ADMIN);

    // Cross-tenant boundary check: Tenant context must match target tenant unless admin in system tenant
    if (context.tenantId !== targetTenantId) {
      if (!(isAdmin && context.tenantId === 'tenant-system')) {
        return {
          allowed: false,
          reason: `Cross-tenant access forbidden: Token belongs to '${context.tenantId}', attempted access to '${targetTenantId}'`,
        };
      }
    }

    // Scope check: Admin bypasses specific action scope requirement
    if (!isAdmin) {
      for (const scope of requiredScopes) {
        if (!context.scopes.has(scope)) {
          return {
            allowed: false,
            reason: `Insufficient scopes: Action requires '${scope}', granted: [${Array.from(context.scopes).join(', ')}]`,
          };
        }
      }
    }

    // Model restrictions check (ABAC constraint)
    if (modelId && context.allowedModels && context.allowedModels.size > 0) {
      if (!context.allowedModels.has(modelId) && !isAdmin) {
        return {
          allowed: false,
          reason: `Model access restricted: Model '${modelId}' is not in the allowed list for this credential`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Enforces evaluation, throwing UnauthorizedError (401) or ForbiddenError (403)
   */
  static enforceAccess(params: {
    context: TenantSecurityContext;
    targetTenantId: string;
    requiredScopes: SecurityScopeType[];
    modelId?: string;
  }): void {
    const result = this.evaluateAccess(params);
    if (!result.allowed) {
      if (!params.context.authenticated) {
        throw new UnauthorizedError(result.reason || 'Authentication required');
      }
      throw new ForbiddenError(result.reason || 'Access denied');
    }
  }

  /**
   * Validates tenant isolation on storage paths (e.g. tenants/<tenantId>/...)
   */
  static validateStorageKeyIsolation(tenantId: string, storageKey: string): void {
    const normalizedKey = storageKey.replace(/^\/+/, '');
    const expectedPrefix = `tenants/${tenantId}/`;

    if (!normalizedKey.startsWith(expectedPrefix)) {
      throw new ForbiddenError(
        `Cross-tenant storage access denied: Storage key '${storageKey}' is outside the authorized prefix '${expectedPrefix}'`
      );
    }
  }
}

/**
 * Sliding Window In-Memory Rate Limiter with tenant isolation
 */
export class SlidingWindowRateLimiter {
  private windows = new Map<string, number[]>();

  constructor(private windowSeconds: number = 60) {}

  checkLimit(tenantId: string, limit: number): RateLimitStatus {
    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    let timestamps = this.windows.get(tenantId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(tenantId, timestamps);
    }

    // Prune entries older than the window
    const activeTimestamps = timestamps.filter((t) => t > windowStart);
    this.windows.set(tenantId, activeTimestamps);

    const count = activeTimestamps.length;
    const remaining = Math.max(0, limit - count);
    const resetSeconds = activeTimestamps.length > 0
      ? Math.ceil((activeTimestamps[0] + this.windowSeconds * 1000 - now) / 1000)
      : this.windowSeconds;

    return {
      tenantId,
      limit,
      remaining,
      resetSeconds: Math.max(1, resetSeconds),
      isExceeded: count >= limit,
    };
  }

  consume(tenantId: string, limit: number): RateLimitStatus {
    const status = this.checkLimit(tenantId, limit);
    if (!status.isExceeded) {
      const timestamps = this.windows.get(tenantId) ?? [];
      timestamps.push(Date.now());
      this.windows.set(tenantId, timestamps);
      return {
        ...status,
        remaining: Math.max(0, status.remaining - 1),
      };
    }
    return status;
  }

  reset(tenantId?: string): void {
    if (tenantId) {
      this.windows.delete(tenantId);
    } else {
      this.windows.clear();
    }
  }
}

