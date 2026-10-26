import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PlatformApiClient, ApiError } from '../src/api/client';

describe('PlatformApiClient (Dashboard API SDK)', () => {
  test('ApiError encapsulates status, message and raw error data', () => {
    const error = new ApiError(404, 'Job not found', { error_code: 'NOT_FOUND' });
    assert.equal(error.status, 404);
    assert.equal(error.message, 'Job not found');
    assert.deepEqual(error.data, { error_code: 'NOT_FOUND' });
    assert.equal(error.name, 'ApiError');
  });

  test('getHealth returns ok: true when /healthz responds with healthy', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any) => {
      assert.ok(String(url).endsWith('/healthz'));
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy' }),
      } as Response;
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      const health = await client.getHealth();
      assert.equal(health.ok, true);
      assert.equal(health.status, 'healthy');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('getHealth catches errors and returns ok: false', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('Network timeout');
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      const health = await client.getHealth();
      assert.equal(health.ok, false);
      assert.equal(health.status, 'unhealthy');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('getJobs formats query string and injects x-tenant-id header', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = async (url: any, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total: 1,
          limit: 10,
          offset: 0,
          jobs: [{ job_id: 'job-123', status: 'SUCCEEDED', model_id: 'meta-llama/Llama-3-8B-Instruct' }],
        }),
      } as Response;
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      const result = await client.getJobs('tenant-acme', { limit: 10, status: 'SUCCEEDED' });

      assert.equal(capturedUrl, 'http://test.local/v1/jobs?limit=10&status=SUCCEEDED');
      assert.equal(capturedHeaders?.get('x-tenant-id'), 'tenant-acme');
      assert.equal(capturedHeaders?.get('Accept'), 'application/json');
      assert.equal(result.total, 1);
      assert.equal(result.jobs[0].job_id, 'job-123');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('submitJob sends POST request with JSON payload', async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody = '';
    let capturedMethod = '';

    globalThis.fetch = async (_url: any, init?: RequestInit) => {
      capturedMethod = init?.method || '';
      capturedBody = String(init?.body || '');
      return {
        ok: true,
        status: 202,
        json: async () => ({
          job_id: 'job-xyz',
          status: 'QUEUED',
          poll_url: '/v1/jobs/job-xyz',
        }),
      } as Response;
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      const result = await client.submitJob('tenant-finops', {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        routing_preference: 'auto',
        priority: 8,
        max_retries: 3,
        input: { prompt: 'Test prompt' },
      });

      assert.equal(capturedMethod, 'POST');
      const parsedBody = JSON.parse(capturedBody);
      assert.equal(parsedBody.model_id, 'meta-llama/Llama-3-8B-Instruct');
      assert.equal(parsedBody.priority, 8);
      assert.equal(result.job_id, 'job-xyz');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('cancelJob and processNextJob execute expected endpoints', async () => {
    const originalFetch = globalThis.fetch;
    const calledUrls: string[] = [];

    globalThis.fetch = async (url: any) => {
      calledUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, job_id: 'job-1', status: 'CANCELLED', processed: 1 }),
      } as Response;
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      await client.cancelJob('tenant-default', 'job-1');
      await client.processNextJob();

      assert.equal(calledUrls[0], 'http://test.local/v1/jobs/job-1/cancel');
      assert.equal(calledUrls[1], 'http://test.local/v1/worker/process-next');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('setProviderHealth sends PATCH with health status', async () => {
    const originalFetch = globalThis.fetch;
    let capturedMethod = '';
    let capturedBody = '';

    globalThis.fetch = async (_url: any, init?: RequestInit) => {
      capturedMethod = init?.method || '';
      capturedBody = String(init?.body || '');
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, healthy: false }),
      } as Response;
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      const res = await client.setProviderHealth('runpod', false);

      assert.equal(capturedMethod, 'PATCH');
      assert.deepEqual(JSON.parse(capturedBody), { healthy: false });
      assert.equal(res.healthy, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('evaluateRouting and simulateRoutingSweep send correct POST requests', async () => {
    const originalFetch = globalThis.fetch;
    const calledUrls: string[] = [];

    globalThis.fetch = async (url: any) => {
      calledUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          decision: { selectedProvider: 'local_pytorch', decisionCode: 'LOCAL_OPTIMAL' },
          results: [{ queue_depth: 0, selected_provider: 'local_pytorch' }],
        }),
      } as Response;
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      const evalRes = await client.evaluateRouting({
        workload: { model_id: 'meta-llama/Llama-3-8B-Instruct' },
      });
      assert.equal(evalRes.decision.selectedProvider, 'local_pytorch');

      const sweepRes = await client.simulateRoutingSweep({
        workload: { model_id: 'meta-llama/Llama-3-8B-Instruct' },
        queue_depth_range: [0, 5, 10],
      });
      assert.equal(sweepRes.results.length, 1);
      assert.equal(calledUrls[0], 'http://test.local/v1/routing/evaluate');
      assert.equal(calledUrls[1], 'http://test.local/v1/routing/simulate');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ApiError is thrown when API responds with error status', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ title: 'Validation failed on prompt' }),
      } as Response;
    };

    try {
      const client = new PlatformApiClient('http://test.local');
      await assert.rejects(
        async () => {
          await client.submitJob('tenant-default', { model_id: '' });
        },
        (err: any) => {
          assert.equal(err.name, 'ApiError');
          assert.equal(err.status, 400);
          assert.equal(err.message, 'Validation failed on prompt');
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

