// Neutral timeline description shared by the EDL / FCPXML / FCP7 XML writers and readers (pure: no DOM, testable in Node).
//   desc = { name, fps, width, height, media: [{ id, name, path, kind, duration, hasAudio, width, height }],
//            tracks: [{ id: 'V1'|'A1'..., kind }], clips: [{ id, track, start, dur, inPoint, speed, mediaId, name, enabled, linkId }],
//            transitions: [{ track, at, dur, name, kind }], markers: [{ time, name }], skipped }
// All times are seconds. Video tracks are V1 (bottom) .. Vn, audio tracks A1 .. An.

const trackNum = (id) => +(String(id).match(/(\d+)$/)?.[1] || 1);

/**
 * Describe a sequence for export. Only clips that reference media files can be interchanged; titles, captions,
 * templates and nested sequences are counted in `skipped`. `onlyIds` limits it to a selection.
 */
export function describeSequence(seq, mediaList, onlyIds = null) {
  const byId = new Map(mediaList.map((m) => [m.id, m]));
  const vt = seq.tracks.filter((t) => t.kind === 'video').map((t) => t.id).sort((a, b) => trackNum(a) - trackNum(b));
  const at = seq.tracks.filter((t) => t.kind === 'audio').map((t) => t.id).sort((a, b) => trackNum(a) - trackNum(b));
  const rename = new Map([...vt.map((id, i) => [id, `V${i + 1}`]), ...at.map((id, i) => [id, `A${i + 1}`])]);
  const media = new Map(); const clips = []; let skipped = 0;
  for (const c of seq.clips) {
    if (onlyIds && !onlyIds.includes(c.id)) continue;
    const m = c.mediaId && byId.get(c.mediaId);
    if (!m || !rename.has(c.track)) { skipped++; continue; }
    const src = m.subclip ? byId.get(m.subclip.parent) || m : m;
    if (!media.has(src.id)) media.set(src.id, { id: src.id, name: src.name, path: src.path, kind: src.kind, duration: src.duration, hasAudio: src.kind === 'audio' || src.hasAudio !== false, width: src.width || 0, height: src.height || 0 });
    clips.push({ id: c.id, track: rename.get(c.track), start: c.start, dur: c.dur, inPoint: c.inPoint || 0, speed: c.speed || 1, mediaId: src.id, name: c.name || src.name, enabled: c.enabled !== false, linkId: c.linkId || null });
  }
  const keep = new Set(clips.map((c) => c.id));
  const transitions = (seq.transitions || []).filter((t) => rename.has(t.track) && (!t.aId || keep.has(t.aId)) && (!t.bId || keep.has(t.bId)) && (t.aId || t.bId))
    .map((t) => ({ track: rename.get(t.track), at: t.at, dur: t.dur, name: t.name, kind: t.kind || (t.track.startsWith('A') ? 'audio' : 'video'), aId: t.aId || null, bId: t.bId || null }));
  const usedTracks = (k) => Math.max(1, ...clips.filter((c) => c.track[0] === k).map((c) => trackNum(c.track)));
  const tracks = [...Array.from({ length: Math.max(vt.length ? 1 : 0, usedTracks('V')) }, (_, i) => ({ id: `V${i + 1}`, kind: 'video' })),
    ...Array.from({ length: Math.max(at.length ? 1 : 0, usedTracks('A')) }, (_, i) => ({ id: `A${i + 1}`, kind: 'audio' }))];
  return { name: seq.name, fps: seq.fps, width: seq.width, height: seq.height, media: [...media.values()], tracks, clips: clips.sort((a, b) => a.start - b.start), transitions, markers: (seq.markers || []).map((m) => ({ time: m.time, name: m.name || '', dur: m.dur || 0, comment: m.comment || '', type: m.type || 'comment', color: m.color })), skipped };
}

/** Clips of one track sorted by start. */
export const onTrack = (desc, track) => desc.clips.filter((c) => c.track === track).sort((a, b) => a.start - b.start);
/** Clip of `track` covering time t (or starting there). */
export const clipAt = (desc, track, t, eps = 1e-6) => desc.clips.find((c) => c.track === track && t >= c.start - eps && t < c.start + c.dur - eps);

/** Round every time in a description to whole frames (what any frame-based format can carry). */
export function quantize(desc) {
  const q = (s) => Math.round(s * desc.fps) / desc.fps;
  return { ...desc, clips: desc.clips.map((c) => ({ ...c, start: q(c.start), dur: q(c.dur), inPoint: q(c.inPoint) })), transitions: desc.transitions.map((t) => ({ ...t, at: q(t.at), dur: q(t.dur) })), markers: desc.markers.map((m) => ({ ...m, time: q(m.time) })) };
}

/** Pair up video + audio clips of the same media that start/end together (they become one linked item in XML formats). */
export function linkPairs(desc) {
  const pairs = new Map(); // video clip id -> audio clip
  const used = new Set();
  for (const v of desc.clips.filter((c) => c.track[0] === 'V')) {
    const a = desc.clips.find((x) => x.track[0] === 'A' && !used.has(x.id) && x.mediaId === v.mediaId && ((v.linkId && x.linkId === v.linkId) || (Math.abs(x.start - v.start) < 1e-4 && Math.abs(x.dur - v.dur) < 1e-4 && Math.abs(x.inPoint - v.inPoint) < 1e-4)));
    if (a) { pairs.set(v.id, a); used.add(a.id); }
  }
  return pairs;
}

/** file:// URL <-> local path (Windows drive paths and POSIX). */
export const pathToUrl = (p, host = '') => { const fwd = String(p).replace(/\\/g, '/'); const abs = /^[A-Za-z]:/.test(fwd) ? `/${fwd}` : fwd; return `file://${host}${abs.split('/').map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/')}`; };
export const urlToPath = (u) => {
  let s = String(u || '').trim(); if (!/^file:/i.test(s)) return s;
  s = s.replace(/^file:\/\/(localhost)?/i, ''); s = decodeURIComponent(s);
  if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1).replace(/\//g, '\\');
  return s;
};
export const baseName = (p) => String(p).split(/[\\/]/).pop();
