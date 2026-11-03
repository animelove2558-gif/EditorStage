import React from 'react';
import { useStore, set, edit, getState } from '../Core/store';
import { evalParam, writeParam, toggleAnimation, hasKeyAt, keyAt, neighborKey, toggleKeyAt, setKeyInterp, INTERPS, DEFAULT_MOTION, DEFAULT_OPACITY, DEFAULT_VOLUME, DEFAULT_TIMEREMAP } from '../Core/params';
import { VIDEO_FX, LUMETRI_DEFAULTS } from '../Renderers/fx/videoEffects';
import { AUDIO_FX, readLoudness } from '../Services/audioFx';
import { BLEND_MODES } from '../Renderers/Compositor';
import { APPROX_TRANSITIONS } from '../Renderers/fx/transitions';
import { EXT_TRANSITIONS } from '../Renderers/fx/moreTransitions';
import { analyzeStabilizer, analyzeReframe } from '../Services/stabilize';
import { analyzeMorphCut } from '../Services/morph';
import { defaultCurves, curveLUT } from '../Core/curves';
import GraphEditor from './GraphEditor';
import { autoCorrect, applyColorMatch } from '../Services/colorAuto';
import { shotClipAt } from '../Core/compare';
import { run } from '../Core/commands';
import { trackMask, cancelTracking, TRACK_METHODS } from '../Services/tracking';
import { SPEED_CURVES, applySpeedCurve } from '../Core/clipTime';

const Empty = ({ children }) => <div className="panel-pad dim">{children}</div>;

const MOTION_DEFS = [
  { id: 'position', label: 'Position', type: 'point' },
  { id: 'scale', label: 'Scale', type: 'slider', min: 0, max: 600, step: 0.1 },
  { id: 'scaleW', label: 'Scale Width', type: 'slider', min: 0, max: 600, step: 0.1, onlyWhen: (c) => c.uniform === false },
  { id: 'uniform', label: 'Uniform Scale', type: 'checkbox', noAnim: true },
  { id: 'rotation', label: 'Rotation', type: 'slider', min: -3600, max: 3600, step: 0.1 },
  { id: 'anchor', label: 'Anchor Point', type: 'point' },
  { id: 'antiflicker', label: 'Anti-flicker Filter', type: 'slider', min: 0, max: 1, step: 0.01 },
];
const OPACITY_DEFS = [
  { id: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, step: 0.1 },
  { id: 'blend', label: 'Blend Mode', type: 'select', options: BLEND_MODES, noAnim: true, byName: true },
];
const VOLUME_DEFS = [
  { id: 'bypass', label: 'Bypass', type: 'checkbox', noAnim: true },
  { id: 'level', label: 'Level (dB)', type: 'slider', min: -60, max: 15, step: 0.1 },
];
const REMAP_DEFS = [{ id: 'speed', label: 'Speed (%)', type: 'slider', min: 0, max: 1000, step: 1 }];

/** mutate a clip (undoable, slider drags coalesced) */
const mutate = (label, clipId, fn) => edit(label, ({ seq }) => fn(seq.clips.find((c) => c.id === clipId)), { coalesce: `${clipId}:${label}` });

// ---- keyframe interpolation menu (right-click a keyframe) ----
let openKeyMenu = () => {};
export function KeyMenuHost() {
  const [m, setM] = React.useState(null);
  React.useEffect(() => { openKeyMenu = setM; const off = () => setM(null); window.addEventListener('mousedown', off); return () => { openKeyMenu = () => {}; window.removeEventListener('mousedown', off); }; }, []);
  if (!m) return null;
  return (
    <div className="ctx-menu" style={{ left: m.x, top: m.y }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="dim ctx-title">Keyframe Interpolation</div>
      {INTERPS.map((it) => <div key={it.id} className="menu-item" onClick={() => { m.onPick(it.id); setM(null); }}><span>{(m.cur || 'linear') === it.id ? '✓ ' : ' '}{it.label}</span></div>)}
    </div>
  );
}
const keyMenu = (e, key, onPick) => { e.preventDefault(); e.stopPropagation(); openKeyMenu({ x: e.clientX, y: e.clientY, cur: key?.interp, onPick }); };
const KEY_GLYPH = { hold: '■', easeIn: '◗', easeOut: '◖', easeInOut: '●', bezier: '◈' };

/** Keyframes of one parameter across the clip: click to jump, right-click to change interpolation. */
function KeyLane({ p, clipStart, clipDur, local, onPlayheadTo, onInterp }) {
  const pct = (t) => `${Math.min(100, Math.max(0, (t / Math.max(1e-6, clipDur)) * 100))}%`;
  return (
    <div className="keylane" title="Keyframes - click to go to, right-click to change interpolation">
      <div className="keylane-ph" style={{ left: pct(local) }} />
      {p.keys.map((k) => (
        <span key={k.t} className={`key ${Math.abs(k.t - local) < 1 / 120 ? 'cur' : ''}`} style={{ left: pct(k.t) }}
          onMouseDown={(e) => { if (e.button === 0) { e.stopPropagation(); onPlayheadTo(clipStart + k.t); } }}
          onContextMenu={(e) => keyMenu(e, k, (it) => onInterp(k.t, it))}>{KEY_GLYPH[k.interp] || '◆'}</span>
      ))}
    </div>
  );
}

// ---- one parameter row ----
function ParamRow({ def, p, local, dims, dynTracks, dynImages, onWrite, onToggle, onKeyToggle, onPlayheadTo, onInterp, onSet, clipStart, clipDur }) {
  const [graph, setGraph] = React.useState(false);
  const cur = evalParam(p, local);
  const animated = !!p?.keys;
  const canAnim = !def.noAnim && ['slider', 'point', 'color'].includes(def.type);
  const prevK = neighborKey(p, local, -1), nextK = neighborKey(p, local, 1);
  return (
    <div className="param">
      <button title="Toggle Animation (stopwatch)" className={animated ? 'on' : ''} disabled={!canAnim} onClick={onToggle}>⏱</button>
      <label title={def.label}>{def.label}</label>
      {def.type === 'slider' && <>
        <input type="range" min={def.min} max={def.max} step={def.step ?? 1} value={cur ?? 0} onChange={(e) => onWrite(+e.target.value)} />
        <input className="num" type="number" step={def.step ?? 1} value={Number.isFinite(cur) ? +(+cur).toFixed(3) : 0} onChange={(e) => onWrite(+e.target.value)} />
      </>}
      {def.type === 'point' && <>
        <input className="num" type="number" value={Math.round(cur[0] * dims.w)} onChange={(e) => onWrite([+e.target.value / dims.w, cur[1]])} />
        <input className="num" type="number" value={Math.round(cur[1] * dims.h)} onChange={(e) => onWrite([cur[0], +e.target.value / dims.h])} />
      </>}
      {def.type === 'select' && <select value={cur} onChange={(e) => onWrite(def.byName ? e.target.value : +e.target.value)}>
        {def.options.map((o, i) => <option key={o} value={def.byName ? o : i}>{o}</option>)}
      </select>}
      {def.type === 'trackSel' && <select value={cur ?? 'None'} onChange={(e) => onWrite(e.target.value)}>{['None', ...(dynTracks || [])].map((o) => <option key={o}>{o}</option>)}</select>}
      {def.type === 'mediaSel' && <select value={cur ?? ''} onChange={(e) => onWrite(e.target.value)}><option value="">None</option>{(dynImages || []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
      {def.type === 'checkbox' && <input type="checkbox" checked={!!cur} onChange={(e) => onWrite(e.target.checked)} />}
      {def.type === 'color' && <input type="color" value={cur} onChange={(e) => onWrite(e.target.value)} />}
      {def.type === 'text' && <textarea rows={2} style={{ flex: 1 }} value={cur ?? ''} onChange={(e) => onWrite(e.target.value)} />}
      {animated && onSet && ['slider', 'point'].includes(def.type) && <button className={graph ? 'on' : ''} title="Graph Editor (value / speed curves, Bezier handles, ease presets)" onClick={() => setGraph(!graph)}>📈</button>}
      {animated && <span className="kfnav">
        <button disabled={!prevK} title="Previous keyframe" onClick={() => onPlayheadTo(clipStart + prevK.t)}>◂</button>
        <button className={hasKeyAt(p, local) ? 'on' : ''} title="Add/Remove keyframe (right-click: interpolation)" onClick={onKeyToggle}
          onContextMenu={(e) => { const k = keyAt(p, local); if (k && onInterp) keyMenu(e, k, (it) => onInterp(k.t, it)); }}>◆</button>
        <button disabled={!nextK} title="Next keyframe" onClick={() => onPlayheadTo(clipStart + nextK.t)}>▸</button>
      </span>}
      {animated && onInterp && clipDur > 0 && <KeyLane p={p} clipStart={clipStart} clipDur={clipDur} local={local} onPlayheadTo={onPlayheadTo} onInterp={onInterp} />}
      {animated && graph && onSet && <GraphEditor p={p} dur={clipDur} local={local} onChange={onSet} onPlayheadTo={(t) => onPlayheadTo(clipStart + t)} />}
    </div>
  );
}

function Section({ title, right, children, defaultOpen = true, badge }) {
  return (
    <details open={defaultOpen} className="fx-section">
      <summary><span>{title}</span>{badge && <span className={`badge ${badge}`}>{badge}</span>}<span className="grow" />{right}</summary>
      {children}
    </details>
  );
}

/** Rows for a param-map living at clip[path...]. */
function ParamGroup({ clip, defs, store, label, dims, ensure, applyTo, local, playhead }) {
  const values = Object.fromEntries(defs.map((d) => [d.id, evalParam(store[d.id], local)]));
  return defs.filter((d) => !d.onlyWhen || d.onlyWhen(values)).map((d) => {
    const p = store[d.id];
    return (
      <ParamRow key={d.id} def={d} p={p} local={local} dims={dims} clipStart={clip.start} clipDur={clip.dur}
        onWrite={(v) => mutate(`${label}: ${d.label}`, clip.id, (c) => { const m = ensure(c); m[d.id] = writeParam(m[d.id], v, local); })}
        onInterp={(kt, it) => edit(`${label}: ${d.label} interpolation`, ({ seq }) => { const m = ensure(seq.clips.find((c) => c.id === clip.id)); m[d.id] = setKeyInterp(m[d.id], kt, it); })}
        onSet={(np, what) => mutate(`${label}: ${d.label} ${what}`, clip.id, (c) => { const m = ensure(c); m[d.id] = np; })}
        onToggle={() => mutate(`${label}: ${d.label} animation`, clip.id, (c) => { const m = ensure(c); m[d.id] = toggleAnimation(m[d.id], local); })}
        onKeyToggle={() => mutate(`${label}: ${d.label} keyframe`, clip.id, (c) => { const m = ensure(c); m[d.id] = toggleKeyAt(m[d.id], local); })}
        onPlayheadTo={(t) => set({ playhead: t })} />
    );
  });
}

const MASK_NAMES = { ellipse: 'Ellipse Mask', polygon: '4-point Polygon Mask', bezier: 'Free Draw Mask' };
const maskDefs = (m) => (m.type === 'ellipse'
  ? [{ id: 'center', label: 'Center', type: 'point' }, { id: 'size', label: 'Size', type: 'point' }]
  : m.params.points.v.map((_, i) => ({ id: `pt${i}`, label: `Point ${i + 1}`, type: 'point' })))
  .concat([{ id: 'feather', label: 'Mask Feather', type: 'slider', min: 0, max: 100, step: 0.5 }, { id: 'opacity', label: 'Mask Opacity', type: 'slider', min: 0, max: 100 }, { id: 'invert', label: 'Inverted', type: 'checkbox', noAnim: true }]);

/** Mask Path stopwatch + Track Backward / one frame back / one frame forward / Track Forward (Premiere's mask tracking bar). */
function MaskTrackBar({ clip, mk, local }) {
  const busy = useStore((s) => s.tracking);
  const [method, setMethod] = React.useState(mk.trackMethod || 'full');
  const pathKey = mk.type === 'ellipse' ? 'center' : 'points';
  const animated = !!mk.params[pathKey]?.keys;
  const go = (dir, count) => trackMask(clip.id, mk.id, dir, count, method).then((r) => { if (r.tracked < r.wanted) notifyEC(`Tracked ${r.tracked} of ${r.wanted} frames (the object was lost)`); }).catch((e) => notifyEC(e.message));
  const toggle = () => mutate('Mask Path animation', clip.id, (c) => { const x = c.masks.find((q) => q.id === mk.id); for (const k of mk.type === 'ellipse' ? ['center', 'size'] : ['points']) { const p = x.params[k]; x.params[k] = p.keys ? { v: evalParam(p, local), keys: null } : { v: p.v, keys: [{ t: local, v: p.v }] }; } });
  return (
    <div className="param masktrack">
      <label>Mask Path</label>
      <button className={animated ? 'on' : ''} title="Toggle animation (keyframe the mask path)" onClick={toggle}>⏱</button>
      <button disabled={!!busy} title="Track selected mask backward" onClick={() => go(-1, Infinity)}>◀◀</button>
      <button disabled={!!busy} title="Track selected mask backward 1 frame" onClick={() => go(-1, 1)}>◀|</button>
      <button disabled={!!busy} title="Track selected mask forward 1 frame" onClick={() => go(1, 1)}>|▶</button>
      <button disabled={!!busy} title="Track selected mask forward" onClick={() => go(1, Infinity)}>▶▶</button>
      <select title="Tracking method" value={method} onChange={(e) => { setMethod(e.target.value); mutate('Mask tracking method', clip.id, (c) => { c.masks.find((q) => q.id === mk.id).trackMethod = e.target.value; }); }}>
        {Object.entries(TRACK_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </div>
  );
}
const notifyEC = (msg) => set((s) => ({ log: [...(s.log || []).slice(-49), msg] }));
/** Progress of a running tracking job, with Cancel. */
function TrackingBar() {
  const tr = useStore((s) => s.tracking); if (!tr) return null;
  return <div className="trackbar"><span>{tr.label}</span><progress max="1" value={tr.p} /><button onClick={cancelTracking}>Cancel</button></div>;
}

export function createMask(clipId, type, points) {
  edit(`Create ${MASK_NAMES[type]}`, ({ seq }) => {
    const c = seq.clips.find((x) => x.id === clipId); c.masks = c.masks || [];
    const base = { feather: { v: 10, keys: null }, opacity: { v: 100, keys: null }, invert: { v: false, keys: null } };
    const pts = points || (type === 'ellipse' ? null : [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]);
    const params = type === 'ellipse'
      ? { ...base, center: { v: [0.5, 0.5], keys: null }, size: { v: [0.5, 0.5], keys: null } }
      : { ...base, points: { v: pts, keys: null } };
    c.masks.push({ id: Math.random().toString(36).slice(2, 8), type, enabled: true, params });
  });
}

export function EffectControls() {
  const sel = useStore((s) => s.selection);
  const selTr = useStore((s) => s.selectedTransition);
  const seq = useStore((s) => s.sequence);
  const playhead = useStore((s) => (s.playing ? Math.floor(s.playhead * 8) / 8 : s.playhead)); // ~8 updates/s during playback
  const media = useStore((s) => s.media);
  const maskDraw = useStore((s) => s.maskDraw);
  const clip = seq.clips.find((c) => c.id === sel[0]);
  const dims = { w: seq.width, h: seq.height };

  if (!clip && selTr) {
    const tr = (seq.transitions || []).find((x) => x.id === selTr);
    if (tr) return <TransitionPanel tr={tr} />;
  }
  if (!clip) return <Empty>Select a clip to edit its effects</Empty>;

  const track = seq.tracks.find((t) => t.id === clip.track);
  const m = media.find((x) => x.id === clip.mediaId);
  const hasVideo = track?.kind === 'video';
  const hasAudio = track?.kind === 'audio' || m?.kind === 'video';
  const local = Math.max(0, playhead - clip.start);
  const motion = { ...DEFAULT_MOTION(), ...clip.motion }, opacity = { ...DEFAULT_OPACITY(), ...clip.opacity };
  const volume = { ...DEFAULT_VOLUME(), ...clip.volume }, remap = { ...DEFAULT_TIMEREMAP(), ...clip.timeRemap };
  const vfx = (clip.effects || []).filter((e) => e.category !== 'Audio'), afx = (clip.effects || []).filter((e) => e.category === 'Audio');
  const trs = (seq.transitions || []).filter((t) => t.aId === clip.id || t.bId === clip.id);

  const fxRows = (fx, registry, kind) => {
    const def = registry[fx.name]; if (!def) return <Empty>Unknown effect</Empty>;
    return def.params.map((d) => (
      <ParamRow key={d.id} def={d} p={fx.params?.[d.id]} dynTracks={seq.tracks.filter((q) => q.kind === 'video' && q.id !== clip.track).map((q) => q.id)} dynImages={media.filter((q) => q.kind === 'image')} local={local} dims={dims} clipStart={clip.start} clipDur={clip.dur}
        onWrite={(v) => mutate(`${fx.name}: ${d.label}`, clip.id, (c) => { const f = c.effects.find((x) => x.id === fx.id); f.params[d.id] = writeParam(f.params[d.id], v, local); })}
        onInterp={(kt, it) => edit(`${fx.name}: ${d.label} interpolation`, ({ seq }) => { const f = seq.clips.find((c) => c.id === clip.id).effects.find((x) => x.id === fx.id); f.params[d.id] = setKeyInterp(f.params[d.id], kt, it); })}
        onSet={(np, what) => mutate(`${fx.name}: ${d.label} ${what}`, clip.id, (c) => { const f = c.effects.find((x) => x.id === fx.id); f.params[d.id] = np; })}
        onToggle={() => mutate(`${fx.name}: ${d.label} animation`, clip.id, (c) => { const f = c.effects.find((x) => x.id === fx.id); f.params[d.id] = toggleAnimation(f.params[d.id], local); })}
        onKeyToggle={() => mutate(`${fx.name}: ${d.label} key`, clip.id, (c) => { const f = c.effects.find((x) => x.id === fx.id); f.params[d.id] = toggleKeyAt(f.params[d.id], local); })}
        onPlayheadTo={(t) => set({ playhead: t })} />
    ));
  };
  const fxSection = (fx, registry) => {
    const def = registry[fx.name];
    return (
      <Section key={fx.id} title={fx.name} badge={def?.status === 'unsupported' ? 'unsupported' : def?.status === 'approx' ? 'approx' : null}
        right={<span onClick={(e) => e.preventDefault()}>
          <input type="checkbox" title="Enable effect" checked={fx.enabled} onChange={() => mutate('Toggle Effect', clip.id, (c) => { const f = c.effects.find((x) => x.id === fx.id); f.enabled = !f.enabled; })} />
          <button title="Save Preset…" onClick={() => set({ dialog: { type: 'savePreset', props: { clipId: clip.id, fxId: fx.id } } })}>💾</button>
          <button title="Reset effect" onClick={() => mutate('Reset Effect', clip.id, (c) => { const f = c.effects.find((x) => x.id === fx.id); for (const d of def.params) f.params[d.id] = { v: d.def, keys: null }; })}>↺</button>
          <button title="Remove effect" onClick={() => mutate('Remove Effect', clip.id, (c) => { c.effects = c.effects.filter((x) => x.id !== fx.id); })}>✕</button>
        </span>}>
        {def?.status === 'unsupported' && <div className="dim note">Not rendered yet</div>}
        {def?.analyze && <StabilizerBar clip={clip} fx={fx} />}
        {def?.meter && <LoudnessBar fx={fx} />}
        {fxRows(fx, registry)}
      </Section>
    );
  };

  const group = (defs, store, ensure, label) => <ParamGroup clip={clip} defs={defs} store={store} label={label} dims={dims} ensure={ensure} local={local} playhead={playhead} />;

  return (
    <div className="panel-pad ec">
      <KeyMenuHost />
      <h4>{clip.name}</h4>
      {hasVideo && <>
        <div className="ec-group">Video</div>
        <TrackingBar />
        <Section title="Motion" right={<span onClick={(e) => e.preventDefault()}><button title="Track Object: make this clip follow an object in the video below (Point Tracker)" onClick={() => set({ dialog: { type: 'trackObject', props: { clipId: clip.id } } })}>⌖ Track</button></span>}>{group(MOTION_DEFS, motion, (c) => (c.motion = { ...DEFAULT_MOTION(), ...c.motion }), 'Motion')}</Section>
        <Section title="Opacity" right={<span className="masks" onClick={(e) => e.preventDefault()}>
          <button title="Create 4-point polygon mask" onClick={() => createMask(clip.id, 'polygon')}>▭</button>
          <button title="Create ellipse mask" onClick={() => createMask(clip.id, 'ellipse')}>◯</button>
          <button title="Free draw bezier (click points on the Program Monitor, double-click to finish)" className={maskDraw ? 'on' : ''} onClick={() => set({ maskDraw: { clipId: clip.id, pts: [] } })}>✒</button>
        </span>}>
          {group(OPACITY_DEFS, opacity, (c) => (c.opacity = { ...DEFAULT_OPACITY(), ...c.opacity }), 'Opacity')}
          {(clip.masks || []).map((mk) => (
            <details key={mk.id} open className="mask">
              <summary>{MASK_NAMES[mk.type]}
                <button title="Delete mask" onClick={(e) => { e.preventDefault(); mutate('Delete Mask', clip.id, (c) => { c.masks = c.masks.filter((x) => x.id !== mk.id); }); }}>✕</button></summary>
              {clip.mediaId && <MaskTrackBar clip={clip} mk={mk} local={local} />}
              {maskDefs(mk).map((d) => {
                const isPt = d.id.startsWith('pt');
                const idx = isPt ? +d.id.slice(2) : -1;
                const p = isPt ? { v: evalParam(mk.params.points, local)[idx] } : mk.params[d.id];
                return <ParamRow key={d.id} def={d} p={p} local={local} dims={dims} clipStart={clip.start} onPlayheadTo={() => {}} onToggle={() => {}} onKeyToggle={() => {}}
                  onWrite={(v) => mutate(`Mask ${d.label}`, clip.id, (c) => { const x = c.masks.find((q) => q.id === mk.id); if (isPt) { const pts = evalParam(x.params.points, local).map((q) => [...q]); pts[idx] = v; x.params.points = writeParam(x.params.points, pts, local); } else x.params[d.id] = writeParam(x.params[d.id], v, local); })} />;
              })}
            </details>
          ))}
        </Section>
        <Section title="Time Remapping" right={<span onClick={(e) => e.preventDefault()}><SpeedCurvePicker clip={clip} /></span>}>
          {group(REMAP_DEFS, remap, (c) => (c.timeRemap = { ...DEFAULT_TIMEREMAP(), ...c.timeRemap }), 'Time Remapping')}
          {(clip.reverse || clip.maintainPitch || clip.frameSampling) && <div className="dim note">{[clip.reverse && 'Reversed', clip.maintainPitch && 'Maintain Audio Pitch', clip.frameSampling === 'blend' && 'Frame Blending'].filter(Boolean).join(' · ')} (Clip &gt; Speed/Duration)</div>}
        </Section>
        {vfx.map((fx) => fxSection(fx, VIDEO_FX))}
      </>}
      {hasAudio && <>
        <div className="ec-group">Audio</div>
        <Section title="Volume">{group(VOLUME_DEFS, volume, (c) => (c.volume = { ...DEFAULT_VOLUME(), ...c.volume }), 'Volume')}</Section>
        {afx.map((fx) => fxSection(fx, AUDIO_FX))}
      </>}
      {trs.length > 0 && <>
        <div className="ec-group">Transitions</div>
        {trs.map((tr) => <div key={tr.id} className="trrow" onClick={() => set({ selectedTransition: tr.id, selection: [] })}>⇄ {tr.name} <span className="dim">({tr.dur.toFixed(2)}s @ {tr.at.toFixed(2)}s)</span></div>)}
      </>}
    </div>
  );
}

/** CapCut-style speed curves: Time Remapping keys + a duration that keeps the same source range (linked audio follows). */
export function applySpeedCurveToClips(ids, name) {
  edit(`Speed Curve: ${name}`, ({ seq }) => {
    const sel = seq.clips.filter((c) => ids.includes(c.id)); const links = new Set(sel.map((c) => c.linkId).filter(Boolean));
    const all = seq.clips.filter((c) => ids.includes(c.id) || (c.linkId && links.has(c.linkId)));
    const lead = all.find((c) => seq.tracks.find((t) => t.id === c.track)?.kind === 'video') || all[0]; if (!lead) return;
    // stop at the next clip on any affected track (no ripple)
    let room = Infinity; for (const c of all) { const next = seq.clips.filter((x) => x.track === c.track && x.id !== c.id && x.start >= c.start + c.dur - 1e-3).sort((a, b) => a.start - b.start)[0]; if (next) room = Math.min(room, next.start - c.start); }
    applySpeedCurve(lead, name, room);
    for (const c of all) if (c !== lead) { c.timeRemap = structuredClone(lead.timeRemap); c.speed = lead.speed; c.reverse = lead.reverse; c.inPoint = lead.inPoint; c.dur = lead.dur; c.start = lead.start; c.speedCurve = name; }
  });
}
function SpeedCurvePicker({ clip }) {
  return <select title="Speed Curve (CapCut presets): sets Time Remapping keys and the clip length so the same footage plays" value="" onChange={(e) => e.target.value && applySpeedCurveToClips([clip.id], e.target.value)}>
    <option value="">{clip.speedCurve ? `Curve: ${clip.speedCurve}` : 'Speed Curve…'}</option>
    {Object.keys(SPEED_CURVES).map((n) => <option key={n} value={n}>{n}</option>)}
  </select>;
}

function StabilizerBar({ clip, fx }) {
  const [prog, setProg] = React.useState(null); const [err, setErr] = React.useState('');
  const go = async () => { setErr(''); setProg(0); try { const r = await (fx.name === 'Auto Reframe' ? analyzeReframe : analyzeStabilizer)(clip.id, fx.id, setProg); if (!r.ok) setErr(r.error); } catch (e) { setErr(String(e.message || e)); } setProg(null); };
  return <div className="param"><button disabled={prog !== null} onClick={go}>{prog !== null ? 'Analyzing ' + Math.round(prog * 100) + '%' : fx.analysis ? 'Re-analyze' : 'Analyze'}</button><span className="dim">{fx.analysis ? fx.analysis.path.length + ' frames analyzed' + (fx.analysis.subjectFrames != null ? ' (subject found in ' + fx.analysis.subjectFrames + ')' : '') : 'Run analysis before the effect has any result'}</span>{err && <span className="err">{err}</span>}</div>;
}

function LoudnessBar({ fx }) {
  const [v, setV] = React.useState(null);
  React.useEffect(() => { const id = setInterval(() => setV(readLoudness(fx.id)), 200); return () => clearInterval(id); }, [fx.id]);
  return <div className="param"><label>Momentary</label><b>{v == null ? 'play to measure' : Number.isFinite(v) ? v.toFixed(1) + ' LUFS' : '-inf'}</b></div>;
}

function MorphBar({ tr }) {
  const [prog, setProg] = React.useState(null);
  const go = async () => { setProg(0); try { await analyzeMorphCut(tr.id, setProg); } catch (e) { /* ignore */ } setProg(null); };
  const an = tr.analysis;
  return <div className="param"><button disabled={prog !== null} onClick={go}>{prog !== null ? 'Analyzing faces ' + Math.round(prog * 100) + '%' : an ? 'Re-analyze' : 'Analyze faces'}</button><span className="dim">{an ? 'Faces found - A: ' + an.facesA + ', B: ' + an.facesB + ' frames' + (an.facesA && an.facesB ? ' (face-guided morph)' : ' (optical flow only)') : 'Not analyzed - optical flow only'}</span></div>;
}

/** the parameters of a transition from moreTransitions.js (one value for the whole transition) */
function TransitionParams({ tr, upd }) {
  const def = EXT_TRANSITIONS[tr.name]; if (!def || !def.params.length) return null;
  const val = (q) => tr.params?.[q.id] ?? q.def;
  const put = (q, v) => upd(`Transition ${q.label}`, (x) => { x.params = { ...(x.params || {}), [q.id]: v }; });
  return <>{def.params.map((q) => <div key={q.id} className="param"><label>{q.label}</label>
    {q.type === 'slider' && <><input type="range" min={q.min} max={q.max} step={q.step} value={val(q)} onChange={(e) => put(q, +e.target.value)} /><input className="num" type="number" step={q.step} value={val(q)} onChange={(e) => put(q, +e.target.value)} /></>}
    {q.type === 'select' && <select value={val(q)} onChange={(e) => put(q, +e.target.value)}>{q.options.map((o, i) => <option key={o} value={i}>{o}</option>)}</select>}
    {q.type === 'checkbox' && <input type="checkbox" checked={!!val(q)} onChange={(e) => put(q, e.target.checked)} />}
    {q.type === 'color' && <input type="color" value={val(q)} onChange={(e) => put(q, e.target.value)} />}
    {q.type === 'point' && <><input className="num" type="number" step="0.01" value={val(q)[0]} onChange={(e) => put(q, [+e.target.value, val(q)[1]])} /><input className="num" type="number" step="0.01" value={val(q)[1]} onChange={(e) => put(q, [val(q)[0], +e.target.value])} /></>}
  </div>)}
  <div className="param"><label /><button onClick={() => upd('Reset Transition', (x) => { delete x.params; })}>Reset parameters</button></div></>;
}
function TransitionPanel({ tr }) {
  const upd = (label, fn) => edit(label, ({ seq }) => fn(seq.transitions.find((x) => x.id === tr.id)), { coalesce: `tr:${tr.id}:${label}` });
  return (
    <div className="panel-pad ec">
      <h4>Transition: {tr.name}</h4>
      {APPROX_TRANSITIONS.has(tr.name) && <div className="dim note">Approximated look (no true 3D / optical-flow)</div>}
      <div className="param"><label>Duration (s)</label><input type="range" min="0.1" max="5" step="0.05" value={tr.dur} onChange={(e) => upd('Transition Duration', (x) => { x.dur = +e.target.value; })} /><input className="num" type="number" step="0.05" value={tr.dur} onChange={(e) => upd('Transition Duration', (x) => { x.dur = Math.max(0.1, +e.target.value); })} /></div>
      {tr.name === 'Morph Cut' && <MorphBar tr={tr} />}
      <TransitionParams tr={tr} upd={upd} />
      <div className="param"><label>Reverse</label><input type="checkbox" checked={!!tr.reverse} onChange={(e) => upd('Transition Reverse', (x) => { x.reverse = e.target.checked; })} /></div>
      <div className="param"><label>Alignment</label><span className="dim">Center at Cut ({tr.at.toFixed(2)}s)</span></div>
      <button onClick={() => edit('Delete Transition', ({ seq }) => { seq.transitions = seq.transitions.filter((x) => x.id !== tr.id); }) || set({ selectedTransition: null })}>Delete transition</button>
    </div>
  );
}

// ---------------- Lumetri Color (edits the selected clip) ----------------
const LUMETRI_UI = {
  'Basic Correction': [['temperature', 'Temperature', -100, 100], ['tint', 'Tint', -100, 100], ['exposure', 'Exposure', -4, 4, 0.05], ['contrast', 'Contrast', -100, 100], ['highlights', 'Highlights', -100, 100], ['shadows', 'Shadows', -100, 100], ['whites', 'Whites', -100, 100], ['blacks', 'Blacks', -100, 100], ['saturation', 'Saturation', 0, 200]],
  'Creative': [['fade', 'Faded Film', 0, 100], ['sharpen', 'Sharpen', -100, 100], ['vibrance', 'Vibrance', -100, 100]],
  'Color Wheels & Match': [['liftR', 'Shadows R', -100, 100], ['liftG', 'Shadows G', -100, 100], ['liftB', 'Shadows B', -100, 100], ['gammaR', 'Midtones R', -100, 100], ['gammaG', 'Midtones G', -100, 100], ['gammaB', 'Midtones B', -100, 100], ['gainR', 'Highlights R', -100, 100], ['gainG', 'Highlights G', -100, 100], ['gainB', 'Highlights B', -100, 100]],
  'Vignette': [['vigAmount', 'Amount', -100, 100], ['vigMid', 'Midpoint', 0, 100], ['vigRound', 'Roundness', 0, 100], ['vigFeather', 'Feather', 0, 100]],
};
const HSL_UI = [['hslHLo', 'Hue from (°)', 0, 360], ['hslHHi', 'Hue to (°)', 0, 360], ['hslSLo', 'Sat from', 0, 100], ['hslSHi', 'Sat to', 0, 100], ['hslLLo', 'Luma from', 0, 100], ['hslLHi', 'Luma to', 0, 100], ['hslFeather', 'Denoise / Feather', 0, 100], ['hslHue', 'Hue shift (°)', -180, 180], ['hslSat', 'Saturation', -100, 100], ['hslLum', 'Lightness', -100, 100]];

function CurveEditor({ curves, onChange }) {
  const [ch, setCh] = React.useState('master'); const cv = React.useRef(null); const drag = React.useRef(null);
  const cur = curves || defaultCurves(); const pts = cur[ch] || [[0, 0], [1, 1]];
  const S = 220;
  React.useEffect(() => {
    const g = cv.current.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, S, S); g.strokeStyle = '#333';
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((i * S) / 4, 0); g.lineTo((i * S) / 4, S); g.moveTo(0, (i * S) / 4); g.lineTo(S, (i * S) / 4); g.stroke(); }
    const lut = curveLUT(pts); g.strokeStyle = { master: '#ddd', r: '#f55', g: '#5f5', b: '#58f', hs: '#fc4' }[ch]; g.lineWidth = 2; g.beginPath();
    for (let k = 0; k < 256; k++) { const x = (k / 255) * S, y = S - lut[k] * S; k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.fillStyle = '#fff'; pts.forEach((p) => { g.beginPath(); g.arc(p[0] * S, S - p[1] * S, 4, 0, 7); g.fill(); });
  }, [ch, JSON.stringify(pts)]);
  const pos = (e) => { const r = cv.current.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]; };
  const set2 = (np) => onChange({ ...cur, [ch]: np });
  const down = (e) => {
    const p = pos(e); let i = pts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.04);
    if (e.button === 2 || e.altKey) { if (i > 0 && i < pts.length - 1) set2(pts.filter((_, k) => k !== i)); return; }
    let np = pts; if (i < 0) { np = [...pts, p].sort((a, b) => a[0] - b[0]); i = np.findIndex((q) => q === p); set2(np); }
    drag.current = { i, np };
    const mv = (ev) => { const q = pos(ev); const arr = [...drag.current.np]; const last = arr.length - 1; arr[drag.current.i] = [drag.current.i === 0 ? 0 : drag.current.i === last ? 1 : Math.min(arr[drag.current.i + 1][0] - 0.01, Math.max(arr[drag.current.i - 1][0] + 0.01, q[0])), q[1]]; drag.current.np = arr; onChange({ ...cur, [ch]: arr }); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  return (
    <div>
      <div className="param">{[['master', 'RGB'], ['r', 'R'], ['g', 'G'], ['b', 'B'], ['hs', 'Hue vs Sat']].map(([k, l]) => <button key={k} className={ch === k ? 'active' : ''} onClick={() => setCh(k)}>{l}</button>)}<button onClick={() => set2(ch === 'hs' ? [[0, 0.5], [1, 0.5]] : [[0, 0], [1, 1]])}>Reset</button></div>
      <canvas ref={cv} width={S} height={S} style={{ width: S, height: S, cursor: 'crosshair' }} onMouseDown={down} onContextMenu={(e) => e.preventDefault()} />
      <div className="dim note">Click to add a point, drag to move, Alt/right-click to delete{ch === 'hs' ? ' - middle line = no change' : ''}</div>
    </div>
  );
}

export function Lumetri() {
  const sel = useStore((s) => s.selection);
  const seq = useStore((s) => s.sequence);
  const clip = seq.clips.find((c) => c.id === sel[0] && seq.tracks.find((t) => t.id === c.track)?.kind === 'video');
  const [lutErr, setLutErr] = React.useState('');
  const [busy, setBusy] = React.useState(''); const [ref, setRef] = React.useState({ id: '', t: null, faces: true });
  const cmp = useStore((s) => s.compare);
  if (!clip) return <Empty>Select a video clip to color-correct it</Empty>;
  const work = (label, fn) => { setBusy(label); setLutErr(''); fn().catch((e) => setLutErr(String(e.message || e))).finally(() => setBusy('')); };
  // Color Match follows the Comparison View: in Shot comparison its reference frame is the match reference (Premiere)
  const shot = cmp?.on && cmp.kind === 'shot' ? shotClipAt(seq, cmp.refTime) : null;
  const viewRef = shot && shot.mediaId && !shot.asAudio && shot.id !== clip.id ? shot : null;
  const matchRef = viewRef ? { id: viewRef.id, t: cmp.refTime, faces: ref.faces } : ref;
  const refMid = (r) => (r.t != null ? r.t : (() => { const c = seq.clips.find((x) => x.id === r.id); return c ? c.start + c.dur / 2 : getState().playhead; })());
  const openCompare = () => run('view.comparisonView', { on: true, kind: 'shot', ...(ref.id ? { refTime: refMid(ref) } : {}) });
  const refs = seq.clips.filter((c) => c.id !== clip.id && c.mediaId && !c.asAudio && seq.tracks.find((t) => t.id === c.track)?.kind === 'video');
  const l = { ...LUMETRI_DEFAULTS, ...clip.lumetri };
  const setL = (k, v) => mutate('Lumetri', clip.id, (c) => { c.lumetri = { ...LUMETRI_DEFAULTS, ...c.lumetri, [k]: v }; });
  const slider = ([k, label, min, max, step]) => (
    <div className="param" key={k}><label>{label}</label>
      <input type="range" min={min} max={max} step={step || 1} value={l[k]} onChange={(e) => setL(k, +e.target.value)} onDoubleClick={() => setL(k, LUMETRI_DEFAULTS[k])} />
      <input className="num" type="number" step={step || 1} value={l[k]} onChange={(e) => setL(k, +e.target.value)} /></div>
  );
  const browse = async (key = 'lut') => {
    const [p] = await window.editorstage.openDialog('lut'); if (!p) return;
    try { const { parseLut } = await import('../Services/lut'); parseLut(p, await window.editorstage.readText(p)); setLutErr(''); setL(key, { path: p, name: p.split(/[\\/]/).pop() }); } catch (e) { setLutErr(String(e.message || e)); }
  };
  return (
    <div className="panel-pad">
      <div className="param"><b>{clip.name}</b><span className="grow" /><button onClick={() => mutate('Reset Lumetri', clip.id, (c) => { c.lumetri = null; })}>Reset</button></div>
      <details open><summary>Basic Correction</summary>
        <div className="param"><label>Input LUT</label><span className="ell">{l.inputLut ? l.inputLut.name : 'None'}</span><button onClick={() => browse('inputLut')}>Browse…</button>{l.inputLut && <button onClick={() => setL('inputLut', undefined)}>✕</button>}</div>
        <div className="param"><label>Tone</label>
          <button disabled={!!busy} title="Auto: exposure, contrast, whites, blacks and white balance from the frame at the playhead" onClick={() => work('Auto', () => autoCorrect(clip.id, 'auto'))}>Auto</button>
          <button disabled={!!busy} title="Auto Tone: exposure, contrast, whites and blacks" onClick={() => work('Auto Tone', () => autoCorrect(clip.id, 'tone'))}>Auto Tone</button>
          <button disabled={!!busy} title="Auto Color: neutral white balance (temperature and tint)" onClick={() => work('Auto Color', () => autoCorrect(clip.id, 'color'))}>Auto Color</button>
          {busy && <span className="dim">{busy}…</span>}</div>
        {LUMETRI_UI['Basic Correction'].map(slider)}</details>
      <details><summary>Creative</summary>
        <div className="param"><label>Look</label><span className="ell">{l.lut ? l.lut.name : 'None'}</span><button onClick={() => browse('lut')}>Browse LUT…</button>{l.lut && <button onClick={() => setL('lut', undefined)}>✕</button>}</div>
        {lutErr && <div className="err note">{lutErr}</div>}
        {l.lut && slider(['lutAmt', 'Intensity', 0, 100])}
        {LUMETRI_UI.Creative.map(slider)}
      </details>
      <details><summary>Curves</summary><CurveEditor curves={l.curves} onChange={(c) => setL('curves', c)} /></details>
      <details><summary>Color Wheels &amp; Match</summary>
        <div className="param"><label>Comparison View</label><button title="Show the reference frame next to this one in the Program Monitor (its reference becomes the match reference)" className={cmp?.on ? 'active' : ''} onClick={() => (cmp?.on ? run('view.comparisonView', { on: false }) : openCompare())}>{cmp?.on ? 'Close' : 'Open'}</button></div>
        {viewRef ? <div className="param"><label>Reference</label><span className="ell" title="The Shot reference of the Comparison View">{viewRef.track} · {viewRef.name} @ {cmp.refTime.toFixed(2)} s</span></div> : <>
          {cmp?.on && cmp.kind === 'shot' && <div className="note dim">The Comparison View reference has no picture from another clip: move it to another shot.</div>}
          <div className="param"><label>Reference</label><select value={ref.id} onChange={(e) => setRef({ ...ref, id: e.target.value })}><option value="">Choose a clip…</option>{refs.map((c) => <option key={c.id} value={c.id}>{c.track} · {c.name}</option>)}</select></div>
          <div className="param"><label>Reference frame</label><span className="dim">{ref.t == null ? 'middle of the clip' : `${ref.t.toFixed(2)} s`}</span><button title="Use the frame at the playhead as the reference" onClick={() => setRef({ ...ref, t: getState().playhead })}>Set from playhead</button></div>
        </>}
        <div className="param"><label>Face Detection</label><input type="checkbox" checked={ref.faces} onChange={(e) => setRef({ ...ref, faces: e.target.checked })} /><span className="dim">match skin tones</span></div>
        <div className="param"><label /><button disabled={!!busy || !matchRef.id} title="Match the clip at the playhead to the reference frame (sets Basic Correction sliders)" onClick={() => work('Apply Match', async () => { await applyColorMatch(clip.id, matchRef.id, matchRef.t, matchRef.faces); if (!getState().compare?.on) openCompare(); })}>Apply Match</button></div>
        {LUMETRI_UI['Color Wheels & Match'].map(slider)}</details>
      <details><summary>HSL Secondary</summary>
        <div className="param"><label>Enable</label><input type="checkbox" checked={!!l.hslOn} onChange={(e) => setL('hslOn', e.target.checked ? 1 : 0)} /><label>Show mask</label><input type="checkbox" checked={!!l.hslMask} onChange={(e) => setL('hslMask', e.target.checked ? 1 : 0)} /></div>
        {HSL_UI.map(slider)}
      </details>
      <details><summary>Vignette</summary>{LUMETRI_UI.Vignette.map(slider)}</details>
    </div>
  );
}