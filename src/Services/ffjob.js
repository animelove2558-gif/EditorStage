// Cancellable FFmpeg runs from the renderer: runFfmpeg(args, { duration, onProgress }) -> Promise({ ok, stderr }) with .cancel().
// Progress comes from FFmpeg's own "time=" stats (fraction of `duration`).
let next = 0; const listeners = new Map(); let hooked = false;
function hook() {
  if (hooked || !window.editorstage?.onFfmpegProgress) return; hooked = true;
  window.editorstage.onFfmpegProgress((id, t) => listeners.get(id)?.(t));
}
export function runFfmpeg(args, { duration = 0, onProgress } = {}) {
  hook(); const id = `ff${Date.now().toString(36)}-${++next}`;
  if (onProgress && duration > 0) listeners.set(id, (t) => onProgress(Math.min(1, t / duration)));
  const p = window.editorstage.ffmpeg(args, id).finally(() => listeners.delete(id));
  p.cancel = () => window.editorstage.ffmpegKill(id);
  return p;
}
