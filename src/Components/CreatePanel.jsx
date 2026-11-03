// Create panel (CapCut-style tools in one place): Filters, Canvas (background fill), Captions, Voice Changer, AI,
// Shorts (Long-to-Shorts) and B-Roll (Smart B-Roll).
// Point at an item to preview it on the selected clips in the Program Monitor; click to apply (one undo step).
import React, { useEffect, useRef, useState } from 'react';
import { useStore, edit, getState, set } from '../Core/store';
import { FILTERS, FILTER_CATEGORIES, applyLook } from '../Services/filters';
import { VOICES } from '../Services/audioFx';
import { renderFrame } from '../Services/exporter';
import { previewStart, previewEnd } from '../Services/hoverPreview';
import { CAPTION_PRESETS, defaultCaptionStyle } from '../Services/ai/captions';
import { requestPanel } from '../Core/layout';
import { ShortsTab, BRollTab } from './CreateAiTabs';

const trackKind = (seq, c) => seq.tracks.find((t) => t.id === c.track)?.kind;
/** The clips a tool works on: the selected clips of that kind, else the one under the playhead on the top track. */
export function targetClips(kind = 'video', s = getState()) {
  const seq = s.sequence;
  const sel = seq.clips.filter((c) => s.selection.includes(c.id) && trackKind(seq, c) === kind);
  if (sel.length) return sel.map((c) => c.id);
  const tracks = seq.tracks.filter((t) => t.kind === kind).map((t) => t.id);
  const under = seq.clips.filter((c) => tracks.includes(c.track) && c.enabled !== false && s.playhead >= c.start && s.playhead < c.start + c.dur && (kind !== 'video' || c.mediaId))
    .sort((a, b) => tracks.indexOf(a.track) - tracks.indexOf(b.track));
  return under.length ? [under[0].id] : [];
}
const patchClips = (ids, fn) => (seq) => { for (const c of seq.clips) if (ids.includes(c.id)) fn(c); };
const hover = (ids, fn) => ({ onMouseEnter: () => ids.length && previewStart(patchClips(ids, fn)), onMouseLeave: previewEnd });
const apply = (label, ids, fn) => { previewEnd(); if (!ids.length) return; edit(label, ({ seq }) => patchClips(ids, fn)(seq)); };

// ---------------------------------------------------------------- Filters
function useThumbBase() {
  const ph = useStore((s) => s.playhead); const seq = useStore((s) => s.sequence); const [img, setImg] = useState(null);
  const stamp = useRef(0);
  useEffect(() => {
    const my = ++stamp.current; const tm = setTimeout(async () => {
      if (getState().playing) return;
      try { const w = 96, h = Math.max(2, Math.round((96 * seq.height) / seq.width / 2) * 2); const f = await renderFrame(getState().playhead, w, h); if (my === stamp.current) setImg(f); } catch { /* nothing to show */ }
    }, 400);
    return () => clearTimeout(tm);
  }, [ph, seq.clips.length]);
  return img;
}
function Thumb({ base, id }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !base) return; cv.width = base.width; cv.height = base.height;
    const out = new ImageData(base.width, base.height); const d = base.data, o = out.data;
    for (let i = 0; i < d.length; i += 4) { const r = applyLook(id, [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]); o[i] = r[0] * 255; o[i + 1] = r[1] * 255; o[i + 2] = r[2] * 255; o[i + 3] = 255; }
    cv.getContext('2d').putImageData(out, 0, 0);
  }, [base, id]);
  return <canvas ref={ref} className="cthumb" />;
}
function FiltersTab() {
  const s = useStore((x) => x); const ids = targetClips('video', s); const base = useThumbBase();
  const cur = ids.length ? s.sequence.clips.find((c) => c.id === ids[0])?.filter : null;
  const [cat, setCat] = useState('All'); const [amt, setAmt] = useState(cur?.intensity ?? 100);
  useEffect(() => { if (cur) setAmt(cur.intensity ?? 100); }, [cur?.id, cur?.intensity]);
  const list = FILTERS.filter((f) => cat === 'All' || f.category === cat);
  return <div>
    <div className="ctabs2">{['All', ...FILTER_CATEGORIES].map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
    {!ids.length && <div className="dim">Select a video clip (or put the playhead over one).</div>}
    <div className="cgrid">
      <div className="ctile" onClick={() => apply('Remove Filter', ids, (c) => { delete c.filter; })} {...hover(ids, (c) => { delete c.filter; })}><div className="cthumb cnone">None</div><span>None</span></div>
      {list.map((f) => <div key={f.id} data-filter={f.id} className={`ctile${cur?.id === f.id ? ' active' : ''}`} title={`${f.name} (${f.category})`}
        onClick={() => apply(`Filter: ${f.name}`, ids, (c) => { c.filter = { id: f.id, intensity: amt }; })} {...hover(ids, (c) => { c.filter = { id: f.id, intensity: amt }; })}>
        <Thumb base={base} id={f.id} /><span>{f.name}</span></div>)}
    </div>
    {cur && <div className="param"><label>Intensity</label><input type="range" min="0" max="100" value={amt} onChange={(e) => { const v = +e.target.value; setAmt(v); edit('Filter Intensity', ({ seq }) => patchClips(ids, (c) => { if (c.filter) c.filter.intensity = v; })(seq), { coalesce: 'filteramt' }); }} /><span className="val">{amt}</span></div>}
  </div>;
}

// ---------------------------------------------------------------- Canvas / Background Fill
const FILL_TYPES = [['none', 'None'], ['blur', 'Blur'], ['color', 'Color'], ['image', 'Image']];
function CanvasTab() {
  const s = useStore((x) => x); const ids = targetClips('video', s); const seq = s.sequence;
  const [scope, setScope] = useState('clip');
  const clip = ids.length ? seq.clips.find((c) => c.id === ids[0]) : null;
  const cur = scope === 'sequence' ? seq.canvasFill || { type: 'none' } : clip?.canvasFill || { type: 'none' };
  const images = s.media.filter((m) => m.kind === 'image' && m.status === 'ready');
  const write = (patch, label = 'Canvas Fill', coalesce) => { previewEnd(); const v = { ...cur, ...patch }; edit(label, ({ seq: q }) => { if (scope === 'sequence') q.canvasFill = v; else patchClips(ids, (c) => { c.canvasFill = v; })(q); }, coalesce ? { coalesce } : undefined); };
  const hv = (patch) => ({ onMouseEnter: () => previewStart((q) => { const v = { ...cur, ...patch }; if (scope === 'sequence') q.canvasFill = v; else patchClips(ids, (c) => { c.canvasFill = v; })(q); }), onMouseLeave: previewEnd });
  return <div>
    <p className="dim">Fills the frame around a clip whose shape does not match the sequence ({seq.width}×{seq.height}).</p>
    <div className="param"><label>Apply to</label><select value={scope} onChange={(e) => setScope(e.target.value)}><option value="clip">Selected clips{ids.length ? ` (${ids.length})` : ''}</option><option value="sequence">Whole sequence (main track)</option></select></div>
    {scope === 'clip' && !ids.length && <div className="dim">Select a video clip.</div>}
    {(scope === 'sequence' || ids.length > 0) && <>
      <div className="cgrid">{FILL_TYPES.map(([k, l]) => <div key={k} data-fill={k} className={`ctile${cur.type === k ? ' active' : ''}`} onClick={() => write({ type: k })} {...hv({ type: k })}><div className={`cthumb cfill-${k}`}>{l}</div><span>{l}</span></div>)}</div>
      {cur.type === 'blur' && <div className="param"><label>Blur</label><input type="range" min="0" max="100" value={cur.blur ?? 50} onChange={(e) => write({ blur: +e.target.value }, 'Canvas Blur', 'canvasblur')} /><span className="val">{cur.blur ?? 50}</span></div>}
      {cur.type === 'color' && <div className="param"><label>Color</label><input type="color" value={cur.color || '#000000'} onChange={(e) => write({ color: e.target.value }, 'Canvas Color', 'canvascolor')} />{['#000000', '#ffffff', '#1e1e1e', '#ffd400', '#ff4fa3', '#3d7bff'].map((c) => <button key={c} className="swatch" style={{ background: c }} title={c} onClick={() => write({ color: c })} />)}</div>}
      {cur.type === 'image' && <div className="param"><label>Image</label><select value={cur.mediaId || ''} onChange={(e) => write({ mediaId: e.target.value })}><option value="">Choose a still image from the project…</option>{images.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>}
      {scope === 'clip' && clip?.canvasFill && <div className="param"><button onClick={() => { previewEnd(); edit('Use Sequence Canvas', ({ seq: q }) => patchClips(ids, (c) => { delete c.canvasFill; })(q)); }}>Use the sequence setting</button></div>}
    </>}
  </div>;
}

// ---------------------------------------------------------------- Captions (presets for caption tracks; generation lives in Smart Tools)
function CaptionsTab() {
  const seq = useStore((s) => s.sequence); const sel = useStore((s) => s.selection);
  const caps = seq.clips.filter((c) => c.caption); const selCaps = caps.filter((c) => sel.includes(c.id));
  const tracks = new Set((selCaps.length ? selCaps : caps).map((c) => c.track));
  const fn = (st) => (c) => { if (c.caption && tracks.has(c.track)) c.caption.style = { ...defaultCaptionStyle(), ...(c.caption.style || {}), ...st }; };
  return <div>
    <div className="param"><button onClick={() => { set({ smartTab: 'subtitles' }); requestPanel('smartTools'); }}>Auto Captions… (speech to text)</button></div>
    {!caps.length ? <div className="dim">No captions yet. Generate them with Auto Captions, then pick a look here.</div> : <>
      <div className="dim">Style for {selCaps.length ? 'the selected caption tracks' : 'all caption tracks'}:</div>
      <div className="cgrid">{Object.entries(CAPTION_PRESETS).map(([k, st]) => <div key={k} className="ctile" onClick={() => { previewEnd(); edit(`Caption Style: ${k}`, ({ seq: q }) => q.clips.forEach(fn(st))); }}
        onMouseEnter={() => previewStart((q) => q.clips.forEach(fn(st)))} onMouseLeave={previewEnd}>
        <div className="cthumb ccap" style={{ color: st.color, background: st.box ? st.boxColor : '#2a2d33', WebkitTextStroke: st.strokePct ? `1px ${st.stroke}` : undefined, fontWeight: st.weight }}>Aa <b style={{ color: st.highlight }}>กข</b></div><span>{k}</span></div>)}</div>
    </>}
  </div>;
}

// ---------------------------------------------------------------- Voice Changer
function VoiceTab() {
  const s = useStore((x) => x); const ids = targetClips('audio', s);
  const has = (c) => (c.effects || []).find((e) => e.name === 'Voice Changer');
  const cur = ids.length ? has(s.sequence.clips.find((c) => c.id === ids[0])) : null;
  const setVoice = (i) => (c) => {
    c.effects = (c.effects || []).filter((e) => e.name !== 'Voice Changer');
    if (i >= 0) c.effects.push({ id: Math.random().toString(36).slice(2, 9), effectId: 'Audio Effects/Special/Voice Changer', name: 'Voice Changer', category: 'Audio', folder: 'Special', enabled: true, params: { voice: { v: i, keys: null }, mix: { v: 100, keys: null } } });
  };
  return <div>
    {!ids.length && <div className="dim">Select an audio clip (or put the playhead over one).</div>}
    <div className="cgrid">
      <div className={`ctile${!cur ? ' active' : ''}`} onClick={() => apply('Remove Voice Changer', ids, setVoice(-1))}><div className="cthumb cnone">None</div><span>None</span></div>
      {VOICES.map(([name], i) => <div key={name} data-voice={name} className={`ctile${cur?.params?.voice?.v === i ? ' active' : ''}`} onClick={() => apply(`Voice: ${name}`, ids, setVoice(i))}><div className="cthumb cvoice">{['🐿', '🐻', '🤖', '📻', '☎', '📢', '⛪', '👹'][i]}</div><span>{name}</span></div>)}
    </div>
    <div className="dim">Voice Changer is an ordinary audio effect: adjust Mix or keyframe it in Effect Controls. Press Space to listen.</div>
  </div>;
}

// ---------------------------------------------------------------- AI
function AiTab() {
  const s = useStore((x) => x); const ids = targetClips('video', s);
  const fx = (c) => (c.effects || []).find((e) => e.name === 'Remove Background');
  const clip = ids.length ? s.sequence.clips.find((c) => c.id === ids[0]) : null; const cur = clip && fx(clip);
  const add = (c) => { if (fx(c)) return; c.effects = c.effects || []; c.effects.push({ id: Math.random().toString(36).slice(2, 9), effectId: 'Video Effects/Keying/Remove Background', name: 'Remove Background', category: 'Video', folder: 'Keying', enabled: true, params: { threshold: { v: 50, keys: null }, feather: { v: 3, keys: null }, choke: { v: 0, keys: null }, invert: { v: false, keys: null } } }); };
  const setP = (k, v) => edit('Remove Background', ({ seq }) => patchClips(ids, (c) => { const e = fx(c); if (e) e.params[k] = { v, keys: null }; })(seq), { coalesce: `rbg:${k}` });
  return <div>
    <h5>Remove Background</h5>
    <p className="dim">Cuts out people with an on-device segmentation model (MediaPipe Selfie Segmenter). Put a background on the track below, or use Canvas.</p>
    {!ids.length && <div className="dim">Select a video clip.</div>}
    {ids.length > 0 && !cur && <button className="primary" onClick={() => apply('Remove Background', ids, add)}>Remove Background</button>}
    {cur && <>
      {[['threshold', 'Threshold', 0, 100], ['feather', 'Feather', 0, 20], ['choke', 'Choke', -10, 10]].map(([k, l, a, b]) => <div className="param" key={k}><label>{l}</label><input type="range" min={a} max={b} value={cur.params[k]?.v ?? 0} onChange={(e) => setP(k, +e.target.value)} /><span className="val">{cur.params[k]?.v}</span></div>)}
      <div className="param"><label>Invert</label><input type="checkbox" checked={!!cur.params.invert?.v} onChange={(e) => setP('invert', e.target.checked)} /></div>
      <button onClick={() => apply('Remove Background Off', ids, (c) => { c.effects = (c.effects || []).filter((e) => e.name !== 'Remove Background'); })}>Turn off</button>
    </>}
  </div>;
}

const TABS = [['filters', 'Filters', FiltersTab], ['canvas', 'Canvas', CanvasTab], ['captions', 'Captions', CaptionsTab], ['voice', 'Voice', VoiceTab], ['ai', 'AI', AiTab], ['shorts', 'Shorts', ShortsTab], ['broll', 'B-Roll', BRollTab]];
export default function CreatePanel() {
  const tab = useStore((s) => s.createTab) || 'filters';
  const C = (TABS.find((t) => t[0] === tab) || TABS[0])[2];
  useEffect(() => () => previewEnd(), []);
  return <div className="createpanel">
    <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => { previewEnd(); set({ createTab: k }); }}>{l}</button>)}</div>
    <div className="panel-pad"><C /></div>
  </div>;
}
