import { useMemo, useState } from 'react';
import { StatCard } from '../common/StatCard';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import { TimeSeriesChart, type ChartSeries } from '../common/TimeSeriesChart';
import { linearFit, projectLinear } from '../common/forecast';
import { AcquisitionAdvisorPanel } from './AcquisitionAdvisorPanel';
import {
  BILLED_USD_PER_TOKEN,
  buildLedger,
  cumulativeSeries,
  dailyCostRunRate,
  groupLedger,
  summarizeLedger,
} from './jobEconomics';
import type { JobItem } from '../../types';

interface EconomicsViewProps {
  jobs: JobItem[];
  isLoading: boolean;
  onRefresh: () => void;
}

const HORIZONS: Array<{ label: string; ms: number }> = [
  { label: '1h', ms: 3_600_000 },
  { label: '6h', ms: 21_600_000 },
  { label: '24h', ms: 86_400_000 },
  { label: '7d', ms: 604_800_000 },
];

const usd = (v: number) => `$${v.toFixed(v !== 0 && Math.abs(v) < 0.01 ? 5 : 3)}`;
const fmtTime = (x: number) =>
  new Date(x).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const card = { backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', overflow: 'hidden' } as const;

function marginStyle(pct: number, hasRevenue: boolean) {
  if (!hasRevenue) return { bg: 'transparent', fg: '#64748b' };
  if (pct >= 40) return { bg: 'rgba(16,185,129,0.15)', fg: '#34d399' };
  if (pct > 0) return { bg: 'rgba(245,158,11,0.15)', fg: '#fbbf24' };
  return { bg: 'rgba(239,68,68,0.15)', fg: '#f87171' };
}

export function EconomicsView({ jobs, isLoading, onRefresh }: EconomicsViewProps) {
  const [modelFilter, setModelFilter] = useState('ALL');
  const [horizon, setHorizon] = useState(HORIZONS[2]);
  const [groupKey, setGroupKey] = useState<'modelId' | 'provider'>('modelId');
  const [sortKey, setSortKey] = useState('jobCount');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  const fullLedger = useMemo(() => buildLedger(jobs), [jobs]);
  const modelIds = useMemo(() => [...new Set(fullLedger.map((e) => e.modelId))].sort(), [fullLedger]);
  const ledger = useMemo(
    () => (modelFilter === 'ALL' ? fullLedger : fullLedger.filter((e) => e.modelId === modelFilter)),
    [fullLedger, modelFilter]
  );

  const summary = useMemo(() => summarizeLedger(ledger), [ledger]);
  const groups = useMemo(() => groupLedger(fullLedger, groupKey), [fullLedger, groupKey]);
  const sortedGroups = useMemo(() => genericSort(groups, sortKey, sortDir), [groups, sortKey, sortDir]);
  const cumulative = useMemo(() => cumulativeSeries(ledger), [ledger]);

  const forecast = useMemo(() => {
    if (cumulative.length < 3) return null;
    const last = cumulative[cumulative.length - 1];
    const fit = (key: 'cost' | 'revenue' | 'profit') => linearFit(cumulative.map((p) => ({ x: p.x, y: p[key] })));
    const fits = { cost: fit('cost'), revenue: fit('revenue'), profit: fit('profit') };
    if (!fits.cost || !fits.revenue || !fits.profit) return null;
    return {
      lastX: last.x,
      fits,
      cost: projectLinear(fits.cost, last.x, horizon.ms),
      revenue: projectLinear(fits.revenue, last.x, horizon.ms),
      profit: projectLinear(fits.profit, last.x, horizon.ms),
      r2: Math.min(fits.cost.r2, fits.revenue.r2),
    };
  }, [cumulative, horizon]);

  const chartSeries: ChartSeries[] = [
    { name: 'Accumulated cost', color: '#f87171', points: cumulative.map((p) => ({ x: p.x, y: p.cost })) },
    { name: 'Accumulated revenue', color: '#34d399', points: cumulative.map((p) => ({ x: p.x, y: p.revenue })) },
    { name: 'Accumulated profit', color: '#818cf8', points: cumulative.map((p) => ({ x: p.x, y: p.profit })) },
    ...(forecast
      ? [
          { name: `Forecast cost (${horizon.label})`, color: '#f87171', dashed: true, points: forecast.cost },
          { name: `Forecast revenue (${horizon.label})`, color: '#34d399', dashed: true, points: forecast.revenue },
          { name: `Forecast profit (${horizon.label})`, color: '#818cf8', dashed: true, points: forecast.profit },
        ]
      : []),
  ];

  const handleSort = (col: string) => {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col);
      setSortDir(col === 'key' ? 'asc' : 'desc');
    }
  };

  const hasRevenue = summary.revenueUsd > 0;
  const m = marginStyle(summary.marginPct, hasRevenue);
  const projected = (series: { x: number; y: number }[] | undefined) =>
    series && series.length > 0 ? series[series.length - 1].y : null;
  const projProfit = projected(forecast?.profit);
  const projCost = projected(forecast?.cost);

  const select = {
    backgroundColor: '#1e293b',
    color: '#f8fafc',
    border: '1px solid #334155',
    borderRadius: '6px',
    padding: '6px 10px',
    fontSize: '12px',
  } as const;
  const td = { padding: '10px 14px', color: '#e2e8f0' } as const;

  return (
    <div className="dashboard-container-1200" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>FinOps</h2>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
            Computed from the {jobs.length} most recent jobs ({fullLedger.length} with usage). Revenue is projected at ${BILLED_USD_PER_TOKEN}/token; cost is provider-reported per job.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} style={select}>
            <option value="ALL">All models</option>
            {modelIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          <button onClick={onRefresh} style={{ ...select, cursor: 'pointer', fontWeight: 600 }}>
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="kpi-grid-5">
        <StatCard label="Revenue" value={usd(summary.revenueUsd)} subtext={`${summary.jobs} jobs`} accentColor="#10b981" />
        <StatCard label="Infra cost" value={usd(summary.costUsd)} subtext="accumulated" accentColor="#ef4444" />
        <StatCard label="Gross profit" value={usd(summary.profitUsd)} subtext="revenue − cost" accentColor="#6366f1" />
        <StatCard
          label="Gross margin"
          value={hasRevenue ? `${summary.marginPct.toFixed(1)}%` : '—'}
          trend={hasRevenue ? (summary.marginPct >= 40 ? 'ON TARGET' : 'BELOW 40%') : undefined}
          trendPositive={summary.marginPct >= 40}
          accentColor={m.fg}
        />
        <StatCard label="Tokens" value={summary.tokens.toLocaleString()} subtext="in + out" accentColor="#38bdf8" />
      </div>

      <div style={card}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Cost, revenue &amp; profit evolution{modelFilter !== 'ALL' ? ` · ${modelFilter}` : ''}
            </h3>
            <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0 0' }}>
              Solid = measured from job history. Dashed = linear forecast (estimated).
            </p>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: '#94a3b8' }}>
            Forecast horizon:
            {HORIZONS.map((h) => (
              <button
                key={h.label}
                onClick={() => setHorizon(h)}
                style={{
                  ...select,
                  cursor: 'pointer',
                  padding: '3px 9px',
                  backgroundColor: horizon.label === h.label ? '#6366f1' : '#1e293b',
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: '8px 12px' }}>
          <TimeSeriesChart
            series={chartSeries}
            xFormat={fmtTime}
            yFormat={(v) => `$${v.toFixed(4)}`}
            emptyMessage="No jobs with usage yet. Submit and complete jobs to build history."
          />
        </div>
        <div style={{ padding: '8px 18px 12px', fontSize: '12px', color: '#94a3b8' }}>
          {forecast ? (
            <>
              In {horizon.label}: accumulated cost ≈ <strong style={{ color: '#f87171' }}>{usd(projCost ?? 0)}</strong>, profit ≈{' '}
              <strong style={{ color: '#818cf8' }}>{usd(projProfit ?? 0)}</strong> · fit quality R² {(forecast.r2 * 100).toFixed(0)}%
              {forecast.r2 < 0.6 && ' (low confidence: spend is bursty)'}
            </>
          ) : (
            'Forecast needs at least 3 jobs with usage.'
          )}
        </div>
      </div>

      <div style={card}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Economics per {groupKey === 'modelId' ? 'AI model' : 'provider'}
          </h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['modelId', 'provider'] as const).map((k) => (
              <button
                key={k}
                onClick={() => { setGroupKey(k); setSortKey('jobCount'); setSortDir('desc'); }}
                style={{ ...select, cursor: 'pointer', backgroundColor: groupKey === k ? '#3b82f6' : '#1e293b' }}
              >
                {k === 'modelId' ? 'Model' : 'Provider'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b' }}>
                {[
                  ['key', groupKey === 'modelId' ? 'Model' : 'Provider'],
                  ['jobCount', 'Jobs'],
                  ['tokens', 'Tokens'],
                  ['avgDurationMs', 'Avg latency'],
                  ['costUsd', 'Cost'],
                  ['revenueUsd', 'Revenue'],
                  ['profitUsd', 'Profit'],
                  ['marginPct', 'Margin'],
                ].map(([col, label]) => (
                  <SortableHeader key={col} column={col} currentSortKey={sortKey} currentSortDir={sortDir} onSort={handleSort} style={{ padding: '10px 14px' }}>
                    {label}
                  </SortableHeader>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedGroups.length === 0 ? (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '28px' }}>No job usage recorded yet.</td></tr>
              ) : (
                sortedGroups.map((g) => {
                  const ms = marginStyle(g.marginPct, g.revenueUsd > 0);
                  return (
                    <tr
                      key={g.key}
                      onClick={() => groupKey === 'modelId' && setModelFilter(modelFilter === g.key ? 'ALL' : g.key)}
                      style={{ borderBottom: '1px solid #1e293b', cursor: groupKey === 'modelId' ? 'pointer' : 'default', backgroundColor: modelFilter === g.key ? 'rgba(99,102,241,0.1)' : 'transparent' }}
                    >
                      <td style={{ ...td, fontWeight: 600, color: '#f8fafc' }}>{g.key}</td>
                      <td style={td}>{g.jobCount}</td>
                      <td style={td}>{g.tokens.toLocaleString()}</td>
                      <td style={td}>{g.avgDurationMs} ms</td>
                      <td style={{ ...td, color: '#f87171' }}>{usd(g.costUsd)}</td>
                      <td style={{ ...td, color: '#34d399' }}>{usd(g.revenueUsd)}</td>
                      <td style={{ ...td, color: g.profitUsd >= 0 ? '#818cf8' : '#f87171', fontWeight: 600 }}>{usd(g.profitUsd)}</td>
                      <td style={td}>
                        <span style={{ padding: '2px 8px', borderRadius: '6px', fontWeight: 700, backgroundColor: ms.bg, color: ms.fg }}>
                          {g.revenueUsd > 0 ? `${g.marginPct.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AcquisitionAdvisorPanel observedCostUsd={dailyCostRunRate(fullLedger)} />
    </div>
  );
}
