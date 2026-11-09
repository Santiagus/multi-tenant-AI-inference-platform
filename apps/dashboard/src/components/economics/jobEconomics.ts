import type { JobItem } from '../../types';

/** Billed price per token used for projected revenue (matches the platform billing label). */
export const BILLED_USD_PER_TOKEN = 0.0004;
const MICROCENTS_PER_USD = 100_000_000;

export interface JobEcon {
  jobId: string;
  modelId: string;
  provider: string;
  timestampMs: number;
  tokens: number;
  durationMs: number;
  costUsd: number;
  revenueUsd: number;
  marginPct: number;
}

export interface GroupEcon {
  key: string;
  jobCount: number;
  tokens: number;
  avgDurationMs: number;
  costUsd: number;
  revenueUsd: number;
  profitUsd: number;
  marginPct: number;
}

export interface CumulativePoint {
  x: number;
  cost: number;
  revenue: number;
  profit: number;
}

/** Only jobs that actually consumed usage (finished or billed) contribute to the ledger. */
export function toJobEcon(job: JobItem, rate = BILLED_USD_PER_TOKEN): JobEcon | null {
  if (!job.usage) return null;
  const tokens = job.usage.total_tokens || job.usage.prompt_tokens + job.usage.completion_tokens;
  const costUsd = job.usage.cost_microcents / MICROCENTS_PER_USD;
  const revenueUsd = tokens * rate;
  const ts = Date.parse(job.completed_at ?? job.started_at ?? job.created_at);
  return {
    jobId: job.job_id,
    modelId: job.model_id,
    provider: job.provider ?? 'unassigned',
    timestampMs: Number.isNaN(ts) ? 0 : ts,
    tokens,
    durationMs: job.duration_ms ?? 0,
    costUsd,
    revenueUsd,
    marginPct: revenueUsd > 0 ? ((revenueUsd - costUsd) / revenueUsd) * 100 : 0,
  };
}

export function buildLedger(jobs: JobItem[], rate = BILLED_USD_PER_TOKEN): JobEcon[] {
  return jobs
    .map((j) => toJobEcon(j, rate))
    .filter((e): e is JobEcon => e !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function groupLedger(ledger: JobEcon[], by: 'modelId' | 'provider'): GroupEcon[] {
  const map = new Map<string, { n: number; tok: number; dur: number; cost: number; rev: number }>();
  for (const e of ledger) {
    const k = e[by];
    const g = map.get(k) ?? { n: 0, tok: 0, dur: 0, cost: 0, rev: 0 };
    g.n++;
    g.tok += e.tokens;
    g.dur += e.durationMs;
    g.cost += e.costUsd;
    g.rev += e.revenueUsd;
    map.set(k, g);
  }
  return [...map.entries()].map(([key, g]) => ({
    key,
    jobCount: g.n,
    tokens: g.tok,
    avgDurationMs: g.n > 0 ? Math.round(g.dur / g.n) : 0,
    costUsd: g.cost,
    revenueUsd: g.rev,
    profitUsd: g.rev - g.cost,
    marginPct: g.rev > 0 ? ((g.rev - g.cost) / g.rev) * 100 : 0,
  }));
}

export function cumulativeSeries(ledger: JobEcon[]): CumulativePoint[] {
  let cost = 0;
  let revenue = 0;
  return ledger.map((e) => {
    cost += e.costUsd;
    revenue += e.revenueUsd;
    return { x: e.timestampMs, cost, revenue, profit: revenue - cost };
  });
}

export function summarizeLedger(ledger: JobEcon[]) {
  const cost = ledger.reduce((a, e) => a + e.costUsd, 0);
  const revenue = ledger.reduce((a, e) => a + e.revenueUsd, 0);
  const tokens = ledger.reduce((a, e) => a + e.tokens, 0);
  return {
    jobs: ledger.length,
    tokens,
    costUsd: cost,
    revenueUsd: revenue,
    profitUsd: revenue - cost,
    marginPct: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
  };
}

/** Cost per day run-rate; the observation window is floored at 24h to avoid wild extrapolation. */
export function dailyCostRunRate(ledger: JobEcon[]): number {
  if (ledger.length === 0) return 0;
  const cost = ledger.reduce((a, e) => a + e.costUsd, 0);
  const spanDays = (ledger[ledger.length - 1].timestampMs - ledger[0].timestampMs) / 86_400_000;
  return cost / Math.max(1, spanDays);
}
