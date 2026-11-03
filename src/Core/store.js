import { useSyncExternalStore } from 'react';
import { compareDefaults } from './compare';

// ---- Minimal observable store with snapshot-based undo/redo (History panel) ----
/** id of a project (kept in the .esproj): names its auto-save history until it has a file of its own */
export const newProjectId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const initial = () => ({
  projectName: 'Untitled',
  projectId: newProjectId(),
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

const emit = () => listeners.forEach((l) => l());
export const getState = () => state;
export const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const useStore = (sel = (s) => s) => useSyncExternalStore(subscribe, () => sel(state));

/** Non-undoable update (playhead, tool, UI). */
// project fields that are saved in the .esproj but changed without an undo step: changing one makes the project unsaved
const SAVED_FIELDS = ['bins', 'projectName', 'scratch', 'inPoint', 'outPoint'];
export function set(patch) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  const next = { ...state, ...p };
  if (SAVED_FIELDS.some((k) => next[k] !== state[k])) forced++;
  // an explicit dirty in the patch wins: false = treat the current content as saved, true = needs saving
  if (p && 'dirty' in p) { if (p.dirty) forced++; else { savedRevs = { ...revs }; savedForced = forced; } }
  state = next; syncDirty();
  emit();
}

// ---- Saved state tracking (Premiere-style). Every part of the project that undo can change (each sequence, by id, and the
// media item, plus the media order) has a revision id; the project is dirty when one differs from the ids written to disk, or when a
// non-undoable change (markDirty) happened since. Undoing a step gives a part its earlier id back only when nothing else
// changed it in between, so a state that was never saved never looks saved.
let revSeq = 0; // id generator
let revs = {}; // part -> revision id of the content shown (a sequence id, 'm:<media id>', 'm#order')
let savedRevs = {}; // revs when the project was last saved / loaded
let forced = 0, savedForced = 0; // counter of non-undoable project changes (bins, new sequences, restores)
const newRevId = () => ++revSeq;
const isDirty = () => forced !== savedForced || [...new Set([...Object.keys(revs), ...Object.keys(savedRevs)])].some((k) => (revs[k] || 0) !== (savedRevs[k] || 0));
const syncDirty = () => { if (state.dirty !== isDirty()) state = { ...state, dirty: isDirty() }; };
/** Token for the content being saved: pass it to markSaved() once the write finished (edits made during the write stay dirty). */
export const saveToken = () => ({ revs: { ...revs }, forced });
export function markSaved(tok = saveToken()) { savedRevs = { ...tok.revs }; savedForced = tok.forced; syncDirty(); emit(); }
/** A project change that is not an undoable edit (bins, sequences, restored revisions): the project needs saving. */
export function markDirty() { forced++; syncDirty(); emit(); }
const resetSaved = () => { revs = {}; savedRevs = {}; savedForced = forced; };

// ---- History: one undo / redo stack per sequence (Audit D13). Switching to another sequence and back keeps both histories.
// A step records what it changed: the sequence it was made in (before / after), the media items it changed (by id) and
// the other sequences it changed (by id). Undo puts back only those parts, so undoing in one sequence never reverts
// what was done later in another. A step that changed another sequence which was edited again since cannot be undone
// (it would throw that work away): it and the older steps of its stack are dropped with a note in the log.
const stacks = new Map(); // sequence id -> { undo: [], redo: [], base }
const stackOf = (id = state.sequence.id) => { let s = stacks.get(id); if (!s) { s = { undo: [], redo: [], base: 'New Project' }; stacks.set(id, s); } return s; };
const showHistory = () => {
  const s = stackOf();
  const history = [{ label: s.base }, ...s.undo.map((e) => ({ label: e.label })), ...[...s.redo].reverse().map((e) => ({ label: e.label }))];
  state = { ...state, history, historyIndex: s.undo.length };
};
let lastCoalesce = { key: null, time: 0 };
const breakCoalesce = () => { lastCoalesce = { key: null, time: 0 }; };
/** Called before every edit / undo / redo (the Create panel's hover preview restores the real sequence first). */
export const beforeEdit = new Set();
const settle = () => { for (const f of beforeEdit) f(); };
// History panel: at most this many undoable steps are kept per sequence (Preferences > History States); the oldest drop off
let historyLimit = 100;
export const setHistoryLimit = (n) => { historyLimit = Math.max(1, Math.round(n) || 100); for (const s of stacks.values()) trim(s); showHistory(); };
function trim(s) { const k = s.undo.length - historyLimit; if (k > 0) { s.base = s.undo[k - 1].label; s.undo.splice(0, k); } }

const sameJson = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** media list changes of one step: { items: { id: { before, after } }, order: { before, after } | null } (null = none) */
function mediaDiff(before, after) {
  const b = new Map(before.map((m) => [m.id, m])), a = new Map(after.map((m) => [m.id, m]));
  const items = {}; let n = 0;
  for (const [id, m] of a) { const o = b.get(id); if (!o || !sameJson(o, m)) { items[id] = { before: o, after: m }; n++; } }
  for (const [id, o] of b) if (!a.has(id)) { items[id] = { before: o, after: undefined }; n++; }
  const ob = before.map((m) => m.id), oa = after.map((m) => m.id);
  const order = ob.length === oa.length && ob.every((id, i) => id === oa[i]) ? null : { before: ob, after: oa };
  return n || order ? { items, order } : null;
}
/** the media list with a step's items set to one side ('before' for undo, 'after' for redo) */
function applyMedia(list, d, side) {
  const out = []; const done = new Set();
  for (const m of list) { const c = d.items[m.id]; if (!c) { out.push(m); continue; } done.add(m.id); if (c[side]) out.push(c[side]); }
  for (const [id, c] of Object.entries(d.items)) if (!done.has(id) && c[side]) out.push(c[side]);
  if (!d.order) return out;
  const rank = new Map(d.order[side].map((id, i) => [id, i]));
  return out.map((m, i) => [m, rank.has(m.id) ? rank.get(m.id) : d.order[side].length + i]).sort((x, y) => x[1] - y[1]).map((x) => x[0]);
}
/** merge a coalesced step into the one before it (the first 'before', the latest 'after') */
function mergeItems(into, add) {
  if (!add) return into; if (!into) return add;
  const items = { ...into.items };
  for (const [id, c] of Object.entries(add.items)) items[id] = id in items ? { before: items[id].before, after: c.after } : c;
  const order = into.order || add.order ? { before: (into.order || add.order).before, after: (add.order || into.order).after } : null;
  return { items, order };
}
/** move part k from one revision to the next: back to the recorded id if nothing else changed it, else a fresh id */
const stepRev = (k, from, to) => { revs[k] = (revs[k] || 0) === from ? to : newRevId(); };

/** Undoable edit: mutate a deep-cloned sequence and record in History. opts.coalesce merges rapid edits (slider drags) into one history entry. */
export function edit(label, fn, opts = {}) {
  settle();
  const now = performance.now();
  const S = stackOf();
  const merge = opts.coalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.time < 900 && S.undo.length > 0;
  lastCoalesce = { key: opts.coalesce || null, time: now };
  const seq = structuredClone(state.sequence);
  // ctx.media and ctx.seqs (the inactive sequences) are cloned only when an edit uses them
  let media = state.media; let mediaCloned = false;
  let seqs = state.seqs; let seqsCloned = false;
  // clips on locked tracks are never edited: they drop out of the selection the edit works on
  const lockedTracks = new Set(seq.tracks.filter((t) => t.locked).map((t) => t.id));
  const onLocked = new Set(seq.clips.filter((c) => lockedTracks.has(c.track)).map((c) => c.id));
  const ctx = {
    seq, sel: state.selection.filter((id) => !onLocked.has(id)),
    get media() { if (!mediaCloned) { media = structuredClone(state.media); mediaCloned = true; } return media; },
    set media(v) { media = v; mediaCloned = true; },
    get seqs() { if (!seqsCloned) { seqs = structuredClone(state.seqs || {}); seqsCloned = true; } return seqs; },
  };
  const lockedBefore = seq.clips.filter((c) => onLocked.has(c.id)).map((c) => structuredClone(c));
  fn(ctx);
  // safety net: whatever a command did, clips that sit on a locked track stay exactly as they were
  if (lockedBefore.length) { const cur = ctx.seq || seq; if (cur.clips) cur.clips = [...cur.clips.filter((c) => !onLocked.has(c.id)), ...lockedBefore]; }
  // keep the objects of everything the edit did not really change (undo of other steps compares by identity)
  let md = null;
  if (mediaCloned) {
    const prev = new Map(state.media.map((m) => [m.id, m]));
    media = media.map((m) => { const o = prev.get(m.id); return o && sameJson(o, m) ? o : m; });
    md = mediaDiff(state.media, media); if (!md) media = state.media;
  }
  let sd = null;
  if (seqsCloned) {
    const old = state.seqs || {}; const next = {};
    for (const [id, q] of Object.entries(seqs)) next[id] = old[id] && sameJson(old[id], q) ? old[id] : q;
    for (const id of new Set([...Object.keys(old), ...Object.keys(next)])) if (old[id] !== next[id]) (sd ||= {})[id] = { before: old[id], after: next[id] };
    seqs = sd ? next : state.seqs;
  }
  const id = state.sequence.id;
  const revBefore = revs[id] || 0; revs[id] = newRevId();
  // media revisions are kept per item (and one for the order), so undoing one item never touches the others' saved state
  const mediaRev = md ? Object.fromEntries([...Object.keys(md.items).map((k) => 'm:' + k), ...(md.order ? ['m#order'] : [])].map((k) => [k, { from: revs[k] || 0, to: (revs[k] = newRevId()) }])) : null;
  const seqRevs = {};
  if (sd) for (const k of Object.keys(sd)) {
    seqRevs[k] = { from: revs[k] || 0, to: (revs[k] = newRevId()) };
    if (k !== id) { const o = stacks.get(k); if (o) { o.undo.length = 0; o.redo.length = 0; o.base = `${label} (from another sequence)`; } } // its own steps would bring back the old version
  }
  if (merge) {
    const top = S.undo[S.undo.length - 1];
    top.seq.after = seq; top.seq.revAfter = revs[id];
    top.media = mergeItems(top.media, md); if (mediaRev) { top.mediaRev = top.mediaRev || {}; for (const [k, r] of Object.entries(mediaRev)) top.mediaRev[k] = { from: top.mediaRev[k] ? top.mediaRev[k].from : r.from, to: r.to }; }
    if (sd) { top.seqs = top.seqs || {}; top.seqRevs = top.seqRevs || {}; for (const k of Object.keys(sd)) { top.seqs[k] = { before: top.seqs[k] ? top.seqs[k].before : sd[k].before, after: sd[k].after }; top.seqRevs[k] = { from: top.seqRevs[k] ? top.seqRevs[k].from : seqRevs[k].from, to: seqRevs[k].to }; } }
  } else {
    S.undo.push({ label, seq: { before: state.sequence, after: seq, revBefore, revAfter: revs[id] }, media: md, mediaRev, seqs: sd, seqRevs: sd ? seqRevs : null });
    S.redo.length = 0; trim(S);
  }
  state = { ...state, sequence: seq, media, seqs, selection: ctx.sel };
  showHistory(); syncDirty(); emit();
}
/** Commit a gesture-based sequence change (before/after snapshots) as one undoable step. */
export function commitSeq(label, before, after) {
  const S = stackOf(); const id = state.sequence.id; breakCoalesce();
  const revBefore = revs[id] || 0; revs[id] = newRevId();
  S.undo.push({ label, seq: { before, after, revBefore, revAfter: revs[id] }, media: null, mediaRev: null, seqs: null, seqRevs: null });
  S.redo.length = 0; trim(S);
  state = { ...state, sequence: after };
  showHistory(); syncDirty(); emit();
}

/** apply one step backwards (undo) or forwards (redo) to the current state; false when it cannot be applied */
function applyStep(e, back) {
  const side = back ? 'before' : 'after', other = back ? 'after' : 'before';
  if (e.seqs) for (const [k, c] of Object.entries(e.seqs)) if ((state.seqs || {})[k] !== c[other]) return false; // edited again since
  const id = state.sequence.id;
  const sequence = e.seq[side];
  stepRev(id, back ? e.seq.revAfter : e.seq.revBefore, back ? e.seq.revBefore : e.seq.revAfter);
  let media = state.media;
  if (e.media) { media = applyMedia(state.media, e.media, side); for (const [k, r] of Object.entries(e.mediaRev)) stepRev(k, back ? r.to : r.from, back ? r.from : r.to); }
  let seqs = state.seqs;
  if (e.seqs) {
    seqs = { ...state.seqs };
    for (const [k, c] of Object.entries(e.seqs)) { if (k === id) continue; if (c[side] === undefined) delete seqs[k]; else seqs[k] = c[side]; stepRev(k, back ? e.seqRevs[k].to : e.seqRevs[k].from, back ? e.seqRevs[k].from : e.seqRevs[k].to); }
  }
  state = { ...state, sequence, media, seqs };
  return true;
}
const note = (text) => { state = { ...state, log: [...(state.log || []).slice(-49), text] }; };
export function undo() {
  settle();
  const S = stackOf(); const e = S.undo.pop();
  if (!e) return;
  breakCoalesce();
  if (!applyStep(e, true)) { note(`Cannot undo "${e.label}": another sequence it changed was edited since. Older steps of this sequence were dropped.`); S.base = e.label; S.undo.length = 0; S.redo.length = 0; }
  else S.redo.push(e);
  showHistory(); syncDirty(); emit();
}
export function redo() {
  settle();
  const S = stackOf(); const e = S.redo.pop();
  if (!e) return;
  breakCoalesce();
  if (!applyStep(e, false)) { note(`Cannot redo "${e.label}": another sequence it changed was edited since.`); S.redo.length = 0; }
  else S.undo.push(e);
  showHistory(); syncDirty(); emit();
}
/** History panel > Delete: undo back to the step before n and forget step n and everything after it (no redo) */
export function deleteHistoryFrom(n) {
  if (n <= 0) return;
  while (state.historyIndex >= n && stackOf().undo.length) undo();
  stackOf().redo.length = 0; breakCoalesce(); showHistory(); syncDirty(); emit();
}

export const allSeqs = () => ({ ...state.seqs, [state.sequence.id]: state.sequence });
export function switchSequence(id) {
  const all = allSeqs(); if (id === state.sequence.id || !all[id]) return;
  const { [id]: next, ...rest } = all;
  breakCoalesce();
  // each sequence keeps its own History; one opened for the first time starts with a single step named after it
  if (!stacks.has(id)) stacks.set(id, { undo: [], redo: [], base: `Open ${next.name || 'Sequence'}` });
  state = { ...state, sequence: next, seqs: rest, selection: [], selectedTransition: null, playhead: 0, playing: false };
  showHistory(); emit();
}
/** Register a new sequence object; optionally make it the active one. */
export function addSequence(seqObj, activate = false) {
  forced++;
  state = { ...state, seqs: { ...state.seqs, [seqObj.id]: seqObj } }; syncDirty();
  emit(); if (activate) switchSequence(seqObj.id);
}

export function resetProject() {
  stacks.clear(); breakCoalesce(); resetSaved();
  state = initial();
  showHistory(); emit();
}
export function loadProject(data, path) {
  stacks.clear(); breakCoalesce(); resetSaved();
  state = { ...initial(), ...data, projectId: data.projectId || newProjectId(), projectPath: path, dirty: false, playing: false };
  showHistory(); emit();
}
