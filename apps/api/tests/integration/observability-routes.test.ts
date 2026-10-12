import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { InMemoryJobRepository } from '../../src/infrastructure/db/job-repository.js';
import { InMemoryStorageClient } from '../../src/infrastructure/storage/in-memory-storage.js';
import { InMemoryQueueClient } from '../../src/infrastructure/queue/in-memory-queue.js';

describe('Observability, End-to-End Trace Correlation & Prometheus Metrics', () => {
  const config = loadConfig({ NODE_ENV: 'test' });

  function createObservableApp() {
    const storageClient = new InMemoryStorageClient();
    const queueClient = new InMemoryQueueClient();
    const jobRepo = new InMemoryJobRepository();
    const app = buildApp({
      config,
      db: { isHealthy: async () => true },
      jobRepo,
      storageClient,
      queueClient,
    });
    return { app, storageClient, queueClient, jobRepo };
  }

  test('follows a single job across API -> authorization -> queue -> worker -> inference -> artifact via correlation_id and trace_id', async () => {
    const { app, storageClient } = createObservableApp();
    const correlationId = 'corr-e2e-trace-777';
    const upstreamTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

    // 1. Submit job with explicit x-correlation-id and W3C traceparent
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        'x-tenant-id': 'tenant-obs',
        'x-correlation-id': correlationId,
        traceparent: upstreamTraceparent,
      },
      payload: {
        model_id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
        routing_preference: 'local',
        priority: 7,
        input: {
          prompt: 'Verify end-to-end distributed trace propagation.',
        },
      },
    });

    assert.equal(submitRes.statusCode, 202);
    assert.equal(submitRes.headers['x-correlation-id'], correlationId);
    assert.ok(
      String(submitRes.headers['traceparent']).startsWith(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-'
      )
    );

    const submitBody = JSON.parse(submitRes.body);
    const jobId = submitBody.job_id as string;
    assert.equal(submitBody.correlation_id, correlationId);
    assert.equal(submitBody.trace_id, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.equal(submitBody.trace_url, `/v1/jobs/${jobId}/trace`);

    // 2. Process queued job via worker
    const workerRes = await app.inject({
      method: 'POST',
      url: '/v1/worker/process-next',
      headers: {
        'x-tenant-id': 'tenant-obs',
      },
    });
    assert.equal(workerRes.statusCode, 200);
    assert.equal(JSON.parse(workerRes.body).outcomes[0].action, 'succeeded');

    // 3. Query GET /v1/jobs/:id/trace to inspect the full lifecycle trace
    const traceRes = await app.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/trace`,
      headers: {
        'x-tenant-id': 'tenant-obs',
      },
    });
    assert.equal(traceRes.statusCode, 200);
    const traceBody = JSON.parse(traceRes.body);
    assert.equal(traceBody.job_id, jobId);
    assert.equal(traceBody.tenant_id, 'tenant-obs');
    assert.equal(traceBody.correlation_id, correlationId);
    assert.equal(traceBody.trace_id, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.equal(traceBody.status, 'SUCCEEDED');

    // Verify all 6 required stages are present in the trace
    const expectedStages = [
      'authorization',
      'queue_enqueue',
      'http_request',
      'job_processing',
      'inference_execution',
      'artifact_storage',
    ];
    for (const stage of expectedStages) {
      assert.ok(
        traceBody.stages.includes(stage),
        `Expected trace stages to include '${stage}', got: ${JSON.stringify(traceBody.stages)}`
      );
    }

    // Verify every span shares the same trace_id and correlation.id
    for (const span of traceBody.spans) {
      assert.equal(span.trace_id, '4bf92f3577b34da6a3ce929d0e0e4736');
      assert.equal(span.attributes['correlation.id'], correlationId);
    }

    // 4. Verify S3 artifact also contains correlation_id and trace_id
    const artifactKey = `tenants/tenant-obs/outputs/${jobId}/result.json`;
    const artifactBuf = await storageClient.getObject(artifactKey);
    assert.ok(artifactBuf);
    const artifactJson = JSON.parse(artifactBuf.toString('utf-8'));
    assert.equal(artifactJson.job_id, jobId);
    assert.equal(artifactJson.correlation_id, correlationId);
    assert.equal(artifactJson.trace_id, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.ok(String(artifactJson.traceparent).startsWith('00-4bf92f3577b34da6a3ce929d0e0e4736-'));

    // 5. Query GET /v1/traces/by-correlation/:correlationId
    const corrRes = await app.inject({
      method: 'GET',
      url: `/v1/traces/by-correlation/${correlationId}`,
      headers: {
        'x-tenant-id': 'tenant-obs',
      },
    });
    assert.equal(corrRes.statusCode, 200);
    const corrBody = JSON.parse(corrRes.body);
    assert.equal(corrBody.correlation_id, correlationId);
    assert.ok(corrBody.trace_ids.includes('4bf92f3577b34da6a3ce929d0e0e4736'));
    assert.ok(corrBody.job_ids.includes(jobId));
    assert.ok(corrBody.span_count >= 6);

    await app.close();
  });

  test('GET /metrics exposes Prometheus counters, gauges, histograms, and P50/P95/P99 quantiles across successes, retries, and DLQ', async () => {
    const { app } = createObservableApp();

    // 1. Trigger a validation rejection (increments jobs_rejected_total)
    await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-metrics' },
      payload: {},
    });

    // 2. Submit and process a succeeding job
    await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-metrics' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Compute metrics test' },
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/worker/process-next',
      headers: { 'x-tenant-id': 'tenant-metrics' },
    });

    // 3. Submit and process a permanent failure job -> routes to DLQ
    await app.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { 'x-tenant-id': 'tenant-metrics' },
      payload: {
        model_id: 'meta-llama/Llama-3-8B-Instruct',
        input: { prompt: 'Permanent failure', _simulate_failure: 'permanent' },
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/worker/process-next',
      headers: { 'x-tenant-id': 'tenant-metrics' },
    });

    // 4. Scrape GET /metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/metrics',
    });
    assert.equal(metricsRes.statusCode, 200);
    assert.ok(String(metricsRes.headers['content-type']).includes('text/plain'));

    const text = metricsRes.body;
    assert.ok(text.includes('http_server_requests_total'));
    assert.ok(text.includes('http_server_request_duration_seconds_bucket'));
    assert.ok(text.includes('jobs_submitted_total{model_id="meta-llama/Llama-3-8B-Instruct",tenant_id="tenant-metrics"} 2'));
    assert.ok(text.includes('jobs_rejected_total{reason="VALIDATION_FAILED",tenant_id="tenant-metrics"} 1'));
    assert.ok(text.includes('queue_messages_visible{queue_name="inference-jobs"} 0'));
    assert.ok(text.includes('queue_wait_duration_seconds_bucket'));
    assert.ok(text.includes('inference_job_duration_seconds_bucket'));
    assert.ok(text.includes('inference_job_duration_seconds_quantile'));
    assert.ok(text.includes('inference_tokens_total'));
    assert.ok(text.includes('inference_cost_microcents_total'));
    assert.ok(text.includes('inference_job_errors_total'));
    assert.ok(text.includes('inference_job_dlq_total{queue_name="inference-jobs-dlq"} 1'));
    assert.ok(text.includes('worker_active_jobs 0'));
    assert.ok(text.includes('worker_utilization_ratio 0'));

    await app.close();
  });
});

