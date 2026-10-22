import { useState, useMemo } from 'react';
import { StatCard } from '../common/StatCard';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import type { EconomicsResponse } from '../../types';

interface EconomicsViewProps {
  economics: EconomicsResponse | null;
  isLoading: boolean;
  onRefresh: () => void;
}

export function EconomicsView({ economics, isLoading, onRefresh }: EconomicsViewProps) {
  if (isLoading && !economics) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#64748b' }}>
        Loading FinOps economics ledger...
      </div>
    );
  }

  const summary = economics?.summary ?? {
    total_jobs: 0,
    succeeded_jobs: 0,
    failed_jobs: 0,
    in_flight_jobs: 0,
    cancelled_jobs: 0,
    total_tokens: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    infrastructure_cost_microcents: 0,
    infrastructure_cost_usd: 0,
    projected_revenue_microcents: 0,
    projected_revenue_usd: 0,
    gross_profit_microcents: 0,
    gross_profit_usd: 0,
    gross_margin_percentage: 0,
    avg_duration_ms: 0,
  };

  const providers = economics?.providers ?? [];
  const models = economics?.models ?? [];
  const recentSeries = economics?.recent_job_series ?? [];

  // Provider sorting
  const [providerSortKey, setProviderSortKey] = useState<string>('gross_margin_percentage');
  const [providerSortDir, setProviderSortDir] = useState<SortDirection>('desc');

  const handleProviderSort = (col: string) => {
    if (providerSortKey === col) {
      setProviderSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setProviderSortKey(col);
      setProviderSortDir(col === 'provider' ? 'asc' : 'desc');
    }
  };

  const sortedProviders = useMemo(() => {
    return genericSort(providers, providerSortKey, providerSortDir);
  }, [providers, providerSortKey, providerSortDir]);

  // Model sorting
  const [modelSortKey, setModelSortKey] = useState<string>('job_count');
  const [modelSortDir, setModelSortDir] = useState<SortDirection>('desc');

  const handleModelSort = (col: string) => {
    if (modelSortKey === col) {
      setModelSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setModelSortKey(col);
      setModelSortDir(col === 'model_id' ? 'asc' : 'desc');
    }
  };

  const sortedModels = useMemo(() => {
    return genericSort(models, modelSortKey, modelSortDir);
  }, [models, modelSortKey, modelSortDir]);

  // Series sorting
  const [seriesSortKey, setSeriesSortKey] = useState<string>('timestamp');
  const [seriesSortDir, setSeriesSortDir] = useState<SortDirection>('desc');

  const handleSeriesSort = (col: string) => {
    if (seriesSortKey === col) {
      setSeriesSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSeriesSortKey(col);
      setSeriesSortDir(col === 'timestamp' ? 'desc' : 'asc');
    }
  };

  const sortedSeries = useMemo(() => {
    return genericSort(recentSeries, seriesSortKey, seriesSortDir);
  }, [recentSeries, seriesSortKey, seriesSortDir]);

  const marginColor =
    summary.gross_margin_percentage >= 40
      ? '#10b981'
      : summary.gross_margin_percentage > 0
        ? '#f59e0b'
        : '#ef4444';

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            FinOps Usage, Cost &amp; Gross Margin Economics
          </h2>
          <p style={{ fontSize: '13px', color: '#94a3b8', margin: '4px 0 0 0' }}>
            Unit economics ledger tracking infrastructure spend against tenant token billing to guarantee gross margin target (FinOps Guardrail).
          </p>
        </div>
        <button
          onClick={onRefresh}
          style={{
            backgroundColor: '#1e293b',
            color: '#f8fafc',
            border: '1px solid #334155',
            padding: '8px 14px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Refresh Economics
        </button>
      </div>

      {/* FinOps Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <StatCard
          label="Projected Revenue"
          value={`$${summary.projected_revenue_usd.toFixed(4)}`}
          subtext="Billed at $0.0004 / token"
          trend="+100%"
          trendPositive={true}
          accentColor="#10b981"
        />
        <StatCard
          label="Infra Compute Cost"
          value={`$${summary.infrastructure_cost_usd.toFixed(4)}`}
          subtext={`${summary.total_jobs} total jobs executed`}
          accentColor="#ef4444"
        />
        <StatCard
          label="Net Gross Profit"
          value={`$${summary.gross_profit_usd.toFixed(4)}`}
          subtext="Revenue minus infra compute"
          accentColor="#6366f1"
        />
        <StatCard
          label="Gross Margin %"
          value={`${summary.gross_margin_percentage.toFixed(1)}%`}
          subtext="Target SLA &ge; 40.0%"
          trend={summary.gross_margin_percentage >= 40 ? 'TARGET HEALTHY' : 'BELOW TARGET'}
          trendPositive={summary.gross_margin_percentage >= 40}
          accentColor={marginColor}
        />
        <StatCard
          label="Token Volume"
          value={summary.total_tokens.toLocaleString()}
          subtext={`${summary.prompt_tokens.toLocaleString()} in / ${summary.completion_tokens.toLocaleString()} out`}
          accentColor="#38bdf8"
        />
      </div>

      {/* Provider Economics Table */}
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #1e293b',
          overflow: 'hidden',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Provider Economics &amp; Margin Breakdown
          </h3>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
            Comparison of unit economics across local RTX GPU workers and cloud spillover providers.
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <SortableHeader
                  column="provider"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Provider
                </SortableHeader>
                <SortableHeader
                  column="job_count"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Jobs
                </SortableHeader>
                <SortableHeader
                  column="total_tokens"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Tokens
                </SortableHeader>
                <SortableHeader
                  column="cost_per_token_microcents"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Unit Rate
                </SortableHeader>
                <SortableHeader
                  column="cost_usd"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Compute Cost
                </SortableHeader>
                <SortableHeader
                  column="revenue_usd"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Projected Revenue
                </SortableHeader>
                <SortableHeader
                  column="gross_profit_usd"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Gross Profit
                </SortableHeader>
                <SortableHeader
                  column="gross_margin_percentage"
                  currentSortKey={providerSortKey}
                  currentSortDir={providerSortDir}
                  onSort={handleProviderSort}
                >
                  Gross Margin %
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {sortedProviders.map((p) => (
                <tr key={p.provider} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f8fafc', textTransform: 'capitalize' }}>
                    {p.provider.replace('_', ' ')}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#e2e8f0' }}>{p.job_count}</td>
                  <td style={{ padding: '12px 16px', color: '#e2e8f0' }}>{p.total_tokens.toLocaleString()}</td>
                  <td style={{ padding: '12px 16px', color: '#94a3b8', fontSize: '12px' }}>
                    ${((p.cost_per_token_microcents * 1000) / 100_000_000).toFixed(4)} / 1k tok
                  </td>
                  <td style={{ padding: '12px 16px', color: '#f87171', fontWeight: 600 }}>${p.cost_usd.toFixed(4)}</td>
                  <td style={{ padding: '12px 16px', color: '#34d399', fontWeight: 600 }}>${p.revenue_usd.toFixed(4)}</td>
                  <td style={{ padding: '12px 16px', color: '#6366f1', fontWeight: 600 }}>${p.gross_profit_usd.toFixed(4)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 700,
                        backgroundColor:
                          p.gross_margin_percentage >= 40
                            ? 'rgba(16, 185, 129, 0.15)'
                            : p.gross_margin_percentage > 0
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(239, 68, 68, 0.15)',
                        color:
                          p.gross_margin_percentage >= 40
                            ? '#34d399'
                            : p.gross_margin_percentage > 0
                              ? '#fbbf24'
                              : '#f87171',
                      }}
                    >
                      {p.revenue_usd > 0 ? `${p.gross_margin_percentage.toFixed(1)}%` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model Economics Table */}
      <div
        style={{
          backgroundColor: '#0f172a',
          borderRadius: '12px',
          border: '1px solid #1e293b',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Model-Specific Economics &amp; Latency
          </h3>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0 0' }}>
            Unit cost, billed revenue, and gross margin breakdown sliced by model architecture.
          </p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#1e293b', borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <SortableHeader
                  column="model_id"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                >
                  Model ID
                </SortableHeader>
                <SortableHeader
                  column="job_count"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                >
                  Inferences
                </SortableHeader>
                <SortableHeader
                  column="total_tokens"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                >
                  Tokens
                </SortableHeader>
                <SortableHeader
                  column="avg_duration_ms"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                >
                  Avg Latency
                </SortableHeader>
                <SortableHeader
                  column="cost_usd"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                >
                  Cost ($)
                </SortableHeader>
                <SortableHeader
                  column="revenue_usd"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                >
                  Revenue ($)
                </SortableHeader>
                <SortableHeader
                  column="gross_margin_percentage"
                  currentSortKey={modelSortKey}
                  currentSortDir={modelSortDir}
                  onSort={handleModelSort}
                >
                  Gross Margin %
                </SortableHeader>
              </tr>
            </thead>
            <tbody>
              {sortedModels.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '32px 16px', textAlign: 'center', color: '#64748b' }}>
                    No model inference records found in ledger. Model telemetry will display here once jobs complete.
                  </td>
                </tr>
              ) : (
                sortedModels.map((m) => (
                  <tr key={m.model_id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#f8fafc' }}>{m.model_id}</td>
                    <td style={{ padding: '12px 16px', color: '#e2e8f0' }}>{m.job_count}</td>
                    <td style={{ padding: '12px 16px', color: '#e2e8f0' }}>{m.total_tokens.toLocaleString()}</td>
                    <td style={{ padding: '12px 16px', color: '#e2e8f0' }}>{m.avg_duration_ms} ms</td>
                    <td style={{ padding: '12px 16px', color: '#f87171' }}>${m.cost_usd.toFixed(4)}</td>
                    <td style={{ padding: '12px 16px', color: '#34d399' }}>${m.revenue_usd.toFixed(4)}</td>
                    <td style={{ padding: '12px 16px', color: '#818cf8', fontWeight: 600 }}>
                      {m.gross_margin_percentage.toFixed(1)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Job Economics Stream */}
      {recentSeries.length > 0 && (
        <div
          style={{
            backgroundColor: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              Recent Workload Financial Ledger
            </h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: '#1e293b', color: '#94a3b8' }}>
                  <SortableHeader
                    column="timestamp"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Timestamp
                  </SortableHeader>
                  <SortableHeader
                    column="job_id"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Job ID
                  </SortableHeader>
                  <SortableHeader
                    column="model_id"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Model
                  </SortableHeader>
                  <SortableHeader
                    column="provider"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Provider
                  </SortableHeader>
                  <SortableHeader
                    column="tokens"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Tokens
                  </SortableHeader>
                  <SortableHeader
                    column="duration_ms"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Duration
                  </SortableHeader>
                  <SortableHeader
                    column="cost_usd"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Cost
                  </SortableHeader>
                  <SortableHeader
                    column="revenue_usd"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Revenue
                  </SortableHeader>
                  <SortableHeader
                    column="margin_pct"
                    currentSortKey={seriesSortKey}
                    currentSortDir={seriesSortDir}
                    onSort={handleSeriesSort}
                    style={{ padding: '10px 14px' }}
                  >
                    Margin %
                  </SortableHeader>
                </tr>
              </thead>
              <tbody>
                {sortedSeries.map((s) => (
                  <tr key={s.job_id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{new Date(s.timestamp).toLocaleTimeString()}</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#818cf8' }}>
                      {s.job_id.slice(0, 8)}...
                    </td>
                    <td style={{ padding: '10px 14px', color: '#f8fafc', fontWeight: 600 }}>{s.model_id}</td>
                    <td style={{ padding: '10px 14px' }}>{s.provider}</td>
                    <td style={{ padding: '10px 14px' }}>{s.tokens}</td>
                    <td style={{ padding: '10px 14px' }}>{s.duration_ms} ms</td>
                    <td style={{ padding: '10px 14px', color: '#f87171' }}>${s.cost_usd.toFixed(5)}</td>
                    <td style={{ padding: '10px 14px', color: '#34d399' }}>${s.revenue_usd.toFixed(5)}</td>
                    <td style={{ padding: '10px 14px', color: '#818cf8', fontWeight: 600 }}>{s.margin_pct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

