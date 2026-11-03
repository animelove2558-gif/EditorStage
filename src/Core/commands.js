import { getState, set, edit, undo, redo, resetProject, loadProject, addSequence, switchSequence, allSeqs, saveToken, markSaved } from './store';
import { requestPanel, loadWorkspace, toggleRail, closeActivePanel, PANELS } from './layout';
import { importPaths, mediaById, releaseReference } from '../Services/media';
import { defaultRefTime, rememberCompare } from './compare';
import { toggleTrim, setTrimNotify } from './trimMode';
import * as ed from './editing';
import { addTransition } from './dnd';
import { addGraphic } from '../Services/graphics';
import { peaksFor } from '../Services/waveform';
import { editInAudioStage } from '../Services/audiostage';
import { commitRevision } from '../Services/versions';
import { trimHead, sourceAt } from './clipTime';
import { DEFAULT_MOTION } from './params';
import { markerAt } from './markers';
import * as attr from './attributes';
import { getPrefs } from './prefs';

let clipboard = [];
export const hasClipboard = () => clipboard.length > 0;
/** the copied clips Paste Attributes takes from: the first picture clip and the first clip with sound */
export function attributeSources() {
  const v = clipboard.find((c) => c.kind !== 'audio') || null; const a = clipboard.find((c) => c.kind === 'audio') || clipboard.find((c) => c.kind === 'video' && !c.noAudio) || null;
  return { v, a };
}
const playsSound = (seq, c) => ed.trackKind(seq, c.track) === 'audio' || (ed.trackKind(seq, c.track) === 'video' && c.mediaId && !c.noAudio);
/** Paste Attributes: picture attributes (vKeys) onto picture clips, sound attributes (aKeys) onto clips that play sound */
export function pasteAttributes(vKeys, aKeys, scale) {
  const { v, a } = attributeSources();
  edit('Paste Attributes', ({ seq, sel }) => { for (const c of seq.clips.filter((x) => sel.includes(x.id))) {
    if (v && vKeys.length && ed.trackKind(seq, c.track) !== 'audio') attr.pasteAttrs(v, c, vKeys, scale);
    if (a && aKeys.length && playsSound(seq, c)) attr.pasteAttrs(a, c, aKeys, scale);
  } });
}
export function removeAttributes(keys) { edit('Remove Attributes', ({ seq, sel }) => { for (const c of seq.clips.filter((x) => sel.includes(x.id))) attr.removeAttrs(c, keys); }); }
const uid = () => Math.random().toString(36).slice(2, 8);
const notify = (msg) => set((s) => ({ log: [...s.log.slice(-49), msg] }));
setTrimNotify(notify);
const dialog = (type, props = {}) => () => set({ dialog: { type, props } });
export const openDialog = (type, props) => set({ dialog: { type, props } });
const clipsSel = () => { const { sequence, selection } = getState(); return sequence.clips.filter((c) => selection.includes(c.id)); };
/** Source range of a project item: a subclip's In/Out, else the whole file. */
export const mediaRange = (m) => [m.subclip?.in ?? 0, m.subclip?.out ?? m.duration];

// ---------- timeline helpers ----------
/** Split every clip under the playhead (on non-locked tracks) - Add Edit / Razor */
export function addEdit(at = getState().playhead, onlyClipId = null, tracks = null) {
  edit('Add Edit', ({ seq }) => {
    const locked = new Set(seq.tracks.filter((t) => t.locked || (tracks && !tracks.includes(t.id))).map((t) => t.id));
    const only = onlyClipId ? expandSelection(seq, [onlyClipId], getState().toggles.linked) : null;
    const relink = {};
    for (const c of [...seq.clips]) {
      if (only && !only.includes(c.id)) continue;
      if (locked.has(c.track) || at <= c.start || at >= c.start + c.dur) continue;
      const left = at - c.start;
      const right = trimHead({ ...structuredClone(c), id: uid(), start: at, dur: c.dur - left }, left);
      if (c.linkId) { relink[c.linkId] = relink[c.linkId] || uid(); right.linkId = relink[c.linkId]; }
      seq.clips.push(right); c.dur = left;
    }
  });
}
/** Ripple Delete of an empty span { track, a, b } */
export function rippleGap(gap) {
  let ok = false;
  edit('Ripple Delete', ({ seq }) => { ok = ed.rippleDeleteGap(seq, gap.track, gap.a, gap.b); ed.fixTransitions(seq); });
  set({ selectedGap: null });
  if (!ok) notify('Cannot close the gap: a clip on a sync-locked track is in the way (turn off its Sync Lock or move the clip)');
}
function removeSelected(ripple) {
  const { selectedTransition: st, selection, selectedGap: gap } = getState();
  if (!selection.length && gap) return rippleGap(gap); // Delete / Ripple Delete on a selected gap closes it (Premiere)
  if (!selection.length && st) { edit('Delete Transition', ({ seq }) => { seq.transitions = (seq.transitions || []).filter((x) => x.id !== st); }); set({ selectedTransition: null }); return; }
  edit(ripple ? 'Ripple Delete' : 'Clear', (ctx) => {
    // Linked Selection: the linked audio / video goes too (not when it sits on a locked track)
    const locked = new Set(ctx.seq.tracks.filter((t) => t.locked).map((t) => t.id));
    ctx.sel = expandSelection(ctx.seq, ctx.sel, getState().toggles.linked).filter((id) => !locked.has(ctx.seq.clips.find((c) => c.id === id)?.track));
    const del = ctx.seq.clips.filter((c) => ctx.sel.includes(c.id));
    ctx.seq.clips = ctx.seq.clips.filter((c) => !ctx.sel.includes(c.id));
    ctx.seq.transitions = (ctx.seq.transitions || []).filter((x) => !ctx.sel.includes(x.aId) && !ctx.sel.includes(x.bId));
    if (ripple) {
      for (const d of del) {
        for (const c of ctx.seq.clips) if (c.track === d.track && c.start >= d.start + d.dur) c.start -= d.dur;
      }
    }
    ed.fixTransitions(ctx.seq);
    ctx.sel = [];
  });
}
function trimToPlayhead(which, ripple) {
  const s = getState(); const t = s.playhead; let span = null;
  const label = `${ripple ? 'Ripple ' : ''}Trim ${which === 'prev' ? 'Previous' : 'Next'} Edit to Playhead`;
  if (!ed.trimEditToPlayhead(structuredClone(s.sequence), t, ed.editTracks(s.sequence), which, ripple)) return notify('No clip under the playhead on the targeted tracks');
  edit(label, ({ seq }) => { span = ed.trimEditToPlayhead(seq, t, ed.editTracks(seq), which, ripple); ed.fixTransitions(seq); });
  if (span && which === 'prev' && ripple) set({ playhead: span[0] }); // the playhead stays on the frame it showed
}
const goMarker = (dir) => {
  if (onSource()) { // Source Monitor: the source markers of its clip
    const s = getState(); const t = (mediaById(s.selectedMedia)?.markers || []).map((m) => m.time).sort((a, b) => a - b);
    const target = dir > 0 ? t.find((x) => x > s.sourceTime + 1e-6) : [...t].reverse().find((x) => x < s.sourceTime - 1e-6);
    if (target !== undefined) set({ sourceTime: target }); return;
  }
  const { sequence, playhead } = getState();
  const t = sequence.markers.map((m) => m.time).sort((a, b) => a - b);
  const target = dir > 0 ? t.find((x) => x > playhead + 1e-6) : [...t].reverse().find((x) => x < playhead - 1e-6);
  if (target !== undefined) set({ playhead: target });
};
/**
 * Add Marker (M, Premiere): in the Source Monitor a source marker on its clip; with clips selected under the playhead a clip
 * marker on each; otherwise a sequence marker. M where a marker already is opens the Marker dialog of that marker.
 */
function addMarker() {
  const s = getState(); const fps = s.sequence.fps;
  if (onSource()) {
    const m = mediaById(s.selectedMedia); const hit = markerAt(m.markers, s.sourceTime, fps);
    if (hit) return openDialog('marker', { scope: 'media', owner: m.id, id: hit.id });
    return edit('Add Marker', ({ media }) => { const x = media.find((q) => q.id === m.id); x.markers = [...(x.markers || []), { id: uid(), time: s.sourceTime, dur: 0, name: '', comment: '', type: 'comment' }]; });
  }
  const under = s.sequence.clips.filter((c) => s.selection.includes(c.id) && c.mediaId && s.playhead >= c.start - 1e-6 && s.playhead < c.start + c.dur - 1e-6).filter(onUnlocked(s.sequence));
  if (under.length) {
    const src = (c) => sourceAt(c, s.playhead, fps, mediaById(c.mediaId)?.duration ?? Infinity);
    if (under.length === 1) { const hit = markerAt(under[0].markers, src(under[0]), fps); if (hit) return openDialog('marker', { scope: 'clip', owner: under[0].id, id: hit.id }); }
    return edit('Add Clip Marker', ({ seq }) => under.forEach((u) => { const c = seq.clips.find((q) => q.id === u.id); const t = src(u); if (!markerAt(c.markers, t, fps)) c.markers = [...(c.markers || []), { id: uid(), time: t, dur: 0, name: '', comment: '', type: 'comment' }]; }));
  }
  const hit = markerAt(s.sequence.markers, s.playhead, fps);
  if (hit) return openDialog('marker', { scope: 'seq', id: hit.id });
  const id = uid();
  edit('Add Marker', ({ seq }) => { seq.markers.push({ id, time: s.playhead, dur: 0, name: '', comment: '', type: 'comment' }); });
  set({ selectedMarker: id });
}
/** the marker list a { scope, owner } points at, inside an edit context (or the live state) */
export function markerList(ctx, scope, owner) {
  if (scope === 'media') { const m = ctx.media.find((x) => x.id === owner); return m ? (m.markers = m.markers || []) : null; }
  if (scope === 'clip') { const c = ctx.seq.clips.find((x) => x.id === owner); return c ? (c.markers = c.markers || []) : null; }
  return ctx.seq.markers;
}
/** change ({...fields}) or delete (null) one marker */
export function updateMarker(scope, owner, id, fields, label = 'Edit Marker') {
  edit(fields ? label : 'Clear Marker', (ctx) => {
    const list = markerList(ctx, scope, owner); if (!list) return; const i = list.findIndex((m) => m.id === id); if (i < 0) return;
    if (fields) list[i] = { ...list[i], ...fields }; else list.splice(i, 1);
  });
}
// locking a track also deselects its clips (clips on locked tracks cannot be selected)
const toggleTrack = (id, key) => edit(`Toggle ${key}`, ({ seq, sel }) => { const t = seq.tracks.find((x) => x.id === id); t[key] = !t[key]; if (key === 'locked' && t.locked) { const on = new Set(seq.clips.filter((c) => c.track === id).map((c) => c.id)); sel.splice(0, sel.length, ...sel.filter((x) => !on.has(x))); } });
const onUnlocked = (seq) => { const locked = new Set(seq.tracks.filter((t) => t.locked).map((t) => t.id)); return (c) => !locked.has(c.track); };
// I / O and the other mark keys work on the active monitor (Premiere): the Source Monitor after it was clicked, else the sequence
const onSource = () => getState().activeMonitor === 'source' && !!getState().media.find((m) => m.id === getState().selectedMedia);
const setIO = (key) => () => (onSource() ? set({ [key === 'inPoint' ? 'sourceIn' : 'sourceOut']: getState().sourceTime }) : set({ [key]: getState().playhead }));
const goIO = (key) => () => { const s = getState(); if (onSource()) { const v = s[key === 'inPoint' ? 'sourceIn' : 'sourceOut']; if (v != null) set({ sourceTime: v }); } else if (s[key] != null) set({ playhead: s[key] }); };
const clearIO = (...keys) => () => set(Object.fromEntries(keys.map((k) => (onSource() ? [k === 'inPoint' ? 'sourceIn' : 'sourceOut', null] : [k, null]))));

/** Place a V clip (+ linked A clip when the file has audio). Returns created ids. */
/** extra: { dur, inPoint, audioTrack (track for the linked sound; null = picture only), audioOnly (only the sound of a video file, on trackId) } */
export function placeMedia(seq, media, start, trackId, extra = {}) {
  const kind = media.kind === 'audio' || extra.audioOnly ? 'audio' : 'video';
  const free = (k) => (seq.tracks.filter((t) => t.kind === k && !t.locked).sort((a, b) => a.id.localeCompare(b.id))[0] || {}).id;
  const ok = trackId && seq.tracks.find((t) => t.id === trackId && t.kind === kind && !t.locked);
  const track = ok ? trackId : free(kind); if (!track) return [];
  const [r0, r1] = mediaRange(media);
  const dur = extra.dur ?? (r1 - r0);
  const base = { start, dur, name: media.name, mediaId: media.id, inPoint: extra.inPoint ?? r0, speed: 1, effects: [], enabled: true, audio: { tag: null } };
  const id = uid(); const out = [id];
  const vclip = { id, track, ...base, color: kind === 'audio' ? '#43a047' : media.kind === 'image' ? '#c0742d' : '#5b7fd1', ...(extra.audioOnly ? { asAudio: true } : {}) };
  seq.clips.push(vclip);
  if (media.kind === 'video' && media.hasAudio !== false && !extra.audioOnly) {
    if (extra.audioTrack === null) { vclip.noAudio = true; return out; } // no audio track targeted: picture only
    const at = extra.audioTrack && seq.tracks.some((t) => t.id === extra.audioTrack && t.kind === 'audio' && !t.locked) ? extra.audioTrack : free('audio');
    if (at) { const aid = uid(); const link = uid(); vclip.linkId = link; vclip.noAudio = true; seq.clips.push({ id: aid, track: at, ...base, asAudio: true, linkId: link, color: '#43a047' }); out.push(aid); }
  }
  return out;
}
/** Drop a project item on a track. opts.insert (Ctrl held on drop): insert, pushing what follows (sync lock), instead of overwriting. */
export function addMediaToTimeline(media, start, trackId = null, opts = {}) {
  if (!media || media.status !== 'ready') return;
  edit(`${opts.insert ? 'Insert' : 'Add'} ${media.name}`, ({ seq, sel }) => {
    let ids;
    if (opts.insert) { const tmp = { clips: [], tracks: seq.tracks }; ids = placeMedia(tmp, media, start, trackId); ed.insertClips(seq, tmp.clips, start); ed.fixTransitions(seq); }
    else ids = placeMedia(seq, media, start, trackId);
    if (ids.length) sel.splice(0, sel.length, ...ids);
  });
}
/** Add a video track above the top video track / an audio track below the last audio track / a caption track on top (mutates seq). Returns its id. */
export const addTrackTo = (seq, kind) => ed.appendTrack(seq, kind);
/** Insert (,) / Overwrite (.) from the Source: onto the targeted video and audio tracks (older projects: the first unlocked ones, as before). */
function sourceEdit(mode) {
  const s = getState(); const media = s.media.find((m) => m.id === s.selectedMedia);
  if (!media || media.status !== 'ready') return notify('Select a media item in the Project panel (Source) first');
  const [r0, r1] = mediaRange(media); const a = s.sourceIn ?? r0, b = s.sourceOut ?? r1;
  const seq0 = s.sequence; const vt = ed.targetedTracks(seq0, 'video')[0] || null, at = ed.targetedTracks(seq0, 'audio')[0] || null;
  const hasSound = media.kind === 'audio' || (media.kind === 'video' && media.hasAudio !== false);
  const extra = { dur: Math.max(0.04, b - a), inPoint: a };
  let plan = null;
  if (media.kind === 'audio') plan = at && [at, extra];
  else if (vt) plan = [vt, { ...extra, audioTrack: at }];
  else if (at && hasSound) plan = [at, { ...extra, audioOnly: true }];
  if (!plan) return notify(`No ${media.kind === 'audio' ? 'audio' : 'video'} track is targeted (click the V1 / A1 buttons on the track headers)`);
  edit(mode === 'insert' ? 'Insert' : 'Overwrite', ({ seq, sel }) => {
    const tmp = { clips: [], tracks: seq.tracks };
    const ids = placeMedia(tmp, media, s.playhead, plan[0], plan[1]);
    if (mode === 'insert') ed.insertClips(seq, tmp.clips, s.playhead); else for (const c of tmp.clips) ed.overwriteClip(seq, c, s.playhead);
    ed.fixTransitions(seq); sel.splice(0, sel.length, ...ids);
  });
}
/**
 * Paste the clipboard at the playhead (overwriting what is there, or inserting). With track targeting the lowest copied track of
 * each kind lands on the lowest targeted track and the others keep their distance (Premiere); kinds without target flags paste to the
 * tracks they were copied from. Copies get fresh link ids, so a pasted V+A pair is linked to each other.
 */
function pasteClips(insert) {
  if (!clipboard.length) return notify('Nothing to paste');
  const s = getState();
  edit(insert ? 'Paste Insert' : 'Paste', ({ seq, sel }) => {
    const at = s.playhead; const base = Math.min(...clipboard.map((c) => c.start));
    const copies = ed.duplicateClips({ clips: clipboard }, clipboard.map((c) => c.id));
    const out = [];
    for (const kind of ['video', 'audio', 'caption']) {
      const cs = copies.filter((c) => c.kind === kind); if (!cs.length) continue;
      const order = ed.kindTracks(seq, kind).map((t) => t.id);
      let target = null;
      if (kind !== 'caption' && ed.hasTargets(seq, kind)) { target = ed.targetedTracks(seq, kind)[0]; if (!target) continue; }
      const low = Math.min(...cs.map((c) => c.ti));
      for (const c of cs) {
        let i = target ? order.indexOf(target) + c.ti - low : order.includes(c.track) ? order.indexOf(c.track) : c.ti;
        while (i >= order.length) order.push(ed.appendTrack(seq, kind));
        c.track = order[Math.max(0, i)]; c.start = at + c.start - base;
      }
      out.push(...cs.filter((c) => !seq.tracks.find((t) => t.id === c.track)?.locked));
    }
    for (const c of out) { delete c.kind; delete c.ti; }
    if (insert) ed.insertGroup(seq, out);
    else { const ids = out.map((c) => c.id); for (const c of out) ed.overwriteRange(seq, c.track, c.start, ed.clipEnd(c), ids); seq.clips.push(...out); }
    ed.fixTransitions(seq); sel.splice(0, sel.length, ...out.map((c) => c.id));
  });
}
/** Nudge Clip Selection Up / Down (Alt+↑ / Alt+↓): the selection (and linked partners) moves one track, with the same rules as a drag. */
function nudgeTracks(up) {
  const s = getState(); const ids = expandSelection(s.sequence, s.selection, s.toggles.linked);
  if (!ids.length) return notify('Select a clip first');
  // like a drag, one kind changes track: the selected picture (V1 → V2 for Up) if any, else captions, else sound (A2 → A1
  // for Up); linked partners of the other kinds stay on their tracks
  const kinds = new Set(s.sequence.clips.filter((c) => ids.includes(c.id)).map((c) => ed.trackKind(s.sequence, c.track)));
  const kind = ['video', 'caption', 'audio'].find((k) => kinds.has(k));
  const delta = (up ? 1 : -1) * (kind === 'audio' ? -1 : 1);
  if (!Object.keys(ed.trackShiftMap(structuredClone(s.sequence), ids, delta, [kind])).length) return notify(`Cannot nudge the selection ${up ? 'up' : 'down'}`);
  edit(up ? 'Nudge Clip Selection Up' : 'Nudge Clip Selection Down', ({ seq }) => { ed.moveClips(seq, ids, 0, ed.trackShiftMap(seq, ids, delta, [kind])); ed.fixTransitions(seq); });
}
/** Alt+← / Alt+→ (1 frame), Alt+Shift+← / → (5 frames): move the selection in time, overwriting what it lands on. */
function nudgeFrames(frames) {
  const s = getState(); const ids = expandSelection(s.sequence, s.selection, s.toggles.linked);
  if (!ids.length) return notify('Select a clip first');
  edit(`Nudge Clip Selection ${frames < 0 ? 'Left' : 'Right'}`, ({ seq }) => { ed.moveClips(seq, ids, frames / seq.fps); ed.fixTransitions(seq); });
}

// ---------- track header commands ----------
const trackName = (seq, id) => { const t = seq.tracks.find((x) => x.id === id); return t ? t.name || t.id : id; };
function deleteTracksCmd(ids, label) {
  const seq = getState().sequence; const del = ed.deletableTracks(seq, ids);
  if (!del.length) return notify(ids.length ? 'A sequence keeps at least one video and one audio track' : 'There are no empty tracks');
  const n = seq.clips.filter((c) => del.includes(c.track)).length;
  const go = () => edit(label, ({ seq: q, sel }) => { ed.deleteTracks(q, del); ed.fixTransitions(q); const live = new Set(q.clips.map((c) => c.id)); sel.splice(0, sel.length, ...sel.filter((id) => live.has(id))); });
  if (!n) return go();
  openDialog('confirm', { title: label, message: `${del.map((id) => trackName(seq, id)).join(', ')} ${del.length > 1 ? 'contain' : 'contains'} ${n} clip${n > 1 ? 's' : ''}. Delete ${del.length > 1 ? 'these tracks' : 'the track'} with ${n > 1 ? 'the clips' : 'the clip'}?`, okLabel: 'Delete', onOk: go });
}
/** Track heights in px (track.h; no value = the default height). */
export const TRACK_HEIGHTS = { min: 24, default: 36, medium: 56, large: 96, max: 200 };
const setTrackHeights = (ids, h, label) => edit(label, ({ seq }) => { for (const t of seq.tracks) if (!ids || ids.includes(t.id)) t.h = h === TRACK_HEIGHTS.default ? undefined : h; });
function applyDefaultTransition(kinds) {
  kinds = [].concat(kinds); const s = getState(); const clips = s.sequence.clips.filter((c) => s.selection.includes(c.id));
  if (!clips.length) return notify('Select a clip to apply a default transition');
  edit(kinds.length > 1 ? 'Apply Default Transitions' : `Apply Default ${kinds[0]} Transition`, ({ seq, sel }) => {
    for (const c of clips) {
      const tk = ed.trackKind(seq, c.track); if (!kinds.includes(tk) || !sel.includes(c.id)) continue; const kind = tk;
      const payload = kind === 'video' ? { effectName: 'Cross Dissolve', media: 'video', folder: 'Dissolve' } : { effectName: 'Constant Power', media: 'audio', folder: 'Crossfade' };
      const edge = Math.abs(s.playhead - c.start) < Math.abs(s.playhead - (c.start + c.dur)) ? 'start' : 'end';
      addTransition(seq, seq.clips.find((x) => x.id === c.id), edge, payload);
    }
  });
}

// ---------- project files ----------
const recentGet = () => { try { return JSON.parse(localStorage.getItem('es-recent') || '[]'); } catch { return []; } };
export const recentAdd = (p) => { try { localStorage.setItem('es-recent', JSON.stringify([p, ...recentGet().filter((x) => x !== p)].slice(0, 10))); } catch { /* storage unavailable */ } };
export const getRecent = recentGet;
const projectJson = (s) => JSON.stringify({ sequence: s.sequence, media: s.media, projectName: s.projectName, bins: s.bins, seqs: s.seqs }, null, 2);
async function warnMissingFonts() {
  const { missingFonts } = await import('../Services/fonts');
  const miss = await missingFonts(getState());
  if (miss.length) { notify(`Missing fonts: ${miss.map((m) => m.family).join(', ')} - replace them with Graphics and Titles > Replace Fonts in Projects`); set({ missingFonts: miss.map((m) => m.family) }); }
  else set({ missingFonts: [] });
}
/**
 * Before the project is replaced or the window closes: with unsaved changes ask Save / Don't Save / Cancel (Premiere), then
 * run then() unless the user cancelled (or Save was cancelled in the file dialog).
 */
/** Premiere's eight label colours (Clip > Label) */
export const LABELS = [['Violet', '#a990dd'], ['Iris', '#5f7fd6'], ['Caribbean', '#2fbfa8'], ['Lavender', '#e384e3'], ['Cerulean', '#1ba6d6'], ['Forest', '#5aa538'], ['Rose', '#e3729a'], ['Mango', '#e5a23b']];
const selClips = () => { const s = getState(); return s.sequence.clips.filter((c) => s.selection.includes(c.id)); };
const firstMediaClip = () => selClips().find((c) => c.mediaId && mediaById(c.mediaId));
/** the clip-menu commands of Phase B (timeline right-click menu and Clip menu) */
function clipItemCommands() {
  const replaceWith = (fromSource) => () => {
    const s = getState(); const m = mediaById(s.selectedMedia);
    if (!m) return notify(fromSource ? 'Open a clip in the Source Monitor first' : 'Select an item in the Project panel first');
    const inP = fromSource && s.sourceIn != null ? s.sourceIn : 0;
    edit(fromSource ? 'Replace With Clip From Source Monitor' : 'Replace With Clip From Bin', ({ seq, sel }) => seq.clips.filter((c) => sel.includes(c.id) && !c.nestId && !c.graphic && !c.caption).forEach((c) => {
      const avail = m.duration ? Math.max(0.04, (m.duration - inP) / Math.abs(c.speed || 1)) : c.dur;
      Object.assign(c, { mediaId: m.id, name: m.name, inPoint: inP, dur: Math.min(c.dur, avail) }); delete c.elKey;
    }));
  };
  return {
    'clip.editOriginal': () => { const c = firstMediaClip(); const m = c && mediaById(c.mediaId); if (!m?.path) return notify('The selected clip has no source file'); window.editorstage.openExternal(m.path); },
    'clip.revealInProject': () => { const c = firstMediaClip(); if (!c) return notify('The selected clip has no project item'); set({ selectedMedia: c.mediaId }); requestPanel('project'); },
    'clip.revealInExplorer': () => { const c = firstMediaClip(); const m = c && mediaById(c.mediaId); if (!m?.path) return notify('The selected clip has no source file'); window.editorstage.revealInFolder(m.path); },
    'clip.properties': () => { const c = firstMediaClip() || selClips()[0]; if (!c) return notify('Select a clip first'); openDialog('clipProperties', { id: c.id }); },
    'clip.replaceFromSource': replaceWith(true), 'clip.replaceFromBin': replaceWith(false),
    /** Clip > Label > colour (arg = colour hex) and Select Label Group (every clip with the label of the selection) */
    'clip.label': (hex) => hex && edit('Label', ({ seq, sel }) => seq.clips.filter((c) => sel.includes(c.id)).forEach((c) => { c.color = hex; })),
    'clip.selectLabelGroup': () => { const cols = new Set(selClips().map((c) => c.color).filter(Boolean)); if (!cols.size) return; const s = getState(); set({ selection: s.sequence.clips.filter((c) => cols.has(c.color)).filter(onUnlocked(s.sequence)).map((c) => c.id) }); },
    /** Time Interpolation (arg 'sample' | 'blend'): the Frame Sampling / Frame Blending choice of Speed/Duration */
    'clip.timeInterpolation': (mode = 'sample') => edit('Time Interpolation', ({ seq, sel }) => seq.clips.filter((c) => sel.includes(c.id) && c.mediaId).forEach((c) => { c.frameSampling = mode === 'sample' ? undefined : mode; })),
    /** Scale to Frame Size (toggle): fit the source into the frame (on, default) or keep its own pixel size (off) */
    'clip.scaleToFrame': () => { const cs = selClips().filter((c) => c.mediaId); if (!cs.length) return notify('Select a video or still clip first');
      const on = cs.some((c) => c.scaleToFrame === false); edit('Scale to Frame Size', ({ seq, sel }) => seq.clips.filter((c) => sel.includes(c.id) && cs.some((x) => x.id === c.id)).forEach((c) => { if (on) delete c.scaleToFrame; else c.scaleToFrame = false; })); },
    /** Set to Frame Size: Motion > Scale that fits the source into the frame (keeps Scale to Frame Size off, so a later zoom stays sharp) */
    'clip.setToFrame': () => { const cs = selClips().filter((c) => c.mediaId); if (!cs.length) return notify('Select a video or still clip first');
      edit('Set to Frame Size', ({ seq, sel }) => seq.clips.filter((c) => sel.includes(c.id) && cs.some((x) => x.id === c.id)).forEach((c) => {
        const m = mediaById(c.mediaId); let k = 100;
        if (c.scaleToFrame === false && m?.width && m?.height) k = (100 * (m.width / m.height >= seq.width / seq.height ? seq.width : (seq.height * m.width) / m.height)) / m.width;
        c.motion = { ...DEFAULT_MOTION(), ...(c.motion || {}), scale: { v: +k.toFixed(2), keys: null }, scaleW: { v: +k.toFixed(2), keys: null }, uniform: { v: true, keys: null } };
      })); },
    /** transition right-click menu: Clear and Set Transition Duration (arg = transition id, else the selected one) */
    'transition.clear': (id) => { const t = id || getState().selectedTransition; if (!t) return notify('Select a transition first');
      edit('Clear Transition', ({ seq }) => { seq.transitions = (seq.transitions || []).filter((x) => x.id !== t); }); set({ selectedTransition: null }); },
    'transition.duration': (id) => { const t = id || getState().selectedTransition; if (!t) return notify('Select a transition first'); openDialog('transitionDuration', { id: t }); },
    /** gap right-click menu / Delete on a selected gap */
    'timeline.rippleDeleteGap': () => { const g = getState().selectedGap; if (g) rippleGap(g); else notify('Click an empty space between clips first'); },
    /** double-click (Premiere): a media clip opens in the Source Monitor at the frame under the playhead (or its first frame) */
    'clip.openInSource': (id) => { const s = getState(); const c = s.sequence.clips.find((x) => x.id === (id || s.selection[0])); const m = c && mediaById(c.mediaId); if (!m) return;
      const t = s.playhead >= c.start && s.playhead < c.start + c.dur ? s.playhead : c.start;
      set({ selectedMedia: m.id, sourceTime: sourceAt(c, t, s.sequence.fps, m.duration), activeMonitor: 'source' }); requestPanel('source'); },
  };
}
/** true when a selected clip is linked to another clip (Clip > Unlink is offered instead of Link) */
export function isLinkedSelection() {
  const s = getState(); const cs = s.sequence.clips;
  return cs.some((c) => s.selection.includes(c.id) && c.linkId && cs.some((x) => x.id !== c.id && x.linkId === c.linkId));
}
export function confirmDiscard(then) {
  const s = getState(); if (!s.dirty) return then();
  openDialog('unsaved', { name: s.projectName, onSave: async () => { await commands['file.save'](); if (!getState().dirty) then(); }, onDiscard: then });
}
const guarded = (f) => (...a) => confirmDiscard(() => f(...a));
async function openPath(p) {
  loadProject(JSON.parse(await window.editorstage.readText(p)), p); recentAdd(p); warnMissingFonts().catch(() => {});
  // missing source files: mark offline and offer Link Media (like Premiere on open)
  const { checkOffline } = await import('../Services/mediaLink'); if ((await checkOffline()).length) set({ dialog: { type: 'linkMedia', props: {} } });
}
/** The readable part of an IPC error ("Error invoking remote method 'fs:write': Error: ENOSPC: ..." -> "ENOSPC: ..."). */
export const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
/** A Save that did not reach the disk: say why (the file on disk is unchanged, the write is atomic) and offer Save As. */
function saveFailed(path, e) {
  const msg = `Could not save ${path.split(/[\\/]/).pop()}: ${errText(e)}`;
  notify(msg);
  openDialog('confirm', { title: 'Save Failed', message: `${msg}. The file on disk was not changed. Save the project to another location?`, okLabel: 'Save As...', onOk: () => commands['file.saveAs']() });
}
/** Write the project; true when it reached the disk. Edits made while the file is being written stay unsaved. */
async function saveProject(path) {
  const tok = saveToken(); const text = projectJson(getState());
  try { await window.editorstage.writeFile(path, text); } catch (e) { saveFailed(path, e); return false; }
  set({ projectPath: path }); markSaved(tok); recentAdd(path);
  // every Save also records a revision in the project history (deduplicated, so it costs almost nothing)
  commitRevision('Save').catch((e) => notify('History: ' + e.message));
  return true;
}
async function importAny(paths) {
  const { INTERCHANGE_EXT, importInterchange } = await import('../Services/interchange');
  const seqFiles = paths.filter((p) => INTERCHANGE_EXT.includes(p.split('.').pop().toLowerCase()));
  const mediaFiles = paths.filter((p) => !seqFiles.includes(p));
  if (mediaFiles.length) await importPaths(mediaFiles, notify);
  for (const p of seqFiles) {
    try { const r = await importInterchange(p); notify(`Imported ${r.name}: ${r.clips} clips${r.offline ? `, ${r.offline} offline media` : ''}${r.skipped ? `, ${r.skipped} unsupported items skipped` : ''}`); }
    catch (e) { notify(`Cannot import ${p.split(/[\\/]/).pop()}: ${e.message || e}`); }
  }
}
const exportInterchange = (format) => async () => {
  const { exportInterchangeFile } = await import('../Services/interchange');
  try {
    const r = await exportInterchangeFile(format);
    if (r) notify(`Exported ${r.files.map((f) => f.split(/[\\/]/).pop()).join(', ')}${r.skipped ? ` (${r.skipped} titles / captions / nested items cannot be interchanged and were left out)` : ''}`);
  } catch (e) { notify(`Export failed: ${e.message || e}`); }
};

// ---------- sequences, nesting ----------
/** File > New > Sequence: a new sequence with the given settings and track counts (Preferences default 3 + 3), opened */
export function createSequence({ name, width, height, fps, par = '1/1', sampleRate = 48000, vt = getPrefs().videoTracks, at = getPrefs().audioTracks }) {
  const base = getState().sequence; const q = newSeqObj(base, name || `Sequence ${String(Object.keys(allSeqs()).length + 1).padStart(2, '0')}`);
  Object.assign(q, { width: width || base.width, height: height || base.height, fps: fps || base.fps, par, sampleRate });
  const T = (id, kind) => ({ id, kind, muted: false, solo: false, locked: false, sync: true });
  q.tracks = [...Array.from({ length: Math.max(1, vt) }, (_, i) => T(`V${Math.max(1, vt) - i}`, 'video')), ...Array.from({ length: Math.max(1, at) }, (_, i) => T(`A${i + 1}`, 'audio'))];
  addSequence(q, true); return q;
}
const DEFAULT_TRACKS = () => [['V3', 'video'], ['V2', 'video'], ['V1', 'video'], ['A1', 'audio'], ['A2', 'audio'], ['A3', 'audio']].map(([id, kind]) => ({ id, kind, muted: false, solo: false, locked: false, sync: true }));
export const newSeqObj = (base, name) => ({ id: uid(), name, fps: base.fps, width: base.width, height: base.height, duration: 60, tracks: DEFAULT_TRACKS(), clips: [], transitions: [], markers: [] });

/** Clips Nest / Make Subsequence work on: the selection, without clips on locked tracks. */
const nestSource = () => { const s = getState(); return s.sequence.clips.filter((c) => s.selection.includes(c.id)).filter(onUnlocked(s.sequence)); };
export const defaultNestName = () => `Nested Sequence ${String(Object.keys(allSeqs()).length).padStart(2, '0')}`;
/**
 * Make Subsequence (replace = false) or Nest (replace = true, Premiere): the selected clips move into a new sequence and are
 * replaced by a nested clip on the topmost video track they used (and, when sound was selected, a linked nested clip on
 * the first audio track they used - picture-only selection gives a picture-only nest, sound-only a nest on the audio track).
 */
export function seqFromSelection(replace, name) {
  const s = getState(); const seq = s.sequence; const clips = nestSource();
  if (!clips.length) return notify('Select one or more clips first');
  const a = Math.min(...clips.map((c) => c.start)), b = Math.max(...clips.map((c) => c.start + c.dur));
  const ids = new Set(clips.map((c) => c.id));
  const sub = newSeqObj(seq, name || (replace ? defaultNestName() : `Subsequence ${Object.keys(allSeqs()).length}`));
  sub.tracks = structuredClone(seq.tracks).map((t) => ({ ...t, locked: false }));
  sub.clips = clips.map((c) => ({ ...structuredClone(c), start: c.start - a }));
  sub.transitions = (seq.transitions || []).filter((t) => (!t.aId || ids.has(t.aId)) && (!t.bId || ids.has(t.bId))).map((t) => ({ ...structuredClone(t), at: t.at - a }));
  addSequence(sub, false);
  if (!replace) return notify(`Created ${sub.name} (open it from the Project panel)`);
  const used = (kind) => ed.kindTracks(seq, kind).map((t) => t.id).filter((id) => clips.some((c) => c.track === id));
  const vt = [...used('caption'), ...used('video')].slice(-1)[0] || null; // topmost picture track
  const at = used('audio')[0] || null;
  edit('Nest', ({ seq: q, sel }) => {
    q.clips = q.clips.filter((c) => !ids.has(c.id));
    q.transitions = (q.transitions || []).filter((t) => !ids.has(t.aId) && !ids.has(t.bId));
    const base = { start: a, dur: b - a, name: sub.name, nestId: sub.id, inPoint: 0, speed: 1, effects: [], enabled: true };
    const link = vt && at ? uid() : undefined; const out = [];
    for (const [track, audio] of [[vt, false], [at, true]]) {
      if (!track) continue;
      ed.overwriteRange(q, track, a, b); // the nest takes exactly the selected span: unselected clips there are trimmed, never stacked
      const id = uid(); out.push(id);
      q.clips.push({ id, track, ...base, color: audio ? '#3f8a5a' : '#6a9955', ...(audio ? { asAudio: true } : {}), ...(link ? { linkId: link } : {}), ...(!audio && link ? { noAudio: true } : {}) });
    }
    ed.fixTransitions(q); sel.splice(0, sel.length, ...out);
  });
}
export function addSequenceToTimeline(seqId, at, track = null, opts = {}) {
  const sub = allSeqs()[seqId]; if (!sub || seqId === getState().sequence.id) return notify('Cannot nest a sequence inside itself');
  const dur = Math.max(0.5, ed.sequenceEnd(sub));
  edit(`${opts.insert ? 'Insert' : 'Add'} ${sub.name}`, ({ seq, sel }) => {
    const t = track && ed.trackKind(seq, track) === 'video' ? track : (seq.tracks.filter((x) => x.kind === 'video' && !x.locked).sort((x, y) => x.id.localeCompare(y.id))[0] || {}).id; if (!t) return;
    const id = uid(); const clip = { id, track: t, start: at, dur, name: sub.name, nestId: seqId, inPoint: 0, speed: 1, color: '#6a9955', effects: [], enabled: true };
    if (opts.insert) { ed.insertClips(seq, [clip], at); ed.fixTransitions(seq); } else seq.clips.push(clip);
    sel.splice(0, sel.length, id);
  });
}

// ---------- link / group / synchronize / multi-camera ----------
export const expandSelection = (seq, ids, linked = true) => {
  const keys = new Set(seq.clips.filter((c) => ids.includes(c.id)).flatMap((c) => [linked ? c.linkId : null, c.group].filter(Boolean)));
  const free = onUnlocked(seq); // a linked / grouped partner on a locked track stays where it is
  return seq.clips.filter((c) => ids.includes(c.id) || (free(c) && ((c.linkId && keys.has(c.linkId)) || (c.group && keys.has(c.group))))).map((c) => c.id);
};
async function envelope(clip) {
  const m = mediaById(clip.mediaId); if (!m) return null; const pk = await peaksFor(m); if (!pk) return null;
  const i0 = Math.floor((clip.inPoint || 0) * pk.per), n = Math.min(Math.floor(clip.dur * (clip.speed || 1) * pk.per), pk.out.length - i0);
  return { env: pk.out.subarray(Math.max(0, i0), Math.max(0, i0) + Math.max(0, n)), per: pk.per };
}
/** Offset (seconds) to add to `other.start` so its audio lines up with ref's, via envelope cross-correlation. */
async function audioOffset(ref, other, maxSec = 20) {
  const A = await envelope(ref), B = await envelope(other); if (!A || !B || !A.env.length || !B.env.length) return null;
  const per = A.per, maxLag = Math.min(Math.floor(maxSec * per), Math.max(A.env.length, B.env.length));
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length; const ma = mean(A.env), mb = mean(B.env);
  let best = -Infinity, bestL = 0;
  for (let L = -maxLag; L <= maxLag; L += 1) {
    let s = 0, cnt = 0; for (let i = Math.max(0, -L); i < B.env.length && i + L < A.env.length; i++) { s += (A.env[i + L] - ma) * (B.env[i] - mb); cnt++; }
    if (cnt > per * 0.5) { s = (s / cnt) * Math.sqrt(cnt / Math.min(A.env.length, B.env.length)); if (s > best) { best = s; bestL = L; } }
  }
  return (ref.start - other.start) + bestL / per; // timeline shift
}
export async function synchronizeClips(mode) {
  const s = getState(); const clips = s.sequence.clips.filter((c) => s.selection.includes(c.id)); if (clips.length < 2) return notify('Select two or more clips to synchronize');
  const ref = clips[0]; const shifts = {};
  for (const c of clips.slice(1)) {
    if (mode === 'start') shifts[c.id] = ref.start - c.start;
    else if (mode === 'end') shifts[c.id] = (ref.start + ref.dur) - (c.start + c.dur);
    else { const off = await audioOffset(ref, c); if (off == null) { notify('Audio sync failed (no audio data)'); continue; } shifts[c.id] = off; }
  }
  edit('Synchronize', ({ seq }) => {
    const sel = seq.clips.filter((c) => s.selection.includes(c.id));
    for (const c of sel) if (shifts[c.id] != null) c.start += shifts[c.id];
    const low = Math.min(...sel.map((c) => c.start)); if (low < 0) for (const c of sel) c.start -= low; // keep everything on-timeline by sliding the whole group
  });
  notify('Synchronized by ' + mode);
}
const multicamCams = () => { const s = getState(); const seq = s.sequence; return seq.clips.filter((c) => s.selection.includes(c.id) && ed.trackKind(seq, c.track) === 'video' && !c.nestId && c.mediaId); };
/** Clip > Multi-Camera > Create Multi-Camera Source Sequence...: the dialog (name, synchronize point) runs createMulticam */
const createMulticamDialog = () => (multicamCams().length < 2 ? notify('Select two or more video clips (one per camera) first') : openDialog('multicam', { cams: multicamCams().length, name: `Multicam ${Object.keys(allSeqs()).length}` }));
/** sync: 'audio' (match the sound), 'in' (the clips' in points line up) or 'timeline' (keep their timeline positions) */
export async function createMulticam({ name, sync = 'audio' } = {}) {
  const s = getState(); const seq = s.sequence;
  const cams = multicamCams();
  if (cams.length < 2) return notify('Select two or more video clips (one per camera) first');
  const shifts = [0]; if (sync === 'audio') for (const c of cams.slice(1)) shifts.push((await audioOffset(cams[0], c)) ?? 0);
  const pos = sync === 'in' ? cams.map(() => 0) : cams.map((c, i) => c.start + (shifts[i] || 0)); const t0 = Math.min(...pos);
  const sub = newSeqObj(seq, name || `Multicam ${Object.keys(allSeqs()).length}`);
  sub.tracks = [...cams.map((_, i) => ({ id: `V${cams.length - i}`, kind: 'video', muted: false, solo: false, locked: false, sync: true })), { id: 'A1', kind: 'audio', muted: false, solo: false, locked: false, sync: true }];
  cams.forEach((c, i) => sub.clips.push({ ...structuredClone(c), id: uid(), track: `V${i + 1}`, start: pos[i] - t0, linkId: undefined, noAudio: i !== 0 }));
  const m0 = mediaById(cams[0].mediaId);
  if (m0?.hasAudio !== false) sub.clips.push({ ...structuredClone(cams[0]), id: uid(), track: 'A1', start: pos[0] - t0, asAudio: true, noAudio: false, linkId: undefined });
  sub.clips[0].noAudio = true;
  const end = Math.max(...sub.clips.map((c) => c.start + c.dur));
  addSequence(sub, false);
  edit('Create Multi-Camera', ({ seq: q, sel }) => {
    const ids = new Set(cams.map((c) => c.id)); const linked = new Set(cams.map((c) => c.linkId).filter(Boolean));
    q.clips = q.clips.filter((c) => !ids.has(c.id) && !(c.linkId && linked.has(c.linkId)));
    const id = uid(); q.clips.push({ id, track: cams[0].track, start: t0, dur: end, name: sub.name, nestId: sub.id, multicam: true, cuts: [{ t: 0, cam: 0 }], inPoint: 0, speed: 1, color: '#c5a028', effects: [], enabled: true });
    sel.splice(0, sel.length, id);
  });
}
const cutCamera = (c, n, playhead) => edit(`Camera ${n + 1}`, ({ seq }) => { const k = seq.clips.find((x) => x.id === c.id); const t = Math.max(0, playhead - k.start); k.cuts = [...(k.cuts || []).filter((q) => Math.abs(q.t - t) > 0.02), { t, cam: n }].sort((a, b) => a.t - b.t); });
const setCam = (n) => () => { const s = getState(); const c = s.sequence.clips.find((x) => x.multicam && s.selection.includes(x.id)) || s.sequence.clips.find((x) => x.multicam && s.playhead >= x.start && s.playhead < x.start + x.dur);
  if (!c) return notify('No multi-camera clip selected or under the playhead'); const cams = (s.seqs?.[c.nestId]?.tracks || []).filter((t) => t.kind === 'video').length; if (cams && n >= cams) return notify(`This multi-camera clip has ${cams} cameras`); cutCamera(c, n, s.playhead); };

// ---------- Voice-Over Record ----------
let rec = null;
async function toggleVoiceOver(trackId) {
  if (rec) { rec.stop(); return; }
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return notify('Microphone unavailable: ' + (e.message || e)); }
  const chunks = []; const start = getState().playhead; const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  mr.ondataavailable = (e) => chunks.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); rec = null; set({ recording: null, playing: false });
    const buf = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
    const m = await importRecording(buf, 'audio', 'Voice-over'); if (m) addMediaToTimeline(m, start, trackId);
  };
  rec = mr; mr.start(); set({ recording: trackId, playing: true, rate: 1 }); notify('Recording voice-over… click the mic again to stop');
}
/** Save a MediaRecorder blob, transcode it with FFmpeg to a seekable file (H.264 / WAV), import it, return the media item. */
export async function importRecording(bytes, kind, label) {
  const tmp = await window.editorstage.tmpDir(); const src = `${tmp}\\${label.replace(/[^\w-]+/g, '_')}-${Date.now()}.webm`;
  await window.editorstage.writeFile(src, bytes);
  const r = await window.editorstage.transcode(src, kind); if (!r.ok) { notify('Recording failed to convert: ' + r.error); return null; }
  const items = await importPaths([r.path], notify, { kind }); const m = items[0]; if (!m) return null;
  edit('Rename recording', ({ media }) => { const x = media.find((q) => q.id === m.id); if (x) x.name = `${label}.${kind === 'video' ? 'mp4' : 'wav'}`; });
  return mediaById(m.id);
}

// ---------- Preview rendering ----------
let renderCancel = false;
const doRender = async (mode) => {
  const { renderPreview } = await import('../Services/preview'); renderCancel = false;
  set({ dialog: { type: 'renderProgress' } });
  const r = await renderPreview(mode, () => renderCancel); set({ dialog: null, renderProgress: null });
  notify(r.ok ? 'Render complete - green bar on the ruler marks rendered ranges' : 'Render stopped: ' + (r.error || ''));
};
export const cancelRender = () => { renderCancel = true; };
// File > Export > AAF: audio extraction runs with the Rendering dialog (its Cancel stops FFmpeg)
const exportAAF = async () => {
  renderCancel = false;
  const { exportAAFFile } = await import('../Services/interchange/aafExport');
  try {
    const r = await exportAAFFile({ cancelled: () => renderCancel, onProgress: (p, text) => { if (!getState().dialog) set({ dialog: { type: 'renderProgress' } }); set({ renderProgress: { p, text } }); } });
    if (r) notify(`Exported ${r.files[0].split(/[\\/]/).pop()} (${r.clips} audio clips${r.skipped ? `; ${r.skipped} clips without usable audio were left out` : ''})`);
  } catch (e) { notify(String(e.message) === 'Cancelled' ? 'AAF export cancelled' : `Export failed: ${e.message || e}`); }
  set({ dialog: null, renderProgress: null });
};

const smart = (tab) => () => { set({ smartTab: tab }); requestPanel('smartTools'); };

export const commands = {
  // File
  'file.newProject': guarded(() => resetProject()),
  'file.newSequence': () => openDialog('newSequence'),
  'file.newBin': () => set((s) => ({ bins: [...(s.bins || []), { id: uid(), name: `Bin ${(s.bins || []).length + 1}` }] })),
  'file.newSearchBin': dialog('searchBin'),
  'file.linkMedia': dialog('linkMedia'),
  'file.makeOffline': () => { const id = getState().selectedMedia; const m = getState().media.find((x) => x.id === id); if (!m || m.synthetic || !m.path) return notify('Select a media item in the Project panel first'); openDialog('makeOffline', { id }); },
  'file.makeOfflineNow': (id) => { const m = getState().media.find((x) => x.id === id); if (!m) return; edit('Make Offline', ({ media }) => { const x = media.find((q) => q.id === id); x.status = 'offline'; x.madeOffline = true; x.error = 'Media offline'; }); },
  'media.createProxies': dialog('createProxies'),
  // Project panel item menu (id defaults to the selected item)
  'media.rename': (id = getState().selectedMedia) => id && openDialog('renameMedia', { id }),
  'media.duplicate': (id = getState().selectedMedia) => id && edit('Duplicate', ({ media }) => { const i = media.findIndex((m) => m.id === id); if (i < 0) return;
    const m = media[i]; const base = m.name.replace(/(\.[^.]+)?$/, ''); const ext = m.name.slice(base.length);
    media.splice(i + 1, 0, { ...structuredClone(m), id: uid(), name: `${base} copy${ext}`, proxy: m.proxy ? structuredClone(m.proxy) : undefined }); }),
  'media.label': (id = getState().selectedMedia, hex = null) => id && edit('Label', ({ media }) => { const m = media.find((x) => x.id === id); if (m) m.color = hex || undefined; }),
  'media.attachProxy': async () => { const id = getState().selectedMedia; if (!id) return notify('Select a video item in the Project panel first'); const [p] = await window.editorstage.openDialog('media'); if (!p) return; try { const { attachProxy } = await import('../Services/proxy'); await attachProxy(id, p); } catch (e) { notify(`Attach Proxies: ${e.message || e}`); } },
  'media.detachProxy': async () => { const id = getState().selectedMedia; if (!id) return notify('Select an item in the Project panel first'); const { detachProxy } = await import('../Services/proxy'); detachProxy(id); },
  'view.toggleProxies': () => set((s) => ({ useProxies: !s.useProxies })),
  'file.newAdjustmentLayer': dialog('synthetic', { type: 'adjustment' }),
  'file.newBarsAndTone': dialog('synthetic', { type: 'bars' }),
  'file.newBlackVideo': dialog('synthetic', { type: 'black' }),
  'file.newColorMatte': dialog('synthetic', { type: 'color' }),
  'file.newCountdown': dialog('synthetic', { type: 'countdown' }),
  'file.newTransparentVideo': dialog('synthetic', { type: 'transparent' }),
  'file.open': guarded(async () => { const [p] = await window.editorstage.openDialog('project'); if (p) await openPath(p); }),
  'file.openRecent': guarded((p) => openPath(p).catch(() => notify('Could not open ' + p))),
  'file.close': () => { if (!closeActivePanel()) notify('No panel is active'); },
  'file.closeProject': guarded(() => resetProject()),
  'file.save': async () => {
    const s = getState();
    const path = s.projectPath || (await window.editorstage.saveDialog('project', `${s.projectName}.esproj`));
    if (path) await saveProject(path);
  },
  'file.saveAs': async () => { const path = await window.editorstage.saveDialog('project', `${getState().projectName}.esproj`); if (path) await saveProject(path); },
  'file.saveCopy': async () => {
    const s = getState(); const path = await window.editorstage.saveDialog('project', `${s.projectName}-copy.esproj`); if (!path) return;
    try { await window.editorstage.writeFile(path, projectJson(s)); notify('Saved a copy as ' + path); } catch (e) { saveFailed(path, e); }
  },
  'file.revert': () => { const p = getState().projectPath; if (!p) return notify('Nothing to revert (project not saved)'); if (!getState().dirty) return openPath(p);
    openDialog('confirm', { title: 'Revert', message: `Discard all changes since ${p.split(/[\\/]/).pop()} was last saved?`, okLabel: 'Revert', onOk: () => openPath(p) }); },
  /** a project opened from Explorer while EditorStage runs (or at start-up) */
  'file.openExternal': guarded((p) => openPath(p).catch(() => notify('Could not open ' + p))),
  'file.saveRevision': () => openDialog('revision'),
  'file.capture': dialog('capture'),
  'file.import': async () => { const paths = await window.editorstage.openDialog('media', true); if (paths.length) await importAny(paths); },
  'file.importSequence': async () => { const paths = await window.editorstage.openDialog('interchange', true); if (paths.length) await importAny(paths); },
  'file.exportMedia': dialog('export'),
  'file.exportFrame': dialog('exportFrame'),
  'file.exportQueue': dialog('exportQueue'),
  'file.healthCheck': dialog('healthCheck'),
  'file.exportSelection': exportInterchange('xmeml'),
  'file.exportFCPXML': exportInterchange('fcpxml'),
  'file.exportEDL': exportInterchange('edl'),
  'file.exportAAF': exportAAF,
  'file.projSettings.general': dialog('projectSettings'),
  'file.projSettings.scratch': dialog('projectSettings'),
  'file.projSettings.ingest': dialog('projectSettings'),
  'app.quit': () => window.editorstage.windowControl('close'),
  'help.about': dialog('about'),
  'help.licenses': () => openDialog('licenses'),
  'help.licensesFolder': async () => { const p = await window.editorstage.licensesDir(); if (!p) return notify('The license folder is added when the installer is built (npm run dist)'); const r = await window.editorstage.openExternal(p); if (r) notify(`Cannot open ${p}: ${r}`); },

  // Edit
  'edit.undo': undo,
  'edit.redo': redo,
  'edit.cut': () => { commands['edit.copy'](); removeSelected(false); },
  // the clipboard keeps each clip's track kind and number (ti), so it pastes onto the right kind of track even after tracks moved
  'edit.copy': () => { const seq = getState().sequence; clipboard = clipsSel().map((c) => { const kind = ed.trackKind(seq, c.track); return { ...structuredClone(c), kind, ti: ed.kindTracks(seq, kind).findIndex((t) => t.id === c.track) }; }); },
  'edit.paste': () => pasteClips(false),
  'edit.pasteInsert': () => pasteClips(true),
  // Paste Attributes / Remove Attributes (Premiere): dialogs with one checkbox per attribute and effect (src/Core/attributes.js)
  'edit.pasteAttributes': () => { if (!clipboard.length) return notify('Copy a clip first (Ctrl+C)'); if (!clipsSel().length) return notify('Select the clips to paste onto'); openDialog('pasteAttributes'); },
  'edit.removeAttributes': () => (clipsSel().length ? openDialog('removeAttributes') : notify('Select one or more clips first')),
  'edit.clear': () => removeSelected(false),
  'edit.rippleDelete': () => removeSelected(true),
  // Duplicate (timeline): copies of the selection right after it, overwriting what is there; copied V+A pairs are linked to
  // each other only (same as Alt+drag). Kept on the timeline rather than Premiere's Project-panel duplicate (see PROGRESS.md).
  'edit.duplicate': () => edit('Duplicate', ({ seq, sel }) => {
    const ids = expandSelection(seq, sel, getState().toggles.linked); const src = seq.clips.filter((c) => ids.includes(c.id)); if (!src.length) return;
    const span = Math.max(...src.map(ed.clipEnd)) - Math.min(...src.map((c) => c.start));
    const out = ed.dragClips(seq, ids, span, {}, 'duplicate'); ed.fixTransitions(seq); sel.splice(0, sel.length, ...out);
  }),
  'edit.selectAll': () => set((s) => ({ selection: s.sequence.clips.filter(onUnlocked(s.sequence)).map((c) => c.id) })),
  'edit.deselectAll': () => set({ selection: [] }),
  'edit.find': () => requestPanel('find'),
  'edit.insert': () => sourceEdit('insert'),
  'edit.overwrite': () => sourceEdit('overwrite'),
  'edit.audiostage': () => editInAudioStage().catch((e) => notify('Edit in AudioStage failed: ' + (e.message || e))),
  'edit.audition': async () => {
    const s = getState(); const c = s.sequence.clips.find((x) => s.selection.includes(x.id) && x.mediaId); const m = c && mediaById(c.mediaId);
    if (!m) return notify('Select an audio clip first');
    const r = await window.editorstage.openExternal(m.path); notify(r ? 'Could not open: ' + r : 'Opened in the default application (Audition if associated)');
  },
  'edit.shortcuts': dialog('shortcuts'),
  'edit.preferences': dialog('preferences'),

  // Clip
  'clip.rename': dialog('rename'),
  'clip.makeSubsequence': () => seqFromSelection(false),
  'clip.nest': () => (nestSource().length ? openDialog('nestName', { name: defaultNestName() }) : notify('Select one or more clips first')),
  ...clipItemCommands(),
  'clip.makeSubclip': () => openDialog('editSubclip', { create: true }),
  'clip.editSubclip': () => openDialog('editSubclip', {}),
  'clip.audioGain': dialog('audioGain'),
  'clip.audioChannels': dialog('audioChannels'),
  'clip.fieldOptions': dialog('fieldOptions'),
  'clip.frameHold': dialog('frameHold'),
  'clip.speed': dialog('speed'),
  'clip.sceneEditDetection': dialog('sceneDetect'),
  'clip.trackObject': () => set({ dialog: { type: 'trackObject', props: { clipId: getState().selection[0] } } }),
  'clip.addFrameHold': () => { const s = getState(); let n = 0; edit('Add Frame Hold', ({ seq, sel }) => { const ids = ed.addFrameHold(seq, s.selection, s.playhead, s.sequence.fps); n = ids.length; if (n) sel.splice(0, sel.length, ...ids); }); if (!n) notify('Put the playhead over a video clip first'); },
  'clip.insertFrameHold': () => { const s = getState(); let id = null; edit('Insert Frame Hold Segment', ({ seq, sel }) => { id = ed.insertFrameHold(seq, s.selection, s.playhead, 2, s.sequence.fps); if (id) sel.splice(0, sel.length, id); }); if (!id) notify('Put the playhead over a video clip first'); },
  'clip.removeEffects': () => (clipsSel().length ? openDialog('removeAttributes', { title: 'Remove Effects' }) : notify('Select one or more clips first')),
  // one state for the whole selection (Premiere): any enabled clip -> disable them all, all disabled -> enable them all
  'clip.enable': () => edit('Enable', ({ seq, sel }) => { const cs = seq.clips.filter((c) => sel.includes(c.id)); const on = !cs.some((c) => c.enabled !== false); cs.forEach((c) => { c.enabled = on; }); }),
  'clip.nudgeUp': () => nudgeTracks(true), 'clip.nudgeDown': () => nudgeTracks(false),
  'clip.nudgeLeft': () => nudgeFrames(-1), 'clip.nudgeRight': () => nudgeFrames(1),
  'clip.nudgeLeft5': () => nudgeFrames(-5), 'clip.nudgeRight5': () => nudgeFrames(5),
  // Unlink only drops the link: the video clip stays picture-only (its sound is the separate audio clip), as in Premiere
  'clip.unlink': () => edit('Unlink', ({ seq, sel }) => { const ls = new Set(seq.clips.filter((c) => sel.includes(c.id)).map((c) => c.linkId).filter(Boolean)); seq.clips.forEach((c) => { if (ls.has(c.linkId)) c.linkId = undefined; }); }),
  // Link (Premiere): the selected picture and sound clips become one linked set, where they are (nothing moves). A picture
  // clip linked with sound from its own file stops playing its embedded sound, so the file is never heard twice.
  'clip.link': () => {
    const s = getState(); const cs = s.sequence.clips.filter((c) => s.selection.includes(c.id)).filter(onUnlocked(s.sequence));
    const audio = (c) => ed.trackKind(s.sequence, c.track) === 'audio';
    if (!cs.some(audio) || !cs.some((c) => !audio(c))) return notify('Select at least one picture clip and one sound clip to link');
    edit('Link', ({ seq }) => {
      const ids = new Set(cs.map((c) => c.id)); const link = uid(); const mine = seq.clips.filter((c) => ids.has(c.id));
      mine.forEach((c) => { c.linkId = link; });
      mine.filter((c) => !audio(c) && c.mediaId && mine.some((a) => audio(a) && a.mediaId === c.mediaId)).forEach((c) => { c.noAudio = true; });
    });
  },
  /** Ctrl+L / Clip > Link | Unlink: Unlink when a selected clip is linked, else Link */
  'clip.linkToggle': () => commands[isLinkedSelection() ? 'clip.unlink' : 'clip.link'](),
  'clip.group': () => edit('Group', ({ seq, sel }) => { const g = uid(); seq.clips.filter((c) => sel.includes(c.id)).forEach((c) => { c.group = g; }); }),
  'clip.ungroup': () => edit('Ungroup', ({ seq, sel }) => { const gs = new Set(seq.clips.filter((c) => sel.includes(c.id)).map((c) => c.group).filter(Boolean)); seq.clips.forEach((c) => { if (gs.has(c.group)) c.group = undefined; }); }),
  'clip.synchronize': () => openDialog('sync'),
  'clip.multicamCreate': createMulticamDialog,
  'clip.multicamEnable': () => edit('Toggle Multi-Camera', ({ seq, sel }) => seq.clips.filter((c) => sel.includes(c.id) && c.multicam).forEach((c) => { c.mcDisabled = !c.mcDisabled; })),
  'clip.multicamView': () => set((s) => ({ mcView: !s.mcView })),
  'clip.multicam1': setCam(0), 'clip.multicam2': setCam(1), 'clip.multicam3': setCam(2), 'clip.multicam4': setCam(3), 'clip.multicam5': setCam(4),
  'clip.multicam6': setCam(5), 'clip.multicam7': setCam(6), 'clip.multicam8': setCam(7), 'clip.multicam9': setCam(8),
  /** cut to camera n on whichever multi-camera clip is under the playhead */
  'clip.multicamCut': (n) => { const s = getState(); const c = s.sequence.clips.find((x) => x.multicam && s.playhead >= x.start && s.playhead < x.start + x.dur); if (c) cutCamera(c, n, s.playhead); },

  // Sequence
  'seq.settings': dialog('sequenceSettings'),
  'seq.open': (id) => switchSequence(id),
  'seq.renderEffects': () => doRender('effects'), 'seq.renderInOut': () => doRender('inout'), 'seq.renderAudio': () => doRender('audio'),
  'seq.deleteRender': async () => { const { deleteRenderFiles } = await import('../Services/preview'); await deleteRenderFiles(); notify('Render files deleted'); },
  'seq.matchFrame': () => {
    // the clip on the topmost targeted video track under the playhead, else on the targeted audio tracks (no target flags: every track)
    const s = getState(); const q = s.sequence;
    const order = [...ed.kindTracks(q, 'video').reverse(), ...ed.kindTracks(q, 'audio')].filter((t) => !ed.hasTargets(q, t.kind) || t.target).map((t) => t.id);
    const c = q.clips.filter((x) => x.mediaId && order.includes(x.track) && s.playhead >= x.start && s.playhead < x.start + x.dur).sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track))[0];
    if (c) { set({ selectedMedia: c.mediaId, sourceTime: sourceAt(c, s.playhead, s.sequence.fps, mediaById(c.mediaId)?.duration) }); requestPanel('source'); } else notify('No clip under the playhead');
  },
  'clip.remix': (clipId) => set({ dialog: { type: 'remix', props: { clipId: typeof clipId === 'string' ? clipId : undefined } } }), // Remix (music to a new length)
  'seq.trimMode': toggleTrim, // Sequence > Trim Edit (Shift+T): Trim Monitor on the edit nearest the playhead
  'seq.addEdit': () => addEdit(getState().playhead, null, ed.editTracks(getState().sequence)),
  'seq.addEditAll': () => addEdit(),
  'seq.videoTransition': () => applyDefaultTransition('video'),
  'seq.audioTransition': () => applyDefaultTransition('audio'),
  'seq.defaultTransitions': () => applyDefaultTransition(['video', 'audio']),
  // Q / W / Alt+Q / Alt+W / E / D (Premiere), on the targeted tracks
  'seq.rippleTrimPrev': () => trimToPlayhead('prev', true), 'seq.rippleTrimNext': () => trimToPlayhead('next', true),
  'seq.trimPrev': () => trimToPlayhead('prev', false), 'seq.trimNext': () => trimToPlayhead('next', false),
  'seq.extendEdit': () => { const s = getState(); if (!s.selection.length) return notify('Select a clip first');
    edit('Extend Edit', ({ seq, sel }) => { ed.extendToPlayhead(seq, (c) => { const m = c.mediaId && mediaById(c.mediaId); return !m || m.kind === 'image' ? Infinity : m.duration; }, sel, s.playhead); ed.fixTransitions(seq); }); },
  'seq.selectAtPlayhead': () => { const s = getState(); const ids = ed.clipsAt(s.sequence, s.playhead, ed.editTracks(s.sequence)); set({ selection: expandSelection(s.sequence, ids, s.toggles.linked) }); },
  'seq.lift': () => {
    const s = getState();
    if (s.inPoint != null && s.outPoint != null && s.outPoint > s.inPoint) edit('Lift', ({ seq }) => { ed.removeRange(seq, s.inPoint, s.outPoint, false); ed.fixTransitions(seq); });
    else removeSelected(false);
  },
  'seq.extract': () => {
    const s = getState();
    if (s.inPoint != null && s.outPoint != null && s.outPoint > s.inPoint) edit('Extract', ({ seq }) => { ed.removeRange(seq, s.inPoint, s.outPoint, true); ed.fixTransitions(seq); });
    else removeSelected(true);
  },
  'seq.zoomIn': () => set((s) => ({ pps: Math.min(400, s.pps * 1.4) })),
  'seq.zoomOut': () => set((s) => ({ pps: Math.max(4, s.pps / 1.4) })),
  'seq.zoomFit': () => set((s) => ({ pps: Math.min(200, Math.max(4, 700 / Math.max(5, ed.sequenceEnd(s.sequence)))) })),
  'seq.snap': () => set((s) => ({ toggles: { ...s.toggles, snap: !s.toggles.snap } })),
  'seq.linked': () => set((s) => ({ toggles: { ...s.toggles, linked: !s.toggles.linked } })),

  // Markers
  'marker.add': addMarker,
  /** Clear Selected Marker (Ctrl+Alt+M): the marker clicked last, else the sequence marker at the playhead */
  'marker.clearSelected': () => {
    const s = getState(); const id = s.selectedMarker && s.sequence.markers.some((m) => m.id === s.selectedMarker) ? s.selectedMarker : markerAt(s.sequence.markers, s.playhead, s.sequence.fps)?.id;
    if (!id) return notify('No marker selected'); updateMarker('seq', null, id, null); set({ selectedMarker: null });
  },
  /** Marker dialog of the selected marker / the marker at the playhead */
  'marker.editClip': (p) => p && openDialog('marker', p),
  'marker.edit': (mid) => { const s = getState(); if (typeof mid === 'string' && s.sequence.markers.some((m) => m.id === mid)) return openDialog('marker', { scope: 'seq', id: mid });
    const id = s.selectedMarker && s.sequence.markers.some((m) => m.id === s.selectedMarker) ? s.selectedMarker : markerAt(s.sequence.markers, s.playhead, s.sequence.fps)?.id;
    if (!id) return notify('No marker at the playhead'); openDialog('marker', { scope: 'seq', id }); },
  'marker.next': () => goMarker(1),
  'marker.prev': () => goMarker(-1),
  'marker.clear': () => edit('Clear All Markers', ({ seq }) => { seq.markers = []; }),
  'marker.markIn': setIO('inPoint'), 'marker.markOut': setIO('outPoint'),
  'marker.goIn': goIO('inPoint'), 'marker.goOut': goIO('outPoint'),
  'marker.clearIn': clearIO('inPoint'), 'marker.clearOut': clearIO('outPoint'),
  'marker.clearInOut': clearIO('inPoint', 'outPoint'),
  'marker.markClip': () => {
    if (onSource()) { const m = getState().media.find((x) => x.id === getState().selectedMedia); const [a, b] = mediaRange(m); return set({ sourceIn: a, sourceOut: b }); }
    const c = clipsSel()[0]; if (c) set({ inPoint: c.start, outPoint: c.start + c.dur });
  },
  'marker.markSelection': () => { const cs = clipsSel(); if (cs.length) set({ inPoint: Math.min(...cs.map((c) => c.start)), outPoint: Math.max(...cs.map((c) => c.start + c.dur)) }); },

  // Graphics and Titles
  'gfx.newText': () => addGraphic('text'), 'gfx.newVText': () => addGraphic('vtext'),
  'gfx.newRect': () => addGraphic('rect'), 'gfx.newEllipse': () => addGraphic('ellipse'), 'gfx.newPolygon': () => addGraphic('polygon'),
  'gfx.replaceFonts': dialog('replaceFonts'),
  'gfx.installMogrt': async () => {
    const paths = await window.editorstage.openDialog('mogrt', true); if (!paths.length) return;
    const { installMogrt } = await import('../Services/mogrt/library'); const { refreshMogrtLibrary } = await import('../Components/MogrtPanel');
    for (const p of paths) { try { const e = await installMogrt(p); notify(`Installed template: ${e.pkg.meta.name}`); } catch (err) { notify(`Cannot install ${p.split(/[\\/]/).pop()}: ${err.message || err}`); } }
    await refreshMogrtLibrary(); requestPanel('essentialGraphics');
  },

  // View
  'view.rulers': () => set((s) => ({ showRulers: !s.showRulers })),
  'view.guides': () => set((s) => ({ showGuides: !s.showGuides })),
  'view.snapProgram': () => set((s) => ({ toggles: { ...s.toggles, snapProgram: !s.toggles.snapProgram } })),
  'view.safeMargins': () => set((s) => ({ safeMargins: !s.safeMargins })),
  /** Program Monitor > Comparison View (Premiere): Reference + Current. arg: patch of the comparison state (mode, kind, refTime, ...) */
  'view.comparisonView': (patch) => {
    const s = getState(); const cur = s.compare; const on = patch && typeof patch === 'object' ? patch.on ?? true : !cur.on;
    const next = { ...cur, ...(patch && typeof patch === 'object' ? patch : {}), on };
    if (on && !cur.on && !(patch && 'refTime' in patch)) next.refTime = defaultRefTime(s.sequence, s.playhead);
    set({ compare: next }); rememberCompare(next); if (!on) releaseReference();
  },
  'view.compareSwap': () => set((s) => ({ compare: { ...s.compare, swap: !s.compare.swap } })),
  'view.toggleRail': toggleRail,
  'view.remoteMode': () => { const on = !getState().remoteMode; set({ remoteMode: on }); try { localStorage.setItem('es-remote-mode', on ? '1' : '0'); } catch { /* storage unavailable */ } notify(`Remote-Optimized Preview ${on ? 'on' : 'off'}`); },

  // Transport
  'play.toggle': () => set((s) => ({ playing: !s.playing, rate: 1, playStop: null })),
  /** Play Around (Shift+K): from Pre-roll before the playhead to Post-roll after it (Preferences), then back to where it was */
  'play.around': () => { const s = getState(); const p = getPrefs(); set({ playhead: Math.max(0, s.playhead - p.preRoll), playing: true, rate: 1, playStop: { at: s.playhead + p.postRoll, back: s.playhead } }); },
  'play.start': () => set({ playhead: 0, playing: false }),
  'play.end': () => set((s) => ({ playhead: ed.sequenceEnd(s.sequence), playing: false })),
  'play.pause': () => set({ playing: false, rate: 1 }),
  'play.loop': () => set((s) => ({ loop: !s.loop })),
  'play.stepBack': () => set((s) => ({ playhead: Math.max(0, s.playhead - 1 / s.sequence.fps), playing: false })),
  'play.stepForward': () => set((s) => ({ playhead: s.playhead + 1 / s.sequence.fps, playing: false })),
  'play.nextEdit': () => { const s = getState(); const n = ed.editPoints(s.sequence).find((x) => x > s.playhead + 1e-3); if (n !== undefined) set({ playhead: n }); },
  'play.prevEdit': () => { const s = getState(); const p = [...ed.editPoints(s.sequence)].reverse().find((x) => x < s.playhead - 1e-3); set({ playhead: p ?? 0 }); },
  'play.shuttleFwd': () => set((s) => ({ playing: true, rate: s.playing && s.rate > 0 ? Math.min(8, s.rate * 2) : 1 })),
  'play.shuttleBack': () => set((s) => ({ playing: true, rate: s.playing && s.rate < 0 ? Math.max(-8, s.rate * 2) : -1 })),

  // Timeline tracks (track headers)
  'track.mute': (id) => toggleTrack(id, 'muted'),
  'track.solo': (id) => toggleTrack(id, 'solo'),
  'track.lock': (id) => toggleTrack(id, 'locked'),
  'track.sync': (id) => toggleTrack(id, 'sync'),
  'track.voiceOver': toggleVoiceOver,
  'track.target': (id) => edit('Toggle Track Targeting', ({ seq }) => ed.toggleTarget(seq, id)),
  'track.rename': (id) => openDialog('renameTrack', { id }),
  'track.moveUp': (id) => edit('Move Track Up', ({ seq }) => { ed.moveTrack(seq, id, -1); }),
  'track.moveDown': (id) => edit('Move Track Down', ({ seq }) => { ed.moveTrack(seq, id, 1); }),
  'track.moveTo': (id, targetId) => edit('Move Track', ({ seq }) => { ed.moveTrackTo(seq, id, targetId); }),
  'track.addAbove': (id) => edit('Add Track Above', ({ seq }) => { ed.insertTrack(seq, id, 'above'); }),
  'track.addBelow': (id) => edit('Add Track Below', ({ seq }) => { ed.insertTrack(seq, id, 'below'); }),
  'track.delete': (id) => deleteTracksCmd([id], 'Delete Track'),
  'track.height': (id, h) => setTrackHeights([id], h, 'Track Height'),
  'timeline.deleteEmptyTracks': () => deleteTracksCmd(ed.emptyTracks(getState().sequence), 'Delete Empty Tracks'),
  'timeline.minimizeTracks': () => setTrackHeights(null, TRACK_HEIGHTS.min, 'Minimize All Tracks'),
  'timeline.expandTracks': () => setTrackHeights(null, TRACK_HEIGHTS.large, 'Expand All Tracks'),
  'timeline.addCaptionTrack': () => edit('Add Caption Track', ({ seq }) => { ed.appendTrack(seq, 'caption'); }),
  'timeline.addTrack': (kind) => edit(`Add ${kind} Track`, ({ seq }) => { addTrackTo(seq, kind); }),
  'timeline.addTrack.video': () => commands['timeline.addTrack']('video'),
  'timeline.addTrack.audio': () => commands['timeline.addTrack']('audio'),

  // Smart Tools
  'ai.autoCut': smart('silence'), 'ai.subtitles': smart('subtitles'), 'ai.diarize': smart('speakers'), 'ai.reframe': smart('reframe'),
  'ai.shorts': () => { set({ createTab: 'shorts' }); requestPanel('create'); }, 'ai.broll': () => { set({ createTab: 'broll' }); requestPanel('create'); },
};
for (const r of ['Full', '1/2', '1/4', '1/8', '1/16']) {
  commands[`view.playRes.${r}`] = () => set({ playbackRes: r });
  commands[`view.pausedRes.${r}`] = () => set({ pausedRes: r });
}
// View > Video Thumbnails (a viewer preference, not part of the project)
for (const t of ['none', 'head', 'headTail', 'continuous']) commands[`view.thumbs.${t}`] = () => { set({ thumbMode: t }); try { localStorage.setItem('es-thumbs', t); } catch { /* storage unavailable */ } };
for (const z of ['Fit', '10%', '25%', '50%', '75%', '100%', '150%', '200%']) commands[`view.mag.${z}`] = () => set({ monitorZoom: z });
// Window menu: workspaces + panels
for (const w of ['allPanels', 'audio', 'color', 'editing', 'effects', 'essentialGraphics', 'graphics', 'learning']) commands[`ws.${w}`] = () => loadWorkspace(w);
commands['ws.reset'] = () => loadWorkspace('editing');
for (const p of PANELS) commands[`panel.${p.id}`] = () => requestPanel(p.id);

/** Run a command by id. Every id used by menus, buttons and shortcuts exists (checked by scripts/check_commands.mjs). */
export const run = (id, ...args) => {
  const f = commands[id];
  if (!f) { console.error(`Unknown command: ${id}`); return undefined; }
  return f(...args);
};
