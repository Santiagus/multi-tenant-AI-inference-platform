export interface XY {
  x: number;
  y: number;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /** Coefficient of determination in [0, 1]; 0 when undefined. */
  r2: number;
}

/** Ordinary least squares fit. Returns null with fewer than 2 distinct x values. */
export function linearFit(points: XY[]): LinearFit | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/** Projects the fit across `steps` evenly spaced x values from lastX to lastX + horizon. */
export function projectLinear(fit: LinearFit, lastX: number, horizon: number, steps = 12): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = lastX + (horizon * i) / steps;
    out.push({ x, y: Math.max(0, fit.slope * x + fit.intercept) });
  }
  return out;
}
