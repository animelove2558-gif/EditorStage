import './noTelemetry';
import { FilesetResolver, FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision';

// Offline vision models (bundled in dist/mp, served through es-app://). Lazy singletons.
const BASE = 'es-app://app/mp';
let filesetP = null, facePromise = null, objPromise = null;
const fileset = () => (filesetP ||= FilesetResolver.forVisionTasks(`${BASE}/wasm`));

export const faceLandmarker = () => (facePromise ||= fileset().then((fs) => FaceLandmarker.createFromOptions(fs, {
  baseOptions: { modelAssetPath: `${BASE}/models/face_landmarker.task`, delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1,
  minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4,
})));
export const objectDetector = () => (objPromise ||= fileset().then((fs) => ObjectDetector.createFromOptions(fs, {
  baseOptions: { modelAssetPath: `${BASE}/models/efficientdet_lite0.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', scoreThreshold: 0.3, maxResults: 6,
})));

/** Face landmarks (normalized, y down) for an image/canvas/video frame, or null when no face. */
export async function detectFace(src) {
  const fl = await faceLandmarker(); const r = fl.detect(src);
  return r.faceLandmarks?.[0]?.map((p) => [p.x, p.y]) || null;
}
/** Detected objects as {cat, score, box:[x,y,w,h]} (normalized). */
export async function detectObjects(src) {
  const od = await objectDetector(); const W = src.videoWidth || src.width, H = src.videoHeight || src.height; const r = od.detect(src);
  return (r.detections || []).map((d) => ({ cat: d.categories[0].categoryName, score: d.categories[0].score, box: [d.boundingBox.originX / W, d.boundingBox.originY / H, d.boundingBox.width / W, d.boundingBox.height / H] }));
}

// Face-mesh triangulation derived from MediaPipe's tessellation edges (3-cycles), and the face-oval ring for edge feathering.
let meshCache = null;
export function faceMesh() {
  if (meshCache) return meshCache;
  const edges = FaceLandmarker.FACE_LANDMARKS_TESSELATION; const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const e of edges) { add(e.start, e.end); add(e.end, e.start); }
  const tris = new Set(); const out = [];
  for (const e of edges) { for (const k of adj.get(e.start)) if (adj.get(e.end).has(k)) { const t = [e.start, e.end, k].sort((a, b) => a - b); const key = t.join(','); if (!tris.has(key)) { tris.add(key); out.push(...t); } } }
  const oval = new Set(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.flatMap((e) => [e.start, e.end]));
  meshCache = { indices: new Uint16Array(out), oval };
  return meshCache;
}