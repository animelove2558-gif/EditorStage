// Forwards page errors to the main process, which writes them to userData/logs/editorstage.log (electron/crashLog.js).
const MAX = 20; const seen = new Set();
/** Send one entry. Repeats of the same text are dropped after the first, and at most MAX distinct entries per session. */
export function reportError(kind, err) {
  try {
    const text = String((err && err.stack) || (err && err.message) || err);
    const key = kind + text.slice(0, 200); if (seen.has(key) || seen.size >= MAX) return false; seen.add(key);
    window.editorstage?.logError?.(kind, text); return true;
  } catch { return false; }
}
export function installErrorLog() {
  window.addEventListener('error', (e) => reportError('error', e.error || `${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => reportError('unhandledrejection', e.reason));
}
