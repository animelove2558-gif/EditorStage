// Keyframe interpolation with After Effects semantics (temporal ease speed/influence, hold, linear, spatial bezier).
import { isVec } from './vecmath.js';

function cubic(a, b, c, d, u) {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
}

// Solve x(u) = x for bezier with x0=0,x3=1, controls x1,x2 (monotone assumed).
function solveU(x, x1, x2) {
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 32; i++) {
    const xv = cubic(0, x1, x2, 1, u);
    if (Math.abs(xv - x) < 1e-7) return u;
    if (xv < x) lo = u; else hi = u;
    u = (lo + hi) / 2;
  }
  return u;
}

const infl = (e) => {
  const i = e && typeof e.influence === 'number' ? e.influence : 16.666666;
  return Math.min(100, Math.max(0.0001, i)) / 100;
};
const spd = (e) => (e && typeof e.speed === 'number' ? e.speed : 0);

/**
 * Temporal bezier value for one dimension.
 * eOut: out ease of k0 (or null if linear), eIn: in ease of k1 (or null if linear)
 */
export function easedValue(f, dt, v0, v1, eOut, eIn) {
  const slope = dt > 0 ? (v1 - v0) / dt : 0;
  let x1, y1, x2, y2;
  if (eOut) { x1 = infl(eOut); y1 = v0 + spd(eOut) * x1 * dt; } else { x1 = 1 / 3; y1 = v0 + slope * x1 * dt; }
  if (eIn) { const i = infl(eIn); x2 = 1 - i; y2 = v1 - spd(eIn) * i * dt; } else { x2 = 2 / 3; y2 = v1 - slope * (1 / 3) * dt; }
  const u = solveU(f, x1, x2);
  return cubic(v0, y1, y2, v1, u);
}

function bezPt(p0, p1, p2, p3, u) {
  const out = new Array(p0.length);
  for (let i = 0; i < p0.length; i++) out[i] = cubic(p0[i], p1[i], p2[i], p3[i], u);
  return out;
}

const pathCache = new WeakMap();
function spatialPath(k0, k1) {
  let c = pathCache.get(k0);
  if (c && c.k1 === k1) return c;
  const v0 = k0.value, v1 = k1.value, n = v0.length;
  const ot = k0.spatialOutTangent || [], it = k1.spatialInTangent || [];
  const p1 = [], p2 = [];
  let zero = true;
  for (let i = 0; i < n; i++) {
    const a = ot[i] || 0, b = it[i] || 0;
    if (a || b) zero = false;
    p1.push(v0[i] + a); p2.push(v1[i] + b);
  }
  const N = 48, cum = [0];
  let prev = v0, L = 0;
  if (zero) {
    let s = 0; for (let i = 0; i < n; i++) s += (v1[i] - v0[i]) ** 2; L = Math.sqrt(s);
  } else {
    for (let j = 1; j <= N; j++) {
      const p = bezPt(v0, p1, p2, v1, j / N);
      let s = 0; for (let i = 0; i < n; i++) s += (p[i] - prev[i]) ** 2;
      L += Math.sqrt(s); cum.push(L); prev = p;
    }
  }
  c = { k1, p1, p2, zero, L, cum, N };
  pathCache.set(k0, c);
  return c;
}

function pointAtDistance(k0, k1, c, s) {
  const v0 = k0.value, v1 = k1.value;
  if (c.L <= 1e-9) return v1.slice();
  const f = Math.min(1, Math.max(0, s / c.L));
  if (c.zero) return v0.map((a, i) => a + (v1[i] - a) * f);
  const target = f * c.L;
  const cum = c.cum;
  let lo = 0, hi = c.N;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo];
  const frac = seg > 0 ? (target - cum[lo]) / seg : 0;
  return bezPt(v0, c.p1, c.p2, v1, (lo + frac) / c.N);
}

function lerpAny(a, b, f) {
  if (typeof a === 'number') return a + (b - a) * f;
  if (isVec(a)) return a.map((x, i) => (isVec(a[i]) ? lerpAny(a[i], b[i], f) : x + (b[i] - x) * f));
  if (a && typeof a === 'object' && a.vertices) {
    const lp = (A, B) => A.map((p, i) => p.map((x, j) => x + (B[i][j] - x) * f));
    if (!b.vertices || b.vertices.length !== a.vertices.length) return f < 1 ? a : b;
    return { closed: a.closed, vertices: lp(a.vertices, b.vertices), inTangents: lp(a.inTangents, b.inTangents), outTangents: lp(a.outTangents, b.outTangents) };
  }
  if (a && typeof a === 'object' && a.colorStops) return f < 1 ? a : b;
  return f < 1 ? a : b;
}

/** Interpolate keyframes `keys` (sorted by time) at time t. isSpatial for >=2D position-like props. */
export function interpolateKeys(keys, t, isSpatial) {
  const n = keys.length;
  if (t <= keys[0].time) return keys[0].value;
  if (t >= keys[n - 1].time) return keys[n - 1].value;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (keys[mid].time <= t) lo = mid; else hi = mid; }
  const k0 = keys[lo], k1 = keys[hi];
  const v0 = k0.value, v1 = k1.value;
  if (k0.outInterpolation === 'HOLD') return v0;
  const dt = k1.time - k0.time;
  if (!(dt > 0)) return v1;
  const f = (t - k0.time) / dt;
  const lin0 = k0.outInterpolation === 'LINEAR', lin1 = k1.inInterpolation === 'LINEAR';
  const eo = k0.outTemporalEase || [], ei = k1.inTemporalEase || [];

  if (typeof v0 === 'number') {
    if (lin0 && lin1) return v0 + (v1 - v0) * f;
    return easedValue(f, dt, v0, v1, lin0 ? null : (eo[0] || null), lin1 ? null : (ei[0] || null));
  }
  if (isVec(v0) && typeof v0[0] === 'number') {
    if (isSpatial && v0.length >= 2) {
      const c = spatialPath(k0, k1);
      let s;
      if (lin0 && lin1) s = f * c.L;
      else s = easedValue(f, dt, 0, c.L, lin0 ? null : (eo[0] || null), lin1 ? null : (ei[0] || null));
      return pointAtDistance(k0, k1, c, s);
    }
    const out = new Array(v0.length);
    for (let d = 0; d < v0.length; d++) {
      if (lin0 && lin1) out[d] = v0[d] + (v1[d] - v0[d]) * f;
      else out[d] = easedValue(f, dt, v0[d], v1[d], lin0 ? null : (eo[d] || eo[0] || null), lin1 ? null : (ei[d] || ei[0] || null));
    }
    return out;
  }
  // shapes etc: eased progress, normalized
  let p = f;
  if (!(lin0 && lin1)) p = easedValue(f, dt, 0, 1, lin0 ? null : { speed: 0, influence: eo[0] ? eo[0].influence : 33 }, lin1 ? null : { speed: 0, influence: ei[0] ? ei[0].influence : 33 });
  return lerpAny(v0, v1, p);
}

/** Speed (derivative) via central difference of a value function. */
export function derivative(fn, t, h = 0.001) {
  const a = fn(t - h), b = fn(t + h);
  if (isVec(a)) return a.map((x, i) => (b[i] - x) / (2 * h));
  return (b - a) / (2 * h);
}
