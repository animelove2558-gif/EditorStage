// OpenTimelineIO (.otio, JSON) writer and reader on the neutral timeline description (see model.js).
// Timeline > Stack > Track > Clip / Gap / Transition, RationalTime at the sequence frame rate. EditorStage-only data
// (link ids, disabled clips, media ids) goes in metadata.editorstage so a round trip through other tools loses nothing we need.
import { pathToUrl, urlToPath, baseName } from './model.js';

const rt = (value, rate) => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value });
const tr = (start, dur, rate) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: rt(start, rate), duration: rt(dur, rate) });
const MARKER_COLOR = { '#4caf50': 'GREEN', '#e53935': 'RED', '#ab47bc': 'PURPLE', '#ff9800': 'ORANGE', '#fdd835': 'YELLOW', '#eeeeee': 'WHITE', '#1e88e5': 'BLUE', '#26c6da': 'CYAN' };

export function writeOTIO(desc) {
  const fps = desc.fps; const F = (s) => Math.round(s * fps);
  const mediaById = new Map(desc.media.map((m) => [m.id, m]));
  const tracks = desc.tracks.map((t) => {
    const clips = desc.clips.filter((c) => c.track === t.id).sort((a, b) => a.start - b.start);
    const trans = desc.transitions.filter((x) => x.track === t.id);
    const children = []; let cursor = 0;
    for (const c of clips) {
      const start = F(c.start), dur = F(c.dur);
      if (start > cursor) children.push({ OTIO_SCHEMA: 'Gap.1', name: '', source_range: tr(0, start - cursor, fps), effects: [], markers: [], metadata: {} });
      const m = mediaById.get(c.mediaId);
      const ref = m?.path
        ? { OTIO_SCHEMA: 'ExternalReference.1', name: m.name, target_url: pathToUrl(m.path), available_range: tr(0, F(m.duration || 0), fps), metadata: { editorstage: { kind: m.kind, hasAudio: m.hasAudio !== false, width: m.width || 0, height: m.height || 0 } } }
        : { OTIO_SCHEMA: 'MissingReference.1', name: m?.name || c.name, metadata: {} };
      const effects = Math.abs(c.speed - 1) > 1e-9 ? [{ OTIO_SCHEMA: 'LinearTimeWarp.1', name: 'Speed', effect_name: 'LinearTimeWarp', time_scalar: c.speed, metadata: {} }] : [];
      // a dissolve to or from nothing (a clip's fade) has no neighbour to sit between: it is kept in the clip's metadata
      const next = clips[clips.indexOf(c) + 1];
      const x = trans.find((q) => q.aId === c.id || Math.abs(F(q.at) - (start + dur)) <= 1);
      const between = x && next && F(next.start) <= start + dur + 1;
      const lone = x && !between ? { name: x.name, at: F(x.at), dur: F(x.dur), aId: x.aId === c.id, bId: x.bId === c.id } : null;
      children.push({ OTIO_SCHEMA: 'Clip.2', name: c.name, source_range: tr(F(c.inPoint), Math.max(1, Math.round(dur * c.speed)), fps), media_references: { DEFAULT_MEDIA: ref }, active_media_reference_key: 'DEFAULT_MEDIA',
        effects, markers: [], enabled: c.enabled !== false, metadata: { editorstage: { linkId: c.linkId || null, ...(lone ? { lone } : {}) } } });
      // a transition between two clips is centred on the cut
      if (between) {
        const half = Math.floor(F(x.dur) / 2);
        children.push({ OTIO_SCHEMA: 'Transition.1', name: x.name, transition_type: 'SMPTE_Dissolve', in_offset: rt(half, fps), out_offset: rt(F(x.dur) - half, fps), metadata: { editorstage: { name: x.name } } });
      }
      cursor = start + dur;
    }
    return { OTIO_SCHEMA: 'Track.1', name: t.id, kind: t.kind === 'audio' ? 'Audio' : 'Video', source_range: null, children, effects: [], markers: [], metadata: {} };
  });
  const markers = (desc.markers || []).map((m) => ({ OTIO_SCHEMA: 'Marker.2', name: m.name || '', color: MARKER_COLOR[String(m.color || '').toLowerCase()] || 'GREEN', marked_range: tr(F(m.time), Math.max(0, F(m.dur || 0)), fps), comment: m.comment || '', metadata: {} }));
  return JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: desc.name, global_start_time: null, metadata: { editorstage: { width: desc.width, height: desc.height, fps } },
    tracks: { OTIO_SCHEMA: 'Stack.1', name: 'tracks', children: tracks, source_range: null, effects: [], markers, metadata: {} } }, null, 2);
}

const val = (r) => (r && typeof r.value === 'number' && r.rate ? r.value / r.rate : 0);
/** Parse OTIO JSON into a description. `fps` is the fallback rate. Unsupported items (generators, nested stacks) count as skipped. */
export function parseOTIO(text, fps = 30) {
  let j; try { j = JSON.parse(text); } catch { throw new Error('not an OpenTimelineIO file'); }
  if (!j || !/^Timeline\./.test(j.OTIO_SCHEMA || '')) throw new Error('not an OpenTimelineIO timeline (no Timeline object)');
  const meta = j.metadata?.editorstage || {};
  const stack = j.tracks || { children: [] };
  let rate = meta.fps || 0;
  if (!rate) for (const t of stack.children || []) for (const c of t.children || []) rate = rate || c.source_range?.duration?.rate || 0;
  const desc = { name: j.name || 'OTIO Sequence', fps: rate || fps, width: meta.width || 1920, height: meta.height || 1080, media: [], tracks: [], clips: [], transitions: [], markers: [], skipped: 0, unknownFx: [] };
  const mediaByKey = new Map(); let nv = 0, na = 0, n = 0;
  for (const t of stack.children || []) {
    if (!/^Track\./.test(t.OTIO_SCHEMA || '')) { desc.skipped++; continue; }
    const audio = String(t.kind).toLowerCase() === 'audio'; const id = audio ? `A${++na}` : `V${++nv}`; desc.tracks.push({ id, kind: audio ? 'audio' : 'video' });
    let cursor = 0; let prev = null; let pendingTr = null;
    for (const it of t.children || []) {
      const schema = it.OTIO_SCHEMA || '';
      if (/^Gap\./.test(schema)) { cursor += val(it.source_range?.duration); prev = null; continue; }
      if (/^Transition\./.test(schema)) {
        pendingTr = { track: id, at: cursor, dur: val(it.in_offset) + val(it.out_offset), name: it.metadata?.editorstage?.name || 'Cross Dissolve', kind: audio ? 'audio' : 'video', aId: prev?.id || null, bId: null };
        desc.transitions.push(pendingTr); continue;
      }
      const refs = it.media_references || {}; const ref = refs[it.active_media_reference_key] || refs.DEFAULT_MEDIA || it.media_reference;
      const warp = (it.effects || []).find((e) => /LinearTimeWarp/.test(e.OTIO_SCHEMA || e.effect_name || ''));
      const speed = warp?.time_scalar > 0 ? warp.time_scalar : 1;
      const dur = val(it.source_range?.duration ?? ref?.available_range?.duration) / speed;
      const usable = /^Clip\./.test(schema) && ref && /^(External|Missing)Reference\./.test(ref.OTIO_SCHEMA || '') && !(ref.OTIO_SCHEMA.startsWith('External') && !ref.target_url);
      if (!usable) { desc.skipped++; cursor += dur; prev = null; continue; }
      for (const e of it.effects || []) if (e !== warp) desc.unknownFx.push(e.effect_name || e.name || 'effect');
      const es = it.metadata?.editorstage || {};
      const path = ref.target_url ? urlToPath(ref.target_url) : '';
      const key = path || ref.name || it.name; let m = mediaByKey.get(key);
      if (!m) {
        const rm = ref.metadata?.editorstage || {};
        m = { id: `m${mediaByKey.size + 1}`, name: ref.name || (path ? baseName(path) : it.name), path, kind: rm.kind || (audio ? 'audio' : 'video'), duration: val(ref.available_range?.duration), hasAudio: rm.hasAudio !== false, width: rm.width || 0, height: rm.height || 0 };
        mediaByKey.set(key, m); desc.media.push(m);
      }
      const c = { id: `c${++n}`, track: id, start: cursor, dur, inPoint: val(it.source_range?.start_time), speed, mediaId: m.id, name: it.name || m.name, enabled: it.enabled !== false, linkId: es.linkId || undefined };
      desc.clips.push(c);
      if (es.lone) desc.transitions.push({ track: id, at: es.lone.at / desc.fps, dur: es.lone.dur / desc.fps, name: es.lone.name, kind: audio ? 'audio' : 'video', aId: es.lone.aId ? c.id : null, bId: es.lone.bId ? c.id : null });
      if (pendingTr && !pendingTr.bId) pendingTr.bId = c.id;
      pendingTr = null; prev = c; cursor += dur;
    }
  }
  for (const m of stack.markers || []) desc.markers.push({ time: val(m.marked_range?.start_time), name: m.name || '', comment: m.comment || '', dur: val(m.marked_range?.duration) });
  return desc;
}
