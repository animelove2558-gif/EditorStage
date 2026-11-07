import React, { useEffect, useRef, useState } from 'react';
import NumInput from './NumInput';
import { reportError } from '../Services/errorLog';
import { DUCK_DEFAULTS, generateDucking } from '../Services/ducking';
import Timeline, { timecode } from './Timeline';
import { markerColor } from '../Core/markers';
import { useStore, set, edit, getState } from '../Core/store';
import { run, updateMarker, LABELS } from '../Core/commands';
import { beginEffectDrag, endEffectDrag, applyEffectToClips } from '../Core/dnd';
import { elementForMedia, elementForClip, syncPlayback, renderDeps, referenceDeps, syncReference } from '../Services/media';
import { referenceState, COMPARE_MODES, prevEdit, nextEdit, rememberCompare } from '../Core/compare';
import { keyedDeps, syncKeyed, releaseKeyed } from '../Services/media';
import { TRIM_TYPES, TRIM_LABELS, trimBy, largeTrim, setTrimSide, exitTrim } from '../Core/trimMode';
import * as ed from '../Core/editing';
import { Compositor } from '../Renderers/Compositor';
import { validPreviewAt } from '../Core/previewState';
const previewEls = new Map();
import { addGraphic } from '../Services/graphics';
import FontPicker from './FontPicker';
import LearnPanel from './LearnPanel';
import RemixControls from './RemixControls';
import LibrariesPanel from './LibrariesPanel';
import { selectTool } from '../Core/tools';
import { requestPanel } from '../Core/layout';
import { EffectControls, Lumetri, createMask } from './EffectControls';
import { EFFECT_ROOTS } from '../Core/effectsCatalog';
import { VIDEO_FX } from '../Renderers/fx/videoEffects';
import { AUDIO_FX } from '../Services/audioFx';
import { APPROX_TRANSITIONS } from '../Renderers/fx/transitions';
import TransformOverlay from './TransformOverlay';
import { MORE_VIDEO_FX } from '../Renderers/fx/moreVideoFx';
import { MORE_TRANSITIONS } from '../Renderers/fx/moreTransitions';
import { MORE_AUDIO_FX } from '../Services/audioFx';
import { MORE_CROSSFADES } from '../Services/moreAudioFx';
import { allPresets, findPreset, applyPreset, loadUserPresets, saveUserPreset, deleteUserPreset, getUserPresets, parsePresetsFile, presetsFileText, getFavorites, toggleFavorite, getRecent, recordRecent, PRESET_TYPES } from '../Core/presets';
import { drawPreview, previewable, PW, PH } from '../Services/fxPreview';

const Empty = ({ children }) => <div className="panel-pad dim">{children}</div>;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/** "16:9", "9:16", "1:1", "4:5" ... (falls back to a decimal ratio for odd sizes) */
export const aspectLabel = (w, h) => { const d = gcd(Math.round(w), Math.round(h)) || 1; const a = w / d, b = h / d; return a <= 64 && b <= 64 ? `${a}:${b}` : `${(w / h).toFixed(2)}:1`; };

// ---------- Program / Source monitor ----------
function Monitor({ label }) {
  const cv = useRef(null); const cv2 = useRef(null); // cv2: Comparison View reference image
  const [gfxError, setGfxError] = useState(null); // why the Program Monitor has no compositor (WebGL2 blocked, GPU unavailable)
  const tA = useRef(null), tB = useRef(null); // Trim Monitor: outgoing / incoming frame
  const playhead = useStore((s) => s.playhead);
  const playing = useStore((s) => s.playing);
  const seq = useStore((s) => s.sequence);
  const res = useStore((s) => (s.playing ? s.playbackRes : s.pausedRes));
  const selectedMedia = useStore((s) => s.selectedMedia);
  const media = useStore((s) => s.media);
  const isSource = label === 'Source';
  const activeMon = useStore((s) => s.activeMonitor || 'program'); // I / O and the other mark keys work on this monitor

  useEffect(() => {
    let raf, comp = null;
    if (!isSource) { try { comp = new Compositor(cv.current); window.__comp = comp; setGfxError(null); } catch (e) { console.error(e); reportError('compositor', e); setGfxError(String(e?.message || e)); } }
    const g2 = isSource ? cv.current.getContext('2d') : null;
    let lastDraw = 0, lastState = null, lastChange = 0, lastKey = '';
    // Comparison View: the Reference side has its own compositor. Frame: the same frame ungraded (redrawn with the Current
    // one, at most ~12 fps while playing). Shot: a fixed moment from its own `cmp:` elements, drawn again only when it changes.
    let comp2 = null, refDrawn = 0, refDone = null;
    // Trim Monitor: one offscreen compositor renders each side's clip alone from its own `trimA:` / `trimB:` elements
    let comp3 = null, trimDone = null, trimDrawn = 0, trimOn = false; const trimDeps = { a: keyedDeps('trimA:'), b: keyedDeps('trimB:') };
    const drawTrim = (st, now) => {
      const tm = st.trimMode; const seq = st.sequence; const fps = seq.fps || 30; const e = trimPrimary(seq, tm);
      const sc = Math.min(1, 640 / Math.max(seq.width, seq.height)); const w = Math.max(16, Math.round(seq.width * sc)), h = Math.max(16, Math.round(seq.height * sc));
      if (trimDone && trimDone.seq === seq && trimDone.tm === tm && trimDone.media === st.media && now - trimDrawn < 1000) return;
      if (!comp3) { try { comp3 = new Compositor(document.createElement('canvas')); } catch (err) { console.error(err); return; } }
      let ready = true;
      for (const [side, cvs] of [['a', tA.current], ['b', tB.current]]) {
        if (!cvs) continue; if (cvs.width !== w || cvs.height !== h) { cvs.width = w; cvs.height = h; }
        const g = cvs.getContext('2d'); const id = side === 'a' ? e?.aId : e?.bId; const c = id && seq.clips.find((x) => x.id === id);
        g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
        if (!c) { g.fillStyle = '#777'; g.font = `${Math.round(h / 10)}px system-ui`; g.textAlign = 'center'; g.fillText('Gap', w / 2, h / 2); continue; }
        if (seq.tracks.find((t) => t.id === c.track)?.kind === 'audio') { g.fillStyle = '#2e5e31'; g.fillRect(0, h * 0.35, w, h * 0.3); g.fillStyle = '#ddd'; g.font = `${Math.round(h / 14)}px system-ui`; g.textAlign = 'center'; g.fillText(c.name || 'Audio', w / 2, h / 2 + h / 40); continue; }
        const t = side === 'a' ? ed.clipEnd(c) - 1 / fps : c.start;
        const one = { ...st, sequence: { ...seq, clips: [c], transitions: [] }, playhead: t };
        if (!syncKeyed(one, side === 'a' ? 'trimA:' : 'trimB:')) ready = false;
        comp3.render(one, trimDeps[side], { w, h }); g.drawImage(comp3.canvas, 0, 0, w, h);
      }
      trimDone = ready ? { seq, tm, media: st.media } : null; trimDrawn = now;
    };
    const drawReference = (st, w, h, now) => {
      const c = st.compare; const el = cv2.current; if (!c?.on || !el) return;
      if (!comp2 || comp2.canvas !== el) {
        comp2?.gl.getExtension('WEBGL_lose_context')?.loseContext(); comp2 = null; refDone = null; // one reference context at a time
        try { comp2 = new Compositor(el); } catch (e) { console.error(e); return; }
      }
      const rs = referenceState(st, c);
      if (c.kind === 'frame') { if (st.playing && now - refDrawn < 80) return; comp2.render(rs, previewDeps, { w, h }); }
      else {
        const ready = syncReference(rs);
        const same = refDone && refDone.t === c.refTime && refDone.seq === st.sequence && refDone.seqs === st.seqs && refDone.media === st.media && refDone.w === w && refDone.h === h;
        if (same && now - refDrawn < 1000) return;
        comp2.render(rs, referenceDeps, { w, h });
        refDone = ready ? { t: c.refTime, seq: st.sequence, seqs: st.seqs, media: st.media, w, h } : null;
      }
      refDrawn = now;
    };
    const previewOpts = { playing: false, fps: 30 };
    const previewDeps = { ...renderDeps, elementFor: (c, t, dims) => elementForClip(c, t, dims, previewOpts) };
    const draw = (now) => {
      const st = getState();
      // Remote-Optimized Preview: small frames at a capped rate (fewer pixels to encode over RDP / remote desktop)
      if (st.remoteMode && now - lastDraw < 1000 / (st.playing ? 15 : 8)) { raf = requestAnimationFrame(draw); return; }
      const div = { Full: 1, '1/2': 2, '1/4': 4, '1/8': 8, '1/16': 16 }[st.playing ? st.playbackRes : st.pausedRes] || 1;
      // longest side capped (a 1080x1920 vertical sequence previews at 720x1280, like 1920x1080 previews at 1280x720)
      const cap = st.remoteMode ? (st.playing ? 480 : 640) : 1280; const sc = Math.min(1, cap / Math.max(st.sequence.width, st.sequence.height));
      const w = Math.max(16, Math.round((st.sequence.width * sc) / div)), h = Math.max(16, Math.round((st.sequence.height * sc) / div));
      // paused and nothing changed: redraw only a few times a second (late-loading frames/fonts still show up)
      const key = `${w}x${h}|${st.selectedMedia}`;
      if (st !== lastState || key !== lastKey) { lastState = st; lastKey = key; lastChange = now; }
      if (!isSource && !st.playing && now - lastChange > 1000 && now - lastDraw < 200) { raf = requestAnimationFrame(draw); return; }
      lastDraw = now;
      if (isSource) {
        const m = st.media.find((x) => x.id === st.selectedMedia);
        const el = m && m.kind !== 'audio' ? elementForMedia(m, `src:${m.id}`) : null;
        if (cv.current.width !== w) { cv.current.width = w; cv.current.height = h; }
        g2.fillStyle = '#000'; g2.fillRect(0, 0, w, h);
        const sw = el && (el.videoWidth || el.naturalWidth);
        if (sw) { const sh = el.videoHeight || el.naturalHeight; const k = Math.min(w / sw, h / sh); g2.drawImage(el, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k); }
      } else if (comp && st.trimMode && !st.playing) {
        drawTrim(st, now); // Trim Monitor replaces the program image while paused
      } else if (comp) {
        syncPlayback(st);
        const pv = validPreviewAt(st.playhead, 'video'); let shown = false;
        if (pv) {
          let pe = previewEls.get(pv.path); if (!pe) { pe = document.createElement('video'); pe.crossOrigin = 'anonymous'; pe.muted = true; pe.preload = 'auto'; pe.src = 'es-media://local/' + encodeURIComponent(pv.path); previewEls.set(pv.path, pe); }
          const tg = st.playhead - pv.start; if (Math.abs(pe.currentTime - tg) > (st.playing ? 0.25 : 0.02)) pe.currentTime = tg;
          if (st.playing && (st.rate || 1) > 0) { if (pe.paused) pe.play().catch(() => {}); } else if (!pe.paused) pe.pause();
          shown = pe.readyState >= 2 && comp.blitElement(pe, { w, h });
        }
        previewOpts.playing = !!st.playing && (st.rate || 1) > 0; previewOpts.fps = st.sequence.fps || 30;
        if (!shown) comp.render(st, previewDeps, { w, h });
        drawReference(st, w, h, now);
      }
      if (!isSource) { const on = !!st.trimMode; if (trimOn && !on) { releaseKeyed('trimA:'); releaseKeyed('trimB:'); trimDone = null; } trimOn = on; }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); comp2?.gl.getExtension('WEBGL_lose_context')?.loseContext(); comp3?.gl.getExtension('WEBGL_lose_context')?.loseContext(); };
  }, [isSource]);

  const maskDraw = useStore((s) => s.maskDraw); const safe = useStore((s) => s.safeMargins); const guides = useStore((s) => s.showGuides); const rulers = useStore((s) => s.showRulers); const zoom = useStore((s) => s.monitorZoom);
  const tool = useStore((s) => s.tool); const mcView = useStore((s) => s.mcView); const cmp = useStore((s) => s.compare); const tm = useStore((s) => (isSource ? null : s.trimMode));
  const onDrawClick = (e) => {
    if (!maskDraw && !isSource && ['type', 'vtype', 'rect', 'ellipse', 'polygon', 'pen'].includes(tool)) {
      const r = e.currentTarget.getBoundingClientRect(); const kind = { type: 'text', vtype: 'vtext', rect: 'rect', ellipse: 'ellipse', polygon: 'polygon', pen: 'rect' }[tool];
      addGraphic(kind, getState().playhead, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); selectTool('selection'); requestPanel('essentialGraphics'); return;
    }
    const st0 = getState();
    const mcClip = !isSource && st0.mcView && st0.sequence.clips.find((x) => x.multicam && st0.playhead >= x.start && st0.playhead < x.start + x.dur);
    if (mcClip) {
      const rr = e.currentTarget.getBoundingClientRect(); const sub = st0.seqs[mcClip.nestId];
      const n = sub ? sub.tracks.filter((q) => q.kind === 'video').length : 1; const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const cam = Math.floor(((e.clientY - rr.top) / rr.height) * rows) * cols + Math.floor(((e.clientX - rr.left) / rr.width) * cols);
      if (cam < n) run('clip.multicamCut', cam);
      return;
    }
    if (!maskDraw) return; const r = e.currentTarget.getBoundingClientRect(); set({ maskDraw: { ...maskDraw, pts: [...maskDraw.pts, [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]] } }); };
  const finishDraw = () => { if (!maskDraw) return; const pts = maskDraw.pts.slice(0, -1); if (pts.length >= 3) createMask(maskDraw.clipId, 'bezier', pts); set({ maskDraw: null }); };
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') set({ maskDraw: null }); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const m = media.find((x) => x.id === selectedMedia);
  // fit the frame into the panel ourselves (exact aspect, never stretched); Magnification N% = N% of the sequence pixels
  const scr = useRef(null); const [area, setArea] = useState({ w: 0, h: 0 });
  useEffect(() => { const ro = new ResizeObserver(([e]) => setArea({ w: e.contentRect.width, h: e.contentRect.height })); ro.observe(scr.current); return () => ro.disconnect(); }, []);
  const fw = seq.width, fh = seq.height;
  const fit = Math.max(0.01, Math.min((area.w - 16) / fw, (area.h - 16) / fh));
  const trimView = !isSource && !!tm && !playing;
  const cmpOn = !isSource && !!cmp?.on && !tm; const side = cmpOn && cmp.mode === 'side', split = cmpOn && !side;
  // Side by Side: two frames fitted next to each other (Magnification applies to the single view only)
  const k = side ? Math.max(0.01, Math.min((area.w - 28) / 2 / fw, (area.h - 16) / fh)) : zoom !== 'Fit' && !isSource ? parseInt(zoom, 10) / 100 : fit;
  const box = { w: Math.max(1, Math.round(fw * k)), h: Math.max(1, Math.round(fh * k)) };
  const overlayOn = !isSource && !maskDraw && !mcView && tool === 'selection';
  return (
    <div className={`monitor ${activeMon === (isSource ? 'source' : 'program') ? 'mon-active' : ''}`} onMouseDownCapture={() => set({ activeMonitor: isSource ? 'source' : 'program' })}>
      <div className="screen-wrap">
      <div className="screen" ref={scr}>
        {trimView && <TrimView tm={tm} seq={seq} area={area} tA={tA} tB={tB} />}
        <div className="cmp-host" style={{ flexDirection: side && cmp.swap ? 'row-reverse' : 'row', display: trimView ? 'none' : undefined }}>
        {side && <div className="cvwrap" style={{ width: box.w, height: box.h }}><canvas ref={cv2} /><span className="cmp-tag">Reference</span></div>}
        <div className="cvwrap" style={{ width: box.w, height: box.h }}>
          <canvas ref={cv} onClick={onDrawClick} onDoubleClick={finishDraw} style={{ cursor: maskDraw ? 'crosshair' : 'default' }} />
          {gfxError && <div className="gfx-error err" role="alert">Graphics unavailable: {gfxError}. Restart EditorStage; if this stays, update the graphics driver. Details: Help &gt; Open Log Folder.</div>}
          {split && <CompareSplit cmp={cmp} cv2={cv2} />}
          {side && <span className="cmp-tag">Current</span>}
          {!isSource && <TransformOverlay W={box.w} H={box.h} enabled={overlayOn} />}
          {!isSource && guides && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="maskovl">{[33.3, 66.6].map((v) => <g key={v}><line x1={v} y1="0" x2={v} y2="100" stroke="#0ff9" strokeWidth="0.2" /><line x1="0" y1={v} x2="100" y2={v} stroke="#0ff9" strokeWidth="0.2" /></g>)}<line x1="50" y1="0" x2="50" y2="100" stroke="#f0f9" strokeWidth="0.2" /><line x1="0" y1="50" x2="100" y2="50" stroke="#f0f9" strokeWidth="0.2" /></svg>}
          {!isSource && rulers && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="maskovl">{Array.from({ length: 21 }, (_, i) => <g key={i}><line x1={i * 5} y1="0" x2={i * 5} y2={i % 2 ? 1.5 : 3} stroke="#fc4" strokeWidth="0.25" /><line x1="0" y1={i * 5} x2={i % 2 ? 1.5 : 3} y2={i * 5} stroke="#fc4" strokeWidth="0.25" /></g>)}</svg>}
          {!isSource && safe && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="maskovl"><rect x="5" y="5" width="90" height="90" fill="none" stroke="#fff9" strokeWidth="0.3" /><rect x="10" y="10" width="80" height="80" fill="none" stroke="#fff9" strokeWidth="0.3" /></svg>}
          {maskDraw && <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="maskovl">{maskDraw.pts.length > 1 && <polyline points={maskDraw.pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="#5ff" strokeWidth="0.004" />}{maskDraw.pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="0.008" fill="#fff" />)}</svg>}
        </div>
        </div>
      </div>
      {!isSource && <div className="seq-badge" title="Sequence frame size (Sequence > Sequence Settings)"><i className="seq-shape" style={seq.width >= seq.height ? { width: 16, height: Math.max(4, Math.round((16 * seq.height) / seq.width)) } : { width: Math.max(4, Math.round((16 * seq.width) / seq.height)), height: 16 }} />{seq.width}×{seq.height} · {aspectLabel(seq.width, seq.height)}</div>}
      </div>
      {cmpOn && <CompareBar cmp={cmp} seq={seq} />}
      {!isSource && tm && <TrimBar tm={tm} />}
      {isSource ? <SourceTransport m={m} /> : <ProgramTransport playhead={playhead} playing={playing} seq={seq} />}
    </div>
  );
}

/** The clip side shown for the primary edit of Trim Mode (a video edit when there is one). */
const trimPrimary = (seq, tm) => tm.edits.find((e) => seq.tracks.find((t) => t.id === e.track)?.kind === 'video') || tm.edits[0];
const fmtOff = (n) => (n > 0 ? `+${n}` : String(n));
const trimMdur = (c) => { const m = c.mediaId && getState().media.find((x) => x.id === c.mediaId); return !m || m.kind === 'image' ? Infinity : m.duration; };

/** Trim Monitor: outgoing frame | incoming frame. Click / drag a side (or the middle for Rolling) to trim; one undo step per drag. */
function TrimView({ tm, seq, area, tA, tB }) {
  const fps = seq.fps || 30; const e = trimPrimary(seq, tm);
  const A = e?.aId && seq.clips.find((c) => c.id === e.aId), B = e?.bId && seq.clips.find((c) => c.id === e.bId);
  const pw = Math.max(40, Math.min((area.w - 70) / 2, ((area.h - 70) * seq.width) / seq.height)), ph = (pw * seq.height) / seq.width;
  const [pending, setPending] = useState(null); // { which, n } while dragging
  // at the media's end / start: the side shows a red frame (Premiere) — probed with a one-frame trim on a copy
  const limit = React.useMemo(() => {
    const probe = (side, n) => ed.trimEdits(structuredClone(seq), trimMdur, tm.edits, 'ripple', side, n / fps) === 0;
    return { a: !!A && probe('a', 1), b: !!B && probe('b', -1) };
  }, [seq, tm.edits, fps, A, B]);
  const active = (w) => (w === 'both' ? tm.type === 'roll' : tm.type !== 'roll' && tm.side === w);
  const drag = (ev, which) => {
    ev.preventDefault(); setTrimSide(which); const x0 = ev.clientX; let n = 0;
    const mv = (m) => { n = Math.round((m.clientX - x0) / 6); setPending({ which, n }); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); setPending(null); if (n) trimBy(n); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  const pend = (w) => (pending && (pending.which === w || pending.which === 'both') && pending.n ? <span className="trim-pend">{fmtOff(pending.n)}</span> : null);
  return (
    <div className={`trim-view ${tm.type}`}>
      <div className={`trim-pane ${active('a') ? 'on' : ''} ${limit.a ? 'limit' : ''}`} onMouseDown={(ev) => drag(ev, 'a')} title="Outgoing clip: click to trim its tail, drag to trim">
        <canvas ref={tA} style={{ width: pw, height: ph }} />
        <div className="trim-info"><span className="ell">{A ? A.name : 'Gap'}</span><span>Out {A ? timecode(ed.clipEnd(A) - 1 / fps, fps) : '—'}</span><b>{fmtOff(tm.offA)}</b>{pend('a')}</div>
      </div>
      <div className={`trim-mid ${active('both') ? 'on' : ''}`} onMouseDown={(ev) => drag(ev, 'both')} title="Rolling edit: click, or drag to move the cut">⇋</div>
      <div className={`trim-pane ${active('b') ? 'on' : ''} ${limit.b ? 'limit' : ''}`} onMouseDown={(ev) => drag(ev, 'b')} title="Incoming clip: click to trim its head, drag to trim">
        <canvas ref={tB} style={{ width: pw, height: ph }} />
        <div className="trim-info"><span className="ell">{B ? B.name : 'Gap'}</span><span>In {B ? timecode(B.start, fps) : '—'}</span><b>{fmtOff(tm.offB)}</b>{pend('b')}</div>
      </div>
    </div>
  );
}

/** Trim Monitor buttons: Trim -N / -1, Apply Default Transitions, Trim +1 / +N (N = Preferences > Large Trim Offset). */
function TrimBar({ tm }) {
  const big = largeTrim(); useStore((s) => s.prefsRev);
  const transitions = () => { const ids = tm.edits.map((e) => e.bId || e.aId).filter(Boolean); set({ selection: ids }); run('seq.defaultTransitions'); set({ selection: [] }); };
  return (
    <div className="transport trim-bar">
      <b className="dim">Trim</b>
      <select title="Trim type (Ctrl+T)" value={tm.type} onChange={(e) => set((s) => ({ trimMode: { ...s.trimMode, type: e.target.value } }))}>{TRIM_TYPES.map((t) => <option key={t} value={t}>{TRIM_LABELS[t]}</option>)}</select>
      <span className="grow" />
      <button title={`Trim Backward Many (Ctrl+Shift+Left)`} onClick={() => trimBy(-big)}>-{big}</button>
      <button title="Trim Backward (Ctrl+Left)" onClick={() => trimBy(-1)}>-1</button>
      <button title="Apply Default Transitions to Selection" onClick={transitions}>⧖</button>
      <button title="Trim Forward (Ctrl+Right)" onClick={() => trimBy(1)}>+1</button>
      <button title={`Trim Forward Many (Ctrl+Shift+Right)`} onClick={() => trimBy(big)}>+{big}</button>
      <span className="grow" />
      <span className="dim">{tm.edits.length} edit{tm.edits.length > 1 ? 's' : ''} · J / L dynamic, K apply · Space loop</span>
      <button title="Leave Trim Mode (Shift+T / Esc)" onClick={exitTrim}>✕</button>
    </div>
  );
}

/** Vertical / Horizontal Split: the Reference canvas over the Current one, clipped at a divider the user drags. */
function CompareSplit({ cmp, cv2 }) {
  const v = cmp.mode === 'vsplit'; const at = cmp.split * 100;
  // Reference on the left / top (right / bottom when swapped)
  const clip = v ? (cmp.swap ? `inset(0 0 0 ${at}%)` : `inset(0 ${100 - at}% 0 0)`) : cmp.swap ? `inset(${at}% 0 0 0)` : `inset(0 0 ${100 - at}% 0)`;
  const drag = (e) => {
    e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.parentElement.getBoundingClientRect();
    const mv = (ev) => { const f = v ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height; set((s) => ({ compare: { ...s.compare, split: Math.max(0.02, Math.min(0.98, f)) } })); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); rememberCompare(getState().compare); };
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  const [a, b] = cmp.swap ? ['Current', 'Reference'] : ['Reference', 'Current'];
  return <>
    <canvas ref={cv2} className="cmp-ref" style={{ clipPath: clip }} />
    <div className={`cmp-divider ${v ? 'v' : 'h'}`} style={v ? { left: `${at}%` } : { top: `${at}%` }} onMouseDown={drag} title="Drag to move the split" />
    <span className="cmp-tag">{a}</span><span className={`cmp-tag ${v ? 'right' : 'bottom'}`}>{b}</span>
  </>;
}

/** Comparison View controls: layout, Shot / Frame, the reference position (Shot) and Swap Sides. */
function CompareBar({ cmp, seq }) {
  const upd = (patch) => run('view.comparisonView', { ...patch, on: true });
  const end = Math.max(seq.duration || 0, ...seq.clips.map((c) => c.start + c.dur)) || 1;
  return (
    <div className="transport cmp-bar">
      <b className="dim">Compare</b>
      <select title="Comparison layout" value={cmp.mode} onChange={(e) => upd({ mode: e.target.value })}>{COMPARE_MODES.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
      <span className="seg">
        <button className={cmp.kind === 'shot' ? 'active' : ''} title="Shot Comparison: the reference is another moment of the sequence" onClick={() => upd({ kind: 'shot' })}>Shot</button>
        <button className={cmp.kind === 'frame' ? 'active' : ''} title="Frame Comparison: the same frame before its colour / effects (before / after)" onClick={() => upd({ kind: 'frame' })}>Frame</button>
      </span>
      {cmp.kind === 'shot' && <>
        <button title="Reference: Previous Edit" onClick={() => upd({ refTime: prevEdit(seq, cmp.refTime) })}>⇤</button>
        <input className="grow" type="range" min="0" max={end} step={1 / (seq.fps || 30)} value={Math.min(cmp.refTime, end)} title="Reference frame" onChange={(e) => upd({ refTime: +e.target.value })} />
        <button title="Reference: Next Edit" onClick={() => upd({ refTime: nextEdit(seq, cmp.refTime) })}>⇥</button>
        <span className="timecode" title="Reference time">{timecode(cmp.refTime, seq.fps)}</span>
        <button title="Use the playhead frame as the reference" onClick={() => upd({ refTime: getState().playhead })}>⌖</button>
      </>}
      {cmp.kind === 'frame' && <span className="grow dim">Reference = this frame without Lumetri, Filter and video effects</span>}
      <button title="Swap Sides" onClick={() => run('view.compareSwap')}>⇄</button>
      <button title="Close Comparison View" onClick={() => run('view.comparisonView', { on: false })}>✕</button>
    </div>
  );
}

function ProgramTransport({ playhead, playing, seq }) {
  const cmpOn = useStore((s) => !!s.compare?.on); const mcv = useStore((s) => s.mcView); const pausedRes = useStore((s) => s.pausedRes); const loop = useStore((s) => s.loop); const safe = useStore((s) => s.safeMargins); const guides = useStore((s) => s.showGuides); const rulers = useStore((s) => s.showRulers); const zoom = useStore((s) => s.monitorZoom);
  const inP = useStore((s) => s.inPoint), outP = useStore((s) => s.outPoint);
  return (
    <div className="transport">
      <span className="timecode">{timecode(playhead, seq.fps)}</span>
      <button title="Mark In (I)" onClick={() => run('marker.markIn')}>{'{'}</button>
      <button title="Mark Out (O)" onClick={() => run('marker.markOut')}>{'}'}</button>
      <button title="Go to In (Shift+I)" disabled={inP == null} onClick={() => run('marker.goIn')}>⇤</button>
      <button title="Step Back (←)" onClick={() => run('play.stepBack')}>◂|</button>
      <button title="Play/Stop (Space)" onClick={() => run('play.toggle')}>{playing ? '⏸' : '▶'}</button>
      <button title="Step Forward (→)" onClick={() => run('play.stepForward')}>|▸</button>
      <button title="Go to Out (Shift+O)" disabled={outP == null} onClick={() => run('marker.goOut')}>⇥</button>
      <button title="Loop" className={loop ? 'active' : ''} onClick={() => run('play.loop')}>⟲</button>
      <button title="Safe Margins" className={safe ? 'active' : ''} onClick={() => run('view.safeMargins')}>▣</button>
      <button title="Lift (;)" onClick={() => run('seq.lift')}>⎘</button>
      <button title="Extract (')" onClick={() => run('seq.extract')}>⎗</button>
      <button title="Add Marker (M)" onClick={() => run('marker.add')}>◆</button>
      <button title="Export Frame (Ctrl+Shift+E)" onClick={() => run('file.exportFrame')}>📷</button>
      <ProxyToggle />
      <button title="Toggle Multi-Camera View" className={mcv ? 'active' : ''} onClick={() => run('clip.multicamView')}>⊞</button>
      <button title="Comparison View" className={cmpOn ? 'active' : ''} onClick={() => run('view.comparisonView')}>◫</button>
      <span className="grow" />
      <select title="Paused Resolution" value={pausedRes} onChange={(e) => run(`view.pausedRes.${e.target.value}`)}>{['Full', '1/2', '1/4', '1/8', '1/16'].map((r) => <option key={r}>{r}</option>)}</select>
    </div>
  );
}

function ProxyToggle() { const on = useStore((s) => !!s.useProxies); return <button title="Toggle Proxies (playback only; export uses full resolution)" className={on ? 'active' : ''} onClick={() => run('view.toggleProxies')}>P</button>; }
function SourceTransport({ m }) {
  const srcIn = useStore((s) => s.sourceIn), srcOut = useStore((s) => s.sourceOut), t0 = useStore((s) => s.sourceTime);
  const [playing, setPlaying] = useState(false);
  const el = m ? elementForMedia(m, `src:${m.id}`) : null;
  useEffect(() => {
    if (!el || !el.play) return;
    const tick = () => { if (!el.paused) set({ sourceTime: el.currentTime }); };
    const id = setInterval(tick, 50); const onEnd = () => setPlaying(false); el.addEventListener('ended', onEnd);
    return () => { clearInterval(id); el.removeEventListener('ended', onEnd); el.pause(); };
  }, [el]);
  useEffect(() => { if (el && el.pause && Math.abs(el.currentTime - t0) > 0.05 && el.paused) el.currentTime = t0; }, [t0, el]);
  if (!m) return <div className="transport dim">Select a clip in the Project panel</div>;
  const dur = m.duration || 1;
  return (
    <div className="transport">
      <span className="timecode">{timecode(t0, getState().sequence.fps)}</span>
      <button title="Mark In (I)" onClick={() => set({ sourceIn: t0 })}>{'{'}</button>
      <button title="Mark Out (O)" onClick={() => set({ sourceOut: t0 })}>{'}'}</button>
      <button title="Play/Stop" disabled={m.kind === 'image' || !el?.play} onClick={() => { if (!el?.play) return; if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); } }}>{playing ? '⏸' : '▶'}</button>
      <input type="range" className="grow" min="0" max={dur} step="0.01" value={Math.min(t0, dur)} onChange={(e) => { if (el?.pause) el.pause(); setPlaying(false); set({ sourceTime: +e.target.value }); }} />
      <span className="dim">{srcIn != null ? `In ${srcIn.toFixed(2)}` : ''} {srcOut != null ? `Out ${srcOut.toFixed(2)}` : ''}</span>
      <button title="Insert (,)" onClick={() => run('edit.insert')}>⤓ Insert</button>
      <button title="Overwrite (.)" onClick={() => run('edit.overwrite')}>⤒ Overwrite</button>
    </div>
  );
}
// ---------- Effects tree ----------
// root name -> drag payload category + the track kind it may be dropped on
const ROOT_INFO = {
  'Video Effects': { category: 'Video', media: 'video' }, 'Video Transitions': { category: 'Transition', media: 'video' },
  'Audio Effects': { category: 'Audio', media: 'audio' }, 'Audio Transitions': { category: 'Transition', media: 'audio' },
};
// effects / transitions added in round 2 get a "New" badge; every video effect and transition renders on the GPU (WebGL)
const NEW_FX = new Set([...Object.values(MORE_VIDEO_FX), ...Object.values(MORE_TRANSITIONS), ...Object.values(MORE_AUDIO_FX)].flatMap((x) => Object.keys(x)).concat(Object.keys(MORE_CROSSFADES)));
const statusMark = (root, e) => {
  const st = root === 'Video Effects' ? VIDEO_FX[e]?.status : root === 'Audio Effects' ? AUDIO_FX[e]?.status : root === 'Video Transitions' && APPROX_TRANSITIONS.has(e) ? 'approx' : null;
  return <>
    {st === 'unsupported' ? <span className="badge unsupported" title="Not implemented (no visible effect)">n/a</span> : st === 'approx' ? <span className="badge approx" title="Approximation of Premiere's effect">≈</span> : null}
    {root.startsWith('Video') && !VIDEO_FX[e]?.custom && <span className="badge gpu" title="GPU accelerated">GPU</span>}
    {NEW_FX.has(e) && <span className="badge new" title="Added in this version">New</span>}
  </>;
};
const rootFolderOf = (root, name) => Object.entries(EFFECT_ROOTS.find((r) => r.name === root)?.tree || {}).find(([, l]) => Array.isArray(l) && l.includes(name))?.[0];
/** "Video Effects/Gaussian Blur" style key -> item; presets are "preset:<id>" */
function itemOf(key) {
  if (key.startsWith('preset:')) { const preset = findPreset(key.slice(7)); return preset && { kind: 'preset', key, name: preset.name, preset, media: preset.media }; }
  const i = key.indexOf('/'); const root = key.slice(0, i), name = key.slice(i + 1); const info = ROOT_INFO[root]; const folder = rootFolderOf(root, name);
  return info && folder && { kind: info.category === 'Transition' ? 'transition' : 'effect', key, root, folder, name, media: info.media };
}
const payloadOf = (it) => (it.kind === 'preset'
  ? { type: 'EFFECT', preset: it.preset.id, effectId: `Presets/${it.preset.id}`, effectName: it.preset.name, category: it.preset.transition ? 'Transition' : 'Preset', media: it.media, folder: it.preset.folder.join('/') }
  : { type: 'EFFECT', effectId: `${it.root}/${it.folder}/${it.name}`, effectName: it.name, category: ROOT_INFO[it.root].category, media: it.media, folder: it.folder });
const applyItem = (it) => { recordRecent(it.key); if (it.kind === 'preset') applyPreset(getState().selection, it.preset); else applyEffectToClips(getState().selection, payloadOf(it)); };

// hover preview: one floating card for the whole panel
let hoverSet = () => {};
function HoverCard() {
  const [h, setH] = useState(null); const cv = useRef(null);
  useEffect(() => { hoverSet = setH; return () => { hoverSet = () => {}; }; }, []);
  useEffect(() => {
    if (!h || !previewable(h.item)) return undefined;
    let raf = 0, last = 0; const t0 = performance.now();
    const loop = (now) => { raf = requestAnimationFrame(loop); if (now - last < 66 || !cv.current) return; last = now; drawPreview(cv.current.getContext('2d'), h.item, (now - t0) / 1000); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, [h]);
  if (!h) return null;
  const it = h.item, p = it.preset;
  const where = it.kind === 'preset' ? `Preset · ${p.folder.join(' › ')}${p.type && !p.transition ? ' · ' + (PRESET_TYPES.find((x) => x[0] === p.type)?.[1] || '') : ''}` : `${it.root} › ${it.folder}`;
  return (
    <div className="fx-hover" style={{ left: h.x, top: h.y }}>
      {previewable(it) && <canvas ref={cv} width={PW} height={PH} />}
      <div className="fx-hover-name">{it.name}</div>
      <div className="dim">{where}</div>
      {p?.description && <div>{p.description}</div>}
      {p && <div className="dim">{[...(p.effects || []).map((e) => e.name), p.motion && 'Motion', p.opacity && 'Opacity', p.lumetri && 'Lumetri Color', p.transition && p.transition.name].filter(Boolean).join(' + ')}</div>}
      {p?.tags?.length > 0 && <div className="dim">#{p.tags.join(' #')}</div>}
    </div>
  );
}
let hoverTimer = 0;
const hoverProps = (it) => ({
  onMouseEnter: (e) => { const r = e.currentTarget.getBoundingClientRect(); clearTimeout(hoverTimer); hoverTimer = setTimeout(() => hoverSet({ item: it, x: Math.min(r.right + 8, window.innerWidth - 220), y: Math.min(r.top, window.innerHeight - 220) }), 350); },
  onMouseLeave: () => { clearTimeout(hoverTimer); hoverSet(null); },
});
function Leaf({ it }) {
  useStore((s) => s.presetsRev);
  const fav = getFavorites().includes(it.key);
  const onMenu = (e) => { e.preventDefault(); if (it.kind === 'preset' && !it.preset.builtin && window.confirm(`Delete preset "${it.preset.name}"?`)) deleteUserPreset(it.preset.id); else if (it.kind !== 'preset' || it.preset.builtin) toggleFavorite(it.key); };
  return (
    <div className="leaf" draggable onDragStart={(ev) => { hoverSet(null); recordRecent(it.key); beginEffectDrag(ev, payloadOf(it)); }} onDragEnd={endEffectDrag} onDoubleClick={() => applyItem(it)} onContextMenu={onMenu} {...hoverProps(it)}>
      <span className={'fav' + (fav ? ' on' : '')} title={fav ? 'Remove from Favorites' : 'Add to Favorites'} onClick={(e) => { e.stopPropagation(); toggleFavorite(it.key); }}>★</span>
      {it.kind === 'preset' ? '◆' : 'ƒx'} {it.name}{it.kind !== 'preset' && statusMark(it.root, it.name)}
    </div>
  );
}
function Folder({ name, children, open: open0 = false }) {
  const [open, setOpen] = useState(open0);
  return <div className="tree"><div className="node" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} 📁 {name}</div>{open && children}</div>;
}
function Tree({ name, tree, root = name, open }) {
  return (
    <Folder name={name} open={open}>
      {Array.isArray(tree)
        ? tree.map((e) => <Leaf key={e} it={{ kind: ROOT_INFO[root].category === 'Transition' ? 'transition' : 'effect', key: `${root}/${e}`, root, folder: name, name: e, media: ROOT_INFO[root].media }} />)
        : Object.entries(tree).map(([k, v]) => <Tree key={k} name={k} tree={v} root={root} open={open} />)}
    </Folder>
  );
}
/** presets grouped by their folder path */
function presetTree(list) {
  const root = { dirs: {}, items: [] };
  for (const p of list) { let n = root; for (const f of p.folder || []) n = n.dirs[f] = n.dirs[f] || { dirs: {}, items: [] }; n.items.push(p); }
  return root;
}
function PresetNode({ name, node, open }) {
  return (
    <Folder name={name} open={open}>
      {Object.entries(node.dirs).map(([k, v]) => <PresetNode key={k} name={k} node={v} open={open} />)}
      {node.items.map((p) => <Leaf key={p.id} it={{ kind: 'preset', key: `preset:${p.id}`, name: p.name, preset: p, media: p.media }} />)}
    </Folder>
  );
}
/** every word of the query appears in the name, folders, tags or description */
export const fxMatches = (q, ...texts) => { const words = q.toLowerCase().split(/\s+/).filter(Boolean); const hay = texts.flat(2).filter(Boolean).join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); };
function Effects() {
  const [q, setQ] = useState('');
  useStore((s) => s.presetsRev);
  useEffect(() => { loadUserPresets(); }, []);
  const presets = allPresets().filter((p) => !q || fxMatches(q, p.name, p.folder, p.tags, p.description, (p.effects || []).map((e) => e.name)));
  const favs = getFavorites().map(itemOf).filter(Boolean), recent = getRecent().map(itemOf).filter(Boolean);
  const importPresets = async () => {
    const [f] = (await window.editorstage?.openDialog?.('preset')) || []; if (!f) return;
    try { const list = parsePresetsFile(await window.editorstage.readText(f)); for (const p of list) await saveUserPreset(p); window.alert(list.length ? `Imported ${list.length} preset(s) into My Presets.` : 'No presets that EditorStage can use were found in this file.'); } catch (e) { window.alert('Could not read this preset file: ' + e.message); }
  };
  const exportPresets = async () => {
    const mine = getUserPresets(); if (!mine.length) { window.alert('My Presets is empty. Save one first: Effect Controls > right-click an effect > Save Preset…'); return; }
    const out = await window.editorstage?.saveDialog?.('preset', 'My Presets.espreset'); if (out) await window.editorstage.writeFile(out, presetsFileText(mine));
  };
  return (
    <div className="panel-pad effects-panel">
      <div className="row"><input placeholder="Search effects, presets, tags…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button title="Import presets (.espreset, Premiere .prfpset)" onClick={importPresets}>⇩</button><button title="Export My Presets (.espreset)" onClick={exportPresets}>⇧</button></div>
      {!q && favs.length > 0 && <Folder name="★ Favorites" open>{favs.map((it) => <Leaf key={it.key} it={it} />)}</Folder>}
      {!q && recent.length > 0 && <Folder name="Recently Used">{recent.map((it) => <Leaf key={it.key} it={it} />)}</Folder>}
      {(presets.length > 0 || !q) && <PresetNode key={'p' + q} name={`Presets (${presets.length})`} node={presetTree(presets)} open={!!q} />}
      {EFFECT_ROOTS.filter((r) => r.name !== 'Presets').map((r) => {
        const tree = !q ? r.tree : Object.fromEntries(Object.entries(r.tree).map(([k, v]) => [k, v.filter((x) => fxMatches(q, x, k, r.name))]).filter(([, v]) => v.length));
        return (!q || Object.keys(tree).length > 0) && <Tree key={r.name + q} name={r.name} tree={tree} open={!!q} />;
      })}
      <HoverCard />
    </div>
  );
}

// ---------- Essential Graphics (MOGRT) ----------
function GraphicEditor({ clip }) {
  const g = clip.graphic; const up = (patch) => edit('Edit Graphic', ({ seq }) => { const c = seq.clips.find((x) => x.id === clip.id); Object.assign(c.graphic, patch); }, { coalesce: 'g:' + clip.id });
  const isText = g.type === 'text' || g.type === 'vtext';
  return (
    <div className="panel-pad">
      <h4>{clip.name} <span className="dim">({g.type})</span></h4>
      {isText && <>
        <textarea rows="3" style={{ width: '100%' }} value={g.text} onChange={(e) => up({ text: e.target.value })} />
        <div className="param"><label>Font</label><FontPicker value={g.font} onChange={(f) => up({ font: f })} /></div>
        <div className="param"><label>Size</label><input type="range" min="8" max="400" value={g.size} onChange={(e) => up({ size: +e.target.value })} /><NumInput className="num" type="number" value={g.size} onChange={(e) => up({ size: +e.target.value })} /></div>
        <div className="param"><label>Style</label><button className={g.bold ? 'active' : ''} onClick={() => up({ bold: !g.bold })}>B</button><button className={g.italic ? 'active' : ''} onClick={() => up({ italic: !g.italic })}>I</button>{['left', 'center', 'right'].map((a) => <button key={a} className={g.align === a ? 'active' : ''} onClick={() => up({ align: a })}>{a[0].toUpperCase()}</button>)}</div>
      </>}
      {!isText && <>
        <div className="param"><label>Width</label><input type="range" min="0.02" max="1" step="0.01" value={g.w} onChange={(e) => up({ w: +e.target.value })} /></div>
        <div className="param"><label>Height</label><input type="range" min="0.02" max="1" step="0.01" value={g.h} onChange={(e) => up({ h: +e.target.value })} /></div>
        {g.type === 'rect' && <div className="param"><label>Corner radius</label><input type="range" min="0" max="200" value={g.radius} onChange={(e) => up({ radius: +e.target.value })} /></div>}
        {g.type === 'polygon' && <div className="param"><label>Sides</label><input type="range" min="3" max="12" value={g.sides} onChange={(e) => up({ sides: +e.target.value })} /></div>}
      </>}
      <div className="param"><label>Position X / Y</label><NumInput className="num" type="number" step="0.01" value={+g.x.toFixed(3)} onChange={(e) => up({ x: +e.target.value })} /><NumInput className="num" type="number" step="0.01" value={+g.y.toFixed(3)} onChange={(e) => up({ y: +e.target.value })} /></div>
      <div className="param"><label>Fill</label><input type="color" value={g.color} onChange={(e) => up({ color: e.target.value })} /></div>
      <div className="param"><label>Stroke</label><input type="checkbox" checked={g.stroke} onChange={(e) => up({ stroke: e.target.checked })} /><input type="color" value={g.strokeColor} onChange={(e) => up({ strokeColor: e.target.value })} /><NumInput className="num" type="number" value={g.strokeW} onChange={(e) => up({ strokeW: +e.target.value })} /></div>
      {isText && <><div className="param"><label>Shadow</label><input type="checkbox" checked={g.shadow} onChange={(e) => up({ shadow: e.target.checked })} /></div><div className="param"><label>Background</label><input type="checkbox" checked={g.bg} onChange={(e) => up({ bg: e.target.checked })} /><input type="color" value={g.bgColor} onChange={(e) => up({ bgColor: e.target.value })} /></div></>}
    </div>
  );
}

// ---------- Essential Sound (works on the selected audio clip) ----------
const TAG_DEFAULTS = {
  Dialogue: { loudnessTarget: -23, gain: 0 }, Music: { loudnessTarget: -20, gain: -6 },
  SFX: { loudnessTarget: -20, gain: -3 }, Ambience: { loudnessTarget: -30, gain: -9 },
};
const REPAIR = ['Reduce Noise', 'Reduce Rumble', 'DeHum', 'DeEss', 'Reduce Reverb'];
const CLARITY = ['Dynamics', 'EQ', 'Enhance Speech'];

function DuckingSection({ clips, a, patch }) {
  const d = { ...DUCK_DEFAULTS, ...(a.ducking || {}) };
  const [busy, setBusy] = React.useState(null); const [msg, setMsg] = React.useState('');
  const setD = (label, k, v) => patch(label, (au) => { au.ducking = { ...DUCK_DEFAULTS, ...(au.ducking || {}), [k]: v }; });
  const gen = async () => {
    setBusy(0); setMsg('');
    try { const r = await generateDucking(clips.map((c) => c.id), d, setBusy); setMsg(r.ranges.length ? `${r.ranges.length} ducked stretch${r.ranges.length > 1 ? 'es' : ''}: edit the keyframes in Effect Controls > Volume > Level` : 'No active sound found in the "duck against" clips'); }
    catch (e) { setMsg(String(e.message || e)); }
    setBusy(null);
  };
  return <details open><summary>Ducking</summary>
    <div className="param"><label>Duck against</label>{['Dialogue', 'Music', 'SFX', 'Ambience', 'Untagged'].map((t) => <label key={t} style={{ width: 'auto', marginRight: 6 }}><input type="checkbox" checked={d.against.includes(t)} onChange={(e) => setD('Duck Against', 'against', e.target.checked ? [...d.against, t] : d.against.filter((x) => x !== t))} />{t}</label>)}</div>
    <div className="param"><label>Sensitivity</label><input type="range" min="0" max="10" step="0.5" value={d.sensitivity} onChange={(e) => setD('Ducking Sensitivity', 'sensitivity', +e.target.value)} /><span className="val">{d.sensitivity}</span></div>
    <div className="param"><label>Reduce By (dB)</label><input type="range" min="-40" max="0" value={d.reduceBy} onChange={(e) => setD('Duck Amount', 'reduceBy', +e.target.value)} /><span className="val">{d.reduceBy}</span></div>
    <div className="param"><label>Fades (ms)</label><input type="range" min="0" max="3000" step="50" value={d.fadeMs} onChange={(e) => setD('Ducking Fades', 'fadeMs', +e.target.value)} /><span className="val">{d.fadeMs}</span></div>
    <div className="param"><button disabled={busy != null || !d.against.length} onClick={gen}>{busy != null ? `Analysing… ${Math.round(busy * 100)}%` : 'Generate Keyframes'}</button></div>
    {a.duck && <div className="param"><input type="checkbox" checked onChange={() => patch('Auto-Ducking', (au) => { au.duck = false; })} /><label>Live ducking against Dialogue ({a.duckAmt ?? -12} dB, older projects) — Generate Keyframes to make it editable</label></div>}
    {msg && <div className="dim duckmsg">{msg}</div>}
  </details>;
}
function EssentialSound() {
  const sel = useStore((s) => s.selection);
  const seq = useStore((s) => s.sequence);
  const clips = sel.map((id) => seq.clips.find((c) => c.id === id)).filter((c) => c && seq.tracks.find((t) => t.id === c.track)?.kind === 'audio' || (c && c.mediaId && mediaKind(c) === 'audio'));
  if (!clips.length) return <Empty>Select an audio clip in the Timeline to assign an audio type</Empty>;
  const c = clips[0]; const a = c.audio || {};
  const patch = (label, fn) => edit(label, ({ seq: sq, sel: ids }) => sq.clips.filter((x) => ids.includes(x.id)).forEach((x) => { x.audio = x.audio || {}; fn(x.audio, x); }));
  const tag = a.tag;
  return (
    <div className="panel-pad">
      <div className="dim">{clips.length > 1 ? `${clips.length} clips selected` : c.name}</div>
      <div className="tags">{Object.keys(TAG_DEFAULTS).map((t) => (
        <button key={t} className={tag === t ? 'active' : ''} onClick={() => patch(`Tag ${t}`, (au) => Object.assign(au, { tag: t, ...TAG_DEFAULTS[t] }))}>{t}</button>))}
        {tag && <button title="Clear Audio Type" onClick={() => patch('Clear Audio Type', (au) => { for (const k of Object.keys(au)) delete au[k]; })}>✕</button>}
      </div>
      {tag && <>
        <details open><summary>Loudness</summary>
          <div className="param"><button onClick={() => patch('Auto-Match Loudness', (au, x) => { au.gain = +(au.loudnessTarget - (x.measuredLufs ?? -26)).toFixed(1); au.matched = true; })}>Auto-Match</button><span className="dim">{a.matched ? `Gain ${a.gain} dB → ${a.loudnessTarget} LUFS` : `Target ${a.loudnessTarget} LUFS`}</span></div>
        </details>
        <details open><summary>Repair</summary>
          {REPAIR.map((x) => (<div className="param" key={x}><input type="checkbox" checked={!!a.repair?.[x]} onChange={(e) => patch(`Repair: ${x}`, (au) => { au.repair = { ...au.repair, [x]: e.target.checked }; })} /><label>{x}</label>
            {a.repair?.[x] && <input type="range" min="0" max="10" step="0.1" value={a.repair[`${x}Amt`] ?? 5} onChange={(e) => patch(`Repair: ${x}`, (au) => { au.repair = { ...au.repair, [`${x}Amt`]: +e.target.value }; })} />}</div>))}
        </details>
        <details><summary>Clarity</summary>
          {CLARITY.map((x) => (<div className="param" key={x}><input type="checkbox" checked={!!a.clarity?.[x]} onChange={(e) => patch(`Clarity: ${x}`, (au) => { au.clarity = { ...au.clarity, [x]: e.target.checked }; })} /><label>{x}</label></div>))}
        </details>
        <details open><summary>Volume</summary>
          <div className="param"><label>Level (dB)</label><input type="range" min="-30" max="15" step="0.5" value={a.gain ?? 0} onChange={(e) => patch('Clip Volume', (au) => { au.gain = +e.target.value; })} /><span className="val">{a.gain ?? 0}</span></div>
        </details>
        {tag === 'Music' && <DuckingSection clips={clips} a={a} patch={patch} />}
        {tag === 'Music' && <details open={!!c.remix}><summary>Duration</summary><RemixControls key={c.id} clipId={c.id} /></details>}
      </>}
    </div>
  );
}
const mediaKind = (c) => getState().media.find((m) => m.id === c.mediaId)?.kind;
/** Markers panel (Premiere): colour, name, In / Out / Duration timecode, comments; search; click = go there; name and comments edit in place */
function Markers() {
  const seq = useStore((s) => s.sequence); const sel = useStore((s) => s.selectedMarker); const [q, setQ] = useState('');
  const fps = seq.fps || 30; const ql = q.trim().toLowerCase();
  const ms = [...seq.markers].sort((a, b) => a.time - b.time).filter((m) => !ql || `${m.name || ''} ${m.comment || ''}`.toLowerCase().includes(ql));
  const field = (m, k) => <input className="mk-edit" value={m[k] || ''} placeholder={k === 'name' ? 'Marker' : ''} onClick={(e) => e.stopPropagation()}
    onChange={(e) => updateMarker('seq', null, m.id, { [k]: e.target.value }, k === 'name' ? 'Rename Marker' : 'Marker Comments')} />;
  return <div className="markers-panel">
    <input className="mk-search" placeholder="Search markers" value={q} onChange={(e) => setQ(e.target.value)} />
    {!seq.markers.length ? <Empty>No markers. Press M to add one at the playhead.</Empty> : <table className="mk-table"><thead><tr><th /><th>Name</th><th>In</th><th>Out</th><th>Duration</th><th>Comments</th></tr></thead>
      <tbody>{ms.map((m) => <tr key={m.id} className={sel === m.id ? 'sel' : ''} onClick={() => set({ playhead: m.time, selectedMarker: m.id })} onDoubleClick={() => run('marker.edit', m.id)}>
        <td><i className="mk-dot" style={{ background: markerColor(m) }} title={m.type === 'chapter' ? 'Chapter Marker' : m.type === 'segmentation' ? 'Segmentation Marker' : 'Comment Marker'} /></td>
        <td>{field(m, 'name')}</td><td>{timecode(m.time, fps)}</td><td>{timecode(m.time + (m.dur || 0), fps)}</td><td>{timecode(m.dur || 0, fps)}</td><td>{field(m, 'comment')}</td></tr>)}</tbody></table>}
  </div>;
}
const Row = ({ label, children }) => <div className="mrow"><label>{label}</label>{children}</div>;
/** Metadata: the Project item that is selected (name, label, comment are editable; the rest comes from the file), else the sequence */
function Metadata() {
  const s = useStore((x) => x.sequence); const id = useStore((x) => x.selectedMedia); const m = useStore((x) => x.media.find((q) => q.id === id));
  if (!m) return <div className="panel-pad"><div className="dim">Select an item in the Project panel.</div><div>{s.name}</div><div>{s.width}x{s.height} @ {s.fps}fps</div></div>;
  const put = (k, label) => (e) => { const v = e.target.value; edit(label, ({ media }) => { const x = media.find((q) => q.id === m.id); if (x) x[k] = v || undefined; }, { coalesce: `meta:${k}:${m.id}` }); };
  const dur = (m.subclip ? m.subclip.out - m.subclip.in : m.duration) || 0;
  return <div className="panel-pad meta-panel">
    <Row label="Name"><input value={m.name} onChange={(e) => e.target.value.trim() && put('name', 'Rename')(e)} /></Row>
    <Row label="Label"><select value={m.color || ''} onChange={(e) => run('media.label', m.id, e.target.value || null)}><option value="">None</option>{LABELS.map(([n, hex]) => <option key={hex} value={hex}>{n}</option>)}</select></Row>
    <Row label="Comment"><textarea rows={3} value={m.comment || ''} onChange={put('comment', 'Comment')} /></Row>
    <Row label="Description"><textarea rows={2} value={m.description || ''} onChange={put('description', 'Description')} /></Row>
    {[['Type', m.subclip ? 'Subclip' : m.synthetic ? 'Synthetic' : m.kind], ['File path', m.path || '-'], ['Media duration', timecode(dur, s.fps)], ['Frame size', m.width ? `${m.width}×${m.height}` : '-'], ['Frame rate', m.fps ? `${m.fps} fps` : '-'], ['Audio', m.kind === 'image' ? '-' : m.hasAudio === false ? 'none' : 'yes'], ['Proxy', m.proxy?.status === 'ready' ? m.proxy.path : '-']]
      .map(([k, v]) => <Row key={k} label={k}><span className="dim" style={{ userSelect: 'text', wordBreak: 'break-all' }}>{v}</span></Row>)}
  </div>;
}
function Info() {
  const s = useStore((x) => x); const m = s.media.find((x) => x.id === s.selectedMedia);
  return <div className="panel-pad">{m ? <><div><b>{m.name}</b></div><div>{m.kind} · {m.ext.toUpperCase()} · {m.duration.toFixed(2)}s</div>{m.width ? <div>{m.width}×{m.height}</div> : null}<div className="dim">{m.path}</div></> : <Empty>Select an item in Project</Empty>}<div>In: {s.inPoint?.toFixed(2) ?? '-'} · Out: {s.outPoint?.toFixed(2) ?? '-'}</div></div>;
}
function Find() { const [q, setQ] = useState(''); const media = useStore((s) => s.media); return <div className="panel-pad"><h4>Find</h4><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project…" /><ul className="list">{q && media.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())).map((m) => <li key={m.id} onClick={() => set({ selectedMedia: m.id })}>{m.name}</li>)}</ul></div>; }


import { EssentialGraphicsTabs } from './MogrtPanel';
import SmartTools from './SmartTools';
import TextPanel from './TextPanel';
import CreatePanel from './CreatePanel';
import { ArchivePanel, VersionsPanel } from './WorkflowPanels';
import { Project as Project2, MediaBrowser as MediaBrowser2, History as History2, Mixer as Mixer2, Scopes as Scopes2 } from './Panels2';
export const PANEL_COMPONENTS = {
  program: () => <Monitor label="Program" />, source: () => <Monitor label="Source" />,
  timeline: Timeline, project: Project2, effects: Effects, effectControls: EffectControls,
  lumetriColor: Lumetri, lumetriScopes: Scopes2, essentialGraphics: () => <EssentialGraphicsTabs GraphicEditor={GraphicEditor} />, essentialSound: EssentialSound,
  audioTrackMixer: () => <Mixer2 />, audioClipMixer: () => <Mixer2 clip />, history: History2, markers: Markers,
  metadata: Metadata, mediaBrowser: MediaBrowser2, libraries: LibrariesPanel, info: Info, find: Find,
  smartTools: SmartTools, text: TextPanel, create: CreatePanel, archive: ArchivePanel, versions: VersionsPanel, learn: LearnPanel,
};
