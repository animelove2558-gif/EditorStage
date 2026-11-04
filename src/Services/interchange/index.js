// App glue for File > Export > EDL / FCPXML / Premiere XML and File > Import of those formats.
import { getState, edit, addSequence } from '../../Core/store';
import { expandRemix } from '../remix';
import { importPaths } from '../media';
import { VIDEO_TRANSITION_IDS } from '../../Renderers/fx/transitions';
import { defaultParams } from '../../Renderers/fx/videoEffects';
import { DEFAULT_MOTION, DEFAULT_OPACITY, DEFAULT_VOLUME } from '../../Core/params';
import { describeSequence, quantize, baseName } from './model.js';
import { writeEDL, parseEDL } from './edl.js';
import { writeFCPXML, parseFCPXML } from './fcpxml.js';
import { writeXMEML, parseXMEML } from './xmeml.js';

export { describeSequence, quantize, writeEDL, parseEDL, writeFCPXML, parseFCPXML, writeXMEML, parseXMEML };
export { exportAAFFile } from './aafExport.js';
export { readCFB } from './cfb.js';
export const INTERCHANGE_EXT = ['edl', 'xml', 'fcpxml'];
const uid = () => Math.random().toString(36).slice(2, 9);
// imported effects ({ name, params } from fxImport.js) -> clip effects with the effect's other parameters at their defaults
const FX_FOLDER = { 'ASC CDL': 'Color Correction', 'Gaussian Blur': 'Blur & Sharpen', Crop: 'Transform' };
const appEffects = (list) => (list || []).filter((e) => FX_FOLDER[e.name]).map((e) => ({ id: uid(), effectId: `Video Effects/${FX_FOLDER[e.name]}/${e.name}`, name: e.name, category: 'Video',
  folder: FX_FOLDER[e.name], enabled: true, params: { ...defaultParams(e.name), ...e.params } }));
const EXT = { edl: 'edl', fcpxml: 'fcpxml', xmeml: 'xml' };

/** Export the active sequence (Premiere XML: the selection when clips are selected). Returns { files, skipped } or null when cancelled. */
export async function exportInterchangeFile(format) {
  const s = getState(); const seq = expandRemix(s.sequence); // a remixed clip goes out as one clip per segment + crossfades
  let only = null;
  if (format === 'xmeml' && s.selection.length) { // selection + linked partners
    const links = new Set(seq.clips.filter((c) => s.selection.includes(c.id) && c.linkId).map((c) => c.linkId));
    only = seq.clips.filter((c) => s.selection.includes(c.id) || s.selection.includes(c.id.replace(/_r\d+$/, '')) || (c.linkId && links.has(c.linkId))).map((c) => c.id);
  }
  const desc = quantize(describeSequence(seq, s.media, only));
  if (!desc.clips.length) throw new Error('nothing to export - the sequence has no clips that use media files');
  const ext = EXT[format];
  const path = await window.editorstage.saveDialog('export', `${seq.name}.${ext}`, ext); if (!path) return null;
  const files = [path];
  if (format === 'edl') {
    await window.editorstage.writeFile(path, writeEDL(desc, { videoTrack: 'V1' }));
    // CMX3600 holds one video track: V2, V3 ... go to their own EDLs next to it
    for (const t of desc.tracks.filter((x) => x.kind === 'video' && x.id !== 'V1' && desc.clips.some((c) => c.track === x.id))) {
      const p = path.replace(/(\.edl)?$/i, ` ${t.id}.edl`); await window.editorstage.writeFile(p, writeEDL(desc, { videoTrack: t.id, withAudio: false })); files.push(p);
    }
  } else await window.editorstage.writeFile(path, format === 'fcpxml' ? writeFCPXML(desc) : writeXMEML(desc));
  return { files, skipped: desc.skipped };
}

/** Parse an EDL / FCPXML / FCP7 XML file into a description (EDLs use the active sequence frame rate). */
export function parseInterchange(text, name, fps) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'edl') return parseEDL(text, fps);
  if (/<fcpxml[\s>]/.test(text)) return parseFCPXML(text);
  if (/<xmeml[\s>]/.test(text)) return parseXMEML(text);
  throw new Error('not an EDL, FCPXML or Final Cut Pro 7 / Premiere XML file');
}

/** Import into a new sequence. Media is matched by path (project items first), imported when the file exists, otherwise added offline. */
export async function importInterchange(path) {
  const st = getState();
  const desc = parseInterchange(await window.editorstage.readText(path), path, st.sequence.fps);
  if (desc.name === 'EDL Sequence') desc.name = baseName(path).replace(/\.[^.]+$/, '');
  const key = (p) => String(p || '').toLowerCase().replace(/\//g, '\\');
  const map = new Map(); const toImport = []; const offline = [];
  for (const m of desc.media) {
    const have = m.path && st.media.find((x) => !x.subclip && key(x.path) === key(m.path));
    if (have) { map.set(m.id, have); continue; }
    if (m.path && await window.editorstage.exists(m.path)) toImport.push(m); else offline.push(m);
  }
  if (toImport.length) {
    const items = await importPaths(toImport.map((m) => m.path));
    for (const m of toImport) { const it = items.find((x) => key(x.path) === key(m.path)); if (it) map.set(m.id, it); else offline.push(m); }
  }
  if (offline.length) {
    const items = offline.map((m) => ({ id: uid(), path: m.path || m.name, name: m.name, ext: (m.name.split('.').pop() || '').toLowerCase(), kind: m.kind === 'audio' ? 'audio' : 'video', duration: Math.max(m.duration || 0, 1), width: m.width || 0, height: m.height || 0, hasAudio: m.hasAudio, playPath: m.path || '', status: 'offline', error: 'Media offline - file not found', transcoded: false }));
    edit('Import Offline Media', ({ media }) => media.push(...items));
    offline.forEach((m, i) => map.set(m.id, items[i]));
  }
  // tracks: as many as the file uses (at least V1-V3 / A1-A3)
  const nV = Math.max(3, ...desc.tracks.filter((t) => t.kind === 'video').map((t) => +t.id.slice(1)));
  const nA = Math.max(3, ...desc.tracks.filter((t) => t.kind === 'audio').map((t) => +t.id.slice(1)));
  const tr = (id, kind) => ({ id, kind, muted: false, solo: false, locked: false, sync: true });
  const seq = { id: uid(), name: desc.name, fps: desc.fps, width: desc.width, height: desc.height, duration: 60, transitions: [], markers: [],
    tracks: [...Array.from({ length: nV }, (_, i) => tr(`V${nV - i}`, 'video')), ...Array.from({ length: nA }, (_, i) => tr(`A${i + 1}`, 'audio'))], clips: [] };
  const ids = new Map(); const links = new Map();
  for (const c of desc.clips) {
    const m = map.get(c.mediaId); if (!m) continue;
    const isV = c.track[0] === 'V'; const id = uid(); ids.set(c.id, id);
    const link = c.linkId ? (links.get(c.linkId) || links.set(c.linkId, uid()).get(c.linkId)) : undefined;
    const partnered = !!c.linkId && desc.clips.some((x) => x !== c && x.linkId === c.linkId && x.track[0] !== c.track[0]);
    seq.clips.push({ id, track: c.track, start: c.start, dur: c.dur, name: c.name, mediaId: m.id, inPoint: c.inPoint, speed: c.speed, enabled: c.enabled, effects: appEffects(c.effects), audio: { tag: null },
      color: !isV ? '#43a047' : m.kind === 'image' ? '#c0742d' : '#5b7fd1', linkId: link, ...(isV && partnered ? { noAudio: true } : {}), ...(!isV && m.kind === 'video' ? { asAudio: true } : {}),
      // Motion / Opacity / Volume read from the file (keyframes included)
      ...(isV && c.motion ? { motion: { ...DEFAULT_MOTION(), ...c.motion } } : {}), ...(isV && c.opacity ? { opacity: { ...DEFAULT_OPACITY(), ...c.opacity } } : {}),
      ...(!isV && c.volume ? { volume: { ...DEFAULT_VOLUME(), ...c.volume } } : {}) });
  }
  for (const x of desc.transitions) {
    const aId = x.aId ? ids.get(x.aId) : null, bId = x.bId ? ids.get(x.bId) : null; if (!aId && !bId) continue;
    const video = x.kind !== 'audio';
    seq.transitions.push({ id: uid(), track: x.track, kind: video ? 'video' : 'audio', name: video ? (VIDEO_TRANSITION_IDS.includes(x.name) ? x.name : 'Cross Dissolve') : 'Constant Power', folder: video ? 'Dissolve' : 'Crossfade', at: x.at, dur: x.dur, aId, bId, reverse: false });
  }
  seq.markers = desc.markers.map((m) => ({ id: uid(), time: m.time, name: m.name || '' }));
  seq.duration = Math.max(60, ...seq.clips.map((c) => c.start + c.dur));
  addSequence(seq, true);
  const withFx = seq.clips.filter((c) => c.effects.length || c.motion || c.opacity || c.volume).length;
  return { name: seq.name, clips: seq.clips.length, offline: offline.length, skipped: desc.skipped, withFx, unknownFx: [...new Set(desc.unknownFx || [])] };
}
