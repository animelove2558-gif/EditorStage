// Paint Bucket's region: a scanline flood fill over RGBA pixels from the fill point (After Effects' Fill Selector modes).
// Returns a w*h Uint8Array, 255 inside the connected region, in the same row order as `px`.
export const FILL_SELECTORS = ['Color & Alpha', 'Straight Color', 'Transparency', 'Opacity', 'Alpha Channel'];

export function floodFill(px, w, h, x0, y0, selector = 0, tol = 10) {
  const m = new Uint8Array(w * h);
  if (!(x0 >= 0 && y0 >= 0 && x0 < w && y0 < h)) return m;
  const i0 = (y0 * w + x0) * 4; const R = px[i0], G = px[i0 + 1], B = px[i0 + 2], A = px[i0 + 3];
  const d = (i, c, v) => Math.abs(px[i + c] - v);
  const match = [
    (i) => Math.max(d(i, 0, R), d(i, 1, G), d(i, 2, B), d(i, 3, A)) <= tol,
    (i) => Math.max(d(i, 0, R), d(i, 1, G), d(i, 2, B)) <= tol,
    (i) => px[i + 3] <= tol,
    (i) => px[i + 3] >= 255 - tol,
    (i) => d(i, 3, A) <= tol,
  ][selector] || (() => false);
  if (!match(i0)) return m;
  const ok = (x, y) => { const p = y * w + x; return m[p] === 0 && match(p * 4); };
  const stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(); if (!ok(x, y)) continue;
    let l = x; while (l > 0 && ok(l - 1, y)) l--;
    let r = x; while (r < w - 1 && ok(r + 1, y)) r++;
    m.fill(255, y * w + l, y * w + r + 1);
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      let prev = false;
      for (let i = l; i <= r; i++) { const k = ok(i, ny); if (k && !prev) stack.push(i, ny); prev = k; }
    }
  }
  return m;
}
