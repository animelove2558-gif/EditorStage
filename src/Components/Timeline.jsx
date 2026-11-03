import React, { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { useStore, set, edit, getState, commitSeq, allSeqs, switchSequence, subscribe } from '../Core/store';
import { getPrefs } from '../Core/prefs';
import { Item } from './MenuBar';
import { clipContextMenu } from '../Core/menus';
import { trimAtEdge } from '../Core/trimMode';
import { remixClip, remixProblem, remixCuts } from '../Services/remixClip';
import { remixSourceAt } from '../Services/remix';
import { run, hasClipboard, addEdit, addMediaToTimeline, addSequenceToTimeline, expandSelection, addTrackTo, TRACK_HEIGHTS } from '../Core/commands';
import { importFiles, mediaById } from '../Services/media';
import VerticalTools from './VerticalTools';
import { EFFECT_MIME, activeEffectDrag, canDropEffect, applyEffectToClips, endEffectDrag } from '../Core/dnd';
import * as ed from '../Core/editing';
import { sequenceHash } from '../Core/previewState';
import { peaksFor } from '../Services/waveform';
import { evalParam, writeParam, moveKey, removeKeyAt } from '../Core/params';
import { sourceAt } from '../Core/clipTime';
import { SPEED_CURVES } from '../Core/clipTime';
import { applySpeedCurveToClips } from './EffectControls';
import { VIDEO_FX } from '../Renderers/fx/videoEffects';
import { AUDIO_FX } from '../Services/audioFx';
import { bandParams, setBandParam, fracOf, bandValue, addBandKey, removeBandKey, dragBandLine, dragBandKey } from '../Core/clipBands';
import { thumbSlots, cachedThumb, requestThumb, frameIndex } from '../Services/thumbs';
import { clipsInBox } from '../Core/marquee';
import { markerColor, clipMarkers } from '../Core/markers';

const FX_DEFS = { video: VIDEO_FX, audio: AUDIO_FX };
/** Live drag of a band: apply(seqClone, event) on a copy of the pre-drag sequence, committed as one undo step on release. */
function bandDrag(label, apply) {
  const before = getState().sequence; let last = null;
  const mv = (ev) => { const s = structuredClone(before); apply(s, ev); last = s; set({ sequence: s }); };
  const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); if (last && JSON.stringify(last) !== JSON.stringify(before)) commitSeq(label, before, last); else if (last) set({ sequence: before }); };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
}

/**
 * Clip keyframe rubber band (Show Clip Keyframes): Volume > Level on audio clips, Opacity on video clips, or another parameter.
 * Drag the line: whole clip (no keyframes) or the segment's two keys; Ctrl+click: add a keyframe; Alt+click a key: delete it;
 * drag a key: time and value. Same keyframes as Effect Controls.
 */
function ParamBand({ clip, pps, h, def }) {
  const BH = Math.max(6, h - 10); const p = def.get(clip); const W = Math.max(2, clip.dur * pps);
  const yOf = (v) => BH * (1 - fracOf(def, v));
  const pts = []; for (let x = 0; x <= W; x += 3) pts.push(`${x},${yOf(bandValue(def, p, x / pps))}`);
  const patch = (s, np) => { const c = s.clips.find((x) => x.id === clip.id); if (c) setBandParam(c, def.key, np); };
  const local = (e) => { const r = e.currentTarget.closest('.clip').getBoundingClientRect(); return (e.clientX - r.left) / pps; };
  const name = `${def.group} > ${def.label}`;
  const downLine = (e) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    const t = local(e);
    if (e.ctrlKey || e.metaKey) { edit(`Add ${def.label} Keyframe`, ({ seq }) => patch(seq, addBandKey(def, p, t))); return; }
    const y0 = e.clientY;
    bandDrag(name, (s, ev) => patch(s, dragBandLine(def, p, t, -(ev.clientY - y0) / BH)));
  };
  const downKey = (e, k) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    if (e.altKey) { edit(`Delete ${def.label} Keyframe`, ({ seq }) => patch(seq, removeBandKey(p, k.t))); return; }
    const x0 = e.clientX, y0 = e.clientY; const f0 = fracOf(def, def.comp != null ? k.v[def.comp] : k.v);
    bandDrag(`Move ${def.label} Keyframe`, (s, ev) => patch(s, dragBandKey(def, p, k.t, k.t + (ev.clientX - x0) / pps, f0 - (ev.clientY - y0) / BH, clip.dur)));
  };
  const kv = (k) => (def.comp != null ? k.v[def.comp] : k.v);
  return (
    <svg className="paramband" width={W} height={BH} style={{ top: 3 }} onMouseDown={(e) => e.stopPropagation()}>
      <polyline points={pts.join(' ')} className="pb-line" onMouseDown={downLine}><title>{`${name} · drag: change · Ctrl+click: add keyframe`}</title></polyline>
      {(p.keys || []).map((k) => <rect key={k.t} x={k.t * pps - 4} y={yOf(kv(k)) - 4} width="8" height="8" className="pb-key" transform={`rotate(45 ${k.t * pps} ${yOf(kv(k))})`} onMouseDown={(e) => downKey(e, k)}><title>{`${def.fmt(kv(k))} · drag to move · Alt+click to delete`}</title></rect>)}
      <text x={W - 3} y={BH - 2} className="pb-label" textAnchor="end">{`${def.label} ${def.fmt(bandValue(def, p, 0))}`}</text>
    </svg>
  );
}

/** Video thumbnails on a clip (View > Video Thumbnails), decoded by FFmpeg at the clip's real source frames. */
function Thumbs({ clip, pps, h, mode, fps }) {
  const media = useStore((s) => s.media.find((m) => m.id === clip.mediaId));
  const [urls, setUrls] = useState({});
  const th = Math.max(8, h - 8);
  const ok = media && media.status === 'ready' && media.kind !== 'audio' && !clip.asAudio && media.synthetic?.type !== 'adjustment';
  const syn = media?.synthetic; const aw = syn ? syn.width : media?.width, ah = syn ? syn.height : media?.height;
  const mfps = media?.fps || fps;
  const slots = ok ? thumbSlots(clip, { W: clip.dur * pps, tw: th * (aw && ah ? aw / ah : 16 / 9), pps, mode, fps: mfps, mediaDur: media.kind === 'image' ? Infinity : media.duration }) : [];
  const keyOf = (s) => (media.kind === 'image' ? 0 : frameIndex(s.src, media.fps || 30));
  const sig = ok ? `${media.id}|${media.rev || 0}|${th}|${slots.map(keyOf).join(',')}` : '';
  useEffect(() => {
    if (!ok) return undefined; let dead = false;
    for (const s of slots) {
      const k = keyOf(s); if (urls[k]) continue;
      const c = cachedThumb(media, s.src, th);
      if (c) setUrls((u) => ({ ...u, [k]: c }));
      else requestThumb(media, s.src, th).then((u) => { if (!dead && u) setUrls((x) => ({ ...x, [k]: u })); });
    }
    return () => { dead = true; };
  }, [sig]);
  if (mode === 'none') return null;
  if (!ok) { const icon = clip.nestId ? '🎬' : clip.mogrt ? '✦' : clip.graphic ? 'T' : null; return icon ? <span className="thumb-icon">{icon}</span> : null; }
  return <div className="thumbs">{slots.map((s, i) => { const u = urls[keyOf(s)]; return u ? <img key={i} src={u} style={{ left: s.x, width: s.w, height: th }} alt="" /> : null; })}</div>;
}

export const TRACK_H = TRACK_HEIGHTS.default;
/** Height of a track row (track.h is stored in the project; older projects have none). */
export const trackH = (t) => Math.min(TRACK_HEIGHTS.max, Math.max(TRACK_HEIGHTS.min, t?.h || TRACK_H));
const RULER_H = 22;
const EDGE = 7;
const fmt = (t, fps) => {
  const f = Math.round(t * fps);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(f / fps / 3600))}:${p(Math.floor(f / fps / 60) % 60)}:${p(Math.floor(f / fps) % 60)}:${p(f % fps)}`;
};
export { fmt as timecode };

const mdurOf = (c) => {
  const m = c.mediaId && getState().media.find((x) => x.id === c.mediaId);
  return !m || m.kind === 'image' ? Infinity : m.duration;
};

function Waveform({ clip, width, height = 30 }) {
  const ref = useRef(null); const media = useStore((s) => s.media.find((m) => m.id === clip.mediaId));
  useEffect(() => {
    if (!media || media.kind !== 'audio' || !ref.current) return; let dead = false;
    peaksFor(media).then((pk) => {
      if (dead || !pk || !ref.current) return; const c = ref.current; const W = Math.max(2, Math.min(4000, Math.round(width))), H = Math.max(8, Math.round(height)); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.clearRect(0, 0, W, H); g.fillStyle = '#0b3d17cc';
      for (let x = 0; x < W; x++) { const u = (x / W) * clip.dur; const t = clip.remix ? remixSourceAt(clip.remix.segments, u) : sourceAt(clip, clip.start + u); const v = pk.out[Math.min(pk.out.length - 1, Math.max(0, Math.floor(t * pk.per)))] || 0; const h = Math.max(1, v * H); g.fillRect(x, (H - h) / 2, 1, h); }
    });
    return () => { dead = true; };
  }, [media, width, height, clip.inPoint, clip.dur, clip.speed, clip.reverse, JSON.stringify(clip.timeRemap), clip.remix]);
  return media?.kind === 'audio' ? <canvas ref={ref} className="wave" /> : null;
}

// ---- Time Remapping rubber band on the clip (Show Speed Keyframes): log scale 10% (bottom) .. 1000% (top) ----
function SpeedBand({ clip, pps, h = TRACK_H }) {
  const BAND_H = h - 4;
  const yOfSpeed = (v) => BAND_H * (1 - (Math.log10(Math.min(1000, Math.max(10, v))) - 1) / 2);
  const speedOfY = (y) => Math.pow(10, 1 + 2 * (1 - Math.min(BAND_H, Math.max(0, y)) / BAND_H));
  const p = clip.timeRemap?.speed || { v: 100, keys: null }; const W = Math.max(2, clip.dur * pps);
  const pts = []; for (let x = 0; x <= W; x += 3) pts.push(`${x},${yOfSpeed(evalParam(p, x / pps))}`);
  const commit = (np, label) => edit(label, ({ seq }) => { const c = seq.clips.find((x) => x.id === clip.id); c.timeRemap = { ...(c.timeRemap || {}), speed: np }; c.speedCurve = undefined; }, { coalesce: `speedband:${clip.id}:${label}` });
  const local = (e) => { const r = e.currentTarget.closest('.clip').getBoundingClientRect(); return [(e.clientX - r.left) / pps, e.clientY - r.top - 2]; };
  const drag = (mv) => { const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); };
  const downLine = (e) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    const [t, y] = local(e);
    if (e.ctrlKey || e.metaKey) { commit(writeParam(p.keys ? p : { v: p.v, keys: [] }, evalParam(p, t), t), 'Add Speed Keyframe'); return; }
    const ks = p.keys || []; const i = ks.findIndex((k) => k.t > t); // segment [i-1, i]
    const affected = !ks.length ? [] : i < 0 ? [ks.length - 1] : i === 0 ? [0] : [i - 1, i];
    const y0 = y; const base = p;
    drag((ev) => {
      const r = e.target.closest('.clip').getBoundingClientRect(); const f = speedOfY(yOfSpeed(evalParam(base, t)) + (ev.clientY - r.top - 2 - y0)) / Math.max(1e-6, evalParam(base, t));
      const np = !ks.length ? { ...base, v: Math.min(1000, Math.max(10, base.v * f)) } : { ...base, keys: base.keys.map((k, j) => (affected.includes(j) ? { ...k, v: Math.min(1000, Math.max(10, k.v * f)) } : k)) };
      commit(np, 'Time Remapping Speed');
    });
  };
  const downKey = (e, k) => {
    e.stopPropagation(); e.preventDefault();
    if (e.altKey) { commit(removeKeyAt(p, k.t), 'Delete Speed Keyframe'); return; }
    const base = p; const x0 = e.clientX;
    drag((ev) => commit(moveKey(base, k.t, Math.min(clip.dur, Math.max(0, k.t + (ev.clientX - x0) / pps))), 'Move Speed Keyframe'));
  };
  return (
    <svg className="speedband" width={W} height={BAND_H} onMouseDown={(e) => e.stopPropagation()}>
      <line x1="0" x2={W} y1={yOfSpeed(100)} y2={yOfSpeed(100)} className="sb-100" />
      <polyline points={pts.join(' ')} className="sb-line" onMouseDown={downLine}><title>Drag: speed · Ctrl+click: add keyframe</title></polyline>
      {(p.keys || []).map((k) => <rect key={k.t} x={k.t * pps - 4} y={yOfSpeed(k.v) - 4} width="8" height="8" className="sb-key" transform={`rotate(45 ${k.t * pps} ${yOfSpeed(k.v)})`} onMouseDown={(e) => downKey(e, k)}><title>{`${Math.round(k.v)}% · drag to move · Alt+click to delete`}</title></rect>)}
      <text x="3" y="9" className="sb-label">{Math.round(evalParam(p, 0))}%</text>
    </svg>
  );
}

/** Right-click menu of a track header: the commands of that track. */
function TrackMenu({ seq, id, close }) {
  const t = seq.tracks.find((x) => x.id === id); if (!t) return null;
  const same = seq.tracks.filter((x) => x.kind === t.kind); const i = same.indexOf(t);
  const kindName = t.kind === 'video' ? 'Video' : t.kind === 'audio' ? 'Audio' : 'Caption';
  const item = (label, cmd, args = [], { on, disabled } = {}) => (
    <div className={`menu-item ${disabled ? 'disabled' : ''}`} onClick={() => { if (disabled) return; close(); run(cmd, ...args); }}><span>{on ? '✓ ' : ''}{label}</span></div>);
  const h = trackH(t);
  return <>
    {item('Rename…', 'track.rename', [id])}
    <div className="menu-sep" />
    {item('Move Track Up', 'track.moveUp', [id], { disabled: i <= 0 })}
    {item('Move Track Down', 'track.moveDown', [id], { disabled: i >= same.length - 1 })}
    <div className="menu-sep" />
    {item(`Add ${kindName} Track Above`, 'track.addAbove', [id])}
    {item(`Add ${kindName} Track Below`, 'track.addBelow', [id])}
    {item('Delete Track', 'track.delete', [id], { disabled: !ed.deletableTracks(seq, [id]).length })}
    {item('Delete Empty Tracks', 'timeline.deleteEmptyTracks', [], { disabled: !ed.emptyTracks(seq).length })}
    <div className="menu-sep" />
    {t.kind !== 'caption' && item('Target Track', 'track.target', [id], { on: ed.isTargeted(seq, t) })}
    {t.kind !== 'audio' && item('Toggle Track Output', 'track.toggleOutput', [id], { on: !t.hidden })}
    {item('Lock Track', 'track.lock', [id], { on: t.locked })}
    {t.kind !== 'caption' && item('Sync Lock', 'track.sync', [id], { on: t.sync })}
    {t.kind === 'audio' && item('Mute Track', 'track.mute', [id], { on: t.muted })}
    {t.kind === 'audio' && item('Solo Track', 'track.solo', [id], { on: t.solo })}    <div className="menu-sep" />
    <div className="menu-item has-sub"><span>Track Height</span><span>▸</span>
      <div className="menu-dropdown sub">
        {item('Minimized', 'track.height', [id, TRACK_HEIGHTS.min], { on: h === TRACK_HEIGHTS.min })}
        {item('Default', 'track.height', [id, TRACK_HEIGHTS.default], { on: h === TRACK_HEIGHTS.default })}
        {item('Medium', 'track.height', [id, TRACK_HEIGHTS.medium], { on: h === TRACK_HEIGHTS.medium })}
        {item('Large', 'track.height', [id, TRACK_HEIGHTS.large], { on: h === TRACK_HEIGHTS.large })}
        <div className="menu-sep" />
        {item('Expand All Tracks', 'timeline.expandTracks')}
        {item('Minimize All Tracks', 'timeline.minimizeTracks')}
      </div>
    </div>
  </>;
}

// playhead-driven bits subscribe on their own, so playback does not re-render every clip of the timeline 60 times a second
function PlayheadLine({ pps }) { const t = useStore((s) => s.playhead); return <div className="playhead" style={{ left: t * pps }} />; }
function Timecode({ fps }) { const t = useStore((s) => s.playhead); return <span className="timecode">{fmt(t, fps)}</span>; }

const MODE_LABEL = { overwrite: 'Move Clip', insert: 'Insert Clip', rearrange: 'Rearrange Clip', duplicate: 'Duplicate Clip' };
const MODE_TEXT = { overwrite: 'Overwrite', insert: '▶ Insert (Ctrl)', rearrange: '⇄ Rearrange (Ctrl+Alt)', duplicate: '+ Duplicate (Alt)' };
const NEW_ROW_H = 22;
/** Track rows plus the two "drop here for a new track" rows (above the top video track, below the last audio track). */
function trackRows(tracks) {
  const rows = []; let v = false;
  for (const t of tracks) { if (t.kind !== 'caption' && !v) { rows.push({ newKind: 'video', h: NEW_ROW_H }); v = true; } rows.push({ track: t, h: trackH(t) }); }
  if (!v) rows.push({ newKind: 'video', h: NEW_ROW_H });
  rows.push({ newKind: 'audio', h: NEW_ROW_H });
  return rows;
}

export default function Timeline() {
  const seq = useStore((s) => s.sequence);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const toggles = useStore((s) => s.toggles);
  const pps = useStore((s) => s.pps);
  const speedBands = useStore((s) => s.speedBands) || {};
  const clipBands = useStore((s) => s.clipBands) || {}; // clip id -> band param key (Show Clip Keyframes)
  const thumbMode = useStore((s) => s.thumbMode) || 'head';
  const inPoint = useStore((s) => s.inPoint);
  const outPoint = useStore((s) => s.outPoint);
  const previews = useStore((s) => s.previews); useStore((s) => s.sequence);
  const selGap = useStore((s) => s.selectedGap); const selMarker = useStore((s) => s.selectedMarker);
  const selTr = useStore((s) => s.selectedTransition); const recording = useStore((s) => s.recording); const trimMode = useStore((s) => s.trimMode); const [remixGhost, setRemixGhost] = useState(null); // Remix Tool: { id, track, start, dur, label }
  const [menu, setMenu] = useState(null);
  // Keep the context menu inside the window: open it upward when it would run off the bottom, and scroll it when even
  // the whole window height is too short
  const menuRef = useRef(null);
  useLayoutEffect(() => {
    const el = menuRef.current; if (!menu || !el) return;
    const pad = 4, room = window.innerHeight - pad * 2;
    el.style.maxHeight = ''; el.style.overflowY = '';
    const h = el.offsetHeight;
    if (h > room) { el.style.maxHeight = room + 'px'; el.style.overflowY = 'auto'; }
    el.style.top = Math.max(pad, Math.min(menu.y, window.innerHeight - pad - Math.min(h, room))) + 'px';
    el.style.left = Math.max(pad, Math.min(menu.x, window.innerWidth - pad - el.offsetWidth)) + 'px';
  }, [menu]);
  const [dropHover, setDropHover] = useState(null); // { id, ok, edge }
  const [newHot, setNewHot] = useState(null); // 'video' | 'audio' while something is dragged over a new-track row
  const [reach, setReach] = useState(0); // seconds the user has scrolled to: the timeline keeps growing past it
  // Preferences > Timeline Playback Auto-Scrolling while playing: Page Scroll (jump a page when the playhead leaves the view),
  // Smooth Scroll (the playhead stays in the middle), No Scroll
  useEffect(() => subscribe(() => {
    const st = getState(); const el = ref.current; if (!st.playing || !el) return;
    const mode = getPrefs().autoScroll; const x = st.playhead * (st.pps || pps);
    if (mode === 'smooth') el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
    else if (mode === 'page' && (x > el.scrollLeft + el.clientWidth - 16 || x < el.scrollLeft)) el.scrollLeft = Math.max(0, x - 16);
  }), [pps]);
  const [dragInfo, setDragInfo] = useState(null); // { mode, at, x, y } while clips or project items are dragged: the mode badge / insert line
  const [trackDrag, setTrackDrag] = useState(null); // { id, over } while a track header is dragged to reorder
  const [marquee, setMarquee] = useState(null); // { left, top, width, height } in content pixels while a selection box is dragged
  const ref = useRef(null); const headsRef = useRef(null);
  const rows = trackRows(seq.tracks);

  useEffect(() => {
    const off = () => setMenu(null);
    const endDrag = () => setDragInfo(null);
    window.addEventListener('click', off); window.addEventListener('dragend', endDrag); window.addEventListener('drop', endDrag);
    return () => { window.removeEventListener('click', off); window.removeEventListener('dragend', endDrag); window.removeEventListener('drop', endDrag); };
  }, []);

  /** snap t to clip edges, the playhead and markers of `s` (a drag passes the sequence as it was before the drag) */
  const snap = (t, ignoreIds = [], s = getState().sequence) => {
    if (!toggles.snap) return t;
    const pts = [0, getState().playhead, ...s.clips.filter((c) => !ignoreIds.includes(c.id)).flatMap((c) => [c.start, c.start + c.dur]), ...s.markers.map((m) => m.time)];
    const near = pts.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);
    return Math.abs(near - t) * pps < 8 ? near : t;
  };
  const timeAt = (e) => Math.max(0, (e.clientX - ref.current.getBoundingClientRect().left + ref.current.scrollLeft) / pps);
  /** track id under the pointer, or 'new:video' / 'new:audio' over the new-track rows */
  const trackAt = (e) => {
    const rs = trackRows(getState().sequence.tracks);
    let y = e.clientY - ref.current.getBoundingClientRect().top + ref.current.scrollTop - RULER_H;
    let row = rs[rs.length - 1];
    if (y < 0) row = rs[0];
    else for (const r of rs) { if (y < r.h) { row = r; break; } y -= r.h; }
    return row.track ? row.track.id : `new:${row.newKind}`;
  };
  /** while dragging near the left/right edge, scroll the timeline (it grows on the right as it scrolls) */
  const autoScroll = (ev) => {
    const el = ref.current; if (!el) return; const r = el.getBoundingClientRect();
    if (ev.clientX > r.right - 40) el.scrollLeft += Math.min(40, ev.clientX - (r.right - 40));
    else if (ev.clientX < r.left + 40) el.scrollLeft -= Math.min(40, r.left + 40 - ev.clientX);
  };
  const onScroll = () => {
    const el = ref.current; if (!el) return;
    if (headsRef.current) headsRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    const endSec = (el.scrollLeft + el.clientWidth) / pps, viewSec = el.clientWidth / pps;
    if (endSec > totalSec - viewSec * 0.25) setReach(endSec + viewSec);
  };
  /** create the track a new-track row stands for (own undo step); returns its id */
  const createTrack = (kind) => { let id = null; edit(`Add ${kind} Track`, ({ seq: s }) => { id = addTrackTo(s, kind); }); return id; };

  const scrub = (e) => {
    const move = (ev) => set({ playhead: snap(timeAt(ev)) });
    move(e);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  /**
   * Generic drag gesture: apply(seqClone, dt, event) mutates a clone of the pre-drag sequence; committed as one undo step
   * (label may be a function, read when the mouse is released). Pressing / releasing Ctrl or Alt re-applies at once.
   * done(changed) runs after the commit.
   */
  const gesture = (e, label, apply, done, minPx = 0) => {
    const before = getState().sequence, x0 = e.clientX, y0 = e.clientY, sl0 = ref.current.scrollLeft; let last = null, lastEv = null;
    const move = (ev) => {
      if (!last && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < minPx) return; // a click, not a drag yet
      lastEv = ev; autoScroll(ev);
      const s = structuredClone(before); apply(s, (ev.clientX - x0 + ref.current.scrollLeft - sl0) / pps, ev); ed.fixTransitions(s); last = s; set({ sequence: s });
    };
    const key = (ev) => {
      if (!lastEv || !['Control', 'Alt', 'Meta'].includes(ev.key)) return;
      ev.preventDefault(); ev.stopPropagation();
      move({ clientX: lastEv.clientX, clientY: lastEv.clientY, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey, shiftKey: ev.shiftKey });
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true);
      const changed = !!last && JSON.stringify(last) !== JSON.stringify(before);
      if (changed) commitSeq(typeof label === 'function' ? label() : label, before, last); else if (last) set({ sequence: before });
      done?.(changed, !!last);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
  };

  /**
   * How many tracks (in numbering order, see ed.trackShiftMap) a dragged clip moves: from its own track to the track of the same
   * kind under the pointer. Over the "new track" row of its kind: one past the last track (a track is created). Over tracks of
   * another kind it stays at the nearest end of its own kind (video under the pointer in the caption area: the top video track).
   */
  const trackDelta = (s, c, ev) => {
    const kind = ed.trackKind(s, c.track); const order = ed.kindTracks(s, kind).map((t) => t.id); const i0 = order.indexOf(c.track);
    const tr = trackAt(ev); let i1;
    if (tr === `new:${kind}`) i1 = order.length;
    else {
      const live = getState().sequence; const lt = live.tracks.find((t) => t.id === tr); // the live sequence also has tracks made earlier in this drag
      if (lt?.kind === kind) i1 = ed.kindTracks(live, kind).findIndex((t) => t.id === tr);
      else if (kind === 'video' && lt?.kind === 'caption') i1 = order.length - 1;
      else i1 = 0;
    }
    return i1 - i0;
  };
  const dragMode = (ev) => (ev.ctrlKey || ev.metaKey ? (ev.altKey ? 'rearrange' : 'insert') : ev.altKey ? 'duplicate' : 'overwrite');

  const clipDown = (e, c) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const track = seq.tracks.find((t) => t.id === c.track);
    if (track?.locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = e.clientX - rect.left < EDGE ? 'start' : rect.right - e.clientX < EDGE ? 'end' : null;
    // Trim Mode: Ctrl+click an edit point adds it to the trimmed edits (or removes it)
    if (trimMode && e.ctrlKey && edge) { trimAtEdge(c.id, edge, tool, true); return; }
    set({ selectedTransition: null, selectedGap: null });
    if (tool === 'razor') { addEdit(snap(timeAt(e)), c.id); return; }

    // a clip already in the selection drags the selection as it is (a picture selected alone with Alt+click stays alone);
    // a clip not selected yet brings its linked / grouped partners (Linked Selection)
    const own = expandSelection(seq, [c.id], toggles.linked);
    const sel = e.shiftKey ? [...new Set([...selection, ...own])] : selection.includes(c.id) ? selection : own;
    const grp = tool === 'trackForward' ? expandSelection(seq, seq.clips.filter((x) => x.track === c.track && x.start >= c.start).map((x) => x.id), toggles.linked)
      : tool === 'trackBackward' ? expandSelection(seq, seq.clips.filter((x) => x.track === c.track && x.start <= c.start).map((x) => x.id), toggles.linked) : sel;
    set({ selection: grp });
    // Alt+click without dragging (Premiere): select only this part, Shift+Alt+click adds / removes one part
    const altPick = () => set({ selection: e.shiftKey ? (selection.includes(c.id) ? selection.filter((id) => id !== c.id) : [...selection, c.id]) : [c.id] });
    const pids = expandSelection(seq, [c.id], toggles.linked);

    const neighbors = ed.onTrack(seq, c.track);
    const left = neighbors.find((x) => Math.abs(ed.clipEnd(x) - c.start) < 0.03 && x.id !== c.id);
    const right = neighbors.find((x) => Math.abs(x.start - ed.clipEnd(c)) < 0.03 && x.id !== c.id);
    const ign = [c.id];

    if (tool === 'selection') {
      if (edge) return gesture(e, 'Trim Clip', (s, dt) => { const tt = snap((edge === 'start' ? c.start : ed.clipEnd(c)) + dt, pids); pids.forEach((id) => ed.trimClip(s, mdurOf, id, edge, tt)); });
      // plain drag = overwrite, Ctrl = insert, Ctrl+Alt = rearrange, Alt = duplicate (Premiere). The whole group moves in time;
      // only clips of the grabbed kind change track (dragging the picture up leaves its linked sound on its audio track)
      let mode = 'overwrite', placed = grp; const kind = ed.trackKind(seq, c.track);
      const g0 = Math.min(...seq.clips.filter((x) => grp.includes(x.id)).map((x) => x.start));
      return gesture(e, () => MODE_LABEL[mode], (s, dt, ev) => {
        mode = dragMode(ev);
        const d = Math.max(-g0, snap(c.start + dt, grp, seq) - c.start);
        placed = ed.dragClips(s, grp, d, ed.trackShiftMap(s, grp, trackDelta(s, c, ev), [kind]), mode);
        document.body.dataset.dragMode = mode;
        setDragInfo({ mode, at: g0 + d, x: ev.clientX, y: ev.clientY });
      }, (changed, moved) => {
        delete document.body.dataset.dragMode; setDragInfo(null);
        if (changed) set({ selection: placed });
        else if (!moved && e.altKey) altPick();
      }, 4);
    }
    if (tool === 'ripple' && edge) return gesture(e, 'Ripple Trim', (s, dt) => { const tt = snap((edge === 'start' ? c.start : ed.clipEnd(c)) + dt, pids); ed.trimClip(s, mdurOf, c.id, edge, tt, true); pids.filter((id) => id !== c.id).forEach((id) => ed.trimClip(s, mdurOf, id, edge, tt)); });
    if (tool === 'rolling' && edge) {
      const a = edge === 'start' ? left : c, b = edge === 'start' ? c : right;
      if (a && b) return gesture(e, 'Rolling Edit', (s, dt) => ed.rollEdit(s, mdurOf, a.id, b.id, snap(ed.clipEnd(a) + dt, [a.id, b.id])));
    }
    // Remix Tool: drag the end of a music clip to the length wanted; on release the music is re-edited to about that length
    if (tool === 'remix' && edge === 'end') {
      const why = remixProblem(seq, c); if (why) { set((s) => ({ log: [...s.log.slice(-49), `Remix: ${why}`] })); return; }
      e.preventDefault(); const x0 = e.clientX; let dur = c.dur;
      const mv = (ev) => { dur = Math.max(1, c.dur + (ev.clientX - x0) / pps); setRemixGhost({ id: c.id, track: c.track, start: c.start, dur, label: `${dur.toFixed(2)} s` }); };
      const up = async () => {
        window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
        if (Math.abs(dur - c.dur) < 1 / seq.fps) { setRemixGhost(null); return; }
        try { await remixClip(c.id, dur, {}, (p, label) => setRemixGhost({ id: c.id, track: c.track, start: c.start, dur, label: `${label} ${Math.round(p * 100)}%` })); }
        catch (err) { set((s) => ({ log: [...s.log.slice(-49), `Remix: ${err.message || err}`] })); }
        finally { setRemixGhost(null); }
      };
      window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); return;
    }
    if (tool === 'rate' && edge === 'end') return gesture(e, 'Rate Stretch', (s, dt) => pids.forEach((id) => ed.rateStretch(s, id, snap(ed.clipEnd(c) + dt, ign))));
    if (tool === 'slip') return gesture(e, 'Slip', (s, dt) => pids.forEach((id) => ed.slip(s, mdurOf, id, -dt)));
    if (tool === 'slide') return gesture(e, 'Slide', (s, dt) => { const d = snap(c.start + dt, ign) - c.start; pids.forEach((id) => ed.slide(s, mdurOf, id, d)); });
  };

  /** ruler marker: click selects it, drag moves it (snapping to clips / playhead / other markers), double-click opens the Marker dialog */
  const markerDown = (e, m) => {
    e.stopPropagation(); if (e.button !== 0) return; set({ selectedMarker: m.id });
    const before = getState().sequence; const others = { ...before, markers: before.markers.filter((x) => x.id !== m.id) };
    gesture(e, 'Move Marker', (s, dt) => { const k = s.markers.find((x) => x.id === m.id); if (k) k.time = Math.max(0, snap(m.time + dt, [], others)); }, null, 3);
  };
  const openMarker = (id) => run('marker.edit', id);
  const clipMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const near = e.clientX - r.left < EDGE || r.right - e.clientX < EDGE;
    e.currentTarget.style.cursor = tool === 'razor' ? 'crosshair' : near && ['selection', 'ripple', 'rolling', 'rate', 'remix'].includes(tool) ? 'ew-resize' : tool === 'slip' || tool === 'slide' ? 'col-resize' : 'default';
  };

  const clipDragOver = (e, c, kind) => {
    if (!e.dataTransfer.types.includes(EFFECT_MIME)) return;
    const ok = canDropEffect(activeEffectDrag(), kind) && !seq.tracks.find((t) => t.id === c.track)?.locked;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
    const r = e.currentTarget.getBoundingClientRect(); const edge = e.clientX < r.left + r.width / 2 ? 'start' : 'end';
    if (dropHover?.id !== c.id || dropHover.ok !== ok || dropHover.edge !== edge) setDropHover({ id: c.id, ok, edge });
  };
  const clipDrop = (e, c, kind) => {
    if (!e.dataTransfer.types.includes(EFFECT_MIME)) return;
    e.preventDefault(); e.stopPropagation(); setDropHover(null);
    let p = null; try { p = JSON.parse(e.dataTransfer.getData(EFFECT_MIME)); } catch { p = activeEffectDrag(); }
    endEffectDrag();
    if (!canDropEffect(p, kind)) { set((s) => ({ log: [...s.log.slice(-49), `Cannot drop ${p?.effectName} on a ${kind} clip`] })); return; }
    const r = e.currentTarget.getBoundingClientRect(); const edge = e.clientX < r.left + r.width / 2 ? 'start' : 'end';
    applyEffectToClips([c.id], p, edge);
    set({ selection: [c.id], selectedTransition: null });
  };

  /** a project item dragged over the tracks: Ctrl held = Insert (shown by the badge and the insert line) */
  const itemDragOver = (e) => {
    if (e.dataTransfer.types.includes(EFFECT_MIME)) return;
    const mode = e.ctrlKey || e.metaKey ? 'insert' : 'overwrite'; const at = snap(timeAt(e));
    if (!dragInfo || dragInfo.mode !== mode || dragInfo.at !== at || Math.abs(dragInfo.x - e.clientX) + Math.abs(dragInfo.y - e.clientY) > 3) setDragInfo({ mode, at, x: e.clientX, y: e.clientY });
  };
  const onDrop = async (e, track) => {
    e.preventDefault(); setNewHot(null); setDragInfo(null);
    const at = snap(timeAt(e)); const insert = e.ctrlKey || e.metaKey; // Ctrl on drop = Insert (pushes what follows, sync lock)
    if (track.newKind) { // new-track row: make the track, then drop onto it
      const mediaKind = e.dataTransfer.getData('media-id') ? mediaById(e.dataTransfer.getData('media-id'))?.kind : null;
      const kind = mediaKind === 'audio' ? 'audio' : e.dataTransfer.getData('media-id') || e.dataTransfer.getData('mogrt-id') || e.dataTransfer.getData('seq-id') ? 'video' : track.newKind;
      track = { id: createTrack(kind) };
    }
    const mid = e.dataTransfer.getData('mogrt-id'); if (mid) { import('./MogrtPanel').then((m) => m.addMogrtToTimeline(mid, at, track.id)); return; }
    const sid = e.dataTransfer.getData('seq-id'); if (sid) { addSequenceToTimeline(sid, at, track.id, { insert }); return; }
    const id = e.dataTransfer.getData('media-id');
    if (id) { addMediaToTimeline(mediaById(id), at, track.id, { insert }); return; }
    if (e.dataTransfer.files.length) {
      const items = await importFiles(e.dataTransfer.files, (m) => set((s) => ({ log: [...s.log.slice(-49), m] })));
      let t = at;
      for (const m of items) { addMediaToTimeline(m, t, track.id, { insert }); t += m.duration; }
    }
  };

  /** drag a track header up / down over another track of the same kind to reorder (one undo step, ids are renumbered) */
  const headDown = (e, t) => {
    if (e.button !== 0 || e.target.closest('button, .tl-head-resize')) return;
    const y0 = e.clientY; let over = null;
    const mv = (ev) => {
      if (Math.abs(ev.clientY - y0) < 4 && !over) return;
      const id = trackAt(ev); const tr = getState().sequence.tracks.find((x) => x.id === id);
      over = tr && tr.kind === t.kind && tr.id !== t.id ? tr.id : null;
      setTrackDrag({ id: t.id, over });
    };
    const up = () => {
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); setTrackDrag(null);
      if (over) run('track.moveTo', t.id, over);
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  /** drag the bottom edge of a track header to change the track height (stored in the project as track.h, one undo step) */
  const resizeDown = (e, t) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    const before = getState().sequence, y0 = e.clientY, h0 = trackH(t); let last = null;
    const mv = (ev) => {
      const s = structuredClone(before); const tr = s.tracks.find((x) => x.id === t.id);
      const h = Math.round(Math.min(TRACK_HEIGHTS.max, Math.max(TRACK_HEIGHTS.min, h0 + ev.clientY - y0)));
      tr.h = h === TRACK_H ? undefined : h; last = s; set({ sequence: s });
    };
    const up = () => {
      window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
      if (last && trackH(last.tracks.find((x) => x.id === t.id)) !== h0) commitSeq('Track Height', before, last); else if (last) set({ sequence: before });
    };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };

  const onWheel = (e) => { if (e.ctrlKey) { e.preventDefault(); set((s) => ({ pps: Math.min(400, Math.max(4, s.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) })); } };
  const handScroll = (e) => {
    if (tool !== 'hand' || e.button !== 0) return;
    const sx = e.clientX, st = ref.current.scrollLeft;
    const mv = (ev) => { ref.current.scrollLeft = st - (ev.clientX - sx); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  /**
   * Selection tool, mouse down on an empty spot of the tracks: drag a box to select every clip it touches (see Core/marquee).
   * Shift adds to the selection; linked clips come along when Linked Selection is on. A click without dragging deselects.
   */
  const marqueeDown = (e) => {
    if (tool !== 'selection' || e.button !== 0 || e.target.closest('.tl-ruler, .clip, .tl-trans')) return;
    const el = ref.current; const base = e.shiftKey ? getState().selection : [];
    const at = (ev) => { const r = el.getBoundingClientRect(); return { x: Math.max(0, ev.clientX - r.left + el.scrollLeft), y: Math.max(RULER_H, ev.clientY - r.top + el.scrollTop) }; };
    const p0 = at(e); let dragging = false;
    if (!e.shiftKey) set({ selection: [], selectedTransition: null });
    const move = (ev) => {
      const p = at(ev);
      if (!dragging && Math.abs(p.x - p0.x) + Math.abs(p.y - p0.y) < 4) return;
      dragging = true; ev.preventDefault(); autoScroll(ev);
      const s = getState().sequence;
      const rs = trackRows(s.tracks).map((r) => ({ trackId: r.track?.id || null, h: r.h }));
      const ids = clipsInBox(s, rs, { x0: p0.x, y0: p0.y - RULER_H, x1: p.x, y1: p.y - RULER_H }, getState().pps);
      set({ selection: expandSelection(s, [...new Set([...base, ...ids])], getState().toggles.linked), selectedTransition: null });
      setMarquee({ left: Math.min(p0.x, p.x), top: Math.min(p0.y, p.y), width: Math.abs(p.x - p0.x), height: Math.abs(p.y - p0.y) });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setMarquee(null); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const zoomClick = (e) => { if (tool === 'zoom') set((s) => ({ pps: Math.min(400, Math.max(4, s.pps * (e.altKey ? 1 / 1.4 : 1.4))) })); };

  const totalSec = Math.max(seq.duration, ed.sequenceEnd(seq) + 30, 60, reach);
  const width = totalSec * pps + 400;
  const tcStep = pps > 120 ? 1 : pps > 40 ? 5 : pps > 15 ? 10 : 30;
  const seqs = useStore((s) => s.seqs); const activeId = seq.id;
  const all = { ...seqs, [activeId]: seq };
  return (
    <div className="timeline" onMouseDownCapture={() => { if (getState().activeMonitor === 'source') set({ activeMonitor: 'program' }); }}>
      <div className="seqtabs">{Object.values(all).map((q) => <button key={q.id} className={q.id === activeId ? 'active' : ''} onClick={() => switchSequence(q.id)}>{q.name}</button>)}<button title="New Sequence" onClick={() => run('file.newSequence')}>+</button></div>
      <div className="tl-top">
        <Timecode fps={seq.fps} />
        <button className={toggles.snap ? 'active' : ''} title="Snap in Timeline (S)" onClick={() => run('seq.snap')}>🧲</button>
        <button className={toggles.linked ? 'active' : ''} title="Linked Selection" onClick={() => run('seq.linked')}>🔗</button>
        <button title="Add Marker (M)" onClick={() => run('marker.add')}>◆</button>
        <button title="Add Caption Track" onClick={() => run('timeline.addCaptionTrack')}>CC</button>
        <button title="Zoom to fit sequence (\)" onClick={() => run('seq.zoomFit')}>⇔</button>
        <button title="Expand All Tracks" onClick={() => run('timeline.expandTracks')}>⇕</button>
        <button title="Minimize All Tracks" onClick={() => run('timeline.minimizeTracks')}>═</button>
        <span className="grow" />
        <button title="Toggle Right Panel Rail" onClick={() => run('view.toggleRail')}>▤</button>
        <input type="range" min="4" max="400" value={pps} onChange={(e) => set({ pps: +e.target.value })} />
      </div>
      <div className="tl-main">
        <VerticalTools />
        <div className="tl-body">
          <div className="tl-heads">
            <div className="tl-ruler-head" />
            <div className="tl-heads-inner" ref={headsRef}>
            {rows.map(({ track: t, newKind }) => (!t
              ? <div key={'new-' + newKind} className={`tl-newtrack ${newHot === newKind ? 'hot' : ''}`}><button title={`Add ${newKind} track`} onClick={() => run('timeline.addTrack', newKind)}>+ {newKind === 'video' ? 'Video' : 'Audio'} track</button></div>
              : <div key={t.id} data-track={t.id} className={`tl-head ${t.kind} ${trackDrag?.id === t.id ? 'dragging' : ''} ${trackDrag?.over === t.id ? 'drop-target' : ''}`} style={{ height: trackH(t) }}
                onMouseDown={(e) => headDown(e, t)} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, track: t.id }); }}>
                {t.kind !== 'caption'
                  ? <button className={`tgt ${ed.isTargeted(seq, t) ? 'on' : ''}`} title={`Track Targeting (${t.id}): Insert, Overwrite, Paste, Match Frame and Add Edit use the targeted tracks`} onClick={() => run('track.target', t.id)}>{t.id}</button>
                  : <b>{t.id}</b>}
                <span className="tname ell" title={`${t.name || t.id} · drag to reorder · double-click to rename`} onDoubleClick={() => run('track.rename', t.id)}>{t.name || ''}</span>
                {t.kind !== 'audio' && <button title={t.hidden ? 'Toggle Track Output: hidden (not shown or exported)' : 'Toggle Track Output'} className={t.hidden ? 'eye on' : 'eye'} onClick={() => run('track.toggleOutput', t.id)}>{t.hidden ? '⊘' : '👁'}</button>}
                {t.kind !== 'caption' && <>
                  <button title="Mute Track" className={t.muted ? 'on' : ''} onClick={() => run('track.mute', t.id)}>M</button>
                  <button title="Solo Track" className={t.solo ? 'on' : ''} onClick={() => run('track.solo', t.id)}>S</button>
                  <button title="Sync Lock" className={t.sync ? 'on' : ''} onClick={() => run('track.sync', t.id)}>⟳</button>
                </>}
                <button title="Lock Track" className={t.locked ? 'on' : ''} onClick={() => run('track.lock', t.id)}>🔒</button>
                {t.kind === 'audio' && <button title="Voice-Over Record" className={recording === t.id ? 'on rec' : ''} onClick={() => run('track.voiceOver', t.id)}>🎙</button>}
                <div className="tl-head-resize" title="Drag to change the track height" onMouseDown={(e) => resizeDown(e, t)} />
              </div>
            ))}
            </div>
          </div>
          <div className="tl-scroll" ref={ref} style={{ cursor: tool === 'razor' ? 'crosshair' : tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : 'default' }}
            onWheel={onWheel} onMouseDown={(e) => { handScroll(e); marqueeDown(e); }} onClick={zoomClick} onScroll={onScroll} onDragLeave={(e) => { if (!ref.current.contains(e.relatedTarget)) setDragInfo(null); }}
            onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
            <div style={{ width, position: 'relative' }}>
              <div className="tl-ruler" onMouseDown={scrub}>
                {Array.from({ length: Math.ceil(width / (pps * tcStep)) }, (_, i) => <span key={i} style={{ left: i * pps * tcStep }}>{fmt(i * tcStep, seq.fps)}</span>)}
                {seq.markers.map((m) => <i key={m.id} data-marker={m.id} className={`marker ${selMarker === m.id ? 'sel' : ''} ${m.type === 'chapter' ? 'chapter' : ''}`} title={[m.name || 'Marker', m.comment, m.type === 'chapter' ? 'Chapter' : ''].filter(Boolean).join(' - ')}
                  style={{ left: m.time * pps, '--mk': markerColor(m), ...(m.dur > 0 ? { width: Math.max(8, m.dur * pps) } : {}) }} onMouseDown={(e) => markerDown(e, m)} onDoubleClick={(e) => { e.stopPropagation(); openMarker(m.id); }} />)}
                {inPoint != null && <i className="io in" style={{ left: inPoint * pps }} />}
                {outPoint != null && <i className="io out" style={{ left: outPoint * pps }} />}
                {(previews || []).filter((q) => q.hash === sequenceHash()).map((q, i) => <i key={i} className={'renderbar ' + q.kind} style={{ left: q.start * pps, width: (q.end - q.start) * pps }} />)}
                {inPoint != null && outPoint != null && outPoint > inPoint && <i className="iorange" style={{ left: inPoint * pps, width: (outPoint - inPoint) * pps }} />}
              </div>
              {rows.map(({ track: t, newKind }) => (!t
                ? <div key={'new-' + newKind} className={`tl-newtrack ${newHot === newKind ? 'hot' : ''}`} onMouseDown={(e) => { if (!e.shiftKey) set({ selection: [], selectedTransition: null }); }}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes(EFFECT_MIME)) return; e.preventDefault(); if (newHot !== newKind) setNewHot(newKind); }} onDragLeave={() => setNewHot(null)}
                  onDrop={(e) => onDrop(e, { newKind })}>{newHot === newKind ? `Drop to create a new ${newKind} track` : ''}</div>
                : <div key={t.id} data-track={t.id} className={`tl-track ${t.kind} ${t.locked ? 'locked' : ''}`} style={{ height: trackH(t) }}
                  onMouseDown={(e) => { if (!e.shiftKey) set({ selection: [], selectedTransition: null }); set({ selectedGap: e.button === 0 && tool === 'selection' && !t.locked ? ed.gapAt(seq, t.id, timeAt(e)) : null }); }}
                  onContextMenu={(e) => { const g = !t.locked && ed.gapAt(seq, t.id, timeAt(e)); if (!g) return; e.preventDefault(); e.stopPropagation(); set({ selection: [], selectedTransition: null, selectedGap: g }); setMenu({ x: e.clientX, y: e.clientY, gap: true }); }}
                  onDragOver={(e) => { e.preventDefault(); itemDragOver(e); }} onDrop={(e) => onDrop(e, t)}>
                  {selGap?.track === t.id && <div className="tl-gap" style={{ left: selGap.a * pps, width: (selGap.b - selGap.a) * pps }} />}
                  {seq.clips.filter((c) => c.track === t.id).map((c) => (
                    <div key={c.id} data-clip={c.id} className={`clip ${selection.includes(c.id) ? 'sel' : ''} ${c.enabled ? '' : 'off'} ${dropHover?.id === c.id ? (dropHover.ok ? 'drop-ok drop-' + dropHover.edge : 'drop-no') : ''}`}
                      style={{ left: c.start * pps, width: Math.max(2, c.dur * pps), height: trackH(t) - 6, background: c.color }}
                      onMouseDown={(e) => clipDown(e, c)} onMouseMove={clipMove} onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const inside = e.clientX >= r.left && e.clientX <= r.right; const edge = !inside ? null : e.clientX - r.left < EDGE ? 'start' : r.right - e.clientX < EDGE ? 'end' : null;
                        // double-click an edit point with the Selection / Ripple / Rolling tool: Trim Mode (Premiere)
                        if (edge && ['selection', 'ripple', 'rolling'].includes(tool)) { trimAtEdge(c.id, edge, tool); return; }
                        (c.nestId ? switchSequence(c.nestId) : c.graphic || c.mogrt ? run('panel.essentialGraphics') : c.caption ? run('panel.text') : c.mediaId && run('clip.openInSource', c.id)); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!selection.includes(c.id)) set({ selection: expandSelection(seq, [c.id], toggles.linked) }); setMenu({ x: e.clientX, y: e.clientY, clip: c.id, kind: t.kind }); }}
                      onDragOver={(e) => clipDragOver(e, c, t.kind)} onDragLeave={() => setDropHover(null)} onDrop={(e) => clipDrop(e, c, t.kind)}>
                      {t.kind === 'video' && <Thumbs clip={c} pps={pps} h={trackH(t)} mode={thumbMode} fps={seq.fps} />}
                      <Waveform clip={c} width={c.dur * pps} height={trackH(t) - 6} /><span className="clip-name">{c.caption ? c.caption.text : c.name}</span>
                      {(() => { const o = ed.syncOffset(seq, c); return o ? <span className="syncbadge" title={`Out of sync with its linked ${t.kind === 'audio' ? 'picture' : 'sound'} by ${Math.abs(o)} frames`}>{o > 0 ? '+' : ''}{o}</span> : null; })()}
                      {clipMarkers(c, c.mediaId && mediaById(c.mediaId), seq.fps).map(({ m, at, owner }) => <i key={owner + m.id} className="clip-marker" title={m.name || 'Clip marker'} style={{ left: (at - c.start) * pps, '--mk': markerColor(m) }}
                        onDoubleClick={(e) => { e.stopPropagation(); run('marker.editClip', { scope: owner, owner: owner === 'clip' ? c.id : c.mediaId, id: m.id }); }} />)}
                      {c.remix && <><span className="fxbadge remix" title={`Remix: ${c.remix.segments.length - 1} cut(s), target ${c.remix.targetDur.toFixed(2)} s`}>Remix</span>{remixCuts(c).map((u, i) => <i key={'rx' + i} className="remix-cut" style={{ left: u * pps }} />)}</>}
                      {(c.effects || []).length > 0 && <span className="fxbadge" title={c.effects.map((x) => x.name).join(', ')}>fx</span>}
                      {((c.speed && c.speed !== 1) || c.reverse) && <span className="fxbadge" title={c.reverse ? 'Reversed' : 'Speed'}>{c.reverse ? '↺ ' : ''}{Math.round(Math.abs(c.speed || 1) * 100)}%</span>}
                      {c.timeRemap?.speed?.keys && <span className="fxbadge" title="Time Remapping keyframes">{c.speedCurve || 'ramp'}</span>}
                      {speedBands[c.id] && (c.mediaId || c.nestId) && <SpeedBand clip={c} pps={pps} h={trackH(t)} />}
                      {clipBands[c.id] && (() => { const def = bandParams(c, t.kind, FX_DEFS).find((d) => d.key === clipBands[c.id]); return def ? <ParamBand clip={c} pps={pps} h={trackH(t)} def={def} /> : null; })()}
                    </div>
                  ))}
                  {(seq.transitions || []).filter((x) => x.track === t.id).map((x) => (
                    <div key={x.id} className={`tl-trans ${selTr === x.id ? 'sel' : ''}`} title={x.name} style={{ left: (x.at - x.dur / 2) * pps, width: x.dur * pps }}
                      onMouseDown={(e) => { e.stopPropagation(); set({ selectedTransition: x.id, selection: [], selectedGap: null }); }}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); set({ selectedTransition: x.id, selection: [], selectedGap: null }); setMenu({ x: e.clientX, y: e.clientY, transition: x.id }); }}>{x.name}</div>
                  ))}
                  {remixGhost?.track === t.id && <div className="remix-ghost" style={{ left: remixGhost.start * pps, width: remixGhost.dur * pps }}>{remixGhost.label}</div>}
                  {trimMode && trimMode.edits.filter((x) => x.track === t.id).map((x) => { const at = ed.editTime(seq, x); return at == null ? null
                    : <i key={'trim' + (x.aId || '') + (x.bId || '')} className={`tl-trim ${trimMode.type} ${trimMode.type === 'roll' ? 'both' : trimMode.side}`} style={{ left: at * pps }} />; })}
                </div>
              ))}
              {dragInfo && (dragInfo.mode === 'insert' || dragInfo.mode === 'rearrange') && <div className={`tl-insert-line ${dragInfo.mode}`} style={{ left: dragInfo.at * pps }} />}
              {marquee && <div className="tl-marquee" style={marquee} />}
              <PlayheadLine pps={pps} />
            </div>
          </div>
        </div>
      </div>
      {dragInfo && <div className={`tl-drag-mode ${dragInfo.mode}`} style={{ left: dragInfo.x + 14, top: dragInfo.y + 18 }}>{MODE_TEXT[dragInfo.mode]}</div>}
      {menu && (
        <div ref={menuRef} className="menu-dropdown ctx" style={{ position: 'fixed', left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.track && <TrackMenu seq={seq} id={menu.track} close={() => setMenu(null)} />}
          {!menu.track && menu.clip && (() => {
            // Premiere order (src/Core/menus.js clipContextMenu); the keyframe / speed items need this panel's state
            const close = () => setMenu(null); const { top, tail } = clipContextMenu(menu.kind);
            const c = seq.clips.find((x) => x.id === menu.clip); const defs = c ? bandParams(c, menu.kind, FX_DEFS) : []; const cur = clipBands[menu.clip];
            // Show Clip Keyframes: the band on the clicked clip and every selected clip that has the same parameter
            const show = (key) => { setMenu(null); set((s) => { const b = { ...(s.clipBands || {}) }; for (const id of new Set([menu.clip, ...s.selection])) { const x = s.sequence.clips.find((q) => q.id === id); if (!x) continue; const k = ed.trackKind(s.sequence, x.track); if (!key) delete b[id]; else if (bandParams(x, k, FX_DEFS).some((d) => d.key === key)) b[id] = key; } return { clipBands: b }; }); };
            const on = !!speedBands[menu.clip];
            return <>
              {top.map((it, i) => <Item key={i} it={it} close={close} />)}
              <div className="menu-sep" />
              {defs.length > 0 && <div className="menu-item has-sub"><span>Show Clip Keyframes</span><span>▸</span>
                <div className="menu-dropdown sub">
                  <div className="menu-item" onClick={() => show(null)}><span>{!cur ? '✓ ' : ''}None</span></div>
                  <div className="menu-sep" />
                  {defs.map((d) => <div key={d.key} className="menu-item" onClick={() => show(d.key)}><span>{cur === d.key ? '✓ ' : ''}{d.group} › {d.label}</span></div>)}
                </div>
              </div>}
              <div className="menu-item" onClick={() => { setMenu(null); set((s) => ({ speedBands: { ...(s.speedBands || {}), [menu.clip]: !on } })); }}><span>{on ? '✓ ' : ''}Show Speed Keyframes (Time Remapping)</span></div>
              <div className="menu-item has-sub"><span>Speed Curve</span><span>▸</span>
                <div className="menu-dropdown sub">{Object.keys(SPEED_CURVES).map((n) => <div key={n} className="menu-item" onClick={() => { setMenu(null); applySpeedCurveToClips(getState().selection, n); set((s) => ({ speedBands: { ...(s.speedBands || {}), [menu.clip]: true } })); }}><span>{n}</span></div>)}</div>
              </div>
              {tail.length > 0 && <div className="menu-sep" />}
              {tail.map((it, i) => <Item key={'t' + i} it={it} close={close} />)}
            </>;
          })()}
          {menu.transition && <>
            <div className="menu-item" onClick={() => { setMenu(null); run('transition.duration', menu.transition); }}><span>Set Transition Duration…</span></div>
            <div className="menu-item" onClick={() => { setMenu(null); run('transition.clear', menu.transition); }}><span>Clear</span><span className="kbd">Delete</span></div>
          </>}
          {menu.gap && <div className="menu-item" onClick={() => { setMenu(null); run('timeline.rippleDeleteGap'); }}><span>Ripple Delete</span><span className="kbd">Delete</span></div>}
          {!menu.track && !menu.clip && !menu.transition && !menu.gap && <>
            {(() => { const has = hasClipboard(); return <>
              <div className={`menu-item ${has ? '' : 'disabled'}`} onClick={() => { if (!has) return; setMenu(null); run('edit.paste'); }}><span>Paste</span><span className="kbd">Ctrl+V</span></div>
              <div className={`menu-item ${has ? '' : 'disabled'}`} onClick={() => { if (!has) return; setMenu(null); run('edit.pasteInsert'); }}><span>Paste Insert</span><span className="kbd">Ctrl+Shift+V</span></div>
            </>; })()}
            <div className="menu-sep" />
            <div className="menu-item" onClick={() => { setMenu(null); run('timeline.addCaptionTrack'); }}><span>Add Caption Track</span></div>
            <div className="menu-sep" />
            <div className="menu-item" onClick={() => { setMenu(null); run('timeline.addTrack', 'video'); }}><span>Add Video Track</span></div>
            <div className="menu-item" onClick={() => { setMenu(null); run('timeline.addTrack', 'audio'); }}><span>Add Audio Track</span></div>
            <div className="menu-item" onClick={() => { setMenu(null); run('timeline.deleteEmptyTracks'); }}><span>Delete Empty Tracks</span></div>
            <div className="menu-sep" />
            <div className="menu-item" onClick={() => { setMenu(null); run('seq.zoomFit'); }}><span>Zoom to Fit</span></div>
          </>}
        </div>
      )}
    </div>
  );
}
