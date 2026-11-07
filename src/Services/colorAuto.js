// Lumetri Auto / Auto Tone / Auto Color / Color Match: grab the clip's ungraded source frame, fit the sliders in the DSP worker,
// write them to clip.lumetri as one undoable edit.
import { getState, edit } from '../Core/store';
import { sourceAt } from '../Core/clipTime';
import { LUMETRI_DEFAULTS } from '../Renderers/fx/videoEffects';
import { elementForMedia, mediaById, releaseKeyed } from './media';
import { toRgb, simulate } from './colorMatch';
import { runDsp } from './dsp';

const once = (el, ev) => new Promise((r) => el.addEventListener(ev, r, { once: true }));
/** The clip's source frame at sequence time t (before any grading), as packed rgb floats (about 96 px wide). withCanvas: also the frame canvas. */
export async function clipFrame(clip, t, withCanvas = false) {
  const m = clip && clip.mediaId && mediaById(clip.mediaId);
  if (!m || (m.kind !== 'video' && m.kind !== 'image')) throw new Error('Select a video or still clip');
  const key = `color:${clip.id}`;
  const el = elementForMedia(m, key); if (!el) throw new Error('The media is not available');
  try {
    if (m.kind === 'video' && el.currentTime !== undefined) {
      el.pause?.(); if (el.readyState < 1) await once(el, 'loadedmetadata');
      const target = sourceAt(clip, t, m.fps || 30, m.duration);
      if (Math.abs(el.currentTime - target) > 0.0005) { const p = once(el, 'seeked'); el.currentTime = target; await p; }
      if (el.readyState < 2) await once(el, 'loadeddata');
    } else if (el.decode) await el.decode().catch(() => {});
    const w0 = el.videoWidth || el.naturalWidth || el.width, h0 = el.videoHeight || el.naturalHeight || el.height;
    if (!w0 || !h0) throw new Error('No frame to analyse');
    const w = 96, h = Math.max(8, Math.round((96 * h0) / w0));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(el, 0, 0, w, h); const px = toRgb(g.getImageData(0, 0, w, h));
    if (!withCanvas) return px;
    const big = document.createElement('canvas'); const k = Math.min(1, 640 / w0); big.width = Math.round(w0 * k); big.height = Math.round(h0 * k); big.getContext('2d').drawImage(el, 0, 0, big.width, big.height);
    return { px, w, h, canvas: big };
  } finally { releaseKeyed(key); }
}
/** Per-pixel mask (w x h) of the face found by the face model in `canvas` (its landmark hull, a little widened), or null. */
export async function faceRegion(canvas, w, h) {
  let lm = null; try { const { detectFace } = await import('./vision'); lm = await detectFace(canvas); } catch { return null; }
  if (!lm || lm.length < 10) return null;
  const xs = lm.map((p) => p[0]), ys = lm.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = ((x1 - x0) / 2) * 1.1, ry = ((y1 - y0) / 2) * 1.1; const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = ((x + 0.5) / w - cx) / rx, v = ((y + 0.5) / h - cy) / ry; out.push(u * u + v * v <= 1); }
  return out;
}
const KEYS = ['exposure', 'contrast', 'whites', 'blacks', 'temperature', 'tint', 'gainR', 'gainG', 'gainB', 'saturation', 'curves'];
function apply(clipId, label, vals) {
  edit(label, ({ seq }) => {
    const c = seq.clips.find((x) => x.id === clipId);
    c.lumetri = { ...LUMETRI_DEFAULTS, ...c.lumetri, ...Object.fromEntries(KEYS.filter((k) => vals[k] !== undefined).map((k) => [k, vals[k]])) };
  });
}
const playheadIn = (c) => { const t = getState().playhead; return Math.min(c.start + c.dur - 1e-3, Math.max(c.start, t)); };

/** mode: 'auto' (tone + color), 'tone', 'color'. */
export async function autoCorrect(clipId, mode = 'auto') {
  const c = getState().sequence.clips.find((x) => x.id === clipId);
  const px = await clipFrame(c, playheadIn(c));
  const op = { auto: 'autoTone', tone: 'autoToneOnly', color: 'autoColor' }[mode];
  const v = await runDsp(op, { px });
  apply(clipId, { auto: 'Lumetri Auto', tone: 'Auto Tone', color: 'Auto Color' }[mode], v);
  return v;
}
/** Color Match: the clip at the playhead takes the look of `refClipId` at sequence time `refTime`. */
export async function applyColorMatch(clipId, refClipId, refTime, faces = true, curves = false) {
  const s = getState(); const c = s.sequence.clips.find((x) => x.id === clipId), r = s.sequence.clips.find((x) => x.id === refClipId);
  if (!r) throw new Error('Choose a reference clip');
  const tf = await clipFrame(c, playheadIn(c), true); const target = tf.px;
  const t = refTime != null && refTime >= r.start && refTime < r.start + r.dur ? refTime : r.start + r.dur / 2;
  const rf = await clipFrame(r, t, true); let reference = rf.px;
  if (r.lumetri) reference = simulate(reference, { ...LUMETRI_DEFAULTS, ...r.lumetri }); // the reference's own grade is part of its look
  // Face Detection: the face model finds the face in both frames; skin is matched inside it (else every skin-coloured pixel)
  let faceBoxes = null;
  if (faces) { const a = await faceRegion(tf.canvas, tf.w, tf.h), b = await faceRegion(rf.canvas, rf.w, rf.h); if (a && b) faceBoxes = { target: a, reference: b }; }
  const v = await runDsp('colorMatch', { target, reference, faces, curves, faceBoxes });
  if (!curves) delete v.curves;
  apply(clipId, 'Apply Color Match', v);
  return v;
}
