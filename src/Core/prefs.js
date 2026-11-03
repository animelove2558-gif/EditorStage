// Preferences (Edit > Preferences): kept in userData/prefs.json for this user, never in a project. getPrefs() is synchronous
// (defaults until loadPrefs() has read the file at start-up); setPrefs() saves at once.
import { set, getState } from './store';

export const PREF_DEFAULTS = Object.freeze({
  stillDuration: 5, // seconds, Still Image Default Duration
  videoTransitionDur: 1, audioTransitionDur: 1, // seconds, default transition durations
  autoSaveMin: 5, autoSaveKeep: 20, // Auto Save: interval (0 = off), number of versions kept
  autoScroll: 'page', // Timeline Playback Auto-Scrolling: 'none' | 'page' | 'smooth'
  videoTracks: 3, audioTracks: 3, // tracks of a new sequence
  audioOutput: 'default', // audio output device id
  preRoll: 2, postRoll: 2, // seconds, Play Around (Shift+K)
  largeTrimOffset: 5, // frames, Trim Monitor Trim -N / +N and Ctrl+Shift+Left / Right
  brightness: 'dark', // Appearance: 'dark' | 'darker' | 'light'
  historySteps: 100, // History panel: undo steps kept
});
let prefs = { ...PREF_DEFAULTS };
export const getPrefs = () => prefs;

const file = async () => { const d = await window.editorstage?.userData?.(); return d ? `${d}/prefs.json` : null; };
const listeners = new Set();
/** cb(prefs) after every change (and once loaded) */
export const onPrefs = (cb) => (listeners.add(cb), () => listeners.delete(cb));
function apply() {
  if (typeof document !== 'undefined') { document.body?.classList.toggle('ui-darker', prefs.brightness === 'darker'); document.body?.classList.toggle('ui-light', prefs.brightness === 'light'); }
  set({ prefsRev: (getState().prefsRev || 0) + 1 }); listeners.forEach((cb) => cb(prefs));
}
/** older builds kept the auto-save interval in localStorage */
function legacy() { try { const v = localStorage.getItem('es-autosave-min'); return v != null ? { autoSaveMin: +v } : {}; } catch { return {}; } }
export async function loadPrefs() {
  let saved = {}; try { const p = await file(); if (p) saved = JSON.parse(await window.editorstage.readText(p)) || {}; } catch { saved = legacy(); }
  prefs = sanitize({ ...PREF_DEFAULTS, ...saved }); apply(); return prefs;
}
function sanitize(p) {
  const out = { ...PREF_DEFAULTS };
  for (const [k, d] of Object.entries(PREF_DEFAULTS)) { const v = p[k]; if (typeof d === 'number' ? Number.isFinite(+v) : typeof v === typeof d) out[k] = typeof d === 'number' ? +v : v; }
  out.stillDuration = Math.max(0.04, out.stillDuration); out.videoTracks = Math.max(1, Math.min(20, Math.round(out.videoTracks))); out.audioTracks = Math.max(1, Math.min(20, Math.round(out.audioTracks))); out.historySteps = Math.max(5, Math.min(1000, Math.round(out.historySteps))); out.largeTrimOffset = Math.max(1, Math.min(100, Math.round(out.largeTrimOffset)));
  return out;
}
export async function setPrefs(patch) {
  prefs = sanitize({ ...prefs, ...patch }); apply();
  try { const p = await file(); if (p) await window.editorstage.writeFile(p, JSON.stringify(prefs, null, 1)); } catch { /* read-only profile: kept for this session */ }
  return prefs;
}
export const resetPrefs = () => setPrefs({ ...PREF_DEFAULTS });
