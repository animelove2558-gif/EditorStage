// Curve editor math: control points -> 256-entry lookup (monotone cubic interpolation)
export const defaultCurves = () => ({ master: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]], hs: [[0, 0.5], [1, 0.5]] });
export const isDefaultCurves = (c) => !c || Object.entries(defaultCurves()).every(([k, v]) => JSON.stringify(v) === JSON.stringify(c[k] || v));
export function curveLUT(points) {
  const p = [...points].sort((a, b) => a[0] - b[0]); const n = p.length; const out = new Float32Array(256);
  if (n < 2) return out.fill(0.5);
  const dx = [], m = [], tan = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { dx[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]); m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  tan[0] = m[0]; tan[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (m[i] === 0) { tan[i] = tan[i + 1] = 0; continue; } const a = tan[i] / m[i], b = tan[i + 1] / m[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); tan[i] = t * a * m[i]; tan[i + 1] = t * b * m[i]; } }
  for (let k = 0; k < 256; k++) {
    const x = k / 255; let i = 0; while (i < n - 2 && x > p[i + 1][0]) i++;
    if (x <= p[0][0]) { out[k] = p[0][1]; continue; } if (x >= p[n - 1][0]) { out[k] = p[n - 1][1]; continue; }
    const t = (x - p[i][0]) / dx[i], t2 = t * t, t3 = t2 * t;
    out[k] = Math.min(1, Math.max(0, (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * dx[i] * tan[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * dx[i] * tan[i + 1]));
  }
  return out;
}
export function curvesTextureData(c) { const d = new Uint8Array(256 * 5 * 4); ['master', 'r', 'g', 'b', 'hs'].forEach((k, row) => { const l = curveLUT((c && c[k]) || [[0, 0], [1, 1]]); for (let i = 0; i < 256; i++) { const o = (row * 256 + i) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(l[i] * 255); d[o + 3] = 255; } }); return d; }
