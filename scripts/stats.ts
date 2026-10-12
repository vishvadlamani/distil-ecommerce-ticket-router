/** Wilson score interval for a binomial proportion (95% by default), as
 * distil labs' posts report correct-of-n. Returns proportions in [0, 1]. */
export function wilson(k: number, n: number, z = 1.959964): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: 0, lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export const fmtPct = (x: number, d = 1) => `${(100 * x).toFixed(d)}%`;

/** "43/64 = 67.2% [55.0, 77.4]" */
export function fmtCorrect(k: number, n: number): string {
  const w = wilson(k, n);
  return `${k}/${n} = ${fmtPct(w.p)} [${(100 * w.lo).toFixed(1)}, ${(100 * w.hi).toFixed(1)}]`;
}

export function pctile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
