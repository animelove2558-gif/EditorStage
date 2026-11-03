// Export Queue (Premiere: Queue to Media Encoder). Each job keeps a snapshot of the project taken when it was queued, so
// editing can go on while the queue renders one job after another in the background (progress and cancel per job).
// The jobs render in a hidden render window (Services/renderHost.js), so the Program Monitor and playback of the main
// window stay live; without that window (it failed to start) they render here, which pauses the preview meanwhile.
import { getState, set } from '../Core/store';
import { exportSequence } from './exporter';

const snapshots = new Map(); // job id -> { opts, state }
let running = null; // { id, cancelled }
let background = true;
/** Render queued jobs in the hidden render window (default) or in this window. */
export const setBackgroundRender = (on) => { background = !!on; };
export const runningInBackground = () => !!running?.background;
const uid = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const patch = (id, p) => set((s) => ({ exportQueue: (s.exportQueue || []).map((j) => (j.id === id ? { ...j, ...p } : j)) }));
const nameOf = (p) => String(p).split(/[\\/]/).pop();

/** Add an export to the queue (opts as exportSequence). It starts as soon as the jobs before it are done. Returns the job id. */
export function queueExport(opts) {
  const id = uid(); const state = structuredClone({ ...getState(), log: [], exportQueue: [], dialog: null });
  snapshots.set(id, { opts: { ...opts, jobId: id }, state });
  set((s) => ({ exportQueue: [...(s.exportQueue || []), { id, name: nameOf(opts.path), path: opts.path, preset: opts.preset, seqName: state.sequence.name, status: 'queued', p: 0, msg: 'Queued' }] }));
  pump(); return id;
}
async function pump() {
  if (running) return;
  const job = (getState().exportQueue || []).find((j) => j.status === 'queued'); if (!job) return;
  const snap = snapshots.get(job.id); running = { id: job.id, cancelled: false }; const me = running;
  patch(job.id, { status: 'rendering', p: 0, msg: 'Starting…', started: Date.now() });
  let r;
  const bg = background && window.editorstage?.render;
  try {
    if (bg) {
      me.background = true;
      const off = bg.onProgress((id, p, msg) => { if (id === job.id) patch(job.id, { p, msg }); });
      try { r = await bg.start({ id: job.id, state: snap.state, opts: snap.opts }); } finally { off(); }
      if (r?.unavailable) me.background = false;
    }
    if (!bg || r?.unavailable) r = await exportSequence({ ...snap.opts, state: snap.state }, (p, msg) => patch(job.id, { p, msg }), () => me.cancelled);
  } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  patch(job.id, r.ok ? { status: 'done', p: 1, msg: [r.smart ? 'Smart Render (stream copy)' : r.encoder && r.encoder !== 'software' ? `Hardware: ${r.encoder}` : '', ...(r.notes || [])].filter(Boolean).join(' · ') || 'Done', result: r, ended: Date.now() }
    : { status: me.cancelled ? 'cancelled' : 'error', msg: me.cancelled ? 'Cancelled' : r.error, error: r.error, ended: Date.now() });
  snapshots.delete(job.id); running = null; pump();
}
/** Cancel a job: the running one stops, a queued one is skipped. */
export function cancelExport(id) {
  if (running?.id === id) { running.cancelled = true; if (running.background) window.editorstage?.render?.cancel(id); return; }
  snapshots.delete(id); patch(id, { status: 'cancelled', msg: 'Cancelled' });
}
export const removeExport = (id) => { if (running?.id === id) return; snapshots.delete(id); set((s) => ({ exportQueue: (s.exportQueue || []).filter((j) => j.id !== id) })); };
export const clearFinishedExports = () => set((s) => ({ exportQueue: (s.exportQueue || []).filter((j) => j.status === 'queued' || j.status === 'rendering') }));
/** Resolves with the finished job (for callers that wait, e.g. the Export dialog). */
export function whenExported(id) {
  return new Promise((resolve) => {
    const check = () => { const j = (getState().exportQueue || []).find((x) => x.id === id); if (!j || ['done', 'error', 'cancelled'].includes(j.status)) { resolve(j); return true; } return false; };
    if (check()) return; const iv = setInterval(() => check() && clearInterval(iv), 100);
  });
}
