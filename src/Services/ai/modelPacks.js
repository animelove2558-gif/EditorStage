// Optional AI model packs (Whisper Small / Medium, the multilingual sentence model for Smart B-Roll). The main process
// downloads a pack only when the user presses Download (electron/models.js); the files are then read offline like the
// bundled models. Subscribers get { packs: [{ id, label, bytes, installed, downloading, got, error }] } on every change.
const listeners = new Set();
let packs = []; let loaded = null; const progress = {}; const errors = {};
const api = () => (typeof window !== 'undefined' ? window.editorstage?.models : null);
const emit = () => { for (const f of listeners) f(snapshot()); };
const snapshot = () => packs.map((p) => ({ ...p, got: progress[p.id] ?? 0, error: errors[p.id] || '' }));

/** the packs and whether each is installed (asks the main process again with force) */
export async function listPacks(force = false) {
  const m = api(); if (!m) return [];
  if (!loaded || force) loaded = m.list().then((l) => { packs = l; emit(); return l; });
  await loaded; return snapshot();
}
export const packInfo = (id) => snapshot().find((p) => p.id === id) || null;
export async function isInstalled(id) { if (!id) return true; return !!(await listPacks(true)).find((p) => p.id === id)?.installed; }

let unsub = null;
/** download a pack (resolves when it is installed; rejects with the reason) */
export async function downloadPack(id) {
  const m = api(); if (!m) throw new Error('Model downloads need the EditorStage app');
  if (!unsub) unsub = m.onProgress((d) => { progress[d.id] = d.got; emit(); });
  errors[id] = ''; await listPacks(); packs = packs.map((p) => (p.id === id ? { ...p, downloading: true } : p)); emit();
  const r = await m.download(id);
  await listPacks(true);
  if (!r?.ok) { errors[id] = r?.error || 'download failed'; emit(); throw new Error(errors[id]); }
  return true;
}
export const cancelDownload = (id) => api()?.cancel(id);
export function subscribe(f) { listeners.add(f); listPacks().then(() => { if (listeners.has(f)) f(snapshot()); }, () => {}); return () => listeners.delete(f); }
export const mb = (n) => `${Math.round(n / 1e6)} MB`;
