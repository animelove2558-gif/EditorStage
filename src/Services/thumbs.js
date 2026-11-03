// Timeline clip thumbnails (View > Video Thumbnails). Frames are decoded by FFmpeg in the main process (several frames per
// call), never on the UI thread, and kept in an LRU cache keyed by media + source frame + size. Which frame each tile shows
// comes from the same time model as playback and export (clipTime.sourceAt: speed, reverse, time remapping, frame hold).
import { sourceAt } from '../Core/clipTime';
import { syntheticCanvas } from './synthetic';

export const THUMB_MODES = ['none', 'head', 'headTail', 'continuous'];
export const THUMB_LABELS = { none: 'None', head: 'Head', headTail: 'Head and Tail', continuous: 'Continuous' };
const MAX_TILES = 120;

/**
 * Tiles of one clip for a mode: [{ x, w, src }] — x / w in px inside the clip, src = source time (seconds) of the frame.
 * W = clip width (px), tw = tile width (px), pps = px per second. The head tile shows the first frame, the tail tile the
 * last one; continuous tiles show the frame at their left edge (at most MAX_TILES tiles; wider tiles when capped).
 */
export function thumbSlots(clip, { W, tw, pps, mode, fps = 30, mediaDur = Infinity }) {
  if (mode === 'none' || !(W > 2) || !(tw > 1)) return [];
  const at = (x) => sourceAt(clip, clip.start + Math.min(clip.dur - 1 / fps / 2, Math.max(0, x / pps)), fps, mediaDur);
  const tail = () => sourceAt(clip, clip.start + Math.max(0, clip.dur - 1 / fps), fps, mediaDur);
  if (mode === 'head' || (mode === 'headTail' && W < tw * 2)) return [{ x: 0, w: Math.min(W, tw), src: at(0) }];
  if (mode === 'headTail') return [{ x: 0, w: tw, src: at(0) }, { x: W - tw, w: tw, src: tail() }];
  const n = Math.min(MAX_TILES, Math.ceil(W / tw)); const step = Math.max(tw, W / n); const out = [];
  for (let i = 0; i < n; i++) { const x = i * step; out.push({ x, w: Math.min(step, W - x), src: at(x) }); }
  return out;
}

/** Height buckets the frames are decoded at (so zooming the track height re-uses the cache). */
const bucket = (h) => [36, 72, 144, 288].find((b) => b >= h) || 288;
export const frameIndex = (src, fps) => Math.max(0, Math.floor(src * fps + 1e-6));

// ---- cache + decode queue ----
const cache = new Map(); // key -> url (LRU by insertion order)
const waiting = new Map(); // key -> { media, fi, h, resolvers: [] }
const LIMIT = 1500;
let running = 0;
const remember = (key, url) => {
  cache.delete(key); cache.set(key, url);
  while (cache.size > LIMIT) { const [k, u] = cache.entries().next().value; cache.delete(k); if (u.startsWith('blob:')) URL.revokeObjectURL(u); }
};
const keyOf = (media, fi, h) => `${media.id}|${media.rev || 0}|${media.playPath || ''}|${fi}|${h}`;

/** Cached URL of a frame, or null (then call requestThumb). */
export function cachedThumb(media, src, h) {
  const fps = media.fps || 30; const k = keyOf(media, frameIndex(src, fps), bucket(h)); const u = cache.get(k);
  if (u) remember(k, u); return u || null;
}
/** URL (object URL / data URL) of the frame of `media` at source time `src`, about `h` px high. */
export function requestThumb(media, src, h) {
  const fps = media.fps || 30; const fi = media.kind === 'image' ? 0 : frameIndex(src, fps); const hb = bucket(h); const k = keyOf(media, fi, hb);
  if (cache.has(k)) return Promise.resolve(cache.get(k));
  if (media.synthetic) { // drawn here (cheap canvas), nothing to decode
    const cv = syntheticCanvas(media, `thumb:${media.id}`, fi / fps); if (!cv) return Promise.resolve(null);
    const c = document.createElement('canvas'); c.height = hb; c.width = Math.max(2, Math.round(hb * cv.width / cv.height));
    c.getContext('2d').drawImage(cv, 0, 0, c.width, c.height); const u = c.toDataURL('image/jpeg', 0.8); remember(k, u); return Promise.resolve(u);
  }
  return new Promise((resolve) => {
    const w = waiting.get(k); if (w) { w.resolvers.push(resolve); return; }
    waiting.set(k, { key: k, media, fi, h: hb, resolvers: [resolve] }); pump();
  });
}
const BATCH = 8;
async function pump() {
  if (running >= 2 || !waiting.size) return;
  // one FFmpeg call decodes up to BATCH frames of the same file (one input per frame, input seeking)
  const first = waiting.values().next().value; const jobs = [...waiting.values()].filter((j) => j.media.playPath === first.media.playPath && j.h === first.h).slice(0, BATCH);
  for (const j of jobs) waiting.delete(j.key);
  running++;
  try {
    const es = window.editorstage; const tmp = await es.tmpDir(); const sep = tmp.includes('\\') ? '\\' : '/'; const tag = Math.random().toString(36).slice(2, 8);
    const fps = first.media.fps || 30; const still = first.media.kind === 'image';
    const args = ['-v', 'error', '-y', '-nostdin'];
    for (const j of jobs) { if (!still) args.push('-ss', Math.max(0, (j.fi - 0.25) / fps).toFixed(5)); args.push('-i', j.media.playPath); }
    const outs = jobs.map((_, i) => `${tmp}${sep}es-thumb-${tag}-${i}.jpg`);
    jobs.forEach((j, i) => args.push('-map', `${i}:v:0`, '-frames:v', '1', '-vf', `scale=-2:${j.h}`, '-q:v', '4', outs[i]));
    const r = await es.ffmpeg(args);
    await Promise.all(jobs.map(async (j, i) => {
      let url = null;
      if (r.ok) { try { const b = await es.readFile(outs[i]); url = URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })); remember(j.key, url); } catch { /* frame past the end: no tile */ } }
      es.removeFile?.(outs[i]).catch?.(() => {});
      j.resolvers.forEach((f) => f(url));
    }));
  } catch { jobs.forEach((j) => j.resolvers.forEach((f) => f(null))); }
  finally { running--; pump(); }
}
export const thumbCacheSize = () => cache.size;
