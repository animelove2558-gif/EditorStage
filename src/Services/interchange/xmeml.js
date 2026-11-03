// Final Cut Pro 7 XML ("xmeml" v5) writer / reader - the XML that Premiere Pro, Resolve and Avid import/export.
// Frame based. Linked video/audio use <link>, constant speed uses the Time Remap filter, transitions are centred transitionitems.
import { el, parseXml, kids, kid, txt, findAll } from './xml.js';
import { isNtsc, timebase, framesToTC, dropFrameDefault } from './timecode.js';
import { onTrack, linkPairs, pathToUrl, urlToPath, baseName } from './model.js';

const rate = (fps) => el('rate', null, el('timebase', null, timebase(fps)), el('ntsc', null, isNtsc(fps) ? 'TRUE' : 'FALSE'));
const fpsOf = (node) => { const tb = +txt(node, 'rate', 'timebase') || 30; return txt(node, 'rate', 'ntsc').toUpperCase() === 'TRUE' ? Math.round((tb * 1000) / 1001 * 1000) / 1000 : tb; };

export function writeXMEML(desc) {
  const fps = desc.fps; const F = (s) => Math.round(s * fps);
  const pairs = linkPairs(desc); const partner = new Map(); for (const [v, a] of pairs) { partner.set(v, a.id); partner.set(a.id, v); }
  const ids = new Map(desc.clips.map((c, i) => [c.id, `clipitem-${i + 1}`]));
  const fileIds = new Map(desc.media.map((m, i) => [m.id, `file-${i + 1}`])); const fileWritten = new Set();
  const byId = new Map(desc.clips.map((c) => [c.id, c])); const mediaById = new Map(desc.media.map((m) => [m.id, m]));
  const trackIndex = (c) => +c.track.slice(1);
  const fileEl = (m) => {
    if (fileWritten.has(m.id)) return el('file', { id: fileIds.get(m.id) });
    fileWritten.add(m.id);
    return el('file', { id: fileIds.get(m.id) }, el('name', null, m.name), el('pathurl', null, m.path ? pathToUrl(m.path, 'localhost') : ''), rate(fps), el('duration', null, F(m.duration || 0)),
      el('media', null, m.kind !== 'audio' ? el('video', null, el('samplecharacteristics', null, rate(fps), el('width', null, m.width || desc.width), el('height', null, m.height || desc.height))) : null,
        m.hasAudio ? el('audio', null, el('samplecharacteristics', null, el('depth', null, 16), el('samplerate', null, 48000)), el('channelcount', null, 2)) : null));
  };
  const clipItem = (c, kind) => {
    const m = mediaById.get(c.mediaId); const a = F(c.inPoint), dur = F(c.dur);
    const links = partner.has(c.id) ? [c.id, partner.get(c.id)].map((id) => { const x = byId.get(id); return el('link', null, el('linkclipref', null, ids.get(id)), el('mediatype', null, x.track[0] === 'V' ? 'video' : 'audio'), el('trackindex', null, trackIndex(x)), el('clipindex', null, 1)); }) : [];
    const remap = Math.abs(c.speed - 1) > 1e-6 ? el('filter', null, el('effect', null, el('name', null, 'Time Remap'), el('effectid', null, 'timeremap'), el('effectcategory', null, 'motion'), el('effecttype', null, 'motion'), el('mediatype', null, 'video'),
      el('parameter', { authoringApp: 'PremierePro' }, el('parameterid', null, 'variablespeed'), el('name', null, 'variablespeed'), el('valuemin', null, 0), el('valuemax', null, 1), el('value', null, 0)),
      el('parameter', { authoringApp: 'PremierePro' }, el('parameterid', null, 'speed'), el('name', null, 'speed'), el('valuemin', null, -100000), el('valuemax', null, 100000), el('value', null, +(c.speed * 100).toFixed(4))),
      el('parameter', { authoringApp: 'PremierePro' }, el('parameterid', null, 'reverse'), el('name', null, 'reverse'), el('value', null, 'FALSE')))) : null;
    return el('clipitem', { id: ids.get(c.id) }, el('masterclipid', null, `masterclip-${fileIds.get(m.id).slice(5)}`), el('name', null, c.name), el('enabled', null, c.enabled ? 'TRUE' : 'FALSE'),
      el('duration', null, F(m.duration || c.inPoint + c.dur * c.speed)), rate(fps), el('start', null, F(c.start)), el('end', null, F(c.start) + dur), el('in', null, a), el('out', null, a + F(c.dur * c.speed)),
      fileEl(m), kind === 'audio' ? el('sourcetrack', null, el('mediatype', null, 'audio'), el('trackindex', null, 1)) : null, remap, links);
  };
  const transItem = (x) => el('transitionitem', null, rate(fps), el('start', null, F(x.at - x.dur / 2)), el('end', null, F(x.at + x.dur / 2)), el('alignment', null, x.aId && x.bId ? 'center' : x.aId ? 'end-black' : 'start-black'),
    el('effect', null, el('name', null, x.name || 'Cross Dissolve'), el('effectid', null, x.kind === 'audio' ? 'KGAudioTransCrossFade3dB' : 'Cross Dissolve'), el('effectcategory', null, x.kind === 'audio' ? 'Crossfade' : 'Dissolve'), el('effecttype', null, 'transition'), el('mediatype', null, x.kind)));
  const trackEl = (track, kind) => {
    const items = [...onTrack(desc, track).map((c) => ({ t: c.start, e: clipItem(c, kind) })), ...desc.transitions.filter((x) => x.track === track).map((x) => ({ t: x.at - x.dur / 2 - 1e-9, e: transItem(x) }))].sort((a, b) => a.t - b.t);
    return el('track', null, items.map((x) => x.e), el('enabled', null, 'TRUE'), el('locked', null, 'FALSE'));
  };
  const vt = desc.tracks.filter((t) => t.kind === 'video'), at = desc.tracks.filter((t) => t.kind === 'audio');
  const end = Math.max(0, ...desc.clips.map((c) => c.start + c.dur)); const drop = dropFrameDefault(fps);
  const doc = el('xmeml', { version: '5' }, el('sequence', { id: 'sequence-1' },
    el('name', null, desc.name), el('duration', null, F(end)), rate(fps),
    el('timecode', null, rate(fps), el('string', null, framesToTC(0, fps, drop)), el('frame', null, 0), el('displayformat', null, drop ? 'DF' : 'NDF')),
    el('media', null,
      el('video', null, el('format', null, el('samplecharacteristics', null, rate(fps), el('width', null, desc.width), el('height', null, desc.height), el('anamorphic', null, 'FALSE'), el('pixelaspectratio', null, 'square'), el('fielddominance', null, 'none'))), vt.map((t) => trackEl(t.id, 'video'))),
      el('audio', null, el('numOutputChannels', null, 2), at.map((t) => trackEl(t.id, 'audio')))),
    desc.markers.map((m) => el('marker', null, el('comment', null, m.comment || ''), el('name', null, m.name || ''), el('in', null, F(m.time)), el('out', null, m.dur > 0 ? F(m.time + m.dur) : -1)))));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n${doc.xml}\n`;
}

export function parseXMEML(text) {
  const root = parseXml(String(text).replace(/^﻿/, '')); if (root.name !== 'xmeml') throw new Error('Not a Final Cut Pro 7 / Premiere XML file');
  const seq = findAll(root, 'sequence')[0]; if (!seq) throw new Error('XML has no sequence');
  const fps = fpsOf(seq); const S = (f) => f / fps;
  const sc = kid(kid(kid(kid(seq, 'media'), 'video'), 'format'), 'samplecharacteristics');
  const desc = { name: txt(seq, 'name') || 'XML Sequence', fps, width: +txt(sc, 'width') || 1920, height: +txt(sc, 'height') || 1080, media: [], tracks: [], clips: [], transitions: [], markers: [], skipped: 0 };
  const files = new Map(); // file id -> media
  for (const f of findAll(root, 'file')) {
    if (files.has(f.attrs.id) && !kid(f, 'pathurl')) continue;
    const path = urlToPath(txt(f, 'pathurl')) || null; const md = kid(f, 'media');
    const m = files.get(f.attrs.id) || { id: `m${files.size + 1}`, name: txt(f, 'name') || (path ? baseName(path) : 'Unknown'), path, kind: kid(md, 'video') ? 'video' : 'audio', duration: S(+txt(f, 'duration') || 0), hasAudio: !!kid(md, 'audio'), width: +txt(kid(kid(md, 'video'), 'samplecharacteristics'), 'width') || 0, height: +txt(kid(kid(md, 'video'), 'samplecharacteristics'), 'height') || 0 };
    if (path) { m.path = path; m.name = txt(f, 'name') || baseName(path); }
    if (!files.has(f.attrs.id)) { files.set(f.attrs.id, m); desc.media.push(m); }
  }
  const clipIds = new Map(); let cid = 0; const linkGroups = [];
  const media = kid(seq, 'media');
  for (const [kind, prefix] of [['video', 'V'], ['audio', 'A']]) {
    kids(kid(media, kind), 'track').forEach((tr, ti) => {
      const track = `${prefix}${ti + 1}`; const items = tr.children.filter((x) => x.name === 'clipitem' || x.name === 'transitionitem');
      const trans = items.filter((x) => x.name === 'transitionitem').map((x) => ({ s: +txt(x, 'start'), e: +txt(x, 'end'), name: txt(x, 'effect', 'name') || 'Cross Dissolve', align: txt(x, 'alignment') }));
      items.forEach((it, idx) => {
        if (it.name !== 'clipitem') return;
        const fileNode = kid(it, 'file'); const m = fileNode && files.get(fileNode.attrs.id); if (!m) { desc.skipped++; return; }
        let s = +txt(it, 'start'), e = +txt(it, 'end'); const a = +txt(it, 'in'), b = +txt(it, 'out');
        // start/end of -1: that edge is inside the neighbouring transition (Premiere/FCP7 convention) -> use the transition centre
        const prevT = items.slice(0, idx).reverse().find((x) => x.name === 'transitionitem'), nextT = items.slice(idx + 1).find((x) => x.name === 'transitionitem');
        const centre = (x) => Math.round((+txt(x, 'start') + +txt(x, 'end')) / 2);
        if (s < 0) s = prevT ? centre(prevT) : 0;
        if (e < 0) e = nextT ? centre(nextT) : s + (b - a);
        let speed = 1; const sp = findAll(it, 'parameter').find((p) => txt(p, 'parameterid') === 'speed');
        if (sp) speed = (+txt(sp, 'value') || 100) / 100; else if (e > s && b > a) speed = Math.round(((b - a) / (e - s)) * 1e4) / 1e4;
        const c = { id: `c${++cid}`, track, start: S(s), dur: S(e - s), inPoint: S(a), speed, mediaId: m.id, name: txt(it, 'name') || m.name, enabled: txt(it, 'enabled').toUpperCase() !== 'FALSE', linkId: null };
        desc.clips.push(c); clipIds.set(it.attrs.id, c);
        const refs = kids(it, 'link').map((l) => txt(l, 'linkclipref')).filter(Boolean); if (refs.length > 1) linkGroups.push(refs);
      });
      for (const x of trans) {
        const at = S((x.s + x.e) / 2), dur = S(x.e - x.s); const vs = desc.clips.filter((c) => c.track === track);
        const aC = vs.find((c) => Math.abs(c.start + c.dur - at) < 0.51 / fps), bC = vs.find((c) => Math.abs(c.start - at) < 0.51 / fps);
        if (aC || bC) desc.transitions.push({ track, at, dur, name: x.name, kind, aId: aC?.id || null, bId: bC?.id || null });
      }
    });
  }
  let lid = 0; for (const g of linkGroups) { const cs = g.map((r) => clipIds.get(r)).filter(Boolean); if (cs.length > 1 && !cs.some((c) => c.linkId)) { const l = `l${++lid}`; cs.forEach((c) => { c.linkId = l; }); } }
  for (const mk of kids(seq, 'marker')) { const o = +txt(mk, 'out'); desc.markers.push({ time: S(+txt(mk, 'in')), name: txt(mk, 'name'), comment: txt(mk, 'comment') || '', ...(o > +txt(mk, 'in') ? { dur: S(o) - S(+txt(mk, 'in')) } : {}) }); }
  const used = [...new Set(desc.clips.map((c) => c.track))].sort();
  desc.tracks = used.map((id) => ({ id, kind: id[0] === 'V' ? 'video' : 'audio' }));
  return desc;
}
