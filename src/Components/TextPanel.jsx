// Text panel > Transcript (Premiere's Text-Based Editing): read the sequence as text, select words to delete or move them
// (the timeline ripples), remove filler words and silences, search, and turn the transcript into captions.
import React, { useMemo, useState, useEffect, useRef } from 'react';
import NumInput from './NumInput';
import { useStore, set } from '../Core/store';
import { shortcutKey } from '../Core/keys';
import { MODELS, modelInfo, LANGUAGES, segmentWords, placeCaptions } from '../Services/ai/stt';
import ModelPack from './ModelPack';
import { detectSilence, cutRanges } from '../Services/ai/silence';
import { sequenceWords, sequenceSources, transcribeSequence, cancelTranscribe, deleteWords, moveWords, findFillers, removeFillers, searchWords, fillerList, setFillerList, wordsRange } from '../Services/ai/transcript';

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export default function TextPanel() {
  const seq = useStore((s) => s.sequence); const media = useStore((s) => s.media);
  const playhead = useStore((s) => Math.floor(s.playhead * 8) / 8);
  const words = useMemo(() => sequenceWords(seq, media), [seq, media]);
  const sources = sequenceSources(seq); const missing = sources.filter((id) => !media.find((m) => m.id === id)?.transcript);
  const [model, setModel] = useState(MODELS[0].id); const [lang, setLang] = useState('');
  const [prog, setProg] = useState(null); const [err, setErr] = useState('');
  const [sel, setSel] = useState(null); // [anchor, focus] word indexes
  const [clip, setClip] = useState(null); // cut words waiting to be pasted: [i, j]
  const [q, setQ] = useState(''); const [hit, setHit] = useState(0);
  const [fillers, setFillers] = useState(fillerList().join(', ')); const [showFillers, setShowFillers] = useState(false);
  const [silence, setSilence] = useState({ db: -40, min: 0.8 });
  const box = useRef(null); const dragging = useRef(false);
  const hits = useMemo(() => searchWords(words, q), [words, q]);
  const hitSet = useMemo(() => { const s = new Set(); for (const [a, b] of hits) for (let i = a; i <= b; i++) s.add(i); return s; }, [hits]);
  const fillerSet = useMemo(() => { const s = new Set(); if (showFillers) for (const [a, b] of findFillers(words, fillers.split(',').map((x) => x.trim()).filter(Boolean))) for (let i = a; i <= b; i++) s.add(i); return s; }, [words, fillers, showFillers]);
  useEffect(() => { setSel(null); }, [seq]); // indexes change after any edit
  const lo = sel ? Math.min(sel[0], sel[1]) : -1, hi = sel ? Math.max(sel[0], sel[1]) : -1;

  const go = (force) => {
    setErr(''); setProg({ stage: 'Starting', progress: 0 });
    transcribeSequence({ model, language: lang, force }, setProg).then(() => setProg(null)).catch((e) => { setProg(null); setErr(String(e.message || e)); });
  };
  const del = () => { if (sel) { deleteWords(words, lo, hi); setSel(null); } };
  const cut = () => { if (sel) { setClip([lo, hi]); setSel(null); } };
  const paste = () => { if (clip && sel) { moveWords(words, clip[0], clip[1], lo); setClip(null); setSel(null); } };
  const onKey = (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); del(); }
    else if ((e.ctrlKey || e.metaKey) && shortcutKey(e) === 'x') { e.preventDefault(); e.stopPropagation(); cut(); }
    else if ((e.ctrlKey || e.metaKey) && shortcutKey(e) === 'v') { e.preventDefault(); e.stopPropagation(); paste(); }
  };
  const jump = (k) => { if (!hits.length) return; const n = (hit + k + hits.length) % hits.length; setHit(n); const [a, b] = hits[n]; setSel([a, b]); set({ playhead: words[a].t0 }); box.current?.querySelector(`[data-w="${a}"]`)?.scrollIntoView({ block: 'nearest' }); };
  const captions = () => { const segs = segmentWords(words.map((w) => ({ text: w.text, t0: w.t0, t1: w.t1 }))); placeCaptions(segs, {}); };
  const silences = async () => { setErr(''); try { const r = await detectSilence({ thresholdDb: silence.db, minSilence: silence.min }); if (!r.ranges.length) setErr('No silences found'); else cutRanges(r.ranges, 'Remove Silences'); } catch (e) { setErr(String(e.message || e)); } };

  // paragraphs: a new one after a pause of more than a second
  const paras = []; let cur = [];
  words.forEach((w, i) => { if (cur.length && w.t0 - words[i - 1].t1 > 1) { paras.push(cur); cur = []; } cur.push(w); }); if (cur.length) paras.push(cur);
  const now = words.findIndex((w) => playhead >= w.t0 && playhead < w.t1);

  return (
    <div className="panel-pad textpanel" tabIndex={0} onKeyDown={onKey}>
      <div className="param">
        <select value={model} onChange={(e) => setModel(e.target.value)} title="Speech model">{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        <ModelPack id={modelInfo(model).pack} />
        <select value={lang} onChange={(e) => setLang(e.target.value)} title="Language">{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button disabled={!!prog || !sources.length} onClick={() => go(false)} title="Transcribe the audio of the sequence (offline Whisper)">{missing.length || !words.length ? 'Transcribe' : 'Transcribed ✓'}</button>
        {!missing.length && sources.length > 0 && <button disabled={!!prog} onClick={() => go(true)} title="Transcribe again (e.g. with another model or language)">Re-transcribe</button>}
      </div>
      {prog && <div className="trackbar"><span>{prog.stage}</span><progress max="1" value={prog.progress || 0} /><button onClick={() => { cancelTranscribe(); setProg(null); }}>Cancel</button></div>}
      {lang === 'thai' || words.some((w) => /[฀-๿]/.test(w.text)) ? <div className="dim note">Whisper Base is not accurate for Thai; use Whisper Small if it is installed.</div> : null}
      <div className="param">
        <input placeholder="Search transcript" value={q} onChange={(e) => { setQ(e.target.value); setHit(0); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); jump(e.shiftKey ? -1 : 1); } }} />
        <span className="dim">{q ? `${hits.length ? hit + 1 : 0}/${hits.length}` : ''}</span>
        <button disabled={!hits.length} onClick={() => jump(-1)}>▲</button><button disabled={!hits.length} onClick={() => jump(1)}>▼</button>
      </div>
      <div className="param">
        <button disabled={!sel} onClick={del} title="Delete the selected text: ripple-delete its time on every track (Delete)">Delete</button>
        <button disabled={!sel} onClick={cut} title="Cut the selected text, then select a word and Paste to move it there (Ctrl+X)">Cut</button>
        <button disabled={!clip || !sel} onClick={paste} title="Move the cut text before the selected word (Ctrl+V)">Paste</button>
        <button disabled={!words.length} onClick={captions} title="Create captions from the transcript">Create Captions</button>
      </div>
      <div className="param">
        <button disabled={!words.length} onClick={() => setShowFillers(!showFillers)} className={showFillers ? 'active' : ''} title="Highlight filler words">Fillers</button>
        {showFillers && <>
          <input style={{ flex: 1 }} value={fillers} onChange={(e) => { setFillers(e.target.value); setFillerList(e.target.value.split(',').map((x) => x.trim()).filter(Boolean)); }} title="Filler words (comma separated)" />
          <button disabled={!fillerSet.size} onClick={() => removeFillers(words, fillers.split(',').map((x) => x.trim()).filter(Boolean))}>Remove {fillerSet.size ? `(${findFillers(words, fillers.split(',').map((x) => x.trim()).filter(Boolean)).length})` : ''}</button>
        </>}
      </div>
      <div className="param">
        <label>Silence below</label><NumInput className="num" type="number" value={silence.db} onChange={(e) => setSilence({ ...silence, db: +e.target.value })} /><span className="dim">dB, longer than</span>
        <NumInput className="num" type="number" step="0.1" value={silence.min} onChange={(e) => setSilence({ ...silence, min: +e.target.value })} /><span className="dim">s</span>
        <button disabled={!sources.length} onClick={silences}>Remove Silences</button>
      </div>
      {err && <div className="err note">{err}</div>}
      {clip && <div className="dim note">Cut: “{words.slice(clip[0], clip[1] + 1).map((w) => w.text).join('').trim().slice(0, 60)}” — select a word and Paste</div>}
      <div className="transcript" ref={box} onMouseUp={() => { dragging.current = false; }}>
        {!words.length && <div className="dim">{sources.length ? 'Transcribe the sequence to edit it as text.' : 'Add clips with audio to the timeline.'}</div>}
        {paras.map((p) => (
          <p key={p[0].i}><span className="ts" onClick={() => set({ playhead: p[0].t0 })}>{fmt(p[0].t0)}</span>
            {p.map((w) => (
              <span key={w.i} data-w={w.i} className={`w${w.i >= lo && w.i <= hi ? ' sel' : ''}${w.i === now ? ' now' : ''}${hitSet.has(w.i) ? ' hit' : ''}${fillerSet.has(w.i) ? ' filler' : ''}${clip && w.i >= clip[0] && w.i <= clip[1] ? ' cut' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); box.current?.parentElement?.focus(); dragging.current = true; setSel(e.shiftKey && sel ? [sel[0], w.i] : [w.i, w.i]); set({ playhead: w.t0 }); }}
                onMouseEnter={() => { if (dragging.current && sel) setSel([sel[0], w.i]); }}
                title={`${w.t0.toFixed(2)}–${w.t1.toFixed(2)} s`}>{w.text}</span>
            ))}
          </p>
        ))}
      </div>
      {sel && <div className="dim">{hi - lo + 1} word(s) · {(() => { const [a, b] = wordsRange(words, lo, hi); return `${(b - a).toFixed(2)} s`; })()}</div>}
    </div>
  );
}
