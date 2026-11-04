// Effects, color and keyframes of imported clips (File > Import of EDL / FCPXML / Final Cut Pro 7 - Premiere XML).
// Pure (no DOM): each reader returns the parts of a clip the app keeps, in its own parameter model
// ({ v, keys: [{ t: clip-local seconds, v }] }):
//   { motion: { position, scale, rotation, anchor }, opacity: { opacity }, volume: { level }, effects: [{ name, params }], unknown: [name] }
// Position / anchor are fractions of the frame (0.5 0.5 = centre, y down), Scale is %, Rotation degrees clockwise,
// Opacity %, Volume level dB. Effects: 'ASC CDL' (slope / offset / power / saturation), 'Gaussian Blur', 'Crop'.
import { kid, kids, txt, findAll } from './xml.js';

const P = (v, keys = null) => ({ v, keys: keys && keys.length ? keys : null });
const num = (s, d = 0) => { const x = parseFloat(String(s ?? '').replace(/dB$/i, '')); return Number.isFinite(x) ? x : d; };
const pair = (s, d = [0, 0]) => { const p = String(s ?? '').trim().split(/[\s,]+/).map(Number); return p.length >= 2 && p.every(Number.isFinite) ? [p[0], p[1]] : d; };
const isDefault = (p, d) => !p.keys && JSON.stringify(p.v) === JSON.stringify(d);

// ---------------------------------------------------------------- EDL (CMX3600 + ASC CDL comments)
/** "* ASC_SOP (1.1 1 0.9)(0.01 0 -0.02)(1 1 1.05)" -> { slope, offset, power } (null when not a CDL line) */
export function parseAscSop(line) {
  const m = /ASC_SOP\s*\(([^)]*)\)\s*\(([^)]*)\)\s*\(([^)]*)\)/i.exec(line); if (!m) return null;
  const v = m.slice(1, 4).map((g) => g.trim().split(/\s+/).map(Number));
  return v.every((x) => x.length === 3 && x.every(Number.isFinite)) ? { slope: v[0], offset: v[1], power: v[2] } : null;
}
export const parseAscSat = (line) => { const m = /ASC_SAT\s+(-?[\d.]+)/i.exec(line); return m ? +m[1] : null; };
/** the ASC CDL effect for a slope / offset / power / saturation (any part may be missing) */
export function cdlEffect({ slope = [1, 1, 1], offset = [0, 0, 0], power = [1, 1, 1] } = {}, sat = 1) {
  const ids = [['sr', slope[0]], ['sg', slope[1]], ['sb', slope[2]], ['or', offset[0]], ['og', offset[1]], ['ob', offset[2]], ['pr', power[0]], ['pg', power[1]], ['pb', power[2]], ['sat', sat ?? 1]];
  return { name: 'ASC CDL', params: Object.fromEntries(ids.map(([k, v]) => [k, P(v)])) };
}

// ---------------------------------------------------------------- FCPXML
/** keyframes of an FCPXML <param name=...> under `node`: [{ t: local seconds, v: raw string }] */
function fcpKeys(node, name, toLocal) {
  const p = kids(node, 'param').find((x) => x.attrs.name === name); const ka = p && kid(p, 'keyframeAnimation'); if (!ka) return null;
  return kids(ka, 'keyframe').map((k) => ({ t: toLocal(k.attrs.time), raw: k.attrs.value }));
}
/**
 * The adjustments / filters of an FCPXML clip element. ctx = { w, h, srcStart (clip start attr, s), speed, parseTime }.
 * FCPXML keyframe times are on the clip's own (source) timeline: local = (time - start) / speed.
 */
export function fcpxmlClipFx(node, { w = 1920, h = 1080, srcStart = 0, speed = 1, parseTime }) {
  const out = { motion: null, opacity: null, volume: null, effects: [], unknown: [] };
  const all = [...node.children, ...node.children.filter((k) => k.name === 'video' || k.name === 'audio').flatMap((k) => k.children)];
  const times = all.flatMap((a) => findAll(a, 'keyframe').map((k) => parseTime(k.attrs.time)));
  const base = times.length && times.every((t) => t < srcStart - 1e-6) ? 0 : srcStart; // some writers use clip-local times
  const toLocal = (s) => Math.max(0, (parseTime(s) - base) / (speed || 1));
  const conv = (keys, f) => (keys ? keys.map((k) => ({ t: +k.t.toFixed(6), v: f(k.raw) })) : null);
  const posOf = (s) => { const [x, y] = pair(s); return [0.5 + (x * h) / 100 / w, 0.5 - y / 100]; };
  const scaleOf = (s) => { const [sx, sy] = pair(s, [1, 1]); const m = Math.max(Math.abs(sx), Math.abs(sy)) > 5 ? 1 : 100; return +(((sx + sy) / 2) * m).toFixed(4); };
  for (const a of all) {
    if (a.attrs.enabled === '0') continue;
    if (a.name === 'adjust-transform') {
      const mo = { position: P(posOf(a.attrs.position), conv(fcpKeys(a, 'position', toLocal), posOf)), scale: P(scaleOf(a.attrs.scale), conv(fcpKeys(a, 'scale', toLocal), scaleOf)),
        rotation: P(-num(a.attrs.rotation), conv(fcpKeys(a, 'rotation', toLocal), (s) => -num(s))),
        anchor: P(((s) => { const [x, y] = pair(s); return [0.5 + (x * h) / 100 / w, 0.5 - y / 100]; })(a.attrs.anchor)) };
      const d = { position: [0.5, 0.5], scale: 100, rotation: 0, anchor: [0.5, 0.5] };
      for (const k of Object.keys(mo)) if (isDefault(mo[k], d[k])) delete mo[k];
      if (Object.keys(mo).length) out.motion = mo;
    } else if (a.name === 'adjust-blend') {
      const op = P(+(num(a.attrs.amount, 1) * 100).toFixed(3), conv(fcpKeys(a, 'amount', toLocal), (s) => +(num(s, 1) * 100).toFixed(3)));
      if (!isDefault(op, 100)) out.opacity = { opacity: op };
    } else if (a.name === 'adjust-volume') {
      const lv = P(num(a.attrs.amount), conv(fcpKeys(a, 'amount', toLocal), (s) => num(s)));
      if (!isDefault(lv, 0)) out.volume = { level: lv };
    } else if (a.name === 'adjust-crop') {
      const r = kid(a, a.attrs.mode === 'crop' ? 'crop-rect' : 'trim-rect') || kid(a, 'trim-rect') || kid(a, 'crop-rect'); if (!r) continue;
      // FCPXML: percent of the frame height on every side; Crop: percent of the frame width (left / right) or height
      const cp = { l: P(+((num(r.attrs.left) * h) / w).toFixed(4)), r: P(+((num(r.attrs.right) * h) / w).toFixed(4)), t: P(num(r.attrs.top)), b: P(num(r.attrs.bottom)) };
      if (Object.values(cp).some((p) => p.v)) out.effects.push({ name: 'Crop', params: cp });
    } else if (a.name === 'filter-video') {
      const name = a.attrs.name || '';
      if (/gaussian blur/i.test(name)) {
        const pAmt = kids(a, 'param').find((x) => /amount|radius/i.test(x.attrs.name));
        out.effects.push({ name: 'Gaussian Blur', params: { blurriness: P(Math.min(100, num(pAmt?.attrs.value, 10)), conv(pAmt && fcpKeys(a, pAmt.attrs.name, toLocal), (s) => Math.min(100, num(s)))) } });
      } else out.unknown.push(name || 'video filter');
    } else if (a.name === 'filter-audio') out.unknown.push(a.attrs.name || 'audio filter');
  }
  return out;
}

// ---------------------------------------------------------------- Final Cut Pro 7 / Premiere XML
/**
 * Filters of an FCP7 <clipitem>: Basic Motion (scale, rotation, center, anchor), Opacity, Audio Levels, Crop,
 * Gaussian Blur. ctx = { w, h, fps, inFrame (clip in, source frames), outFrame, speed }. Keyframe <when> is a source frame
 * (relative to the media, as Premiere writes it) or, when outside the clip's in..out, a frame from the clip start.
 */
export function xmemlClipFx(item, { fps = 30, inFrame = 0, outFrame = Infinity, speed = 1 }) {
  const out = { motion: null, opacity: null, volume: null, effects: [], unknown: [] };
  const effects = kids(item, 'filter').filter((f) => txt(f, 'enabled').toUpperCase() !== 'FALSE').map((f) => kid(f, 'effect')).filter(Boolean);
  const whens = effects.flatMap((e) => findAll(e, 'keyframe').map((k) => +txt(k, 'when')));
  const media = whens.length && whens.every((x) => x >= inFrame - 1 && x <= outFrame + 1);
  const toLocal = (wf) => Math.max(0, ((media ? wf - inFrame : wf) / fps) / (speed || 1));
  const param = (e, id) => kids(e, 'parameter').find((p) => txt(p, 'parameterid').toLowerCase() === id);
  const value = (p, f) => { if (!p) return null; const ks = kids(p, 'keyframe'); const v0 = kid(p, 'value');
    return P(f(v0), ks.length ? ks.map((k) => ({ t: +toLocal(+txt(k, 'when')).toFixed(6), v: f(kid(k, 'value')) })) : null); };
  const n = (node) => num(node?.text?.trim());
  const pt = (node) => [0.5 + num(txt(node, 'horiz')), 0.5 + num(txt(node, 'vert'))];
  for (const e of effects) {
    const id = (txt(e, 'effectid') || txt(e, 'name')).toLowerCase(); const name = txt(e, 'name');
    if (id === 'basic' || /basic motion/i.test(name)) {
      const mo = {}; const sc = value(param(e, 'scale'), n), rot = value(param(e, 'rotation'), n), ce = value(param(e, 'center'), pt), an = value(param(e, 'centeroffset'), pt);
      if (sc && !isDefault(sc, 100)) mo.scale = sc; if (rot && !isDefault(rot, 0)) mo.rotation = rot; if (ce && !isDefault(ce, [0.5, 0.5])) mo.position = ce; if (an && !isDefault(an, [0.5, 0.5])) mo.anchor = an;
      if (Object.keys(mo).length) out.motion = mo;
    } else if (id === 'opacity') { const op = value(param(e, 'opacity'), n); if (op && !isDefault(op, 100)) out.opacity = { opacity: op }; }
    else if (id === 'audiolevels' || /audio levels/i.test(name)) {
      const lv = value(param(e, 'level'), (node) => { const g = n(node); return g > 0 ? +(20 * Math.log10(g)).toFixed(3) : -96; });
      if (lv && !isDefault(lv, 0)) out.volume = { level: lv };
    } else if (id === 'crop') {
      const cp = {}; for (const [k, pid] of [['l', 'left'], ['r', 'right'], ['t', 'top'], ['b', 'bottom']]) { const v = value(param(e, pid), n); if (v) cp[k] = v; }
      if (Object.values(cp).some((p) => p.v || p.keys)) out.effects.push({ name: 'Crop', params: cp });
    } else if (/gaussian ?blur/i.test(id + name)) {
      const v = value(param(e, 'blurriness') || param(e, 'radius') || param(e, 'blur amount'), n); if (v) out.effects.push({ name: 'Gaussian Blur', params: { blurriness: v } });
    } else if (id !== 'timeremap' && !/time remap/i.test(name)) out.unknown.push(name || id);
  }
  return out;
}

/** put the parts of a clip fx reading into a description clip (video parts on video clips, volume on audio clips) */
export function attachFx(c, fx, isVideo) {
  if (isVideo) { if (fx.motion) c.motion = fx.motion; if (fx.opacity) c.opacity = fx.opacity; if (fx.effects.length) c.effects = fx.effects; }
  else if (fx.volume) c.volume = fx.volume;
  return c;
}
