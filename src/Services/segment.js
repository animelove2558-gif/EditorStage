// Remove Background (Create > AI, Effects > Keying): person segmentation with MediaPipe Selfie Segmenter (Apache-2.0,
// bundled in dist/mp/models, runs on the CPU offline). One mask per source frame is computed from the frame the clip
// shows and cached, so playback reuses it and Export waits for exactly the same mask (media.js prepareFrame).
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

const BASE = 'es-app://app/mp';
let segP = null;
const segmenter = () => (segP ||= FilesetResolver.forVisionTasks(`${BASE}/wasm`).then((fs) => ImageSegmenter.createFromOptions(fs, {
  baseOptions: { modelAssetPath: `${BASE}/models/selfie_segmenter.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
})));

const masks = new Map(); // `${mediaId}:${frame}` -> { w, h, data (RGBA, r = person confidence) }
const pending = new Map();
const MAX = 900;
export const maskKey = (mediaId, frame) => `${mediaId}:${frame}`;
export const getMask = (key) => masks.get(key) || null;
/** Store a mask computed elsewhere (also used by the tests). */
export const putMask = (key, m) => { masks.set(key, m); };

/** Segment the frame `el` shows now and cache it under `key`. Resolves with the mask. */
export function computeMask(key, el) {
  if (masks.has(key)) return Promise.resolve(masks.get(key));
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const seg = await segmenter();
    const r = seg.segment(el); const cm = r.confidenceMasks?.[0]; if (!cm) throw new Error('no mask');
    const w = cm.width, h = cm.height; const f = cm.getAsFloat32Array(); const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { const v = Math.round(Math.max(0, Math.min(1, f[i])) * 255); data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
    r.close?.();
    const m = { w, h, data }; masks.set(key, m); if (masks.size > MAX) masks.delete(masks.keys().next().value);
    return m;
  })().finally(() => pending.delete(key));
  pending.set(key, p); p.catch(() => {});
  return p;
}
export const hasRemoveBg = (clip) => (clip.effects || []).some((e) => e.enabled && e.name === 'Remove Background');
