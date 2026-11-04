// Timeline thumbnails of nested sequences and motion graphics templates (View > Video Thumbnails): there is no media file
// for FFmpeg to decode, so the clip is composited alone (exporter.renderClipFrame) at the tile's time. One render at a time,
// only while playback is stopped, cached by the clip's content (a moved clip, an edit inside the nest or a changed
// template parameter makes new tiles).
import { getState, allSeqs } from '../Core/store';
import { renderClipFrame } from './exporter';
import { renderBucket } from './thumbs';

const ids = new WeakMap(); let nextId = 1;
const idOf = (o) => { if (!o || typeof o !== 'object') return 0; let v = ids.get(o); if (!v) { v = nextId++; ids.set(o, v); } return v; };
const cache = new Map(); const LIMIT = 300;
const queue = []; let busy = false;
const remember = (k, u) => { cache.delete(k); cache.set(k, u); while (cache.size > LIMIT) cache.delete(cache.keys().next().value); };

/** cache key of a tile: the clip object, the nested sequence object (the store keeps unchanged objects), frame, height */
export function clipThumbKey(clip, t, h) {
  const fps = getState().sequence.fps || 30; const sub = clip.nestId ? allSeqs()[clip.nestId] : null;
  return `${idOf(clip)}|${idOf(sub)}|${Math.round((t - clip.start) * fps)}|${renderBucket(h)}`;
}
export const cachedClipThumb = (clip, t, h) => cache.get(clipThumbKey(clip, t, h)) || null;
/** data URL of the clip rendered alone at sequence time t, about h px high (null if it cannot be rendered) */
export function requestClipThumb(clip, t, h) {
  const k = clipThumbKey(clip, t, h); if (cache.has(k)) return Promise.resolve(cache.get(k));
  const w = queue.find((j) => j.k === k); if (w) return new Promise((r) => w.res.push(r));
  return new Promise((r) => { queue.push({ k, clipId: clip.id, t, h: renderBucket(h), res: [r] }); pump(); });
}
async function pump() {
  if (busy || !queue.length) return;
  if (getState().playing) { setTimeout(pump, 400); return; } // never seek the preview's videos during playback
  busy = true; const j = queue.shift(); let url = null;
  try {
    const s = getState().sequence; const hh = j.h; const ww = Math.max(2, Math.round((hh * (s.width || 16)) / (s.height || 9)));
    const img = await renderClipFrame(j.clipId, j.t, ww, hh);
    if (img) { const c = document.createElement('canvas'); c.width = ww; c.height = hh; c.getContext('2d').putImageData(img, 0, 0); url = c.toDataURL('image/jpeg', 0.8); remember(j.k, url); }
  } catch { /* not renderable now: no tile */ }
  busy = false; j.res.forEach((f) => f(url)); setTimeout(pump, 0);
}
export const clipThumbQueue = () => queue.length + (busy ? 1 : 0);
