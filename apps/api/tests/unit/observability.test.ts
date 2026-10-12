import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DistributedTracer,
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  getTelemetryContext,
  parseTraceparent,
  runWithTelemetryContext,
} from '../../src/infrastructure/telemetry/tracer.js';
import {
  MetricsRegistry,
  computeQuantile,
} from '../../src/infrastructure/telemetry/metrics.js';

describe('OpenTelemetry W3C TraceContext & DistributedTracer', () => {
  test('validates, parses, and formats W3C traceparent headers', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    assert.equal(traceId.length, 32);
    assert.equal(spanId.length, 16);

    const tp = formatTraceparent(traceId, spanId, '01');
    const parsed = parseTraceparent(tp);
    assert.ok(parsed);
    assert.equal(parsed.traceId, traceId);
    assert.equal(parsed.parentSpanId, spanId);
    assert.equal(parsed.traceFlags, '01');

    // Reject invalid traceparent strings and all-zero traceId/spanId
    assert.equal(parseTraceparent(null), null);
    assert.equal(parseTraceparent(''), null);
    assert.equal(parseTraceparent('invalid-header'), null);
    assert.equal(
      parseTraceparent('00-00000000000000000000000000000000-0123456789abcdef-01'),
      null
    );
    assert.equal(
      parseTraceparent('00-0123456789abcdef0123456789abcdef-0000000000000000-01'),
      null
    );
  });

  test('propagates AsyncLocalStorage telemetry context across nested async boundaries', async () => {
    assert.equal(getTelemetryContext(), undefined);

    const outerTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const result = await runWithTelemetryContext(
      {
        correlationId: 'corr-als-001',
        traceparent: outerTraceparent,
        tenantId: 'tenant-als',
        jobId: 'job-als-1',
      },
      async () => {
        const ctx1 = getTelemetryContext();
        assert.ok(ctx1);
        assert.equal(ctx1.correlationId, 'corr-als-001');
        assert.equal(ctx1.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
        assert.equal(ctx1.parentSpanId, '00f067aa0ba902b7');
        assert.equal(ctx1.tenantId, 'tenant-als');
        assert.equal(ctx1.jobId, 'job-als-1');

        // Nested context inherits traceId and correlationId
        return runWithTelemetryContext({ parentSpanId: ctx1.spanId }, () => {
          const ctx2 = getTelemetryContext();
          assert.ok(ctx2);
          assert.equal(ctx2.traceId, ctx1.traceId);
          assert.equal(ctx2.parentSpanId, ctx1.spanId);
          assert.equal(ctx2.correlationId, 'corr-als-001');
          return ctx2.spanId;
        });
      }
    );

    assert.equal(result.length, 16);
  });

  test('records parent-child spans, events, attributes, and error statuses', async () => {
    const tracer = new DistributedTracer({ serviceName: 'test-service', maxSpans: 5 });

    await tracer.startActiveSpan(
      'root_span',
      {
        kind: 'SERVER',
        correlationId: 'corr-span-test',
        tenantId: 'tenant-1',
        jobId: 'job-123',
        attributes: {
          'http.method': 'POST',
          ignored_null: null,
        },
      },
      async (rootSpan) => {
        rootSpan.setAttribute('custom.attr', 'val');
        rootSpan.setAttribute('ignored_undef', undefined);
        rootSpan.setAttributes({ 'batch.size': 4, empty_attr: null });
        rootSpan.addEvent('validation_passed', { ok: true });

        await tracer.startActiveSpan(
          'child_span',
          {
            kind: 'INTERNAL',
          },
          async (childSpan) => {
            assert.equal(childSpan.traceId, rootSpan.traceId);
            assert.equal(childSpan.parentSpanId, rootSpan.spanId);
          }
        );
      }
    );

    const byJob = tracer.getSpansByJobId('job-123', 'tenant-1');
    assert.equal(byJob.length, 2);
    const byCorr = tracer.getSpansByCorrelationId('corr-span-test', 'tenant-1');
    assert.equal(byCorr.length, 2);
    const byTrace = tracer.getSpansByTraceId(byJob[0].traceId, 'tenant-1');
    assert.equal(byTrace.length, 2);

    // Tenant isolation on span queries
    assert.equal(tracer.getSpansByJobId('job-123', 'other-tenant').length, 0);

    // Error span recording + maxSpans ring buffer eviction
    for (let i = 0; i < 6; i++) {
      await assert.rejects(async () => {
        await tracer.startActiveSpan('failing_span', {}, async () => {
          throw new Error(`boom-${i}`);
        });
      });
    }

    const allSpans = tracer.getAllSpans();
    assert.equal(allSpans.length, 5);
    assert.equal(allSpans[allSpans.length - 1].status, 'ERROR');
    assert.equal(allSpans[allSpans.length - 1].errorMessage, 'boom-5');

    tracer.clear();
    assert.equal(tracer.getAllSpans().length, 0);
  });
});

describe('Prometheus MetricsRegistry & Quantiles', () => {
  test('computes P50, P95, P99 quantiles and renders Prometheus exposition format', () => {
    assert.equal(computeQuantile([], 0.5), 0);
    assert.equal(computeQuantile([42], 0.95), 42);
    assert.equal(computeQuantile([10, 20, 30, 40, 50], 0.5), 30);

    const registry = new MetricsRegistry();
    registry.incCounter('jobs_submitted_total', {
      tenant_id: 'tenant-a',
      model_id: 'llama-3',
    });
    registry.incCounter(
      'jobs_submitted_total',
      {
        tenant_id: 'tenant-a',
        model_id: 'llama-3',
      },
      2
    );
    assert.equal(
      registry.getCounterValue('jobs_submitted_total', {
        tenant_id: 'tenant-a',
        model_id: 'llama-3',
      }),
      3
    );

    registry.setGauge('queue_messages_visible', { queue_name: 'inference-jobs' }, 7);
    assert.equal(
      registry.getGaugeValue('queue_messages_visible', { queue_name: 'inference-jobs' }),
      7
    );

    for (const v of [0.02, 0.05, 0.1, 0.25, 0.8]) {
      registry.observeHistogram(
        'inference_job_duration_seconds',
        { tenant_id: 'tenant-a', model_id: 'llama-3', provider: 'local_pytorch' },
        v
      );
    }

    const stats = registry.getHistogramQuantiles('inference_job_duration_seconds', {
      tenant_id: 'tenant-a',
      model_id: 'llama-3',
      provider: 'local_pytorch',
    });
    assert.equal(stats.count, 5);
    assert.equal(stats.p50, 0.1);
    assert.ok(stats.p95 >= 0.25);
    assert.ok(stats.p99 >= 0.5);

    // Custom dynamic counter/gauge/histogram
    registry.incCounter('custom_unlabelled_counter');
    registry.setGauge('custom_unlabelled_gauge', {}, 1);
    registry.observeHistogram('custom_unlabelled_hist', {}, 0.1);

    const text = registry.renderPrometheus();
    assert.ok(text.includes('# TYPE jobs_submitted_total counter'));
    assert.ok(text.includes('jobs_submitted_total{model_id="llama-3",tenant_id="tenant-a"} 3'));
    assert.ok(text.includes('queue_messages_visible{queue_name="inference-jobs"} 7'));
    assert.ok(
      text.includes(
        'inference_job_duration_seconds_bucket{model_id="llama-3",provider="local_pytorch",tenant_id="tenant-a",le="+Inf"} 5'
      )
    );
    assert.ok(
      text.includes(
        'inference_job_duration_seconds_quantile{model_id="llama-3",provider="local_pytorch",tenant_id="tenant-a",quantile="0.5"} 0.1'
      )
    );

    registry.reset();
    assert.equal(
      registry.getCounterValue('jobs_submitted_total', {
        tenant_id: 'tenant-a',
        model_id: 'llama-3',
      }),
      0
    );
  });
});

