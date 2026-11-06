import { useState, useMemo } from 'react';
import type { PricingHistorySummary } from '../../types';

interface HistoricalPriceChartProps {
  summaries: PricingHistorySummary[];
}

export const PROVIDER_CHART_COLORS: Record<string, string> = {
  runpod: '#38bdf8', // Cyan
  vast_ai: '#34d399', // Emerald
  nebius: '#a78bfa', // Purple
  coreweave: '#f43f5e', // Rose
  baseten: '#fb923c', // Orange
  jarvislabs: '#e879f9', // Fuchsia
  hivenet: '#2dd4bf', // Teal
  sagemaker: '#facc15', // Yellow
  bedrock: '#818cf8', // Indigo
  fal: '#fbbf24', // Amber
  runware: '#ec4899', // Pink
  wavespeed: '#06b6d4', // Sky
  neocloudz: '#a3e635', // Lime
  local_pytorch: '#94a3b8', // Slate
};

export interface TradingSession {
  name: 'Asia' | 'Europe' | 'USA' | 'OffPeak';
  label: string;
  flag: string;
  hours: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
}

export function getTradingSession(isoString: string): TradingSession {
  const d = new Date(isoString);
  const hour = d.getUTCHours();
  if (hour >= 0 && hour < 8) {
    return {
      name: 'Asia',
      label: 'Asia-Pacific',
      flag: '🇯🇵',
      hours: '00:00 - 08:00 UTC',
      bgColor: 'rgba(14, 165, 233, 0.08)',
      borderColor: 'rgba(14, 165, 233, 0.25)',
      textColor: '#38bdf8',
    };
  }
  if (hour >= 8 && hour < 15) {
    return {
      name: 'Europe',
      label: 'Europe',
      flag: '🇪🇺',
      hours: '08:00 - 15:00 UTC',
      bgColor: 'rgba(16, 185, 129, 0.08)',
      borderColor: 'rgba(16, 185, 129, 0.25)',
      textColor: '#34d399',
    };
  }
  if (hour >= 15 && hour < 22) {
    return {
      name: 'USA',
      label: 'Americas (USA)',
      flag: '🇺🇸',
      hours: '15:00 - 22:00 UTC',
      bgColor: 'rgba(245, 158, 11, 0.08)',
      borderColor: 'rgba(245, 158, 11, 0.25)',
      textColor: '#fbbf24',
    };
  }
  return {
    name: 'OffPeak',
    label: 'Global Off-Peak',
    flag: '🌙',
    hours: '22:00 - 24:00 UTC',
    bgColor: 'rgba(100, 116, 139, 0.05)',
    borderColor: 'rgba(100, 116, 139, 0.15)',
    textColor: '#94a3b8',
  };
}

export function HistoricalPriceChart({ summaries }: HistoricalPriceChartProps) {
  // Extract distinct SKU IDs
  const distinctSkus = useMemo(() => {
    const map = new Map<string, { itemId: string; displayName: string }>();
    for (const s of summaries) {
      if (!map.has(s.itemId)) {
        // Create clean generic display name from item
        let cleanName = s.displayName;
        if (s.itemId === 'nvidia-h100-sxm') cleanName = 'NVIDIA H100 SXM5 80GB';
        else if (s.itemId === 'nvidia-rtx-5090') cleanName = 'NVIDIA RTX 5090 Blackwell';
        else if (s.itemId === 'nvidia-l4') cleanName = 'NVIDIA L4 Serverless';
        else if (s.itemId === 'nvidia-rtx-4090') cleanName = 'NVIDIA RTX 4090 24GB';
        else if (s.itemId === 'deepseek-v4.1-flash') cleanName = 'DeepSeek V4.1 Flash';

        map.set(s.itemId, { itemId: s.itemId, displayName: cleanName });
      }
    }
    return Array.from(map.values());
  }, [summaries]);

  const [selectedItemId, setSelectedItemId] = useState<string>(
    distinctSkus[0]?.itemId || summaries[0]?.itemId || 'nvidia-h100-sxm'
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Line type toggles
  const [showOnDemand, setShowOnDemand] = useState<boolean>(true);
  const [showSpot, setShowSpot] = useState<boolean>(true);

  // All summaries matching the selected SKU
  const matchingSummaries = useMemo(() => {
    return summaries.filter((s) => s.itemId === selectedItemId);
  }, [summaries, selectedItemId]);

  // Provider visibility state: default to all providers for this SKU enabled
  const allProvidersForSku = useMemo(() => {
    return matchingSummaries.map((s) => s.provider);
  }, [matchingSummaries]);

  const [enabledProviders, setEnabledProviders] = useState<Record<string, boolean>>({});

  // Ensure default state when SKU changes
  const activeProviders = useMemo(() => {
    const result: string[] = [];
    for (const p of allProvidersForSku) {
      if (enabledProviders[p] === undefined || enabledProviders[p] === true) {
        result.push(p);
      }
    }
    return result;
  }, [allProvidersForSku, enabledProviders]);

  const toggleProvider = (prov: string) => {
    setEnabledProviders((prev) => ({
      ...prev,
      [prov]: prev[prov] !== undefined ? !prev[prov] : false,
    }));
  };

  // Primary active summary (first matching) for baseline KPI cards and backward compatibility
  const activeSummary = useMemo(() => {
    return matchingSummaries.find((s) => activeProviders.includes(s.provider)) || matchingSummaries[0] || summaries[0];
  }, [matchingSummaries, activeProviders, summaries]);

  const baseHistory = activeSummary?.history || [];

  // Calculate Max, Min, Avg across active providers
  const stats = useMemo(() => {
    if (baseHistory.length === 0) return { max: 0, min: 0, avg: 0, spotMin: 0, spotMax: 0 };
    const allPrices = baseHistory.map((h) => h.priceUsd);
    const spotPrices = baseHistory.filter((h) => h.spotPriceUsd !== undefined).map((h) => h.spotPriceUsd!);

    const max = Math.max(...allPrices);
    const min = Math.min(...allPrices);
    const avg = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;

    const spotMin = spotPrices.length > 0 ? Math.min(...spotPrices) : 0;
    const spotMax = spotPrices.length > 0 ? Math.max(...spotPrices) : 0;

    return { max, min, avg, spotMin, spotMax };
  }, [baseHistory]);

  // SVG dimensions
  const width = 860;
  const height = 320;
  const padding = { top: 32, right: 90, bottom: 48, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale calculations across all enabled provider curves
  const { minVal, maxVal } = useMemo(() => {
    const allVals: number[] = [];
    for (const s of matchingSummaries) {
      if (!activeProviders.includes(s.provider)) continue;
      for (const h of s.history) {
        if (showOnDemand) allVals.push(h.priceUsd);
        if (showSpot && h.spotPriceUsd !== undefined) allVals.push(h.spotPriceUsd);
      }
    }
    if (allVals.length === 0) return { minVal: 0, maxVal: 5 };
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const buffer = (rawMax - rawMin) * 0.18 || 0.2;
    return {
      minVal: Math.max(0, Number((rawMin - buffer).toFixed(2))),
      maxVal: Number((rawMax + buffer).toFixed(2)),
    };
  }, [matchingSummaries, activeProviders, showOnDemand, showSpot]);

  const getY = (val: number) => {
    if (maxVal === minVal) return padding.top + chartHeight / 2;
    return padding.top + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight;
  };

  const getX = (index: number) => {
    if (baseHistory.length <= 1) return padding.left + chartWidth / 2;
    return padding.left + (index / (baseHistory.length - 1)) * chartWidth;
  };

  // Compute Contiguous Trading Session Background Bands
  const sessionBands = useMemo(() => {
    if (baseHistory.length <= 1) return [];
    const bands: Array<{
      session: TradingSession;
      x1: number;
      x2: number;
      labelX: number;
    }> = [];

    let curSession = getTradingSession(baseHistory[0].recordedAt);
    let startX = getX(0);

    for (let i = 1; i < baseHistory.length; i++) {
      const s = getTradingSession(baseHistory[i].recordedAt);
      if (s.name !== curSession.name || i === baseHistory.length - 1) {
        const endX = getX(i);
        bands.push({
          session: curSession,
          x1: startX,
          x2: endX,
          labelX: (startX + endX) / 2,
        });
        curSession = s;
        startX = endX;
      }
    }

    return bands;
  }, [baseHistory, chartWidth]);

  // Generate SVG paths per enabled provider
  const providerPaths = useMemo(() => {
    return matchingSummaries
      .filter((s) => activeProviders.includes(s.provider))
      .map((s) => {
        const color = PROVIDER_CHART_COLORS[s.provider.toLowerCase()] || '#38bdf8';
        const onDemand =
          s.history.length > 0
            ? s.history.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.priceUsd)}`).join(' ')
            : '';

        const spotPoints = s.history
          .map((pt, i) => (pt.spotPriceUsd !== undefined ? { x: getX(i), y: getY(pt.spotPriceUsd) } : null))
          .filter(Boolean) as Array<{ x: number; y: number }>;

        const spot =
          spotPoints.length > 0
            ? spotPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')
            : '';

        return {
          provider: s.provider,
          displayName: s.displayName,
          color,
          onDemandPath: onDemand,
          spotPath: spot,
          history: s.history,
        };
      });
  }, [matchingSummaries, activeProviders, minVal, maxVal]);

  return (
    <div
      style={{
        backgroundColor: '#0f172a',
        borderRadius: '12px',
        border: '1px solid #1e293b',
        padding: '20px',
        marginBottom: '28px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      }}
    >
      {/* Header and SKU Selection */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ color: '#f8fafc', fontSize: '16px', fontWeight: 700, margin: 0 }}>
              Historical Price Fluctuations &amp; Market References
            </h3>
            <span
              style={{
                backgroundColor: '#38bdf820',
                color: '#38bdf8',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
              }}
            >
              7-Day Multi-Cloud Trend
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '13px', margin: '4px 0 0 0' }}>
            Multi-provider spot auction &amp; on-demand pricing aligned with global Asia, Europe, and US trading sessions.
          </p>
        </div>

        {/* Item Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500 }}>Select Hardware / Model:</label>
          <select
            value={selectedItemId}
            onChange={(e) => {
              setSelectedItemId(e.target.value);
              setEnabledProviders({});
            }}
            style={{
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '8px 14px',
              fontSize: '13px',
              fontWeight: 600,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {distinctSkus.map((s) => (
              <option key={s.itemId} value={s.itemId}>
                {s.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Global Trading Sessions Legend Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          backgroundColor: '#1e293b50',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '8px 14px',
          marginBottom: '16px',
          flexWrap: 'wrap',
          fontSize: '12px',
        }}
      >
        <span style={{ color: '#94a3b8', fontWeight: 600 }}>Global Market Sessions:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ backgroundColor: 'rgba(14, 165, 233, 0.25)', width: '12px', height: '12px', borderRadius: '3px' }} />
          <span style={{ color: '#38bdf8', fontWeight: 600 }}>🇯🇵 Asia (00:00 - 08:00 UTC)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.25)', width: '12px', height: '12px', borderRadius: '3px' }} />
          <span style={{ color: '#34d399', fontWeight: 600 }}>🇪🇺 Europe (08:00 - 15:00 UTC)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ backgroundColor: 'rgba(245, 158, 11, 0.25)', width: '12px', height: '12px', borderRadius: '3px' }} />
          <span style={{ color: '#fbbf24', fontWeight: 600 }}>🇺🇸 USA (15:00 - 22:00 UTC)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ backgroundColor: 'rgba(100, 116, 139, 0.2)', width: '12px', height: '12px', borderRadius: '3px' }} />
          <span style={{ color: '#94a3b8' }}>🌙 Off-Peak (22:00 - 24:00 UTC)</span>
        </div>
      </div>

      {/* Provider & Modality Visualization Toggles */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
          padding: '10px 14px',
          backgroundColor: '#1e293b40',
          borderRadius: '8px',
          border: '1px solid #334155',
        }}
      >
        {/* Provider Checkboxes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: 600 }}>Providers:</span>
          {allProvidersForSku.map((p) => {
            const isChecked = activeProviders.includes(p);
            const color = PROVIDER_CHART_COLORS[p.toLowerCase()] || '#38bdf8';
            return (
              <label
                key={p}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '12px',
                  color: isChecked ? '#f8fafc' : '#64748b',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleProvider(p)}
                  style={{ accentColor: color, cursor: 'pointer' }}
                />
                <span
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: isChecked ? color : '#475569',
                  }}
                />
                <span style={{ fontWeight: isChecked ? 600 : 400 }}>{p.toUpperCase()}</span>
              </label>
            );
          })}
        </div>

        {/* Curve Type Toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
          <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Curves:</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none', color: '#cbd5e1' }}>
            <input
              type="checkbox"
              checked={showOnDemand}
              onChange={(e) => setShowOnDemand(e.target.checked)}
              style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
            />
            <span style={{ display: 'inline-block', width: '12px', height: '3px', backgroundColor: '#38bdf8', borderRadius: '1px' }} />
            On-Demand (Solid)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none', color: '#cbd5e1' }}>
            <input
              type="checkbox"
              checked={showSpot}
              onChange={(e) => setShowSpot(e.target.checked)}
              style={{ accentColor: '#10b981', cursor: 'pointer' }}
            />
            <span style={{ display: 'inline-block', width: '12px', height: '2px', borderTop: '2px dashed #10b981' }} />
            Spot / Auction (Dashed)
          </label>
        </div>
      </div>

      {/* KPI Cards for the Selected Series */}
      {activeSummary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '12px',
            marginBottom: '20px',
          }}
        >
          <div style={{ backgroundColor: '#1e293b50', padding: '10px 14px', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>LATEST ON-DEMAND</div>
            <div style={{ color: '#38bdf8', fontSize: '16px', fontWeight: 700 }}>${activeSummary.latestPriceUsd.toFixed(2)}/hr</div>
            <div style={{ color: activeSummary.priceChange24hPct <= 0 ? '#34d399' : '#f87171', fontSize: '11px' }}>
              {activeSummary.priceChange24hPct >= 0 ? '+' : ''}{activeSummary.priceChange24hPct}% (24h)
            </div>
          </div>

          <div style={{ backgroundColor: '#1e293b50', padding: '10px 14px', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>MAX HISTORICAL</div>
            <div style={{ color: '#f87171', fontSize: '16px', fontWeight: 700 }}>${stats.max.toFixed(2)}/hr</div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>Peak Demand Spike</div>
          </div>

          <div style={{ backgroundColor: '#1e293b50', padding: '10px 14px', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>MIN HISTORICAL (FLOOR)</div>
            <div style={{ color: '#34d399', fontSize: '16px', fontWeight: 700 }}>${stats.min.toFixed(2)}/hr</div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>Lowest Recorded Rate</div>
          </div>

          <div style={{ backgroundColor: '#1e293b50', padding: '10px 14px', borderRadius: '8px', border: '1px solid #334155' }}>
            <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 600 }}>AVERAGE BENCHMARK</div>
            <div style={{ color: '#fbbf24', fontSize: '16px', fontWeight: 700 }}>${stats.avg.toFixed(2)}/hr</div>
            <div style={{ color: '#94a3b8', fontSize: '11px' }}>7-Day Normalized Mean</div>
          </div>

          {stats.spotMin > 0 && (
            <div style={{ backgroundColor: '#1e293b50', padding: '10px 14px', borderRadius: '8px', border: '1px solid #334155' }}>
              <div style={{ color: '#10b981', fontSize: '11px', fontWeight: 600 }}>BEST SPOT BID</div>
              <div style={{ color: '#10b981', fontSize: '16px', fontWeight: 700 }}>${stats.spotMin.toFixed(2)}/hr</div>
              <div style={{ color: '#34d399', fontSize: '11px' }}>
                {Math.round(((stats.avg - stats.spotMin) / stats.avg) * 100)}% off On-Demand
              </div>
            </div>
          )}
        </div>
      )}

      {/* SVG Line Graph Container with Trading Session Areas */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          overflowX: 'auto',
          backgroundColor: '#090d16',
          borderRadius: '10px',
          border: '1px solid #1e293b',
          padding: '10px 0',
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', minWidth: '700px', height: 'auto', display: 'block' }}
        >
          {/* 1. Trading Session Shaded Background Bands */}
          {sessionBands.map((band, idx) => {
            const bandWidth = Math.max(1, band.x2 - band.x1);
            return (
              <g key={`band-${idx}`}>
                <rect
                  x={band.x1}
                  y={padding.top}
                  width={bandWidth}
                  height={chartHeight}
                  fill={band.session.bgColor}
                />
                <line
                  x1={band.x1}
                  y1={padding.top}
                  x2={band.x1}
                  y2={padding.top + chartHeight}
                  stroke={band.session.borderColor}
                  strokeDasharray="2 2"
                />
                {bandWidth > 40 && (
                  <text
                    x={band.labelX}
                    y={padding.top + 14}
                    textAnchor="middle"
                    fill={band.session.textColor}
                    fontSize="9"
                    fontWeight="700"
                    opacity="0.85"
                  >
                    {band.session.flag} {band.session.name.toUpperCase()}
                  </text>
                )}
              </g>
            );
          })}

          {/* 2. Horizontal Grid Lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const val = minVal + pct * (maxVal - minVal);
            const y = getY(val);
            return (
              <g key={pct}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#1e293b"
                  strokeDasharray="4 4"
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  ${val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Reference Line: MAX (Red Dashed) */}
          {stats.max > 0 && (
            <g>
              <line
                x1={padding.left}
                y1={getY(stats.max)}
                x2={width - padding.right}
                y2={getY(stats.max)}
                stroke="#f87171"
                strokeWidth="1.2"
                strokeDasharray="6 3"
              />
              <text
                x={width - padding.right + 8}
                y={getY(stats.max) + 4}
                fill="#f87171"
                fontSize="10"
                fontWeight="700"
              >
                Max ${stats.max.toFixed(2)}
              </text>
            </g>
          )}

          {/* Reference Line: MIN (Green Dashed) */}
          {stats.min > 0 && (
            <g>
              <line
                x1={padding.left}
                y1={getY(stats.min)}
                x2={width - padding.right}
                y2={getY(stats.min)}
                stroke="#34d399"
                strokeWidth="1.2"
                strokeDasharray="6 3"
              />
              <text
                x={width - padding.right + 8}
                y={getY(stats.min) + 4}
                fill="#34d399"
                fontSize="10"
                fontWeight="700"
              >
                Min ${stats.min.toFixed(2)}
              </text>
            </g>
          )}

          {/* Reference Line: AVG (Amber Dashed) */}
          {stats.avg > 0 && (
            <g>
              <line
                x1={padding.left}
                y1={getY(stats.avg)}
                x2={width - padding.right}
                y2={getY(stats.avg)}
                stroke="#fbbf24"
                strokeWidth="1.2"
                strokeDasharray="4 2"
              />
              <text
                x={width - padding.right + 8}
                y={getY(stats.avg) + 4}
                fill="#fbbf24"
                fontSize="10"
                fontWeight="700"
              >
                Avg ${stats.avg.toFixed(2)}
              </text>
            </g>
          )}

          {/* 3. Render Provider Curves */}
          {providerPaths.map((p) => (
            <g key={`curves-${p.provider}`}>
              {/* On-Demand Solid Line */}
              {showOnDemand && p.onDemandPath && (
                <path
                  d={p.onDemandPath}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Spot Dashed Line */}
              {showSpot && p.spotPath && (
                <path
                  d={p.spotPath}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.85"
                />
              )}
            </g>
          ))}

          {/* 4. Data Points & Time Markers */}
          {baseHistory.map((pt, i) => {
            const cx = getX(i);
            const isHovered = hoveredIndex === i;
            const session = getTradingSession(pt.recordedAt);
            const ptDate = new Date(pt.recordedAt);
            const hourUtc = ptDate.getUTCHours();
            const hourLabel = `${hourUtc.toString().padStart(2, '0')}:00`;

            // Display time every 4-6 points or start/middle/end
            const isLabelPoint =
              i === 0 ||
              i === Math.floor(baseHistory.length / 4) ||
              i === Math.floor(baseHistory.length / 2) ||
              i === Math.floor((3 * baseHistory.length) / 4) ||
              i === baseHistory.length - 1;

            return (
              <g key={i}>
                {/* Hover interaction target column */}
                <rect
                  x={cx - 10}
                  y={padding.top}
                  width="20"
                  height={chartHeight}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />

                {/* Vertical hover crosshair */}
                {isHovered && (
                  <line
                    x1={cx}
                    y1={padding.top}
                    x2={cx}
                    y2={padding.top + chartHeight}
                    stroke="#38bdf8"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                )}

                {/* Primary Data Circles */}
                {providerPaths.map((p) => {
                  const ptData = p.history[i];
                  if (!ptData) return null;
                  const cy = getY(ptData.priceUsd);
                  const spotCy = ptData.spotPriceUsd !== undefined ? getY(ptData.spotPriceUsd) : null;

                  return (
                    <g key={`pt-${p.provider}-${i}`}>
                      {showOnDemand && (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isHovered ? 5 : 3}
                          fill="#0f172a"
                          stroke={p.color}
                          strokeWidth="2"
                          style={{ pointerEvents: 'none', transition: 'r 0.15s ease' }}
                        />
                      )}
                      {showSpot && spotCy !== null && (
                        <circle
                          cx={cx}
                          cy={spotCy}
                          r={isHovered ? 5 : 3}
                          fill="#0f172a"
                          stroke={p.color}
                          strokeWidth="1.5"
                          style={{ pointerEvents: 'none', transition: 'r 0.15s ease' }}
                        />
                      )}
                    </g>
                  );
                })}

                {/* Bottom X-axis hour and session flag labels */}
                {isLabelPoint && (
                  <g>
                    <text
                      x={cx}
                      y={height - padding.bottom + 16}
                      textAnchor="middle"
                      fill="#cbd5e1"
                      fontSize="10"
                      fontWeight="600"
                      fontFamily="monospace"
                    >
                      {hourLabel} UTC
                    </text>
                    <text
                      x={cx}
                      y={height - padding.bottom + 28}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="9"
                    >
                      {session.flag} {ptDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Multi-Cloud Information Banner */}
        {hoveredIndex !== null && baseHistory[hoveredIndex] && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#1e293b',
              border: '1px solid #38bdf8',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '12px',
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              boxShadow: '0 8px 16px -2px rgba(0, 0, 0, 0.4)',
              pointerEvents: 'none',
              zIndex: 10,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                {new Date(baseHistory[hoveredIndex].recordedAt).toUTCString().replace(':00 GMT', ' UTC')}
              </span>
              <div style={{ fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span>{getTradingSession(baseHistory[hoveredIndex].recordedAt).flag}</span>
                <span>{getTradingSession(baseHistory[hoveredIndex].recordedAt).label} Session</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              {providerPaths.map((p) => {
                const pt = p.history[hoveredIndex];
                if (!pt) return null;
                return (
                  <div key={p.provider} style={{ borderLeft: `2px solid ${p.color}`, paddingLeft: '6px' }}>
                    <div style={{ color: p.color, fontWeight: 700, fontSize: '11px' }}>
                      {p.provider.toUpperCase()}
                    </div>
                    {showOnDemand && (
                      <div style={{ color: '#f1f5f9', fontSize: '11px' }}>
                        On-Dem: <strong>${pt.priceUsd.toFixed(2)}</strong>
                      </div>
                    )}
                    {showSpot && pt.spotPriceUsd !== undefined && (
                      <div style={{ color: '#34d399', fontSize: '11px' }}>
                        Spot: <strong>${pt.spotPriceUsd.toFixed(2)}</strong>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Chart Legend with Provider Swatches */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginTop: '16px',
          fontSize: '12px',
        }}
      >
        {providerPaths.map((p) => (
          <div key={`legend-${p.provider}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '3px', backgroundColor: p.color, borderRadius: '2px' }} />
            <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{p.provider.toUpperCase()}</span>
          </div>
        ))}

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px', borderLeft: '1px solid #334155', paddingLeft: '12px' }}>
          <div style={{ width: '12px', height: '2px', borderTop: '2px dashed #f87171' }} />
          <span style={{ color: '#f87171' }}>Historical Max</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '2px', borderTop: '2px dashed #34d399' }} />
          <span style={{ color: '#34d399' }}>Historical Min</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '2px', borderTop: '2px dashed #fbbf24' }} />
          <span style={{ color: '#fbbf24' }}>Historical Avg</span>
        </div>
      </div>
    </div>
  );
}
