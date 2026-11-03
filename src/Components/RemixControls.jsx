import React, { useState } from 'react';
import { useStore, set } from '../Core/store';
import { remixClip, unremixClip, cancelRemix, remixProblem, remixRange } from '../Services/remixClip';
import { REMIX_DEFAULTS } from '../Services/remix';
import { TCInput } from './Dialogs';

/**
 * Remix settings of one clip (Essential Sound > Music > Duration and the Remix dialog): target duration, Segments,
 * Variations, crossfade; Remix runs the analysis once per file (progress, Cancel) and applies the plan as one undo step.
 */
export default function RemixControls({ clipId, onDone }) {
  const seq = useStore((s) => s.sequence); const c = seq.clips.find((x) => x.id === clipId);
  const fps = seq.fps || 30;
  const p0 = { ...REMIX_DEFAULTS, ...(c?.remix?.params || {}) };
  const [target, setTarget] = useState(c?.remix?.targetDur ?? c?.dur ?? 30);
  const [segments, setSegments] = useState(p0.segments); const [variations, setVariations] = useState(p0.variations); const [xfade, setXfade] = useState(p0.xfade);
  const [busy, setBusy] = useState(null); const [msg, setMsg] = useState('');
  if (!c) return <div className="dim">Select a music clip on an audio track.</div>;
  const why = remixProblem(seq, c); const [r0, r1] = remixRange(c);
  const go = async () => {
    setMsg(''); setBusy({ p: 0, label: 'Starting' });
    try {
      const r = await remixClip(c.id, target, { segments, variations, xfade }, (p, label) => setBusy({ p, label }));
      setMsg(r.segments.length > 1 ? `Remixed to ${r.dur.toFixed(2)} s (${r.segments.length - 1} cut${r.segments.length > 2 ? 's' : ''}, ${Math.round(r.bpm)} BPM${r.cached ? ', analysis from cache' : ''})` : 'The original length fits the target: remix removed');
      onDone?.(r);
    } catch (e) { setMsg(String(e.message || e)); }
    finally { setBusy(null); }
  };
  const pct = (v) => `${Math.round(v * 100)}`;
  return (
    <div className="remix-controls">
      {why && <div className="err note">{why}</div>}
      <div className="mrow"><label>Method</label><select value="remix" disabled><option value="remix">Remix</option></select></div>
      <div className="mrow"><label>Target Duration</label><TCInput value={target} fps={fps} onChange={(v) => setTarget(Math.max(1, v))} /><span className="dim">original {(r1 - r0).toFixed(2)} s{c.remix ? ` · now ${c.dur.toFixed(2)} s` : ''}</span></div>
      <div className="mrow"><label title="Shorter segments = more, smaller edits; longer segments = fewer edits">Segments</label><span className="dim">Short</span><input type="range" min="0" max="1" step="0.05" value={segments} onChange={(e) => setSegments(+e.target.value)} /><span className="dim">Long</span><span className="val">{pct(segments)}</span></div>
      <div className="mrow"><label title="Low = repeat the same section, high = use different sections">Variations</label><span className="dim">Repeat</span><input type="range" min="0" max="1" step="0.05" value={variations} onChange={(e) => setVariations(+e.target.value)} /><span className="dim">Vary</span><span className="val">{pct(variations)}</span></div>
      <div className="mrow"><label title="Equal-power crossfade at every cut">Crossfade</label><input type="range" min="10" max="120" step="5" value={xfade} onChange={(e) => setXfade(+e.target.value)} /><span className="val">{xfade} ms</span></div>
      {busy && <div className="mrow"><label>{busy.label}…</label><progress max="1" value={busy.p} /><button onClick={cancelRemix}>Cancel</button></div>}
      <div className="mrow"><label />
        <button disabled={!!busy || !!why} onClick={go}>Remix</button>
        {c.remix && <button disabled={!!busy} onClick={() => { unremixClip(c.id); setMsg('Remix removed'); }}>Remove Remix</button>}
      </div>
      {msg && <div className="note dim">{msg}</div>}
      <div className="dim">The intro and the ending are kept; cuts are made on matching beats (no speed or pitch change). The analysis runs once per file.</div>
    </div>
  );
}

/** Clip > Remix... */
export function RemixDialogBody({ clipId }) { return <RemixControls clipId={clipId} onDone={() => {}} />; }
export const openRemix = (clipId) => set({ dialog: { type: 'remix', props: { clipId } } });
