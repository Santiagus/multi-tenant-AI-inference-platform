import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AbacPolicyEngine,
  ALL_SCOPES,
  generatePlaintextApiKey,
  hashApiKeySecret,
  secureTimingEqual,
  SecurityScope,
  SlidingWindowRateLimiter,
  type TenantSecurityContext,
  validateScopes,
} from '../../src/domain/security.js';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../src/domain/errors.js';

describe('Security Domain: API Keys, ABAC & Rate Limiting', () => {
  test('API key generation produces valid prefixes, secret hashes, and timing-safe equality', () => {
    const { plaintext, keyPrefix, secret } = generatePlaintextApiKey();
    assert.ok(plaintext.startsWith('ak_live_'));
    assert.ok(keyPrefix.startsWith('ak_live_'));
    assert.ok(secret.length >= 32);

    const hash1 = hashApiKeySecret(secret);
    const hash2 = hashApiKeySecret(secret);
    assert.equal(hash1, hash2);

    assert.equal(secureTimingEqual('secret-token-123', 'secret-token-123'), true);
    assert.equal(secureTimingEqual('secret-token-123', 'secret-token-999'), false);
    assert.equal(secureTimingEqual('short', 'much-longer-string'), false);
  });

  test('validateScopes accepts valid scopes and rejects empty or unknown scopes', () => {
    const valid = validateScopes([SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE]);
    assert.equal(valid.length, 2);

    assert.throws(() => validateScopes([]), ValidationError);
    assert.throws(() => validateScopes(['unknown:scope']), ValidationError);
  });

  test('AbacPolicyEngine enforces tenant boundary, required scopes, and model restrictions', () => {
    const context: TenantSecurityContext = {
      authenticated: true,
      tenantId: 'tenant-a',
      keyId: 'key-1',
      scopes: new Set([SecurityScope.JOBS_READ, SecurityScope.JOBS_WRITE]),
      allowedModels: new Set(['meta-llama/Llama-3-8B-Instruct']),
      rateLimitPerMinute: 60,
    };

    // Happy path: same tenant, has scope, model allowed
    const evalOk = AbacPolicyEngine.evaluateAccess({
      context,
      targetTenantId: 'tenant-a',
      requiredScopes: [SecurityScope.JOBS_WRITE],
      modelId: 'meta-llama/Llama-3-8B-Instruct',
    });
    assert.equal(evalOk.allowed, true);
    assert.doesNotThrow(() =>
      AbacPolicyEngine.enforceAccess({
        context,
        targetTenantId: 'tenant-a',
        requiredScopes: [SecurityScope.JOBS_WRITE],
        modelId: 'meta-llama/Llama-3-8B-Instruct',
      })
    );

    // Cross-tenant access denied
    const crossTenant = AbacPolicyEngine.evaluateAccess({
      context,
      targetTenantId: 'tenant-b',
      requiredScopes: [SecurityScope.JOBS_READ],
    });
    assert.equal(crossTenant.allowed, false);
    assert.ok(crossTenant.reason?.includes('Cross-tenant access forbidden'));
    assert.throws(
      () =>
        AbacPolicyEngine.enforceAccess({
          context,
          targetTenantId: 'tenant-b',
          requiredScopes: [SecurityScope.JOBS_READ],
        }),
      ForbiddenError
    );

    // Missing scope denied
    const missingScope = AbacPolicyEngine.evaluateAccess({
      context,
      targetTenantId: 'tenant-a',
      requiredScopes: [SecurityScope.BILLING_READ],
    });
    assert.equal(missingScope.allowed, false);
    assert.ok(missingScope.reason?.includes('Insufficient scopes'));
    assert.throws(
      () =>
        AbacPolicyEngine.enforceAccess({
          context,
          targetTenantId: 'tenant-a',
          requiredScopes: [SecurityScope.BILLING_READ],
        }),
      ForbiddenError
    );

    // Disallowed model denied
    const disallowedModel = AbacPolicyEngine.evaluateAccess({
      context,
      targetTenantId: 'tenant-a',
      requiredScopes: [SecurityScope.JOBS_WRITE],
      modelId: 'disallowed-model',
    });
    assert.equal(disallowedModel.allowed, false);
    assert.ok(disallowedModel.reason?.includes('Model access restricted'));

    // Unauthenticated context denied with UnauthorizedError
    const unauthContext: TenantSecurityContext = {
      authenticated: false,
      tenantId: 'tenant-anon',
      keyId: null,
      scopes: new Set(),
      allowedModels: null,
      rateLimitPerMinute: 10,
    };
    assert.throws(
      () =>
        AbacPolicyEngine.enforceAccess({
          context: unauthContext,
          targetTenantId: 'tenant-anon',
          requiredScopes: [SecurityScope.JOBS_READ],
        }),
      UnauthorizedError
    );
  });

  test('AbacPolicyEngine validates S3 storage key tenant isolation', () => {
    assert.doesNotThrow(() =>
      AbacPolicyEngine.validateStorageKeyIsolation('tenant-a', 'tenants/tenant-a/inputs/file.jpg')
    );
    assert.doesNotThrow(() =>
      AbacPolicyEngine.validateStorageKeyIsolation('tenant-a', '/tenants/tenant-a/outputs/job-1/result.json')
    );
    assert.throws(
      () => AbacPolicyEngine.validateStorageKeyIsolation('tenant-a', 'tenants/tenant-b/inputs/file.jpg'),
      ForbiddenError
    );
    assert.throws(
      () => AbacPolicyEngine.validateStorageKeyIsolation('tenant-a', 'public/unauthorized.jpg'),
      ForbiddenError
    );
  });

  test('SlidingWindowRateLimiter tracks quota consumption, reset window, and quota violations', () => {
    const limiter = new SlidingWindowRateLimiter(60);

    const initial = limiter.checkLimit('tenant-rate', 3);
    assert.equal(initial.limit, 3);
    assert.equal(initial.remaining, 3);
    assert.equal(initial.isExceeded, false);

    const c1 = limiter.consume('tenant-rate', 3);
    assert.equal(c1.remaining, 2);
    assert.equal(c1.isExceeded, false);

    const c2 = limiter.consume('tenant-rate', 3);
    assert.equal(c2.remaining, 1);
    assert.equal(c2.isExceeded, false);

    const c3 = limiter.consume('tenant-rate', 3);
    assert.equal(c3.remaining, 0);
    assert.equal(c3.isExceeded, false);

    const c4 = limiter.consume('tenant-rate', 3);
    assert.equal(c4.remaining, 0);
    assert.equal(c4.isExceeded, true);

    limiter.reset('tenant-rate');
    const afterReset = limiter.checkLimit('tenant-rate', 3);
    assert.equal(afterReset.remaining, 3);
    assert.equal(afterReset.isExceeded, false);
  });
});

