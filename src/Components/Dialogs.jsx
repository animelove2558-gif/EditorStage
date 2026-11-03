import React, { useState, useRef, useEffect } from 'react';
import NumInput from './NumInput';
import { useStore, set, edit, getState, allSeqs } from '../Core/store';
import { TOOLS } from '../Core/tools';
import { MENUS } from '../Core/menus';
import { combos, DEFAULT_COMBOS, combosFor, comboLabel, comboOf, bindKey, setKeymap, saveKeymap, resetKeymap } from '../Core/shortcuts';
import { PRESETS, PLATFORM_PRESETS, LOUDNESS_TARGETS, FIT_MODES, HW_LABELS, ALT_LABELS, supportsChapters, detectEncoders, renderFrame, softwareVideo, resetEncoderChoices } from '../Services/exporter';
import { ffmpegInfo, GPL_ENCODERS, GPL_FEATURES, IMPORT_ALT } from '../Services/ffmpegCaps';
import { queueExport, cancelExport, removeExport, clearFinishedExports } from '../Services/exportQueue';
import { runHealthCheck, gotoIssue } from '../Services/healthCheck';
import { sequenceEnd, setSpeed as setSpeedOp, conformToFps } from '../Core/editing';
import { getPrefs, setPrefs, resetPrefs, PREF_DEFAULTS } from '../Core/prefs';
import { synchronizeClips, importRecording, addMediaToTimeline, cancelRender, commands, seqFromSelection, createMulticam } from '../Core/commands';
import FontPicker from './FontPicker';
import { RemixDialogBody } from './RemixControls';
import { fontsUsed, isFontInstalled } from '../Services/fonts';
import { aspectLabel } from './Panels';
import { presetFromClip, saveUserPreset, PRESET_TYPES } from '../Core/presets';
import { CHANNEL_MODES } from '../Services/audioEngine';
import { mediaRange } from '../Core/commands';
import { sourceAt } from '../Core/clipTime';
import { MARKER_COLORS, MARKER_TYPES, markerColor } from '../Core/markers';
import { markerList, updateMarker, attributeSources, pasteAttributes, removeAttributes, createSequence } from '../Core/commands';
import { attrsOf, attrsOfMany } from '../Core/attributes';
import { timecode } from './Timeline';
import { trackPoint, defaultTrackTarget } from '../Services/tracking';
import { sceneEditDetection } from '../Services/sceneDetect';
import { PROXY_PRESETS, PROXY_SIZES, createProxies } from '../Services/proxy';
import { offlineItems, linkMedia, relinkOthersNear, findMissing } from '../Services/mediaLink';
import { evalParam, DEFAULT_MOTION } from '../Core/params';
import { SYNTHETIC_TYPES, COUNTDOWN_DEFAULTS, makeSyntheticMedia } from '../Services/synthetic';

const close = () => set({ dialog: null });
function Modal({ title, children, footer, wide }) {
  return (
    <div className="modal-back" onMouseDown={close}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}<button onClick={close}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
const Row = ({ label, children }) => <div className="mrow"><label>{label}</label>{children}</div>;

function selClips(s) { return s.sequence.clips.filter((c) => s.selection.includes(c.id)); }

function SpeedDialog() {
  const s = useStore((x) => x); const fps = s.sequence.fps;
  const clips = selClips(s).filter((c) => c.mediaId || c.nestId); const c = clips[0];
  const [speed, setSpeed] = useState(Math.round(Math.abs(c?.speed || 1) * 10000) / 100);
  const [dur, setDur] = useState(c?.dur || 1); const [linked, setLinked] = useState(true);
  const [reverse, setReverse] = useState(!!c?.reverse); const [pitch, setPitch] = useState(!!c?.maintainPitch);
  const [ripple, setRipple] = useState(false); const [sampling, setSampling] = useState(c?.frameSampling || 'sample');
  if (!c) return <Modal title="Clip Speed / Duration" footer={<button onClick={close}>OK</button>}>Select a video or audio clip first.</Modal>;
  const base = c.dur * Math.abs(c.speed || 1); // duration at 100%
  const onSpeed = (v) => { const sp = Math.min(10000, Math.max(1, v)); setSpeed(sp); if (linked) setDur(base / (sp / 100)); };
  const onDur = (v) => { const d = Math.max(1 / fps, v); setDur(d); if (linked) setSpeed(Math.round((base / d) * 10000) / 100); };
  const ok = () => {
    const ids = clips.map((x) => x.id); const nests = new Set(clips.filter((x) => x.nestId).map((x) => x.id));
    // nested sequences play forwards only (Reverse Speed applies to media clips)
    edit('Speed/Duration', ({ seq }) => { const opts = { ...(linked || clips.length > 1 ? { speed } : { dur }), maintainPitch: pitch, ripple, sampling }; setSpeedOp(seq, ids.filter((id) => !nests.has(id)), { ...opts, reverse }); setSpeedOp(seq, ids.filter((id) => nests.has(id)), opts); });
    if (reverse && nests.size) set((x) => ({ log: [...x.log.slice(-49), 'Reverse Speed is not available for nested sequences: their speed was changed, not their direction'] }));
    close();
  };
  return (
    <Modal title="Clip Speed / Duration" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
      <Row label="Speed"><NumInput type="number" min="1" max="10000" step="1" value={speed} onChange={(e) => onSpeed(+e.target.value)} /> %
        <button className={linked ? 'on' : ''} title="Link speed and duration" onClick={() => setLinked(!linked)}>{linked ? '🔗' : '⛓️‍💥'}</button></Row>
      <Row label="Duration"><TCInput value={dur} fps={fps} onChange={onDur} /></Row>
      <div className="mrow"><Check checked={reverse} onChange={setReverse}>Reverse Speed</Check></div>
      <div className="mrow"><Check checked={pitch} onChange={setPitch}>Maintain Audio Pitch</Check></div>
      <div className="mrow"><Check checked={ripple} onChange={setRipple}>Ripple Edit, Shifting Trailing Clips</Check></div>
      <Row label="Time Interpolation"><select value={sampling} onChange={(e) => setSampling(e.target.value)}>
        <option value="sample">Frame Sampling</option><option value="blend">Frame Blending</option>
      </select></Row>
      <div className="dim">{clips.length > 1 ? `${clips.length} clips. ` : ''}Speed curves (Time Remapping) stretch with the clip. Without ripple the clip stops at the next clip.</div>
    </Modal>
  );
}
/** File > Export > Frame (Program Monitor camera button): the frame at the playhead at full sequence size, as PNG or JPEG. */
function ExportFrameDialog() {
  const s = useStore((x) => x); const seq = s.sequence;
  const [name, setName] = useState(`${seq.name} ${toTC(s.playhead, seq.fps).replace(/:/g, '-')}`);
  const [fmt, setFmt] = useState('png'); const [quality, setQuality] = useState(92); const [imp, setImp] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    const path = await window.editorstage.saveDialog('export', `${name}.${fmt === 'png' ? 'png' : 'jpg'}`, fmt === 'png' ? 'png' : 'jpg'); if (!path) return;
    setBusy(true); setErr('');
    try {
      const img = await renderFrame(s.playhead, seq.width, seq.height);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d');
      if (fmt === 'jpg') { g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height; tmp.getContext('2d').putImageData(img, 0, 0); g.drawImage(tmp, 0, 0); } else g.putImageData(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', quality / 100));
      await window.editorstage.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      if (imp) { const { importPaths } = await import('../Services/media'); await importPaths([path]); }
      close();
    } catch (e) { setErr(String(e.message || e)); setBusy(false); }
  };
  return (
    <Modal title="Export Frame" footer={<><button disabled={busy} onClick={go}>{busy ? 'Rendering…' : 'OK'}</button><button onClick={close}>Cancel</button></>}>
      <Row label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Format"><select value={fmt} onChange={(e) => setFmt(e.target.value)}><option value="png">PNG</option><option value="jpg">JPEG</option></select></Row>
      {fmt === 'jpg' && <Row label="Quality"><NumInput type="number" min="10" max="100" value={quality} onChange={(e) => setQuality(Math.min(100, Math.max(10, +e.target.value)))} /></Row>}
      <div className="mrow"><Check checked={imp} onChange={setImp}>Import into project</Check></div>
      <div className="dim">{seq.width}×{seq.height} at {toTC(s.playhead, seq.fps)}, rendered exactly like Export.</div>
      {err && <div className="err note">{err}</div>}
    </Modal>
  );
}
/** File > New > Adjustment Layer / Bars and Tone / Black Video / Color Matte / Universal Counting Leader / Transparent Video.
 * With mediaId (double-click the item in the Project panel) it modifies that item instead. */
function SyntheticDialog({ type, mediaId }) {
  const s = useStore((x) => x); const seq = s.sequence; const old = mediaId && s.media.find((m) => m.id === mediaId);
  const T = SYNTHETIC_TYPES[old?.synthetic.type || type]; const typ = old?.synthetic.type || type; const o = old?.synthetic || {};
  const [name, setName] = useState(old?.name || T.name); const [w, setW] = useState(o.width || seq.width); const [h, setH] = useState(o.height || seq.height);
  const [color, setColor] = useState(o.color || '#000000'); const [cd, setCd] = useState({ ...COUNTDOWN_DEFAULTS, ...o });
  const ok = () => {
    const spec = { type: typ, name, width: Math.max(2, w | 0), height: Math.max(2, h | 0), fps: o.fps || seq.fps, color, ...(typ === 'countdown' ? cd : {}) };
    const item = makeSyntheticMedia(spec);
    if (old) edit(`Modify ${T.name}`, ({ media }) => { const m = media.find((x) => x.id === old.id); Object.assign(m, { name, synthetic: item.synthetic, width: item.width, height: item.height }); });
    else { edit(`New ${T.name}`, ({ media }) => media.push(item)); set({ selectedMedia: item.id }); }
    close();
  };
  const cdc = (k, label) => <Row label={label}><input type="color" value={cd[k]} onChange={(e) => setCd({ ...cd, [k]: e.target.value })} /></Row>;
  return (
    <Modal title={old ? `Modify ${T.name}` : `New ${T.name}`} footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
      <Row label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Width"><NumInput type="number" min="2" value={w} onChange={(e) => setW(+e.target.value)} /></Row>
      <Row label="Height"><NumInput type="number" min="2" value={h} onChange={(e) => setH(+e.target.value)} /></Row>
      {typ === 'color' && <Row label="Color"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Row>}
      {typ === 'countdown' && <>
        {cdc('wipeColor', 'Wipe Color')}{cdc('bgColor', 'Background Color')}{cdc('lineColor', 'Line Color')}{cdc('targetColor', 'Target Color')}{cdc('numeralColor', 'Numeral Color')}
        <div className="mrow"><Check checked={cd.cueOut} onChange={(v) => setCd({ ...cd, cueOut: v })}>Cue Blip on out</Check></div>
        <div className="mrow"><Check checked={cd.cueOn2} onChange={(v) => setCd({ ...cd, cueOn2: v })}>Cue Blip on 2</Check></div>
        <div className="mrow"><Check checked={cd.cueAll} onChange={(v) => setCd({ ...cd, cueAll: v })}>Cue Blip at all Second Starts</Check></div>
      </>}
      <div className="dim">{{ adjustment: 'Effects on this clip apply to every track below it.', bars: 'SMPTE color bars with a 1 kHz tone at -12 dBFS.', countdown: '8 to 2 countdown with a 2-pop, then black (11 s).', transparent: 'An empty (alpha 0) frame, e.g. for effects that generate an image.' }[typ] || ''}</div>
    </Modal>
  );
}
/** Clip > Track Object (Point Tracker): the selected clip (title, sticker, graphic, video...) follows a point of the video below. */
function TrackObjectDialog({ clipId }) {
  const s = useStore((x) => x); const seq = s.sequence; const F = seq.clips.find((c) => c.id === (clipId || s.selection[0]));
  const pos = F ? evalParam({ ...DEFAULT_MOTION(), ...(F.motion || {}) }.position, Math.max(0, s.playhead - F.start)) : [0.5, 0.5];
  const def = F && defaultTrackTarget(seq, F, s.playhead);
  const cands = F ? seq.clips.filter((c) => c.id !== F.id && !c.asAudio && s.media.find((m) => m.id === c.mediaId && m.kind === 'video' && !m.synthetic) && c.start < F.start + F.dur && c.start + c.dur > F.start) : [];
  const [target, setTarget] = useState(def?.id || cands[0]?.id || ''); const [x, setX] = useState(Math.round(pos[0] * 1000) / 10); const [y, setY] = useState(Math.round(pos[1] * 1000) / 10);
  const [box, setBox] = useState(15); const [dir, setDir] = useState(0); const [fs, setFs] = useState(false); const [fr, setFr] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (!F) return <Modal title="Track Object" footer={<button onClick={close}>OK</button>}>Select the clip that should follow an object (a title, sticker or any clip) first.</Modal>;
  const go = async () => {
    setBusy(true); setErr('');
    try { await trackPoint(F.id, target, { point: [x / 100, y / 100], box: box / 100, dir: +dir, scale: fs, rotation: fr }); close(); }
    catch (e) { setErr(String(e.message || e)); setBusy(false); }
  };
  return (
    <Modal title="Track Object (Point Tracker)" footer={<><button disabled={busy || !target} onClick={go}>{busy ? 'Tracking…' : 'Track'}</button><button onClick={() => { if (busy) import('../Services/tracking').then((m) => m.cancelTracking()); close(); }}>Cancel</button></>}>
      <Row label="Follower"><span>{F.name}</span></Row>
      <Row label="Track in"><select value={target} onChange={(e) => setTarget(e.target.value)}>{!cands.length && <option value="">(no video clip overlaps)</option>}{cands.map((c) => <option key={c.id} value={c.id}>{c.track} · {c.name}</option>)}</select></Row>
      <Row label="Point X %"><NumInput type="number" step="0.1" value={x} onChange={(e) => setX(+e.target.value)} /></Row>
      <Row label="Point Y %"><NumInput type="number" step="0.1" value={y} onChange={(e) => setY(+e.target.value)} /></Row>
      <Row label="Search box %"><NumInput type="number" min="3" max="80" value={box} onChange={(e) => setBox(Math.min(80, Math.max(3, +e.target.value)))} /></Row>
      <Row label="Direction"><select value={dir} onChange={(e) => setDir(e.target.value)}><option value={0}>Both (from the playhead)</option><option value={1}>Forward</option><option value={-1}>Backward</option></select></Row>
      <div className="mrow"><Check checked={fs} onChange={setFs}>Follow scale</Check> <Check checked={fr} onChange={setFr}>Follow rotation</Check></div>
      <div className="dim">The point (in % of the frame) starts at the follower's Position. Motion keyframes are written, so the path can be edited or undone.</div>
      {s.tracking && <div className="dim">{s.tracking.label}: {Math.round(s.tracking.p * 100)}%</div>}
      {err && <div className="err note">{err}</div>}
    </Modal>
  );
}
/** Clip > Scene Edit Detection: cut at, make subclips of, or mark the scene changes inside the selected clips (FFmpeg scdet). */
function SceneDetectDialog() {
  const s = useStore((x) => x); const ids = s.selection;
  const [cut, setCut] = useState(true); const [subs, setSubs] = useState(false); const [marks, setMarks] = useState(false); const [th, setTh] = useState(10);
  const [prog, setProg] = useState(null); const [msg, setMsg] = useState(''); const job = useRef(null);
  const go = () => {
    setMsg(''); setProg(0);
    job.current = sceneEditDetection(ids, { cut, subclips: subs, markers: marks, threshold: th, onProgress: setProg });
    job.current.then((r) => { setProg(null); if (!r.cuts) setMsg('No scene changes found (try a lower threshold)'); else close(); }).catch((e) => { setProg(null); setMsg(String(e.message || e)); });
  };
  return (
    <Modal title="Scene Edit Detection" footer={<><button disabled={prog != null || !ids.length || !(cut || subs || marks)} onClick={go}>Analyze</button><button onClick={() => { job.current?.cancel(); close(); }}>Cancel</button></>}>
      <div className="mrow"><Check checked={cut} onChange={setCut}>Apply a cut at each detected cut point</Check></div>
      <div className="mrow"><Check checked={subs} onChange={setSubs}>Create a subclip for each detected cut point</Check></div>
      <div className="mrow"><Check checked={marks} onChange={setMarks}>Generate a marker at each detected cut point</Check></div>
      <Row label="Threshold"><NumInput type="number" min="1" max="100" value={th} onChange={(e) => setTh(Math.min(100, Math.max(1, +e.target.value)))} /></Row>
      <div className="dim">Lower threshold = more sensitive. Works on the selected video clips (linked audio is cut too).</div>
      {prog != null && <div className="mrow"><progress max="1" value={prog} style={{ flex: 1 }} /> {Math.round(prog * 100)}%</div>}
      {msg && <div className="err note">{msg}</div>}
    </Modal>
  );
}
/** Proxy > Create Proxies: background FFmpeg jobs (progress in the Project panel). */
function CreateProxiesDialog() {
  const s = useStore((x) => x); const sel = s.media.find((m) => m.id === s.selectedMedia);
  const videos = s.media.filter((m) => m.kind === 'video' && m.path && !m.synthetic && m.status === 'ready');
  const [scope, setScope] = useState(sel?.kind === 'video' ? 'selected' : 'all'); const [preset, setPreset] = useState('h264'); const [height, setHeight] = useState(540);
  const [dest, setDest] = useState('');
  const ids = scope === 'selected' && sel ? [sel.id] : videos.filter((m) => scope !== 'missing' || !m.proxy).map((m) => m.id);
  return (
    <Modal title="Create Proxies" footer={<><button disabled={!ids.length} onClick={() => { createProxies(ids, { preset, height: +height, dest }); close(); }}>OK</button><button onClick={close}>Cancel</button></>}>
      <Row label="Items"><select value={scope} onChange={(e) => setScope(e.target.value)}>{sel?.kind === 'video' && <option value="selected">Selected: {sel.name}</option>}<option value="all">All video items ({videos.length})</option><option value="missing">Video items without a proxy</option></select></Row>
      <Row label="Format"><select value={preset} onChange={(e) => setPreset(e.target.value)}>{Object.entries(PROXY_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Row>
      <Row label="Size"><select value={height} onChange={(e) => setHeight(e.target.value)}>{PROXY_SIZES.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></Row>
      <Row label="Destination"><span className="ell">{dest || 'Proxies folder next to the original media'}</span><button onClick={async () => { const d = await window.editorstage.pickFolder(); if (d) setDest(d); }}>Browse…</button>{dest && <button onClick={() => setDest('')}>✕</button>}</Row>
      <div className="dim">Proxies are used for playback when View &gt; Toggle Proxies is on. Export always uses the full-resolution media.</div>
    </Modal>
  );
}
/** File > Link Media (also opens by itself when a project has missing files): locate files, search folders by name + size. */
function LinkMediaDialog() {
  const s = useStore((x) => x); const items = offlineItems(s);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const locate = async (m) => {
    const [p] = await window.editorstage.openDialog('media'); if (!p) return;
    setBusy(true); setMsg('');
    try { await linkMedia(m.id, p); const n = await relinkOthersNear(p); setMsg(n ? `Also found ${n} other file(s) in that location` : ''); } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  };
  const search = async () => {
    const d = await window.editorstage.pickFolder(); if (!d) return;
    setBusy(true); setMsg('Searching…');
    try { const hits = await findMissing([d]); let n = 0; for (const h of hits) { try { await linkMedia(h.id, h.path); n++; } catch { /* stays offline */ } } setMsg(`Relinked ${n} of ${items.length}`); } catch (e) { setMsg(String(e.message || e)); }
    setBusy(false);
  };
  return (
    <Modal wide title="Link Media" footer={<><button disabled={busy || !items.length} onClick={search}>Search…</button><button onClick={close}>{items.length ? 'Offline All' : 'OK'}</button></>}>
      {!items.length ? <div>All media is online.</div> : <>
        <div className="dim">These files are missing. Locate one (the others are then searched for next to it) or search a folder — matched by file name and size.</div>
        <ul className="list linkmedia">{items.map((m) => <li key={m.id}><span className="ell" title={m.path}>⚠ {m.name} <span className="dim">{m.path}</span></span><button disabled={busy} onClick={() => locate(m)}>Locate…</button></li>)}</ul>
      </>}
      {msg && <div className="note">{msg}</div>}
    </Modal>
  );
}
function AudioGainDialog() {
  const s = useStore((x) => x); const c = selClips(s)[0];
  const [g, setG] = useState(c?.audio?.gain ?? 0);
  if (!c) return <Modal title="Audio Gain" footer={<button onClick={close}>OK</button>}>Select an audio clip first.</Modal>;
  return (
    <Modal title="Audio Gain" footer={<><button onClick={() => { edit('Audio Gain', ({ seq, sel }) => seq.clips.filter((x) => sel.includes(x.id)).forEach((x) => { x.audio = { ...x.audio, gain: g }; })); close(); }}>OK</button><button onClick={close}>Cancel</button></>}>
      <Row label="Adjust Gain by (dB)"><NumInput type="number" step="0.5" value={g} onChange={(e) => setG(+e.target.value)} /></Row>
    </Modal>
  );
}
function RenameDialog() {
  const s = useStore((x) => x); const c = selClips(s)[0];
  const [n, setN] = useState(c?.name || '');
  if (!c) return <Modal title="Rename Clip" footer={<button onClick={close}>OK</button>}>Select a clip first.</Modal>;
  const ok = () => { edit('Rename', ({ seq, sel }) => seq.clips.filter((x) => sel.includes(x.id)).forEach((x) => { x.name = n; })); close(); };
  return <Modal title="Rename Clip" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}><Row label="Clip name"><input autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /></Row></Modal>;
}
const SEQ_PRESETS = { 'HD 1080p (1920×1080)': [1920, 1080], '4K UHD (3840×2160)': [3840, 2160], 'HD 720p (1280×720)': [1280, 720], 'Vertical 1080×1920 (Shorts / Reels / TikTok)': [1080, 1920], 'Square 1080×1080': [1080, 1080], 'Portrait 4:5 (1080×1350)': [1080, 1350], 'DCI 4K (4096×2160)': [4096, 2160] };
const PARS = [['1/1', 'Square Pixels (1.0)'], ['10/11', 'D1/DV NTSC (0.9091)'], ['40/33', 'D1/DV NTSC Widescreen 16:9 (1.2121)'], ['59/54', 'D1/DV PAL (1.0940)'], ['118/81', 'D1/DV PAL Widescreen 16:9 (1.4587)'], ['4/3', 'HD Anamorphic 1080 (1.333)'], ['2/1', 'Anamorphic 2:1 (2.0)']];
const FPS_LIST = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
/** the fields Sequence Settings and New Sequence share */
function SequenceFields({ v, setV, tracks }) {
  const p = (k, num) => (e) => setV({ ...v, [k]: num ? +e.target.value : e.target.value });
  return <>
    <Row label="Name"><input value={v.name} onChange={p('name')} /></Row>
    <Row label="Preset"><select value="" onChange={(e) => { const x = SEQ_PRESETS[e.target.value]; if (x) setV({ ...v, width: x[0], height: x[1] }); }}><option value="">Choose a preset…</option>{Object.keys(SEQ_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></Row>
    <Row label="Frame size"><NumInput type="number" value={v.width} onChange={p('width')} /> × <NumInput type="number" value={v.height} onChange={p('height')} />
      <button title="Swap width and height (horizontal ⇄ vertical)" onClick={() => setV({ ...v, width: v.height, height: v.width })}>⇄</button></Row>
    {+v.width > 0 && +v.height > 0 && (() => { const k = Math.min(200 / +v.width, 100 / +v.height); return (
      <div className="seq-preview"><div style={{ width: Math.round(+v.width * k), height: Math.round(+v.height * k) }} /><span>{+v.width}×{+v.height}<br />{aspectLabel(+v.width, +v.height)} · {+v.width > +v.height ? 'horizontal' : +v.width < +v.height ? 'vertical' : 'square'}</span></div>
    ); })()}
    <Row label="Frame rate"><select value={v.fps} onChange={p('fps', true)}>{FPS_LIST.map((f) => <option key={f} value={f}>{f} fps</option>)}</select></Row>
    <Row label="Pixel Aspect Ratio"><select value={v.par} onChange={p('par')}>{PARS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Row>
    <Row label="Audio Sample Rate"><select value={v.sampleRate} onChange={p('sampleRate', true)}><option value={48000}>48000 Hz</option><option value={44100}>44100 Hz</option></select></Row>
    {tracks && <Row label="Tracks"><span>Video <NumInput type="number" min="1" max="20" style={{ width: 48 }} value={v.vt} onChange={p('vt', true)} /> Audio <NumInput type="number" min="1" max="20" style={{ width: 48 }} value={v.at} onChange={p('at', true)} /></span></Row>}
  </>;
}
function SequenceSettingsDialog() {
  const seq = useStore((x) => x.sequence);
  const [v, setV] = useState({ width: seq.width, height: seq.height, fps: seq.fps, name: seq.name, par: seq.par || '1/1', sampleRate: seq.sampleRate || 48000 });
  const fpsChanged = +v.fps !== seq.fps && (seq.clips.length || seq.markers.length);
  const ok = () => {
    edit('Sequence Settings', ({ seq: q }) => { Object.assign(q, { width: +v.width, height: +v.height, name: v.name, par: v.par, sampleRate: +v.sampleRate }); if (+v.fps !== q.fps) conformToFps(q, +v.fps); });
    close();
  };
  return (
    <Modal title="Sequence Settings" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
      <SequenceFields v={v} setV={setV} />
      {fpsChanged && <div className="ks-note warn">Changing the frame rate moves every clip edge, transition, marker and keyframe to the nearest frame of {v.fps} fps (one undo step).</div>}
    </Modal>
  );
}
/** File > New > Sequence (Ctrl+N, Premiere): name, preset, frame size, rate, pixel aspect, sample rate and track counts */
function NewSequenceDialog() {
  const base = getState().sequence; const prefs = getPrefs();
  const [v, setV] = useState({ name: `Sequence ${String(Object.keys(allSeqs()).length + 1).padStart(2, '0')}`, width: base.width, height: base.height, fps: base.fps, par: base.par || '1/1', sampleRate: base.sampleRate || 48000, vt: prefs.videoTracks, at: prefs.audioTracks });
  const ok = () => { close(); createSequence({ ...v, width: +v.width, height: +v.height }); };
  return <Modal title="New Sequence" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}><SequenceFields v={v} setV={setV} tracks /></Modal>;
}
function ProjectSettingsDialog() {
  const name = useStore((x) => x.projectName);
  const [n, setN] = useState(name);
  return <Modal title="Project Settings" footer={<><button onClick={() => { set({ projectName: n }); close(); }}>OK</button><button onClick={close}>Cancel</button></>}>
    <Row label="Project name"><input value={n} onChange={(e) => setN(e.target.value)} /></Row>
    <Row label="Scratch disks"><span className="dim">Captured video / previews: userData/media-cache</span></Row>
    <Row label="Ingest"><span className="dim">Non-native formats are transcoded to H.264/PCM/PNG proxies via FFmpeg on import</span></Row>
  </Modal>;
}
/** Effect Controls > Save Preset…: the picked effects (and optionally Motion / Opacity / Lumetri) of a clip become a preset in My Presets */
function SavePresetDialog({ clipId, fxId }) {
  const clip = getState().sequence.clips.find((c) => c.id === clipId);
  const fxs = clip?.effects || [];
  const [name, setName] = useState(fxs.find((f) => f.id === fxId)?.name || 'Custom Preset');
  const [type, setType] = useState('anchorIn'); const [description, setDescription] = useState('');
  const [picked, setPicked] = useState(fxId ? [fxId] : fxs.map((f) => f.id));
  const [inc, setInc] = useState({ motion: false, opacity: false, lumetri: false });
  if (!clip) return <Modal title="Save Preset" footer={<button onClick={close}>OK</button>}>Select a clip first.</Modal>;
  const nothing = !picked.length && !inc.motion && !inc.opacity && !inc.lumetri;
  const ok = async () => { if (nothing || !name.trim()) return; await saveUserPreset(presetFromClip(clip, { name: name.trim(), type, fxIds: picked, description, ...inc })); close(); };
  return (
    <Modal title="Save Preset" footer={<><button disabled={nothing || !name.trim()} onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
      <Row label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Row>
      <Row label="Type">{PRESET_TYPES.map(([k, l]) => <label key={k} style={{ marginRight: 8 }}><input type="radio" checked={type === k} onChange={() => setType(k)} /> {l}</label>)}</Row>
      <div className="dim note">Scale: keyframes stretch with the clip. Anchor to In / Out Point: keyframe timing is kept from the clip's start / end.</div>
      <Row label="Include"><div>
        {fxs.map((f) => <div key={f.id}><label><input type="checkbox" checked={picked.includes(f.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, f.id] : picked.filter((x) => x !== f.id))} /> {f.name}</label></div>)}
        {[['motion', 'Motion'], ['opacity', 'Opacity'], ['lumetri', 'Lumetri Color']].map(([k, l]) => <div key={k}><label><input type="checkbox" checked={inc[k]} disabled={k === 'lumetri' && !clip.lumetri} onChange={(e) => setInc({ ...inc, [k]: e.target.checked })} /> {l}</label></div>)}
      </div></Row>
      <Row label="Description"><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Row>
    </Modal>
  );
}
function RenameMediaDialog({ id }) {
  const m = getState().media.find((x) => x.id === id); const [n, setN] = useState(m?.name || '');
  if (!m) return <Modal title="Rename" footer={<button onClick={close}>OK</button>}>The item no longer exists.</Modal>;
  const ok = () => { if (n.trim()) edit('Rename', ({ media }) => { const x = media.find((q) => q.id === id); if (x) x.name = n.trim(); }); close(); };
  return <Modal title="Rename" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}><Row label="Name"><input autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /></Row></Modal>;
}
function RenameTrackDialog({ id }) {
  const t = useStore((x) => x.sequence.tracks.find((q) => q.id === id));
  const [n, setN] = useState(t?.name || '');
  if (!t) return <Modal title="Rename Track" footer={<button onClick={close}>OK</button>}>The track no longer exists.</Modal>;
  // an empty name shows the track number again
  const ok = () => { edit('Rename Track', ({ seq }) => { const q = seq.tracks.find((x) => x.id === id); q.name = n.trim() || undefined; }); close(); };
  return <Modal title={`Rename Track ${id}`} footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}><Row label="Track name"><input autoFocus value={n} placeholder={id} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /></Row></Modal>;
}
/** checkbox list of attributes grouped Video / Audio; value = Set of keys */
function AttrChecks({ rows, on, setOn }) {
  const flip = (k) => { const n = new Set(on); if (n.has(k)) n.delete(k); else n.add(k); setOn(n); };
  return ['video', 'audio'].map((kind) => { const rs = rows.filter((r) => r.kind === kind); if (!rs.length) return null;
    const all = rs.every((r) => on.has(r.key)); const setAll = () => { const n = new Set(on); rs.forEach((r) => (all ? n.delete(r.key) : n.add(r.key))); setOn(n); };
    return <div key={kind} className="attr-group"><label className="attr-head"><input type="checkbox" checked={all} onChange={setAll} /> {kind === 'video' ? 'Video Attributes' : 'Audio Attributes'}</label>
      {rs.map((r) => <label key={r.key} className="attr-row"><input type="checkbox" checked={on.has(r.key)} onChange={() => flip(r.key)} /> {r.label}</label>)}</div>; });
}
/** Edit > Paste Attributes (Premiere): choose what to copy from the copied clip, and whether keyframe times follow the new length */
function PasteAttributesDialog() {
  const { v, a } = attributeSources();
  const rows = [...(v ? attrsOf(v).filter((r) => r.kind === 'video') : []), ...(a ? attrsOf(a).filter((r) => r.kind === 'audio') : [])];
  const [on, setOn] = useState(() => new Set(rows.map((r) => r.key))); const [scale, setScale] = useState(true);
  const ok = () => { close(); pasteAttributes(rows.filter((r) => r.kind === 'video' && on.has(r.key)).map((r) => r.key), rows.filter((r) => r.kind === 'audio' && on.has(r.key)).map((r) => r.key), scale); };
  return <Modal title={`Paste Attributes${v || a ? ` from "${(v || a).name || 'clip'}"` : ''}`} footer={<><button onClick={ok} disabled={!on.size}>OK</button><button onClick={close}>Cancel</button></>}>
    <label className="attr-row"><input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} /> Scale Attribute Times</label>
    {rows.length ? <AttrChecks rows={rows} on={on} setOn={setOn} /> : <div className="dim">The copied clip has no attributes to paste (its Motion, Opacity, Volume and effects are at their defaults).</div>}
  </Modal>;
}
/** Edit > Remove Attributes / Clip > Remove Effects (Premiere): reset the chosen attributes of the selected clips */
function RemoveAttributesDialog({ title = 'Remove Attributes' }) {
  const s = getState(); const clips = s.sequence.clips.filter((c) => s.selection.includes(c.id)); const rows = attrsOfMany(clips);
  const [on, setOn] = useState(() => new Set(rows.map((r) => r.key)));
  const ok = () => { close(); removeAttributes([...on]); };
  return <Modal title={`${title} (${clips.length} clip${clips.length === 1 ? '' : 's'})`} footer={<><button onClick={ok} disabled={!on.size}>OK</button><button onClick={close}>Cancel</button></>}>
    {rows.length ? <AttrChecks rows={rows} on={on} setOn={setOn} /> : <div className="dim">The selected clips have no attributes or effects to remove.</div>}
  </Modal>;
}
/** Marker (Premiere): name, duration, comments, colour and type of one sequence / clip / source marker */
function MarkerDialog({ scope = 'seq', owner, id }) {
  const s = getState(); const fps = s.sequence.fps || 30;
  const list = markerList({ seq: s.sequence, media: s.media }, scope, owner) || []; const m = list.find((x) => x.id === id);
  const [v, setV] = useState(() => ({ name: m?.name || '', comment: m?.comment || '', color: markerColor(m), type: m?.type || 'comment', frames: Math.round((m?.dur || 0) * fps) }));
  if (!m) return <Modal title="Marker" footer={<button onClick={close}>Close</button>}><div className="dim">This marker no longer exists.</div></Modal>;
  const ok = () => { updateMarker(scope, owner, id, { name: v.name, comment: v.comment, color: v.color, type: v.type, dur: Math.max(0, +v.frames || 0) / fps }); close(); };
  const del = () => { updateMarker(scope, owner, id, null); close(); };
  const p = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return <Modal title={scope === 'seq' ? 'Marker' : 'Clip Marker'} footer={<><button onClick={ok}>OK</button><button onClick={del}>Delete</button><button onClick={close}>Cancel</button></>}>
    <Row label="Name"><input autoFocus value={v.name} onChange={p('name')} onKeyDown={(e) => e.key === 'Enter' && ok()} /></Row>
    <Row label="In"><span>{timecode(m.time, fps)}</span></Row>
    <Row label="Duration (frames)"><NumInput type="number" min="0" value={v.frames} onChange={p('frames')} /> <span className="dim">{timecode((+v.frames || 0) / fps, fps)}</span></Row>
    <Row label="Comments"><textarea rows={3} value={v.comment} onChange={p('comment')} /></Row>
    <Row label="Marker Color"><span className="marker-colors">{MARKER_COLORS.map(([n, hex]) => <i key={hex} title={n} className={v.color === hex ? 'on' : ''} style={{ background: hex }} onClick={() => setV({ ...v, color: hex })} />)}</span></Row>
    <Row label="Marker Type"><select value={v.type} onChange={p('type')}>{MARKER_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Row>
  </Modal>;
}
function TransitionDurationDialog({ id }) {
  const seq = getState().sequence; const tr = (seq.transitions || []).find((x) => x.id === id); const fps = seq.fps || 30;
  const [fr, setFr] = useState(Math.round((tr?.dur || 1) * fps));
  const ok = () => { const d = Math.max(1, +fr || 1) / fps; edit('Transition Duration', ({ seq: q }) => { const x = (q.transitions || []).find((t) => t.id === id); if (x) x.dur = d; }); close(); };
  return <Modal title="Set Transition Duration" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
    <Row label="Duration (frames)"><NumInput type="number" min="1" autoFocus value={fr} onChange={(e) => setFr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /> <span className="dim">{((+fr || 0) / fps).toFixed(2)} s</span></Row></Modal>;
}
function ClipPropertiesDialog({ id, mediaId }) {
  const c = id ? getState().sequence.clips.find((x) => x.id === id) : null; const m = getState().media.find((x) => x.id === (mediaId || c?.mediaId));
  const [pr, setPr] = useState(null);
  useEffect(() => { if (m?.path && !m.synthetic) window.editorstage?.probe?.(m.path).then(setPr).catch(() => setPr({ ok: false })); }, [m?.path]);
  const tc = (sec) => (sec == null ? '-' : `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${(sec % 60).toFixed(2).padStart(5, '0')}`);
  const rows = [[c ? 'Clip' : 'Item', c?.name ?? m?.name], ['Type', m ? m.kind : c?.nestId ? 'Nested sequence' : c?.caption ? 'Caption' : c?.graphic ? 'Graphic' : 'Synthetic'], ['File path', m?.path || '-'],
    ['Frame size', m?.width ? `${m.width} x ${m.height}` : '-'], ['Frame rate', m?.fps ? `${m.fps} fps` : '-'], ['Media duration', tc(m?.duration)], ['Clip duration (timeline)', tc(c?.dur)],
    ['Video', pr?.ok ? pr.codec || '-' : pr ? '-' : '...'], ['Audio', pr?.ok ? pr.audio || 'none' : pr ? '-' : '...'], ['Bit rate', pr?.bitrate || '-'], ['Speed', c ? `${Math.round(Math.abs(c.speed || 1) * 100)} %${c.reverse ? ' (reversed)' : ''}` : '-']];
  return <Modal title="Properties" footer={<button onClick={close}>Close</button>}>
    <table className="props-table"><tbody>{rows.map(([k, v]) => <tr key={k}><td className="dim">{k}</td><td style={{ userSelect: 'text', wordBreak: 'break-all' }}>{v ?? '-'}</td></tr>)}</tbody></table></Modal>;
}
function UnsavedDialog({ name, onSave, onDiscard }) {
  return <Modal title="EditorStage" footer={<><button autoFocus onClick={() => { close(); onSave?.(); }}>Save</button><button onClick={() => { close(); onDiscard?.(); }}>Don't Save</button><button onClick={close}>Cancel</button></>}>
    <div>Save changes to "{name}"?</div></Modal>;
}
function NestNameDialog({ name }) {
  const [n, setN] = useState(name || '');
  const ok = () => { close(); seqFromSelection(true, n.trim() || name); };
  return <Modal title="Nested Sequence Name" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}><Row label="Name"><input autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} /></Row></Modal>;
}
function ConfirmDialog({ title, message, okLabel = 'OK', onOk }) {
  return <Modal title={title} footer={<><button onClick={() => { close(); onOk?.(); }}>{okLabel}</button><button onClick={close}>Cancel</button></>}><div>{message}</div></Modal>;
}
const FF_SOURCE = { preferences: 'set here', env: 'EDITORSTAGE_FFMPEG environment variable', build: 'build configuration (ffmpeg.json)', bundled: 'bundled ffmpeg-static' };
/** Preferences > FFmpeg: which binary runs, its license, and what the GPL-only encoders are replaced with. */
function FfmpegPrefs() {
  const [info, setInfo] = useState(null); const [msg, setMsg] = useState(''); const [alt, setAlt] = useState({});
  const load = async (refresh) => { const i = await ffmpegInfo(refresh); setInfo(i || { ok: false, error: 'not available' }); };
  useEffect(() => { load(true); }, []);
  useEffect(() => { // what each GPL feature uses with this binary
    if (!info?.ok) return; let live = true; setAlt({});
    (async () => {
      for (const f of GPL_FEATURES) {
        let v;
        if (f.main) v = info.encoders.includes(f.encoder) ? f.encoder : IMPORT_ALT.find(([e]) => info.encoders.includes(e))?.[1] ?? null;
        else { try { const r = await softwareVideo({ video: ['-c:v', f.encoder], codec: f.codec }); v = r.encoder === 'software' ? f.encoder : ALT_LABELS[r.encoder]; } catch { v = null; } }
        if (live) setAlt((a) => ({ ...a, [f.label]: v }));
      }
    })();
    return () => { live = false; };
  }, [info]);
  const use = async (p) => {
    setMsg('Checking…'); const r = await window.editorstage.setFfmpegPath(p);
    if (!r.ok) { setMsg(r.error); return; }
    resetEncoderChoices(); setMsg(''); await load(true);
  };
  const browse = async () => { const [p] = await window.editorstage.openDialog('ffmpeg'); if (p) use(p); };
  if (!info) return <Row label="FFmpeg"><span className="dim">reading…</span></Row>;
  return <>
    <Row label="FFmpeg"><span className="dim" style={{ wordBreak: 'break-all' }}>{info.ok ? `${info.version} — ${info.path}` : `not usable: ${info.error}`}</span></Row>
    <Row label=""><span className="dim">{FF_SOURCE[info.source] || info.source} · {info.ok ? (info.gpl ? 'GPL build (--enable-gpl)' : 'LGPL build') : ''}</span></Row>
    <Row label=""><span><button onClick={browse}>Choose FFmpeg…</button> {info.source === 'preferences' && <button onClick={() => use(null)}>Use Default</button>} <span className="dim">{msg}</span></span></Row>
    {info.ok && <div className="scrolly" style={{ maxHeight: 160 }}>{GPL_FEATURES.map((f) => <div className="mrow" key={f.label}><label style={{ width: 330 }}>{f.label}</label>
      <span className="dim">{alt[f.label] === undefined ? 'checking…' : alt[f.label] === null ? `unavailable (needs ${GPL_ENCODERS[f.encoder]}, GPL)` : alt[f.label] === f.encoder ? `${GPL_ENCODERS[f.encoder]} (GPL)` : alt[f.label]}</span></div>)}</div>}
  </>;
}
export const LICENSE_LINE = 'All rights reserved by BYS & RB';
/** Help > Third-Party Notices: THIRD_PARTY_LICENSES.md, plus the folder with every license text (installed app) */
function LicensesDialog() {
  const [text, setText] = useState('Loading…'); const [dir, setDir] = useState(null);
  useEffect(() => { (async () => { const f = await window.editorstage.licensesFile?.(); setText(f ? await window.editorstage.readText(f) : 'THIRD_PARTY_LICENSES.md was not found.'); setDir(await window.editorstage.licensesDir?.()); })().catch((e) => setText(String(e))); }, []);
  return <Modal wide title="Third-Party Notices" footer={<>{dir && <button onClick={() => commands['help.licensesFolder']()}>Open License Folder</button>}<button onClick={close}>OK</button></>}>
    <pre className="licenses-text">{text}</pre></Modal>;
}
/** File > Make Offline...: the media files always stay on disk (EditorStage never deletes the user's files) */
function MakeOfflineDialog({ id }) {
  const m = getState().media.find((x) => x.id === id);
  const ok = () => { commands['file.makeOfflineNow'](id); close(); };
  return <Modal title="Make Offline" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
    <div>Make <b>{m?.name}</b> offline. Its clips show "Media Offline" until you use File &gt; Link Media.</div>
    <div><label><input type="radio" checked readOnly /> Media files remain on disk</label></div>
    <div className="dim note">Deleting the media files is not offered: EditorStage never deletes your files.</div>
  </Modal>;
}
function MulticamDialog({ cams, name: name0 }) {
  const [name, setName] = useState(name0); const [sync, setSync] = useState('audio');
  const ok = () => { close(); createMulticam({ name: name.trim() || name0, sync }); };
  return <Modal title="Create Multi-Camera Source Sequence" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
    <Row label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Row>
    <Row label="Synchronize Point">{[['audio', 'Audio'], ['in', 'In Points'], ['timeline', 'Timeline Position']].map(([k, l]) => <label key={k} style={{ marginRight: 8 }}><input type="radio" checked={sync === k} onChange={() => setSync(k)} /> {l}</label>)}</Row>
    <div className="dim note">{cams} cameras (the selected video clips).</div>
  </Modal>;
}
function AboutDialog() {
  const [ver, setVer] = useState('');
  useEffect(() => { window.editorstage.version?.().then(setVer, () => {}); }, []);
  return <Modal title="About EditorStage" footer={<><button onClick={() => commands['help.licenses']()}>Third-Party Notices…</button><button onClick={close}>OK</button></>}>
    <div className="about">
      <img className="about-logo" src="logo.png" alt="" />
      <h2>EditorStage</h2>
      <div className="dim">Version {ver || '…'}</div>
      <p>Offline professional video editor</p>
      <p className="about-license">{LICENSE_LINE}</p>
      <div className="dim">Copyright © BYS &amp; RB. Third-party components are listed in Help &gt; Third-Party Notices.</div>
    </div>
  </Modal>;
}
/** Edit > Preferences: the settings kept for this user in userData/prefs.json (src/Core/prefs.js); changes apply at once */
function PreferencesDialog() {
  useStore((s) => s.prefsRev); const p = getPrefs(); const [tab, setTab] = useState('General'); const [outs, setOuts] = useState([]);
  useEffect(() => { navigator.mediaDevices?.enumerateDevices?.().then((d) => setOuts(d.filter((x) => x.kind === 'audiooutput'))).catch(() => setOuts([])); }, []);
  const num = (k, min, max, step = 1) => <NumInput type="number" min={min} max={max} step={step} value={p[k]} onChange={(e) => e.target.value !== '' && setPrefs({ [k]: Math.max(min, Math.min(max, +e.target.value)) })} />;
  const sel = (k, opts) => <select value={p[k]} onChange={(e) => setPrefs({ [k]: e.target.value })}>{opts.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select>;
  const fps = getState().sequence.fps || 30;
  const TABS = ['General', 'Timeline', 'Audio', 'Auto Save', 'Appearance', 'Media'];
  return <Modal wide title="Preferences" footer={<><button onClick={() => resetPrefs()}>Reset Preferences</button><span className="grow" /><button onClick={close}>OK</button></>}>
    <div className="pref-tabs">{TABS.map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
    {tab === 'General' && <>
      <Row label="Still Image Default Duration">{num('stillDuration', 0.04, 3600, 0.5)} <span className="dim">seconds ({Math.round(p.stillDuration * fps)} frames at {fps} fps)</span></Row>
      <Row label="Video Transition Default Duration">{num('videoTransitionDur', 0.04, 30, 0.1)} <span className="dim">seconds</span></Row>
      <Row label="Audio Transition Default Duration">{num('audioTransitionDur', 0.04, 30, 0.1)} <span className="dim">seconds</span></Row>
      <Row label="Pre-roll / Post-roll">{num('preRoll', 0, 30, 0.5)} / {num('postRoll', 0, 30, 0.5)} <span className="dim">seconds (Play Around, Shift+K)</span></Row>
      <Row label="Large Trim Offset">{num('largeTrimOffset', 1, 100, 1)} <span className="dim">frames (Trim Monitor, Ctrl+Shift+Left / Right)</span></Row>
    </>}
    {tab === 'Timeline' && <>
      <Row label="Timeline Playback Auto-Scrolling">{sel('autoScroll', [['none', 'No Scroll'], ['page', 'Page Scroll'], ['smooth', 'Smooth Scroll']])}</Row>
      <Row label="History States">{num('historySteps', 5, 1000)} <span className="dim">undo steps kept in the History panel</span></Row>
      <Row label="New sequence tracks"><span>Video {num('videoTracks', 1, 20)} Audio {num('audioTracks', 1, 20)}</span></Row>
    </>}
    {tab === 'Audio' && <>
      <Row label="Audio Output">{sel('audioOutput', [['default', 'System default'], ...outs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => [d.deviceId, d.label || `Output ${d.deviceId.slice(0, 6)}`])])}</Row>
      <Row label="Engine"><span className="dim">Web Audio, mixed at the sequence sample rate on export (Sequence Settings)</span></Row>
    </>}
    {tab === 'Auto Save' && <>
      <Row label="Automatically save every">{num('autoSaveMin', 0, 120)} <span className="dim">minutes (0 = off)</span></Row>
      <Row label="Maximum auto-saved versions">{num('autoSaveKeep', 1, 500)} <span className="dim">older auto-saves are removed from Version History; manual revisions are kept</span></Row>
    </>}
    {tab === 'Appearance' && <Row label="Brightness">{sel('brightness', [['darker', 'Darkest'], ['dark', 'Dark (default)'], ['light', 'Lighter']])}</Row>}
    {tab === 'Media' && <><Row label="Media cache"><span className="dim">userData/media-cache</span></Row><Row label="Playback"><span className="dim">Hardware decode via Chromium; preview capped at 1280 px wide</span></Row><FfmpegPrefs /></>}
  </Modal>;
}
// commands that have keys but no menu item
const KEY_ONLY_NAMES = { 'play.toggle': 'Play / Stop', 'play.around': 'Play Around', 'play.start': 'Go to Sequence Start', 'play.end': 'Go to Sequence End', 'play.pause': 'Stop (shuttle)', 'play.shuttleFwd': 'Shuttle Right', 'play.shuttleBack': 'Shuttle Left',
  'play.stepForward': 'Step Forward 1 Frame', 'play.stepBack': 'Step Back 1 Frame', 'play.nextEdit': 'Go to Next Edit Point', 'play.prevEdit': 'Go to Previous Edit Point', 'edit.insert': 'Insert', 'edit.overwrite': 'Overwrite' };
/** every command a key can run: the menu items (with their menu path) and the key-only commands */
function shortcutCommands() {
  const out = new Map();
  const walk = (items, path) => { for (const it of items) { if (!it || it === '-' || it.dynamic) continue; const lb = (typeof it.label === 'function' ? 'Link / Unlink' : it.label).replace(/\.\.\.$/, '');
    if (it.children) walk(it.children, `${path} > ${lb}`); else if (it.cmd && it.arg === undefined && !out.has(it.cmd)) out.set(it.cmd, { cmd: it.cmd, name: lb, path }); } };
  MENUS.forEach((m) => walk(m.items, m.label));
  for (const c of new Set(Object.values(DEFAULT_COMBOS))) if (!out.has(c)) out.set(c, { cmd: c, name: KEY_ONLY_NAMES[c] || c, path: 'Application' });
  return [...out.values()];
}
/** Edit > Keyboard Shortcuts (Premiere): search, click + to press a new key, × to remove one; a key used elsewhere asks before moving it */
function ShortcutsDialog() {
  useStore((s) => s.keymapRev); // re-render when the keymap changes
  const [q, setQ] = useState(''); const [rec, setRec] = useState(null); const [conflict, setConflict] = useState(null); const [msg, setMsg] = useState('');
  const cmds = useRef(shortcutCommands()).current; const ql = q.trim().toLowerCase();
  const rows = cmds.filter((c) => !ql || `${c.name} ${c.path} ${combosFor(c.cmd).map(comboLabel).join(' ')}`.toLowerCase().includes(ql));
  const nameOf = (cmd) => cmds.find((c) => c.cmd === cmd)?.name || cmd;
  useEffect(() => {
    if (!rec) return undefined;
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { setRec(null); return; }
      const combo = comboOf(e); if (!combo) return;
      const other = combos[combo];
      if (other && other !== rec) setConflict({ combo, cmd: rec, other }); else bindKey(combo, rec);
      setRec(null);
    };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [rec]);
  const exportKeys = async () => { const p = await window.editorstage.saveDialog('keymap', 'My Shortcuts.eskeys'); if (p) { await window.editorstage.writeFile(p, JSON.stringify({ app: 'EditorStage', version: 1, keys: combos }, null, 1)); setMsg('Exported ' + p); } };
  const importKeys = async () => {
    const [p] = await window.editorstage.openDialog('keymap'); if (!p) return;
    try { const j = JSON.parse(await window.editorstage.readText(p)); if (!j?.keys || typeof j.keys !== 'object') throw new Error('not a shortcuts file'); setKeymap(j.keys); await saveKeymap(); setMsg('Imported ' + p); } catch (e) { setMsg('Could not import: ' + e.message); }
  };
  const tools = TOOLS.filter((t) => t.key);
  return <Modal wide title="Keyboard Shortcuts" footer={<><button onClick={() => { resetKeymap(); setMsg('Default shortcuts restored'); }}>Reset to Default</button><button onClick={importKeys}>Import…</button><button onClick={exportKeys}>Export…</button><span className="grow" /><button onClick={close}>Close</button></>}>
    <input className="ks-search" autoFocus placeholder="Search commands or keys" value={q} onChange={(e) => setQ(e.target.value)} />
    {rec && <div className="ks-note">Press the new key for <b>{nameOf(rec)}</b> (Esc to cancel)</div>}
    {conflict && <div className="ks-note warn"><b>{comboLabel(conflict.combo)}</b> is already used by <b>{nameOf(conflict.other)}</b>.
      <button onClick={() => { bindKey(conflict.combo, conflict.cmd); setConflict(null); }}>Use it for {nameOf(conflict.cmd)}</button><button onClick={() => setConflict(null)}>Cancel</button></div>}
    {msg && <div className="ks-note dim">{msg}</div>}
    <div className="scrolly ks-list">
      {rows.map((c) => <div className={`ks-row ${rec === c.cmd ? 'rec' : ''}`} key={c.cmd}>
        <span className="ks-name" title={c.path}>{c.name}<span className="dim"> · {c.path}</span></span>
        <span className="ks-keys">{combosFor(c.cmd).map((k) => <span key={k} className="ks-key">{comboLabel(k)}<i title="Remove" onClick={() => bindKey(k, null)}>×</i></span>)}
          <button className="ks-add" title="Add a key" onClick={() => { setConflict(null); setRec(c.cmd); }}>+</button></span>
      </div>)}
      {!ql && <><div className="ks-head">Tools (fixed)</div>{tools.map((t) => <div className="ks-row" key={t.id}><span className="ks-name">{t.label}</span><span className="ks-keys"><span className="ks-key">{`${t.shift ? 'Shift+' : ''}${t.key.toUpperCase()}`}</span></span></div>)}</>}
    </div>
  </Modal>;
}

function ExportDialog() {
  const seq = useStore((x) => x.sequence); const inP = useStore((x) => x.inPoint), outP = useStore((x) => x.outPoint);
  const queue = useStore((x) => x.exportQueue || []);
  const end = sequenceEnd(seq);
  const [platform, setPlatform] = useState('');
  const [preset, setPreset] = useState('H.264 (MP4)');
  const [range, setRange] = useState(inP != null && outP != null ? 'inout' : 'all');
  const [w, setW] = useState(seq.width), [h, setH] = useState(seq.height), [fps, setFps] = useState(seq.fps);
  const [fit, setFit] = useState('fit');
  const [audio, setAudio] = useState(true);
  const [loud, setLoud] = useState(null); const [tp, setTp] = useState(-1);
  const [chapters, setChapters] = useState(true);
  const [hw, setHw] = useState(null); const [encoder, setEncoder] = useState('software');
  const [smart, setSmart] = useState(true);
  const [burn, setBurn] = useState(true); const [sidecar, setSidecar] = useState('');
  const hasCaps = seq.clips.some((c) => c.caption);
  const [jobId, setJobId] = useState(null);
  const [health, setHealth] = useState(null); const [showHealth, setShowHealth] = useState(false);
  useEffect(() => { let live = true; setHealth(null); runHealthCheck({ loudness: audio ? loud ?? -14 : null, audio }).then((r) => live && setHealth(r)).catch(() => live && setHealth([])); return () => { live = false; }; }, [audio, loud]);
  useEffect(() => { let live = true; detectEncoders().then((r) => { if (live) setHw(r); }); return () => { live = false; }; }, []);
  const P = PRESETS[preset];
  const hwFor = (P.codec && hw?.[P.codec]) || [];
  useEffect(() => { setEncoder(hwFor[0] || 'software'); }, [preset, hw]);
  const [sw, setSw] = useState(null); // software encoder with this FFmpeg (an LGPL build has no x264 / x265)
  useEffect(() => { let live = true; setSw(null); if (P.audioOnly || P.ext === 'gif') return; softwareVideo(P, { width: +w, height: +h, fps: +fps }).then((r) => live && setSw(r), (e) => live && setSw({ error: e.message })); return () => { live = false; }; }, [preset]);
  const a = range === 'inout' ? inP ?? 0 : 0, b = range === 'inout' ? outP ?? end : end;
  const markers = (seq.markers || []).filter((m) => m.time >= a && m.time < b).length;
  const choosePlatform = (k) => {
    setPlatform(k); const pp = PLATFORM_PRESETS[k]; if (!pp) return;
    setPreset(pp.preset); if (pp.width) { setW(pp.width); setH(pp.height); } else { setW(seq.width); setH(seq.height); }
    setLoud(pp.loudness ?? null); setTp(-1);
  };
  const job = jobId && queue.find((j) => j.id === jobId);
  const busy = job && (job.status === 'queued' || job.status === 'rendering');
  const opts = (path) => ({ path, preset, width: +w, height: +h, fps: +fps, start: a, end: b, audio, loudness: audio ? loud : null, truePeak: +tp, chapters, fit, encoder, smart: smart && !!P.codec && P.codec !== 'av1', burnCaptions: burn, sidecar: hasCaps ? sidecar : '' });
  const go = async (bg) => {
    const path = await window.editorstage.saveDialog('export', `${seq.name}.${P.ext}`, P.ext);
    if (!path) return;
    const id = queueExport(opts(path));
    if (bg) close(); else setJobId(id);
  };
  const aspectDiffers = Math.abs(seq.width / seq.height - w / h) > 0.01;
  return (
    <Modal wide title="Export Settings" footer={busy ? <><button onClick={() => cancelExport(jobId)}>Cancel export</button><button title="Keep editing; the export continues in the Export Queue" onClick={close}>Continue in background</button></>
      : <><button onClick={() => go(false)} disabled={end <= 0 || !!sw?.error}>Export</button><button title="Add to the Export Queue and keep editing" onClick={() => go(true)} disabled={end <= 0 || !!sw?.error}>Queue</button><button onClick={close}>Close</button></>}>
      <div className="mrow health-summary"><label>Health Check</label>{!health ? <span className="dim">checking…</span> : health.filter((i) => i.level !== 'info').length ? <><span className="warn">⚠ {health.filter((i) => i.level !== 'info').length} issue(s)</span> <button onClick={() => setShowHealth(!showHealth)}>{showHealth ? 'Hide' : 'Review'}</button></> : <span className="ok">✔ No problems</span>}</div>
      {showHealth && health && <HealthList issues={health} onFixed={(i) => { if (i.id === 'loudness') setLoud(-14); }} />}
      {health?.some((i) => i.id === 'loudness') && loud == null && <div className="mrow"><button onClick={() => setLoud(-14)}>Normalize to −14 LUFS on export</button></div>}
      <Row label="Preset"><select value={platform} onChange={(e) => choosePlatform(e.target.value)}><option value="">Custom</option>{Object.keys(PLATFORM_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></Row>
      <Row label="Format"><select value={preset} onChange={(e) => { setPreset(e.target.value); setPlatform(''); }}>{Object.keys(PRESETS).filter((k) => !PRESETS[k].hidden).map((k) => <option key={k}>{k}</option>)}</select></Row>
      {sw?.error && <Row label=""><span className="warn">{sw.error}</span></Row>}
      {sw?.note && <Row label=""><span className="dim">{sw.note}</span></Row>}
      {!P.audioOnly && <Row label="Resolution"><NumInput type="number" value={w} onChange={(e) => { setW(e.target.value); setPlatform(''); }} /> × <NumInput type="number" value={h} onChange={(e) => { setH(e.target.value); setPlatform(''); }} /></Row>}
      {!P.audioOnly && aspectDiffers && <Row label="Source Scaling"><select value={fit} onChange={(e) => setFit(e.target.value)}>{FIT_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Row>}
      {!P.audioOnly && <Row label="Frame rate"><select value={fps} onChange={(e) => setFps(+e.target.value)}>{[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => <option key={f} value={f}>{f}</option>)}</select></Row>}
      {!P.audioOnly && P.codec && <Row label="Encoding"><select value={encoder} onChange={(e) => setEncoder(e.target.value)}>
        <option value="software">{sw?.note ? `Software Encoding → ${ALT_LABELS[sw.encoder]}` : 'Software Encoding'}</option>{hwFor.map((k) => <option key={k} value={k}>Hardware Encoding ({HW_LABELS[k]})</option>)}</select>
        <span className="dim"> {hw ? (hwFor.length ? '' : 'no working hardware encoder found for this codec') : 'detecting hardware encoders…'}</span></Row>}
      {!P.audioOnly && (P.codec === 'h264' || P.codec === 'hevc') && <div className="mrow"><Check checked={smart} onChange={setSmart}>Use Smart Render (copy untouched clips without re-encoding when they match the output)</Check></div>}
      <Row label="Range"><select value={range} onChange={(e) => setRange(e.target.value)}><option value="all">Entire Sequence</option><option value="inout" disabled={inP == null || outP == null}>Work Area (In to Out)</option></select><span className="dim"> {a.toFixed(2)}s – {b.toFixed(2)}s</span></Row>
      {P.audio && !P.audioOnly && <Row label="Export audio"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /></Row>}
      {P.audio && audio && <Row label="Loudness Normalization"><select value={loud ?? ''} onChange={(e) => setLoud(e.target.value === '' ? null : +e.target.value)}>{LOUDNESS_TARGETS.map(([v, l]) => <option key={l} value={v ?? ''}>{l}</option>)}</select>
        {loud != null && <> True Peak <select value={tp} onChange={(e) => setTp(+e.target.value)}>{[-1, -2, -3].map((x) => <option key={x} value={x}>{x} dBTP</option>)}</select></>}</Row>}
      {supportsChapters(P) && <div className="mrow"><Check checked={chapters} disabled={!markers} onChange={setChapters}>Write sequence markers as chapters ({markers} in range)</Check></div>}
      {hasCaps && !P.audioOnly && <Row label="Captions"><Check checked={burn} onChange={setBurn}>Burn Captions Into Video</Check> <select value={sidecar} onChange={(e) => setSidecar(e.target.value)}><option value="">No sidecar file</option><option value="srt">+ Sidecar .srt</option><option value="vtt">+ Sidecar .vtt</option></select></Row>}
      {P.alpha && <div className="dim">Empty areas of the sequence are exported transparent (alpha channel).</div>}
      {end <= 0 && <div className="dim">The sequence is empty.</div>}
      {job && busy && <div className="progress"><div style={{ width: `${Math.round((job.p || 0) * 100)}%` }} /><span>{job.msg}</span></div>}
      {job && !busy && <div className={job.status === 'done' ? 'ok' : 'err'}>{job.status === 'done' ? `✔ Export finished${job.msg && job.msg !== 'Done' ? ` — ${job.msg}` : ''}` : `✖ ${job.msg}`}</div>}
      {queue.length > 0 && <div className="dim">Export Queue: {queue.filter((j) => j.status === 'queued' || j.status === 'rendering').length} waiting / rendering — File &gt; Export &gt; Export Queue</div>}
    </Modal>
  );
}
const ISSUE_ICON = { error: '✖', warning: '⚠', info: 'ℹ' };
/** List of Project Health Check issues with Go to / fix buttons. */
export function HealthList({ issues, onFixed }) {
  if (!issues.length) return <div className="ok health-ok">✔ No problems found</div>;
  return <div className="healthlist">{issues.map((i) => <div key={i.id} className={`mrow health ${i.level}`} data-issue={i.id}>
    <label style={{ width: 'auto', flex: 1 }}><b>{ISSUE_ICON[i.level]} {i.title}</b>{i.detail && <><br /><span className="dim">{i.detail}</span></>}</label>
    {(i.at != null || i.clipIds) && <button onClick={() => gotoIssue(i)}>Go to</button>}
    {i.fix && <button onClick={() => { i.fix.run(); onFixed?.(i); }}>{i.fix.label}</button>}
  </div>)}</div>;
}
function HealthCheckDialog() {
  const [issues, setIssues] = useState(null); const [msg, setMsg] = useState(''); const [target, setTarget] = useState(-14);
  const run = async () => { setIssues(null); try { setIssues(await runHealthCheck({ loudness: target, onProgress: setMsg })); } catch (e) { setIssues([{ id: 'err', level: 'error', title: String(e.message || e) }]); } };
  useEffect(() => { run(); }, [target]);
  return <Modal wide title="Project Health Check" footer={<><button onClick={run} disabled={!issues}>Check Again</button><button onClick={close}>Close</button></>}>
    <Row label="Loudness target"><select value={target} onChange={(e) => setTarget(+e.target.value)}>{LOUDNESS_TARGETS.filter(([v]) => v != null).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Row>
    {!issues ? <div className="dim">Checking… {msg}</div> : <HealthList issues={issues} onFixed={() => setTimeout(run, 300)} />}
  </Modal>;
}
function ExportQueueDialog() {
  const q = useStore((x) => x.exportQueue || []);
  const fmt = (s) => (s == null ? '' : `${Math.round(s / 100) / 10}s`);
  return <Modal wide title="Export Queue" footer={<><button onClick={clearFinishedExports} disabled={!q.some((j) => !['queued', 'rendering'].includes(j.status))}>Clear Finished</button><button onClick={close}>Close</button></>}>
    {!q.length && <div className="dim">The queue is empty. Use Queue in the Export Settings dialog (File &gt; Export &gt; Media) to add exports.</div>}
    <div className="scrolly">{q.map((j) => <div className="mrow equeue" key={j.id} data-status={j.status}>
      <label style={{ width: 260 }} title={j.path}>{j.name}<br /><span className="dim">{j.seqName} · {j.preset}</span></label>
      <div style={{ flex: 1 }}>
        {j.status === 'rendering' ? <div className="progress"><div style={{ width: `${Math.round((j.p || 0) * 100)}%` }} /><span>{j.msg}</span></div>
          : <span className={j.status === 'done' ? 'ok' : j.status === 'error' ? 'err' : 'dim'}>{{ queued: 'Waiting', done: '✔ Done', error: '✖ Failed', cancelled: 'Cancelled' }[j.status]} {j.status !== 'queued' && j.msg !== 'Cancelled' ? j.msg : ''} {j.ended && j.started ? fmt(j.ended - j.started) : ''}</span>}
      </div>
      {(j.status === 'queued' || j.status === 'rendering') ? <button onClick={() => cancelExport(j.id)}>Cancel</button> : <button onClick={() => removeExport(j.id)}>Remove</button>}
      {j.status === 'done' && <button title="Open the exported file" onClick={() => window.editorstage.openExternal(j.path)}>Open</button>}
    </div>)}</div>
  </Modal>;
}

function SyncDialog() {
  const [mode, setMode] = useState('audio'); const [busy, setBusy] = useState(false);
  return <Modal title="Synchronize Clips" footer={<><button disabled={busy} onClick={async () => { setBusy(true); await synchronizeClips(mode); close(); }}>{busy ? 'Working…' : 'OK'}</button><button onClick={close}>Cancel</button></>}>
    <Row label="Synchronize Point"><select value={mode} onChange={(e) => setMode(e.target.value)}><option value="audio">Audio</option><option value="start">Clip Start</option><option value="end">Clip End</option></select></Row>
    <div className="dim">The first selected clip is the reference. Audio sync cross-correlates the waveforms (±20 s).</div>
  </Modal>;
}

/** Replace a font family in titles, caption styles and MOGRT text overrides of every sequence (one undo step). */
function replaceFontEverywhere(from, to) {
  const fix = (seq) => seq.clips.forEach((c) => {
    if (c.graphic?.font === from) c.graphic.font = to;
    if (c.caption?.style?.font && c.caption.style.font.split(',')[0].trim().replace(/^["']|["']$/g, '') === from) c.caption.style.font = c.caption.style.font.replace(from, to);
    for (const [k, v] of Object.entries(c.mogrt?.values || {})) { const box = v && typeof v === 'object' && 'v' in v ? v : null; const val = box ? box.v : v; if (val && typeof val === 'object' && val.fontFamily === from) { const nv = { ...val, fontFamily: to }; c.mogrt.values[k] = box ? { ...box, v: nv, keys: box.keys ? box.keys.map((q) => ({ ...q, v: q.v?.fontFamily === from ? { ...q.v, fontFamily: to } : q.v })) : null } : nv; } }
  });
  edit('Replace Fonts', (ctx) => { fix(ctx.seq); Object.values(ctx.seqs).forEach(fix); });
}
function ReplaceFontsDialog() {
  const s = useStore((x) => x); const usedMap = fontsUsed(s); const used = [...usedMap.keys()];
  const [from, setFrom] = useState(used.find((f) => !isFontInstalled(f)) || used[0] || ''); const [to, setTo] = useState('Arial');
  const go = () => { replaceFontEverywhere(from, to); close(); };
  return <Modal title="Replace Fonts in Project" footer={<><button disabled={!from || !to} onClick={go}>Replace</button><button onClick={close}>Cancel</button></>}>
    {!used.length ? <div className="dim">No fonts in use in this project.</div> : <>
      <Row label="Replace"><select value={from} onChange={(e) => setFrom(e.target.value)}>{used.map((f) => <option key={f} value={f}>{isFontInstalled(f) ? '' : '⚠ '}{f} ({usedMap.get(f).length})</option>)}</select></Row>
      <Row label="With"><FontPicker value={to} onChange={setTo} /></Row>
      {from && !isFontInstalled(from) && <div className="err note">"{from}" is not installed on this computer.</div>}
      <div className="dim">Titles, captions and template text in every sequence are updated (undoable).</div></>}
  </Modal>;
}

function RenderProgressDialog() {
  const rp = useStore((s) => s.renderProgress);
  return <Modal title="Rendering" footer={<button onClick={cancelRender}>Cancel</button>}><div className="progress"><div style={{ width: Math.round((rp?.p || 0) * 100) + '%' }} /><span>{rp?.text || 'Preparing…'}</span></div></Modal>;
}

function CaptureDialog() {
  const [mode, setMode] = useState('camera'); const [devs, setDevs] = useState({ v: [], a: [] }); const [vId, setVId] = useState(''); const [aId, setAId] = useState('');
  const [rec, setRec] = useState(false); const [secs, setSecs] = useState(0); const [msg, setMsg] = useState(''); const [place, setPlace] = useState(true);
  const vref = useRef(null), stream = useRef(null), mr = useRef(null), chunks = useRef([]), t0 = useRef(0);
  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  useEffect(() => {
    let dead = false; stop();
    (async () => {
      try {
        const s = mode === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }) : await navigator.mediaDevices.getUserMedia({ video: mode === 'camera' ? (vId ? { deviceId: vId } : true) : false, audio: aId ? { deviceId: aId } : true });
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; } stream.current = s; if (vref.current) vref.current.srcObject = s;
        const list = await navigator.mediaDevices.enumerateDevices(); setDevs({ v: list.filter((d) => d.kind === 'videoinput'), a: list.filter((d) => d.kind === 'audioinput') }); setMsg('');
      } catch (e) { setMsg('Cannot open the capture device: ' + (e.message || e)); }
    })();
    return () => { dead = true; stop(); };
  }, [mode, vId, aId]);
  useEffect(() => { if (!rec) return; const id = setInterval(() => setSecs((performance.now() - t0.current) / 1000), 200); return () => clearInterval(id); }, [rec]);
  const start = () => {
    if (!stream.current) return; chunks.current = []; const kind = mode === 'mic' ? 'audio' : 'video';
    const r = new MediaRecorder(stream.current, { mimeType: kind === 'audio' ? 'audio/webm' : 'video/webm' }); mr.current = r; r.ondataavailable = (e) => chunks.current.push(e.data);
    r.onstop = async () => { setMsg('Converting…'); const bytes = new Uint8Array(await new Blob(chunks.current).arrayBuffer()); const m = await importRecording(bytes, kind, kind === 'video' ? (mode === 'screen' ? 'Screen capture' : 'Camera capture') : 'Audio capture'); setMsg(m ? 'Imported ' + m.name : 'Import failed'); if (m && place) addMediaToTimeline(m, getState().playhead); };
    r.start(); t0.current = performance.now(); setSecs(0); setRec(true);
  };
  const end = () => { mr.current?.stop(); setRec(false); };
  return <Modal wide title="Capture" footer={<><button onClick={rec ? end : start} className={rec ? 'rec on' : ''}>{rec ? '■ Stop' : '● Record'}</button><button onClick={close}>Close</button></>}>
    <Row label="Source"><select value={mode} disabled={rec} onChange={(e) => setMode(e.target.value)}><option value="camera">Camera + Microphone</option><option value="screen">Screen (+ system audio)</option><option value="mic">Microphone only</option></select></Row>
    {mode === 'camera' && <Row label="Camera"><select value={vId} disabled={rec} onChange={(e) => setVId(e.target.value)}><option value="">Default</option>{devs.v.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}</select></Row>}
    {mode !== 'screen' && <Row label="Microphone"><select value={aId} disabled={rec} onChange={(e) => setAId(e.target.value)}><option value="">Default</option>{devs.a.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId.slice(0, 8)}</option>)}</select></Row>}
    {mode !== 'mic' && <video ref={vref} autoPlay muted playsInline style={{ width: '100%', background: '#000', maxHeight: 260 }} />}
    <Row label="Add to timeline"><input type="checkbox" checked={place} onChange={(e) => setPlace(e.target.checked)} /><span className="dim">at the playhead</span></Row>
    <div className="dim">{rec ? '● Recording ' + secs.toFixed(1) + ' s' : msg}</div>
  </Modal>;
}

function RevisionDialog() {
  const [n, setN] = useState('');
  const ok = async () => { const { commitRevision } = await import('../Services/versions'); const r = await commitRevision(n || 'Manual revision'); set((s) => ({ log: [...s.log.slice(-49), r ? `Revision saved (${r.newObjects} new objects)` : 'Nothing changed since the last revision'] })); close(); };
  return <Modal title="Save Revision" footer={<><button onClick={ok}>Save</button><button onClick={close}>Cancel</button></>}><Row label="Description"><input autoFocus value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} placeholder="e.g. rough cut v2" /></Row><div className="dim">Window &gt; Version History lists revisions and branches.</div></Modal>;
}
function AudioStagePathDialog() {
  const choose = async (dir) => { const p = dir ? await window.editorstage.pickFolder() : (await window.editorstage.openDialog('app'))[0]; if (!p) return; const loc = await window.editorstage.audiostage.setPath(p); if (loc) { close(); const { editInAudioStage } = await import('../Services/audiostage'); editInAudioStage(); } else set((s) => ({ log: [...s.log.slice(-49), 'That is not an AudioStage installation'] })); };
  return <Modal title="Edit in AudioStage" footer={<button onClick={close}>Cancel</button>}><p>AudioStage was not found on this computer. Point EditorStage to it:</p><div className="st-actions"><button onClick={() => choose(false)}>Choose AudioStage.exe…</button><button onClick={() => choose(true)}>Choose AudioStage project folder…</button></div></Modal>;
}

// ---------- Clip > Audio Options / Video Options, subclips, search bins ----------
const uid = () => Math.random().toString(36).slice(2, 8);
const trackKindOf = (s, c) => s.sequence.tracks.find((t) => t.id === c.track)?.kind;
/** "HH:MM:SS:FF" at fps */
export const toTC = (sec, fps) => { const f = Math.round(Math.max(0, sec) * fps); const fr = Math.round(fps); const ff = f % fr, ts = Math.floor(f / fr); const p2 = (n) => String(n).padStart(2, '0'); return `${p2(Math.floor(ts / 3600))}:${p2(Math.floor(ts / 60) % 60)}:${p2(ts % 60)}:${p2(ff)}`; };
/** Parses "HH:MM:SS:FF", "MM:SS:FF", "SS:FF" or plain seconds. Returns NaN when invalid. */
export const fromTC = (str, fps) => {
  const t = String(str).trim(); if (/^\d+(\.\d+)?$/.test(t)) return +t;
  const p = t.split(/[:;]/).map(Number); if (p.length < 2 || p.length > 4 || p.some((x) => !Number.isFinite(x))) return NaN;
  const [h, m, sec, f] = [0, 0, 0, 0, ...p].slice(-4);
  return (h * 60 + m) * 60 + sec + f / Math.round(fps);
};
export function TCInput({ value, fps, onChange }) {
  const [txt, setTxt] = useState(toTC(value, fps)); useEffect(() => setTxt(toTC(value, fps)), [value, fps]);
  const commit = () => { const v = fromTC(txt, fps); if (Number.isFinite(v)) onChange(v); else setTxt(toTC(value, fps)); };
  return <input className="tc" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
const Radio = ({ name, checked, onChange, children }) => <div className="mrow"><label style={{ width: 'auto' }}><input type="radio" name={name} checked={checked} onChange={onChange} /> {children}</label></div>;
const Check = ({ checked, onChange, disabled, children }) => <label style={{ width: 'auto' }}><input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>;

function AudioChannelsDialog() {
  const s = useStore((x) => x);
  const clips = selClips(s).filter((c) => trackKindOf(s, c) === 'audio' || (c.mediaId && !c.noAudio && s.media.find((m) => m.id === c.mediaId)?.kind === 'video'));
  const [mode, setMode] = useState(clips[0]?.audio?.channels || 'stereo');
  if (!clips.length) return <Modal title="Audio Channels" footer={<button onClick={close}>OK</button>}>Select an audio clip (or a video clip with its own audio) first.</Modal>;
  const ok = () => { const ids = clips.map((c) => c.id); edit('Audio Channels', ({ seq }) => seq.clips.filter((c) => ids.includes(c.id)).forEach((c) => { c.audio = { ...(c.audio || {}), channels: mode === 'stereo' ? undefined : mode }; })); close(); };
  return <Modal title="Modify Clip - Audio Channels" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
    {CHANNEL_MODES.map(([id, label]) => <Radio key={id} name="chmode" checked={mode === id} onChange={() => setMode(id)}>{label}</Radio>)}
    <div className="dim">{clips.length} clip{clips.length > 1 ? 's' : ''}. Applied in playback and export.</div>
  </Modal>;
}

function FieldOptionsDialog() {
  const s = useStore((x) => x); const clips = selClips(s).filter((c) => trackKindOf(s, c) === 'video' && c.mediaId);
  const fo = clips[0]?.fieldOptions || {};
  const [rev, setRev] = useState(!!fo.reverse); const [proc, setProc] = useState(fo.deinterlace ? 'deinterlace' : fo.flicker ? 'flicker' : 'none');
  if (!clips.length) return <Modal title="Field Options" footer={<button onClick={close}>OK</button>}>Select a video clip first.</Modal>;
  const ok = () => {
    const ids = clips.map((c) => c.id); const v = { reverse: rev, deinterlace: proc === 'deinterlace', flicker: proc === 'flicker' };
    edit('Field Options', ({ seq }) => seq.clips.filter((c) => ids.includes(c.id)).forEach((c) => { c.fieldOptions = v.reverse || v.deinterlace || v.flicker ? v : undefined; }));
    close();
  };
  return <Modal title="Field Options" footer={<><button onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
    <div className="mrow"><Check checked={rev} onChange={setRev}>Reverse Field Dominance</Check></div>
    <div className="dim" style={{ margin: '6px 0 2px' }}>Processing Options</div>
    {[['none', 'None'], ['deinterlace', 'Always Deinterlace'], ['flicker', 'Flicker Removal']].map(([id, label]) => <Radio key={id} name="fproc" checked={proc === id} onChange={() => setProc(id)}>{label}</Radio>)}
    <div className="dim">Processed on the GPU at the source resolution (same result in Preview and Export).</div>
  </Modal>;
}

function FrameHoldDialog() {
  const s = useStore((x) => x); const fps = s.sequence.fps;
  const clips = selClips(s).filter((c) => trackKindOf(s, c) === 'video' && c.mediaId && s.media.find((m) => m.id === c.mediaId)?.kind === 'video');
  const c = clips[0]; const fh = c?.frameHold || {};
  const srcAt = (t) => sourceAt({ ...c, frameHold: undefined }, Math.min(c.start + c.dur, Math.max(c.start, t)), fps);
  const markers = c ? (s.sequence.markers || []).filter((m) => m.time >= c.start && m.time < c.start + c.dur).sort((a, b) => a.time - b.time) : [];
  const [on, setOn] = useState(fh.on ?? true); const [mode, setMode] = useState(fh.mode || 'source');
  const [time, setTime] = useState(fh.time ?? (c ? srcAt(s.playhead) : 0)); const [mk, setMk] = useState(markers[0]?.id || ''); const [hf, setHf] = useState(!!fh.holdFilters);
  if (!c) return <Modal title="Frame Hold Options" footer={<button onClick={close}>OK</button>}>Select a video clip first.</Modal>;
  const ok = () => {
    let m = mode, tm = time;
    if (mode === 'playhead') { m = 'source'; tm = srcAt(s.playhead); }
    if (mode === 'marker') { const x = markers.find((q) => q.id === mk); if (!x) return; m = 'source'; tm = srcAt(x.time); }
    const ids = clips.map((q) => q.id);
    edit('Frame Hold Options', ({ seq }) => seq.clips.filter((q) => ids.includes(q.id)).forEach((q) => { q.frameHold = on ? { on: true, mode: m, time: m === 'source' ? tm : undefined, holdFilters: hf } : undefined; }));
    close();
  };
  return <Modal title="Frame Hold Options" footer={<><button onClick={ok} disabled={on && mode === 'marker' && !mk}>OK</button><button onClick={close}>Cancel</button></>}>
    <div className="mrow"><Check checked={on} onChange={setOn}>Hold On</Check>
      <select disabled={!on} value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="source">Source Timecode</option><option value="in">In Point</option><option value="out">Out Point</option><option value="playhead">Playhead</option>
        <option value="marker" disabled={!markers.length}>Marker{markers.length ? '' : ' (none on this clip)'}</option>
      </select></div>
    {on && mode === 'source' && <Row label="Source time"><TCInput value={time} fps={fps} onChange={setTime} /></Row>}
    {on && mode === 'marker' && <Row label="Marker"><select value={mk} onChange={(e) => setMk(e.target.value)}>{markers.map((x) => <option key={x.id} value={x.id}>{toTC(x.time, fps)} {x.name}</option>)}</select></Row>}
    <div className="mrow"><Check disabled={!on} checked={hf} onChange={setHf}>Hold Filters</Check><span className="dim">keyframed effects and motion freeze too</span></div>
  </Modal>;
}

function EditSubclipDialog({ create }) {
  const s = useStore((x) => x); const fps = s.sequence.fps;
  const m = s.media.find((x) => x.id === s.selectedMedia);
  const parent = m && (m.subclip ? s.media.find((x) => x.id === m.subclip.parent) || m : m);
  const [r0, r1] = m ? mediaRange(m) : [0, 0];
  const [name, setName] = useState(m ? (create ? `${m.name.replace(/\.[^.]+$/, '')} Subclip` : m.name) : '');
  const [a, setA] = useState(create ? s.sourceIn ?? r0 : r0); const [b, setB] = useState(create ? s.sourceOut ?? r1 : r1);
  const [master, setMaster] = useState(false);
  const title = create ? 'Make Subclip' : 'Edit Subclip';
  if (!m || m.kind === 'image' || m.status !== 'ready') return <Modal title={title} footer={<button onClick={close}>OK</button>}>Select a video or audio item in the Project panel first.</Modal>;
  if (!create && !m.subclip) return <Modal title={title} footer={<><button onClick={() => set({ dialog: { type: 'editSubclip', props: { create: true } } })}>Make Subclip…</button><button onClick={close}>Close</button></>}>&quot;{m.name}&quot; is a master clip. Use Clip &gt; Make Subclip to create a subclip from it.</Modal>;
  const max = parent.duration; const valid = b - a >= 1 / fps && a >= 0 && b <= max + 1e-6;
  const ok = () => {
    if (create) edit('Make Subclip', ({ media }) => { media.push({ ...structuredClone(m), id: uid(), name: name.trim(), subclip: { parent: parent.id, in: a, out: b } }); });
    else edit('Edit Subclip', ({ media }) => { const x = media.find((q) => q.id === m.id); if (master) delete x.subclip; else x.subclip = { ...x.subclip, in: a, out: b }; x.name = name.trim(); });
    close();
  };
  return <Modal title={title} footer={<><button disabled={!valid || !name.trim()} onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
    <Row label="Name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Row>
    <Row label="Start"><TCInput value={a} fps={fps} onChange={(v) => setA(Math.max(0, Math.min(v, max)))} /></Row>
    <Row label="End"><TCInput value={b} fps={fps} onChange={(v) => setB(Math.max(0, Math.min(v, max)))} /></Row>
    <Row label="Duration"><span>{toTC(Math.max(0, b - a), fps)}</span></Row>
    {!create && <div className="mrow"><Check checked={master} onChange={setMaster}>Convert to Master Clip</Check></div>}
    {!valid && <div className="err note">End must be after Start and inside the source ({toTC(max, fps)}).</div>}
    <div className="dim">Source: {parent.name}. Clips already in sequences keep their own In/Out.</div>
  </Modal>;
}

function SearchBinDialog() {
  const [q, setQ] = useState(''); const [name, setName] = useState('');
  const ok = () => { if (!q.trim()) return; set((s) => ({ bins: [...(s.bins || []), { id: uid(), name: name.trim() || `Search: ${q.trim()}`, query: q.trim() }] })); close(); };
  return <Modal title="New Search Bin" footer={<><button disabled={!q.trim()} onClick={ok}>OK</button><button onClick={close}>Cancel</button></>}>
    <Row label="Find"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} placeholder="name, file path or type (video / audio / image)" /></Row>
    <Row label="Bin name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={q ? `Search: ${q}` : ''} /></Row>
    <div className="dim">A search bin always shows every matching item in the project.</div>
  </Modal>;
}

/** Clip > Remix... (audio clips): Remix settings of the selected music clip */
function RemixDialog({ clipId }) {
  const id = clipId || getState().selection.find((x) => getState().sequence.clips.find((c) => c.id === x && getState().sequence.tracks.find((t) => t.id === c.track)?.kind === 'audio'));
  return <Modal title="Remix" footer={<button onClick={close}>Close</button>}><RemixDialogBody clipId={id} /></Modal>;
}
const MAP = { remix: RemixDialog, about: AboutDialog, makeOffline: MakeOfflineDialog, multicam: MulticamDialog, licenses: LicensesDialog, savePreset: SavePresetDialog, newSequence: NewSequenceDialog, renameMedia: RenameMediaDialog, pasteAttributes: PasteAttributesDialog, removeAttributes: RemoveAttributesDialog, marker: MarkerDialog, transitionDuration: TransitionDurationDialog, clipProperties: ClipPropertiesDialog, unsaved: UnsavedDialog, nestName: NestNameDialog, renameTrack: RenameTrackDialog, confirm: ConfirmDialog, healthCheck: HealthCheckDialog, exportQueue: ExportQueueDialog, createProxies: CreateProxiesDialog, linkMedia: LinkMediaDialog, sceneDetect: SceneDetectDialog, trackObject: TrackObjectDialog, synthetic: SyntheticDialog, exportFrame: ExportFrameDialog, audioChannels: AudioChannelsDialog, fieldOptions: FieldOptionsDialog, frameHold: FrameHoldDialog, editSubclip: EditSubclipDialog, searchBin: SearchBinDialog, revision: RevisionDialog, audiostagePath: AudioStagePathDialog, renderProgress: RenderProgressDialog, capture: CaptureDialog, replaceFonts: ReplaceFontsDialog, sync: SyncDialog, speed: SpeedDialog, audioGain: AudioGainDialog, rename: RenameDialog, sequenceSettings: SequenceSettingsDialog, projectSettings: ProjectSettingsDialog, preferences: PreferencesDialog, shortcuts: ShortcutsDialog, export: ExportDialog };
class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() { return this.state.err ? <Modal title="Error"><div className="err">{String(this.state.err.message || this.state.err)}</div></Modal> : this.props.children; }
}

export default function Dialogs() {
  const d = useStore((s) => s.dialog);
  const C = d && MAP[d.type];
  return C ? <Boundary key={d.type}><C {...(d.props || {})} /></Boundary> : null;
}
