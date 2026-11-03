// Create panel: Shorts (Long-to-Shorts) and B-Roll (Smart B-Roll) tabs.
import React, { useMemo, useState } from 'react';
import { useStore, set, switchSequence } from '../Core/store';
import { analyzeMoments, rankMoments, createShorts, cancelShorts, momentTitle, FEATURES, DEFAULT_WEIGHTS } from '../Services/ai/shorts';
import { indexMedia, cancelIndex, suggestBRoll, placeBRoll } from '../Services/ai/broll';
import { transcribeSequence, cancelTranscribe, sequenceSources } from '../Services/ai/transcript';
import { CAPTION_PRESETS } from '../Services/ai/captions';
import { ASPECTS } from '../Services/ai/reframe';

const notify = (msg) => set((s) => ({ log: [...s.log.slice(-49), msg] }));
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const Progress = ({ p, onCancel }) => (p ? <div className="st-actions"><div className="st-prog" style={{ flex: 1 }}><div style={{ width: `${Math.round((p.progress || 0) * 100)}%` }} /><span>{p.stage || ''} {Math.round((p.progress || 0) * 100)}%</span></div>{onCancel && <button onClick={onCancel}>Cancel</button>}</div> : null);
const Row = ({ label, children, hint }) => <div className="st-row"><label title={hint}>{label}</label><div className="st-ctl">{children}</div></div>;

/** Transcript state of the active sequence, with a Transcribe button (Whisper, offline). */
function TranscriptRow({ busy, setBusy }) {
  const seq = useStore((s) => s.sequence); const media = useStore((s) => s.media);
  const src = sequenceSources(seq); const missing = src.filter((id) => !media.find((m) => m.id === id)?.transcript);
  const [p, setP] = useState(null);
  if (!src.length) return <div className="dim">No audio clips on the timeline.</div>;
  const go = async () => { setBusy(true); setP({ stage: 'Starting', progress: 0 }); try { const n = await transcribeSequence({}, setP); notify(`Transcribed ${n} file${n === 1 ? '' : 's'}`); } catch (e) { notify(`Transcribe failed: ${e.message}`); } setP(null); setBusy(false); };
  return <>
    <Row label="Transcript">{missing.length ? <><span className="dim">{missing.length} of {src.length} file{src.length > 1 ? 's' : ''} not transcribed</span> <button disabled={busy} onClick={go}>Transcribe Speech</button></> : <span className="dim">Ready ({src.length} file{src.length > 1 ? 's' : ''})</span>}</Row>
    <Progress p={p} onCancel={cancelTranscribe} />
  </>;
}

// ---------------------------------------------------------------- Long-to-Shorts
export function ShortsTab() {
  const seq = useStore((s) => s.sequence);
  const [o, setO] = useState({ minLen: 15, maxLen: 60, count: 5, scenes: true, aspect: '9:16', reframe: true, captions: true, captionPreset: 'Bold Yellow Highlight', cutSilence: true });
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS); const [res, setRes] = useState(null); const [edits, setEdits] = useState({});
  const [p, setP] = useState(null); const [busy, setBusy] = useState(false); const [made, setMade] = useState([]);
  const picks = useMemo(() => (res ? rankMoments(res.candidates, weights, { count: o.count }) : []), [res, weights, o.count]);
  const key = (m) => `${m.t0}-${m.t1}`;
  const rows = picks.map((m) => ({ ...m, ...(edits[key(m)] || {}), key: key(m) }));
  const on = rows.filter((m) => m.on !== false);
  const find = async () => {
    setBusy(true); setP({ stage: 'Starting', progress: 0 }); setEdits({});
    try { const r = await analyzeMoments(o, setP); setRes(r); notify(`Long-to-Shorts: ${r.candidates.length} possible moments in ${fmt(r.duration)}${r.hasTranscript ? '' : ' (no transcript: scored from audio and picture only)'}`); } catch (e) { notify(`Long-to-Shorts failed: ${e.message}`); }
    setP(null); setBusy(false);
  };
  const create = async () => {
    setBusy(true); setP({ stage: 'Starting', progress: 0 });
    try { const r = await createShorts(on, o, setP); setMade(r); notify(`Created ${r.length} short${r.length > 1 ? 's' : ''}`); } catch (e) { notify(`Create Shorts failed: ${e.message}`); }
    setP(null); setBusy(false);
  };
  const patch = (m, v) => setEdits({ ...edits, [m.key]: { ...(edits[m.key] || {}), ...v } });
  return <div className="shorts">
    <p className="dim">Finds the best moments of this sequence ({fmt(Math.max(0, ...seq.clips.map((c) => c.start + c.dur), 0))}) and makes a vertical sequence of each one with Auto-Reframe, captions and the silences cut.</p>
    <TranscriptRow busy={busy} setBusy={setBusy} />
    <Row label="Length"><input type="number" min="5" max="180" value={o.minLen} onChange={(e) => setO({ ...o, minLen: +e.target.value })} /> – <input type="number" min="5" max="180" value={o.maxLen} onChange={(e) => setO({ ...o, maxLen: +e.target.value })} /> s</Row>
    <Row label="Shorts"><input type="number" min="1" max="20" value={o.count} onChange={(e) => setO({ ...o, count: Math.max(1, +e.target.value) })} /></Row>
    <Row label="Scene changes" hint="Detect cuts inside the video with FFmpeg (slower on long files)"><input type="checkbox" checked={o.scenes} onChange={(e) => setO({ ...o, scenes: e.target.checked })} /></Row>
    <div className="st-actions"><button className="primary" disabled={busy} onClick={find}>Find Moments</button></div>
    <Progress p={p} onCancel={cancelShorts} />
    {res && <>
      <h5>Score weights</h5>
      {FEATURES.map(([f, l]) => <div className="param" key={f}><label>{l}</label><input type="range" min="0" max="2" step="0.1" value={weights[f]} onChange={(e) => setWeights({ ...weights, [f]: +e.target.value })} /><span className="val">{weights[f].toFixed(1)}</span></div>)}
      {!rows.length && <div className="dim">No moment between {o.minLen} and {o.maxLen} s. Change the length and Find Moments again.</div>}
      <ul className="list shorts-list">{rows.map((m, i) => <li key={m.key} className="short-row">
        <input type="checkbox" checked={m.on !== false} onChange={(e) => patch(m, { on: e.target.checked })} />
        <div className="short-main">
          <div><b>{i + 1}. {momentTitle(m)}</b></div>
          <div className="short-meta"><span className="short-score" title="Score"><i style={{ width: `${m.score}%` }} />{m.score}</span>
            <input type="number" step="0.1" value={m.t0} onChange={(e) => patch(m, { t0: Math.max(0, +e.target.value) })} /> → <input type="number" step="0.1" value={m.t1} onChange={(e) => patch(m, { t1: Math.max(m.t0 + 1, +e.target.value) })} />
            <span className="dim">{(m.t1 - m.t0).toFixed(1)} s</span>
            <button title="Go to the start" onClick={() => set({ playhead: m.t0 })}>▶</button></div>
          <div className="dim short-why">{FEATURES.map(([f, l]) => `${l} ${Math.round((m.norm?.[f] || 0) * 100)}`).join(' · ')}</div>
        </div></li>)}</ul>
      <h5>Each short</h5>
      <Row label="Frame"><select value={o.aspect} onChange={(e) => setO({ ...o, aspect: e.target.value })}>{ASPECTS.map(([k]) => <option key={k} value={k}>{k}</option>)}<option value="source">Same as this sequence</option></select></Row>
      <Row label="Auto-Reframe" hint="Keep the speaker in frame with Motion keyframes"><input type="checkbox" checked={o.reframe} onChange={(e) => setO({ ...o, reframe: e.target.checked })} /></Row>
      <Row label="Captions" hint="From the transcript; captions already on the timeline are kept instead"><input type="checkbox" checked={o.captions} onChange={(e) => setO({ ...o, captions: e.target.checked })} /> <select disabled={!o.captions} value={o.captionPreset} onChange={(e) => setO({ ...o, captionPreset: e.target.value })}>{Object.keys(CAPTION_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></Row>
      <Row label="Cut silences"><input type="checkbox" checked={o.cutSilence} onChange={(e) => setO({ ...o, cutSilence: e.target.checked })} /></Row>
      <div className="st-actions"><button className="primary" disabled={busy || !on.length} onClick={create}>Create {on.length} Short{on.length === 1 ? '' : 's'}</button></div>
    </>}
    {made.length > 0 && <><h5>Created</h5><ul className="list">{made.map((m) => <li key={m.id}>{m.name} <span className="dim">({m.dur.toFixed(1)} s)</span> <button onClick={() => switchSequence(m.id)}>Open</button></li>)}</ul></>}
  </div>;
}

// ---------------------------------------------------------------- Smart B-Roll
export function BRollTab() {
  const media = useStore((s) => s.media); const seq = useStore((s) => s.sequence);
  const usable = media.filter((m) => (m.kind === 'video' || m.kind === 'image') && m.status === 'ready' && !m.synthetic);
  const done = usable.filter((m) => m.brollIndex).length;
  const [p, setP] = useState(null); const [busy, setBusy] = useState(false); const [vision, setVision] = useState(true); const [sug, setSug] = useState(null);
  const index = async (force) => { setBusy(true); setP({ stage: 'Starting', progress: 0 }); try { const n = await indexMedia({ force, vision }, setP); notify(`Indexed ${n} file${n === 1 ? '' : 's'} for B-Roll`); } catch (e) { notify(`Index failed: ${e.message}`); } setP(null); setBusy(false); };
  const suggest = () => { try { const r = suggestBRoll(); setSug(r); if (!r.length) notify('Smart B-Roll: no matching media for this transcript'); } catch (e) { notify(`Smart B-Roll: ${e.message}`); } };
  React.useEffect(() => { if (sug) suggest(); }, [seq.clips.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="broll">
    <p className="dim">Matches what is said in each sentence with the project's clips and stills (file names, their speech, and objects seen in the picture), then puts the shot on the track above.</p>
    <TranscriptRow busy={busy} setBusy={setBusy} />
    <Row label="Media index"><span className="dim">{done} of {usable.length} indexed</span></Row>
    <Row label="Look at the picture" hint="Run the object detector on 3 frames of each file (on this computer)"><input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} /></Row>
    <div className="st-actions"><button disabled={busy || done === usable.length} onClick={() => index(false)}>Index Media</button><button disabled={busy || !usable.length} onClick={() => index(true)}>Re-index All</button><button className="primary" disabled={busy || !done} onClick={suggest}>Suggest B-Roll</button></div>
    <Progress p={p} onCancel={cancelIndex} />
    {sug && <ul className="list broll-list">{sug.map((g) => <li key={`${g.t0}`}>
      <div><a onClick={() => set({ playhead: g.t0 })}>{fmt(g.t0)}</a> <span>{g.text}</span></div>
      <div className="broll-cands">{g.candidates.map((c) => <button key={c.mediaId} data-media={c.mediaId} title={`Matches: ${c.why.join(', ')} (score ${c.score})`} onClick={() => { placeBRoll(g, c.mediaId); notify(`B-Roll: ${c.name} at ${fmt(g.t0)}`); }}>+ {c.name} <span className="dim">{c.why.join(', ')}</span></button>)}</div>
    </li>)}</ul>}
  </div>;
}
