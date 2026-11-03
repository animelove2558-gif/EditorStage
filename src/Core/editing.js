import { trimHead, headRoom, maxDuration, sourceSpan, dirOf, setReverse, sourceAt } from './clipTime';
import { VIDEO_FX } from '../Renderers/fx/videoEffects';
// Pure timeline-editing operations. Each takes a (cloned) sequence `seq` and mutates it; `mdur(clip)` gives the source length (Infinity for stills/graphics).
const EPS = 1e-3;
export const clipEnd = (c) => c.start + c.dur;
export const onTrack = (seq, track) => seq.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
export const trackKind = (seq, id) => seq.tracks.find((t) => t.id === id)?.kind;
const locked = (seq, track) => !!seq.tracks.find((t) => t.id === track)?.locked;
const uid = () => Math.random().toString(36).slice(2, 8);
const srcSpanLeft = (c, mdur) => maxDuration(c, mdur(c)); // timeline seconds available from the clip head
/** Right-hand part of c when cut at sequence time `at` (the same source continues; speed curves shift with it). */
const rightPart = (c, at, start = at) => trimHead({ ...structuredClone(c), id: uid(), start, dur: clipEnd(c) - at }, at - c.start);

/** Remove/trim whatever overlaps [start,end) on a track (overwrite semantics). */
export function overwriteRange(seq, track, start, end, exceptIds = []) {
  const out = [];
  for (const c of seq.clips) {
    if (c.track !== track || exceptIds.includes(c.id)) { out.push(c); continue; }
    const s = c.start, e = clipEnd(c);
    if (e <= start + EPS || s >= end - EPS) { out.push(c); continue; }
    if (s >= start - EPS && e <= end + EPS) continue; // fully covered
    if (s < start && e > end) { // covers a middle piece -> split
      const right = rightPart(c, end);
      c.dur = start - s; out.push(c, right); continue;
    }
    if (s < start) c.dur = start - s; // keep left part
    else { trimHead(c, end - s); c.start = end; c.dur = e - end; } // keep right part
    out.push(c);
  }
  seq.clips = out;
}

/** Trim a clip edge. edge: 'start'|'end'. ripple shifts later clips (on every unlocked track whose sync lock is on). */
export function trimClip(seq, mdur, id, edge, t, ripple = false) {
  const c = seq.clips.find((x) => x.id === id); if (!c || locked(seq, c.track)) return;
  const min = 1 / seq.fps, oldEnd = clipEnd(c);
  const siblings = onTrack(seq, c.track).filter((x) => x.id !== id);
  let delta = 0;
  if (edge === 'start') {
    let ns = Math.min(t, oldEnd - min);
    ns = Math.max(ns, c.start - headRoom(c, mdur(c))); // cannot extend past the media start (its end when reversed)
    if (!ripple) { const prev = siblings.filter((x) => clipEnd(x) <= c.start + EPS).pop(); ns = Math.max(ns, prev ? clipEnd(prev) : 0); }
    const d = ns - c.start;
    trimHead(c, d); c.dur = oldEnd - ns;
    if (ripple) { delta = -d; /* clip keeps its start; the gap closes by shifting later material */ rippleShift(seq, c.track, oldEnd, delta, id); }
    else c.start = ns;
  } else {
    let ne = Math.max(t, c.start + min);
    ne = Math.min(ne, c.start + srcSpanLeft(c, mdur));
    if (!ripple) { const next = siblings.find((x) => x.start >= oldEnd - EPS); if (next) ne = Math.min(ne, next.start); }
    c.dur = ne - c.start; delta = ne - oldEnd;
    if (ripple) rippleShift(seq, c.track, oldEnd, delta, id);
  }
}
function rippleShift(seq, track, from, delta, exceptId) {
  if (!delta) return;
  for (const x of seq.clips) {
    if ([].concat(exceptId).includes(x.id) || locked(seq, x.track)) continue;
    const tr = seq.tracks.find((q) => q.id === x.track);
    if (x.track !== track && !tr?.sync) continue;
    if (x.start >= from - EPS) x.start = Math.max(0, x.start + delta);
  }
  for (const tr of seq.transitions || []) if (tr.at >= from - EPS) tr.at += delta;
}

/** Rolling edit: move the cut between left and right clips by `t` (absolute time). */
export function rollEdit(seq, mdur, leftId, rightId, t) {
  const A = seq.clips.find((x) => x.id === leftId), B = seq.clips.find((x) => x.id === rightId); if (!A || !B) return;
  const min = 1 / seq.fps; const cut = clipEnd(A);
  let d = t - cut;
  d = Math.min(d, B.dur - min, srcSpanLeft(A, mdur) - A.dur);
  d = Math.max(d, -(A.dur - min), -headRoom(B, mdur(B)));
  A.dur += d; B.start += d; B.dur -= d; trimHead(B, d);
  for (const tr of seq.transitions || []) if (tr.aId === leftId && tr.bId === rightId) tr.at = clipEnd(A);
}

/** Edit points on the given (unlocked) tracks at time t: { track, aId (clip ending there), bId (clip starting there) } */
export function editsAt(seq, t, tracks) {
  const out = [];
  for (const track of tracks) {
    if (locked(seq, track)) continue; const on = onTrack(seq, track);
    const a = on.find((c) => Math.abs(clipEnd(c) - t) < EPS), b = on.find((c) => Math.abs(c.start - t) < EPS);
    if (a || b) out.push({ track, aId: a?.id || null, bId: b?.id || null });
  }
  return out;
}
/** Time of an edit point (the cut between its clips) */
export const editTime = (seq, e) => { const a = e.aId && seq.clips.find((c) => c.id === e.aId); if (a) return clipEnd(a); const b = e.bId && seq.clips.find((c) => c.id === e.bId); return b ? b.start : null; };

/**
 * Trim Mode (Premiere Trim Monitor): trim every selected edit point by d seconds, all by the same amount (so linked
 * picture and sound stay in sync); d is limited by the media handles, a one-frame minimum and neighbouring clips.
 * type 'regular': only the side's clip changes (a gap opens / closes, never overwrites). 'ripple': the side's clip changes
 * and later material on those tracks (and on sync-locked tracks) moves with it. 'roll': the cut moves, the sequence keeps its length.
 * side 'a' = outgoing clip's tail, 'b' = incoming clip's head (+d removes frames from the head). Returns the d applied.
 */
export function trimEdits(seq, mdur, edits, type, side, d) {
  const min = 1 / seq.fps; const get = (id) => id && seq.clips.find((x) => x.id === id);
  const prevEnd = (c) => Math.max(0, ...onTrack(seq, c.track).filter((x) => x.id !== c.id && clipEnd(x) <= c.start + EPS).map(clipEnd));
  const nextStart = (c) => Math.min(Infinity, ...onTrack(seq, c.track).filter((x) => x.id !== c.id && x.start >= clipEnd(c) - EPS).map((x) => x.start));
  const tailMax = (a) => srcSpanLeft(a, mdur) - a.dur, headMax = (b) => headRoom(b, mdur(b));
  let list = edits.map((e) => ({ ...e, a: get(e.aId), b: get(e.bId) })).filter((e) => !locked(seq, e.track) && (e.a || e.b));
  if (type !== 'roll') list = list.filter((e) => (side === 'a' ? e.a : e.b));
  if (!list.length || !d) return 0;
  const lim = (lo, hi) => { d = Math.max(Math.min(0, lo), Math.min(Math.max(0, hi), d)); }; // a limit never turns the trim around
  if (type === 'roll') {
    for (const { a, b } of list) {
      if (a) lim(-(a.dur - min), b ? tailMax(a) : Math.min(tailMax(a), nextStart(a) - clipEnd(a)));
      if (b) lim(a ? -headMax(b) : Math.max(-headMax(b), prevEnd(b) - b.start), b.dur - min);
    }
    for (const { a, b } of list) {
      if (a) a.dur += d;
      if (b) { b.start += d; b.dur -= d; trimHead(b, d); }
      if (a && b) for (const tr of seq.transitions || []) if (tr.aId === a.id && tr.bId === b.id) tr.at = clipEnd(a);
    }
    return d;
  }
  for (const { a, b } of list) {
    if (side === 'a') lim(-(a.dur - min), type === 'ripple' ? tailMax(a) : Math.min(tailMax(a), nextStart(a) - clipEnd(a)));
    else lim(type === 'ripple' ? -headMax(b) : Math.max(-headMax(b), prevEnd(b) - b.start), b.dur - min);
  }
  if (type === 'regular') {
    for (const { a, b } of list) { if (side === 'a') a.dur += d; else { b.start += d; b.dur -= d; trimHead(b, d); } }
    return d;
  }
  // ripple: later material moves by delta. Edited tracks move what follows the trimmed clip; other sync-locked tracks move
  // what starts at / after the earliest edit, and never into a clip that stays (delta is limited to the free room)
  const delta = () => (side === 'a' ? d : -d);
  const ends = new Map(list.map((e) => { const c = side === 'a' ? e.a : e.b; return [e.track, { c, end: clipEnd(c) }]; }));
  const t0 = Math.min(...list.map((e) => (side === 'a' ? clipEnd(e.a) : e.b.start)));
  const others = seq.tracks.filter((tr) => !ends.has(tr.id) && tr.sync && !locked(seq, tr.id)).map((tr) => tr.id);
  for (const track of others) {
    const on = onTrack(seq, track); const moving = on.filter((x) => x.start >= t0 - EPS); if (!moving.length) continue;
    const room = Math.min(...moving.map((x) => x.start)) - Math.max(0, ...on.filter((x) => x.start < t0 - EPS).map(clipEnd));
    if (side === 'a') d = Math.max(d, -room); else d = Math.min(d, room);
  }
  if (!d) return 0;
  for (const [track, { c, end }] of ends) {
    if (side === 'a') c.dur += d; else { trimHead(c, d); c.dur -= d; }
    for (const x of onTrack(seq, track)) if (x.id !== c.id && x.start >= end - EPS) x.start += delta();
    for (const tr of seq.transitions || []) if (tr.track === track && tr.at >= end - EPS) tr.at += delta();
  }
  for (const track of others) {
    for (const x of onTrack(seq, track)) if (x.start >= t0 - EPS) x.start += delta();
    for (const tr of seq.transitions || []) if (tr.track === track && tr.at >= t0 - EPS) tr.at += delta();
  }
  return d;
}

/** Rate stretch: change speed so the clip's source span fits the new duration. */
export function rateStretch(seq, id, newEnd) {
  const c = seq.clips.find((x) => x.id === id); if (!c) return;
  const min = 1 / seq.fps; const next = onTrack(seq, c.track).find((x) => x.start >= clipEnd(c) - EPS && x.id !== id);
  let nd = Math.max(min, newEnd - c.start); if (next) nd = Math.min(nd, next.start - c.start);
  const span = sourceSpan(c); const f = nd / c.dur;
  if (c.timeRemap?.speed?.keys) c.timeRemap = { ...c.timeRemap, speed: { ...c.timeRemap.speed, keys: c.timeRemap.speed.keys.map((k) => ({ ...k, t: k.t * f })) } };
  const per = sourceSpan({ ...c, speed: 1 }, nd); c.speed = Math.min(100, Math.max(0.01, span / Math.max(1e-6, per))); c.dur = nd;
}

/**
 * Clip > Speed/Duration. opts: { speed (% of the clip's own rate, e.g. 200), dur (seconds, overrides speed), reverse, maintainPitch,
 * ripple (shift later clips on the track), sampling ('sample' | 'blend') }. The source range is kept: faster = shorter.
 * Speed curves (Time Remapping keys) are stretched with the clip. Without ripple the clip stops at the next clip.
 */
export function setSpeed(seq, ids, opts) {
  const ripples = new Map();
  for (const c of seq.clips.filter((x) => ids.includes(x.id))) {
    if (locked(seq, c.track)) continue;
    const oldEnd = clipEnd(c); const span = sourceSpan(c);
    let nd = opts.dur != null ? opts.dur : c.dur * ((Math.abs(c.speed || 1) * 100) / Math.max(1, opts.speed));
    nd = Math.max(1 / seq.fps, nd);
    if (!opts.ripple) { const next = onTrack(seq, c.track).find((x) => x.id !== c.id && x.start >= oldEnd - EPS); if (next) nd = Math.min(nd, next.start - c.start); }
    const f = nd / c.dur; const fullDur = opts.dur != null ? opts.dur : c.dur * ((Math.abs(c.speed || 1) * 100) / Math.max(1, opts.speed));
    const g = fullDur / c.dur; // speed is set from the requested length even when the next clip truncates it
    if (c.timeRemap?.speed?.keys) c.timeRemap = { ...c.timeRemap, speed: { ...c.timeRemap.speed, keys: c.timeRemap.speed.keys.map((k) => ({ ...k, t: k.t * g })) } };
    const per = sourceSpan({ ...c, speed: 1 }, fullDur); c.speed = Math.min(100, Math.max(0.01, span / Math.max(1e-9, per)));
    if (Math.abs(c.speed - 1) < 1e-9) c.speed = 1;
    if (opts.reverse != null) { c.dur = fullDur; setReverse(c, !!opts.reverse); }
    c.dur = nd;
    if (opts.maintainPitch != null) c.maintainPitch = opts.maintainPitch || undefined;
    if (opts.sampling != null) c.frameSampling = opts.sampling === 'sample' ? undefined : opts.sampling;
    if (opts.ripple && Math.abs(f - 1) > 1e-9) { const k = oldEnd.toFixed(4); if (!ripples.has(k) || Math.abs(ripples.get(k).d) < Math.abs(clipEnd(c) - oldEnd)) ripples.set(k, { track: c.track, from: oldEnd, d: clipEnd(c) - oldEnd }); }
  }
  // linked V+A clips end together: shift what follows once, not once per clip
  for (const r of ripples.values()) rippleShift(seq, r.track, r.from, r.d, ids);
}

/** Slip: shift source in/out inside the clip without changing its position/duration. */
export function slip(seq, mdur, id, dt) {
  const c = seq.clips.find((x) => x.id === id); if (!c) return;
  const span = sourceSpan(c), md = mdur(c); const sp = Math.abs(c.speed || 1);
  const lo = c.reverse ? span : 0, hi = Math.max(lo, c.reverse ? md : md - span);
  c.inPoint = Math.min(hi, Math.max(lo, (c.inPoint || 0) + dt * sp * dirOf(c)));
}

/** Slide: move the clip; neighbours' facing edges absorb the change. */
export function slide(seq, mdur, id, d) {
  const c = seq.clips.find((x) => x.id === id); if (!c) return;
  const min = 1 / seq.fps; const sib = onTrack(seq, c.track).filter((x) => x.id !== id);
  const L = sib.find((x) => Math.abs(clipEnd(x) - c.start) < 0.02), R = sib.find((x) => Math.abs(x.start - clipEnd(c)) < 0.02);
  if (L) d = Math.min(d, srcSpanLeft(L, mdur) - L.dur); else d = Math.max(d, -c.start);
  if (L) d = Math.max(d, -(L.dur - min));
  if (R) { d = Math.min(d, R.dur - min); d = Math.max(d, -headRoom(R, mdur(R))); }
  c.start += d; if (L) L.dur += d; if (R) { R.start += d; R.dur -= d; trimHead(R, d); }
}

// ---- tracks: numbering order, moving clips between tracks ----
const TRACK_PREFIX = { video: 'V', audio: 'A', caption: 'CC' };
const KINDS = ['video', 'audio', 'caption'];
/** Tracks of one kind in numbering order: V1 = the bottom video track, A1 = the top audio track, CC1 = the caption track nearest the video. */
export const kindTracks = (seq, kind) => { const t = seq.tracks.filter((x) => x.kind === kind); return kind === 'audio' ? t : t.reverse(); };
/** Add a track at the outer end of its kind (video and caption: on top, audio: at the bottom). Returns its id. */
export function appendTrack(seq, kind) {
  const p = TRACK_PREFIX[kind]; const same = seq.tracks.filter((t) => t.kind === kind);
  let n = same.length + 1; while (seq.tracks.some((t) => t.id === `${p}${n}`)) n++;
  const t = { id: `${p}${n}`, kind, muted: false, solo: false, locked: false, sync: true };
  if (kind === 'video') seq.tracks.splice(same.length ? seq.tracks.indexOf(same[0]) : seq.tracks.filter((x) => x.kind === 'caption').length, 0, t);
  else if (kind === 'caption') seq.tracks.unshift(t);
  else seq.tracks.push(t);
  return t.id;
}

/**
 * Track of each clip when a group of clips moves `delta` tracks in numbering order (+1: V1→V2, A1→A2, CC1→CC2).
 * Each kind moves inside its own tracks; only the kinds in `kinds` change track (all when omitted). A drag passes the kind
 * that was grabbed, so the linked sound of a picture dragged V1 → V2 stays on A1 and only follows in time (EditorStage
 * choice, Premiere moves both). Tracks past the last one are created. The group never goes below track 1, and a locked
 * track stops the whole kind on the last track before it (it is never landed on or jumped over), so the clips keep
 * their layout and cannot pile onto one track. Returns { clipId: trackId } for the clips that change track.
 */
export function trackShiftMap(seq, ids, delta, kinds = KINDS) {
  const map = {}; if (!delta) return map;
  const moving = seq.clips.filter((c) => ids.includes(c.id) && !locked(seq, c.track));
  for (const kind of KINDS.filter((k) => kinds.includes(k))) {
    const cs = moving.filter((c) => trackKind(seq, c.track) === kind); if (!cs.length) continue;
    const order = kindTracks(seq, kind).map((t) => t.id); const idx = cs.map((c) => order.indexOf(c.track));
    const d = Math.max(delta, -Math.min(...idx)); const step = Math.sign(d); let ok = 0;
    for (let k = step; step && Math.abs(k) <= Math.abs(d); k += step) { if (idx.some((i) => order[i + k] && locked(seq, order[i + k]))) break; ok = k; }
    if (!ok) continue;
    for (let n = Math.max(...idx) + ok + 1 - order.length; n > 0; n--) order.push(appendTrack(seq, kind));
    cs.forEach((c, j) => { map[c.id] = order[idx[j] + ok]; });
  }
  return map;
}
const movable = (seq, ids) => seq.clips.filter((c) => ids.includes(c.id) && !locked(seq, c.track));
const retrack = (seq, c, to) => { if (to && to !== c.track && trackKind(seq, to) === trackKind(seq, c.track) && !locked(seq, to)) c.track = to; };
/** A transition follows its clips to their new track; one whose two clips end up on different tracks is removed. */
function syncTransitionTracks(seq) {
  const byId = new Map(seq.clips.map((c) => [c.id, c]));
  seq.transitions = (seq.transitions || []).filter((t) => {
    const a = byId.get(t.aId), b = byId.get(t.bId);
    if (a && b && a.track !== b.track) return false;
    if (a || b) t.track = (a || b).track;
    return true;
  });
}

/** Move clips by dt seconds and (optionally) to other tracks of the same kind (trackMap, see trackShiftMap); overwrites what is underneath. */
export function moveClips(seq, ids, dt, trackMap = {}) {
  const moving = movable(seq, ids);
  if (!moving.length) return;
  const minStart = Math.min(...moving.map((c) => c.start));
  dt = Math.max(dt, -minStart);
  for (const c of moving) { c.start += dt; retrack(seq, c, trackMap[c.id]); }
  // the moving clips never cut each other: only what stays put is overwritten
  const mids = moving.map((c) => c.id);
  for (const c of moving) overwriteRange(seq, c.track, c.start, clipEnd(c), mids);
  syncTransitionTracks(seq);
}

/** Copies of clips with new ids; link / group ids are renewed pairwise, so a copied V+A pair is linked to each other only. */
export function duplicateClips(seq, ids) {
  const relink = {}, regroup = {};
  return seq.clips.filter((c) => ids.includes(c.id)).map((c) => {
    const d = { ...structuredClone(c), id: uid() };
    if (c.linkId) d.linkId = relink[c.linkId] = relink[c.linkId] || uid();
    if (c.group) d.group = regroup[c.group] = regroup[c.group] || uid();
    return d;
  });
}

/**
 * Insert clips that already have their start and track: everything at/after the earliest start on their tracks and on
 * sync-locked tracks moves right by the length of the group (clips under that point are split), then the clips are added.
 */
export function insertGroup(seq, clips) {
  if (!clips.length) return;
  const at = Math.min(...clips.map((c) => c.start)), d = Math.max(...clips.map(clipEnd)) - at;
  const involved = new Set(clips.map((c) => c.track));
  const eligible = (tr) => tr && !tr.locked && (involved.has(tr.id) || tr.sync);
  for (const c of [...seq.clips]) {
    const tr = seq.tracks.find((q) => q.id === c.track); if (!eligible(tr)) continue;
    if (c.start < at - EPS && clipEnd(c) > at + EPS) { const right = rightPart(c, at); c.dur = at - c.start; seq.clips.push(right); }
  }
  for (const c of seq.clips) { const tr = seq.tracks.find((q) => q.id === c.track); if (eligible(tr) && c.start >= at - EPS) c.start += d; }
  seq.clips.push(...clips);
}

/** Close the gap [a, b) on every unlocked track that is a source track or sync-locked, as long as nothing on it overlaps the gap. */
function closeGap(seq, a, b, sources) {
  for (const tr of seq.tracks) {
    if (tr.locked || !(sources.has(tr.id) || tr.sync)) continue;
    const cs = seq.clips.filter((c) => c.track === tr.id);
    if (cs.some((c) => c.start < b - EPS && clipEnd(c) > a + EPS)) continue;
    for (const c of cs) if (c.start >= b - EPS) c.start -= b - a;
  }
}
const mergeRanges = (rs) => rs.sort((x, y) => x[0] - y[0]).reduce((o, r) => { const l = o[o.length - 1]; if (l && r[0] <= l[1] + EPS) l[1] = Math.max(l[1], r[1]); else o.push([...r]); return o; }, []);

/**
 * Drag clips with a modifier (Timeline): mode 'overwrite' (plain drag), 'insert' (Ctrl: the clips leave a gap behind and are
 * inserted at the new place, pushing later material right), 'rearrange' (Ctrl+Alt: lifted out with the gap closed, then
 * inserted, so clips swap order without leaving a gap) or 'duplicate' (Alt: copies are dropped there, the originals stay).
 * dt / trackMap as in moveClips (trackMap is keyed by the dragged clips' ids). Returns the ids of the clips at the new place.
 */
export function dragClips(seq, ids, dt, trackMap = {}, mode = 'overwrite') {
  const moving = movable(seq, ids); if (!moving.length) return [];
  dt = Math.max(dt, -Math.min(...moving.map((c) => c.start)));
  const mids = moving.map((c) => c.id);
  if (mode === 'overwrite') { moveClips(seq, mids, dt, trackMap); return mids; }
  if (mode === 'duplicate') {
    const copies = duplicateClips(seq, mids);
    copies.forEach((d, i) => { d.start += dt; retrack(seq, d, trackMap[mids[i]]); });
    const cids = copies.map((c) => c.id);
    for (const c of copies) overwriteRange(seq, c.track, c.start, clipEnd(c), cids);
    seq.clips.push(...copies);
    return cids;
  }
  seq.clips = seq.clips.filter((c) => !mids.includes(c.id));
  let shift = dt;
  if (mode === 'rearrange') {
    // the drop time is measured on the timeline as it was: past a closed gap it moves back by the gap, inside a gap it snaps to its start
    const from = Math.min(...moving.map((c) => c.start)); let at = from + dt;
    const sources = new Set(moving.map((c) => c.track));
    for (const [a, b] of mergeRanges(moving.map((c) => [c.start, clipEnd(c)])).reverse()) {
      closeGap(seq, a, b, sources);
      if (at >= b - EPS) at -= b - a; else if (at > a) at = a;
    }
    shift = at - from;
  }
  for (const c of moving) { c.start += shift; retrack(seq, c, trackMap[c.id]); }
  insertGroup(seq, moving);
  syncTransitionTracks(seq);
  return mids;
}

// ---- track numbering, reordering, deleting ----
/** Rename track ids everywhere they are stored: tracks, clips, transitions and effect parameters that pick a track (Track Matte Key, Set Matte). */
export function remapTrackIds(seq, map) {
  const r = (id) => (typeof id === 'string' && id in map ? map[id] : id);
  for (const t of seq.tracks) t.id = r(t.id);
  for (const c of seq.clips) {
    c.track = r(c.track);
    for (const fx of c.effects || []) {
      for (const d of VIDEO_FX[fx.name]?.params || []) {
        const p = fx.params?.[d.id]; if (d.type !== 'trackSel' || p == null) continue;
        fx.params[d.id] = typeof p === 'object' ? { ...p, v: r(p.v), keys: p.keys ? p.keys.map((k) => ({ ...k, v: r(k.v) })) : p.keys } : r(p);
      }
    }
  }
  for (const t of seq.transitions || []) t.track = r(t.track);
}
/**
 * Give every track the id of its position (V1 = bottom video track, A1 = top audio track, CC1 = the caption track nearest the
 * video), the way Premiere numbers tracks, and update every reference. Called after tracks are reordered or deleted, so the
 * id always says where the track is (interchange, multicam camera order and the main track rely on that). Name, mute, solo,
 * lock, sync, target and height belong to the track object and move with it. Returns the { oldId: newId } map.
 */
export function renumberTracks(seq) {
  const map = {};
  for (const kind of KINDS) kindTracks(seq, kind).forEach((t, i) => { const id = `${TRACK_PREFIX[kind]}${i + 1}`; if (t.id !== id) map[t.id] = id; });
  if (Object.keys(map).length) remapTrackIds(seq, map);
  return map;
}
/** Move a track one place up (dir -1) or down (+1) on screen, among the tracks of its kind. Returns the id map, or null. */
export function moveTrack(seq, id, dir) {
  const i = seq.tracks.findIndex((t) => t.id === id), j = i + dir;
  if (i < 0 || !seq.tracks[j] || seq.tracks[j].kind !== seq.tracks[i].kind) return null;
  [seq.tracks[i], seq.tracks[j]] = [seq.tracks[j], seq.tracks[i]];
  return renumberTracks(seq);
}
/** Put a track where `targetId` is (same kind; the tracks in between shift by one). Returns the id map, or null. */
export function moveTrackTo(seq, id, targetId) {
  const from = seq.tracks.findIndex((t) => t.id === id), to = seq.tracks.findIndex((t) => t.id === targetId);
  if (from < 0 || to < 0 || from === to || seq.tracks[from].kind !== seq.tracks[to].kind) return null;
  const [t] = seq.tracks.splice(from, 1); seq.tracks.splice(to, 0, t);
  return renumberTracks(seq);
}
/** Add a track right above / below another one (same kind). Returns the new track's id (after renumbering). */
export function insertTrack(seq, refId, where) {
  const i = seq.tracks.findIndex((t) => t.id === refId); if (i < 0) return null;
  const t = { id: `new-${uid()}`, kind: seq.tracks[i].kind, muted: false, solo: false, locked: false, sync: true };
  seq.tracks.splice(where === 'above' ? i : i + 1, 0, t);
  renumberTracks(seq);
  return t.id;
}
/** Tracks that may be deleted: never the last video or the last audio track. */
export function deletableTracks(seq, ids) {
  const out = [];
  for (const id of ids) {
    const t = seq.tracks.find((x) => x.id === id); if (!t) continue;
    const left = seq.tracks.filter((x) => x.kind === t.kind && !out.includes(x.id) && x.id !== id).length;
    if (t.kind === 'caption' || left > 0) out.push(id);
  }
  return out;
}
/** Delete tracks with their clips and transitions; partners linked to deleted clips are unlinked, effects that picked a deleted track pick None. */
export function deleteTracks(seq, ids) {
  const del = new Set(deletableTracks(seq, ids)); if (!del.size) return null;
  const links = new Set(seq.clips.filter((c) => del.has(c.track) && c.linkId).map((c) => c.linkId));
  seq.clips = seq.clips.filter((c) => !del.has(c.track));
  for (const c of seq.clips) if (c.linkId && links.has(c.linkId) && seq.clips.filter((x) => x.linkId === c.linkId).length < 2) c.linkId = undefined;
  seq.transitions = (seq.transitions || []).filter((t) => !del.has(t.track));
  seq.tracks = seq.tracks.filter((t) => !del.has(t.id));
  remapTrackIds(seq, Object.fromEntries([...del].map((id) => [id, 'None'])));
  return renumberTracks(seq);
}
/** Ids of the tracks without clips (the last video / audio track is kept). */
export const emptyTracks = (seq) => deletableTracks(seq, seq.tracks.filter((t) => !seq.clips.some((c) => c.track === t.id)).map((t) => t.id));

// ---- track targeting (the V1 / A1 buttons on the track headers) ----
/** Whether the kind's tracks carry target flags. Older projects have none: then the first unlocked track (by id) is the target, as before. */
export const hasTargets = (seq, kind) => seq.tracks.some((t) => t.kind === kind && t.target !== undefined);
/** Targeted, unlocked tracks of a kind in numbering order (V1 first). Insert / Overwrite / Paste use the first one. */
export function targetedTracks(seq, kind) {
  if (!hasTargets(seq, kind)) { const t = seq.tracks.filter((x) => x.kind === kind && !x.locked).sort((a, b) => a.id.localeCompare(b.id))[0]; return t ? [t.id] : []; }
  return kindTracks(seq, kind).filter((t) => t.target && !t.locked).map((t) => t.id);
}
export const isTargeted = (seq, t) => (hasTargets(seq, t.kind) ? !!t.target : targetedTracks(seq, t.kind)[0] === t.id);
/** Toggle a track's target button (the implicit default is written out first, so the others keep their state). */
export function toggleTarget(seq, id) {
  const t = seq.tracks.find((x) => x.id === id); if (!t || t.kind === 'caption') return;
  if (!hasTargets(seq, t.kind)) { const cur = targetedTracks(seq, t.kind); for (const x of seq.tracks) if (x.kind === t.kind) x.target = cur.includes(x.id); }
  t.target = !t.target;
}
// ---- source patching (the source indicators left of the track targets, Premiere): which timeline track the source's
// picture (V1) and sound (A1) go to on Insert / Overwrite, and whether each goes at all. Stored per sequence
// (seq.sourcePatch); without it the source goes to the first targeted track of each kind, as before.
export const SOURCE_KINDS = { V1: 'video', A1: 'audio' };
export function sourcePatch(seq) {
  const p = seq.sourcePatch || {}; const out = {};
  for (const [src, kind] of Object.entries(SOURCE_KINDS)) {
    const q = p[src]; const ok = q && seq.tracks.some((t) => t.id === q.track && t.kind === kind);
    out[src] = ok ? { track: q.track, on: q.on !== false } : { track: targetedTracks(seq, kind)[0] || null, on: q ? q.on !== false : true };
  }
  return out;
}
/** Patch source V1 / A1 to a timeline track of its kind (it is switched on). */
export function patchSource(seq, src, trackId) {
  const t = seq.tracks.find((x) => x.id === trackId); if (!t || t.kind !== SOURCE_KINDS[src]) return false;
  seq.sourcePatch = { ...sourcePatch(seq), [src]: { track: trackId, on: true } }; return true;
}
/** Switch a source indicator off (that part of the source is left out of Insert / Overwrite) or on again. */
export function toggleSource(seq, src) { if (!SOURCE_KINDS[src]) return; const cur = sourcePatch(seq); seq.sourcePatch = { ...cur, [src]: { ...cur[src], on: !cur[src].on } }; }
/** Tracks Add Edit cuts: the targeted ones of each kind that uses targeting, every track of the other kinds (all tracks in older projects). */
export const editTracks = (seq) => seq.tracks.filter((t) => t.kind === 'caption' || !hasTargets(seq, t.kind) || t.target).map((t) => t.id);

/** Insert: ripple everything at/after `at` on the target track (and sync-locked tracks), then place the clip. */
export function insertClip(seq, clip, at) {
  const d = clip.dur;
  for (const c of [...seq.clips]) {
    const tr = seq.tracks.find((q) => q.id === c.track);
    if (!tr || tr.locked || !(c.track === clip.track || tr.sync)) continue;
    if (c.start >= at - EPS) c.start += d;
    else if (clipEnd(c) > at + EPS && c.track === clip.track) { // split the clip under the insert point
      const right = rightPart(c, at, at + d);
      c.dur = at - c.start; seq.clips.push(right);
    }
  }
  clip.start = at; seq.clips.push(clip);
}

/**
 * Make room for a clip that grows at its end (Remix to a longer length): everything at/after `at` on `track` and on the
 * sync-locked unlocked tracks moves right by `d` (clips under `at` on those other tracks are split), so nothing that
 * follows is overwritten and linked picture / sound stay in sync. True when something moved.
 */
export function rippleOpen(seq, track, at, d) {
  if (d <= EPS) return false;
  const before = seq.clips.map((c) => c.start).join();
  const n = seq.clips.length; insertGroup(seq, [{ id: '\u0000gap', track, start: at, dur: d }]); seq.clips = seq.clips.filter((c) => c.id !== '\u0000gap');
  return seq.clips.length !== n || seq.clips.map((c) => c.start).join() !== before;
}
/** Insert several simultaneous clips (e.g. linked V+A) with a single ripple of length max(dur). */
export function insertClips(seq, clips, at) {
  for (const c of clips) c.start = at;
  insertGroup(seq, clips);
}

export function overwriteClip(seq, clip, at) { clip.start = at; overwriteRange(seq, clip.track, at, at + clip.dur); seq.clips.push(clip); }

/** Lift: remove range [a,b) leaving a gap. Extract: remove and close the gap. */
export function removeRange(seq, a, b, ripple, tracks = null) {
  const targets = (tracks || seq.tracks.filter((t) => !t.locked).map((t) => t.id));
  for (const tr of targets) {
    overwriteRange(seq, tr, a, b);
    if (ripple) for (const c of seq.clips) if (c.track === tr && c.start >= b - EPS) c.start -= b - a;
  }
}

/** All edit points (clip starts/ends) sorted, for Up/Down arrow navigation. */
export const editPoints = (seq) => [...new Set(seq.clips.flatMap((c) => [+c.start.toFixed(4), +clipEnd(c).toFixed(4)]))].sort((a, b) => a - b);

export const sequenceEnd = (seq) => seq.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);

/** Cleanup after edits: drop transitions whose clips vanished, keep transition 'at' glued to its cut. */
export function fixTransitions(seq) {
  seq.transitions = (seq.transitions || []).filter((t) => (t.aId ? seq.clips.some((c) => c.id === t.aId) : true) && (t.bId ? seq.clips.some((c) => c.id === t.bId) : true) && (t.aId || t.bId));
  for (const t of seq.transitions) {
    const a = seq.clips.find((c) => c.id === t.aId), b = seq.clips.find((c) => c.id === t.bId);
    if (a && b) t.at = (clipEnd(a) + b.start) / 2; else if (a) t.at = clipEnd(a); else if (b) t.at = b.start;
  }
}

// ---- Freeze Frame (Clip > Video Options) ----
const holdAt = (c, at, fps) => ({ on: true, mode: 'source', time: sourceAt({ ...c, frameHold: undefined }, at, fps) });
/** Video clips a frame-hold command works on: the selected video clips under `at`, else the top video clip there. */
export function frameHoldTargets(seq, ids, at) {
  const under = seq.clips.filter((c) => trackKind(seq, c.track) === 'video' && c.mediaId && !locked(seq, c.track) && at >= c.start - EPS && at < clipEnd(c) - EPS);
  const sel = under.filter((c) => ids.includes(c.id)); if (sel.length) return sel;
  const order = seq.tracks.filter((t) => t.kind === 'video').map((t) => t.id); // top track first
  return under.sort((a, b) => order.indexOf(a.track) - order.indexOf(b.track)).slice(0, 1);
}
/** Add Frame Hold: from `at` to the end of the clip, show the frame at `at` (the clip is split there). Returns the held part ids. */
export function addFrameHold(seq, ids, at, fps) {
  const out = [];
  for (const c of frameHoldTargets(seq, ids, at)) {
    const hold = holdAt(c, at, fps);
    if (at <= c.start + EPS) { c.frameHold = hold; out.push(c.id); continue; }
    const right = rightPart(c, at); right.frameHold = hold; right.linkId = undefined; // its sound (the linked audio clip) carries on
    c.dur = at - c.start; seq.clips.push(right); out.push(right.id);
  }
  return out;
}
/** Insert Frame Hold Segment: split at `at` and insert `dur` seconds of the frame at `at`, rippling everything after it. */
export function insertFrameHold(seq, ids, at, dur, fps) {
  const [c] = frameHoldTargets(seq, ids, at); if (!c) return null;
  const seg = { ...structuredClone(c), id: uid(), start: at, dur, frameHold: holdAt(c, at, fps), linkId: undefined, timeRemap: undefined };
  seg.inPoint = sourceAt({ ...c, frameHold: undefined }, at, fps);
  insertClips(seq, [seg], at);
  return seg.id;
}

/** Cut clips (and their linked partners) at several times in one go; the pieces of each link group stay linked pairwise. */
export function splitClipsAt(seq, ids, times) {
  let groups = ids.map((id) => { const c = seq.clips.find((x) => x.id === id); return !c ? [] : seq.clips.filter((x) => x.id === id || (c.linkId && x.linkId === c.linkId)); });
  for (const t of [...times].sort((a, b) => a - b)) {
    groups = groups.map((g) => {
      const relink = uid();
      return g.map((c) => {
        if (!(t > c.start + EPS && t < clipEnd(c) - EPS)) return c;
        const right = rightPart(c, t); c.dur = t - c.start; if (c.linkId) right.linkId = relink; seq.clips.push(right); return right;
      });
    });
  }
}

/** Copies of everything on unlocked tracks inside [a, b), trimmed to the range; `start` is relative to a. Links are kept pairwise. */
export function copyRange(seq, a, b) {
  const locked = new Set(seq.tracks.filter((t) => t.locked).map((t) => t.id)); const relink = {}; const out = [];
  for (const c of seq.clips) {
    if (locked.has(c.track) || clipEnd(c) <= a + EPS || c.start >= b - EPS) continue;
    const p = trimHead({ ...structuredClone(c), id: uid() }, Math.max(0, a - c.start));
    p.start = Math.max(c.start, a) - a; p.dur = Math.min(clipEnd(c), b) - Math.max(c.start, a);
    if (c.linkId) { relink[c.linkId] = relink[c.linkId] || uid(); p.linkId = relink[c.linkId]; }
    out.push(p);
  }
  return out;
}
/** Open a gap of d seconds at `at` on every unlocked track (clips under `at` are split). */
export function openGap(seq, at, d) {
  const free = (c) => !seq.tracks.find((t) => t.id === c.track)?.locked;
  for (const c of [...seq.clips]) if (free(c) && c.start < at - EPS && clipEnd(c) > at + EPS) { const right = rightPart(c, at); c.dur = at - c.start; seq.clips.push(right); }
  for (const c of seq.clips) if (free(c) && c.start >= at - EPS) c.start += d;
  for (const m of seq.markers || []) if (m.time >= at - EPS) m.time += d;
}

/**
 * Out-of-sync frames of a clip against its linked partner from the same file (Premiere's red badge): how many frames this
 * clip plays late (+) or early (-) compared with the partner's source time. 0 when in sync, null when it has no such partner
 * (or the two play at different speeds / directions, where a single number means nothing).
 */
export function syncOffset(seq, c) {
  if (!c.linkId || !c.mediaId) return null;
  const kind = trackKind(seq, c.track);
  const p = seq.clips.find((x) => x.id !== c.id && x.linkId === c.linkId && x.mediaId === c.mediaId && (trackKind(seq, x.track) === 'audio') !== (kind === 'audio'));
  if (!p || (p.speed || 1) !== (c.speed || 1) || !!p.reverse !== !!c.reverse || p.timeRemap?.speed?.keys || c.timeRemap?.speed?.keys) return null;
  const sp = c.speed || 1; const zero = (x) => (x.inPoint || 0) - x.start * sp; // source time at sequence time 0
  return Math.round(((zero(p) - zero(c)) / sp) * (seq.fps || 30));
}

/** The empty span on a track around time t, between two clips (or from 0 to the first clip); null over a clip or after the last one. */
export function gapAt(seq, track, t) {
  const cs = onTrack(seq, track); if (cs.some((c) => t >= c.start - EPS && t < clipEnd(c) - EPS)) return null;
  const next = cs.find((c) => c.start >= t - EPS); if (!next) return null;
  const prev = cs.filter((c) => clipEnd(c) <= t + EPS).pop();
  const a = prev ? clipEnd(prev) : 0; return next.start - a > EPS ? { track, a, b: next.start } : null;
}
/**
 * Ripple Delete on a gap (Premiere): what follows on the track moves left to close it, and so does everything after the gap on the
 * other sync-locked tracks. Refused (returns false) when a sync-locked track has a clip inside the gap, which would be overlapped.
 */
export function rippleDeleteGap(seq, track, a, b) {
  const d = b - a; if (d <= EPS || locked(seq, track)) return false;
  for (const tr of seq.tracks) {
    if (tr.id === track || !tr.sync || tr.locked) continue;
    if (onTrack(seq, tr.id).some((c) => c.start < b - EPS && clipEnd(c) > a + EPS)) return false;
  }
  rippleShift(seq, track, b, -d); return true;
}

/**
 * Q / W / Alt+Q / Alt+W (Premiere): trim the previous ('prev') or next ('next') edit on the given tracks to time t. The span
 * between the nearest edit and t is removed from every clip under t that reaches that edit (so linked picture and sound stay
 * in sync); ripple closes the gap on those tracks. Returns the removed span [a, b] or null when no clip is under t.
 */
export function trimEditToPlayhead(seq, t, tracks, which, ripple) {
  const under = seq.clips.filter((c) => tracks.includes(c.track) && !locked(seq, c.track) && t > c.start + EPS && t < clipEnd(c) - EPS);
  if (!under.length) return null;
  const a = which === 'prev' ? Math.max(...under.map((c) => c.start)) : t, b = which === 'prev' ? t : Math.min(...under.map(clipEnd));
  const trs = [...new Set(under.filter((c) => (which === 'prev' ? Math.abs(c.start - a) < EPS : Math.abs(clipEnd(c) - b) < EPS)).map((c) => c.track))];
  removeRange(seq, a, b, ripple, trs); return [a, b];
}
/** E (Extend Selected Edit to Playhead): the nearest edge of each selected clip moves to t (the end when t is after the clip, the start when before). */
export function extendToPlayhead(seq, mdur, ids, t) {
  for (const c of seq.clips.filter((x) => ids.includes(x.id))) {
    const edge = t >= clipEnd(c) ? 'end' : t <= c.start ? 'start' : t - c.start < clipEnd(c) - t ? 'start' : 'end';
    trimClip(seq, mdur, c.id, edge, t);
  }
}
/** D (Select Clip at Playhead): the clips under t on the given tracks */
export const clipsAt = (seq, t, tracks) => seq.clips.filter((c) => tracks.includes(c.track) && !locked(seq, c.track) && t >= c.start - EPS && t < clipEnd(c) - EPS).map((c) => c.id);

/**
 * After a frame-rate change (Sequence Settings): every clip edge, transition, marker and keyframe lands on a frame of the new
 * rate (rounded to the nearest frame), so no edit sits between two frames.
 */
export function conformToFps(seq, fps) {
  const q = (t) => Math.round(t * fps) / fps;
  const keys = (v) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) { v.forEach(keys); return; } for (const [k, x] of Object.entries(v)) { if (k === 'keys' && Array.isArray(x)) x.forEach((p) => { if (p && typeof p.t === 'number') p.t = q(p.t); }); else keys(x); } };
  for (const c of seq.clips) { const end = q(c.start + c.dur); c.start = q(c.start); c.dur = Math.max(1 / fps, end - c.start); keys(c.motion); keys(c.opacity); keys(c.volume); keys(c.timeRemap); keys(c.pan); keys(c.effects); }
  for (const t of seq.transitions || []) { t.at = q(t.at); t.dur = Math.max(1 / fps, q(t.dur)); }
  for (const m of seq.markers || []) { m.time = q(m.time); if (m.dur) m.dur = q(m.dur); }
  seq.fps = fps;
}
