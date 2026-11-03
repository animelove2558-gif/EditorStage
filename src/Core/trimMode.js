// Trim Mode (Premiere: Sequence > Trim Edit, Shift+T): edit points are selected and the Program Monitor becomes the Trim
// Monitor (outgoing frame | incoming frame). Trims go through editing.trimEdits as one undo step each. The selection lives
// in state.trimMode (view state, never saved):
//   { edits: [{ track, aId, bId }], type: 'regular' | 'ripple' | 'roll', side: 'a' | 'b', offA, offB (frames trimmed), dyn }
import { getState, set, edit } from './store';
import * as ed from './editing';
import { getPrefs } from './prefs';

export const TRIM_TYPES = ['regular', 'ripple', 'roll'];
export const TRIM_LABELS = { regular: 'Regular', ripple: 'Ripple', roll: 'Rolling' };
const mdur = (c) => { const m = c.mediaId && getState().media.find((x) => x.id === c.mediaId); return !m || m.kind === 'image' ? Infinity : m.duration; };
const fpsOf = () => getState().sequence.fps || 30;
let notify = (msg) => console.warn(msg);
export const setTrimNotify = (fn) => { notify = fn; };

/** Time of the primary (first) selected edit, null when it no longer exists. */
export const trimTime = (s = getState()) => (s.trimMode?.edits.length ? ed.editTime(s.sequence, s.trimMode.edits[0]) : null);

function enter(edits, type = 'roll', side = 'a') {
  const s = getState(); if (!edits.length) return false;
  const at = ed.editTime(s.sequence, edits[0]);
  set({ trimMode: { edits, type, side: type === 'roll' ? side : side, offA: 0, offB: 0, dyn: null }, playhead: at, playing: false, rate: 1, playStop: null, selection: [] });
  return true;
}
export function exitTrim() { if (getState().trimMode) set({ trimMode: null, playing: false, rate: 1, playStop: null }); }

/** Shift+T: leave Trim Mode, or select the edit nearest the playhead on the targeted tracks and open the Trim Monitor. */
export function toggleTrim() {
  const s = getState(); if (s.trimMode) { exitTrim(); return; }
  const tracks = ed.editTracks(s.sequence).filter((id) => !s.sequence.tracks.find((t) => t.id === id)?.locked);
  const pts = [...new Set(s.sequence.clips.filter((c) => tracks.includes(c.track)).flatMap((c) => [+c.start.toFixed(4), +ed.clipEnd(c).toFixed(4)]))];
  if (!pts.length) { notify('No edit point on the targeted tracks'); return; }
  const t = pts.reduce((b, x) => (Math.abs(x - s.playhead) < Math.abs(b - s.playhead) ? x : b));
  enter(ed.editsAt(s.sequence, t, tracks), 'roll');
}

/**
 * Double-click on a clip edge (Selection / Ripple / Rolling tool): open Trim Mode on that edit (and on the linked clips'
 * edits at the same time). Ctrl (add) while in Trim Mode adds / removes that edit.
 */
export function trimAtEdge(clipId, edge, tool, add = false) {
  const s = getState(); const c = s.sequence.clips.find((x) => x.id === clipId); if (!c) return;
  const t = edge === 'start' ? c.start : ed.clipEnd(c); const side = edge === 'start' ? 'b' : 'a';
  const own = ed.editsAt(s.sequence, t, [c.track]); if (!own.length) return;
  const tm = s.trimMode;
  if (add && tm) {
    const has = tm.edits.some((e) => e.track === c.track && ed.editTime(s.sequence, e) != null && Math.abs(ed.editTime(s.sequence, e) - t) < 1e-3);
    const edits = has ? tm.edits.filter((e) => !(e.track === c.track && Math.abs(ed.editTime(s.sequence, e) - t) < 1e-3)) : [...tm.edits, ...own];
    if (!edits.length) { exitTrim(); return; }
    set({ trimMode: { ...tm, edits } }); return;
  }
  const partners = s.toggles.linked && c.linkId ? s.sequence.clips.filter((x) => x.linkId === c.linkId && x.id !== c.id).map((x) => x.track) : [];
  const edits = [...own, ...ed.editsAt(s.sequence, t, [...new Set(partners)].filter((tr) => tr !== c.track))];
  enter(edits, tool === 'ripple' ? 'ripple' : tool === 'rolling' ? 'roll' : 'regular', side);
}

/** Choose what the trim works on: 'a' (outgoing), 'b' (incoming) or 'both' (rolling). A side keeps Ripple / Regular. */
export function setTrimSide(side) {
  const tm = getState().trimMode; if (!tm) return;
  if (side === 'both') set({ trimMode: { ...tm, type: 'roll' } });
  else set({ trimMode: { ...tm, side, type: tm.type === 'roll' ? 'ripple' : tm.type } });
}
/** Ctrl+T in Trim Mode: Regular → Ripple → Rolling */
export function cycleTrimType() {
  const tm = getState().trimMode; if (!tm) return;
  set({ trimMode: { ...tm, type: TRIM_TYPES[(TRIM_TYPES.indexOf(tm.type) + 1) % TRIM_TYPES.length] } });
}

/** Trim the selected edits by n frames (one undo step). Returns the frames actually trimmed. */
export function trimBy(n) {
  const s = getState(); const tm = s.trimMode; if (!tm || !n) return 0;
  const fps = fpsOf(); let done = 0;
  // dry run: nothing to record when the media / neighbours allow no movement
  const probe = structuredClone(s.sequence); if (!ed.trimEdits(probe, mdur, tm.edits, tm.type, tm.side, n / fps)) { notify('Trim limit reached (media handle, clip length or a neighbouring clip)'); return 0; }
  edit(`Trim Edit (${TRIM_LABELS[tm.type]})`, ({ seq }) => { done = ed.trimEdits(seq, mdur, tm.edits, tm.type, tm.side, n / fps); ed.fixTransitions(seq); });
  const f = Math.round(done * fps);
  const offA = tm.offA + (tm.type === 'roll' || tm.side === 'a' ? f : 0), offB = tm.offB + (tm.type === 'roll' || tm.side === 'b' ? f : 0);
  const after = getState(); const at = ed.editTime(after.sequence, tm.edits[0]);
  set({ trimMode: { ...after.trimMode, offA, offB }, playhead: at ?? after.playhead });
  return f;
}
export const largeTrim = () => Math.max(1, Math.round(getPrefs().largeTrimOffset || 5));

/** Space in Trim Mode: play around the edit (Pre-roll / Post-roll) in a loop; again: stop on the edit. */
export function trimPlayAround() {
  const s = getState(); const tm = s.trimMode; if (!tm) return;
  const at = trimTime(s);
  if (s.playing) { set({ playing: false, rate: 1, playStop: null, playhead: at, trimMode: { ...tm, dyn: null } }); return; }
  const p = getPrefs(); const from = Math.max(0, at - p.preRoll);
  set({ playhead: from, playing: true, rate: 1, playStop: { at: at + p.postRoll, back: at, from }, trimMode: { ...tm, dyn: { loop: true } } });
}
/** J / L in Trim Mode (dynamic trimming): play from the edit backwards / forwards; K applies the distance played as the trim. */
export function trimShuttle(dir) {
  const s = getState(); const tm = s.trimMode; if (!tm) return;
  const at = trimTime(s);
  const from = tm.dyn?.from ?? at;
  set({ playhead: tm.dyn?.from != null ? s.playhead : at, playing: true, rate: dir, playStop: null, trimMode: { ...tm, dyn: { from } } });
}
export function trimStop() {
  const s = getState(); const tm = s.trimMode; if (!tm) return;
  const at = trimTime(s);
  if (tm.dyn?.from == null) { set({ playing: false, rate: 1, playStop: null, playhead: at, trimMode: { ...tm, dyn: null } }); return; }
  const n = Math.round((s.playhead - tm.dyn.from) * fpsOf());
  set({ playing: false, rate: 1, playStop: null, playhead: at, trimMode: { ...tm, dyn: null } });
  if (n) trimBy(n);
}

/** Keys while Trim Mode is open (before the keymap). Returns true when the key was used. */
export function trimKey(e, combo) {
  const tm = getState().trimMode; if (!tm) return false;
  const big = largeTrim();
  const map = {
    escape: exitTrim, 'shift+t': exitTrim, 'ctrl+t': cycleTrimType,
    'ctrl+arrowleft': () => trimBy(-1), 'ctrl+arrowright': () => trimBy(1), 'ctrl+shift+arrowleft': () => trimBy(-big), 'ctrl+shift+arrowright': () => trimBy(big),
    ' ': trimPlayAround, j: () => trimShuttle(-1), l: () => trimShuttle(1), k: trimStop,
  };
  const f = map[combo]; if (!f) return false;
  e.preventDefault(); f(); return true;
}

/**
 * Leave Trim Mode when its edits are gone (undo, delete) or the playhead was moved away by something else.
 * Called on every store change (see installTrimWatch).
 */
let seen = null; // { tm, playhead } at the last check: a playhead change made by someone else closes Trim Mode
export function checkTrim() {
  const s = getState(); const tm = s.trimMode; if (!tm) { seen = null; return; }
  const edits = tm.edits.filter((e) => ed.editTime(s.sequence, e) != null);
  if (!edits.length) { seen = null; set({ trimMode: null }); return; }
  if (edits.length !== tm.edits.length) { set({ trimMode: { ...tm, edits } }); return; }
  if (s.playing || tm.dyn) { seen = { tm, playhead: s.playhead }; return; }
  const at = trimTime(s);
  if (Math.abs(s.playhead - at) <= 0.5 / fpsOf()) { seen = { tm, playhead: s.playhead }; return; }
  // the edit moved under a still playhead (undo / redo, a trim elsewhere): follow it; the playhead moved: leave
  if (seen && seen.tm === tm && Math.abs(seen.playhead - s.playhead) < 1e-6) { seen = { tm, playhead: at }; set({ playhead: at }); return; }
  if (!seen || seen.tm !== tm) { seen = { tm, playhead: at }; set({ playhead: at }); return; } // just entered / changed selection
  seen = null; set({ trimMode: null });
}
/** Keep Trim Mode consistent with every store change. Returns the unsubscribe function. */
export function installTrimWatch(subscribe) { let busy = false; return subscribe(() => { if (busy) return; busy = true; try { checkTrim(); } finally { busy = false; } }); }
