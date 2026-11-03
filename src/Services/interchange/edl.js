// CMX3600 EDL writer / reader. One EDL carries one video track (+ up to 4 audio channels): cuts, dissolves (incl. from/to black)
// and constant speed (M2). Media are linked through "* SOURCE FILE:" comments (written by Premiere/Resolve/EditorStage).
import { framesToTC, tcToFrames, dropFrameDefault, timebase } from './timecode.js';
import { onTrack, baseName } from './model.js';

const AUDIO_CH = { A1: 'A', A2: 'A2', A3: 'A3', A4: 'A4' };
const reelOf = () => 'AX'; // EditorStage has no tape reels; AX + SOURCE FILE comments is what Premiere writes
const pad = (s, n) => String(s).padEnd(n);

/** EDL text for `videoTrack` (+ audio tracks A1-A4 when withAudio). */
const LOC_COLORS = { '#4caf50': 'GREEN', '#e53935': 'RED', '#ab47bc': 'PURPLE', '#ff9800': 'ORANGE', '#fdd835': 'YELLOW', '#eeeeee': 'WHITE', '#1e88e5': 'BLUE', '#26c6da': 'CYAN' };
const markerColorName = (hex) => LOC_COLORS[String(hex || '#4caf50').toLowerCase()] || 'GREEN';

export function writeEDL(desc, { videoTrack = 'V1', withAudio = true, drop = dropFrameDefault(desc.fps) } = {}) {
  const fps = desc.fps; const F = (s) => Math.round(s * fps); const tc = (s) => framesToTC(F(s), fps, drop);
  const mediaById = new Map(desc.media.map((m) => [m.id, m]));
  const trs = desc.transitions.filter((t) => t.track === videoTrack && t.kind === 'video');
  const inTr = new Map(), outTr = new Map();
  for (const t of trs) { if (t.bId) inTr.set(t.bId, t); if (t.aId) outTr.set(t.aId, t); }
  const events = []; // { rec, lines[] }
  const srcAt = (c, rec) => c.inPoint + (rec - c.start) * c.speed;
  const comments = (c, key = 'FROM') => { const m = mediaById.get(c.mediaId); return [`* ${key} CLIP NAME: ${c.name}`, ...(m?.path ? [`* SOURCE FILE: ${m.path}`] : [])]; };
  // M2 speed is in frames per second of the timecode base (200% at 29.97 = 060.0, like Premiere/Avid)
  const m2 = (c, srcIn) => (Math.abs(c.speed - 1) > 1e-6 ? [`M2   ${pad(reelOf(), 8)} ${(c.speed * timebase(fps)).toFixed(1).padStart(5, '0')}                ${tc(srcIn)}`] : []);
  // dissolves are centred on the cut; with an odd frame count the extra frame goes after the cut
  const half = (t) => Math.floor(F(t.dur) / 2) / fps;
  const vclips = onTrack(desc, videoTrack);
  for (const c of vclips) {
    const ti = inTr.get(c.id), to = outTr.get(c.id);
    const recIn = ti ? ti.at - half(ti) : c.start; // a dissolve event starts where the transition starts
    const recOut = to ? to.at - half(to) : c.start + c.dur; // ... and the previous event ends there
    const sIn = srcAt(c, recIn), sOut = sIn + (recOut - recIn) * c.speed;
    if (ti) {
      const a = ti.aId && vclips.find((x) => x.id === ti.aId);
      const first = a ? `${pad(reelOf(), 8)} V     C        ${tc(srcAt(a, recIn))} ${tc(srcAt(a, recIn))} ${tc(recIn)} ${tc(recIn)}` : `${pad('BL', 8)} V     C        00:00:00:00 00:00:00:00 ${tc(recIn)} ${tc(recIn)}`;
      events.push({ rec: recIn, lines: [first, `${pad(reelOf(), 8)} V     D    ${String(F(ti.dur)).padStart(3, '0')} ${tc(sIn)} ${tc(sOut)} ${tc(recIn)} ${tc(recOut)}`], notes: [...(a ? [`* FROM CLIP NAME: ${a.name}`] : []), ...comments(c, 'TO'), ...m2(c, sIn)] });
    } else {
      events.push({ rec: recIn, lines: [`${pad(reelOf(), 8)} V     C        ${tc(sIn)} ${tc(sOut)} ${tc(recIn)} ${tc(recOut)}`], notes: [...comments(c), ...m2(c, sIn)] });
    }
    if (to && !to.bId) { // dissolve to black
      const r1 = recOut + to.dur;
      events.push({ rec: recOut, lines: [`${pad(reelOf(), 8)} V     C        ${tc(sOut)} ${tc(sOut)} ${tc(recOut)} ${tc(recOut)}`, `${pad('BL', 8)} V     D    ${String(F(to.dur)).padStart(3, '0')} 00:00:00:00 ${tc(to.dur)} ${tc(recOut)} ${tc(r1)}`], notes: [`* FROM CLIP NAME: ${c.name}`, '* TO CLIP NAME: BLACK'] });
    }
  }
  if (withAudio) for (const [track, ch] of Object.entries(AUDIO_CH)) {
    for (const c of onTrack(desc, track)) events.push({ rec: c.start, lines: [`${pad(reelOf(), 8)} ${pad(ch, 5)} C        ${tc(c.inPoint)} ${tc(c.inPoint + c.dur * c.speed)} ${tc(c.start)} ${tc(c.start + c.dur)}`], notes: [...comments(c), ...m2(c, c.inPoint)] });
  }
  events.sort((a, b) => a.rec - b.rec);
  const out = [`TITLE: ${desc.name}`, `FCM: ${drop ? 'DROP FRAME' : 'NON-DROP FRAME'}`, ''];
  events.forEach((e, i) => { const n = String(i + 1).padStart(3, '0'); for (const l of e.lines) out.push(`${n}  ${l}`); out.push(...e.notes, ''); });
  // sequence markers as LOC comment lines (Premiere / Resolve style)
  for (const m of [...(desc.markers || [])].sort((a, b) => a.time - b.time)) out.push(`* LOC: ${tc(m.time)} ${markerColorName(m.color)} ${(m.name || 'Marker').replace(/\s+/g, '_')}${m.comment ? ' ' + m.comment.replace(/\s+/g, ' ') : ''}`);
  return out.join('\r\n');
}

/** Parse an EDL into a timeline description. fps is required (EDLs do not store it). */
export function parseEDL(text, fps, { videoTrack = 'V1' } = {}) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const desc = { name: 'EDL Sequence', fps, width: 1920, height: 1080, media: [], tracks: [], clips: [], transitions: [], markers: [], skipped: 0 };
  const evs = []; let cur = null;
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue;
    let m;
    if ((m = /^TITLE:\s*(.*)$/i.exec(l))) { desc.name = m[1].trim() || desc.name; continue; }
    if (/^FCM:/i.test(l)) continue;
    if ((m = /^(\d{1,6})\s+(\S+)\s+(\S+)\s+(C|D|W\d+|K\w*)\s+(?:(\d{1,3})\s+)?(\d\d[:;.,]\d\d[:;.,]\d\d[:;.,]\d\d)\s+(\d\d[:;.,]\d\d[:;.,]\d\d[:;.,]\d\d)\s+(\d\d[:;.,]\d\d[:;.,]\d\d[:;.,]\d\d)\s+(\d\d[:;.,]\d\d[:;.,]\d\d[:;.,]\d\d)/i.exec(l))) {
      const line = { num: m[1], reel: m[2], ch: m[3].toUpperCase(), type: m[4].toUpperCase(), tdur: m[5] ? +m[5] : 0, srcIn: tcToFrames(m[6], fps), srcOut: tcToFrames(m[7], fps), recIn: tcToFrames(m[8], fps), recOut: tcToFrames(m[9], fps) };
      if (cur && cur.num === line.num) cur.lines.push(line); else { cur = { num: line.num, lines: [line], from: null, to: null, file: null, speed: null }; evs.push(cur); }
      continue;
    }
    if (!cur) continue;
    if ((m = /^\*\s*FROM CLIP NAME:\s*(.*)$/i.exec(l))) { cur.from = m[1].trim(); continue; }
    if ((m = /^\*\s*TO CLIP NAME:\s*(.*)$/i.exec(l))) { cur.to = m[1].trim(); continue; }
    if ((m = /^\*\s*SOURCE FILE:\s*(.*)$/i.exec(l))) { cur.file = m[1].trim(); continue; }
    if ((m = /^M2\s+(\S+)\s+(-?[\d.]+)\s+(\S+)/i.exec(l))) { cur.speed = +m[2] / timebase(fps); continue; }
  }
  // record timecode usually starts at 01:00:00:00: shift the whole edit to start at the hour below its first event
  const recs = evs.flatMap((e) => e.lines.map((x) => x.recIn)); const hourF = Math.round(fps) * 3600;
  const off = recs.length ? Math.floor(Math.min(...recs) / hourF) * hourF : 0;
  const S = (f) => (f - off) / fps; const SF = (f) => f / fps;
  const mediaKey = new Map(); let mid = 0;
  const mediaFor = (file, name, kind) => {
    const key = (file || name || 'unknown').toLowerCase();
    let m = mediaKey.get(key);
    if (!m) { m = { id: `m${++mid}`, name: file ? baseName(file) : name || 'Unknown', path: file || null, kind, duration: 0, hasAudio: kind !== 'video', width: 0, height: 0 }; mediaKey.set(key, m); desc.media.push(m); }
    if (kind === 'video' && m.kind === 'audio') m.kind = 'video'; if (kind === 'audio') m.hasAudio = true;
    return m;
  };
  let cid = 0; const lastOn = new Map();
  const chTracks = (ch) => { if (ch === 'V') return [videoTrack]; if (ch === 'B' || ch === 'AA/V') return [videoTrack, 'A1']; if (ch === 'A' || ch === 'A1') return ['A1']; if (ch === 'AA') return ['A1']; const n = /^A(\d)$/.exec(ch); return n ? [`A${n[1]}`] : []; };
  for (const e of evs) {
    const inc = e.lines[e.lines.length - 1]; const isD = inc.type === 'D' && e.lines.length > 1;
    const speed = e.speed && Math.abs(e.speed) > 1e-6 ? e.speed : 1;
    const tracks = chTracks(inc.ch); if (!tracks.length) { desc.skipped++; continue; }
    const name = (isD ? e.to : e.from) || inc.reel;
    let link = tracks.length > 1 ? `l${cid + 1}` : null;
    for (const track of tracks) {
      const kind = track[0] === 'V' ? 'video' : 'audio';
      if (isD) {
        const out = e.lines[0]; const half = Math.floor(inc.tdur / 2); const toBlack = /^BL$/i.test(inc.reel); const fromBlack = /^BL$/i.test(out.reel);
        const prev = lastOn.get(track);
        if (toBlack) { // outgoing clip fades to black: extend it to the transition centre
          if (prev) { prev.dur = S(inc.recIn + half) - prev.start; desc.transitions.push({ track, at: prev.start + prev.dur, dur: SF(inc.tdur), name: 'Cross Dissolve', kind, aId: prev.id, bId: null }); }
          continue;
        }
        const start = S(inc.recIn + half);
        const c = { id: `c${++cid}`, track, start, dur: S(inc.recOut) - start, inPoint: SF(inc.srcIn) + (half / fps) * speed, speed, mediaId: mediaFor(e.file, name, kind).id, name, enabled: true, linkId: link };
        desc.clips.push(c);
        if (prev && !fromBlack) { prev.dur = start - prev.start; }
        desc.transitions.push({ track, at: start, dur: SF(inc.tdur), name: 'Cross Dissolve', kind, aId: prev && !fromBlack ? prev.id : null, bId: c.id });
        lastOn.set(track, c);
      } else {
        const c = { id: `c${++cid}`, track, start: S(inc.recIn), dur: S(inc.recOut) - S(inc.recIn), inPoint: SF(inc.srcIn), speed, mediaId: mediaFor(e.file, name, kind).id, name, enabled: true, linkId: link };
        desc.clips.push(c); lastOn.set(track, c);
      }
    }
    link = null;
  }
  const used = [...new Set(desc.clips.map((c) => c.track))];
  desc.tracks = [...used.filter((t) => t[0] === 'V'), ...used.filter((t) => t[0] === 'A')].sort().map((id) => ({ id, kind: id[0] === 'V' ? 'video' : 'audio' }));
  for (const m of desc.media) m.duration = Math.max(0, ...desc.clips.filter((c) => c.mediaId === m.id).map((c) => c.inPoint + c.dur * Math.abs(c.speed)));
  return desc;
}
