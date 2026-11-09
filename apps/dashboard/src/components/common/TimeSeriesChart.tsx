import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { XY } from './forecast';
import { getUtcHourSession, UTC_TRADING_SESSIONS, type UtcTradingSessionInfo } from '../finops/priceHistory';

export interface ChartSeries {
  name: string;
  color: string;
  points: XY[];
  dashed?: boolean;
}

export interface SessionBandSegment {
  startX: number;
  endX: number;
  session: UtcTradingSessionInfo;
}

/**
 * Splits a [minX, maxX] epoch-ms interval into contiguous UTC trading session bands
 * (ASIA 00-08 UTC, EU 08-15 UTC, USA 15-22 UTC, OFF-PEAK 22-24 UTC).
 */
export function buildTimestampSessionBands(minX: number, maxX: number): SessionBandSegment[] {
  if (!(maxX > minX)) return [];
  const HOUR_MS = 3_600_000;
  // Cap at 600 hour steps (~25 days) so wide ranges remain fast
  if ((maxX - minX) / HOUR_MS > 600) return [];

  const segments: SessionBandSegment[] = [];
  let cursor = minX;

  while (cursor < maxX) {
    const d = new Date(cursor);
    const hourUtc = d.getUTCHours();
    const session = getUtcHourSession(hourUtc);
    const nextBoundaryDate = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), session.endHour, 0, 0, 0)
    );
    let nextMs = nextBoundaryDate.getTime();
    if (nextMs <= cursor) {
      nextMs = cursor + HOUR_MS;
    }
    const endX = Math.min(maxX, nextMs);
    const prev = segments[segments.length - 1];
    if (prev && prev.session.id === session.id) {
      prev.endX = endX;
    } else {
      segments.push({ startX: cursor, endX, session });
    }
    cursor = endX;
  }

  return segments;
}

export interface ZoomBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Computes zoomed viewport bounds, automatically scaling Y to the peak and trough of
 * visible data points in the selected X interval.
 */
export function computeZoomBounds(
  allPoints: XY[],
  selMinX: number,
  selMaxX: number,
  sessionMode?: 'timestamp' | 'utc_hour',
  customY?: { minY: number; maxY: number }
): ZoomBounds {
  if (customY) {
    return { minX: selMinX, maxX: selMaxX, minY: customY.minY, maxY: customY.maxY };
  }
  const visible = allPoints.filter((p) => p.x >= selMinX && p.x <= selMaxX);
  if (visible.length === 0) {
    return { minX: selMinX, maxX: selMaxX, minY: 0, maxY: 1 };
  }
  const ys = visible.map((p) => p.y);
  const rawMin = Math.min(...ys);
  const rawMax = Math.max(...ys);
  const minY = sessionMode ? Math.max(0, rawMin * 0.9) : Math.min(0, rawMin);
  const maxY = rawMax === rawMin ? rawMin + 1 : rawMax * 1.1;
  return { minX: selMinX, maxX: selMaxX, minY, maxY };
}

interface DragState {
  startPx: number;
  startPy: number;
  curPx: number;
  curPy: number;
}

interface TimeSeriesChartProps {
  series: ChartSeries[];
  xFormat: (x: number, spanMs?: number) => string;
  yFormat: (y: number) => string;
  height?: number;
  emptyMessage?: string;
  /** Optional market timeframe overlay ('timestamp' for epoch-ms history, 'utc_hour' for 0..23 UTC profile). */
  sessionMode?: 'timestamp' | 'utc_hour';
  /** Optional external callback triggered on zoom change */
  onZoomChange?: (zoom: ZoomBounds | null) => void;
}

const W = 1100;

/**
 * Computes X-axis tick positions aligned to actual plotted values.
 * Returns each plotted value if space allows, or downsamples to as many as zoom/spacing allows.
 */
export function computePlottedXTicks(
  visiblePlottedXs: number[],
  minX: number,
  maxX: number,
  scaleX: (x: number) => number,
  formatX: (x: number, spanMs?: number) => string,
  sessionMode?: 'timestamp' | 'utc_hour',
  isZoomed?: boolean
): number[] {
  if (visiblePlottedXs.length === 0) {
    if (sessionMode === 'utc_hour' && !isZoomed) {
      return [0, 4, 8, 12, 15, 18, 22];
    }
    return [0, 0.25, 0.5, 0.75, 1].map((f) => minX + f * (maxX - minX));
  }

  // Determine sample label width to set minimum comfortable pixel spacing
  const sampleLabel = formatX(visiblePlottedXs[0], maxX - minX);
  const minSpacingPx = sampleLabel.length > 7 ? 72 : 52;

  // Check if ALL visible plotted values can be displayed without colliding
  let canFitAll = true;
  for (let i = 1; i < visiblePlottedXs.length; i++) {
    if (scaleX(visiblePlottedXs[i]) - scaleX(visiblePlottedXs[i - 1]) < minSpacingPx) {
      canFitAll = false;
      break;
    }
  }

  if (canFitAll) {
    return visiblePlottedXs;
  }

  // When there are more plotted values than can fit, greedily pick as many plotted values as zoom allows
  const selected: number[] = [];
  let lastPx = -Infinity;

  for (let i = 0; i < visiblePlottedXs.length; i++) {
    const x = visiblePlottedXs[i];
    const px = scaleX(x);
    if (px - lastPx >= minSpacingPx) {
      selected.push(x);
      lastPx = px;
    }
  }

  // Ensure the last plotted value in the visible window is displayed if space allows
  if (visiblePlottedXs.length > 1) {
    const lastX = visiblePlottedXs[visiblePlottedXs.length - 1];
    const lastPx = scaleX(lastX);
    if (selected.length > 0) {
      const prevPx = scaleX(selected[selected.length - 1]);
      if (lastPx - prevPx >= minSpacingPx * 0.75) {
        if (selected[selected.length - 1] !== lastX) {
          selected.push(lastX);
        }
      } else if (selected.length > 1) {
        selected[selected.length - 1] = lastX;
      }
    }
  }

  return selected;
}

export function TimeSeriesChart({
  series,
  xFormat,
  yFormat,
  height = 240,
  emptyMessage,
  sessionMode,
  onZoomChange,
}: TimeSeriesChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoomRange, setZoomRange] = useState<ZoomBounds | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const all = useMemo(() => series.flatMap((s) => s.points), [series]);

  // Reset zoom whenever series or sessionMode identity changes
  useEffect(() => {
    setZoomRange(null);
    onZoomChange?.(null);
  }, [series, sessionMode, onZoomChange]);

  const PAD = { top: sessionMode ? 26 : 14, right: 58, bottom: 28, left: 68 };
  const cw = W - PAD.left - PAD.right;
  const ch = height - PAD.top - PAD.bottom;

  // Base (unzoomed) bounds
  const baseBounds = useMemo(() => {
    if (all.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1, avgY: 0, lowY: 0 };
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    const minX = sessionMode === 'utc_hour' ? 0 : Math.min(...xs);
    const maxX = sessionMode === 'utc_hour' ? 23 : Math.max(...xs);
    const rawMinY = Math.min(...ys);
    const rawMaxY = Math.max(...ys);
    const minY = sessionMode ? Math.max(0, rawMinY * 0.88) : Math.min(0, rawMinY);
    const maxY = rawMaxY === minY ? minY + 1 : rawMaxY * 1.08;
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    return { minX, maxX, minY, maxY, avgY, lowY: rawMinY };
  }, [all, sessionMode]);

  // Active bounds (either zoomed or base)
  const minX = zoomRange?.minX ?? baseBounds.minX;
  const maxX = zoomRange?.maxX ?? baseBounds.maxX;
  const minY = zoomRange?.minY ?? baseBounds.minY;
  const maxY = zoomRange?.maxY ?? baseBounds.maxY;

  // Coordinate scales
  const sx = useCallback(
    (x: number) => PAD.left + (maxX === minX ? cw / 2 : ((x - minX) / (maxX - minX)) * cw),
    [minX, maxX, PAD.left, cw]
  );
  const sy = useCallback(
    (y: number) => PAD.top + ch - (maxY === minY ? ch / 2 : ((y - minY) / (maxY - minY)) * ch),
    [minY, maxY, PAD.top, ch]
  );

  // Inverted horizontal scale (SVG pixel -> data domain X)
  const invertX = useCallback(
    (px: number) => {
      const clampedPx = Math.max(PAD.left, Math.min(W - PAD.right, px));
      return minX + ((clampedPx - PAD.left) / cw) * (maxX - minX);
    },
    [minX, maxX, PAD.left, cw]
  );

  // Convert mouse event to exact SVG coordinates
  const getSvgPoint = useCallback(
    (e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const transformed = pt.matrixTransform(ctm.inverse());
        return { x: transformed.x, y: transformed.y };
      }
      const rect = svg.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * W,
        y: ((e.clientY - rect.top) / rect.height) * height,
      };
    },
    [height]
  );

  // Mouse handlers for drag-to-zoom
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // Only left click triggers drag zoom
    if (e.button !== 0 || all.length === 0) return;
    const { x, y } = getSvgPoint(e);
    // Ignore clicks outside the chart plot area
    if (x < PAD.left - 10 || x > W - PAD.right + 10 || y < PAD.top - 10 || y > PAD.top + ch + 10) return;
    setDragState({
      startPx: Math.max(PAD.left, Math.min(W - PAD.right, x)),
      startPy: Math.max(PAD.top, Math.min(PAD.top + ch, y)),
      curPx: Math.max(PAD.left, Math.min(W - PAD.right, x)),
      curPy: Math.max(PAD.top, Math.min(PAD.top + ch, y)),
    });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragState) return;
    const { x, y } = getSvgPoint(e);
    setDragState((prev) =>
      prev
        ? {
            ...prev,
            curPx: Math.max(PAD.left, Math.min(W - PAD.right, x)),
            curPy: Math.max(PAD.top, Math.min(PAD.top + ch, y)),
          }
        : null
    );
  };

  const finishDragZoom = () => {
    if (!dragState) return;
    const dx = Math.abs(dragState.curPx - dragState.startPx);

    // Minimum drag threshold: 10 pixels to prevent accidental single clicks
    if (dx >= 10) {
      const x1 = invertX(dragState.startPx);
      const x2 = invertX(dragState.curPx);
      const selMinX = Math.min(x1, x2);
      const selMaxX = Math.max(x1, x2);

      const newZoom = computeZoomBounds(all, selMinX, selMaxX, sessionMode);
      setZoomRange(newZoom);
      onZoomChange?.(newZoom);
    }

    setDragState(null);
  };

  const handleResetZoom = () => {
    setZoomRange(null);
    setDragState(null);
    onZoomChange?.(null);
  };

  if (all.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
        {emptyMessage ?? 'No data yet.'}
      </div>
    );
  }

  const isZoomed = zoomRange !== null;

  // Trading sessions for active window
  const sessionBands: SessionBandSegment[] =
    sessionMode === 'timestamp'
      ? buildTimestampSessionBands(minX, maxX)
      : sessionMode === 'utc_hour'
        ? UTC_TRADING_SESSIONS.map((s) => ({
            startX: s.startHour,
            endX: Math.min(23, s.endHour),
            session: s,
          }))
        : [];

  // Metrics for active view
  const visiblePoints = all.filter((p) => p.x >= minX && p.x <= maxX);
  const activeYs = visiblePoints.length > 0 ? visiblePoints.map((p) => p.y) : all.map((p) => p.y);
  const avgY = activeYs.reduce((a, b) => a + b, 0) / activeYs.length;
  const lowY = Math.min(...activeYs);
  const peakY = Math.max(...activeYs);

  // Visible unique plotted X coordinates (sorted chronologically)
  const visiblePlottedXs = useMemo(() => {
    const pts = all.filter((p) => p.x >= minX - 1e-4 && p.x <= maxX + 1e-4);
    if (pts.length === 0) return [];
    return Array.from(new Set(pts.map((p) => p.x))).sort((a, b) => a - b);
  }, [all, minX, maxX]);

  // Compute X-axis tick positions: show each plotted value, or as many as zoom / horizontal space allows
  const xTicks = useMemo(
    () => computePlottedXTicks(visiblePlottedXs, minX, maxX, sx, xFormat, sessionMode, isZoomed),
    [visiblePlottedXs, minX, maxX, sx, xFormat, sessionMode, isZoomed]
  );

  // Selection overlay preview coordinates (horizontal time-range zoom)
  const selOverlay = dragState && Math.abs(dragState.curPx - dragState.startPx) > 3 ? {
    x: Math.min(dragState.startPx, dragState.curPx),
    y: PAD.top,
    width: Math.abs(dragState.curPx - dragState.startPx),
    height: ch,
    previewMinX: Math.min(invertX(dragState.startPx), invertX(dragState.curPx)),
    previewMaxX: Math.max(invertX(dragState.startPx), invertX(dragState.curPx)),
  } : null;

  return (
    <div style={{ position: 'relative' }}>
      {/* Zoom Control & Peak Analysis Header Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '10px',
          padding: '6px 10px',
          marginBottom: '6px',
          borderRadius: '6px',
          backgroundColor: isZoomed ? 'rgba(56, 189, 248, 0.08)' : 'rgba(15, 23, 42, 0.5)',
          border: `1px solid ${isZoomed ? '#0284c7' : '#1e293b'}`,
          fontSize: '11px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {isZoomed ? (
            <>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: '#0369a1',
                  color: '#ffffff',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10.5px',
                  letterSpacing: '0.02em',
                }}
              >
                🔍 Zoomed: {xFormat(minX, maxX - minX)} – {xFormat(maxX, maxX - minX)}
              </span>
              <span style={{ color: '#94a3b8' }}>
                Peak in range: <strong style={{ color: '#38bdf8' }}>{yFormat(peakY)}</strong> · Low: <strong style={{ color: '#34d399' }}>{yFormat(lowY)}</strong>
              </span>
            </>
          ) : (
            <span style={{ color: '#64748b', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span>👆</span>
              <span>
                <strong>Click and drag horizontally</strong> across any time range to zoom in • Double-click or click Reset Zoom to restore
              </span>
            </span>
          )}
        </div>

        {/* Reset Zoom Button */}
        {isZoomed && (
          <button
            type="button"
            onClick={handleResetZoom}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              padding: '3px 10px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              transition: 'background-color 0.15s ease',
            }}
            title="Reset chart zoom to full historical view"
          >
            <span>↺</span>
            <span>Reset Zoom</span>
          </button>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          cursor: dragState ? 'crosshair' : 'ew-resize',
          userSelect: 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={finishDragZoom}
        onMouseLeave={finishDragZoom}
        onDoubleClick={handleResetZoom}
      >
        {/* Trading Session Timeframe Reference Bands (ASIA / EU / USA / OFF-PEAK) */}
        {sessionBands.map((band, i) => {
          const x1 = sx(band.startX);
          const x2 = sx(band.endX);
          const w = Math.max(0, x2 - x1);
          return (
            <g key={`band-${i}`}>
              <rect x={x1} y={PAD.top} width={w} height={ch} fill={band.session.bgColor} />
              {i > 0 && (
                <line
                  x1={x1}
                  x2={x1}
                  y1={PAD.top}
                  y2={PAD.top + ch}
                  stroke={band.session.borderColor}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              )}
              {w >= 38 && (
                <text
                  x={x1 + w / 2}
                  y={PAD.top - 7}
                  textAnchor="middle"
                  fill={band.session.textColor}
                  fontSize="9.5"
                  fontWeight="700"
                  fontFamily="monospace"
                >
                  {band.session.flag} {band.session.shortLabel}
                </text>
              )}
            </g>
          );
        })}

        {/* Horizontal Y gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = minY + f * (maxY - minY);
          return (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} stroke="#1e293b" strokeDasharray="4 4" />
              <text x={PAD.left - 6} y={sy(v) + 3} textAnchor="end" fill="#64748b" fontSize="10" fontFamily="monospace">
                {yFormat(v)}
              </text>
            </g>
          );
        })}

        {/* Trading-style Market Reference Lines (AVG & Support LOW) when sessionMode is active */}
        {sessionMode && activeYs.length > 1 && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(avgY)}
              y2={sy(avgY)}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="5 4"
              opacity={0.65}
            />
            <text
              x={W - PAD.right + 4}
              y={sy(avgY) + 3}
              fill="#94a3b8"
              fontSize="9"
              fontWeight="700"
              fontFamily="monospace"
            >
              AVG
            </text>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={sy(lowY)}
              y2={sy(lowY)}
              stroke="#34d399"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.75}
            />
            <text
              x={W - PAD.right + 4}
              y={sy(lowY) + 3}
              fill="#34d399"
              fontSize="9"
              fontWeight="700"
              fontFamily="monospace"
            >
              LOW
            </text>
          </g>
        )}

        {/* X axis labels & ticks aligned to plotted values */}
        {xTicks.map((x, idx) => {
          const px = sx(x);
          return (
            <g key={`xtick-${idx}-${x}`}>
              <line
                x1={px}
                x2={px}
                y1={PAD.top + ch}
                y2={PAD.top + ch + 4}
                stroke="#334155"
                strokeWidth={1}
              />
              <text
                x={px}
                y={height - 8}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="10"
                fontFamily="monospace"
              >
                {xFormat(x, maxX - minX)}
              </text>
            </g>
          );
        })}

        {/* Data series */}
        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x);
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x)} ${sy(p.y)}`).join(' ');

          // When zoomed or when points count is <= 70, render interactive data point circles
          const visiblePts = pts.filter((p) => p.x >= minX - 0.001 && p.x <= maxX + 0.001);
          const showDots = !s.dashed && (visiblePts.length <= 70 || pts.length <= 60);

          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '6 4' : undefined} />
              {showDots &&
                visiblePts.map((p, i) => {
                  const isPeak = Math.abs(p.y - peakY) < 1e-6;
                  return (
                    <circle
                      key={i}
                      cx={sx(p.x)}
                      cy={sy(p.y)}
                      r={isPeak ? 4 : 2.5}
                      fill={isPeak ? '#38bdf8' : '#0f172a'}
                      stroke={isPeak ? '#ffffff' : s.color}
                      strokeWidth={isPeak ? 2 : 1.5}
                    >
                      <title>{`${s.name} · ${xFormat(p.x, maxX - minX)} · ${yFormat(p.y)}${isPeak ? ' (PEAK)' : ''}`}</title>
                    </circle>
                  );
                })}
            </g>
          );
        })}

        {/* Mouse Drag Selection Highlight Overlay */}
        {selOverlay && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={selOverlay.x}
              y={selOverlay.y}
              width={selOverlay.width}
              height={selOverlay.height}
              fill="rgba(56, 189, 248, 0.22)"
              stroke="#38bdf8"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
            {/* Left and right guide lines */}
            <line
              x1={selOverlay.x}
              x2={selOverlay.x}
              y1={PAD.top}
              y2={PAD.top + ch}
              stroke="#38bdf8"
              strokeWidth={1}
            />
            <line
              x1={selOverlay.x + selOverlay.width}
              x2={selOverlay.x + selOverlay.width}
              y1={PAD.top}
              y2={PAD.top + ch}
              stroke="#38bdf8"
              strokeWidth={1}
            />
            {/* Floating Selection Range Tooltip */}
            <g transform={`translate(${selOverlay.x + selOverlay.width / 2}, ${Math.max(PAD.top + 18, selOverlay.y + 12)})`}>
              <rect
                x={-90}
                y={-14}
                width={180}
                height={20}
                rx={4}
                fill="#0f172a"
                stroke="#38bdf8"
                strokeWidth={1}
                opacity={0.95}
              />
              <text
                x={0}
                y={0}
                textAnchor="middle"
                fill="#ffffff"
                fontSize="9.5"
                fontWeight="700"
                fontFamily="monospace"
              >
                Release to Zoom Peak
              </text>
            </g>
          </g>
        )}
      </svg>

      {/* Series & Trading Session Reference Legend */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          padding: '4px 10px 6px',
          fontSize: '11px',
          color: '#cbd5e1',
        }}
      >
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {series.map((s) => (
            <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ width: '14px', borderTop: `2px ${s.dashed ? 'dashed' : 'solid'} ${s.color}` }} />
              {s.name}
            </span>
          ))}
        </div>
        {sessionMode && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '10px' }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Market Windows:</span>
            {UTC_TRADING_SESSIONS.map((s) => (
              <span
                key={s.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  backgroundColor: s.bgColor,
                  border: `1px solid ${s.borderColor}`,
                  color: s.textColor,
                  fontWeight: 600,
                }}
              >
                {s.flag} {s.shortLabel} ({s.hoursLabel.replace(':00', '').replace(':00', '')})
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
