import React, { useEffect, useRef, useState } from 'react';
import NumInput from './NumInput';
import { useStore, set, edit, getState } from '../Core/store';
import { run } from '../Core/commands';
import FontPicker from './FontPicker';
import { listInstalled, removeMogrt, openMogrt } from '../Services/mogrt/library';
import { prepareMogrt, getPrepared, templateWarnings } from '../Services/mogrt/render';
import { evalParam, writeParam, toggleAnimation, hasKeyAt, toggleKeyAt, neighborKey } from '../Core/params';

const Empty = ({ children }) => <div className="panel-pad dim">{children}</div>;

export async function refreshMogrtLibrary() {
  const list = await listInstalled();
  set({ mogrtLib: list.map((e) => ({ libId: e.libId, error: e.error, name: e.pkg?.meta.name, meta: e.pkg?.meta, thumbUrl: e.thumbUrl, videoUrl: e.videoUrl })) });
}

/** Add an installed template to the timeline at the playhead on the top free video track. */
export async function addMogrtToTimeline(libId, at = getState().playhead, trackId = null) {
  const e = await openMogrt(libId); const meta = e.pkg.meta;
  edit(`Add ${meta.name}`, ({ seq, sel }) => {
    const vts = seq.tracks.filter((t) => t.kind === 'video' && !t.locked);
    const track = (trackId && vts.find((t) => t.id === trackId)?.id) || (vts[0] || {}).id; if (!track) return;
    const id = Math.random().toString(36).slice(2, 8);
    seq.clips.push({ id, track, start: at, dur: Math.max(0.5, meta.workOut || meta.duration), name: meta.name, mogrt: { libId, values: {} }, inPoint: 0, speed: 1, color: '#8e44ad', effects: [], enabled: true });
    sel.splice(0, sel.length, id);
  });
  prepareMogrt(libId).catch((err) => set((s) => ({ log: [...s.log.slice(-49), 'MOGRT: ' + (err.message || err)] })));
}

// ---------------- Browse tab ----------------
function Card({ it }) {
  const [hover, setHover] = useState(false);
  const vref = useRef(null);
  useEffect(() => { if (vref.current) { if (hover) vref.current.play().catch(() => {}); else { vref.current.pause(); vref.current.currentTime = 0; } } }, [hover]);
  if (it.error) return <div className="mg-card err" title={it.error}>⚠ {it.libId}<div className="dim">{it.error}</div></div>;
  return (
    <div className="mg-card" draggable onDragStart={(e) => e.dataTransfer.setData('mogrt-id', it.libId)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onDoubleClick={() => addMogrtToTimeline(it.libId)} onContextMenu={(e) => { e.preventDefault(); if (window.confirm?.(`Remove "${it.name}" from the library?`) ?? true) removeMogrt(it.libId).then(refreshMogrtLibrary); }} title={`${it.name}\n${it.meta.width}×${it.meta.height} · ${it.meta.duration.toFixed(1)}s\nDouble-click or drag to the timeline`}>
      <div className="mg-thumb">
        {it.thumbUrl && <img src={it.thumbUrl} alt="" />}
        {hover && it.videoUrl && <video ref={vref} src={it.videoUrl} muted loop autoPlay />}
      </div>
      <div className="mg-name ell">{it.name}</div>
    </div>
  );
}

function Browse() {
  const lib = useStore((s) => s.mogrtLib) || [];
  const [q, setQ] = useState('');
  useEffect(() => { refreshMogrtLibrary(); }, []);
  return (
    <div className="panel-pad">
      <div className="param"><button onClick={() => run('gfx.installMogrt')}>Install Motion Graphics Template…</button><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="mg-grid">{lib.filter((x) => (x.name || x.libId).toLowerCase().includes(q.toLowerCase())).map((it) => <Card key={it.libId} it={it} />)}</div>
      {!lib.length && <Empty>No templates installed. Use Graphics and Titles &gt; Install Motion Graphics Template…</Empty>}
    </div>
  );
}

// ---------------- Edit tab: Essential Graphics controls of the selected MOGRT clip ----------------
const toHex = (c) => `#${[0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(1, c[i])) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h, a = 1) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a]; };

function Control({ c, clip, entry, depth = 0 }) {
  const local = Math.max(0, getState().playhead - clip.start);
  const stored = clip.mogrt.values?.[c.id];
  const cur = stored === undefined ? c.default : evalParam(stored, local);
  const animated = !!stored?.keys;
  const write = (v, label) => edit(`MOGRT: ${c.name || label || c.type}`, ({ seq }) => {
    const k = seq.clips.find((x) => x.id === clip.id); k.mogrt.values = k.mogrt.values || {};
    const base = k.mogrt.values[c.id] || { v: c.default, keys: null };
    k.mogrt.values[c.id] = c.canAnimate && ['slider', 'point', 'color'].includes(c.type) ? writeParam(base, v, local) : { v, keys: null };
  }, { coalesce: `mg:${clip.id}:${c.id}` });
  const reset = () => edit('Reset MOGRT control', ({ seq }) => { const k = seq.clips.find((x) => x.id === clip.id); delete k.mogrt.values[c.id]; });
  const toggleAnim = () => edit('MOGRT animation', ({ seq }) => { const k = seq.clips.find((x) => x.id === clip.id); const base = k.mogrt.values[c.id] || { v: cur, keys: null }; k.mogrt.values[c.id] = toggleAnimation(base, local); });
  const canKey = c.canAnimate && ['slider', 'point', 'color'].includes(c.type);
  const pad = { paddingLeft: depth * 12 };

  if (c.type === 'group') {
    return (
      <details open={c.expanded} className="mg-group" style={pad}>
        <summary>{c.name || 'Group'}</summary>
        {(c.items || []).map((ch) => <Control key={ch.id} c={ch} clip={clip} entry={entry} depth={depth + 1} />)}
      </details>
    );
  }
  if (c.type === 'comment') return <div className="mg-comment" style={pad}>{c.name && <b>{c.name}: </b>}{c.default}</div>;
  const head = (
    <>
      {canKey ? <button title="Toggle Animation (stopwatch)" className={animated ? 'on' : ''} onClick={toggleAnim}>⏱</button> : <span style={{ width: 24 }} />}
      <label title={c.tooltip || c.name}>{c.name || c.type}</label>
    </>
  );
  const tail = (
    <>
      {animated && <span className="kfnav">
        <button disabled={!neighborKey(stored, local, -1)} onClick={() => set({ playhead: clip.start + neighborKey(stored, local, -1).t })}>◂</button>
        <button className={hasKeyAt(stored, local) ? 'on' : ''} onClick={() => edit('MOGRT keyframe', ({ seq }) => { const k = seq.clips.find((x) => x.id === clip.id); k.mogrt.values[c.id] = toggleKeyAt(k.mogrt.values[c.id], local); })}>◆</button>
        <button disabled={!neighborKey(stored, local, 1)} onClick={() => set({ playhead: clip.start + neighborKey(stored, local, 1).t })}>▸</button>
      </span>}
      {stored !== undefined && <button title="Reset parameter" onClick={reset}>↺</button>}
    </>
  );

  if (c.type === 'checkbox') return <div className="param" style={pad}>{head}<input type="checkbox" checked={!!cur} onChange={(e) => write(e.target.checked)} />{tail}</div>;
  if (c.type === 'slider') return <div className="param" style={pad}>{head}<input type="range" min={c.min} max={c.max} step={Math.abs(c.max - c.min) <= 10 ? 0.01 : 1} value={cur} onChange={(e) => write(+e.target.value)} /><NumInput className="num" type="number" value={+(+cur).toFixed(3)} onChange={(e) => write(+e.target.value)} />{tail}</div>;
  if (c.type === 'color') return <div className="param" style={pad}>{head}<input type="color" value={toHex(cur)} onChange={(e) => write(fromHex(e.target.value, cur[3] ?? 1))} />{tail}</div>;
  if (c.type === 'point') return <div className="param" style={pad}>{head}<NumInput className="num" type="number" value={Math.round(cur[0])} onChange={(e) => write([+e.target.value, cur[1]])} /><NumInput className="num" type="number" value={Math.round(cur[1])} onChange={(e) => write([cur[0], +e.target.value])} />{tail}</div>;
  if (c.type === 'point3d') return <div className="param" style={pad}>{head}{[0, 1, 2].map((i) => <NumInput key={i} className="num" type="number" value={Math.round(cur?.[i] ?? 0)} onChange={(e) => { const v = [...(cur || [0, 0, 0])]; v[i] = +e.target.value; write(v); }} />)}{tail}</div>;
  if (c.type === 'angle') return <div className="param" style={pad}>{head}<input type="range" min={-360} max={360} step={1} value={cur} onChange={(e) => write(+e.target.value)} /><NumInput className="num" type="number" value={+(+cur).toFixed(1)} onChange={(e) => write(+e.target.value)} /><span className="dim">°</span>{tail}</div>;
  if (c.type === 'dropdown') {
    const items = c.items?.length ? c.items : (getPrepared(clip.mogrt.libId)?.scene.comps.flatMap((k) => k.essentialControllers || []).find((k) => k.uuid === c.id)?.dropdownItems || []);
    return <div className="param" style={pad}>{head}<select value={cur} onChange={(e) => write(+e.target.value)}>{(items.length ? items : ['1']).map((it, i) => <option key={i} value={i + 1}>{it}</option>)}</select>{tail}</div>;
  }
  if (c.type === 'text') {
    const isObj = cur && typeof cur === 'object'; const txt = isObj ? cur.text : cur ?? ''; const f = c.font || {};
    const upd = (patch) => write({ ...(isObj ? cur : { text: txt }), ...patch });
    return (
      <div className="mg-text" style={pad}>
        <div className="param"><label>{c.name || 'Text'}</label>{tail}</div>
        <textarea rows={Math.max(2, String(txt).split(/\r?\n/).length)} value={txt} onChange={(e) => upd({ text: e.target.value })} />
        {(f.capPropFontEdit || f.capPropFontSizeEdit || f.capPropFontFauxStyleEdit) && (
          <div className="param">
            {f.capPropFontEdit && <FontPicker placeholder="(template font)" width={180} value={(isObj && cur.fontFamily) || f.fontEditValue || ''} onChange={(fam) => upd({ fontFamily: fam })} />}
            {f.capPropFontSizeEdit && <NumInput className="num" title="Size" type="number" value={(isObj && cur.fontSize) || f.fontSizeEditValue || 40} onChange={(e) => upd({ fontSize: +e.target.value })} />}
            {f.capPropFontFauxStyleEdit && ['B', 'I', 'U', 'TT'].map((k, i) => { const key = ['fauxBold', 'fauxItalic', 'underline', 'allCaps'][i]; return <button key={k} className={isObj && cur[key] ? 'active' : ''} onClick={() => upd({ [key]: !(isObj && cur[key]) })}>{k}</button>; })}
          </div>
        )}
      </div>
    );
  }
  if (c.type === 'media') return <MediaControl c={c} clip={clip} cur={cur} stored={stored} write={write} reset={reset} pad={pad} />;
  return <div className="param dim" style={pad}><label>{c.name || `Control (type ${c.code})`}</label><span>unsupported control type</span></div>;
}

function MediaControl({ c, clip, cur, stored, write, reset, pad }) {
  const media = useStore((s) => s.media).filter((m) => m.kind === 'image' || m.kind === 'video');
  const val = cur && typeof cur === 'object' ? cur.mediaId : '';
  return (
    <div className="param" style={pad}><span style={{ width: 24 }} /><label>{c.name || 'Media'}</label>
      <select value={val || ''} onChange={(e) => (e.target.value ? write({ mediaId: e.target.value }) : reset())}>
        <option value="">Template default</option>{media.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>{stored !== undefined && <button title="Reset" onClick={reset}>↺</button>}
    </div>
  );
}

function MogrtEdit({ clip }) {
  const lib = useStore((s) => s.mogrtLib) || [];
  const [entry, setEntry] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { let dead = false; setEntry(null); setErr(''); openMogrt(clip.mogrt.libId).then((e) => !dead && setEntry(e)).catch((e) => !dead && setErr(String(e.message || e))); return () => { dead = true; }; }, [clip.mogrt.libId, lib.length]);
  const [warn, setWarn] = useState([]);
  useEffect(() => { let dead = false; setWarn([]); const upd = () => { const w = templateWarnings(getPrepared(clip.mogrt.libId)); if (!dead) setWarn((o) => (o.join('|') === w.join('|') ? o : w)); };
    prepareMogrt(clip.mogrt.libId).then(upd).catch((e) => !dead && setWarn([`Template could not be prepared: ${e.message || e}`])); const iv = setInterval(upd, 1500); return () => { dead = true; clearInterval(iv); }; }, [clip.mogrt.libId]);
  if (err) return <div className="panel-pad err">Template unavailable: {err}</div>;
  if (!entry) return <Empty>Loading template…</Empty>;
  const meta = entry.pkg.meta;
  return (
    <div className="panel-pad">
      <div className="mg-head"><b>{meta.name}</b><span className="dim">{meta.width}×{meta.height} · {meta.duration.toFixed(2)}s · {meta.fps.toFixed(2)} fps</span></div>
      {warn.length > 0 && <div className="mg-warn">{warn.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
      {entry.controls.tree.length === 0 && <Empty>This template exposes no editable properties.</Empty>}
      {entry.controls.tree.map((c) => <Control key={c.id} c={c} clip={clip} entry={entry} />)}
      <div className="param"><button onClick={() => edit('Reset MOGRT', ({ seq }) => { seq.clips.find((x) => x.id === clip.id).mogrt.values = {}; })}>Reset all parameters</button></div>
    </div>
  );
}

export { Browse as MogrtBrowse, MogrtEdit };

export function EssentialGraphicsTabs({ GraphicEditor }) {
  const [tab, setTab] = useState('browse');
  const sel = useStore((s) => s.selection[0]);
  const clip = useStore((s) => s.sequence.clips.find((c) => c.id === s.selection[0]));
  useEffect(() => { if (clip && (clip.mogrt || clip.graphic)) setTab('edit'); }, [sel]);
  return (
    <div className="eg-tabs">
      <div className="tabs"><button className={tab === 'browse' ? 'active' : ''} onClick={() => setTab('browse')}>Browse</button><button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>Edit</button></div>
      {tab === 'browse' ? <Browse /> : clip?.mogrt ? <MogrtEdit clip={clip} /> : clip?.graphic ? <GraphicEditor clip={clip} /> : <Empty>Select a graphic or a motion graphics template clip in the timeline to edit it</Empty>}
    </div>
  );
}
