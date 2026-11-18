import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatLatencyMs, resolveJobTiming } from '../src/components/jobs/jobTiming';
import type { JobItem } from '../src/types';

function baseJob(overrides: Partial<JobItem> = {}): JobItem {
  return {
    job_id: '35f91f52-13a1-476b-b5ed-075b3cb5e743',
    tenant_id: 'tenant-demo',
    status: 'SUCCEEDED',
    model_id: 'Wan-AI/Wan2.1-T2V-1.3B',
    correlation_id: null,
    trace_id: null,
    traceparent: null,
    routing_preference: 'local/gpu',
    priority: 5,
    provider: 'local_pytorch',
    retry_count: 0,
    created_at: '2026-11-18T12:00:00.000Z',
    started_at: '2026-11-18T12:00:01.000Z',
    completed_at: '2026-11-18T12:02:31.000Z',
    duration_ms: 42000,
    ...overrides,
  };
}

describe('jobTiming cold-start vs inference breakdown', () => {
  it('formats latencies across ms / s / m bands', () => {
    assert.equal(formatLatencyMs(null), '—');
    assert.equal(formatLatencyMs(842), '842 ms');
    assert.equal(formatLatencyMs(4200), '4.2 s');
    assert.equal(formatLatencyMs(15000), '15 s');
    assert.equal(formatLatencyMs(125000), '2m 5s');
  });

  it('splits model load, inference, provider total, and wall clock', () => {
    const timing = resolveJobTiming(
      baseJob({
        result: {
          output_text: 'ok',
          metadata: {
            warm_start: false,
            model_load_ms: 98000,
            loader_load_ms: 12,
            pipe_load_ms: 97988,
            inference_ms: 42000,
            total_provider_ms: 140000,
            tokens_per_sec: 0.4,
            ttft_ms: 8000,
          },
        },
      })
    );

    assert.equal(timing.warmStart, false);
    assert.equal(timing.modelLoadMs, 98000);
    assert.equal(timing.pipeLoadMs, 97988);
    assert.equal(timing.inferenceMs, 42000);
    assert.equal(timing.totalProviderMs, 140000);
    assert.equal(timing.wallMs, 150000);
    assert.equal(timing.tokensPerSec, 0.4);
    assert.equal(timing.ttftMs, 8000);
  });

  it('falls back to duration_ms for inference and derives total when metadata is partial', () => {
    const timing = resolveJobTiming(
      baseJob({
        duration_ms: 12,
        started_at: null,
        completed_at: null,
        result: {
          metadata: {
            warm_start: true,
            model_load_ms: 0,
          },
        },
      })
    );

    assert.equal(timing.warmStart, true);
    assert.equal(timing.inferenceMs, 12);
    assert.equal(timing.modelLoadMs, 0);
    assert.equal(timing.totalProviderMs, 12);
    assert.equal(timing.wallMs, null);
  });
});
