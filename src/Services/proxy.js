// Proxy Workflow (Premiere: Proxy > Create Proxies / Attach Proxies / Toggle Proxies). Proxies are small, edit-friendly copies
// made by FFmpeg in the background (queue with progress and cancel). They are used for playback only when Toggle Proxies is
// on; export always renders from the full-resolution originals (media.js playsProxy()).
import { getState, set, edit } from '../Core/store';
import { invalidateMedia } from './media';
import { runFfmpeg } from './ffjob';
import { softwareVideo } from './exporter';

export const PROXY_PRESETS = {
  prores: { label: 'QuickTime ProRes 422 Proxy', ext: 'mov', video: ['-c:v', 'prores_ks', '-profile:v', '0', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'] },
  h264: { label: 'H.264 (low resolution, short GOP)', ext: 'mp4', video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '15', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '128k'] },
};
export const PROXY_SIZES = [[540, '960×540 (or ½ of smaller sources)'], [720, '1280×720'], [360, '640×360']];

const sep = (p) => (p.includes('\\') ? '\\' : '/');
const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));
const base = (p) => p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
const setProxy = (id, proxy) => edit('Proxy', ({ media }) => { const m = media.find((x) => x.id === id); if (m) m.proxy = proxy; });
const status = (id, patch) => set((s) => ({ proxyJobs: { ...(s.proxyJobs || {}), [id]: patch && { ...(s.proxyJobs || {})[id], ...patch } } }));

let queue = []; let current = null; let cancelled = false;
/** Queue proxy creation. opts: { preset: 'prores' | 'h264', height, dest: folder or '' (= a Proxies folder next to the source) }. */
export function createProxies(ids, opts = {}) {
  const ms = getState().media.filter((m) => ids.includes(m.id) && m.kind === 'video' && m.path && !m.synthetic && m.status === 'ready');
  for (const m of ms) if (!queue.some((q) => q.id === m.id) && current?.id !== m.id) { queue.push({ id: m.id, opts }); status(m.id, { p: 0, state: 'queued' }); }
  cancelled = false; pump();
  return ms.length;
}
async function pump() {
  if (current || !queue.length) return;
  current = queue.shift(); const { id, opts } = current;
  const m = getState().media.find((x) => x.id === id); const P = PROXY_PRESETS[opts.preset || 'h264'];
  try {
    if (!m) throw new Error('item removed');
    let dir = opts.dest || `${dirOf(m.path)}${sep(m.path)}Proxies`;
    try { await window.editorstage.mkdir(dir); } catch { dir = `${await window.editorstage.userData()}${sep(m.path)}Proxies`; await window.editorstage.mkdir(dir); }
    const out = `${dir}${sep(dir)}${base(m.path)}_Proxy.${P.ext}`;
    const h = Math.min(opts.height || 540, m.height || 540); const hh = Math.max(2, Math.round(h / 2) * 2);
    status(id, { state: 'creating', p: 0 });
    const video = (await softwareVideo({ ...P, codec: P.ext === 'mp4' ? 'h264' : undefined }, { width: Math.round((hh * (m.width || 16)) / (m.height || 9)), height: hh, fps: m.fps || 30 })).args; // LGPL FFmpeg: no x264
    const job = runFfmpeg(['-y', '-hide_banner', '-nostdin', '-i', m.path, '-map', '0:v:0', '-map', '0:a?', '-vf', `scale=-2:${hh}`, '-fps_mode', 'passthrough', ...video, ...P.audio, '-map_metadata', '0', out],
      { duration: m.duration, onProgress: (p) => status(id, { p }) });
    current.job = job; const r = await job;
    if (r.cancelled || cancelled) throw new Error('Cancelled');
    if (!r.ok) throw new Error(r.error || 'FFmpeg failed');
    setProxy(id, { path: out, status: 'ready', preset: opts.preset || 'h264', height: hh }); invalidateMedia(id); status(id, null);
  } catch (e) { status(id, { state: 'error', error: String(e.message || e) }); if (String(e.message) === 'Cancelled') status(id, null); }
  current = null; pump();
}
/** Stop the running proxy job and clear the queue. */
export function cancelProxies() { cancelled = true; for (const q of queue) status(q.id, null); queue = []; current?.job?.cancel?.(); }
/** Attach an existing file as the proxy of an item (Premiere: Attach Proxies). */
export async function attachProxy(id, path) {
  const m = getState().media.find((x) => x.id === id); if (!m) return false;
  const pr = await window.editorstage.probe(path); if (!pr?.ok || !pr.hasVideo) throw new Error('Not a video file');
  if (m.duration && pr.duration && Math.abs(pr.duration - m.duration) > Math.max(0.5, m.duration * 0.02)) throw new Error(`The proxy is ${pr.duration.toFixed(2)} s long but the original is ${m.duration.toFixed(2)} s`);
  setProxy(id, { path, status: 'ready', attached: true }); invalidateMedia(id); return true;
}
export function detachProxy(id) { setProxy(id, undefined); invalidateMedia(id); }
export const toggleProxies = () => set((s) => ({ useProxies: !s.useProxies }));
