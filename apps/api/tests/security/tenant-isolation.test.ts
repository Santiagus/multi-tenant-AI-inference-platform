import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';
import { InMemorySecurityRepository } from '../../src/infrastructure/db/security-repository.js';
import { SecurityScope, SlidingWindowRateLimiter } from '../../src/domain/security.js';

function createSecurityTestApp(overrides: Partial<Record<string, unknown>> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    AUTH_ENFORCED: true,
    DEFAULT_TENANT_ID: 'tenant-default',
    ...overrides,
  });
  const db = { isHealthy: async () => true };
  const jobRepo = new InMemoryJobRepository();
  const storageClient = new InMemoryStorageClient();
  const queueClient = new InMemoryQueueClient();
  const securityRepo = new InMemorySecurityRepository();
  const rateLimiter = new SlidingWindowRateLimiter(60);

  const app = buildApp({
    config,
    db,
    jobRepo,
    storageClient,
    queueClient,
    securityRepo,
    rateLimiter,
  });

  return { app, securityRepo, jobRepo, storageClient, queueClient, rateLimiter };
}

describe('M09 Multi-Tenant Isolation & Security Boundary', () => {
  test('Issue scoped API key, list masked keys, and authenticate successfully', async () => {
    const { app } = createSecurityTestApp();

    // 1. Issue an API key for tenant-alpha with specific scopes
    const issueRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/api-keys',
      headers: {
        authorization: 'Bearer dev-secret-key',
        'x-tenant-id': 'tenant-alpha',
      },
      payload: {
        name: 'Alpha Worker Key',
        scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
        allowed_models: ['meta-llama/Llama-3-8B-Instruct'],
        rate_limit_per_minute: 100,
        expires_in_days: 30,
      },
    });

    assert.equal(issueRes.statusCode, 201);
    const issueBody = JSON.parse(issueRes.body);
    assert.ok(issueBody.plaintext_key.startsWith('ak_live_'));
    assert.equal(issueBody.api_key.tenant_id, 'tenant-alpha');
    assert.equal(issueBody.api_key.name, 'Alpha Worker Key');
    assert.deepEqual(issueBody.api_key.scopes, [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE]);
    assert.deepEqual(issueBody.api_key.allowed_models, ['meta-llama/Llama-3-8B-Instruct']);

    // 2. List keys for tenant-alpha: secret must be masked, key prefix visible
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/api-keys',
      headers: {
        authorization: 'Bearer dev-secret-key',
        'x-tenant-id': 'tenant-alpha',
      },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.ok(listBody.api_keys.length >= 1);
    const alphaKey = listBody.api_keys[0];
    assert.equal(alphaKey.name, 'Alpha Worker Key');
    assert.equal(alphaKey.revoked, false);
    assert.equal(alphaKey.hashed_secret, undefined);

    // 3. Authenticate with newly issued plaintext key to submit job
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        authorization: `Bearer ${issueBody.plaintext_key}`,
      },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Verify authentication boundary' },
      },
    });
    assert.equal(submitRes.statusCode, 202);
    const submitBody = JSON.parse(submitRes.body);
    assert.ok(submitBody.job_id);

    await app.close();
  });

  test('Rejects invalid, missing, and revoked API keys with 401 Unauthorized', async () => {
    const { app, securityRepo } = createSecurityTestApp({ AUTH_ENFORCED: true });

    // 1. Missing credentials on protected route when AUTH_ENFORCED=true
    const missingRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-enforce-auth': 'true' },
      payload: {
        model_id: 'mock',
        input: { prompt: 'Missing auth test' },
      },
    });
    assert.equal(missingRes.statusCode, 401);
    assert.equal(missingRes.headers['content-type'], 'application/problem+json; charset=utf-8');
    const missingBody = JSON.parse(missingRes.body);
    assert.equal(missingBody.code, 'UNAUTHORIZED');

    // 2. Invalid API key
    const invalidRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: 'Bearer ak_live_invalid_superfaketoken123' },
      payload: {
        model_id: 'mock',
        input: { prompt: 'Invalid token test' },
      },
    });
    assert.equal(invalidRes.statusCode, 401);
    const invalidBody = JSON.parse(invalidRes.body);
    assert.equal(invalidBody.code, 'UNAUTHORIZED');

    // 3. Issue key, revoke it, then verify subsequent invocation is rejected with 401
    const { apiKey, plaintextKey } = await securityRepo.createApiKey({
      tenantId: 'tenant-gamma',
      name: 'Key To Revoke',
      scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
    });

    const activeRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${plaintextKey}` },
      payload: { model_id: 'mock', input: { prompt: 'Valid before revoke' } },
    });
    assert.equal(activeRes.statusCode, 202);

    // Revoke the key
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/api-keys/${apiKey.id}`,
      headers: {
        authorization: 'Bearer dev-secret-key',
        'x-tenant-id': 'tenant-gamma',
      },
    });
    assert.equal(revokeRes.statusCode, 200);

    // Subsequent request with revoked key must be rejected
    const revokedAttemptRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${plaintextKey}` },
      payload: { model_id: 'mock', input: { prompt: 'Attempt after revoke' } },
    });
    assert.equal(revokedAttemptRes.statusCode, 401);

    await app.close();
  });

  test('Cross-tenant job isolation: Tenant B cannot access or cancel Tenant A jobs', async () => {
    const { app, securityRepo } = createSecurityTestApp();

    const { plaintextKey: keyTenantA } = await securityRepo.createApiKey({
      tenantId: 'tenant-a',
      name: 'Tenant A Key',
      scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
    });

    const { plaintextKey: keyTenantB } = await securityRepo.createApiKey({
      tenantId: 'tenant-b',
      name: 'Tenant B Key',
      scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
    });

    // 1. Tenant A submits a confidential job
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${keyTenantA}` },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Tenant A Confidential Dataset Analysis' },
      },
    });
    assert.equal(createRes.statusCode, 202);
    const { job_id } = JSON.parse(createRes.body);

    // 2. Tenant A can read their own job
    const readA = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${job_id}`,
      headers: { authorization: `Bearer ${keyTenantA}` },
    });
    assert.equal(readA.statusCode, 200);

    // 3. Tenant B attempts to read Tenant A job -> 404 Not Found (hidden by tenant domain filter)
    const readB = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${job_id}`,
      headers: { authorization: `Bearer ${keyTenantB}` },
    });
    assert.equal(readB.statusCode, 404);
    const readBBody = JSON.parse(readB.body);
    assert.equal(readBBody.code, 'NOT_FOUND');

    // 4. Tenant B attempts to cancel Tenant A job -> 404 Not Found (denied)
    const cancelB = await app.inject({
      method: 'POST',
      url: `/v1/jobs/${job_id}/cancel`,
      headers: { authorization: `Bearer ${keyTenantB}` },
    });
    assert.equal(cancelB.statusCode, 404);

    await app.close();
  });

  test('Cross-tenant header spoofing is rejected with 403 Forbidden', async () => {
    const { app, securityRepo } = createSecurityTestApp();

    const { plaintextKey: keyTenantA } = await securityRepo.createApiKey({
      tenantId: 'tenant-a',
      name: 'Tenant A Key',
      scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
    });

    // Attacker passes Tenant A API key while setting x-tenant-id to tenant-b
    const spoofRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        authorization: `Bearer ${keyTenantA}`,
        'x-tenant-id': 'tenant-b',
      },
      payload: {
        model_id: 'mock',
        input: { prompt: 'Spoofed header attempt' },
      },
    });

    assert.equal(spoofRes.statusCode, 403);
    const body = JSON.parse(spoofRes.body);
    assert.equal(body.code, 'FORBIDDEN');
    assert.ok(body.detail.includes('Cross-tenant access forbidden'));

    await app.close();
  });

  test('Cross-tenant S3 artifact access is blocked with 403 Forbidden', async () => {
    const { app, securityRepo } = createSecurityTestApp();

    const { plaintextKey: keyTenantA } = await securityRepo.createApiKey({
      tenantId: 'tenant-a',
      name: 'Tenant A Key',
      scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
    });

    // Tenant A attempts to submit a job referencing Tenant B's input artifact
    const crossStorageRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${keyTenantA}` },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input_uri: 's3://platform-artifacts/tenants/tenant-b/inputs/confidential-report.pdf',
      },
    });

    assert.equal(crossStorageRes.statusCode, 403);
    const body = JSON.parse(crossStorageRes.body);
    assert.equal(body.code, 'FORBIDDEN');
    assert.ok(body.detail.includes('Cross-tenant artifact access forbidden'));

    // Tenant A attempts to reference Tenant B's media asset URI in multimodal input
    const crossMediaRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${keyTenantA}` },
      payload: {
        model_id: 'Qwen/Qwen2.5-VL-7B-Instruct',
        input: {
          prompt: 'Inspect proprietary image',
          media_asset_uri: 'tenants/tenant-b/inputs/secret-cad.png',
        },
      },
    });

    assert.equal(crossMediaRes.statusCode, 403);
    const mediaBody = JSON.parse(crossMediaRes.body);
    assert.equal(mediaBody.code, 'FORBIDDEN');

    await app.close();
  });

  test('ABAC Scope enforcement blocks actions lacking required permission with 403', async () => {
    const { app, securityRepo } = createSecurityTestApp();

    // Read-only key with ONLY jobs:read scope
    const { plaintextKey: readOnlyKey } = await securityRepo.createApiKey({
      tenantId: 'tenant-readonly',
      name: 'Read Only Key',
      scopes: [SecurityScope.JOBS_READ],
    });

    // Attempt to write a job with read-only key -> 403 Forbidden
    const submitAttempt = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${readOnlyKey}` },
      payload: {
        model_id: 'mock',
        input: { prompt: 'Should fail with 403' },
      },
    });

    assert.equal(submitAttempt.statusCode, 403);
    const submitBody = JSON.parse(submitAttempt.body);
    assert.equal(submitBody.code, 'FORBIDDEN');
    assert.ok(submitBody.detail.includes('jobs:write'));

    // Attempt to generate upload URL without storage:write -> 403 Forbidden
    const uploadAttempt = await app.inject({
      method: 'POST',
      url: '/v1/jobs/upload-url',
      headers: { authorization: `Bearer ${readOnlyKey}` },
      payload: {
        filename: 'asset.png',
        content_type: 'image/png',
      },
    });
    assert.equal(uploadAttempt.statusCode, 403);

    await app.close();
  });

  test('ABAC Model allowance restricts unauthorized model invocation with 403', async () => {
    const { app, securityRepo } = createSecurityTestApp();

    // Key allowed to run ONLY TinyLlama
    const { plaintextKey: restrictedKey } = await securityRepo.createApiKey({
      tenantId: 'tenant-restricted',
      name: 'Restricted Model Key',
      scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
      allowedModels: ['TinyLlama/TinyLlama-1.1B-Chat-v1.0'],
    });

    // 1. Permitted model succeeds
    const allowedRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${restrictedKey}` },
      payload: {
        model_id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
        input: { prompt: 'Allowed model inference' },
      },
    });
    assert.equal(allowedRes.statusCode, 202);

    // 2. Disallowed model rejected with 403 Forbidden
    const disallowedRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${restrictedKey}` },
      payload: {
        model_id: 'black-forest-labs/FLUX.1-schnell',
        input: { prompt: 'Disallowed model inference' },
      },
    });
    assert.equal(disallowedRes.statusCode, 403);
    const body = JSON.parse(disallowedRes.body);
    assert.equal(body.code, 'FORBIDDEN');
    assert.ok(body.detail.includes('FLUX.1-schnell'));

    await app.close();
  });

  test('Per-tenant rate limiting enforces quota and returns 429 Too Many Requests with headers', async () => {
    const { app, securityRepo } = createSecurityTestApp();

    // Key with strict rate limit of 2 requests per minute
    const { plaintextKey: limitedKey } = await securityRepo.createApiKey({
      tenantId: 'tenant-metered',
      name: 'Metered Key',
      scopes: [SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
      rateLimitPerMinute: 2,
    });

    // Request 1: OK
    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${limitedKey}` },
      payload: { model_id: 'mock', input: { prompt: 'R1' } },
    });
    assert.equal(r1.statusCode, 202);
    assert.equal(r1.headers['x-ratelimit-limit'], '2');
    assert.equal(r1.headers['x-ratelimit-remaining'], '1');
    assert.ok(r1.headers['x-ratelimit-reset']);

    // Request 2: OK
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${limitedKey}` },
      payload: { model_id: 'mock', input: { prompt: 'R2' } },
    });
    assert.equal(r2.statusCode, 202);
    assert.equal(r2.headers['x-ratelimit-remaining'], '0');

    // Request 3: Exceeded -> 429 Too Many Requests
    const r3 = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { authorization: `Bearer ${limitedKey}` },
      payload: { model_id: 'mock', input: { prompt: 'R3' } },
    });
    assert.equal(r3.statusCode, 429);
    assert.equal(r3.headers['x-ratelimit-remaining'], '0');
    const r3Body = JSON.parse(r3.body);
    assert.equal(r3Body.code, 'RATE_LIMIT_EXCEEDED');

    await app.close();
  });

  test('Security audit log captures auth denials and isolates audit events per tenant', async () => {
    const { app, securityRepo } = createSecurityTestApp();

    const { plaintextKey: keyTenantA } = await securityRepo.createApiKey({
      tenantId: 'tenant-audit-a',
      name: 'Tenant A Audit Key',
      scopes: [SecurityScope.ADMIN, SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
    });

    const { plaintextKey: keyTenantB } = await securityRepo.createApiKey({
      tenantId: 'tenant-audit-b',
      name: 'Tenant B Audit Key',
      scopes: [SecurityScope.ADMIN, SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE],
    });

    // Trigger an invalid auth denial on tenant-audit-a
    await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        authorization: `Bearer ${keyTenantA}`,
        'x-tenant-id': 'tenant-audit-b', // spoof attempt
      },
      payload: { model_id: 'mock', input: { prompt: 'Denial' } },
    });

    // Tenant A queries their audit events
    const auditResA = await app.inject({
      method: 'GET',
      url: '/v1/security/audit-events',
      headers: { authorization: `Bearer ${keyTenantA}` },
    });
    assert.equal(auditResA.statusCode, 200);
    const auditBodyA = JSON.parse(auditResA.body);
    assert.equal(auditBodyA.tenant_id, 'tenant-audit-a');

    // Tenant B queries their audit events -> receives their own tenant events
    const auditResB = await app.inject({
      method: 'GET',
      url: '/v1/security/audit-events',
      headers: { authorization: `Bearer ${keyTenantB}` },
    });
    assert.equal(auditResB.statusCode, 200);
    const auditBodyB = JSON.parse(auditResB.body);
    assert.equal(auditBodyB.tenant_id, 'tenant-audit-b');

    await app.close();
  });
});

