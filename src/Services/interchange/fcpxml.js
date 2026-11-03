// Final Cut Pro X XML (FCPXML 1.9) writer / reader.
// V1 is the primary storyline (spine, with gaps and transitions); other tracks become connected clips (lane = V2..: 1, 2..; A1..: -1, -2..).
// Linked video+audio pairs are one asset-clip; video-only / audio-only use srcEnable. Constant speed uses timeMap.
import { el, parseXml, kids, kid, findAll } from './xml.js';
import { isNtsc } from './timecode.js';
import { onTrack, linkPairs, pathToUrl, urlToPath, baseName } from './model.js';

const frameDur = (fps) => (isNtsc(fps) ? [1001, Math.round(fps) * 1000] : Number.isInteger(fps) ? [1, fps] : [100, Math.round(fps * 100)]);
/** seconds -> rational FCPXML time on the frame grid */
const rt = (sec, fps) => { const [n, d] = frameDur(fps); const f = Math.round(sec * fps) * n; if (f === 0) return '0s'; if (f % d === 0) return `${f / d}s`; return `${f}/${d}s`; };
/** "1001/30000s" | "5s" -> seconds */
export const parseTime = (s) => { if (!s) return 0; const m = /^(-?\d+)(?:\/(\d+))?s$/.exec(String(s).trim()); if (!m) return 0; return m[2] ? +m[1] / +m[2] : +m[1]; };

export function writeFCPXML(desc) {
  const fps = desc.fps; const T = (s) => rt(s, fps); const [fn, fd] = frameDur(fps);
  const pairs = linkPairs(desc); const pairedAudio = new Set([...pairs.values()].map((a) => a.id));
  const assets = new Map(desc.media.map((m, i) => [m.id, { id: `r${i + 2}`, m }]));
  const resources = [
    el('format', { id: 'r1', name: `FFVideoFormat${desc.height}p${Math.round(fps * 100) / 100}`, frameDuration: `${fn}/${fd}s`, width: desc.width, height: desc.height }),
    ...[...assets.values()].map(({ id, m }) => el('asset', { id, name: m.name.replace(/\.[^.]+$/, ''), uid: m.id, start: '0s', duration: T(m.duration || 0), hasVideo: m.kind !== 'audio' ? '1' : '0', hasAudio: m.hasAudio ? '1' : '0', format: m.kind !== 'audio' ? 'r1' : undefined, audioSources: m.hasAudio ? '1' : undefined, audioChannels: m.hasAudio ? '2' : undefined },
      el('media-rep', { kind: 'original-media', src: m.path ? pathToUrl(m.path) : '' }))),
  ];
  const v1 = onTrack(desc, 'V1');
  // spine: V1 clips + gaps
  const spine = []; let t = 0;
  for (const c of v1) {
    if (c.start > t + 1e-6) { spine.push({ kind: 'gap', offset: t, dur: c.start - t, start: 0, kids: [] }); }
    spine.push({ kind: 'clip', c, offset: c.start, dur: c.dur, start: c.inPoint, kids: [] }); t = c.start + c.dur;
  }
  const others = desc.clips.filter((c) => c.track !== 'V1' && !pairedAudio.has(c.id));
  const end = Math.max(t, ...desc.clips.map((c) => c.start + c.dur), ...desc.markers.map((m) => m.time + 1 / fps));
  if (end > t + 1e-6) spine.push({ kind: 'gap', offset: t, dur: end - t, start: 0, kids: [] });
  const parentAt = (time) => spine.find((p) => time >= p.offset - 1e-6 && time < p.offset + p.dur - 1e-6) || spine[spine.length - 1];
  const laneOf = (track) => (track[0] === 'V' ? +track.slice(1) - 1 : -(+track.slice(1)));
  const clipEl = (c, extra) => {
    const a = assets.get(c.mediaId); const m = a.m; const isV = c.track[0] === 'V';
    const srcEnable = m.kind === 'video' && m.hasAudio ? (isV ? (pairs.has(c.id) ? undefined : 'video') : 'audio') : undefined;
    const timeMap = Math.abs(c.speed - 1) > 1e-6 ? el('timeMap', null, el('timept', { time: '0s', value: '0s', interp: 'linear' }), el('timept', { time: T(c.dur), value: rt(c.dur * c.speed, fps), interp: 'linear' })) : null;
    return { c, attrs: { ref: a.id, ...extra, name: c.name, start: T(c.inPoint), duration: T(c.dur), enabled: c.enabled ? undefined : '0', srcEnable }, timeMap, kids: [] };
  };
  for (const c of others.sort((a, b) => a.start - b.start)) {
    const p = parentAt(c.start);
    p.kids.push(clipEl(c, { lane: laneOf(c.track), offset: T(p.start + (c.start - p.offset)) }));
  }
  const markersOf = (p) => desc.markers.filter((m) => m.time >= p.offset - 1e-6 && m.time < p.offset + p.dur - 1e-6).map((m) => el(m.type === 'chapter' ? 'chapter-marker' : 'marker', { start: T(p.start + (m.time - p.offset)), duration: m.dur > 0 ? T(m.dur) : `${fn}/${fd}s`, value: m.name || 'Marker', ...(m.comment ? { note: m.comment } : {}) }));
  const items = [];
  const trs = desc.transitions.filter((x) => x.track === 'V1' && x.kind === 'video').sort((a, b) => a.at - b.at);
  for (const p of spine) {
    while (trs.length && trs[0].at - trs[0].dur / 2 <= p.offset + 1e-6) { const x = trs.shift(); items.push(el('transition', { name: x.name || 'Cross Dissolve', offset: T(Math.max(0, x.at - x.dur / 2)), duration: T(x.dur) })); }
    const connected = p.kids.map((k) => el('asset-clip', k.attrs, k.timeMap));
    if (p.kind === 'gap') items.push(el('gap', { name: 'Gap', offset: T(p.offset), start: '0s', duration: T(p.dur) }, connected, markersOf(p)));
    else { const e = clipEl(p.c, { offset: T(p.offset) }); items.push(el('asset-clip', e.attrs, e.timeMap, connected, markersOf(p))); }
  }
  for (const x of trs) items.push(el('transition', { name: x.name || 'Cross Dissolve', offset: T(Math.max(0, x.at - x.dur / 2)), duration: T(x.dur) }));
  const doc = el('fcpxml', { version: '1.9' },
    el('resources', null, resources),
    el('library', null, el('event', { name: 'EditorStage' }, el('project', { name: desc.name },
      el('sequence', { format: 'r1', duration: T(end), tcStart: '0s', tcFormat: 'NDF', audioLayout: 'stereo', audioRate: '48k' }, el('spine', null, items))))));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n${doc.xml}\n`;
}

const CLIP_TAGS = new Set(['asset-clip', 'clip', 'video', 'audio', 'ref-clip', 'mc-clip', 'sync-clip']);
export function parseFCPXML(text) {
  const root = parseXml(String(text).replace(/^﻿/, '')); if (root.name !== 'fcpxml') throw new Error('Not an FCPXML file');
  const formats = new Map(findAll(root, 'format').map((f) => [f.attrs.id, f]));
  const assets = new Map(findAll(root, 'asset').map((a) => [a.attrs.id, a]));
  const seqEl = findAll(root, 'sequence')[0]; if (!seqEl) throw new Error('FCPXML has no sequence');
  const project = findAll(root, 'project')[0];
  const fmt = formats.get(seqEl.attrs.format) || [...formats.values()][0];
  const fd = parseTime(fmt?.attrs.frameDuration || '1/30s'); const fps = fd > 0 ? Math.round((1 / fd) * 1000) / 1000 : 30;
  const desc = { name: project?.attrs.name || 'FCPXML Sequence', fps: Math.abs(fps - 29.97) < 0.01 ? 29.97 : Math.abs(fps - 23.976) < 0.01 ? 23.976 : Math.abs(fps - 59.94) < 0.01 ? 59.94 : fps,
    width: +(fmt?.attrs.width || 1920), height: +(fmt?.attrs.height || 1080), media: [], tracks: [], clips: [], transitions: [], markers: [], skipped: 0 };
  const mediaOf = new Map(); let mid = 0, cid = 0, lid = 0;
  const mediaFor = (asset) => {
    if (mediaOf.has(asset.attrs.id)) return mediaOf.get(asset.attrs.id);
    const src = kid(asset, 'media-rep')?.attrs.src || asset.attrs.src || ''; const path = src ? urlToPath(src) : null;
    const m = { id: `m${++mid}`, name: path ? baseName(path) : asset.attrs.name || 'Unknown', path, kind: asset.attrs.hasVideo === '1' ? 'video' : 'audio', duration: parseTime(asset.attrs.duration), hasAudio: asset.attrs.hasAudio === '1', width: 0, height: 0, assetStart: parseTime(asset.attrs.start) };
    mediaOf.set(asset.attrs.id, m); desc.media.push(m); return m;
  };
  const refOf = (node) => { if (node.attrs.ref && assets.has(node.attrs.ref)) return node.attrs.ref; const inner = node.children.find((k) => (k.name === 'video' || k.name === 'audio') && assets.has(k.attrs.ref)); return inner?.attrs.ref || null; };
  const speedOf = (node) => { const tm = kid(node, 'timeMap'); if (!tm) return 1; const pts = kids(tm, 'timept'); if (pts.length < 2) return 1; const a = pts[0], b = pts[pts.length - 1]; const dt = parseTime(b.attrs.time) - parseTime(a.attrs.time); return dt > 0 ? (parseTime(b.attrs.value) - parseTime(a.attrs.value)) / dt : 1; };
  const add = (node, timelineStart, lane) => {
    const ref = refOf(node); if (!ref) { desc.skipped++; return; }
    const m = mediaFor(assets.get(ref)); const en = node.attrs.srcEnable || 'all';
    const start = parseTime(node.attrs.start) - (m.assetStart || 0), dur = parseTime(node.attrs.duration), speed = speedOf(node);
    const base = { start: timelineStart, dur, inPoint: Math.max(0, start), speed, mediaId: m.id, name: node.attrs.name || m.name, enabled: node.attrs.enabled !== '0' };
    const wantV = m.kind === 'video' && en !== 'audio' && lane >= 0, wantA = m.hasAudio && en !== 'video';
    const link = wantV && wantA ? `l${++lid}` : null;
    if (wantV) desc.clips.push({ id: `c${++cid}`, track: `V${lane + 1}`, ...base, linkId: link });
    if (wantA) desc.clips.push({ id: `c${++cid}`, track: lane < 0 ? `A${-lane}` : `A${lane + 1}`, ...base, linkId: link });
  };
  const spine = kid(seqEl, 'spine');
  for (const item of spine?.children || []) {
    const off = parseTime(item.attrs.offset), pStart = parseTime(item.attrs.start);
    if (item.name === 'transition') { desc.transitions.push({ track: 'V1', at: off + parseTime(item.attrs.duration) / 2, dur: parseTime(item.attrs.duration), name: item.attrs.name || 'Cross Dissolve', kind: 'video' }); continue; }
    if (CLIP_TAGS.has(item.name)) add(item, off, 0); else if (item.name !== 'gap') { desc.skipped++; }
    for (const k of item.children) {
      const tl = off + (parseTime(k.attrs.offset ?? k.attrs.start) - pStart);
      if (k.name === 'marker' || k.name === 'chapter-marker') desc.markers.push({ time: off + (parseTime(k.attrs.start) - pStart), name: k.attrs.value || '', comment: k.attrs.note || '', type: k.name === 'chapter-marker' ? 'chapter' : 'comment' });
      else if (CLIP_TAGS.has(k.name) && k.attrs.lane !== undefined) add(k, tl, +k.attrs.lane);
      else if (k.name === 'spine' && k.attrs.lane !== undefined) desc.skipped += k.children.length; // secondary storylines are not supported
    }
  }
  // attach transitions to the clips meeting at their centre
  for (const x of desc.transitions) {
    const vs = desc.clips.filter((c) => c.track === 'V1');
    x.aId = vs.find((c) => Math.abs(c.start + c.dur - x.at) < 1e-3)?.id || null; x.bId = vs.find((c) => Math.abs(c.start - x.at) < 1e-3)?.id || null;
  }
  desc.transitions = desc.transitions.filter((x) => x.aId || x.bId);
  const used = [...new Set(desc.clips.map((c) => c.track))].sort();
  desc.tracks = used.map((id) => ({ id, kind: id[0] === 'V' ? 'video' : 'audio' }));
  for (const m of desc.media) delete m.assetStart;
  return desc;
}
