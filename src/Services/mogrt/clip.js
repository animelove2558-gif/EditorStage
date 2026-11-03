import { getPrepared, prepareMogrt, renderMogrt, prepareMogrtFrame } from './render';
import { getState } from '../../Core/store';

/**
 * Responsive Design - Time: protected regions (comp markers flagged protectedRegion) keep their speed; the rest of the
 * template stretches/compresses so the animation fits the clip duration.
 */
export function responsiveTime(markers, D, C, local) {
  const prot = (markers || []).filter((m) => m.protectedRegion && m.duration > 0).map((m) => [Math.max(0, m.time), Math.min(D, m.time + m.duration)]).sort((a, b) => a[0] - b[0]);
  if (!prot.length) return local;
  const merged = []; for (const p of prot) { const l = merged[merged.length - 1]; if (l && p[0] <= l[1]) l[1] = Math.max(l[1], p[1]); else merged.push([...p]); }
  const P = merged.reduce((s, p) => s + (p[1] - p[0]), 0); const M = D - P; if (M <= 1e-6) return local;
  const k = Math.max(0, C - P) / M; const segs = []; let cur = 0;
  for (const [a, b] of merged) { if (a > cur) segs.push({ a: cur, b: a, free: true }); segs.push({ a, b, free: false }); cur = b; }
  if (cur < D) segs.push({ a: cur, b: D, free: true });
  let acc = 0;
  for (const s of segs) {
    const outLen = s.free ? (s.b - s.a) * k : s.b - s.a; if (outLen <= 1e-9) continue;
    if (local < acc + outLen) return s.a + ((local - acc) / outLen) * (s.b - s.a);
    acc += outLen;
  }
  return D;
}

/** template time (seconds inside the AE comp) for a timeline clip at sequence time t */
export function templateTime(inst, clip, t) {
  const meta = inst.entry.pkg.meta; const local = Math.max(0, t - clip.start);
  const D = meta.workOut || meta.duration;
  const responsive = meta.responsiveDesignVersion !== '0' && inst.comp.markers?.some((m) => m.protectedRegion);
  let tt = responsive ? responsiveTime(inst.comp.markers, D, clip.dur, local) : (clip.inPoint || 0) + local * (clip.speed || 1);
  tt = Math.min(Math.max(0, tt), Math.max(0, D - 1 / (meta.fps || 30)));
  return { tt, local };
}

/** Canvas for a MOGRT timeline clip at sequence time t (null until the template is parsed). */
export function mogrtCanvasForClip(clip, t, dims, opts) {
  const inst = getPrepared(clip.mogrt.libId);
  if (!inst) { prepareMogrt(clip.mogrt.libId).catch((e) => { clip.__err = String(e.message || e); }); return null; }
  const { tt, local } = templateTime(inst, clip, t);
  const w = dims?.w || getState().sequence.width;
  try { return renderMogrt(inst, clip.id, clip.mogrt.values, tt, local, w, opts); } catch (e) { if (!clip.__warned) { clip.__warned = true; console.warn('MOGRT render failed', e); } return null; }
}

/** Export: make sure the template is parsed and its videos sit on the exact frame for sequence time t. */
export async function prepareMogrtClipFrame(clip, t) {
  const inst = await prepareMogrt(clip.mogrt.libId).catch(() => null); if (!inst) return;
  const { tt, local } = templateTime(inst, clip, t);
  await prepareMogrtFrame(inst, clip.mogrt.values, tt, local);
}
