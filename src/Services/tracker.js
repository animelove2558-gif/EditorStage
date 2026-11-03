// Object tracking for Mask Tracking and the Point Tracker (runs in the DSP worker; pure functions, also used by the tests).
// Features (Shi-Tomasi corners) inside the region are followed frame to frame with pyramidal Lucas-Kanade and a
// forward-backward check; a robust similarity transform (start frame -> frame k) is fitted to the surviving points.
// When too many points are lost, new features are seeded inside the region where the transform currently puts it.

const LEVELS = 3, HALF = 7, ITERS = 12;

/** Gray8 frame -> Float32 pyramid [{ d, w, h }] (each level half the size, 2x2 box). */
export function pyramid(gray, w, h, levels = LEVELS) {
  const out = [{ d: Float32Array.from(gray), w, h }];
  for (let l = 1; l < levels; l++) {
    const p = out[l - 1]; const nw = Math.max(1, p.w >> 1), nh = Math.max(1, p.h >> 1); const d = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const i = 2 * y * p.w + 2 * x; d[y * nw + x] = (p.d[i] + p.d[i + 1] + p.d[i + p.w] + p.d[i + p.w + 1]) / 4; }
    out.push({ d, w: nw, h: nh });
  }
  return out;
}
const sample = (im, x, y) => {
  x = Math.min(im.w - 1.001, Math.max(0, x)); y = Math.min(im.h - 1.001, Math.max(0, y));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * im.w + x0; const d = im.d;
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + im.w] * (1 - fx) + d[i + im.w + 1] * fx) * fy;
};

/** Track one point from pyramid A to pyramid B. Returns [x, y, err] or null when it is lost. */
export function lkPoint(A, B, x, y, guess = [0, 0]) {
  let gx = guess[0] / (1 << (A.length - 1)), gy = guess[1] / (1 << (A.length - 1));
  for (let l = A.length - 1; l >= 0; l--) {
    const a = A[l], b = B[l]; const s = 1 / (1 << l); const px = x * s, py = y * s;
    let gxx = 0, gxy = 0, gyy = 0; const n = (2 * HALF + 1) ** 2; const IX = new Float32Array(n), IY = new Float32Array(n), IA = new Float32Array(n);
    let k = 0;
    for (let j = -HALF; j <= HALF; j++) for (let i = -HALF; i <= HALF; i++, k++) {
      const ix = (sample(a, px + i + 1, py + j) - sample(a, px + i - 1, py + j)) / 2, iy = (sample(a, px + i, py + j + 1) - sample(a, px + i, py + j - 1)) / 2;
      IX[k] = ix; IY[k] = iy; IA[k] = sample(a, px + i, py + j); gxx += ix * ix; gxy += ix * iy; gyy += iy * iy;
    }
    const det = gxx * gyy - gxy * gxy; if (det < 1e-6) return null;
    let vx = 0, vy = 0;
    for (let it = 0; it < ITERS; it++) {
      let bx = 0, by = 0; k = 0;
      for (let j = -HALF; j <= HALF; j++) for (let i = -HALF; i <= HALF; i++, k++) { const dI = IA[k] - sample(b, px + i + gx + vx, py + j + gy + vy); bx += dI * IX[k]; by += dI * IY[k]; }
      const dx = (gyy * bx - gxy * by) / det, dy = (gxx * by - gxy * bx) / det; vx += dx; vy += dy;
      if (dx * dx + dy * dy < 1e-4) break;
    }
    gx += vx; gy += vy; if (l > 0) { gx *= 2; gy *= 2; }
  }
  const nx = x + gx, ny = y + gy; const b = B[0], a = A[0];
  if (nx < 0 || ny < 0 || nx > b.w - 1 || ny > b.h - 1) return null;
  let err = 0; for (let j = -HALF; j <= HALF; j += 2) for (let i = -HALF; i <= HALF; i += 2) err += Math.abs(sample(a, x + i, y + j) - sample(b, nx + i, ny + j));
  return [nx, ny, err / 64];
}

/** Shi-Tomasi corners inside `inside(x, y)` (level-0 pixels): up to `max` points at least `gap` px apart. */
export function goodFeatures(im, inside, box, max = 80, gap = 5) {
  const [x0, y0, x1, y1] = box.map(Math.round); const cand = [];
  for (let y = Math.max(2, y0); y <= Math.min(im.h - 3, y1); y += 2) for (let x = Math.max(2, x0); x <= Math.min(im.w - 3, x1); x += 2) {
    if (!inside(x, y)) continue; let a = 0, b = 0, c = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const p = (y + j) * im.w + x + i; const ix = (im.d[p + 1] - im.d[p - 1]) / 2, iy = (im.d[p + im.w] - im.d[p - im.w]) / 2; a += ix * ix; b += ix * iy; c += iy * iy; }
    const lmin = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b); if (lmin > 4) cand.push([x, y, lmin]);
  }
  cand.sort((p, q) => q[2] - p[2]); const out = [];
  for (const p of cand) { if (out.length >= max) break; if (out.every((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 >= gap * gap)) out.push([p[0], p[1]]); }
  return out;
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
/** Robust similarity p -> q. mode: 'position' | 'rotation' (position & rotation) | 'full' (position, scale & rotation). Returns { a, b, tx, ty } with q = [a -b; b a] p + t. */
export function fitSimilarity(P, Q, mode = 'full') {
  const n = P.length; if (!n) return null;
  let a = 1, b = 0;
  if (mode !== 'position' && n >= 3) {
    // rotation / scale from pairs of points (median: robust to outliers)
    const angs = [], scs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < Math.min(n, i + 12); j++) {
      const px = P[j][0] - P[i][0], py = P[j][1] - P[i][1], qx = Q[j][0] - Q[i][0], qy = Q[j][1] - Q[i][1]; const lp = Math.hypot(px, py), lq = Math.hypot(qx, qy);
      if (lp < 4) continue; let d = Math.atan2(qy, qx) - Math.atan2(py, px); d = Math.atan2(Math.sin(d), Math.cos(d)); angs.push(d); scs.push(lq / lp);
    }
    if (angs.length) { const r = median(angs), s = mode === 'full' ? median(scs) : 1; a = s * Math.cos(r); b = s * Math.sin(r); }
  }
  const tx = median(P.map((p, i) => Q[i][0] - (a * p[0] - b * p[1]))), ty = median(P.map((p, i) => Q[i][1] - (b * p[0] + a * p[1])));
  return { a, b, tx, ty };
}
export const applySim = (T, p) => [T.a * p[0] - T.b * p[1] + T.tx, T.b * p[0] + T.a * p[1] + T.ty];
export const invertSim = (T) => { const d = T.a * T.a + T.b * T.b; const a = T.a / d, b = -T.b / d; return { a, b, tx: -(a * T.tx - b * T.ty), ty: -(b * T.tx + a * T.ty) }; };
export const IDENTITY = { a: 1, b: 0, tx: 0, ty: 0 };

const insidePoly = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };

/**
 * Track a region through frames (gray8, w x h each, concatenated in `frames`), starting at frame `start` and stepping `dir`
 * (+1 forward, -1 backward) `count` times. region: polygon [[x,y],...] in level-0 pixels.
 * Returns [{ i, T }] (T maps start-frame pixels to frame i) for every tracked frame; stops early when the object is lost.
 */
export function trackRegion({ frames, w, h, start, dir, count, region, mode = 'full' }, onProgress) {
  const n = w * h; const frame = (i) => frames.subarray(i * n, (i + 1) * n);
  const xs = region.map((p) => p[0]), ys = region.map((p) => p[1]);
  const box0 = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  let prev = pyramid(frame(start), w, h);
  let pts0 = goodFeatures(prev[0], (x, y) => insidePoly(region, x, y), box0); // positions in the start frame
  let cur = pts0.map((p) => [...p]); let T = IDENTITY; const out = [];
  const want = Math.max(6, pts0.length);
  for (let k = 1; k <= count; k++) {
    const i = start + dir * k; const next = pyramid(frame(i), w, h);
    const keepP = [], keepC = [];
    for (let j = 0; j < cur.length; j++) {
      const f = lkPoint(prev, next, cur[j][0], cur[j][1]); if (!f) continue;
      const bck = lkPoint(next, prev, f[0], f[1]); if (!bck || Math.hypot(bck[0] - cur[j][0], bck[1] - cur[j][1]) > 1) continue; // forward-backward check
      keepP.push(pts0[j]); keepC.push([f[0], f[1]]);
    }
    if (keepP.length < 3) break; // lost
    const Tn = fitSimilarity(keepP, keepC, mode);
    // drop outliers (> 3 px off the fitted motion), refit
    const res = keepP.map((p, j) => Math.hypot(applySim(Tn, p)[0] - keepC[j][0], applySim(Tn, p)[1] - keepC[j][1]));
    const inl = res.map((r) => r <= Math.max(3, median(res) * 3));
    pts0 = keepP.filter((_, j) => inl[j]); cur = keepC.filter((_, j) => inl[j]);
    if (pts0.length < 3) break;
    T = fitSimilarity(pts0, cur, mode);
    out.push({ i, T });
    // re-seed when fewer than half of the points survive
    if (pts0.length < want / 2) {
      const reg = region.map((p) => applySim(T, p)); const rx = reg.map((p) => p[0]), ry = reg.map((p) => p[1]);
      const inv = invertSim(T); const fresh = goodFeatures(next[0], (x, y) => insidePoly(reg, x, y), [Math.min(...rx), Math.min(...ry), Math.max(...rx), Math.max(...ry)]);
      for (const p of fresh) { if (cur.length >= want) break; if (cur.every((q) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 >= 25)) { cur.push([...p]); pts0.push(applySim(inv, p)); } }
    }
    prev = next; onProgress?.(k / count);
  }
  return out;
}
