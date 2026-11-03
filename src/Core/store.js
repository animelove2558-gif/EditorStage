import { useSyncExternalStore } from 'react';
import { compareDefaults } from './compare';

// ---- Minimal observable store with snapshot-based undo/redo (History panel) ----
const initial = () => ({
  projectName: 'Untitled',
  seqs: {}, // inactive sequences by id (the active one lives in sequence)
  projectPath: null,
  dirty: false,
  media: [], // {id,name,path,kind,duration}
  sequence: {
    id: 'seq1', name: 'Sequence 01', fps: 30, width: 1920, height: 1080, duration: 60,
    tracks: [
      { id: 'V3', kind: 'video', muted: false, solo: false, locked: false, sync: true },
      { id: 'V2', kind: 'video', muted: false, solo: false, locked: false, sync: true },
      { id: 'V1', kind: 'video', muted: false, solo: false, locked: false, sync: true },
      { id: 'A1', kind: 'audio', muted: false, solo: false, locked: false, sync: true },
      { id: 'A2', kind: 'audio', muted: false, solo: false, locked: false, sync: true },
      { id: 'A3', kind: 'audio', muted: false, solo: false, locked: false, sync: true },
    ],
    clips: [],
    transitions: [],
    markers: [],
  },
  playhead: 0,
  playing: false,
  selection: [],
  tool: 'selection',
  groupTool: {},
  pps: 40,
  railOpen: true,
  inPoint: null,
  outPoint: null,
  bins: [],
  selectedMedia: null,
  selectedTransition: null,
  maskDraw: null,
  dialog: null,
  rate: 1,
  loop: false,
  safeMargins: false,
  previews: [],
  renderProgress: null,
  exportQueue: [],
  mcView: false,
  showRulers: false,
  showGuides: false,
  monitorZoom: 'Fit',
  trimMode: null, // Trim Mode / Trim Monitor (src/Core/trimMode.js)
  compare: compareDefaults(), // Program Monitor > Comparison View (view only, src/Core/compare.js)
  sourceIn: null,
  sourceOut: null,
  sourceTime: 0,
  toggles: { snap: true, linked: true },
  playbackRes: 'Full',
  thumbMode: (() => { try { return localStorage.getItem('es-thumbs') || 'head'; } catch { return 'head'; } })(), // View > Video Thumbnails
  pausedRes: 'Full',
  history: [{ label: 'New Project' }],
  historyIndex: 0,
  panelsVisible: {},
  log: [],
});

let state = initial();
const listeners = new Set();
const undoStack = [];
const redoStack = [];

const emit = () => listeners.forEach((l) => l());
export const getState = () => state;
export const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const useStore = (sel = (s) => s) => useSyncExternalStore(subscribe, () => sel(state));

/** Non-undoable update (playhead, tool, UI). */
export function set(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  emit();
}

const snap = () => ({ sequence: state.sequence, media: state.media, seqs: state.seqs, label: state.history[state.historyIndex].label });
let lastCoalesce = { key: null, time: 0 };
/** Undoable edit: mutate a deep-cloned sequence and record in History. opts.coalesce merges rapid edits (slider drags) into one history entry. */
/** Called before every edit / undo / redo (the Create panel's hover preview restores the real sequence first). */
export const beforeEdit = new Set();
const settle = () => { for (const f of beforeEdit) f(); };
// History panel: at most this many undoable steps are kept (Preferences > History States); the oldest drop off
let historyLimit = 100;
export const setHistoryLimit = (n) => { historyLimit = Math.max(1, Math.round(n) || 100); trimHistory(); };
function trimHistory() {
  const k = undoStack.length - historyLimit; if (k <= 0) return;
  undoStack.splice(0, k); const cut = Math.min(k, state.historyIndex);
  state = { ...state, history: state.history.slice(cut), historyIndex: state.historyIndex - cut };
}
/** History panel > Delete: undo back to the step before n and forget step n and everything after it (no redo) */
export function deleteHistoryFrom(n) {
  if (n <= 0) return;
  while (state.historyIndex >= n && undoStack.length) undo();
  redoStack.length = 0; state = { ...state, history: state.history.slice(0, state.historyIndex + 1) }; emit();
}
export function edit(label, fn, opts = {}) {
  settle();
  const now = performance.now();
  const merge = opts.coalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.time < 900;
  lastCoalesce = { key: opts.coalesce || null, time: now };
  if (!merge) { undoStack.push(snap()); redoStack.length = 0; }
  const seq = structuredClone(state.sequence);
  const media = structuredClone(state.media);
  // ctx.seqs (the inactive sequences) is cloned only when an edit touches it
  let seqs = state.seqs; let seqsCloned = false;
  // clips on locked tracks are never edited: they drop out of the selection the edit works on
  const lockedTracks = new Set(seq.tracks.filter((t) => t.locked).map((t) => t.id));
  const onLocked = new Set(seq.clips.filter((c) => lockedTracks.has(c.track)).map((c) => c.id));
  const ctx = { seq, media, sel: state.selection.filter((id) => !onLocked.has(id)), get seqs() { if (!seqsCloned) { seqs = structuredClone(state.seqs || {}); seqsCloned = true; } return seqs; } };
  const lockedBefore = seq.clips.filter((c) => onLocked.has(c.id)).map((c) => structuredClone(c));
  fn(ctx);
  // safety net: whatever a command did, clips that sit on a locked track stay exactly as they were
  if (lockedBefore.length) { const now = ctx.seq || seq; if (now.clips) now.clips = [...now.clips.filter((c) => !onLocked.has(c.id)), ...lockedBefore]; }
  const history = merge ? state.history : [...state.history.slice(0, state.historyIndex + 1), { label }];
  state = { ...state, sequence: seq, media, seqs, selection: ctx.sel, history, historyIndex: history.length - 1, dirty: true };
  trimHistory(); emit();
}
/** Commit a gesture-based sequence change (before/after snapshots) as one undoable step. */
export function commitSeq(label, before, after) {
  undoStack.push({ ...snap(), sequence: before }); redoStack.length = 0;
  const history = [...state.history.slice(0, state.historyIndex + 1), { label }];
  state = { ...state, sequence: after, history, historyIndex: history.length - 1, dirty: true };
  trimHistory(); emit();
}

export function undo() {
  settle();
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(snap());
  state = { ...state, sequence: prev.sequence, media: prev.media, seqs: prev.seqs ?? state.seqs, historyIndex: Math.max(0, state.historyIndex - 1) };
  emit();
}
export function redo() {
  settle();
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snap());
  state = { ...state, sequence: next.sequence, media: next.media, seqs: next.seqs ?? state.seqs, historyIndex: Math.min(state.history.length - 1, state.historyIndex + 1) };
  emit();
}

export const allSeqs = () => ({ ...state.seqs, [state.sequence.id]: state.sequence });
export function switchSequence(id) {
  const all = allSeqs(); if (id === state.sequence.id || !all[id]) return;
  const { [id]: next, ...rest } = all;
  undoStack.length = 0; redoStack.length = 0;
  state = { ...state, sequence: next, seqs: rest, selection: [], selectedTransition: null, playhead: 0, playing: false };
  emit();
}
/** Register a new sequence object; optionally make it the active one. */
export function addSequence(seqObj, activate = false) {
  state = { ...state, seqs: { ...state.seqs, [seqObj.id]: seqObj }, dirty: true };
  emit(); if (activate) switchSequence(seqObj.id);
}

export function resetProject() {
  undoStack.length = 0; redoStack.length = 0;
  state = initial();
  emit();
}
export function loadProject(data, path) {
  undoStack.length = 0; redoStack.length = 0;
  state = { ...initial(), ...data, projectPath: path, dirty: false, playing: false };
  emit();
}
