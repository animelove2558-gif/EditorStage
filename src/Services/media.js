import { edit, getState } from '../Core/store';
import { evalParam } from '../Core/params';
import { updateAudio, disposeClipAudio } from './audioEngine';
import { clearPeaks } from './waveform';
import { graphicCanvas } from './graphics';
import { maskKey, getMask, computeMask } from './segment';
import { flatten } from '../Core/flatten';
import { mogrtCanvasForClip } from './mogrt/clip';
import { syncMogrtAudio } from './mogrt/audio';
import { pauseIdleVideos } from './mogrt/footage';
import { captionCanvas } from './ai/captions';
import { sourceAt, playRateAt, isRetimed } from '../Core/clipTime';
import { syntheticCanvas, syntheticAudioUrl, isAdjustment, offlineCanvas } from './synthetic';
import { getPrefs } from '../Core/prefs';
import { REF_PREFIX } from '../Core/compare';

// ---- Universal media support: classification, probing, fallback transcode, playback element pool ----
export const EXT = {
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'prores', 'hevc', 'h265', 'h264', '264', '265', 'mpeg', 'mpg', 'mpe', 'm2v', 'm4v', 'ts', 'mts', 'm2ts', 'flv', 'f4v', 'mxf', '3gp', '3g2', 'wmv', 'asf', 'vob', 'ogv', 'dv', 'dif', 'rm', 'rmvb', 'mod', 'tod', 'y4m', 'ivf', 'av1', 'obu', 'mjpeg', 'mjpg', 'divx', 'xvid', 'qt', 'gifv', 'nut', 'amv'],
  image: ['jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'avif', 'jxl', 'tiff', 'tif', 'bmp', 'ico', 'cur', 'svg', 'heic', 'heif', 'tga', 'exr', 'hdr', 'dpx', 'jp2', 'j2k', 'pcx', 'ppm', 'pgm', 'pbm', 'pnm', 'pam', 'qoi', 'sgi', 'psd', 'psb', 'ai', 'eps', 'pdf',
    'raw', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'kdc', 'dcr', 'erf', 'mos', 'mrw', 'iiq', 'rwl'],
  audio: ['wav', 'wave', 'bwf', 'mp3', 'mp2', 'aac', 'm4a', 'm4b', 'flac', 'ogg', 'oga', 'opus', 'aiff', 'aif', 'aifc', 'wma', 'ac3', 'eac3', 'dts', 'amr', 'ape', 'wv', 'mka', 'caf', 'au', 'snd', 'mpc', 'tta', 'spx', 'w64', 'rf64', 'voc', 'gsm', 'ra'],
};
// Chromium-native (tier 1). PSD/AI/PDF/EPS and camera RAW are decoded in the app (tier 2); everything else goes through FFmpeg (tier 3).
const NATIVE = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg', 'wav', 'wave', 'mp3', 'aac', 'm4a', 'flac', 'ogg', 'oga', 'opus']);
const IN_APP = new Set(['psd', 'psb', 'ai', 'pdf', 'eps', 'raw', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'kdc', 'dcr', 'erf', 'mos', 'mrw', 'iiq', 'rwl']);

export const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
export const kindOf = (name) => Object.keys(EXT).find((k) => EXT[k].includes(extOf(name))) || null;
/** media URL with a cache-busting revision (bumped when a file changes on disk, e.g. after Edit in AudioStage) */
export const mediaUrl = (m) => (m.synthetic ? syntheticAudioUrl(m) : fileUrl(m.playPath) + (m.rev ? `?v=${m.rev}` : ''));
// es-media:// is a privileged, CORS-enabled protocol served by the main process (needed for WebAudio + WebGL texture upload).
export const fileUrl = (p) => `es-media://local/${encodeURIComponent(p)}`;
const uid = () => Math.random().toString(36).slice(2, 9);

function probeNative(kind, url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe timeout')), 8000);
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const fail = () => { clearTimeout(timer); reject(new Error('not decodable natively')); };
    if (kind === 'image') {
      const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => done({ duration: getPrefs().stillDuration, width: im.naturalWidth, height: im.naturalHeight }); im.onerror = fail; im.src = url; // duration: Preferences > Still Image Default Duration
    } else {
      const el = document.createElement(kind === 'video' ? 'video' : 'audio'); el.crossOrigin = 'anonymous';
      el.preload = 'metadata';
      el.onloadedmetadata = () => done({ duration: isFinite(el.duration) ? el.duration : null, width: el.videoWidth || 0, height: el.videoHeight || 0, hasVideo: kind === 'video' });
      el.onerror = fail; el.src = url;
    }
  });
}

/** Decode PSD/PSB, AI/PDF/EPS and camera RAW (embedded full-size JPEG preview) in the app; returns PNG/JPEG bytes. */
async function decodeInApp(p, ext) {
  const data = new Uint8Array(await window.editorstage.readFile(p));
  if (ext === 'psd' || ext === 'psb') {
    const { decodePsd } = await import('./mogrt/psd'); const id = decodePsd(data);
    const c = document.createElement('canvas'); c.width = id.width; c.height = id.height; c.getContext('2d').putImageData(id, 0, 0);
    return { bytes: new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer()), ext: 'png' };
  }
  if (ext === 'ai' || ext === 'pdf' || ext === 'eps') {
    const { decodeFootageFile } = await import('./mogrt/footage'); const src = await decodeFootageFile({ name: `x.${ext}`, data }, { width: 3840 });
    if (!src || src.kind !== 'image') throw new Error('not a PDF-compatible file (save the .ai/.eps with PDF compatibility)');
    return { bytes: new Uint8Array(await (await new Promise((r) => src.image.toBlob(r, 'image/png'))).arrayBuffer()), ext: 'png' };
  }
  // camera RAW: the largest embedded JPEG (every major RAW format carries a full-size preview)
  let best = null;
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] !== 0xff || data[i + 1] !== 0xd8 || data[i + 2] !== 0xff) continue;
    let j = i + 2; let end = -1;
    while (j < data.length - 1) { // walk JPEG segments to find EOI after the scan
      if (data[j] !== 0xff) { j++; continue; } const m = data[j + 1];
      if (m === 0xd9) { end = j + 2; break; }
      if (m === 0xda) { j += 2; while (j < data.length - 1 && !(data[j] === 0xff && data[j + 1] === 0xd9)) j++; end = j + 2; break; }
      if (m >= 0xd0 && m <= 0xd7 || m === 0x01 || m === 0xff) { j += 2; continue; }
      j += 2 + ((data[j + 2] << 8) | data[j + 3]);
    }
    if (end > 0 && (!best || end - i > best[1] - best[0])) best = [i, end];
    if (end > 0) i = end - 1;
  }
  if (!best || best[1] - best[0] < 20000) throw new Error('no embedded preview found in the RAW file');
  return { bytes: data.slice(best[0], best[1]), ext: 'jpg' };
}

/** Import file paths into the project. Probes natively, decodes PSD/AI/RAW in-app, falls back to FFmpeg transcode into a playable proxy.
 * opts: { kind, duration, forceDuration, noAdd (probe only: return the items without adding them) } */
export async function importPaths(paths, log = () => {}, opts = {}) {
  const items = [];
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop();
    let kind = opts.kind || kindOf(name);
    let probed = null;
    if (!kind) { // unknown extension: ask FFmpeg what is inside
      probed = await window.editorstage.probe(p).catch(() => null);
      if (probed?.ok && probed.hasVideo) kind = probed.still ? 'image' : 'video';
      else if (probed?.ok && probed.hasAudio) kind = 'audio';
      if (!kind) { log(`Unsupported file type: ${name}`); continue; }
    }
    const item = { id: uid(), path: p, name, ext: extOf(name), kind, duration: 5, width: 0, height: 0, playPath: p, status: 'ready', transcoded: false };
    try {
      if (IN_APP.has(item.ext) && kind === 'image') {
        const { bytes, ext } = await decodeInApp(p, item.ext);
        const tmp = await window.editorstage.tmpDir(); const out = `${tmp}${tmp.includes('\\') ? '\\' : '/'}editorstage-${item.id}-${name.replace(/[^\w.-]+/g, '_')}.${ext}`;
        await window.editorstage.writeFile(out, bytes); item.playPath = out; item.transcoded = true;
        Object.assign(item, await probeNative('image', fileUrl(out))); items.push(item); continue;
      }
      if (kind === 'video') { // alpha channel sources are re-encoded to VP9+alpha, not H.264
        probed = probed || await window.editorstage.probe(p).catch(() => null);
        if (probed?.alpha && !['webm'].includes(item.ext)) throw Object.assign(new Error('alpha'), { alpha: true });
      }
      if (!NATIVE.has(item.ext)) throw new Error('needs transcode');
      Object.assign(item, await probeNative(kind, fileUrl(p)));
    } catch (e0) {
      log(`Transcoding ${name} via FFmpeg…`);
      const r = await window.editorstage.transcode(p, e0?.alpha ? 'videoAlpha' : kind);
      if (r.ok) {
        try { Object.assign(item, await probeNative(kind, fileUrl(r.path)), { playPath: r.path, transcoded: true }); }
        catch { item.status = 'error'; item.error = 'Transcoded file failed to load'; }
      } else { item.status = 'error'; item.error = r.error; }
    }
    if (item.kind !== 'image' && item.status === 'ready') {
      const pr = await window.editorstage.probe(item.playPath);
      if (item.duration == null) item.duration = (pr.ok && pr.duration) || opts.duration || 5; // element could not report a finite duration
      if (opts.duration && opts.forceDuration) item.duration = opts.duration;
      if (item.kind === 'video') { const po = item.playPath === item.path ? pr : await window.editorstage.probe(item.path); item.hasAudio = po.ok ? po.hasAudio : true; if (po.fps) item.fps = po.fps; }
    }
    const st = await window.editorstage.stat?.(p).catch(() => null); if (st && !st.dir) item.size = st.size;
    items.push(item);
  }
  if (items.length && !opts.noAdd) edit('Import', ({ media }) => media.push(...items));
  return items;
}

export async function importFiles(fileList, log) {
  const paths = [...fileList].map((f) => window.editorstage.pathForFile(f)).filter(Boolean);
  return importPaths(paths, log);
}

// ---- playback element pool: one element per clip (so split clips of the same file can show different times) ----
const pool = new Map(); // key -> { el, last }
export const mediaById = (id) => getState().media.find((m) => m.id === id);

/** Proxy file used for playback: View > Toggle Proxies on, the proxy is ready, and no export is rendering (export = full resolution). */
export const playsProxy = (m) => !!(getState().useProxies && m.proxy?.status === 'ready' && m.proxy.path && !exportLocks && m.kind === 'video');
function makeElement(media, asAudio) {
  const url = playsProxy(media) ? fileUrl(media.proxy.path) : mediaUrl(media);
  let el;
  if (media.kind === 'image') { el = new Image(); el.crossOrigin = 'anonymous'; el.src = url; return el; }
  el = document.createElement(media.kind === 'video' && !asAudio ? 'video' : 'audio');
  el.crossOrigin = 'anonymous'; el.src = url; el.preload = 'auto'; el.playsInline = true;
  return el;
}
export function elementForMedia(media, key = media.id, asAudio = false) {
  if (!media || media.status !== 'ready') return null;
  if (media.synthetic && !asAudio) return syntheticCanvas(media, key, getState().sourceTime || 0); // Source Monitor
  let e = pool.get(key);
  const px = playsProxy(media);
  if (e && (e.rev !== (media.rev || 0) || e.path !== media.playPath || e.px !== px)) { dropElement(key, e); e = null; } // file changed on disk / relinked / proxy toggled
  if (!e) { e = { el: makeElement(media, asAudio), last: 0, mediaId: media.id, rev: media.rev || 0, path: media.playPath, px }; pool.set(key, e); }
  e.last = performance.now();
  return e.el;
}
function dropElement(key, e) {
  try { e.el.pause?.(); e.el.removeAttribute?.('src'); e.el.load?.(); } catch { /* ok */ }
  pool.delete(key); disposeClipAudio(key);
}
/** Forget every element/audio chain/peak cache of a media item (its file was replaced or edited externally). */
export function invalidateMedia(mediaId) {
  for (const [k, e] of [...pool]) if (e.mediaId === mediaId) dropElement(k, e);
  clearPeaks(mediaId);
}
/** Marker the Compositor recognises: apply this clip's effects to the composite of the tracks below. */
export const ADJUSTMENT = Object.freeze({ adjustment: true });
export const elementForClip = (clip, t, dims, opts) => { if (clip.caption) return captionCanvas(clip, t ?? getState().playhead, dims || { w: getState().sequence.width, h: getState().sequence.height }); if (clip.mogrt) return mogrtCanvasForClip(clip, t ?? getState().playhead, dims, opts); if (clip.graphic) { const s = getState().sequence; const sd = { w: s.width, h: s.height }; return graphicCanvas(clip, dims || sd, sd); } const m = clip.mediaId && mediaById(clip.mediaId); if (m?.status === 'offline' && !clip.asAudio) { const s = getState().sequence; return offlineCanvas(dims || { w: s.width, h: s.height }); } if (m?.synthetic && !clip.asAudio) return isAdjustment(m) ? ADJUSTMENT : syntheticCanvas(m, clip.elKey || clip.id, sourceAt(clip, t ?? getState().playhead, m.fps || 30, m.kind === 'image' ? Infinity : m.duration)); return m ? elementForMedia(m, m.kind === 'image' ? m.id : (clip.elKey || clip.id), clip.asAudio) : null; };

/** Transition window (seconds) around a clip, so its source keeps playing into/out of a transition. */
function clipWindow(seq, c) {
  let pre = 0, post = 0;
  for (const tr of seq.transitions || []) {
    if (tr.track !== c.track) continue;
    if (tr.bId === c.id) pre = Math.max(pre, tr.dur / 2);
    if (tr.aId === c.id) post = Math.max(post, tr.dur / 2);
  }
  return [c.start - pre, c.start + c.dur + post];
}
/** Source time shown at sequence time t (shared time model: speed, reverse, Time Remapping, Time Warp, Frame Hold, Posterize Time). */
export const clipSourceTime = (c, t, media) => sourceAt(c, t, media?.fps || getState().sequence.fps, media?.duration ?? Infinity);

/**
 * Frame Blending / Optical Flow (Clip > Speed/Duration > Time Interpolation): at a fractional source frame the clip shows
 * the two neighbouring frames mixed (Optical Flow: moved along the motion between them first, Compositor.flowPass).
 * Returns { t0, t1, w } (seek targets of the main and the blend element) or null.
 */
export function blendTimes(c, t, media) {
  if ((c.frameSampling !== 'blend' && c.frameSampling !== 'flow') || !media || media.kind !== 'video' || c.frameHold?.on) return null;
  const fps = media.fps || 30; const f = clipSourceTime(c, t, media) * fps; const f0 = Math.floor(f + 1e-6); const w = f - f0;
  if (w < 0.02 || w > 0.98) return null;
  const last = Math.max(0, (media.duration || 0) - 0.04);
  return { t0: Math.min(last, (f0 + 0.5) / fps), t1: Math.min(last, (f0 + 1.5) / fps), w };
}
export const blendElement = (clip) => { const m = clip.mediaId && mediaById(clip.mediaId); return m && m.kind === 'video' ? elementForMedia(m, `${clip.elKey || clip.id}#b`) : null; };
/** Compositor hook: the second frame to mix, only when paused/exporting (live playback shows plain frames). */
const blendFor = (clip, t) => {
  if (getState().playing) return null;
  const m = clip.mediaId && mediaById(clip.mediaId); const b = blendTimes(clip, t, m); if (!b) return null;
  const el = blendElement(clip); return el ? { el, w: b.w } : null;
};

/** Sync every active/near clip's element to the playhead, then drive the audio graph. */
// While an export renders it owns the shared media elements: playback sync must not seek them back to the playhead.
let exportLocks = 0;
export const lockPlayback = (on) => { exportLocks = Math.max(0, exportLocks + (on ? 1 : -1)); };
/** true while an export in this window owns the media elements (the preview does not follow the playhead meanwhile) */
export const playbackLocked = () => exportLocks > 0;
export function syncPlayback(realState) {
  if (exportLocks) return;
  const state = flatten(realState);
  const { sequence: seq, playhead: t } = state;
  const rate = state.rate || 1; const playing = state.playing && rate > 0; // reverse shuttle seeks instead of playing
  const active = new Set();
  const lookahead = 0.8;
  for (const c of seq.clips) {
    if (!c.mediaId || !c.enabled) continue;
    const media = mediaById(c.mediaId); if (!media) continue;
    const [w0, w1] = clipWindow(seq, c);
    const near = t >= w0 - lookahead && t < w1;
    if (!near) continue;
    const el = elementForClip(c); if (!el) continue;
    if (media.kind === 'image' || media.status === 'offline' || (media.synthetic && !c.asAudio)) continue; // drawn per frame, nothing to seek
    const inside = t >= w0 && t < w1;
    const target = clipSourceTime(c, inside ? t : w0, media);
    const pr = playRateAt(c, t);
    // retimed clips (reverse / speed / ramps) are heard through the rendered-audio path (audioEngine), exactly like export
    if (el.muted !== undefined) el.muted = !!(c.noAudio || isRetimed(c) || c.remix?.segments?.length); // remixed: the rendered remix plays (audioEngine)
    el.preservesPitch = !!c.maintainPitch;
    el.playbackRate = Math.min(16, Math.max(0.0625, Math.abs(pr * rate) || 1));
    // <video> cannot play backwards or stand still: reversed and held clips are seeked every frame instead
    const rolls = playing && inside && pr > 0;
    const bt = !playing && inside ? blendTimes(c, t, media) : null;
    if (bt) { const be = blendElement(c); be.muted = true; if (!be.paused) be.pause(); if (Math.abs(be.currentTime - bt.t1) > 0.005) be.currentTime = bt.t1; if (Math.abs(el.currentTime - bt.t0) > 0.005) el.currentTime = bt.t0; }
    else if (Math.abs(el.currentTime - target) > (rolls ? 0.25 : 0.02)) el.currentTime = target;
    if (rolls) { active.add(c.id); if (el.paused) el.play().catch(() => {}); }
    else if (!el.paused) el.pause();
    const echo = (c.effects || []).find((e) => e.name === 'Echo' && e.enabled);
    if (echo && media.kind === 'video') {
      const n = Math.min(8, Math.round(evalParam(echo.params.num, 0) ?? 3)), dt = evalParam(echo.params.time, 0) ?? -0.1;
      for (let k = 1; k <= n; k++) { const e2 = echoElement(c, k); const tg = clipSourceTime(c, inside ? t + dt * k : w0, media); e2.muted = true; e2.playbackRate = el.playbackRate; if (Math.abs(e2.currentTime - tg) > (playing && inside ? 0.25 : 0.02)) e2.currentTime = tg; if (playing && inside) { if (e2.paused) e2.play().catch(() => {}); } else if (!e2.paused) e2.pause(); }
    }
  }
  // pause elements that are no longer near anything
  const now = performance.now();
  for (const [k, e] of pool) if (e.el.pause && !e.el.paused && !active.has(k)) { /* paused above for known clips */ if (now - e.last > 1500) e.el.pause(); }
  updateAudio(state, elementForClip, (c) => !!c.mediaId && c.enabled && (() => { const [w0, w1] = clipWindow(seq, c); return t >= w0 && t < w1; })());
  syncMogrtAudio(state); // sound packed inside motion graphics templates
  pauseIdleVideos(); // videos packed inside templates that playback stopped using
}

export const imageById = (id) => { const m = mediaById(id); return m && m.kind === 'image' ? elementForMedia(m, m.id) : null; };
export const echoElement = (clip, k) => { const m = clip.mediaId && mediaById(clip.mediaId); return m && m.kind === 'video' ? elementForMedia(m, `${clip.elKey || clip.id}#e${k}`) : null; };
/** Remove Background: the cached person mask of the source frame a clip shows at t (computed in the background when missing). */
export function maskFor(clip, t) {
  const m = clip.mediaId && mediaById(clip.mediaId); if (!m || m.kind === 'audio') return null;
  const fps = m.fps || getState().sequence.fps || 30; const src = clipSourceTime(clip, t, m); const frame = m.kind === 'image' ? 0 : Math.round(src * fps);
  const key = maskKey(m.id, frame); const have = getMask(key); if (have) return { key, ...have };
  const el = elementForClip(clip, t);
  if (el && (m.kind === 'image' || m.synthetic || (el.readyState >= 2 && Math.abs(el.currentTime - src) < 0.5 / fps))) computeMask(key, el).catch(() => {});
  return null;
}
export const renderDeps = { elementFor: elementForClip, echoElement, imageById, blendFor, maskFor };

// ---- Comparison View (Shot) / Trim Monitor: extra frames drawn from their own muted elements (key prefix), so seeking them
// never moves the elements the Program image plays from ----
const keyedClip = (prefix) => (c) => ({ ...c, elKey: prefix + (c.elKey || c.id) });
/** Render deps that draw every media clip from its `<prefix>` element. */
export function keyedDeps(prefix) { const k = keyedClip(prefix); return { ...renderDeps, elementFor: (c, t, dims) => elementForClip(k(c), t, dims), blendFor: () => null, maskFor: () => null }; }
/** Seek the `<prefix>` elements of the clips visible at state.playhead (paused, muted). Returns true when every frame is ready. */
export function syncKeyed(state, prefix) {
  const { sequence: seq, playhead: t } = flatten(state); let ready = true; const k = keyedClip(prefix);
  const vt = new Set(seq.tracks.filter((x) => x.kind !== 'audio').map((x) => x.id));
  for (const c of seq.clips) {
    if (!c.mediaId || c.enabled === false || !vt.has(c.track) || t < c.start || t >= c.start + c.dur) continue;
    const media = mediaById(c.mediaId); if (!media || media.kind !== 'video' || media.status === 'offline' || media.synthetic) continue;
    const el = elementForClip(k(c)); if (!el) continue;
    el.muted = true; if (!el.paused) el.pause();
    const target = clipSourceTime(c, t, media);
    if (Math.abs(el.currentTime - target) > 0.02) { el.currentTime = target; ready = false; } else if (el.readyState < 2 || el.seeking) ready = false;
  }
  return ready;
}
/** Free the `<prefix>` elements (Comparison View / Trim Monitor closed). */
export function releaseKeyed(prefix) { for (const [key, e] of [...pool]) if (key.startsWith(prefix)) dropElement(key, e); }
export const referenceDeps = keyedDeps(REF_PREFIX);
export const syncReference = (refState) => syncKeyed(refState, REF_PREFIX);
export const releaseReference = () => releaseKeyed(REF_PREFIX);
