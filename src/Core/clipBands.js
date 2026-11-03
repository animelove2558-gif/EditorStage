// Clip keyframe rubber bands on the Timeline (clip right-click > Show Clip Keyframes): which parameters a clip can show,
// how a value maps to the band height, and the edits a band makes. The bands read and write the same keyframes as
// Effect Controls (evalParam / writeParam), so preview and export follow them.
import { evalParam, writeParam, moveKey, removeKeyAt, DEFAULT_MOTION, DEFAULT_OPACITY, DEFAULT_VOLUME } from './params';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Volume band: linear amplitude 0 (bottom, −∞ dB) .. 2 (top, +6 dB), like Premiere's level band. */
const VOLUME = { scale: 'db', min: -96, max: 6.02 };
const fromGain = (a) => (a <= 1e-5 ? -96 : clamp(20 * Math.log10(a), -96, 6.02));
/** Band height fraction (0 bottom .. 1 top) of a value. */
export function fracOf(def, v) {
  if (def.scale === 'db') return clamp(Math.pow(10, v / 20) / 2, 0, 1);
  return clamp((v - def.min) / (def.max - def.min || 1), 0, 1);
}
export function valueOf(def, f) {
  f = clamp(f, 0, 1);
  if (def.scale === 'db') return fromGain(f * 2);
  const v = def.min + f * (def.max - def.min); return def.step ? Math.round(v / def.step) * def.step : v;
}

/**
 * Parameters of a clip that can be shown on its band: [{ key, label, group, min, max, scale, comp, get(clip) -> param }].
 * key: 'opacity.opacity' | 'volume.level' | 'motion.<id>' (comp 0 / 1 = x / y of a point) | 'fx.<index>.<paramId>'.
 * kind = the track kind; fx = { video: VIDEO_FX, audio: AUDIO_FX } effect definitions.
 */
export function bandParams(clip, kind, fx = {}) {
  const out = [];
  if (kind === 'audio') out.push({ key: 'volume.level', label: 'Level', group: 'Volume', ...VOLUME, fmt: (v) => `${v <= -95.9 ? '-∞' : v.toFixed(1)} dB`, get: (c) => c.volume?.level ?? DEFAULT_VOLUME().level });
  if (kind === 'video') {
    out.push({ key: 'opacity.opacity', label: 'Opacity', group: 'Opacity', min: 0, max: 100, fmt: (v) => `${v.toFixed(1)}%`, get: (c) => c.opacity?.opacity ?? DEFAULT_OPACITY().opacity });
    const m = (id, label, min, max, comp) => out.push({ key: `motion.${id}${comp != null ? '.' + comp : ''}`, label, group: 'Motion', min, max, comp, fmt: (v) => (comp != null ? `${(v * 100).toFixed(1)}%` : v.toFixed(1)), get: (c) => c.motion?.[id] ?? DEFAULT_MOTION()[id] });
    m('position', 'Position X', -1, 2, 0); m('position', 'Position Y', -1, 2, 1); m('scale', 'Scale', 0, 400); m('rotation', 'Rotation', -360, 360);
  }
  const defs = kind === 'audio' ? fx.audio : fx.video;
  (clip.effects || []).forEach((e, i) => {
    for (const d of defs?.[e.name]?.params || []) {
      if (d.type !== 'slider') continue;
      out.push({ key: `fx.${i}.${d.id}`, label: d.label, group: e.name, min: d.min, max: d.max, step: d.step, fmt: (v) => (+v).toFixed(d.step < 1 ? 2 : 0), get: (c) => c.effects?.[i]?.params?.[d.id] ?? { v: d.def, keys: null } });
    }
  });
  return out;
}
/** Write a param back to the clip under its key. */
export function setBandParam(clip, key, p) {
  const [a, b, c] = key.split('.');
  if (a === 'fx') { const e = clip.effects?.[+b]; if (e) e.params = { ...(e.params || {}), [c]: p }; return; }
  if (a === 'volume') clip.volume = { ...DEFAULT_VOLUME(), ...(clip.volume || {}), [b]: p };
  else if (a === 'opacity') clip.opacity = { ...DEFAULT_OPACITY(), ...(clip.opacity || {}), [b]: p };
  else if (a === 'motion') clip.motion = { ...DEFAULT_MOTION(), ...(clip.motion || {}), [b]: p };
}

// ---- values of a band (a point param shows one component) ----
export const bandValue = (def, p, t) => { const v = evalParam(p, t); return def.comp != null ? v?.[def.comp] : v; };
const withComp = (def, whole, v) => { if (def.comp == null) return v; const o = [...whole]; o[def.comp] = v; return o; };
const keyValue = (def, k) => (def.comp != null ? k.v[def.comp] : k.v);
/** Ctrl+click on the band: a keyframe at t with the current value (a static param becomes animated). */
export const addBandKey = (def, p, t) => writeParam(p.keys ? p : { ...p, keys: [] }, evalParam(p, t), t);
/** Alt+click on a keyframe. */
export const removeBandKey = (p, t) => removeKeyAt(p, t);
/**
 * Drag the line up / down by df (band height fraction): without keyframes the whole clip changes; with keyframes the two keys of
 * the segment under t move (only the first / last key before / after them), every key by the same distance on the band.
 */
export function dragBandLine(def, p, t, df) {
  const shift = (v) => valueOf(def, fracOf(def, v) + df);
  if (!p.keys?.length) return { ...p, v: withComp(def, p.v, shift(def.comp != null ? p.v[def.comp] : p.v)) };
  const ks = p.keys; const i = ks.findIndex((k) => k.t > t);
  const hit = i < 0 ? [ks.length - 1] : i === 0 ? [0] : [i - 1, i];
  return { ...p, keys: ks.map((k, j) => (hit.includes(j) ? { ...k, v: withComp(def, k.v, shift(keyValue(def, k))) } : k)) };
}
/** Drag a keyframe to time nt (clamped to the clip) and band height f. */
export function dragBandKey(def, p, t, nt, f, dur) {
  const k = p.keys?.find((x) => Math.abs(x.t - t) <= 1 / 120); if (!k) return p;
  return moveKey(p, t, clamp(nt, 0, dur), withComp(def, k.v, valueOf(def, f)));
}
