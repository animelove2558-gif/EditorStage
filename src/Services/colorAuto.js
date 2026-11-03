// Lumetri Auto / Auto Tone / Auto Color / Color Match: grab the clip's ungraded source frame, fit the sliders in the DSP worker,
// write them to clip.lumetri as one undoable edit.
import { getState, edit } from '../Core/store';
import { sourceAt } from '../Core/clipTime';
import { LUMETRI_DEFAULTS } from '../Renderers/fx/videoEffects';
import { elementForMedia, mediaById } from './media';
import { toRgb, simulate } from './colorMatch';
import { runDsp } from './dsp';

const once = (el, ev) => new Promise((r) => el.addEventListener(ev, r, { once: true }));
/** The clip's source frame at sequence time t (before any grading), as packed rgb floats (about 96 px wide). */
export async function clipFrame(clip, t) {
  const m = clip && clip.mediaId && mediaById(clip.mediaId);
  if (!m || (m.kind !== 'video' && m.kind !== 'image')) throw new Error('Select a video or still clip');
  const el = elementForMedia(m, `color:${clip.id}`); if (!el) throw new Error('The media is not available');
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
  g.drawImage(el, 0, 0, w, h); return toRgb(g.getImageData(0, 0, w, h));
}
const KEYS = ['exposure', 'contrast', 'whites', 'blacks', 'temperature', 'tint', 'gainR', 'gainG', 'gainB', 'saturation'];
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
export async function applyColorMatch(clipId, refClipId, refTime, faces = true) {
  const s = getState(); const c = s.sequence.clips.find((x) => x.id === clipId), r = s.sequence.clips.find((x) => x.id === refClipId);
  if (!r) throw new Error('Choose a reference clip');
  const target = await clipFrame(c, playheadIn(c));
  const t = refTime != null && refTime >= r.start && refTime < r.start + r.dur ? refTime : r.start + r.dur / 2;
  let reference = await clipFrame(r, t);
  if (r.lumetri) reference = simulate(reference, { ...LUMETRI_DEFAULTS, ...r.lumetri }); // the reference's own Basic Correction is part of its look
  const v = await runDsp('colorMatch', { target, reference, faces });
  apply(clipId, 'Apply Color Match', v);
  return v;
}
