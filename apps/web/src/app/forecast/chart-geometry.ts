/**
 * Plain geometry for the hand-built SVG charts. Money becomes a JS number here
 * and only here — for pixel positions, never for arithmetic on amounts
 * (ADR-012). Every exact value is shown from the Money strings themselves.
 */

/** Round tick values spanning [min, max], always including 0. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (lo === hi) return [0, 1];
  const raw = (hi - lo) / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < hi) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export interface Scale {
  (value: number): number;
  domain: [number, number];
}

/** Linear scale mapping [d0, d1] onto [r0, r1]. */
export function linear(d0: number, d1: number, r0: number, r1: number): Scale {
  const f = ((v: number) => (d1 === d0 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0))) as Scale;
  f.domain = [d0, d1];
  return f;
}

/**
 * A column growing up from `base` with a 4px rounded data-end and a square
 * foot. Zero-height columns draw nothing.
 */
export function columnPath(x: number, width: number, top: number, base: number, radius = 4): string {
  const h = base - top;
  if (h <= 0) return '';
  const r = Math.min(radius, width / 2, h);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

export function linePath(points: [number, number][]): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)},${round(y)}`).join('');
}

/** True when every pair of end-label positions is at least `gap` apart — otherwise use the legend alone. */
export function labelsFit(ys: number[], gap: number): boolean {
  const sorted = [...ys].sort((a, b) => a - b);
  return sorted.every((y, i) => i === 0 || y - sorted[i - 1] >= gap);
}

const round = (n: number) => Math.round(n * 10) / 10;
