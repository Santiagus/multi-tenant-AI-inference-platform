import { useState, useMemo } from 'react';
import type { PricingHistorySummary } from '../../types';

interface HistoricalPriceChartProps {
  summaries: PricingHistorySummary[];
}

export function HistoricalPriceChart({ summaries }: HistoricalPriceChartProps) {
  const [selectedItemId, setSelectedItemId] = useState<string>(
    summaries[0]?.itemId || 'nvidia-h100-sxm'
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const activeSummary = useMemo(() => {
    return summaries.find((s) => s.itemId === selectedItemId) || summaries[0];
  }, [summaries, selectedItemId]);

  const history = activeSummary?.history || [];

  // Calculate Max, Min, Avg
  const stats = useMemo(() => {
    if (history.length === 0) return { max: 0, min: 0, avg: 0, spotMin: 0, spotMax: 0 };
    const allPrices = history.map((h) => h.priceUsd);
    const spotPrices = history.filter((h) => h.spotPriceUsd !== undefined).map((h) => h.spotPriceUsd!);

    const max = Math.max(...allPrices);
    const min = Math.min(...allPrices);
    const avg = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;

    const spotMin = spotPrices.length > 0 ? Math.min(...spotPrices) : 0;
    const spotMax = spotPrices.length > 0 ? Math.max(...spotPrices) : 0;

    return { max, min, avg, spotMin, spotMax };
  }, [history]);

  // SVG dimensions
  const width = 860;
  const height = 300;
  const padding = { top: 30, right: 90, bottom: 40, left: 60 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Scale calculations
  const { minVal, maxVal } = useMemo(() => {
    const allVals = [
      ...history.map((h) => h.priceUsd),
      ...history.filter((h) => h.spotPriceUsd !== undefined).map((h) => h.spotPriceUsd!),
    ];
    if (allVals.length === 0) return { minVal: 0, maxVal: 5 };
    const rawMin = Math.min(...allVals);
    const rawMax = Math.max(...allVals);
    const buffer = (rawMax - rawMin) * 0.18 || 0.2;
    return {
      minVal: Math.max(0, Number((rawMin - buffer).toFixed(2))),
      maxVal: Number((rawMax + buffer).toFixed(2)),
    };
  }, [history]);

  const getY = (val: number) => {
    if (maxVal === minVal) return padding.top + chartHeight / 2;
    return padding.top + chartHeight - ((val - minVal) / (maxVal - minVal)) * chartHeight;
  };

  const getX = (index: number) => {
    if (history.length <= 1) return padding.left + chartWidth / 2;
    return padding.left + (index / (history.length - 1)) * chartWidth;
  };

  // Generate SVG path strings
  const onDemandPath = useMemo(() => {
    if (history.length === 0) return '';
    return history
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.priceUsd)}`)
      .join(' ');
  }, [history, minVal, maxVal]);

  const spotPath = useMemo(() => {
    const spotPoints = history
      .map((pt, i) => (pt.spotPriceUsd !== undefined ? { x: getX(i), y: getY(pt.spotPriceUsd) } : null))
      .filter(Boolean) as Array<{ x: number; y: number }>;

    if (spotPoints.length === 0) return '';
    return spotPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ');
  }, [history, minVal, maxVal]);

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
          marginBottom: '20px',
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
              7-Day Trend Series
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '13px', margin: '4px 0 0 0' }}>
            Plots spot auction and on-demand pricing with Min / Max / Average baseline reference markers.
          </p>
        </div>

        {/* Item Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500 }}>Select Hardware / Model:</label>
          <select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
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
            {summaries.map((s) => (
              <option key={s.itemId} value={s.itemId}>
                {s.displayName} ({s.provider.toUpperCase()})
              </option>
            ))}
          </select>
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

      {/* SVG Line Graph Container */}
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
          {/* Horizontal Grid lines */}
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
                strokeWidth="1.5"
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
                strokeWidth="1.5"
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
                strokeWidth="1.5"
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

          {/* On-Demand Line (Blue) */}
          {onDemandPath && (
            <path
              d={onDemandPath}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Spot Line (Green) */}
          {spotPath && (
            <path
              d={spotPath}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data Points and Tooltips */}
          {history.map((pt, i) => {
            const cx = getX(i);
            const cy = getY(pt.priceUsd);
            const spotCy = pt.spotPriceUsd !== undefined ? getY(pt.spotPriceUsd) : null;
            const isHovered = hoveredIndex === i;

            return (
              <g key={i}>
                {/* On demand point */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 6 : 4}
                  fill="#0f172a"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />

                {/* Spot point */}
                {spotCy !== null && (
                  <circle
                    cx={cx}
                    cy={spotCy}
                    r={isHovered ? 6 : 4}
                    fill="#0f172a"
                    stroke="#10b981"
                    strokeWidth="2"
                    style={{ cursor: 'pointer', transition: 'r 0.15s ease' }}
                    onMouseEnter={() => setHoveredIndex(i)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  />
                )}

                {/* X-axis date labels */}
                {(i === 0 || i === Math.floor(history.length / 2) || i === history.length - 1) && (
                  <text
                    x={cx}
                    y={height - padding.bottom + 20}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                  >
                    {new Date(pt.recordedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit' })}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Hover Information Banner */}
        {hoveredIndex !== null && history[hoveredIndex] && (
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#1e293b',
              border: '1px solid #38bdf8',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '12px',
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <span style={{ color: '#94a3b8' }}>
              {new Date(history[hoveredIndex].recordedAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span style={{ color: '#38bdf8', fontWeight: 700 }}>
              On-Demand: ${history[hoveredIndex].priceUsd.toFixed(2)}/hr
            </span>
            {history[hoveredIndex].spotPriceUsd !== undefined && (
              <span style={{ color: '#34d399', fontWeight: 700 }}>
                Spot Bid: ${history[hoveredIndex].spotPriceUsd!.toFixed(2)}/hr
              </span>
            )}
          </div>
        )}
      </div>

      {/* Chart Legend */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '20px',
          marginTop: '14px',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '3px', backgroundColor: '#38bdf8', borderRadius: '2px' }} />
          <span style={{ color: '#cbd5e1' }}>On-Demand Rate</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '3px', backgroundColor: '#10b981', borderRadius: '2px' }} />
          <span style={{ color: '#cbd5e1' }}>Spot / Auction Rate</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '2px', borderTop: '2px dashed #f87171' }} />
          <span style={{ color: '#f87171' }}>Historical Max</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '2px', borderTop: '2px dashed #34d399' }} />
          <span style={{ color: '#34d399' }}>Historical Min</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '12px', height: '2px', borderTop: '2px dashed #fbbf24' }} />
          <span style={{ color: '#fbbf24' }}>Historical Average</span>
        </div>
      </div>
    </div>
  );
}

