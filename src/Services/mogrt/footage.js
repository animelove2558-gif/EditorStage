// Decoding of the media packed inside a .mogrt (project.aegraphic "(Footage)" folder) into drawable sources.
//   images (native)        -> ImageBitmap / HTMLImageElement (svg)
//   psd / psb              -> canvas (flattened composite, ./psd.js)
//   ai / pdf / eps(pdf)    -> canvas (first page via pdf.js)
//   video                  -> HTMLVideoElement (frame-seeked by time); non-native codecs are transcoded with FFmpeg
//   other stills (tiff...) -> FFmpeg -> png
//   audio                  -> { audioUrl } for playback / offline mix
import { decodePsd } from './psd';

const IMG = /\.(jpe?g|png|gif|webp|bmp|ico|avif)$/i, SVG = /\.svg$/i, PSD = /\.(psd|psb)$/i, PDFLIKE = /\.(ai|pdf|eps)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|mxf|mpe?g|ts|m2ts|mts|wmv|flv|3gp)$/i, NATIVE_VIDEO = /\.(mp4|m4v|webm|mov|mkv)$/i;
const AUDIO = /\.(wav|mp3|aac|m4a|ogg|opus|flac|aif|aiff|wma)$/i, NATIVE_AUDIO = /\.(wav|mp3|aac|m4a|ogg|opus|flac)$/i;
const STILL_FF = /\.(tiff?|tga|exr|dpx|heic|heif|jp2|cin|hdr|pct|pict|iff)$/i;

async function writeTemp(name, data) {
  const es = typeof window !== 'undefined' && window.editorstage; if (!es || !es.tmpDir || !es.writeFile) return null;
  const dir = await es.tmpDir(); const sep = dir.includes('\\') ? '\\' : '/';
  let h = 2166136261; for (let i = 0; i < data.length; i += Math.max(1, data.length >> 12)) h = Math.imul(h ^ data[i], 16777619);
  const p = `${dir}${sep}editorstage-mogrt-${(h >>> 0).toString(36)}-${data.length}-${name.replace(/[^\w.\-]+/g, '_')}`;
  await es.writeFile(p, data); return p;
}
const blobUrl = (data, type) => URL.createObjectURL(new Blob([data], type ? { type } : undefined));
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', wav: 'audio/wav', mp3: 'audio/mpeg', aac: 'audio/aac', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' };
const mimeOf = (name) => MIME[(name.split('.').pop() || '').toLowerCase()];
/** FFmpeg fallback (main process): returns the converted file's bytes */
async function transcoded(name, data, kind) {
  const p = await writeTemp(name, data); if (!p) return null;
  const r = await window.editorstage.transcode(p, kind); if (!r.ok) throw new Error(r.error);
  return new Uint8Array(await window.editorstage.readFile(r.path));
}
function loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('image decode failed')); im.src = url; }); }
function loadVideo(url) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.playsInline = true;
    v.onloadeddata = () => res(v); v.onerror = () => rej(new Error('video decode failed')); v.src = url; setTimeout(() => rej(new Error('video load timeout')), 15000);
  });
}

let pdfjs = null;
async function renderPdf(data, scale = 2) {
  if (!pdfjs) {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).href;
  }
  const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: false }).promise;
  const page = await doc.getPage(1); const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
  return c;
}

/**
 * Decode one packed file. Returns a source:
 *   { kind:'image', image, width, height } | { kind:'video', video, width, height, duration } | { kind:'audio', url } | null
 */
export async function decodeFootageFile(file, footage) {
  const name = file.name; const data = file.data;
  try {
    if (IMG.test(name)) { const bm = await createImageBitmap(new Blob([data])); return { kind: 'image', image: bm, width: bm.width, height: bm.height }; }
    if (SVG.test(name)) { const im = await loadImage(blobUrl(data, 'image/svg+xml')); return { kind: 'image', image: im, width: im.naturalWidth || footage?.width, height: im.naturalHeight || footage?.height }; }
    if (PSD.test(name)) { const id = decodePsd(data); const c = document.createElement('canvas'); c.width = id.width; c.height = id.height; c.getContext('2d').putImageData(id, 0, 0); return { kind: 'image', image: c, width: id.width, height: id.height }; }
    if (PDFLIKE.test(name)) {
      const w = footage?.width || 0; const c0 = await renderPdf(data, 1); const k = w ? Math.min(4, Math.max(1, (w * 2) / c0.width)) : 2;
      const c = k === 1 ? c0 : await renderPdf(data, k); return { kind: 'image', image: c, width: footage?.width || c.width / k, height: footage?.height || c.height / k };
    }
    // videos / audio play from in-memory blob: URLs (always seekable; the es-media:// stream does not serve byte ranges)
    if (VIDEO.test(name)) {
      if (NATIVE_VIDEO.test(name)) { const url = blobUrl(data, mimeOf(name)); try { const v = await loadVideo(url); return { kind: 'video', video: v, width: v.videoWidth, height: v.videoHeight, duration: v.duration, url }; } catch { URL.revokeObjectURL(url); /* codec not supported -> transcode */ } }
      const conv = await transcoded(name, data, 'video'); if (!conv) return null;
      const url = blobUrl(conv, 'video/mp4'); const v = await loadVideo(url); return { kind: 'video', video: v, width: v.videoWidth, height: v.videoHeight, duration: v.duration, url };
    }
    if (AUDIO.test(name)) {
      if (NATIVE_AUDIO.test(name)) return { kind: 'audio', url: blobUrl(data, mimeOf(name)) };
      const conv = await transcoded(name, data, 'audio'); return conv ? { kind: 'audio', url: blobUrl(conv, 'audio/wav') } : null;
    }    if (STILL_FF.test(name) || /\.\w+$/.test(name)) {
      try { const bm = await createImageBitmap(new Blob([data])); return { kind: 'image', image: bm, width: bm.width, height: bm.height }; } catch { /* not native */ }
      const conv = await transcoded(name, data, 'image'); if (!conv) return null;
      const bm = await createImageBitmap(new Blob([conv], { type: 'image/png' })); return { kind: 'image', image: bm, width: bm.width, height: bm.height };
    }
  } catch (e) { console.warn('MOGRT footage decode failed:', name, e); return { kind: 'error', error: String(e.message || e) }; }
  return null;
}

const playingVideos = new Map(); // video element -> last time it was needed during playback
/**
 * Access to video sources. Paused/scrubbing: frame-accurate-ish, seeks when off by more than half a frame.
 * Playing: the element plays on its own and is only re-synced when it drifts (seeking every frame stalls the decoder).
 */
export function videoFrame(src, time, fps = 30, playing = false) {
  const v = src.video; const d = isFinite(v.duration) ? v.duration : src.duration || 0;
  const t = Math.max(0, Math.min(d ? d - 0.001 : time, time));
  if (playing) {
    playingVideos.set(v, performance.now());
    const drift = Math.abs(v.currentTime - t);
    if (v.paused) { if (drift > 0.5 / fps && !v.seeking) { try { v.currentTime = t; } catch { /* not seekable yet */ } } if (!d || t < d - 0.05) v.play().catch(() => {}); }
    else if (drift > 0.3 && !v.seeking) { try { v.currentTime = t; } catch { /* not seekable yet */ } }
    return v;
  }
  if (!v.paused) { v.pause(); playingVideos.delete(v); }
  if (Math.abs(v.currentTime - t) > 0.5 / fps && !v.seeking) { try { v.currentTime = t; } catch { /* not seekable yet */ } }
  return v;
}
/** Pause template videos that playback no longer uses (clip left the playhead, playback stopped). */
export function pauseIdleVideos(maxIdleMs = 300) {
  const now = performance.now();
  for (const [v, last] of playingVideos) if (now - last > maxIdleMs) { if (!v.paused) v.pause(); playingVideos.delete(v); }
}
/** Seek every video source to its time and wait (export / exact frames). */
export function seekVideos(list) {
  return Promise.all(list.map(({ src, time }) => new Promise((res) => {
    const v = src.video; const d = isFinite(v.duration) ? v.duration : 0; const t = Math.max(0, d ? Math.min(d - 0.001, time) : time);
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - t) < 0.0005 && v.readyState >= 2) return res();
    const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = t; setTimeout(done, 2000);
  })));
}
