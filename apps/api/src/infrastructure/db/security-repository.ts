import { randomUUID } from 'node:crypto';
import type { DatabasePool } from './pool.js';
import {
  type ApiKey,
  type ApiKeyCreationResult,
  type AuditEvent,
  type NewApiKeyInput,
  type SecurityScopeType,
  ALL_SCOPES,
  generatePlaintextApiKey,
  hashApiKeySecret,
  secureTimingEqual,
  validateScopes,
} from '../../domain/security.js';

export interface ISecurityRepository {
  createApiKey(input: NewApiKeyInput): Promise<ApiKeyCreationResult>;
  findApiKeyByHashedSecret(hashedSecret: string): Promise<ApiKey | null>;
  findApiKeyById(tenantId: string, keyId: string): Promise<ApiKey | null>;
  listApiKeys(tenantId: string): Promise<ApiKey[]>;
  revokeApiKey(tenantId: string, keyId: string): Promise<ApiKey | null>;
  recordKeyUsage(keyId: string): Promise<void>;
  recordAuditEvent(event: AuditEvent): Promise<void>;
  listAuditEvents(
    tenantId: string,
    options?: { limit?: number; action?: string; outcome?: string }
  ): Promise<AuditEvent[]>;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  hashed_secret: string;
  scopes: SecurityScopeType[] | string;
  allowed_models: string[] | string | null;
  rate_limit_per_minute: number;
  revoked_at: Date | null;
  expires_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AuditLogRow {
  id: string;
  timestamp: Date;
  tenant_id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
  reason: string | null;
  actor_key_id: string | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
  correlation_id: string | null;
}

function parseJsonArray<T>(val: T[] | string | null | undefined): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRowToApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name || 'Default API Key',
    keyPrefix: row.key_prefix || 'ak_live_default',
    hashedSecret: row.hashed_secret,
    scopes: parseJsonArray<SecurityScopeType>(row.scopes),
    allowedModels: row.allowed_models ? parseJsonArray<string>(row.allowed_models) : null,
    rateLimitPerMinute: Number(row.rate_limit_per_minute) || 60,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function mapRowToAuditEvent(row: AuditLogRow): AuditEvent {
  return {
    id: row.id,
    timestamp: new Date(row.timestamp).toISOString(),
    tenantId: row.tenant_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    reason: row.reason,
    actor: {
      keyId: row.actor_key_id,
      ipAddress: row.actor_ip,
      userAgent: row.actor_user_agent,
    },
    correlationId: row.correlation_id,
  };
}

export class PostgresSecurityRepository implements ISecurityRepository {
  constructor(private db: DatabasePool) {}

  async createApiKey(input: NewApiKeyInput): Promise<ApiKeyCreationResult> {
    const validatedScopes = validateScopes(input.scopes);
    const { plaintext, keyPrefix, secret } = generatePlaintextApiKey();
    const hashedSecret = hashApiKeySecret(secret);
    const id = `key_${randomUUID()}`;
    const rateLimit = input.rateLimitPerMinute ?? 60;
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86400 * 1000)
      : null;
    const allowedModels = input.allowedModels ? JSON.stringify(input.allowedModels) : null;

    const query = `
      INSERT INTO api_keys (
        id, tenant_id, name, key_prefix, hashed_secret, key_hash, scopes,
        allowed_models, rate_limit_per_minute, expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *;
    `;

    const res = await this.db.query<ApiKeyRow>(query, [
      id,
      input.tenantId,
      input.name,
      keyPrefix,
      hashedSecret,
      hashedSecret, // backwards compatibility with legacy column
      JSON.stringify(validatedScopes),
      allowedModels,
      rateLimit,
      expiresAt,
    ]);

    return {
      apiKey: mapRowToApiKey(res.rows[0]),
      plaintextKey: plaintext,
    };
  }

  async findApiKeyByHashedSecret(hashedSecret: string): Promise<ApiKey | null> {
    const res = await this.db.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE hashed_secret = $1 AND revoked_at IS NULL;',
      [hashedSecret]
    );
    if (res.rows.length === 0) return null;
    return mapRowToApiKey(res.rows[0]);
  }

  async findApiKeyById(tenantId: string, keyId: string): Promise<ApiKey | null> {
    const res = await this.db.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE tenant_id = $1 AND id = $2;',
      [tenantId, keyId]
    );
    if (res.rows.length === 0) return null;
    return mapRowToApiKey(res.rows[0]);
  }

  async listApiKeys(tenantId: string): Promise<ApiKey[]> {
    const res = await this.db.query<ApiKeyRow>(
      'SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC;',
      [tenantId]
    );
    return res.rows.map(mapRowToApiKey);
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<ApiKey | null> {
    const res = await this.db.query<ApiKeyRow>(
      `UPDATE api_keys
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING *;`,
      [tenantId, keyId]
    );
    if (res.rows.length === 0) return null;
    return mapRowToApiKey(res.rows[0]);
  }

  async recordKeyUsage(keyId: string): Promise<void> {
    await this.db.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1;',
      [keyId]
    );
  }

  async recordAuditEvent(event: AuditEvent): Promise<void> {
    const query = `
      INSERT INTO security_audit_logs (
        id, timestamp, tenant_id, action, resource_type, resource_id,
        outcome, reason, actor_key_id, actor_ip, actor_user_agent, correlation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);
    `;
    await this.db.query(query, [
      event.id || randomUUID(),
      new Date(event.timestamp),
      event.tenantId,
      event.action,
      event.resourceType,
      event.resourceId ?? null,
      event.outcome,
      event.reason ?? null,
      event.actor.keyId ?? null,
      event.actor.ipAddress ?? null,
      event.actor.userAgent ?? null,
      event.correlationId ?? null,
    ]);
  }

  async listAuditEvents(
    tenantId: string,
    options: { limit?: number; action?: string; outcome?: string } = {}
  ): Promise<AuditEvent[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const params: unknown[] = [tenantId];
    let query = 'SELECT * FROM security_audit_logs WHERE tenant_id = $1';

    if (options.action) {
      params.push(options.action);
      query += ` AND action = $${params.length}`;
    }
    if (options.outcome) {
      params.push(options.outcome);
      query += ` AND outcome = $${params.length}`;
    }

    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1};`;
    params.push(limit);

    const res = await this.db.query<AuditLogRow>(query, params);
    return res.rows.map(mapRowToAuditEvent);
  }
}

export class InMemorySecurityRepository implements ISecurityRepository {
  private keys = new Map<string, ApiKey>();
  private auditLogs: AuditEvent[] = [];

  constructor() {
    this.seedDefaultKeys();
  }

  private seedDefaultKeys(): void {
    // Seed standard development keys for local test suites
    const defaultSecret = 'dev-secret-key';
    const hashedSecret = hashApiKeySecret(defaultSecret);
    const now = new Date();

    const defaultKey: ApiKey = {
      id: 'key_default_system',
      tenantId: 'tenant-default',
      name: 'Default Development Key',
      keyPrefix: 'ak_live_devdefault',
      hashedSecret,
      scopes: [...ALL_SCOPES],
      allowedModels: null,
      rateLimitPerMinute: 300,
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.keys.set(defaultKey.id, defaultKey);

    // Also seed tenant-test key
    const testSecret = 'test-tenant-key';
    const testHashed = hashApiKeySecret(testSecret);
    const testKey: ApiKey = {
      id: 'key_tenant_test',
      tenantId: 'tenant-test',
      name: 'Test Tenant Key',
      keyPrefix: 'ak_live_tenanttest',
      hashedSecret: testHashed,
      scopes: [...ALL_SCOPES],
      allowedModels: null,
      rateLimitPerMinute: 300,
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.keys.set(testKey.id, testKey);
  }

  async createApiKey(input: NewApiKeyInput): Promise<ApiKeyCreationResult> {
    const validatedScopes = validateScopes(input.scopes);
    const { plaintext, keyPrefix, secret } = generatePlaintextApiKey();
    const hashedSecret = hashApiKeySecret(secret);
    const id = `key_${randomUUID()}`;
    const now = new Date();
    const expiresAt = input.expiresInDays
      ? new Date(now.getTime() + input.expiresInDays * 86400 * 1000)
      : null;

    const apiKey: ApiKey = {
      id,
      tenantId: input.tenantId,
      name: input.name,
      keyPrefix,
      hashedSecret,
      scopes: validatedScopes,
      allowedModels: input.allowedModels ?? null,
      rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
      revokedAt: null,
      expiresAt,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.keys.set(id, apiKey);
    return {
      apiKey: { ...apiKey },
      plaintextKey: plaintext,
    };
  }

  async findApiKeyByHashedSecret(hashedSecret: string): Promise<ApiKey | null> {
    for (const key of this.keys.values()) {
      if (key.revokedAt) continue;
      if (key.expiresAt && key.expiresAt.getTime() < Date.now()) continue;
      if (secureTimingEqual(key.hashedSecret, hashedSecret)) {
        return { ...key };
      }
    }
    return null;
  }

  async findApiKeyById(tenantId: string, keyId: string): Promise<ApiKey | null> {
    const key = this.keys.get(keyId);
    if (!key || key.tenantId !== tenantId) return null;
    return { ...key };
  }

  async listApiKeys(tenantId: string): Promise<ApiKey[]> {
    return Array.from(this.keys.values())
      .filter((k) => k.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((k) => ({ ...k }));
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<ApiKey | null> {
    const key = this.keys.get(keyId);
    if (!key || key.tenantId !== tenantId || key.revokedAt !== null) {
      return null;
    }
    key.revokedAt = new Date();
    key.updatedAt = new Date();
    this.keys.set(keyId, key);
    return { ...key };
  }

  async recordKeyUsage(keyId: string): Promise<void> {
    const key = this.keys.get(keyId);
    if (key) {
      key.lastUsedAt = new Date();
      this.keys.set(keyId, key);
    }
  }

  async recordAuditEvent(event: AuditEvent): Promise<void> {
    this.auditLogs.unshift({ ...event });
    if (this.auditLogs.length > 1000) {
      this.auditLogs.pop();
    }
  }

  async listAuditEvents(
    tenantId: string,
    options: { limit?: number; action?: string; outcome?: string } = {}
  ): Promise<AuditEvent[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    return this.auditLogs
      .filter(
        (log) =>
          log.tenantId === tenantId &&
          (!options.action || log.action === options.action) &&
          (!options.outcome || log.outcome === options.outcome)
      )
      .slice(0, limit)
      .map((log) => ({ ...log }));
  }

  clear(): void {
    this.keys.clear();
    this.auditLogs = [];
    this.seedDefaultKeys();
  }
}

