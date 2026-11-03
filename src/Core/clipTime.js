// Clip time model shared by playback (media.js), the compositor, export (video + audio) and editing, so Preview and Export agree.
//
// Source time of a clip at sequence time t (clip-local lt = t - start):
//   src(lt) = inPoint + dir * speed * I(lt),   I(lt) = ∫0..lt rate(τ) dτ
//   rate    = Time Remapping speed% (keyframable) × Time Warp speed% (effect), 1 when neither is set
//   dir     = -1 for reversed clips (clip.reverse), so inPoint is always the source time at the clip's head.
// clip.frameHold: { on, mode: 'source' | 'in' | 'out', time (source seconds, for 'source'), holdFilters } (Clip > Video Options > Frame Hold Options)
import { evalParam, splitParamAt as shiftParam } from './params.js';

const baseSpeed = (c) => Math.abs(c.speed || 1);
export const dirOf = (c) => (c.reverse ? -1 : 1);
const STEP = 1 / 240; // integration step (s); the speed curve is sampled at 240 Hz
const timeWarpOf = (c) => (c.effects || []).find((e) => e.name === 'Time Warp' && e.enabled);
const remapOf = (c) => c.timeRemap?.speed;
const isAnimated = (p) => !!(p && p.keys && p.keys.length);

/** Constant rate (number) or null when the clip's rate changes over time. */
function constantRate(c) {
  const rp = remapOf(c), tw = timeWarpOf(c);
  if (isAnimated(rp) || (tw && isAnimated(tw.params?.speed))) return null;
  return Math.max(0, ((rp?.v ?? 100) / 100) * ((tw ? (tw.params?.speed?.v ?? 100) : 100) / 100));
}
/** Instantaneous rate (without base speed / direction) at clip-local time lt. */
export function rateAt(c, lt) {
  const k = constantRate(c); if (k != null) return k;
  const tw = timeWarpOf(c);
  return Math.max(0, ((evalParam(remapOf(c), lt) ?? 100) / 100) * (tw ? (evalParam(tw.params.speed, lt) ?? 100) / 100 : 1));
}

// cumulative integral tables, keyed by the curve (shared by every clip with the same curve)
const tables = new Map();
function tableFor(c, upTo) {
  const tw = timeWarpOf(c);
  const key = JSON.stringify([remapOf(c), tw?.params?.speed]);
  let e = tables.get(key);
  if (!e) { e = { cum: new Float64Array(1024), n: 1 }; tables.set(key, e); if (tables.size > 200) tables.delete(tables.keys().next().value); }
  const need = Math.ceil(upTo / STEP) + 2;
  if (need > e.n) {
    if (need > e.cum.length) { const g = new Float64Array(Math.max(need, e.cum.length * 2)); g.set(e.cum.subarray(0, e.n)); e.cum = g; }
    for (let i = e.n; i < need; i++) e.cum[i] = e.cum[i - 1] + rateAt(c, (i - 0.5) * STEP) * STEP; // midpoint rule
    e.n = need;
  }
  return e;
}
/** I(lt): rate integrated from the clip head to clip-local time lt (extrapolated with the edge rate outside [0, ∞)). */
export function integral(c, lt) {
  const k = constantRate(c); if (k != null) return k * lt;
  if (lt <= 0) return rateAt(c, 0) * lt;
  const e = tableFor(c, lt); const x = lt / STEP; const i = Math.floor(x);
  return e.cum[i] + (e.cum[i + 1] - e.cum[i]) * (x - i);
}
/** Source seconds consumed by the first `dur` seconds of the clip (always >= 0). */
export const sourceSpan = (c, dur = c.dur) => baseSpeed(c) * integral(c, dur);
/** Signed playback rate (source seconds per sequence second) at sequence time t: drives <video>.playbackRate and audio. */
export const playRateAt = (c, t) => (c.frameHold?.on ? 0 : dirOf(c) * baseSpeed(c) * rateAt(c, Math.max(0, t - c.start)));
/** True when the clip does not play its source forward at a steady 100% (its audio needs the rendered path). */
export const isRetimed = (c) => !!(c.reverse || Math.abs(baseSpeed(c) - 1) > 1e-6 || constantRate(c) !== 1);

/** Source time the clip is frozen on, or null when it plays normally. */
export function holdSourceTime(c, fps = 30) {
  const h = c.frameHold; if (!h?.on) return null;
  if (h.mode === 'in') return c.inPoint || 0;
  if (h.mode === 'out') return (c.inPoint || 0) + dirOf(c) * Math.max(0, sourceSpan(c) - 1 / fps);
  return h.time ?? (c.inPoint || 0);
}

/** Source time (seconds) shown at sequence time t. mediaDur clamps to the last frame. */
export function sourceAt(c, t, fps = 30, mediaDur = Infinity) {
  const held = holdSourceTime(c, fps);
  let src = held != null ? held : (c.inPoint || 0) + dirOf(c) * baseSpeed(c) * integral(c, t - c.start);
  const pt = (c.effects || []).find((e) => e.name === 'Posterize Time' && e.enabled);
  if (pt && held == null) { const pf = evalParam(pt.params?.fps, 0) || 8; src = Math.floor(src * pf) / pf; }
  return Math.min(Math.max(0, src), Math.max(0, mediaDur - 0.04));
}

/** Clip-local time at which the clip shows source time `src` (inverse of sourceAt; used by Hold Filters). */
export function localAtSource(c, src) {
  const want = ((src - (c.inPoint || 0)) * dirOf(c)) / baseSpeed(c); // = I(lt)
  const k = constantRate(c); if (k != null) return k > 0 ? want / k : 0;
  let lo = 0, hi = Math.max(c.dur, 1e-3);
  if (integral(c, hi) < want) return hi;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (integral(c, m) < want) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Clip-local time used to evaluate keyframes (motion, opacity, effects, masks). With Hold Filters they freeze at the held frame. */
export function paramLocal(c, t) {
  const local = Math.max(0, t - c.start);
  const h = c.frameHold; if (!h?.on || !h.holdFilters) return local;
  return Math.min(c.dur, Math.max(0, localAtSource({ ...c, frameHold: undefined }, holdSourceTime(c))));
}
export const fieldOptionsActive = (c) => !!(c.fieldOptions && (c.fieldOptions.reverse || c.fieldOptions.deinterlace || c.fieldOptions.flicker));

/**
 * Remove (d > 0) or add back (d < 0) d sequence seconds at the clip's head without moving the source under the rest of the clip.
 * Mutates c.inPoint and the speed curves; callers adjust start/dur. Used by split, trim, roll, slide and nesting.
 */
export function trimHead(c, d) {
  if (!d) return c;
  c.inPoint = Math.max(0, (c.inPoint || 0) + dirOf(c) * baseSpeed(c) * integral(c, d));
  // every keyframe stays on the same source frame: shift Time Remapping, Motion, Opacity, Volume, masks and effect params
  const shift = (o) => { if (!o) return o; let r = o; for (const [k, p] of Object.entries(o)) if (isAnimated(p)) { if (r === o) r = { ...o }; r[k] = shiftParam(p, d); } return r; };
  for (const k of ['timeRemap', 'motion', 'opacity', 'volume']) if (c[k]) c[k] = shift(c[k]);
  if (c.masks?.some((m) => m.params && shift(m.params) !== m.params)) c.masks = c.masks.map((m) => ({ ...m, params: shift(m.params) }));
  if (c.effects?.some((e) => e.params && shift(e.params) !== e.params)) c.effects = c.effects.map((e) => ({ ...e, params: shift(e.params) }));
  return c;
}
/** Timeline seconds the head can be extended by before running out of source (start of file, or its end when reversed). */
export function headRoom(c, mdur) {
  const r = baseSpeed(c) * Math.max(1e-6, rateAt(c, 0)); const inP = c.inPoint || 0;
  return c.reverse ? Math.max(0, (mdur - inP) / r) : Math.max(0, inP / r);
}
/** Longest duration the clip can have from its current head (source runs out at the end of the file, or its start when reversed). */
export function maxDuration(c, mdur) {
  if (!Number.isFinite(mdur)) return Infinity;
  const avail = c.reverse ? (c.inPoint || 0) : mdur - (c.inPoint || 0);
  const k = constantRate(c); if (k != null) return k > 0 ? avail / (baseSpeed(c) * k) : Infinity;
  const want = avail / baseSpeed(c); let lo = 0, hi = Math.max(1, c.dur);
  while (integral(c, hi) < want && hi < 86400) hi *= 2;
  if (integral(c, hi) < want) return Infinity;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (integral(c, m) < want) lo = m; else hi = m; }
  return hi;
}
/** Reverse / un-reverse a clip in place: the same source range plays the other way (head becomes the old tail). */
export function setReverse(c, on) {
  if (!!c.reverse === !!on) return c;
  const span = sourceSpan(c);
  c.inPoint = Math.max(0, (c.inPoint || 0) + dirOf(c) * span);
  c.reverse = on || undefined;
  if (isAnimated(remapOf(c))) c.timeRemap = { ...c.timeRemap, speed: { ...remapOf(c), keys: remapOf(c).keys.map((k) => ({ ...k, t: c.dur - k.t })).reverse() } };
  return c;
}

/**
 * Source positions (seconds) for a run of output samples: sequence times t0 + i / sr, i < n. Used to render retimed
 * audio (reverse, speed, ramps) identically in playback and export. Computed at 240 Hz and linearly interpolated.
 */
export function sourcePositions(c, t0, n, sr) {
  const out = new Float64Array(n); const ctl = Math.max(1, Math.round(sr / 240));
  let prevI = -1, a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(i / ctl);
    if (ci !== prevI) { prevI = ci; a = rawSource(c, t0 + (ci * ctl) / sr); b = rawSource(c, t0 + ((ci + 1) * ctl) / sr); }
    out[i] = a + (b - a) * ((i - ci * ctl) / ctl);
  }
  return out;
}
/** Unclamped source time (no media-length clamp, no Posterize Time): the continuous mapping audio is rendered from. */
export const rawSource = (c, t) => { const h = holdSourceTime(c); return h != null ? h : (c.inPoint || 0) + dirOf(c) * baseSpeed(c) * integral(c, t - c.start); };

// ---- CapCut-style speed curves: speed multipliers over the clip's (normalized) duration ----
export const SPEED_CURVES = {
  Montage: [[0, 1], [0.22, 3], [0.45, 0.6], [0.7, 3], [1, 1]],
  Hero: [[0, 3], [0.38, 0.35], [0.62, 0.35], [1, 3]],
  Bullet: [[0, 4], [0.35, 0.2], [0.65, 0.2], [1, 4]],
  'Jump Cut': [[0, 1], [0.42, 1], [0.5, 8], [0.58, 1], [1, 1]],
  'Flash In': [[0, 6], [0.4, 1], [1, 1]],
  'Flash Out': [[0, 1], [0.6, 1], [1, 6]],
  Custom: [[0, 1], [0.5, 1], [1, 1]],
};
/**
 * Apply a speed curve: Time Remapping speed keys (smooth ease between points) and a new duration chosen so the clip still
 * plays the same source range (like CapCut). Mutates c; returns the new duration.
 */
export function applySpeedCurve(c, name, maxDur = Infinity) {
  const pts = SPEED_CURVES[name]; if (!pts) return c.dur;
  const span = sourceSpan(c); // keep this much source
  const probe = { ...c, effects: [], frameHold: undefined, timeRemap: { speed: { v: 100, keys: pts.map(([x, m]) => ({ t: x, v: m * 100, interp: 'easeInOut' })) } } };
  const mean = integral(probe, 1); // average multiplier over the normalized curve
  let nd = span / (baseSpeed(c) * Math.max(1e-3, mean));
  nd = Math.min(nd, maxDur);
  c.timeRemap = { ...(c.timeRemap || {}), speed: { v: 100, keys: pts.map(([x, m]) => ({ t: x * nd, v: m * 100, interp: 'easeInOut' })) } };
  c.speedCurve = name;
  c.dur = nd;
  return nd;
}
