import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { linearFit, projectLinear } from '../src/components/common/forecast';
import { buildTimestampSessionBands, computePlottedXTicks, computeZoomBounds } from '../src/components/common/TimeSeriesChart';
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

  it('aggregates multiple intraday snapshots within the same hour into an hourly bucket', () => {
    const multiSummary: PricingHistorySummary[] = [{
      provider: 'runpod', itemType: 'gpu', itemId: 'sku', displayName: 'x', updateCadence: '', estimatedUpdateFrequencyMinutes: 1,
      latestPriceUsd: 1, priceChange24hPct: 0,
      history: [
        { recordedAt: '2026-11-01T15:05:00Z', priceUsd: 2.0, availability: 'High' },
        { recordedAt: '2026-11-01T15:25:00Z', priceUsd: 2.2, availability: 'High' },
        { recordedAt: '2026-11-01T15:45:00Z', priceUsd: 2.4, availability: 'High' },
        { recordedAt: '2026-11-01T16:10:00Z', priceUsd: 1.8, availability: 'High' },
      ],
    }];
    const pts = costHistoryForOption(opt, multiSummary);
    assert.equal(pts.length, 2);
    assert.ok(Math.abs(pts[0].hourlyUsd - 2.2) < 1e-6);
    assert.ok(Math.abs(pts[1].hourlyUsd - 1.8) < 1e-6);
  });

  it('computes zoomed viewport bounds and scales Y to peaks within selected section', () => {
    const points = [
      { x: 100, y: 1.0 },
      { x: 200, y: 3.5 }, // Peak
      { x: 300, y: 2.0 },
      { x: 400, y: 0.8 },
      { x: 500, y: 1.2 },
    ];

    // Zooming into window containing the peak [150, 350]
    const bounds = computeZoomBounds(points, 150, 350, 'timestamp');
    assert.equal(bounds.minX, 150);
    assert.equal(bounds.maxX, 350);
    // Visible Ys are 3.5 and 2.0 -> min = 2.0 * 0.9 = 1.8, max = 3.5 * 1.1 = 3.85
    assert.ok(Math.abs(bounds.minY - 1.8) < 1e-6);
    assert.ok(Math.abs(bounds.maxY - 3.85) < 1e-6);

    // Box zoom with custom Y bounds preserves exact selection
    const boxBounds = computeZoomBounds(points, 150, 350, 'timestamp', { minY: 2.5, maxY: 4.0 });
    assert.equal(boxBounds.minY, 2.5);
    assert.equal(boxBounds.maxY, 4.0);

    // Empty section fallback
    const emptyBounds = computeZoomBounds(points, 900, 1000);
    assert.equal(emptyBounds.minX, 900);
    assert.equal(emptyBounds.maxX, 1000);
    assert.equal(emptyBounds.minY, 0);
    assert.equal(emptyBounds.maxY, 1);
  });

  it('computes X-axis ticks aligned to plotted values or as many as zoom/spacing allows', () => {
    // Linear scale simulation: 1 unit = 10 pixels
    const scaleX = (x: number) => x * 10;
    const formatX = (x: number) => `${x}:00`;

    // Case 1: Plotted values are far enough apart (> 52px) -> shows every single plotted value
    const sparseXs = [0, 10, 20, 30]; // 100px apart
    const allTicks = computePlottedXTicks(sparseXs, 0, 30, scaleX, formatX);
    assert.deepEqual(allTicks, [0, 10, 20, 30]);

    // Case 2: Plotted values are dense (< 52px apart) -> downsamples to as many as space allows while keeping plotted values
    const denseXs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // 10px apart
    const downsampledTicks = computePlottedXTicks(denseXs, 0, 10, scaleX, formatX);
    // Every selected tick must be one of the actual plotted values
    for (const t of downsampledTicks) {
      assert.ok(denseXs.includes(t));
    }
    // And consecutive ticks must maintain minimum separation
    for (let i = 1; i < downsampledTicks.length; i++) {
      assert.ok(scaleX(downsampledTicks[i]) - scaleX(downsampledTicks[i - 1]) >= 52 * 0.75);
    }

    // Case 3: Empty plotted values falls back to evenly spaced percentages
    const fallbackTicks = computePlottedXTicks([], 0, 100, scaleX, formatX);
    assert.deepEqual(fallbackTicks, [0, 25, 50, 75, 100]);
  });

  it('resolves continuous 7-day hourly history across all filtered providers and hardware SKUs', () => {
    const nowMs = 1794278400000; // arbitrary fixed epoch
    const makeHistory = (baseUsd: number) => {
      const pts = [];
      for (let h = 168; h >= 0; h--) {
        pts.push({
          recordedAt: new Date(nowMs - h * 3600 * 1000).toISOString(),
          priceUsd: baseUsd + (h % 5) * 0.02,
          availability: 'High',
        });
      }
      return pts;
    };

    const multiSummaries: PricingHistorySummary[] = [
      {
        provider: 'vast_ai', itemType: 'gpu', itemId: 'nvidia-rtx-4090', displayName: 'RTX 4090',
        updateCadence: 'Spot', estimatedUpdateFrequencyMinutes: 5, latestPriceUsd: 0.58, priceChange24hPct: 0,
        history: makeHistory(0.58),
      },
      {
        provider: 'runpod', itemType: 'gpu', itemId: 'nvidia-rtx-4090', displayName: 'RTX 4090',
        updateCadence: 'Spot', estimatedUpdateFrequencyMinutes: 2, latestPriceUsd: 0.74, priceChange24hPct: 0,
        history: makeHistory(0.74),
      },
      {
        provider: 'vast_ai', itemType: 'gpu', itemId: 'nvidia-rtx-5090', displayName: 'RTX 5090',
        updateCadence: 'Spot', estimatedUpdateFrequencyMinutes: 5, latestPriceUsd: 0.78, priceChange24hPct: 0,
        history: makeHistory(0.78),
      },
      {
        provider: 'runpod', itemType: 'gpu', itemId: 'nvidia-rtx-5090', displayName: 'RTX 5090',
        updateCadence: 'Spot', estimatedUpdateFrequencyMinutes: 2, latestPriceUsd: 0.89, priceChange24hPct: 0,
        history: makeHistory(0.89),
      },
      {
        provider: 'runpod', itemType: 'gpu', itemId: 'nvidia-rtx-3090', displayName: 'RTX 3090',
        updateCadence: 'Spot', estimatedUpdateFrequencyMinutes: 2, latestPriceUsd: 0.22, priceChange24hPct: 0,
        history: makeHistory(0.22),
      },
      {
        provider: 'vast_ai', itemType: 'gpu', itemId: 'nvidia-v100', displayName: 'Tesla V100',
        updateCadence: 'Spot', estimatedUpdateFrequencyMinutes: 5, latestPriceUsd: 0.15, priceChange24hPct: 0,
        history: makeHistory(0.15),
      },
    ];

    const offerings = [
      { provider: 'vast_ai', sku: 'nvidia-rtx-4090', model: 'spot_bid', tps: 120 },
      { provider: 'runpod', sku: 'nvidia-rtx-4090', model: 'spot_bid', tps: 120 },
      { provider: 'vast_ai', sku: 'nvidia-rtx-5090', model: 'spot_bid', tps: 160 },
      { provider: 'runpod', sku: 'nvidia-rtx-5090', model: 'spot_bid', tps: 160 },
      { provider: 'runpod', sku: 'nvidia-rtx-3090', model: 'spot_bid', tps: 85 },
      { provider: 'vast_ai', sku: 'nvidia-v100', model: 'spot_bid', tps: 60 },
    ];

    for (const off of offerings) {
      const opt = {
        gpu: {
          id: `${off.provider}-${off.sku}`,
          provider: off.provider,
          hardwareSkuId: off.sku,
          hardwareDisplayName: off.sku,
          vramGb: 24,
          zone: 'us-east',
          pricingModel: off.model,
          rateMicrocents: 50000000,
          billingUnit: 'hour',
          normalizedHourlyMicrocents: 50000000,
          normalizedHourlyUsd: 0.5,
          obtainabilityScore: 0.9,
          obtainabilityLabel: 'High',
          interruptionRiskTier: '<5%',
          isAvailable: true,
          recordedAt: new Date().toISOString(),
        },
        tokensPerSec: off.tps,
        execSeconds: 30,
        costPerJobUsd: 0.005,
        costPer1kJobsUsd: 5.0,
        costPerMillionUsd: (0.5 / (off.tps * 3600)) * 1_000_000,
        tokensPerDollar: (off.tps * 3600) / 0.5,
        concernUnitCostUsd: 0,
        concernUnitLabel: '1M tok',
        securityLevel: 'Standard',
        regionLabel: 'US East',
        rankReason: 'Cheapest',
      } as unknown as RankedOption;

      // 7-day filter (168 hours)
      const points7d = costHistoryForOption(opt, multiSummaries, 168);
      assert.ok(points7d.length >= 168, `Expected at least 168 points for ${off.provider} ${off.sku}, got ${points7d.length}`);
      assert.ok(points7d[0].costPerMillionUsd > 0);
      assert.ok(points7d[points7d.length - 1].costPerMillionUsd > 0);

      // Verify earliest and latest points match the 7-day span
      const spanHours = (points7d[points7d.length - 1].t - points7d[0].t) / 3600_000;
      assert.ok(spanHours >= 167 && spanHours <= 169, `Span should be ~168 hours, got ${spanHours}`);
    }
  });
});
