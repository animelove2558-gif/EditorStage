// Remove Background (Create > AI, Effects > Keying): on-device segmentation, bundled in dist/mp/models, CPU, offline.
// Subject (the effect's Subject parameter):
//   People           MediaPipe Selfie Segmenter
//   Animals / Vehicles / Any Object   DeepLab v3 (21 PASCAL VOC classes: the matching classes' confidence is added up)
//   Object at Point  MediaPipe Interactive Segmenter (Magic Touch): whatever object is under the effect's Object Point
// One mask per source frame (and subject) is computed from the frame the clip shows and cached, so playback reuses it and
// Export waits for exactly the same mask (exporter.js prepareFrame).
// (Magic Touch is the published single-file model: it runs through the Legacy interactive segmenter API)
import { FilesetResolver, ImageSegmenter, InteractiveSegmenterLegacy } from '@mediapipe/tasks-vision';
import { resolveParams } from '../Core/params';

const BASE = 'es-app://app/mp';
let filesP = null; const models = {};
const files = () => (filesP ||= FilesetResolver.forVisionTasks(`${BASE}/wasm`));
const opts = (file) => ({ baseOptions: { modelAssetPath: `${BASE}/models/${file}`, delegate: 'CPU' }, outputConfidenceMasks: true, outputCategoryMask: false });
const selfie = () => (models.selfie ||= files().then((fs) => ImageSegmenter.createFromOptions(fs, { ...opts('selfie_segmenter.tflite'), runningMode: 'IMAGE' })));
const deeplab = () => (models.deeplab ||= files().then((fs) => ImageSegmenter.createFromOptions(fs, { ...opts('deeplab_v3.tflite'), runningMode: 'IMAGE' })));
const magic = () => (models.magic ||= files().then((fs) => InteractiveSegmenterLegacy.createFromOptions(fs, opts('magic_touch.tflite'))));

export const SUBJECTS = ['People', 'Animals', 'Vehicles', 'Any Object', 'Object at Point'];
// DeepLab v3 labels: 0 background, 1 aeroplane, 2 bicycle, 3 bird, 4 boat, 5 bottle, 6 bus, 7 car, 8 cat, 9 chair, 10 cow,
// 11 dining table, 12 dog, 13 horse, 14 motorbike, 15 person, 16 potted plant, 17 sheep, 18 sofa, 19 train, 20 tv / monitor
export const SUBJECT_CLASSES = { 1: [3, 8, 10, 12, 13, 17], 2: [1, 2, 4, 6, 7, 14, 19], 3: Array.from({ length: 20 }, (_, i) => i + 1) };

const masks = new Map(); // `${mediaId}:${frame}[:variant]` -> { w, h, data (RGBA, r = subject confidence) }
const pending = new Map();
const MAX = 900;
export const maskKey = (mediaId, frame, variant = '') => `${mediaId}:${frame}${variant ? ':' + variant : ''}`;
export const getMask = (key) => masks.get(key) || null;
/** Store a mask computed elsewhere (also used by the tests). */
export const putMask = (key, m) => { masks.set(key, m); };

/** The clip's Remove Background subject at clip-local time: { subject (index), point, variant (part of the mask key) }. */
export function removeBgOptions(clip, local = 0) {
  const fx = (clip.effects || []).find((e) => e.enabled && e.name === 'Remove Background'); if (!fx) return { subject: 0, point: null, variant: '' };
  const v = resolveParams(fx.params || {}, local); const subject = Math.max(0, Math.min(SUBJECTS.length - 1, Math.round(+v.subject || 0)));
  const point = subject === 4 ? [Math.min(1, Math.max(0, (v.objPoint || [0.5, 0.5])[0])), Math.min(1, Math.max(0, (v.objPoint || [0.5, 0.5])[1]))] : null;
  return { subject, point, variant: subject === 0 ? '' : subject === 4 ? `p${point[0].toFixed(3)},${point[1].toFixed(3)}` : `s${subject}` };
}

function toMask(cms, pick) {
  const w = cms[0].width, h = cms[0].height; const fs = pick.map((k) => cms[k]?.getAsFloat32Array()).filter(Boolean);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { let s = 0; for (const f of fs) s += f[i]; const v = Math.round(Math.max(0, Math.min(1, s)) * 255); data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return { w, h, data };
}
/** Segment the frame `el` shows now and cache it under `key`. o: removeBgOptions(). Resolves with the mask. */
export function computeMask(key, el, o = { subject: 0 }) {
  if (masks.has(key)) return Promise.resolve(masks.get(key));
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    let r;
    if (o.subject === 4) r = (await magic()).segment(el, { keypoint: { x: o.point[0], y: o.point[1] } });
    else if (o.subject > 0) r = (await deeplab()).segment(el);
    else r = (await selfie()).segment(el);
    const cms = r.confidenceMasks || []; if (!cms.length) throw new Error('no mask');
    const m = toMask(cms, o.subject > 0 && o.subject < 4 ? SUBJECT_CLASSES[o.subject] : [0]);
    r.close?.();
    masks.set(key, m); if (masks.size > MAX) masks.delete(masks.keys().next().value);
    return m;
  })().finally(() => pending.delete(key));
  pending.set(key, p); p.catch(() => {});
  return p;
}
export const hasRemoveBg = (clip) => (clip.effects || []).some((e) => e.enabled && e.name === 'Remove Background');
