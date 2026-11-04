import React, { useEffect, useState } from 'react';
import NumInput from './NumInput';
import { getPrefs, setPrefs } from '../Core/prefs';
import { useStore, set, edit, getState } from '../Core/store';
import { detectSilence, cutRanges } from '../Services/ai/silence';
import { autoSubtitles, MODELS, modelInfo, LANGUAGES, captionsToSrt, captionsToVtt, captionsToAss } from '../Services/ai/stt';
import ModelPack from './ModelPack';
import { words as segWords } from '../Services/textEngine';
import { CAPTION_STYLES, CAPTION_PRESETS, defaultCaptionStyle, markKeywords } from '../Services/ai/captions';
import { diarize, splitBySpeaker } from '../Services/ai/diarize';
import { reframeSequence, ASPECTS } from '../Services/ai/reframe';
import { audioClipsOf } from '../Services/ai/audioSource';

const notify = (msg) => set((s) => ({ log: [...s.log.slice(-49), msg] }));
const Row = ({ label, children, hint }) => <div className="st-row"><label title={hint}>{label}</label><div className="st-ctl">{children}</div></div>;
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const Progress = ({ p }) => (p ? <div className="st-prog"><div style={{ width: `${Math.round((p.progress || 0) * 100)}%` }} /><span>{p.stage || ''} {Math.round((p.progress || 0) * 100)}%</span></div> : null);
const useScope = () => {
  const sel = useStore((s) => s.selection); const seq = useStore((s) => s.sequence);
  const selAudio = audioClipsOf(seq, sel).map((c) => c.id);
  const [scope, setScope] = useState('auto');
  const ids = scope === 'all' || (scope === 'auto' && !selAudio.length) ? null : selAudio;
  const ui = <Row label="Audio source"><select value={scope} onChange={(e) => setScope(e.target.value)}><option value="auto">{selAudio.length ? `Selected clips (${selAudio.length})` : 'Whole sequence'}</option><option value="all">Whole sequence</option></select></Row>;
  return { ids, ui, count: selAudio.length };
};

// ---------------------------------------------------------------- Auto-Cut Silence
function SilenceTab() {
  const [o, setO] = useState({ thresholdDb: -40, minSilence: 0.6, padding: 0.12 }); const { ids, ui } = useScope();
  const [res, setRes] = useState(null); const [busy, setBusy] = useState(false);
  const analyze = async () => { setBusy(true); try { const r = await detectSilence({ ...o, ids }); setRes(r); notify(`Found ${r.ranges.length} silent ranges (${r.total.toFixed(1)} s)`); } catch (e) { notify('Silence analysis failed: ' + e.message); } setBusy(false); };
  const apply = () => { const t = cutRanges(res.ranges); notify(`Removed ${res.ranges.length} silences — ${t.toFixed(1)} s shorter`); setRes(null); };
  return (
    <div>
      <p className="st-help">Scans the audio waveform for silence and pauses, then ripple-deletes them on every track so picture and sound stay in sync.</p>
      {ui}
      <Row label="Threshold (dB)" hint="Anything quieter than this counts as silence"><input type="range" min="-70" max="-15" value={o.thresholdDb} onChange={(e) => { setO({ ...o, thresholdDb: +e.target.value }); setRes(null); }} /><b>{o.thresholdDb} dB</b></Row>
      <Row label="Minimum silence" hint="Shorter pauses are kept"><NumInput type="number" step="0.1" min="0.1" value={o.minSilence} onChange={(e) => { setO({ ...o, minSilence: +e.target.value }); setRes(null); }} /> s</Row>
      <Row label="Keep padding" hint="Silence kept before/after speech so cuts do not clip words"><NumInput type="number" step="0.02" min="0" value={o.padding} onChange={(e) => { setO({ ...o, padding: +e.target.value }); setRes(null); }} /> s</Row>
      <div className="st-actions"><button disabled={busy} onClick={analyze}>{busy ? 'Analyzing…' : 'Analyze'}</button>{res && <button className="primary" disabled={!res.ranges.length} onClick={apply}>Ripple Delete {res.ranges.length} ranges ({res.total.toFixed(1)} s)</button>}</div>
      {res && <LevelView res={res} thr={o.thresholdDb} />}
      {res && <ul className="list st-list">{res.ranges.slice(0, 200).map((r, i) => <li key={i} onClick={() => set({ playhead: r[0] })}>{fmt(r[0])} → {fmt(r[1])} <span className="dim">({(r[1] - r[0]).toFixed(2)} s)</span></li>)}</ul>}
    </div>
  );
}
function LevelView({ res, thr }) {
  const ref = React.useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c || !res.levels) return; const W = c.width = 600, H = c.height = 70; const g = c.getContext('2d'); const { db, per, start } = res.levels; const span = res.span[1] - res.span[0];
    g.fillStyle = '#16181c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c0392b55'; for (const [a, b] of res.ranges) g.fillRect(((a - start) / span) * W, 0, Math.max(1, ((b - a) / span) * W), H);
    g.fillStyle = '#4fd1a5'; for (let x = 0; x < W; x++) { const i = Math.floor((x / W) * db.length); const v = Math.max(0, (db[i] + 80) / 80); g.fillRect(x, H - v * H, 1, v * H); }
    const ty = H - Math.max(0, (thr + 80) / 80) * H; g.strokeStyle = '#ffd400'; g.beginPath(); g.moveTo(0, ty); g.lineTo(W, ty); g.stroke();
  }, [res, thr]);
  return <canvas ref={ref} className="st-levels" title="Level (green), threshold (yellow), ranges to cut (red)" />;
}

// ---------------------------------------------------------------- Auto-Subtitles
function SubtitlesTab() {
  const [o, setO] = useState({ model: MODELS[0].id, language: '', task: 'transcribe', maxChars: 42, maxDur: 5, lines: 1 });
  const [style, setStyle] = useState(defaultCaptionStyle()); const [p, setP] = useState(null); const { ids, ui } = useScope();
  const go = async () => {
    setP({ stage: 'Starting', progress: 0 });
    try { const r = await autoSubtitles({ ids, ...o, style }, setP); notify(`Subtitles: ${r.segments} captions, ${r.words} words${r.language ? ` (${r.language})` : ''}`); }
    catch (e) { notify('Auto-Subtitles failed: ' + e.message); }
    setP(null);
  };
  return (
    <div>
      <p className="st-help">Speech-to-text runs on this computer (Whisper, offline). Captions go to a caption track with word timings for animated styles.</p>
      {ui}
      <Row label="Language"><select value={o.language} onChange={(e) => setO({ ...o, language: e.target.value })}>{LANGUAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Row>
      <Row label="Output"><select value={o.task} onChange={(e) => setO({ ...o, task: e.target.value })}><option value="transcribe">Same language as spoken</option><option value="translate">Translate to English</option></select></Row>
      <Row label="Model"><select value={o.model} onChange={(e) => setO({ ...o, model: e.target.value })}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select> <ModelPack id={modelInfo(o.model).pack} /></Row>
      <Row label="Line length"><NumInput type="number" min="10" max="90" value={o.maxChars} onChange={(e) => setO({ ...o, maxChars: +e.target.value })} /> chars × <select value={o.lines} onChange={(e) => setO({ ...o, lines: +e.target.value })}><option value={1}>1 line</option><option value={2}>2 lines</option><option value={3}>3 lines</option></select>, max <NumInput type="number" min="1" max="10" step="0.5" value={o.maxDur} onChange={(e) => setO({ ...o, maxDur: +e.target.value })} /> s</Row>
      <StyleEditor style={style} onChange={setStyle} />
      <div className="st-actions"><button className="primary" disabled={!!p} onClick={go}>Generate Subtitles</button></div>
      <Progress p={p} />
      <CaptionTools />
    </div>
  );
}
// caption words for timing: Intl.Segmenter words, spaces / punctuation attached to the word before them
const splitWords = (txt) => segWords(txt).reduce((a, w) => { if (a.length && !/[\p{L}\p{N}]/u.test(w)) a[a.length - 1] += w; else a.push(w); return a; }, []);
export function StyleEditor({ style, onChange }) {
  const up = (k) => (e) => onChange({ ...style, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' || e.target.type === 'range' ? +e.target.value : e.target.value });
  return (
    <div className="st-style">
      <Row label="Style preset"><select value="" onChange={(e) => e.target.value && onChange({ ...style, ...CAPTION_PRESETS[e.target.value] })}><option value="">Apply a preset…</option>{Object.keys(CAPTION_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></Row>
      <Row label="Animation"><select value={style.preset} onChange={up('preset')}>{CAPTION_STYLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Row>
      <Row label="Size / weight"><NumInput type="number" step="0.2" min="1" max="20" value={style.sizePct} onChange={up('sizePct')} />% <select value={style.weight} onChange={up('weight')}>{[400, 600, 700, 800, 900].map((w) => <option key={w}>{w}</option>)}</select></Row>
      <Row label="Colors"><input type="color" value={style.color} onChange={up('color')} title="Text" /><input type="color" value={style.highlight} onChange={up('highlight')} title="Highlight" /><input type="color" value={style.stroke} onChange={up('stroke')} title="Outline" /><NumInput type="number" step="0.1" min="0" max="3" value={style.strokePct} onChange={up('strokePct')} title="Outline width" /></Row>
      <Row label="Position"><select value={style.position} onChange={up('position')}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select> margin <NumInput type="number" min="0" max="45" value={style.marginPct} onChange={up('marginPct')} />%</Row>
      <Row label="Options"><label><input type="checkbox" checked={style.box} onChange={up('box')} /> box</label> <label><input type="checkbox" checked={style.uppercase} onChange={up('uppercase')} /> UPPERCASE</label> <label><input type="checkbox" checked={style.shadow} onChange={up('shadow')} /> shadow</label></Row>
      <Row label="Keywords"><label><input type="checkbox" checked={!!style.emphasis} onChange={up('emphasis')} /> emphasize keyword</label> <input type="color" value={style.emphColor || '#ffd400'} onChange={up('emphColor')} title="Keyword colour" /> <label><input type="checkbox" checked={!!style.emoji} onChange={up('emoji')} /> auto emoji</label></Row>
      <Row label="Chars per line"><NumInput type="number" min="0" max="90" value={style.charsPerLine || 0} onChange={up('charsPerLine')} title="0 = by width; Thai lines always break between words" /> (0 = by width)</Row>
    </div>
  );
}
function CaptionTools() {
  const seq = useStore((s) => s.sequence); const sel = useStore((s) => s.selection);
  const tracks = seq.tracks.filter((t) => t.kind === 'caption' && seq.clips.some((c) => c.track === t.id && c.caption));
  const selCap = seq.clips.filter((c) => sel.includes(c.id) && c.caption);
  if (!tracks.length) return null;
  const restyle = (st) => edit('Caption Style', ({ seq: q }) => { const tset = new Set(selCap.length ? selCap.map((c) => c.track) : tracks.map((t) => t.id)); for (const c of q.clips) if (c.caption && tset.has(c.track)) c.caption.style = { ...st }; }, { coalesce: 'capstyle' });
  const style = { ...defaultCaptionStyle(), ...((selCap[0] || seq.clips.find((c) => c.caption))?.caption.style || {}) };
  const exportCaps = async (tid, ext) => { const p = await window.editorstage.saveDialog('export', `${seq.name}.${ext}`, ext); if (!p) return; const f = { srt: captionsToSrt, vtt: captionsToVtt, ass: captionsToAss }[ext]; await window.editorstage.writeFile(p, '﻿' + f(seq, tid)); notify('Saved ' + p); };
  return (
    <div className="st-sub">
      <h5>Caption tracks</h5>
      {tracks.map((t) => <div key={t.id} className="st-row"><label>{t.name || t.id}</label><div className="st-ctl">{seq.clips.filter((c) => c.track === t.id).length} captions <button onClick={() => exportCaps(t.id, 'srt')}>SRT…</button><button onClick={() => exportCaps(t.id, 'vtt')}>VTT…</button><button onClick={() => exportCaps(t.id, 'ass')}>ASS…</button></div></div>)}
      {selCap.length === 1 && <Row label="Text"><textarea rows="2" value={selCap[0].caption.text} onChange={(e) => edit('Edit Caption', ({ seq: q }) => { const c = q.clips.find((x) => x.id === selCap[0].id); const txt = e.target.value; c.caption.text = txt; c.name = txt; const parts = splitWords(txt); const per = c.dur / Math.max(1, parts.length); c.caption.words = markKeywords(parts.map((w, i) => ({ text: w, t0: i * per, t1: (i + 1) * per }))); }, { coalesce: 'captext' + selCap[0].id })} /></Row>}
      <div className="dim">Style for {selCap.length ? 'the selected caption tracks' : 'all caption tracks'}:</div>
      <StyleEditor style={style} onChange={restyle} />
    </div>
  );
}

// ---------------------------------------------------------------- Speaker diarization
function SpeakersTab() {
  const [n, setN] = useState(0); const [keep, setKeep] = useState(false); const [res, setRes] = useState(null); const [busy, setBusy] = useState(false); const { ids, ui, count } = useScope();
  const analyze = async () => { setBusy(true); try { const r = await diarize({ ids, speakers: n }); setRes(r); notify(`Detected ${r.speakers} speaker(s) in ${r.segments.length} turns`); } catch (e) { notify('Speaker analysis failed: ' + e.message); } setBusy(false); };
  const colors = ['#4fd1a5', '#ffb74d', '#64b5f6', '#e57373', '#ba68c8', '#fff176'];
  return (
    <div>
      <p className="st-help">Detects who speaks when (voice prints from MFCC + pitch, clustered on this computer) and puts each speaker on its own audio track for mixing.</p>
      {ui}{!count && <div className="dim">Tip: select the dialogue clip(s) first.</div>}
      <Row label="Speakers"><select value={n} onChange={(e) => { setN(+e.target.value); setRes(null); }}><option value={0}>Auto-detect</option>{[2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>{k}</option>)}</select></Row>
      <Row label="Original clip"><label><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> keep (disabled)</label></Row>
      <div className="st-actions"><button disabled={busy} onClick={analyze}>{busy ? 'Analyzing…' : 'Analyze'}</button>{res && res.segments.length > 0 && <button className="primary" onClick={() => { splitBySpeaker(res, { ids, keepOriginal: keep }); notify(`Split into ${res.speakers} speaker tracks`); setRes(null); }}>Split to {res.speakers} tracks</button>}</div>
      {res && <div className="st-turns">{res.segments.map((s, i) => <div key={i} title={`Speaker ${s.speaker + 1}: ${fmt(s.t0)}–${fmt(s.t1)}`} onClick={() => set({ playhead: s.t0 })} style={{ left: `${((s.t0 - res.span[0]) / (res.span[1] - res.span[0])) * 100}%`, width: `${((s.t1 - s.t0) / (res.span[1] - res.span[0])) * 100}%`, top: s.speaker * 12, background: colors[s.speaker % 6] }} />)}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Reframe
function ReframeTab() {
  const seq = useStore((s) => s.sequence); const [aspect, setAspect] = useState('9:16'); const [smooth, setSmooth] = useState(1.2); const [p, setP] = useState(null); const [report, setReport] = useState(null);
  const go = async () => { setP({ progress: 0, stage: 'Tracking subjects' }); try { const r = await reframeSequence({ aspect, smooth }, (q) => setP({ progress: q.progress, stage: `Tracking ${q.clip}` })); setReport(r.report); notify(`Created ${r.sequence.name} (${r.sequence.width}×${r.sequence.height})`); } catch (e) { notify('Auto-Reframe failed: ' + e.message); } setP(null); };
  return (
    <div>
      <p className="st-help">Creates a copy of “{seq.name}” ({seq.width}×{seq.height}) in another aspect ratio. People/faces (or the main object) are tracked and kept in frame with editable Motion keyframes (Effect Controls &gt; Motion &gt; Anchor Point).</p>
      <Row label="Target"><select value={aspect} onChange={(e) => setAspect(e.target.value)}>{ASPECTS.map(([k]) => <option key={k}>{k}</option>)}</select></Row>
      <Row label="Camera motion" hint="Seconds of smoothing — higher = calmer framing"><select value={smooth} onChange={(e) => setSmooth(+e.target.value)}><option value={2.5}>Slow</option><option value={1.2}>Default</option><option value={0.5}>Fast</option></select></Row>
      <div className="st-actions"><button className="primary" disabled={!!p} onClick={go}>Create Reframed Sequence</button></div>
      <Progress p={p} />
      {report && <ul className="list st-list">{report.map((r, i) => <li key={i}>{r}</li>)}</ul>}
    </div>
  );
}

// ---------------------------------------------------------------- AudioStage + settings
function SettingsTab() {
  const [loc, setLoc] = useState(undefined); const remote = useStore((s) => s.remoteMode);
  const [auto, setAuto] = useState(() => getPrefs().autoSaveMin); // the same setting as Preferences > Auto Save
  useEffect(() => { window.editorstage.audiostage.locate().then(setLoc); }, []);
  const pick = async () => { const [p] = await window.editorstage.openDialog('app'); if (p) setLoc(await window.editorstage.audiostage.setPath(p)); };
  const pickDir = async () => { const d = await window.editorstage.pickFolder(); if (d) setLoc(await window.editorstage.audiostage.setPath(d)); };
  return (
    <div>
      <h5>Edit in AudioStage</h5>
      <Row label="AudioStage">{loc === undefined ? '…' : loc ? <span title={loc.path}>{loc.kind === 'dev' ? 'Development folder: ' : ''}{loc.path}</span> : <span className="err">not found</span>}</Row>
      <div className="st-actions"><button onClick={pick}>Choose AudioStage.exe…</button><button onClick={pickDir}>Choose AudioStage folder…</button></div>
      <p className="st-help">Right-click an audio clip &gt; Edit in AudioStage (or Edit menu). The clip is rendered to WAV 48 kHz / 24-bit in “AudioStage Edits” next to the project; press Ctrl+S in AudioStage and the clip updates here.</p>
      <h5>Project</h5>
      <Row label="Auto-save revision every"><NumInput type="number" min="0" max="120" value={auto} onChange={(e) => { const v = Math.max(0, +e.target.value); setAuto(v); setPrefs({ autoSaveMin: v }); }} /> min (0 = off)</Row>
      <h5>Remote desktop</h5>
      <Row label="Remote-Optimized Preview"><label><input type="checkbox" checked={!!remote} onChange={() => import('../Core/commands').then((m) => m.run('view.remoteMode'))} /> {remote ? 'on — preview 480–640 px, 8–15 fps, no UI animation' : 'off'}</label></Row>
    </div>
  );
}

const TABS = [['silence', 'Auto-Cut'], ['subtitles', 'Subtitles'], ['speakers', 'Speakers'], ['reframe', 'Reframe'], ['settings', 'AudioStage & Settings']];
export default function SmartTools() {
  const tab = useStore((s) => s.smartTab) || 'silence';
  const C = { silence: SilenceTab, subtitles: SubtitlesTab, speakers: SpeakersTab, reframe: ReframeTab, settings: SettingsTab }[tab] || SilenceTab;
  return (
    <div className="smarttools">
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => set({ smartTab: k })}>{l}</button>)}</div>
      <div className="panel-pad"><C /></div>
    </div>
  );
}
export const _test = { getState };
