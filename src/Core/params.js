// Parameter model: { v: value, keys: null | [{ t, v, interp?, in?, out? }] } where t is clip-local seconds.
// interp (per keyframe, default 'linear'): 'linear' | 'hold' | 'easeIn' | 'easeOut' | 'easeInOut' | 'bezier'.
//   The segment A -> B uses A's outgoing side (hold / ease-out / bezier `out` handle) and B's incoming side (ease-in / bezier `in` handle).
//   Handles are normalized to the segment: x = fraction of the segment time, y = fraction of the value change (y may overshoot 0..1).
// Preview, audio and export all evaluate through evalParam, so they share one formula.
//   CapCut-style presets 'bounce' | 'elastic' | 'back' shape the segment that starts at the key (they overshoot / settle into the next key).
export const INTERPS = [
  { id: 'linear', label: 'Linear' }, { id: 'hold', label: 'Hold' }, { id: 'easeIn', label: 'Ease In' },
  { id: 'easeOut', label: 'Ease Out' }, { id: 'easeInOut', label: 'Ease In-Out' }, { id: 'bezier', label: 'Bezier' },
  { id: 'bounce', label: 'Bounce' }, { id: 'elastic', label: 'Elastic' }, { id: 'back', label: 'Back' },
];
/** Ease presets shown as buttons in the Graph Editor (CapCut names). */
export const EASE_PRESETS = [
  { id: 'easeInOut', label: 'Ease' }, { id: 'bounce', label: 'Bounce' }, { id: 'elastic', label: 'Elastic' }, { id: 'back', label: 'Back' },
];
const SHAPES = {
  bounce: (x) => { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375; return n * (x -= 2.625 / d) * x + 0.984375; },
  elastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  back: (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
const lerp = (a, b, k) => (Array.isArray(a) ? a.map((x, i) => lerp(x, b?.[i] ?? x, k)) : typeof a === 'number' ? a + (b - a) * k : a); // nested arrays: mask points

const EASE = 1 / 3; // influence of ease handles (33.3%, like Premiere / After Effects)
const outHandle = (k) => (k.interp === 'bezier' && k.out ? k.out : k.interp === 'easeOut' || k.interp === 'easeInOut' ? [EASE, 0] : [1 / 3, 1 / 3]);
// an explicit `in` handle wins whatever the key's own interpolation (splitting a clip inside an eased segment stores one)
const inHandle = (k) => (k.in ? k.in : k.interp === 'easeIn' || k.interp === 'easeInOut' ? [1 - EASE, 1] : [2 / 3, 2 / 3]);

/** CSS-style cubic-bezier timing function through (0,0), (x1,y1), (x2,y2), (1,1): progress at time fraction x. */
export function cubicBezier(x1, y1, x2, y2, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bx = (s) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  const by = (s) => 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  const dx = (s) => 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
  let s = x;
  for (let i = 0; i < 8; i++) { const d = dx(s); if (Math.abs(d) < 1e-6) break; const e = bx(s) - x; if (Math.abs(e) < 1e-7) return by(s); s -= e / d; }
  if (s < 0 || s > 1 || Math.abs(bx(s) - x) > 1e-5) { let lo = 0, hi = 1; s = x; for (let i = 0; i < 40; i++) { if (bx(s) < x) lo = s; else hi = s; s = (lo + hi) / 2; } } // bisection fallback
  return by(s);
}

/** Progress (0..1, may overshoot for bezier) of the segment a -> b at fraction x. */
export function segmentProgress(a, b, x) {
  if (a.interp === 'hold') return 0;
  if (SHAPES[a.interp]) return SHAPES[a.interp](Math.min(1, Math.max(0, x)));
  const o = outHandle(a), i = inHandle(b);
  if (o[0] === 1 / 3 && o[1] === 1 / 3 && i[0] === 2 / 3 && i[1] === 2 / 3) return x; // linear both sides
  return cubicBezier(Math.min(1, Math.max(0, o[0])), o[1], Math.min(1, Math.max(0, i[0])), i[1], x);
}

export function evalParam(p, t) {
  if (p == null) return undefined;
  if (typeof p !== 'object' || !('v' in p)) return p;
  const ks = p.keys;
  if (!ks || !ks.length) return p.v;
  if (t <= ks[0].t) return ks[0].v;
  const last = ks[ks.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t >= a.t && t < b.t) {
      if (typeof a.v !== 'number' && !Array.isArray(a.v)) return t < b.t ? a.v : b.v; // booleans / strings step
      return lerp(a.v, b.v, segmentProgress(a, b, (t - a.t) / (b.t - a.t || 1)));
    }
  }
  return p.v;
}

const EPS = 1 / 120;
/** Returns a new param with `value` written: updates/inserts a keyframe at t when animated, else the static value. An existing key keeps its interpolation. */
export function writeParam(p, value, t) {
  p = p || { v: value, keys: null };
  if (!p.keys) return { ...p, v: value };
  const old = p.keys.find((k) => Math.abs(k.t - t) <= EPS);
  const keys = p.keys.filter((k) => Math.abs(k.t - t) > EPS);
  keys.push(old ? { ...old, t: old.t, v: value } : { t, v: value });
  keys.sort((a, b) => a.t - b.t);
  return { ...p, keys };
}
/** Stopwatch toggle: enabling creates a key at t from the current value; disabling flattens to the current value. */
export function toggleAnimation(p, t) {
  const cur = evalParam(p, t);
  return p?.keys ? { v: cur, keys: null } : { v: cur, keys: [{ t, v: cur }] };
}
export const hasKeyAt = (p, t) => !!p?.keys?.some((k) => Math.abs(k.t - t) <= EPS);
export const keyAt = (p, t) => p?.keys?.find((k) => Math.abs(k.t - t) <= EPS) || null;
export const neighborKey = (p, t, dir) => {
  const ks = p?.keys || [];
  return dir > 0 ? ks.find((k) => k.t > t + EPS) : [...ks].reverse().find((k) => k.t < t - EPS);
};
export const toggleKeyAt = (p, t) => {
  if (!p.keys) return p;
  if (hasKeyAt(p, t)) { const keys = p.keys.filter((k) => Math.abs(k.t - t) > EPS); return keys.length ? { ...p, keys } : { ...p, keys: null }; }
  return writeParam(p, evalParam(p, t), t);
};

const scalarOf = (v) => (Array.isArray(v) ? v : [v]);
/** Auto-smooth (Catmull-Rom) bezier handles for key index i, normalized to its neighbouring segments. */
function autoHandles(ks, i) {
  const k = ks[i], prev = ks[i - 1], next = ks[i + 1];
  if (!prev || !next) return { in: [2 / 3, 1], out: [1 / 3, 0] }; // first/last key: flat (ease) tangent
  const dt = next.t - prev.t || 1; const pv = scalarOf(prev.v), nv = scalarOf(next.v);
  const slope = pv.map((x, j) => (nv[j] - x) / dt); // value units per second
  // project the tangent onto each segment's change so it works for points too
  const norm = (a, b, segT) => { const d = scalarOf(b.v).map((x, j) => x - scalarOf(a.v)[j]); const dd = d.reduce((s, x) => s + x * x, 0); return dd < 1e-12 ? 0 : slope.reduce((s, x, j) => s + x * d[j], 0) * segT / dd; };
  const sIn = norm(prev, k, k.t - prev.t), sOut = norm(k, next, next.t - k.t);
  return { in: [2 / 3, 1 - sIn / 3], out: [1 / 3, sOut / 3] };
}
/** Set the interpolation of the key at t (keys within EPS). Returns a new param. */
export function setKeyInterp(p, t, interp) {
  if (!p?.keys) return p;
  const keys = p.keys.map((k) => ({ ...k }));
  const i = keys.findIndex((k) => Math.abs(k.t - t) <= EPS); if (i < 0) return p;
  const k = keys[i]; k.interp = interp;
  if (interp === 'bezier') { const h = autoHandles(keys, i); k.in = k.in || h.in; k.out = k.out || h.out; } else { delete k.in; delete k.out; }
  if (interp === 'linear') delete k.interp;
  return { ...p, keys };
}
/** Set bezier handles of the key at t (Graph Editor). Either side may be omitted. */
// Only the dragged side changes: an `in` handle is honoured whatever the key's interpolation; setting `out` makes the key Bezier
// and pins its current incoming shape so that side looks the same.
export function setKeyHandles(p, t, handles) {
  if (!p?.keys) return p;
  return { ...p, keys: p.keys.map((k) => {
    if (Math.abs(k.t - t) > EPS) return k;
    const nk = { ...k };
    if (handles.out) { if (nk.interp !== 'bezier') { nk.in = nk.in || inHandle(k); nk.interp = 'bezier'; } nk.out = handles.out; }
    if (handles.in) nk.in = handles.in;
    return nk;
  }) };
}
/** Move the key at t to time nt (kept between its neighbours) and/or set its value. */
export function moveKey(p, t, nt, v) {
  if (!p?.keys) return p;
  const i = p.keys.findIndex((k) => Math.abs(k.t - t) <= EPS); if (i < 0) return p;
  const lo = i > 0 ? p.keys[i - 1].t + EPS * 2 : 0, hi = i < p.keys.length - 1 ? p.keys[i + 1].t - EPS * 2 : Infinity;
  const keys = p.keys.map((k, j) => (j === i ? { ...k, t: Math.min(hi, Math.max(lo, nt)), ...(v !== undefined ? { v } : {}) } : k));
  return { ...p, keys };
}
export const removeKeyAt = (p, t) => { if (!p?.keys) return p; const keys = p.keys.filter((k) => Math.abs(k.t - t) > EPS); return keys.length ? { ...p, keys } : { v: evalParam(p, t), keys: null }; };
export const handlesOf = (a, b) => ({ out: outHandle(a), in: inHandle(b) });

/** Bezier parameter s where the x-coordinate of the timing curve equals x. */
function bezierS(x1, x2, x) {
  const bx = (s) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  let lo = 0, hi = 1; for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; } return (lo + hi) / 2;
}
/**
 * Re-base a keyframed param so clip-local time d becomes 0 (used when the head of a clip is cut off, e.g. a split).
 * Keys before d are dropped; a key is inserted at 0 that continues the exact same curve (bezier segments are subdivided).
 */
export function splitParamAt(p, d) {
  if (!p?.keys?.length) return p;
  const shifted = p.keys.map((k) => ({ ...k, t: k.t - d }));
  const atZero = shifted.find((k) => Math.abs(k.t) <= 1e-9);
  const after = shifted.filter((k) => k.t > 1e-9);
  if (atZero) return { ...p, keys: [atZero, ...after] };
  const prevIdx = shifted.map((k) => k.t < 0).lastIndexOf(true);
  if (prevIdx < 0) return { ...p, keys: shifted }; // d is before the first key: nothing is cut
  const A = p.keys[prevIdx], B = p.keys[prevIdx + 1];
  const head = { t: 0, v: evalParam(p, d) };
  if (!B) return { ...p, keys: [head] }; // past the last key: constant
  const nb = after[0];
  if (A.interp === 'hold') head.interp = 'hold';
  else if (SHAPES[A.interp]) head.interp = A.interp; // preset shapes cannot be cut exactly: the rest keeps the shape
  else if (typeof A.v === 'number' || Array.isArray(A.v)) {
    const o = outHandle(A), i = inHandle(B);
    if (!(o[0] === 1 / 3 && o[1] === 1 / 3 && i[0] === 2 / 3 && i[1] === 2 / 3)) {
      // De Casteljau split of the timing curve (0,0) o i (1,1) at the parameter of x; the right half becomes the new segment
      const x = (d - A.t) / (B.t - A.t || 1); const sp = bezierS(o[0], i[0], x);
      const L = (a, b) => [a[0] + (b[0] - a[0]) * sp, a[1] + (b[1] - a[1]) * sp];
      const a1 = L([0, 0], o), b1 = L(o, i), c1 = L(i, [1, 1]), d1 = L(a1, b1), e1 = L(b1, c1), f1 = L(d1, e1);
      const nx = (v) => [(v[0] - f1[0]) / (1 - f1[0] || 1), Math.abs(1 - f1[1]) < 1e-9 ? v[1] : (v[1] - f1[1]) / (1 - f1[1])];
      head.interp = 'bezier'; head.out = nx(e1); head.in = [2 / 3, 2 / 3];
      nb.in = nx(c1);
    }
  }
  return { ...p, keys: [head, ...after] };
}

/** Resolve all of an effect instance's params to plain values at clip-local time t. */
export function resolveParams(params, t) {
  const out = {};
  for (const [k, p] of Object.entries(params || {})) out[k] = evalParam(p, t);
  return out;
}

export const DEFAULT_MOTION = () => ({
  position: { v: [0.5, 0.5], keys: null }, scale: { v: 100, keys: null }, scaleW: { v: 100, keys: null }, uniform: { v: true, keys: null },
  rotation: { v: 0, keys: null }, anchor: { v: [0.5, 0.5], keys: null }, antiflicker: { v: 0, keys: null },
});
export const DEFAULT_OPACITY = () => ({ opacity: { v: 100, keys: null }, blend: { v: 'Normal', keys: null } });
export const DEFAULT_VOLUME = () => ({ level: { v: 0, keys: null }, bypass: { v: false, keys: null } });
export const DEFAULT_TIMEREMAP = () => ({ speed: { v: 100, keys: null } });

/**
 * Clip > Scale to Frame Size (default on): the source is fitted into the frame at Scale 100. Turned off, the source keeps its
 * own pixel size (Premiere): Scale 100 = one source pixel per sequence pixel. Returns the resolved Motion the renderer draws.
 */
export function frameScaled(mo, clip, sw, sh, W, H) {
  if (clip?.scaleToFrame !== false || !sw || !sh || !W || !H) return mo;
  const k = sw / (sw / sh >= W / H ? W : (H * sw) / sh);
  return { ...mo, scale: mo.scale * k, scaleW: mo.scaleW * k };
}
