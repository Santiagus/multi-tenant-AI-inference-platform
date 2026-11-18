import type { PricingHistorySummary } from '../../types';
import type { RankedOption } from './modelAdvisor';

export interface CostPoint {
  t: number;
  hourUtc: number;
  hourlyUsd: number;
  /** Price per 1M tokens ($/1M tok) at this historical point using the model's benchmark throughput. */
  costPerMillionUsd: number;
  costPerJobUsd: number;
}

export interface HourStat {
  hour: number;
  avgCostPerMillionUsd: number;
  avgCostPerJobUsd: number;
  samples: number;
}

export interface UtcTradingSessionInfo {
  id: 'ASIA' | 'EU' | 'USA' | 'OFF_PEAK';
  shortLabel: string;
  flag: string;
  hoursLabel: string;
  startHour: number;
  endHour: number;
  bgColor: string;
  borderColor: string;
  textColor: string;
}

export const UTC_TRADING_SESSIONS: UtcTradingSessionInfo[] = [
  {
    id: 'ASIA',
    shortLabel: 'ASIA',
    flag: '🇯🇵',
    hoursLabel: '00:00–08:00 UTC',
    startHour: 0,
    endHour: 8,
    bgColor: 'rgba(14, 165, 233, 0.09)',
    borderColor: 'rgba(14, 165, 233, 0.35)',
    textColor: '#38bdf8',
  },
  {
    id: 'EU',
    shortLabel: 'EU',
    flag: '🇪🇺',
    hoursLabel: '08:00–15:00 UTC',
    startHour: 8,
    endHour: 15,
    bgColor: 'rgba(16, 185, 129, 0.09)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
    textColor: '#34d399',
  },
  {
    id: 'USA',
    shortLabel: 'USA',
    flag: '🇺🇸',
    hoursLabel: '15:00–22:00 UTC',
    startHour: 15,
    endHour: 22,
    bgColor: 'rgba(245, 158, 11, 0.09)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
    textColor: '#fbbf24',
  },
  {
    id: 'OFF_PEAK',
    shortLabel: 'OFF-PEAK',
    flag: '🌙',
    hoursLabel: '22:00–24:00 UTC',
    startHour: 22,
    endHour: 24,
    bgColor: 'rgba(100, 116, 139, 0.07)',
    borderColor: 'rgba(100, 116, 139, 0.25)',
    textColor: '#94a3b8',
  },
];

export function getUtcHourSession(hourUtc: number): UtcTradingSessionInfo {
  const h = ((Math.floor(hourUtc) % 24) + 24) % 24;
  return (
    UTC_TRADING_SESSIONS.find((s) => h >= s.startHour && h < s.endHour) ??
    UTC_TRADING_SESSIONS[UTC_TRADING_SESSIONS.length - 1]
  );
}

const SPOT_MODELS = ['spot_bid', 'preemptible'];

/**
 * Price history of the exact provider + hardware SKU behind a ranked option,
 * expressed as $/1M tok and $/job. Supports optional time window filtering in hours (e.g. 24, 72, 168).
 */
export function costHistoryForOption(
  opt: RankedOption,
  summaries: PricingHistorySummary[],
  sinceHours?: number
): CostPoint[] {
  const s = summaries.find(
    (x) => x.itemType === 'gpu' && x.provider === opt.gpu.provider && x.itemId === opt.gpu.hardwareSkuId
  );
  if (!s) return [];
  const useSpot = SPOT_MODELS.includes(opt.gpu.pricingModel);
  const tps = opt.tokensPerSec && opt.tokensPerSec > 0 ? opt.tokensPerSec : 1_000_000 / 3600;
  const execSec = opt.execSeconds ?? 3600;
  const cutoffMs = sinceHours && sinceHours > 0 ? Date.now() - sinceHours * 3600 * 1000 : 0;

  // Aggregate into clean hourly buckets (1 point per hour) matching hourly price update cadence
  const hourlyBuckets = new Map<number, { sumUsd: number; count: number }>();
  for (const h of s.history) {
    const rawT = Date.parse(h.recordedAt);
    if (Number.isNaN(rawT) || (cutoffMs > 0 && rawT < cutoffMs)) continue;
    const hourEpoch = Math.floor(rawT / 3600_000) * 3600_000;
    const price = useSpot && h.spotPriceUsd !== undefined ? h.spotPriceUsd : h.priceUsd;
    const cur = hourlyBuckets.get(hourEpoch) ?? { sumUsd: 0, count: 0 };
    cur.sumUsd += price;
    cur.count++;
    hourlyBuckets.set(hourEpoch, cur);
  }

  return [...hourlyBuckets.entries()]
    .map(([t, { sumUsd, count }]) => {
      const hourlyUsd = sumUsd / count;
      return {
        t,
        hourUtc: new Date(t).getUTCHours(),
        hourlyUsd,
        costPerMillionUsd: (hourlyUsd / (tps * 3600)) * 1_000_000,
        costPerJobUsd: (hourlyUsd / 3600) * execSec,
      };
    })
    .sort((a, b) => a.t - b.t);
}

/** Average $/1M tok (and $/job) per UTC hour of day (only hours with samples). */
export function hourOfDayProfile(points: CostPoint[]): HourStat[] {
  const buckets = new Map<number, { sumMillion: number; sumJob: number; n: number }>();
  for (const p of points) {
    const b = buckets.get(p.hourUtc) ?? { sumMillion: 0, sumJob: 0, n: 0 };
    b.sumMillion += p.costPerMillionUsd;
    b.sumJob += p.costPerJobUsd;
    b.n++;
    buckets.set(p.hourUtc, b);
  }
  return [...buckets.entries()]
    .map(([hour, b]) => ({
      hour,
      avgCostPerMillionUsd: b.sumMillion / b.n,
      avgCostPerJobUsd: b.sumJob / b.n,
      samples: b.n,
    }))
    .sort((a, b) => a.hour - b.hour);
}

export interface TimingInsight {
  bestHour: number | null;
  worstHour: number | null;
  bestSession: UtcTradingSessionInfo | null;
  worstSession: UtcTradingSessionInfo | null;
  /** Percent saved running at the best hour vs the worst hour. */
  savingsPct: number;
  /** Percent the latest price is above/below the historical average. */
  latestVsAvgPct: number;
}

export function timingInsight(points: CostPoint[]): TimingInsight {
  const profile = hourOfDayProfile(points);
  if (profile.length === 0) {
    return {
      bestHour: null,
      worstHour: null,
      bestSession: null,
      worstSession: null,
      savingsPct: 0,
      latestVsAvgPct: 0,
    };
  }
  const best = profile.reduce((a, b) => (b.avgCostPerMillionUsd < a.avgCostPerMillionUsd ? b : a));
  const worst = profile.reduce((a, b) => (b.avgCostPerMillionUsd > a.avgCostPerMillionUsd ? b : a));
  const avg = points.reduce((a, p) => a + p.costPerMillionUsd, 0) / points.length;
  const latest = points[points.length - 1].costPerMillionUsd;
  return {
    bestHour: best.hour,
    worstHour: worst.hour,
    bestSession: getUtcHourSession(best.hour),
    worstSession: getUtcHourSession(worst.hour),
    savingsPct: worst.avgCostPerMillionUsd > 0 ? (1 - best.avgCostPerMillionUsd / worst.avgCostPerMillionUsd) * 100 : 0,
    latestVsAvgPct: avg > 0 ? (latest / avg - 1) * 100 : 0,
  };
}
