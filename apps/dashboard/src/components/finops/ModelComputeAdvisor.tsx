import { useEffect, useMemo, useState } from 'react';
import type {
  CuratedModelDefinition,
  GpuPricingItem,
  ModelPricingItem,
  ModelPurpose,
  ModelWeightType,
  PricingHistorySummary,
} from '../../types';
import { CATALOG_MODELS } from './ModelRecommendationStudio';
import {
  getModelBenchmark,
  rankExecutionOptions,
  type RiskTolerance,
  type RankedOption,
  type AdvisorConstraints,
} from './modelAdvisor';
import { cleanHardwareName } from './formatHwName';
import { RoutingView } from '../routing/RoutingView';
import { SortableHeader, genericSort, type SortDirection } from '../common/SortableHeader';
import { TimeSeriesChart, type ChartSeries } from '../common/TimeSeriesChart';
import { costHistoryForOption, timingInsight } from './priceHistory';

interface ModelComputeAdvisorProps {
  gpuPricing: GpuPricingItem[];
  modelPricing?: ModelPricingItem[];
  baseTokensPerSec: (gpu: GpuPricingItem) => number;
  history: PricingHistorySummary[];
  onModelChange?: (
    model: CuratedModelDefinition | null,
    constraints?: AdvisorConstraints
  ) => void;
}

const SERIES_COLORS = [
  '#38bdf8', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#fb923c', '#2dd4bf', '#ec4899', '#60a5fa', '#f87171',
  '#4ade80', '#c084fc', '#e879f9', '#22d3ee', '#facc15',
  '#818cf8', '#f43f5e', '#10b981', '#06b6d4', '#eab308',
];

const PURPOSES: Array<{ id: ModelPurpose; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'text_to_text', label: 'Text LLM' },
  { id: 'text_to_image', label: 'Image' },
  { id: 'text_to_video', label: 'Video' },
  { id: 'speech_to_text', label: 'Audio' },
  { id: 'code_reasoning', label: 'Code & Reasoning' },
];

const TIME_RANGES: Array<{ id: number; label: string }> = [
  { id: 24, label: '24h' },
  { id: 72, label: '3d' },
  { id: 168, label: '7d' },
  { id: 0, label: 'All time' },
];

const selectStyle = {
  backgroundColor: '#1e293b',
  color: '#f8fafc',
  border: '1px solid #334155',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '12px',
} as const;

const fmtUsdPer1M = (v: number) => (v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);

function PickCard({ title, color, opt, note }: { title: string; color: string; opt: RankedOption | null; note: string }) {
  return (
    <div style={{ border: `1px solid ${color}`, backgroundColor: `${color}12`, borderRadius: '10px', padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: '11px', fontWeight: 800, color, textTransform: 'uppercase' }}>{title}</div>
      {opt ? (
        <>
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc', marginTop: '4px' }}>
            {cleanHardwareName(opt.gpu.hardwareDisplayName, opt.gpu.vramGb)}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {opt.gpu.provider} · {opt.gpu.pricingModel.replace('_', ' ')} · {opt.costPerJobUsd === 0 ? '$0.00' : opt.costPerJobUsd < 0.001 ? `$${opt.costPerJobUsd.toFixed(5)}` : `$${opt.costPerJobUsd.toFixed(4)}`}/ref job
          </div>
          <div style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '6px', fontWeight: 600 }}>
            {opt.tokensPerSec.toFixed(1)} tok/s · {fmtUsdPer1M(opt.costPerMillionUsd)} / 1M tok
          </div>
          {opt.concernUnitLabel !== '1M tok' && (
            <div style={{ fontSize: '11px', color: '#38bdf8', marginTop: '2px' }}>
              ≈ ${opt.concernUnitCostUsd.toFixed(2)} / {opt.concernUnitLabel}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>No option satisfies the constraints.</div>
      )}
      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>{note}</div>
    </div>
  );
}

export function ModelComputeAdvisor({ gpuPricing, modelPricing = [], baseTokensPerSec, history, onModelChange }: ModelComputeAdvisorProps) {
  // A. Model Requirements
  const [weightType, setWeightType] = useState<ModelWeightType>('open');
  const [purpose, setPurpose] = useState<ModelPurpose>('all');
  const [modelId, setModelId] = useState(CATALOG_MODELS[0].id);

  // B. Security & Networking Constraints
  const [minSecurityLevel, setMinSecurityLevel] = useState<'any' | 'standard' | 'enterprise' | 'fedramp_hipaa'>('any');
  const [requireVpc, setRequireVpc] = useState(false);
  const [dedicatedHardware, setDedicatedHardware] = useState(false);
  const [dataRetention, setDataRetention] = useState<'any' | 'zero_retention'>('any');
  const [encryption, setEncryption] = useState<'any' | 'strict_cmek'>('any');
  const [region, setRegion] = useState<'any' | 'us_east' | 'us_west' | 'europe' | 'apac'>('any');
  const [risk, setRisk] = useState<RiskTolerance>('any');

  // C. Execution Requirements
  const [executionType, setExecutionType] = useState<'all' | 'token_api' | 'serverless' | 'pod' | 'vm' | 'kubernetes'>('all');
  const [lifecycle, setLifecycle] = useState<'all' | 'persistent' | 'scale_to_zero' | 'ephemeral'>('all');
  const [jobPattern, setJobPattern] = useState<'all' | 'sync' | 'async' | 'batch'>('all');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');

  // Cost Constraints
  const [includeStorageAndNetwork, setIncludeStorageAndNetwork] = useState(false);

  // View UI State
  const [showRouting, setShowRouting] = useState(false);
  const [sortKey, setSortKey] = useState('per1m');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [timeRangeHours, setTimeRangeHours] = useState<number>(168); // 7d default
  const [topNRows, setTopNRows] = useState<number>(6);

  const resetFiltersToDefault = () => {
    setWeightType('open');
    setPurpose('all');
    setModelId(CATALOG_MODELS[0].id);
    setMinSecurityLevel('any');
    setRequireVpc(false);
    setDedicatedHardware(false);
    setDataRetention('any');
    setEncryption('any');
    setRegion('any');
    setRisk('any');
    setExecutionType('all');
    setLifecycle('all');
    setJobPattern('all');
    setPriority('normal');
    setIncludeStorageAndNetwork(false);
    setTimeRangeHours(168);
    setTopNRows(6);
    setSortKey('per1m');
    setSortDir('asc');
  };

  // Merge Curated Catalog with Models discovered via Provider APIs & Local PyTorch
  const allModels: CuratedModelDefinition[] = useMemo(() => {
    const list = [...CATALOG_MODELS];
    const seenIds = new Set(list.map((m) => m.id.toLowerCase()));

    for (const item of modelPricing) {
      const idLower = item.modelId.toLowerCase();
      if (!seenIds.has(idLower)) {
        seenIds.add(idLower);
        const isImage = idLower.includes('flux') || idLower.includes('sdxl') || idLower.includes('diffusion');
        const isVideo = idLower.includes('cogvideo') || idLower.includes('video');
        const isAudio = idLower.includes('whisper') || idLower.includes('voice') || idLower.includes('audio');
        const isCode = idLower.includes('coder') || idLower.includes('code') || idLower.includes('r1');
        const p: ModelPurpose = isImage ? 'text_to_image' : isVideo ? 'text_to_video' : isAudio ? 'speech_to_text' : isCode ? 'code_reasoning' : 'text_to_text';

        list.push({
          id: item.modelId,
          name: item.modelName,
          developer: item.developer,
          weightType: 'open',
          purpose: p,
          minVramGb: idLower.includes('70b') || idLower.includes('r1') ? 80 : idLower.includes('32b') || idLower.includes('27b') ? 32 : isVideo || isImage ? 24 : 16,
          weightsSizeGb: idLower.includes('70b') ? 140 : idLower.includes('32b') ? 64 : 16,
          defaultProvider: item.provider,
          storageCostMonthlyUsd: Math.round((idLower.includes('70b') ? 140 : 16) * 0.023 * 100) / 100,
          coldStartSec: 5,
          cacheTtlMinutes: 30,
          recommendedGpuSku: 'nvidia-h100-sxm',
          cheapestGpuSku: 'nvidia-rtx-5070ti',
          description: `Discovered from ${item.provider} (${item.developer})`,
        });
      }
    }
    return list;
  }, [modelPricing]);

  const models = useMemo(
    () => allModels.filter((m) => m.weightType === weightType && (purpose === 'all' || m.purpose === purpose)),
    [allModels, weightType, purpose]
  );

  const model = models.find((m) => m.id === modelId) ?? models[0];
  const benchmark = useMemo(() => (model ? getModelBenchmark(model) : null), [model]);

  // Constraints bundle passed to rankExecutionOptions and parent callbacks
  const activeConstraints: AdvisorConstraints = useMemo(
    () => ({
      requireVpc,
      risk,
      jobTokens: benchmark?.referenceTaskTokens ?? 2560,
      minSecurityLevel,
      dedicatedHardware,
      dataRetention,
      encryption,
      region,
      executionType,
      lifecycle,
      jobPattern,
      priority,
      includeStorageAndNetwork,
    }),
    [
      requireVpc,
      risk,
      benchmark,
      minSecurityLevel,
      dedicatedHardware,
      dataRetention,
      encryption,
      region,
      executionType,
      lifecycle,
      jobPattern,
      priority,
      includeStorageAndNetwork,
    ]
  );

  useEffect(() => {
    onModelChange?.(model ?? null, activeConstraints);
  }, [model, activeConstraints, onModelChange]);

  const result = useMemo(
    () =>
      model
        ? rankExecutionOptions(
            model,
            gpuPricing,
            activeConstraints,
            baseTokensPerSec
          )
        : null,
    [model, gpuPricing, activeConstraints, baseTokensPerSec]
  );

  const columns: Array<[string, string]> = useMemo(() => {
    const unitColLabel =
      benchmark && benchmark.concernUnitLabel !== '1M tok'
        ? `Cost / ${benchmark.concernUnitLabel}`
        : 'Efficiency (tok/$)';
    return [
      ['hardware', 'Hardware'],
      ['provider', 'Provider · Mode'],
      ['tps', 'Bench tok/s'],
      ['per1m', '$/1M tok'],
      ['benchJobCost', 'Bench Job Cost'],
      ['netCost', includeStorageAndNetwork ? 'Net $/1k Jobs (All-in)' : '$/1k Jobs (Compute)'],
      ['concernUnit', unitColLabel],
      ['risk', 'Interruption Risk'],
      ['security', 'Security & Region'],
    ];
  }, [benchmark, includeStorageAndNetwork]);

  const handleSort = (col: string) => {
    if (sortKey === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col);
      setSortDir(col === 'tps' || col === 'concernUnit' ? 'desc' : 'asc');
    }
  };

  const baseRows = useMemo(
    () =>
      (result?.options ?? []).map((opt) => {
        const points = costHistoryForOption(opt, history, timeRangeHours);
        return { opt, points };
      }),
    [result, history, timeRangeHours]
  );

  const rows = useMemo(
    () =>
      genericSort(baseRows, sortKey, sortDir, (r, key) => {
        switch (key) {
          case 'hardware': return cleanHardwareName(r.opt.gpu.hardwareDisplayName, r.opt.gpu.vramGb);
          case 'provider': return `${r.opt.gpu.provider} ${r.opt.gpu.pricingModel}`;
          case 'tps': return r.opt.tokensPerSec;
          case 'per1m': return r.opt.costPerMillionUsd;
          case 'benchJobCost': return r.opt.costPerJobUsd;
          case 'netCost': return r.opt.costPer1kJobsUsd;
          case 'concernUnit':
            return r.opt.concernUnitLabel !== '1M tok' ? r.opt.concernUnitCostUsd : r.opt.tokensPerDollar;
          case 'risk': return r.opt.gpu.interruptionRiskTier;
          case 'security': return `${r.opt.securityLevel} ${r.opt.regionLabel}`;
          default: return null;
        }
      }),
    [baseRows, sortKey, sortDir]
  );

  const chartRows = useMemo(() => {
    if (topNRows <= 0) return rows;
    return rows.slice(0, topNRows);
  }, [rows, topNRows]);

  const label = (r: (typeof rows)[number]) => {
    const hw = cleanHardwareName(r.opt.gpu.hardwareDisplayName, r.opt.gpu.vramGb);
    const mode =
      r.opt.gpu.pricingModel === 'spot_bid'
        ? 'Spot'
        : r.opt.gpu.pricingModel === 'on_demand'
          ? 'On-Demand'
          : r.opt.gpu.pricingModel === 'serverless'
            ? 'Serverless'
            : r.opt.gpu.pricingModel;
    return `${r.opt.gpu.provider} · ${hw} (${mode})`;
  };

  // Exactly ONE chart series
  const costSeries: ChartSeries[] = useMemo(
    () =>
      chartRows
        .filter((r) => r.points.length > 0)
        .map((r, i) => ({
          name: label(r),
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          points: r.points.map((p) => ({ x: p.t, y: p.costPerMillionUsd })),
        })),
    [chartRows]
  );

  const topOptionPoints = chartRows[0]?.points ?? [];
  const topInsight = useMemo(() => timingInsight(topOptionPoints), [topOptionPoints]);

  const td = { padding: '9px 12px', color: '#e2e8f0' } as const;

  return (
    <div style={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b', padding: '16px 20px', marginBottom: '16px' }}>
      {/* ---------------- TOP FILTERS MATRIX (A, B, C & Cost Constraints) ---------------- */}
      <div style={{ backgroundColor: '#090d16', borderRadius: '10px', border: '1px solid #1e293b', padding: '14px 18px', marginBottom: '18px' }}>
        {/* Filter Matrix Header & Reset Action */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid #1e293b', paddingBottom: '10px' }}>
          <div>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              🎯 Multi-Dimensional Workload &amp; Architecture Filters
            </span>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
              Filter by model requirements, security constraints, execution modalities, and all-in costs.
            </div>
          </div>
          <button
            onClick={resetFiltersToDefault}
            style={{
              backgroundColor: '#1e293b',
              color: '#38bdf8',
              border: '1px solid #334155',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background-color 0.2s',
            }}
          >
            ⟲ Reset All Filters to Default
          </button>
        </div>

        {/* Row A: Model Requirements */}
        <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: '12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              A · Model Requirements (Execution Compatibility)
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Determines hardware VRAM, precision &amp; software stack
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
            {(['open', 'proprietary'] as ModelWeightType[]).map((w) => (
              <button
                key={w}
                onClick={() => setWeightType(w)}
                style={{
                  ...selectStyle,
                  cursor: 'pointer',
                  backgroundColor: weightType === w ? (w === 'open' ? '#3b82f6' : '#8b5cf6') : '#1e293b',
                  fontWeight: 600,
                }}
              >
                {w === 'open' ? '🌐 Public Open-Weight' : '🔒 Owned Private Weights'}
              </button>
            ))}
            {PURPOSES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPurpose(p.id)}
                style={{
                  ...selectStyle,
                  cursor: 'pointer',
                  borderColor: purpose === p.id ? '#38bdf8' : '#334155',
                  backgroundColor: purpose === p.id ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                  borderRadius: '20px',
                  fontWeight: purpose === p.id ? 700 : 500,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Target Model:</label>
              <select
                value={model?.id ?? ''}
                onChange={(e) => setModelId(e.target.value)}
                style={{ ...selectStyle, minWidth: '320px', fontWeight: 600 }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — min {m.minVramGb}GB ({m.purpose.replace('text_to_', '').replace('_', ' ')})
                  </option>
                ))}
              </select>
            </div>

            {model && (
              <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span>VRAM ≥ <strong style={{ color: '#f8fafc' }}>{model.minVramGb}GB</strong></span>
                <span>·</span>
                <span>Weights: <strong style={{ color: '#f8fafc' }}>{model.weightsSizeGb}GB</strong></span>
                <span>·</span>
                <span>Cold start: ~{model.coldStartSec}s</span>
              </div>
            )}
          </div>
        </div>

        {/* Row B: Security & Networking */}
        <div style={{ borderBottom: '1px solid #1e293b', paddingBottom: '12px', marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 800, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              B · Security &amp; Networking (Exclusion Gates)
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Exclude offerings that don't meet mandatory compliance
            </span>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Min Security Level */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: '#94a3b8' }}>Security Level:</label>
              <select
                value={minSecurityLevel}
                onChange={(e) => setMinSecurityLevel(e.target.value as any)}
                style={selectStyle}
              >
                <option value="any">Any Security Level</option>
                <option value="standard">Standard Cloud</option>
                <option value="enterprise">Enterprise Isolated</option>
                <option value="fedramp_hipaa">FedRAMP / HIPAA Ready</option>
              </select>
            </div>

            {/* VPC / Private Networking */}
            <label style={{ fontSize: '12px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input type="checkbox" checked={requireVpc} onChange={(e) => setRequireVpc(e.target.checked)} />
              <span>🛡️ Require Private VPC</span>
            </label>

            {/* Dedicated Hardware / Tenant Isolation */}
            <label style={{ fontSize: '12px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer' }}>
              <input type="checkbox" checked={dedicatedHardware} onChange={(e) => setDedicatedHardware(e.target.checked)} />
              <span>🔒 Dedicated HW Only</span>
            </label>

            {/* Data Retention */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: '#94a3b8' }}>Retention:</label>
              <select
                value={dataRetention}
                onChange={(e) => setDataRetention(e.target.value as any)}
                style={selectStyle}
              >
                <option value="any">Standard Logs</option>
                <option value="zero_retention">Zero Retention (Ephemeral)</option>
              </select>
            </div>

            {/* Encryption */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: '#94a3b8' }}>Encryption:</label>
              <select
                value={encryption}
                onChange={(e) => setEncryption(e.target.value as any)}
                style={selectStyle}
              >
                <option value="any">Standard TLS</option>
                <option value="strict_cmek">Strict CMEK + TLS 1.3</option>
              </select>
            </div>

            {/* Region / Data Residency */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: '#94a3b8' }}>Region:</label>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value as any)}
                style={selectStyle}
              >
                <option value="any">Any Region</option>
                <option value="us_east">US East (N. Virginia)</option>
                <option value="us_west">US West (Oregon)</option>
                <option value="europe">Europe (Frankfurt / Dublin)</option>
                <option value="apac">Asia-Pacific (Tokyo)</option>
              </select>
            </div>

            {/* Interruption Risk with Rich Options */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '11px', color: '#94a3b8' }}>Interruption Risk:</label>
              <select
                value={risk}
                onChange={(e) => setRisk(e.target.value as RiskTolerance)}
                style={{ ...selectStyle, color: risk === 'guaranteed' ? '#34d399' : risk === 'any' ? '#38bdf8' : '#fbbf24' }}
              >
                <option value="any">Any / Spot Bid OK (All risk levels)</option>
                <option value="high_risk">High Tolerance (&gt;20% Risk OK)</option>
                <option value="medium_risk">Medium Risk (10–20% Spot)</option>
                <option value="low_risk">Low Risk (&lt;10% Spot)</option>
                <option value="guaranteed">Guaranteed Only (0% Preemption)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Row C: Execution Requirements & Cost Constraints */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#c084fc', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              C · Execution Requirements
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Execution Type */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Execution Type:</label>
                <select
                  value={executionType}
                  onChange={(e) => setExecutionType(e.target.value as any)}
                  style={selectStyle}
                >
                  <option value="all">All Types</option>
                  <option value="token_api">Token API (MaaS)</option>
                  <option value="serverless">Serverless Container</option>
                  <option value="pod">Dedicated Pod</option>
                  <option value="vm">Dedicated VM</option>
                  <option value="kubernetes">Kubernetes (Kueue)</option>
                </select>
              </div>

              {/* Deployment Lifecycle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Lifecycle:</label>
                <select
                  value={lifecycle}
                  onChange={(e) => setLifecycle(e.target.value as any)}
                  style={selectStyle}
                >
                  <option value="all">All Lifecycles</option>
                  <option value="persistent">Persistent (Always-On)</option>
                  <option value="scale_to_zero">Scale-to-Zero</option>
                  <option value="ephemeral">Ephemeral Spot</option>
                </select>
              </div>

              {/* Job Pattern */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Pattern:</label>
                <select
                  value={jobPattern}
                  onChange={(e) => setJobPattern(e.target.value as any)}
                  style={selectStyle}
                >
                  <option value="all">All Patterns</option>
                  <option value="sync">Synchronous (Streaming)</option>
                  <option value="async">Asynchronous (Queue)</option>
                  <option value="batch">Batch DAG (Flyte)</option>
                </select>
              </div>

              {/* Priority */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <label style={{ fontSize: '11px', color: '#94a3b8' }}>Priority:</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  style={selectStyle}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>

          {/* Cost Constraints: Storage & Network allocation toggle */}
          <div style={{ borderLeft: '1px solid #1e293b', paddingLeft: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              Cost Constraints
            </div>
            <label style={{ fontSize: '12px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeStorageAndNetwork}
                onChange={(e) => setIncludeStorageAndNetwork(e.target.checked)}
              />
              <span style={{ fontWeight: 600 }}>Include Storage &amp; Network Costs</span>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>(S3 weights + egress)</span>
            </label>
          </div>
        </div>
      </div>

      {/* ---------------- 3 DECISION HIGHLIGHT CARDS ---------------- */}
      <div className="kpi-grid-3" style={{ marginBottom: '14px' }}>
        <PickCard title="⭐ Best $/1M tok" color="#38bdf8" opt={result?.bestValue ?? null} note="Lowest cost per 1M benchmark tokens" />
        <PickCard title="⚡ Fastest (tok/s)" color="#c084fc" opt={result?.fastest ?? null} note="Highest benchmark tok/s throughput" />
        <PickCard title="🛡️ Secure + guaranteed" color="#34d399" opt={result?.secure ?? null} note="VPC-capable, zero interruption" />
      </div>

      {/* ---------------- EXACTLY ONE GRAPH: HISTORICAL PRICE FLUX ---------------- */}
      <div style={{ border: '1px solid #1e293b', borderRadius: '8px', marginBottom: '16px', backgroundColor: '#090d16' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderBottom: '1px solid #1e293b',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div>
            <div style={{ fontSize: '13px', color: '#f8fafc', fontWeight: 700 }}>
              Historical Spot Price Trends ($/1M tokens)
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              Hourly spot &amp; on-demand token cost reflecting diurnal office-hours demand peaks (13:00–18:00 UTC)
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Time range selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Time range:</span>
              <div style={{ display: 'flex', gap: '2px', backgroundColor: '#1e293b', padding: '2px', borderRadius: '6px' }}>
                {TIME_RANGES.map((tr) => (
                  <button
                    key={tr.id}
                    onClick={() => setTimeRangeHours(tr.id)}
                    style={{
                      border: 'none',
                      backgroundColor: timeRangeHours === tr.id ? '#3b82f6' : 'transparent',
                      color: timeRangeHours === tr.id ? '#ffffff' : '#94a3b8',
                      fontSize: '11px',
                      fontWeight: timeRangeHours === tr.id ? 700 : 500,
                      padding: '3px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Hardware rows plotted selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>Chart hardware:</span>
              <select
                value={topNRows}
                onChange={(e) => setTopNRows(Number(e.target.value))}
                style={{ ...selectStyle, padding: '3px 8px', fontSize: '11px' }}
              >
                <option value={3}>Top 3</option>
                <option value={6}>Top 6</option>
                <option value={10}>Top 10</option>
                <option value={0}>All compatible ({rows.length})</option>
              </select>
            </div>
          </div>
        </div>

        <TimeSeriesChart
          series={costSeries}
          height={240}
          xFormat={(x, spanMs) => {
            const d = new Date(x);
            const hours = `${String(d.getHours()).padStart(2, '0')}:00`;
            const isNarrow =
              spanMs !== undefined ? spanMs <= 36 * 3600 * 1000 : timeRangeHours <= 24;
            if (isNarrow) {
              return hours;
            }
            return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hours}`;
          }}
          yFormat={(y) => fmtUsdPer1M(y)}
          emptyMessage="No price history recorded for these filtered offerings yet. Trigger a catalog sync to record historical points."
        />

        {topInsight.savingsPct > 5 && (
          <div
            style={{
              backgroundColor: 'rgba(56, 189, 248, 0.05)',
              borderTop: '1px solid #1e293b',
              padding: '8px 14px',
              fontSize: '11px',
              color: '#cbd5e1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>📈</span>
              <span>
                <strong>Office-Hours Volatility Insight:</strong> Spot token prices peak around{' '}
                <strong style={{ color: '#fbbf24' }}>
                  {String(topInsight.worstHour ?? 15).padStart(2, '0')}:00 UTC
                </strong>{' '}
                (US/EU core business hours). Off-peak runs around{' '}
                <strong style={{ color: '#34d399' }}>
                  {String(topInsight.bestHour ?? 4).padStart(2, '0')}:00 UTC
                </strong>{' '}
                or weekends reduce token cost by up to{' '}
                <strong style={{ color: '#38bdf8' }}>{topInsight.savingsPct.toFixed(0)}%</strong>.
              </span>
            </div>
            <span style={{ fontSize: '10px', color: '#64748b' }}>Hourly update cadence · Spot auction shifts</span>
          </div>
        )}
      </div>

      {/* ---------------- STANDARDIZED BENCHMARK REFERENCE JOB SPECS ---------------- */}
      {benchmark && (
        <div
          style={{
            backgroundColor: '#0a101f',
            border: '1px solid #1e3a8a',
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px' }}>📋</span>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#93c5fd' }}>
                Standardized Benchmark Reference Job Specs
              </div>
              <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '2px' }}>
                Suite: <strong style={{ color: '#f8fafc' }}>{benchmark.benchmarkSuite}</strong> · Standard Task: <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{benchmark.taskProfile}</span> ({benchmark.referenceTaskTokens.toLocaleString()} tokens)
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Identical workload benchmark evaluated across all hardware options to measure throughput &amp; job cost.
            </span>
            <a
              href={benchmark.referenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                backgroundColor: '#1e293b',
                color: '#38bdf8',
                border: '1px solid #38bdf8',
                padding: '4px 10px',
                borderRadius: '5px',
                fontSize: '11px',
                fontWeight: 600,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Benchmark Source
            </a>
          </div>
        </div>
      )}

      {/* ---------------- EXACTLY ONE COMPARISON TABLE ---------------- */}
      <div style={{ overflowX: 'auto', border: '1px solid #1e293b', borderRadius: '8px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
          <thead>
            <tr style={{ backgroundColor: '#1e293b' }}>
              {columns.map(([col, labelText]) => (
                <SortableHeader
                  key={col}
                  column={col}
                  currentSortKey={sortKey}
                  currentSortDir={sortDir}
                  onSort={handleSort}
                  style={{ padding: '10px 12px', fontSize: '11px' }}
                >
                  {labelText}
                </SortableHeader>
              ))}
              <th style={{ padding: '10px 12px', fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.opt.gpu.id}
                style={{
                  borderBottom: '1px solid #1e293b',
                  backgroundColor: i < chartRows.length ? 'rgba(56, 189, 248, 0.04)' : 'transparent',
                }}
              >
                <td style={{ ...td, fontWeight: 700 }}>
                  <div style={{ color: '#f8fafc' }}>
                    {cleanHardwareName(r.opt.gpu.hardwareDisplayName, r.opt.gpu.vramGb)}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>
                    {r.opt.gpu.vramGb}GB VRAM
                  </div>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{r.opt.gpu.provider}</div>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                    {r.opt.gpu.pricingModel.replace('_', ' ')}
                  </div>
                </td>
                <td style={td}>
                  <a
                    href={r.opt.benchmark.referenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Public benchmark source: ${r.opt.benchmark.benchmarkSuite} (${r.opt.benchmark.taskProfile})`}
                    style={{
                      color: '#c084fc',
                      fontWeight: 600,
                      textDecoration: 'none',
                      borderBottom: '1px dotted #c084fc',
                      cursor: 'pointer',
                    }}
                  >
                    {r.opt.tokensPerSec.toFixed(1)} tok/s
                  </a>
                </td>
                <td style={{ ...td, color: '#34d399', fontWeight: 700 }}>
                  {fmtUsdPer1M(r.opt.costPerMillionUsd)}
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 700, color: r.opt.costPerJobUsd === 0 ? '#34d399' : '#f8fafc' }}>
                    {r.opt.costPerJobUsd === 0
                      ? '$0.00 (Local)'
                      : r.opt.costPerJobUsd < 0.001
                        ? `$${r.opt.costPerJobUsd.toFixed(5)}`
                        : `$${r.opt.costPerJobUsd.toFixed(4)}`}
                  </div>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                    ~{r.opt.execSeconds >= 60 ? `${(r.opt.execSeconds / 60).toFixed(1)}m` : `${r.opt.execSeconds.toFixed(1)}s`} / ref job
                  </div>
                </td>
                <td style={td}>
                  <div style={{ fontWeight: 700, color: '#10b981' }}>
                    ${r.opt.costPer1kJobsUsd.toFixed(3)}
                  </div>
                  {includeStorageAndNetwork && r.opt.storageCostPer1kJobsUsd !== undefined && (
                    <div style={{ fontSize: '9px', color: '#94a3b8' }}>
                      incl. ${(r.opt.storageCostPer1kJobsUsd + (r.opt.networkCostPer1kJobsUsd || 0)).toFixed(4)} stor/net
                    </div>
                  )}
                </td>
                <td style={td}>
                  {r.opt.concernUnitLabel !== '1M tok' ? (
                    <div>
                      <div style={{ fontWeight: 700, color: '#f8fafc' }}>
                        ${r.opt.concernUnitCostUsd.toFixed(2)}
                      </div>
                      <div style={{ fontSize: '10px', color: '#38bdf8' }}>
                        ≈ ${r.opt.costPerJobUsd.toFixed(3)}/task · {r.opt.execSeconds >= 60 ? `${(r.opt.execSeconds / 60).toFixed(1)}m` : `${Math.round(r.opt.execSeconds)}s`}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 700, color: '#f8fafc' }}>
                        {(r.opt.tokensPerDollar / 1000).toFixed(0)}K tok/$
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>
                        ~{r.opt.execSeconds.toFixed(1)}s / task
                      </div>
                    </div>
                  )}
                </td>
                <td style={td}>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      backgroundColor:
                        r.opt.gpu.interruptionRiskTier === 'guaranteed'
                          ? 'rgba(56, 189, 248, 0.15)'
                          : r.opt.gpu.interruptionRiskTier === '<5%'
                            ? 'rgba(52, 211, 153, 0.15)'
                            : 'rgba(245, 158, 11, 0.15)',
                      color:
                        r.opt.gpu.interruptionRiskTier === 'guaranteed'
                          ? '#38bdf8'
                          : r.opt.gpu.interruptionRiskTier === '<5%'
                            ? '#34d399'
                            : '#fbbf24',
                    }}
                  >
                    {r.opt.gpu.interruptionRiskTier}
                  </span>
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                    {r.opt.vpcCapable && (
                      <span
                        title="VPC Private Network Capable"
                        style={{
                          backgroundColor: 'rgba(52, 211, 153, 0.15)',
                          color: '#34d399',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                        }}
                      >
                        🛡️ VPC
                      </span>
                    )}
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>{r.opt.regionLabel}</span>
                  </div>
                </td>
                <td style={td}>
                  <button
                    onClick={() => setShowRouting(true)}
                    style={{
                      backgroundColor: '#1e293b',
                      color: '#a5b4fc',
                      border: '1px solid #4338ca',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Simulate Route
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} style={{ ...td, textAlign: 'center', color: '#64748b', padding: '24px' }}>
                  No hardware or execution offering satisfies all active model, security, execution, and risk constraints.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ---------------- 5-STAGE ROUTING POLICY ENGINE DRAWER ---------------- */}
      <div style={{ marginTop: '16px' }}>
        <button
          onClick={() => setShowRouting((v) => !v)}
          style={{ ...selectStyle, cursor: 'pointer', color: '#818cf8', fontWeight: 600 }}
        >
          {showRouting ? '▾ Hide' : '▸ 3 · Show'} 5-Stage Routing Policy Engine &amp; Explainability Simulator
        </button>
        {showRouting && (
          <div style={{ marginTop: '10px' }}>
            <RoutingView />
          </div>
        )}
      </div>
    </div>
  );
}
