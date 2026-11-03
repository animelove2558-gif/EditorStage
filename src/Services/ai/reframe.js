// Smart Auto-Reframe: duplicate a sequence into another aspect ratio (e.g. 16:9 -> 9:16) and keep the subject
// (person / face / main object) in frame with editable Motion keyframes (scale to cover + animated anchor).
import { getState, addSequence, allSeqs } from '../../Core/store';
import { mediaById, fileUrl, clipSourceTime } from '../media';
import { detectObjects, detectFace } from '../vision';
import { DEFAULT_MOTION } from '../../Core/params';

export const ASPECTS = [['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9]];
const uid = () => Math.random().toString(36).slice(2, 9);
const seekTo = (el, t) => new Promise((res) => { const d = () => { el.removeEventListener('seeked', d); res(); }; el.addEventListener('seeked', d); el.currentTime = t; setTimeout(d, 2000); });

/** Normalised subject centre per sample (person > largest object > face > motion/detail centroid). */
export async function trackSubject(clip, media, rate = 6, onProgress) {
  const el = document.createElement('video'); el.crossOrigin = 'anonymous'; el.muted = true; el.preload = 'auto'; el.src = fileUrl(media.playPath);
  await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('cannot load ' + media.name)); });
  const dv = document.createElement('canvas'); dv.width = 320; dv.height = Math.max(2, Math.round(320 * ((el.videoHeight || 9) / (el.videoWidth || 16))));
  const g = dv.getContext('2d', { willReadFrequently: true }); const n = Math.max(2, Math.ceil(clip.dur * rate)); const path = []; let prev = null, hits = 0;
  for (let k = 0; k < n; k++) {
    await seekTo(el, clipSourceTime(clip, clip.start + Math.min(clip.dur - 0.01, k / rate), media)); g.drawImage(el, 0, 0, dv.width, dv.height);
    let c = null, conf = 0;
    try {
      const objs = await detectObjects(dv);
      const people = objs.filter((o) => o.cat === 'person').sort((a, b) => b.score * b.box[2] * b.box[3] - a.score * a.box[2] * a.box[3]);
      const pick = people[0] || objs.slice().sort((a, b) => b.score * Math.sqrt(b.box[2] * b.box[3]) - a.score * Math.sqrt(a.box[2] * a.box[3]))[0];
      if (pick) { c = [pick.box[0] + pick.box[2] / 2, pick.box[1] + pick.box[3] * (pick.cat === 'person' ? 0.35 : 0.5)]; conf = pick.score; }
      if (people[0]) { const fl = await detectFace(dv).catch(() => null); if (fl) { let x = 0, y = 0; for (const p of fl) { x += p[0]; y += p[1]; } c = [x / fl.length, y / fl.length]; conf = 1; } }
      else if (!c) { const fl = await detectFace(dv).catch(() => null); if (fl) { let x = 0, y = 0; for (const p of fl) { x += p[0]; y += p[1]; } c = [x / fl.length, y / fl.length]; conf = 0.9; } }
    } catch { /* detector unavailable */ }
    const d = g.getImageData(0, 0, dv.width, dv.height).data; const W = dv.width, H = dv.height; const gray = new Float32Array(W * H); for (let i = 0; i < W * H; i++) gray[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    if (c) hits++;
    else { let sw = 0, sx = 0, sy = 0; for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) { const i = y * W + x; const w = Math.abs(gray[i + 1] - gray[i - 1]) * 0.3 + (prev ? Math.abs(gray[i] - prev[i]) * 2 : 0) + 0.01; sw += w; sx += w * x; sy += w * y; } c = [sx / sw / W, sy / sw / H]; conf = 0.2; }
    prev = gray; path.push({ t: Math.min(clip.dur, k / rate), x: c[0], y: c[1], conf });
    onProgress?.(k / n);
  }
  el.removeAttribute('src'); el.load();
  return { path, hits };
}

/** Smooth (confidence-weighted moving average) and turn the path into Motion keyframes for a cover-fit crop. */
export function reframeMotion(path, { srcAspect, dstAspect, smooth = 1.2, keyEvery = 0.5 }) {
  // DRAW_FRAG model: at 100% the source is fit inside the frame; spans of the visible source at scale 1:
  const sa = srcAspect, fa = dstAspect; const ws = sa >= fa ? fa : sa, hs = sa >= fa ? fa / sa : 1;
  const spanX1 = fa / ws, spanY1 = 1 / hs; const S = Math.max(spanX1, spanY1); // cover
  const vx = spanX1 / S, vy = spanY1 / S; // visible fraction of the source
  const sm = (t) => { let sx = 0, sy = 0, sw = 0; for (const p of path) { const w = Math.exp(-(((p.t - t) / Math.max(0.05, smooth)) ** 2)) * (0.15 + p.conf); sx += p.x * w; sy += p.y * w; sw += w; } return [sx / sw, sy / sw]; };
  const clampA = ([x, y]) => [Math.min(1 - vx / 2, Math.max(vx / 2, x)), Math.min(1 - vy / 2, Math.max(vy / 2, y))];
  const end = path.length ? path[path.length - 1].t : 0; const keys = [];
  for (let t = 0; t <= end + 1e-6; t += keyEvery) { const v = clampA(sm(t)).map((q) => +q.toFixed(4)); if (keys.length && Math.abs(keys[keys.length - 1].v[0] - v[0]) < 0.002 && Math.abs(keys[keys.length - 1].v[1] - v[1]) < 0.002 && t < end) continue; keys.push({ t: +t.toFixed(3), v }); }
  return { scale: S * 100, anchorKeys: keys.length > 1 ? keys : null, anchor: keys[0]?.v || [0.5, 0.5] };
}

/**
 * Create "<name> (9:16)" from the active sequence: same clips, new frame size, every video clip reframed on its subject.
 * opts: { aspect: '9:16', height: 1920, smooth (s), activate }
 */
export async function reframeSequence(opts = {}, onProgress = () => {}) {
  const s = getState(); const src = s.sequence; const aspect = ASPECTS.find((a) => a[0] === (opts.aspect || '9:16'))?.[1] || 9 / 16;
  const long = Math.max(src.width, src.height); const H = aspect < 1 ? long : Math.round(long / aspect), W = Math.round(H * aspect) & ~1;
  const seq = { ...structuredClone(src), id: uid(), name: `${src.name} (${opts.aspect || '9:16'})`, width: W, height: H & ~1 };
  const report = await reframeClips(seq, opts, onProgress);
  addSequence(seq, opts.activate !== false);
  return { sequence: seq, report, total: Object.keys(allSeqs()).length };
}
/** Reframe every video clip of a sequence object (already at its new frame size) on its subject. Returns the report lines. */
export async function reframeClips(seq, opts = {}, onProgress = () => {}) {
  const W = seq.width, H = seq.height;
  const vtracks = new Set(seq.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
  const clips = seq.clips.filter((c) => vtracks.has(c.track) && c.mediaId && !c.asAudio && mediaById(c.mediaId) && mediaById(c.mediaId).kind !== 'audio');
  let i = 0; const report = [];
  for (const c of clips) {
    if (opts.isCancelled?.()) throw new Error('Cancelled');
    const m = mediaById(c.mediaId); const sa = (m.width || 16) / (m.height || 9);
    let path = [{ t: 0, x: 0.5, y: 0.5, conf: 1 }], hits = 0;
    if (m.kind === 'video') { try { const r = await trackSubject(c, m, opts.rate || 6, (p) => onProgress({ clip: c.name, index: i, total: clips.length, progress: (i + p) / clips.length })); path = r.path; hits = r.hits; } catch (e) { report.push(`${c.name}: ${e.message}`); } }
    else if (m.kind === 'image') { const img = new Image(); img.src = fileUrl(m.playPath); await img.decode().catch(() => {}); try { const objs = await detectObjects(img); const p = objs.find((o) => o.cat === 'person') || objs[0]; if (p) path = [{ t: 0, x: p.box[0] + p.box[2] / 2, y: p.box[1] + p.box[3] * 0.4, conf: 1 }]; } catch { /* keep centre */ } }
    const mo = reframeMotion(path, { srcAspect: sa, dstAspect: W / H, smooth: opts.smooth ?? 1.2 });
    c.motion = { ...DEFAULT_MOTION(), ...(c.motion || {}), position: { v: [0.5, 0.5], keys: null }, scale: { v: mo.scale, keys: null }, uniform: { v: true, keys: null }, anchor: { v: mo.anchor, keys: mo.anchorKeys } };
    c.effects = (c.effects || []).filter((f) => f.name !== 'Auto Reframe');
    report.push(`${c.name}: ${m.kind === 'video' ? `${hits}/${path.length} samples with a detected subject` : 'still image'}`);
    i++; onProgress({ clip: c.name, index: i, total: clips.length, progress: i / clips.length });
  }
  return report;
}
