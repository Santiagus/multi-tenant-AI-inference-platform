import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { linearFit, projectLinear } from '../src/components/common/forecast';
import { buildTimestampSessionBands } from '../src/components/common/TimeSeriesChart';
import { buildLedger, cumulativeSeries, groupLedger, dailyCostRunRate, summarizeLedger } from '../src/components/economics/jobEconomics';
import { costHistoryForOption, getUtcHourSession, hourOfDayProfile, timingInsight } from '../src/components/finops/priceHistory';
import type { JobItem, PricingHistorySummary, GpuPricingItem } from '../src/types';
import type { RankedOption } from '../src/components/finops/modelAdvisor';

const job = (id: string, model: string, tokens: number, costMc: number, at: string, provider = 'runpod'): JobItem => ({
  job_id: id, tenant_id: 't', status: 'SUCCEEDED', model_id: model, correlation_id: null, trace_id: null,
  traceparent: null, routing_preference: 'auto', priority: 5, provider, retry_count: 0,
  created_at: at, started_at: at, completed_at: at, duration_ms: 100,
  usage: { prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens, cost_microcents: costMc },
});

describe('forecast', () => {
  it('fits a line and projects forward', () => {
    const fit = linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])!;
    assert.equal(fit.slope, 2);
    assert.equal(fit.intercept, 1);
    assert.equal(fit.r2, 1);
    const proj = projectLinear(fit, 2, 2, 2);
    assert.deepEqual(proj.map((p) => p.y), [5, 7, 9]);
    assert.equal(linearFit([{ x: 1, y: 1 }]), null);
    assert.equal(linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }]), null);
  });
});

describe('job-based FinOps ledger', () => {
  const jobs = [
    job('a', 'm1', 1000, 20_000_000, '2026-11-01T00:00:00Z'),
    job('b', 'm2', 500, 10_000_000, '2026-11-01T12:00:00Z', 'bedrock'),
    job('c', 'm1', 1000, 20_000_000, '2026-11-03T00:00:00Z'),
    { ...job('d', 'm1', 0, 0, '2026-11-03T00:00:00Z'), usage: undefined },
  ];

  it('aggregates per model from jobs, skipping jobs without usage', () => {
    const ledger = buildLedger(jobs);
    assert.equal(ledger.length, 3);
    const m1 = groupLedger(ledger, 'modelId').find((g) => g.key === 'm1')!;
    assert.equal(m1.jobCount, 2);
    assert.ok(Math.abs(m1.costUsd - 0.4) < 1e-9);
    assert.ok(Math.abs(m1.revenueUsd - 0.8) < 1e-9);
    assert.ok(Math.abs(m1.marginPct - 50) < 1e-9);
  });

  it('builds cumulative series and run-rate with 24h floor', () => {
    const ledger = buildLedger(jobs);
    const cum = cumulativeSeries(ledger);
    assert.ok(cum[2].cost > cum[1].cost && cum[1].cost > cum[0].cost);
    assert.ok(Math.abs(summarizeLedger(ledger).costUsd - cum[2].cost) < 1e-9);
    // 3-day span -> cost / 3
    assert.ok(Math.abs(dailyCostRunRate(ledger) - 0.5 / 2) < 1e-9);
    assert.equal(dailyCostRunRate([]), 0);
  });
});

describe('price history timing & trading sessions', () => {
  const gpu = { provider: 'runpod', hardwareSkuId: 'sku', pricingModel: 'on_demand' } as GpuPricingItem;
  const opt = { gpu, tokensPerSec: 1_000_000 / 3600, execSeconds: 3600 } as RankedOption;
  const summaries: PricingHistorySummary[] = [{
    provider: 'runpod', itemType: 'gpu', itemId: 'sku', displayName: 'x', updateCadence: '', estimatedUpdateFrequencyMinutes: 1,
    latestPriceUsd: 1, priceChange24hPct: 0,
    history: [
      { recordedAt: '2026-11-01T03:00:00Z', priceUsd: 1, availability: 'High' },
      { recordedAt: '2026-11-01T15:00:00Z', priceUsd: 2, availability: 'High' },
      { recordedAt: '2026-11-02T03:00:00Z', priceUsd: 1, availability: 'High' },
      { recordedAt: '2026-11-02T15:00:00Z', priceUsd: 1.5, availability: 'High' },
    ],
  }];

  it('converts hourly price to $/1M tok and identifies best UTC hour + trading session', () => {
    const pts = costHistoryForOption(opt, summaries);
    assert.equal(pts.length, 4);
    assert.ok(Math.abs(pts[0].costPerMillionUsd - 1) < 1e-6);
    assert.deepEqual(hourOfDayProfile(pts).map((h) => h.hour), [3, 15]);
    const ins = timingInsight(pts);
    assert.equal(ins.bestHour, 3);
    assert.equal(ins.bestSession?.id, 'ASIA');
    assert.equal(ins.worstHour, 15);
    assert.equal(ins.worstSession?.id, 'USA');
    assert.ok(Math.abs(ins.savingsPct - (1 - 1 / 1.75) * 100) < 1e-9);
    assert.ok(ins.latestVsAvgPct > 0);
  });

  it('maps UTC hours to ASIA, EU, USA and OFF-PEAK sessions and builds chart bands', () => {
    assert.equal(getUtcHourSession(2).id, 'ASIA');
    assert.equal(getUtcHourSession(10).id, 'EU');
    assert.equal(getUtcHourSession(16).id, 'USA');
    assert.equal(getUtcHourSession(23).id, 'OFF_PEAK');

    const start = Date.parse('2026-11-01T00:00:00Z');
    const end = Date.parse('2026-11-01T24:00:00Z');
    const bands = buildTimestampSessionBands(start, end);
    assert.deepEqual(bands.map((b) => b.session.id), ['ASIA', 'EU', 'USA', 'OFF_PEAK']);
  });

  it('returns empty for unknown sku', () => {
    assert.deepEqual(costHistoryForOption({ ...opt, gpu: { ...gpu, hardwareSkuId: 'nope' } } as RankedOption, summaries), []);
    assert.equal(timingInsight([]).bestHour, null);
  });
});
