import React, { useEffect, useRef, useState } from 'react';
import NumInput from './NumInput';
import { useStore, set, edit, getState, undo, redo, switchSequence, deleteHistoryFrom } from '../Core/store';
import { getPrefs } from '../Core/prefs';
import { run, addMediaToTimeline, LABELS } from '../Core/commands';
import { cachedThumb, requestThumb } from '../Services/thumbs';
import { timecode } from './Timeline';
import { importFiles, importPaths } from '../Services/media';
import { meterPeak, clipPeak } from '../Services/audioEngine';

const Empty = ({ children }) => <div className="panel-pad dim">{children}</div>;
const ICON = { video: '🎞', image: '🖼', audio: '🔊' };
const SYN_ICON = { adjustment: '◐', color: '■', bars: '▥', black: '■', transparent: '□', countdown: '⏲' };
// synthetic items (File > New): double-click opens Modify like Premiere; adjustment/transparent have nothing to modify
const modifiable = (m) => m.synthetic && !['adjustment', 'transparent'].includes(m.synthetic.type);
const uid = () => Math.random().toString(36).slice(2, 8);

/** Search bins (File > New > Search Bin): every word must match the name, path or kind. */
export const searchBinMatch = (query, m) => query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => `${m.name} ${m.path || ''} ${m.kind}${m.subclip ? ' subclip' : ''}`.toLowerCase().includes(w));

// ---- Project panel helpers: columns, sorting, thumbnails with hover scrub ----
const mediaIn = (m) => m.subclip?.in ?? 0;
const mediaOut = (m) => m.subclip?.out ?? m.duration ?? 0;
const PCOLS = [['label', 'Label'], ['name', 'Name'], ['dur', 'Media Duration'], ['fps', 'Frame Rate'], ['in', 'Video In Point'], ['out', 'Video Out Point'], ['size', 'Frame Size']];
const sortVal = { label: (m) => m.color || '~', name: (m) => m.name.toLowerCase(), dur: (m) => mediaOut(m) - mediaIn(m), fps: (m) => m.fps || 0, in: mediaIn, out: mediaOut, size: (m) => (m.width || 0) * (m.height || 0) };
const sortMedia = (list, s) => (s ? [...list].sort((a, b) => { const x = sortVal[s.key](a), y = sortVal[s.key](b); return (x < y ? -1 : x > y ? 1 : 0) * s.dir; }) : list);
/** a project item's picture; moving the mouse across it scrubs through the clip (Premiere hover scrub) */
function ItemThumb({ m, h }) {
  const [src, setSrc] = useState(null); const [url, setUrl] = useState(null);
  const at = src ?? (m.kind === 'video' ? mediaIn(m) + Math.min(1, (mediaOut(m) - mediaIn(m)) / 3) : 0);
  useEffect(() => {
    if (m.kind === 'audio' || m.status !== 'ready') return undefined; let live = true;
    const c = cachedThumb(m, at, h); if (c) setUrl(c); else requestThumb(m, at, h).then((u) => { if (live && u) setUrl(u); });
    return () => { live = false; };
  }, [m.id, m.rev, at, h]);
  const scrub = (e) => { if (m.kind !== 'video') return; const r = e.currentTarget.getBoundingClientRect(); const f = Math.max(0, Math.min(0.999, (e.clientX - r.left) / r.width));
    const span = mediaOut(m) - mediaIn(m); setSrc(mediaIn(m) + Math.round(f * 24) / 24 * span); };
  return <div className="pthumb" style={{ height: h, width: Math.round(h * 16 / 9) }} onMouseMove={scrub} onMouseLeave={() => setSrc(null)}>
    {m.kind === 'audio' ? <span className="pthumb-icon">🔊</span> : url ? <img src={url} alt="" draggable={false} /> : <span className="pthumb-icon">{m.synthetic ? SYN_ICON[m.synthetic.type] : ICON[m.kind]}</span>}
    {src != null && <i className="pthumb-pos" style={{ left: `${((src - mediaIn(m)) / Math.max(1e-6, mediaOut(m) - mediaIn(m))) * 100}%` }} />}
  </div>;
}

// ---------------- Project panel: bins, search, list/icon view ----------------
export function Project() {
  const media = useStore((s) => s.media);
  const bins = useStore((s) => s.bins) || [];
  const sel = useStore((s) => s.selectedMedia); const jobs = useStore((s) => s.proxyJobs) || {}; const [ctx, setCtx] = useState(null);
  const seqsAll = useStore((s) => s.seqs); const activeSeq = useStore((s) => s.sequence);
  const [q, setQ] = useState(''); const [view, setView] = useState('list'); const [open, setOpen] = useState({});
  const [sort, setSort] = useState(null); const [tsize, setTsize] = useState(72); // list sort { key, dir }; icon-view thumbnail height
  const log = (m) => set((s) => ({ log: [...s.log.slice(-49), m] }));
  const filtered = sortMedia(media.filter((m) => m.name.toLowerCase().includes(q.toLowerCase())), sort);
  const fps0 = activeSeq.fps || 30;
  const item = (m) => (
    <li key={m.id} className={`${sel === m.id ? 'sel' : ''} ${view}`} draggable={m.status === 'ready'} onDragStart={(e) => e.dataTransfer.setData('media-id', m.id)}
      onClick={() => set({ selectedMedia: m.id, sourceIn: null, sourceOut: null, sourceTime: m.subclip?.in ?? 0 })} onContextMenu={(e) => { e.preventDefault(); set({ selectedMedia: m.id }); setCtx({ x: e.clientX, y: e.clientY, m }); }} onDoubleClick={() => (modifiable(m) ? set({ dialog: { type: 'synthetic', props: { mediaId: m.id } } }) : addMediaToTimeline(m, getState().playhead))} title={m.error || m.path || (m.synthetic ? 'Synthetic item (File > New)' : '')}>
      {view === 'icon' && <ItemThumb m={m} h={tsize} />}
      {view === 'list' && <i className="plabel" style={{ background: m.color || 'transparent' }} />}
      <span className="pname">{m.subclip ? '✂' : m.synthetic ? SYN_ICON[m.synthetic.type] : ICON[m.kind]} {m.name}</span>{' '}
      {m.proxy?.status === 'ready' && <span className="badge" title={`Proxy: ${m.proxy.path}`}>P</span>}{jobs[m.id] && <span className="dim" title={jobs[m.id].error || ''}> {jobs[m.id].state === 'error' ? '⚠ proxy failed' : jobs[m.id].state === 'queued' ? 'proxy queued' : `proxy ${Math.round((jobs[m.id].p || 0) * 100)}%`}</span>}
      {m.status === 'error' || m.status === 'offline' ? <span className="dim">⚠ {m.error}</span> : view === 'list'
        ? <><span className="pcol">{timecode(mediaOut(m) - mediaIn(m), fps0)}</span><span className="pcol">{m.kind === 'video' && m.fps ? `${m.fps} fps` : ''}</span><span className="pcol">{m.kind !== 'audio' && m.kind !== 'image' ? timecode(mediaIn(m), fps0) : ''}</span><span className="pcol">{m.kind !== 'audio' && m.kind !== 'image' ? timecode(mediaOut(m), fps0) : ''}</span><span className="pcol">{m.width ? `${m.width}×${m.height}` : ''}{m.transcoded ? ' · FFmpeg' : ''}</span></>
        : <span className="dim">{(mediaOut(m) - mediaIn(m)).toFixed(1)}s</span>}
    </li>
  );
  const moveTo = (e, binId) => { e.preventDefault(); e.stopPropagation(); const id = e.dataTransfer.getData('media-id'); if (id) edit('Move to Bin', ({ media: ms }) => { const x = ms.find((q2) => q2.id === id); if (x) x.binId = binId; }); else if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files, log).then((its) => its.forEach((it) => edit('Move to Bin', ({ media: ms }) => { const x = ms.find((q2) => q2.id === it.id); if (x) x.binId = binId; }))); };
  return (
    <div className="panel-pad" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); importFiles(e.dataTransfer.files, log); } }}>
      <div className="param">
        <button onClick={() => run('file.import')}>Import…</button>
        <button title="New Bin" onClick={() => run('file.newBin')}>📁+</button>
        <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>☰</button>
        <button className={view === 'icon' ? 'active' : ''} onClick={() => setView('icon')}>▦</button>
        {view === 'icon' && <input type="range" min="40" max="180" value={tsize} title="Thumbnail size" onChange={(e) => setTsize(+e.target.value)} style={{ width: 80 }} />}
      </div>
      {view === 'list' && <div className="phead">{PCOLS.map(([k, n]) => <span key={k} className={`ph-${k}`} onClick={() => setSort(sort?.key === k ? (sort.dir === 1 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 })}>{n}{sort?.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>)}</div>}
      {Object.values({ ...seqsAll, [activeSeq.id]: activeSeq }).filter((x) => x.name.toLowerCase().includes(q.toLowerCase())).map((x) => (
        <li key={x.id} className="list-seq" draggable onDragStart={(e) => e.dataTransfer.setData('seq-id', x.id)} onDoubleClick={() => switchSequence(x.id)} style={{ listStyle: 'none', padding: '3px 6px' }}>🎬 {x.name} <span className="dim">{x.id === activeSeq.id ? '(active)' : ''}</span></li>
      ))}
      {!media.length && !bins.length && <Empty>Import or drop media files here (video, image, audio - any format)</Empty>}
      {bins.map((b) => {
        const inBin = b.query ? filtered.filter((m) => searchBinMatch(b.query, m)) : filtered.filter((m) => m.binId === b.id);
        return (
          <div key={b.id} className="bin" onDragOver={(e) => e.preventDefault()} onDrop={(e) => !b.query && moveTo(e, b.id)}>
            <div className="node" onClick={() => setOpen({ ...open, [b.id]: !open[b.id] })} title={b.query ? `Search bin: "${b.query}"` : ''}>{open[b.id] === false ? '▸' : '▾'} {b.query ? '🔍' : '📁'} {b.name} <span className="dim">({inBin.length})</span></div>
            {open[b.id] !== false && <ul className={`list ${view}`}>{inBin.map(item)}</ul>}
          </div>
        );
      })}
      <ul className={`list ${view}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => moveTo(e, null)}>{filtered.filter((m) => !m.binId || !bins.some((b) => b.id === m.binId && !b.query)).map(item)}</ul>
      {ctx && <div className="menu-back" onMouseDown={() => setCtx(null)}><div className="menu-dropdown ctx" style={{ position: 'fixed', left: ctx.x, top: ctx.y }} onMouseDown={(e) => e.stopPropagation()}>
        {[['Insert into Timeline', () => addMediaToTimeline(ctx.m, getState().playhead)], ['Rename…', () => run('media.rename', ctx.m.id)], ['Duplicate', () => run('media.duplicate', ctx.m.id)],
          !ctx.m.synthetic && ctx.m.path && ['Reveal in Explorer', () => window.editorstage.revealInFolder(ctx.m.path)], ['Properties…', () => set({ dialog: { type: 'clipProperties', props: { mediaId: ctx.m.id } } })], ctx.m.kind === 'video' && !ctx.m.synthetic && ['Proxy: Create Proxies…', () => run('media.createProxies')], ctx.m.kind === 'video' && !ctx.m.synthetic && ['Proxy: Attach Proxies…', () => run('media.attachProxy')],
          ctx.m.proxy && ['Proxy: Reconnect Full Resolution Media', () => run('media.detachProxy')], !ctx.m.synthetic && ['Link Media…', () => run('file.linkMedia')], !ctx.m.synthetic && ctx.m.status !== 'offline' && ['Make Offline', () => run('file.makeOffline')],
          modifiable(ctx.m) && ['Modify…', () => set({ dialog: { type: 'synthetic', props: { mediaId: ctx.m.id } } })]].filter(Boolean).map(([l, f]) => <div key={l} className="menu-item" onClick={() => { setCtx(null); f(); }}><span>{l}</span></div>)}
        <div className="menu-sep" /><div className="menu-item has-sub"><span>Label</span><span>▸</span><div className="menu-dropdown sub">
          {LABELS.map(([n, hex]) => <div key={hex} className="menu-item" onClick={() => { setCtx(null); run('media.label', ctx.m.id, hex); }}><span><i className="label-swatch" style={{ background: hex }} />{n}</span></div>)}
          <div className="menu-item" onClick={() => { setCtx(null); run('media.label', ctx.m.id, null); }}><span>None</span></div></div></div>
      </div></div>}
    </div>
  );
}

// ---------------- Media Browser: browse local drives ----------------
export function MediaBrowser() {
  const [dir, setDir] = useState(null); const [list, setList] = useState({ dirs: [], files: [] }); const [roots, setRoots] = useState([]);
  useEffect(() => { window.editorstage.listRoots().then(setRoots); }, []);
  useEffect(() => { if (dir) window.editorstage.listDir(dir).then(setList); }, [dir]);
  const up = () => setDir(dir && dir.replace(/[\\/][^\\/]*$/, '').replace(/^([A-Za-z]:)$/, '$1\\') || null);
  return (
    <div className="panel-pad">
      <div className="param"><button disabled={!dir} onClick={() => (dir.match(/^[A-Za-z]:\\?$/) ? setDir(null) : up())}>⬆</button><span className="dim ell">{dir || 'This PC'}</span></div>
      <ul className="list">
        {!dir && roots.map((r) => <li key={r} onDoubleClick={() => setDir(r)} onClick={() => setDir(r)}>💽 {r}</li>)}
        {dir && list.dirs.map((d) => <li key={d} onClick={() => setDir(dir.replace(/[\\/]$/, '') + '\\' + d)}>📁 {d}</li>)}
        {dir && list.files.map((f) => <li key={f} onDoubleClick={() => importPaths([dir.replace(/[\\/]$/, '') + '\\' + f], (m) => set((s) => ({ log: [...s.log.slice(-49), m] })))} title="Double-click to import">{'🎞'} {f}</li>)}
      </ul>
    </div>
  );
}

// ---------------- History: click to jump ----------------
// an icon per kind of step, picked from its label
const HIST_ICONS = [[/^new project|^open/i, '📄'], [/razor|split|cut/i, '✂'], [/delete|clear|remove|lift|extract/i, '🗑'], [/trim|ripple|roll|slip|slide|extend/i, '↔'], [/move|nudge|drag|duplicate/i, '✥'],
  [/insert|overwrite|paste|place|add|import/i, '➕'], [/marker/i, '◆'], [/effect|attribute|lumetri|mask|keyframe/i, 'fx'], [/transition/i, '⧓'], [/volume|pan|gain|audio|mute|solo/i, '🔊'],
  [/text|caption|title|graphic/i, 'T'], [/speed|time remap|reverse/i, '⏱'], [/label|rename|name|comment/i, '🏷'], [/nest|sequence/i, '🎬'], [/link|unlink|group/i, '🔗'], [/track/i, '☰']];
const histIcon = (label) => HIST_ICONS.find(([re]) => re.test(label))?.[1] || '•';
export function History() {
  const h = useStore((s) => s.history); const i = useStore((s) => s.historyIndex); const [pick, setPick] = useState(null); const [ask, setAsk] = useState(false);
  const jump = (n) => { let cur = getState().historyIndex; while (cur > n) { undo(); cur--; } while (cur < n) { redo(); cur++; } };
  const target = pick ?? i;
  const del = () => { setAsk(false); deleteHistoryFrom(target); setPick(null); };
  return <div className="panel-pad">
    <div className="param"><span className="dim">{h.length - 1} step{h.length === 2 ? '' : 's'} (max {getPrefs().historySteps})</span><span className="grow" />
      <button disabled={target <= 0} title="Delete the selected step and every step after it" onClick={() => setAsk(true)}>🗑 Delete</button></div>
    {ask && <div className="ks-note warn">Delete "{h[target]?.label}"{target < h.length - 1 ? ` and the ${h.length - 1 - target} step(s) after it` : ''}? This cannot be redone.
      <button onClick={del}>Delete</button><button onClick={() => setAsk(false)}>Cancel</button></div>}
    <ul className="list">{h.map((x, n) => <li key={n} className={`hist-item ${n === i ? 'sel' : n > i ? 'dim' : ''} ${pick === n ? 'picked' : ''}`} onClick={() => { setPick(n); jump(n); }}><span className="hi">{histIcon(x.label)}</span>{x.label}</li>)}</ul>
  </div>;
}

// ---------------- Audio mixers ----------------
/** peak meter: reads peak() every frame; green / yellow / red, and a clip light that stays red after 0 dBFS until clicked */
function Meter({ peak }) {
  const bar = useRef(null); const lamp = useRef(null);
  useEffect(() => {
    let raf, hold = 0;
    const tick = () => {
      const p = peak() || 0; const dbv = p > 0 ? 20 * Math.log10(p) : -90; const pct = Math.max(0, Math.min(100, ((dbv + 60) / 66) * 100));
      if (bar.current) { bar.current.style.height = `${pct}%`; bar.current.style.background = dbv >= -0.1 ? '#e53935' : dbv > -9 ? '#fdd835' : '#43a047'; bar.current.dataset.db = dbv.toFixed(1); }
      if (p >= 0.999) hold = 1; if (lamp.current) lamp.current.classList.toggle('on', !!hold);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const reset = () => { hold = 0; }; const l = lamp.current; l?.addEventListener('click', reset);
    return () => { cancelAnimationFrame(raf); l?.removeEventListener('click', reset); };
  }, [peak]);
  return <div className="meter"><i ref={lamp} className="meter-clip" title="Clipped (above 0 dBFS) - click to reset" /><div className="meter-well"><div ref={bar} className="meter-bar" /></div></div>;
}
/** fader (dB, double-click = 0 dB) with a typed dB box */
function Fader({ value, onChange, label }) {
  const v = +(value || 0);
  return <div className="fader">
    <input type="range" orient="vertical" min="-60" max="15" step="0.1" value={v} title={`${label}: ${v.toFixed(1)} dB (double-click = 0 dB)`} onChange={(e) => onChange(+e.target.value)} onDoubleClick={() => onChange(0)} />
    <NumInput className="db-box" type="number" step="0.1" min="-60" max="15" value={+v.toFixed(1)} onChange={(e) => e.target.value !== '' && onChange(Math.max(-60, Math.min(15, +e.target.value)))} />
  </div>;
}
/** pan knob as a horizontal slider -100 (L) .. 100 (R), double-click = centre */
function Pan({ value, onChange }) {
  const v = Math.round(+(value || 0));
  return <div className="pan" title="Pan (double-click = centre)"><input type="range" min="-100" max="100" step="1" value={v} onChange={(e) => onChange(+e.target.value)} onDoubleClick={() => onChange(0)} />
    <span>{v === 0 ? 'C' : v < 0 ? `L${-v}` : `R${v}`}</span></div>;
}
const trackEdit = (id, label, fn, key) => edit(label, ({ seq: q }) => { const t = q.tracks.find((x) => x.id === id); if (t) fn(t); }, { coalesce: `${key}:${id}` });
const clipParam = (ids, label, key, v, coalesce) => edit(label, ({ seq: q }) => { for (const c of q.clips.filter((x) => ids.includes(x.id))) {
  if (key === 'pan') c.pan = { ...(c.pan || {}), v, keys: c.pan?.keys || null };
  else c.volume = { bypass: { v: false, keys: null }, ...c.volume, level: { ...(c.volume?.level || {}), v, keys: c.volume?.level?.keys || null } };
} }, { coalesce });
/** Audio Track Mixer (one strip per audio track + Master) and Audio Clip Mixer (one strip per selected clip that plays sound) */
export function Mixer({ clip }) {
  const seq = useStore((s) => s.sequence); const sel = useStore((s) => s.selection);
  const tracks = seq.tracks.filter((t) => t.kind === 'audio');
  if (clip) {
    const cs = seq.clips.filter((x) => sel.includes(x.id) && (seq.tracks.find((t) => t.id === x.track)?.kind === 'audio' || (x.mediaId && !x.noAudio && !x.nestId)));
    if (!cs.length) return <Empty>Select clips with sound to see them in the clip mixer</Empty>;
    return <div className="panel-pad mixer">{cs.map((c) => <div key={c.id} className="strip">
      <div className="strip-name ell" title={c.name}>{c.name}</div><div className="dim">{c.track}</div>
      <Pan value={c.pan?.v} onChange={(v) => clipParam([c.id], 'Clip Pan', 'pan', v, `cp:${c.id}`)} />
      <div className="strip-body"><Fader label="Clip volume" value={c.volume?.level?.v} onChange={(v) => clipParam([c.id], 'Clip Volume', 'volume', v, `cv:${c.id}`)} /><Meter peak={() => clipPeak(c.id)} /></div>
    </div>)}</div>;
  }
  return (
    <div className="panel-pad mixer">
      {tracks.map((t) => (
        <div key={t.id} className="strip">
          <div className="strip-name ell" title={t.name || t.id}>{t.name || t.id}</div><div className="dim">{t.id}</div>
          <Pan value={t.pan} onChange={(v) => trackEdit(t.id, 'Track Pan', (x) => { x.pan = v; }, 'tp')} />
          <div className="strip-body"><Fader label="Track volume" value={t.volume} onChange={(v) => trackEdit(t.id, 'Track Volume', (x) => { x.volume = v; }, 'tv')} /><Meter peak={() => meterPeak(t.id)} /></div>
          <div><button className={t.muted ? 'on' : ''} onClick={() => run('track.mute', t.id)}>M</button><button className={t.solo ? 'on' : ''} onClick={() => run('track.solo', t.id)}>S</button></div>
        </div>
      ))}
      <div className="strip master">
        <div className="strip-name">Master</div><div className="dim">Mix</div><div className="pan" />
        <div className="strip-body"><Fader label="Master volume" value={seq.masterVolume} onChange={(v) => edit('Master Volume', ({ seq: q }) => { q.masterVolume = v; }, { coalesce: 'mv' })} /><Meter peak={() => meterPeak(null)} /></div>
      </div>
    </div>
  );
}

// ---------------- Lumetri Scopes (computed from the Program Monitor frame) ----------------
export function Scopes() {
  const cv = useRef(null); const [mode, setMode] = useState('waveform');
  useEffect(() => {
    const W = 360, H = 220; const c = cv.current; c.width = W; c.height = H; const g = c.getContext('2d', { willReadFrequently: true });
    const SW = 160, SH = 90; const tmp = document.createElement('canvas'); tmp.width = SW; tmp.height = SH; const tg = tmp.getContext('2d', { willReadFrequently: true });
    const id = setInterval(() => {
      const src = window.__comp?.canvas; if (!src) return;
      tg.drawImage(src, 0, 0, SW, SH); const px = tg.getImageData(0, 0, SW, SH).data; c.dataset.mode = mode; c.dataset.frames = String(+(c.dataset.frames || 0) + 1);
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#2a6a3a'; g.fillStyle = '#4a9'; g.font = '9px sans-serif';
      if (mode === 'waveform' || mode === 'parade') {
        for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, (i * H) / 4); g.lineTo(W, (i * H) / 4); g.stroke(); }
        for (let i = 0; i <= 4; i++) g.fillText(String(100 - i * 25), 2, Math.max(9, (i * H) / 4 - 2));
        for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
          const o = (y * SW + x) * 4; const r = px[o], gr = px[o + 1], b = px[o + 2];
          if (mode === 'waveform') { const l = 0.2126 * r + 0.7152 * gr + 0.0722 * b; g.fillStyle = 'rgba(120,255,160,0.35)'; g.fillRect((x / SW) * W, H - (l / 255) * H, W / SW + 0.5, 1.5); }
          else { const w3 = W / 3; for (const [k, v, col] of [[0, r, 'rgba(255,80,80,.4)'], [1, gr, 'rgba(80,255,80,.4)'], [2, b, 'rgba(80,140,255,.4)']]) { g.fillStyle = col; g.fillRect(k * w3 + (x / SW) * w3, H - (v / 255) * H, w3 / SW + 0.5, 1.5); } }
        }
      } else if (mode === 'histogram') {
        const hist = [new Array(256).fill(0), new Array(256).fill(0), new Array(256).fill(0)];
        for (let o = 0; o < px.length; o += 4) { hist[0][px[o]]++; hist[1][px[o + 1]]++; hist[2][px[o + 2]]++; }
        const mx = Math.max(...hist.flat()) || 1; g.globalCompositeOperation = 'lighter';
        hist.forEach((hh, k) => { g.fillStyle = ['#a22', '#2a2', '#22a'][k]; hh.forEach((v, i) => g.fillRect((i / 256) * W, H - (v / mx) * H, W / 256 + 1, (v / mx) * H)); });
        g.globalCompositeOperation = 'source-over';
      } else {
        const cx = W / 2, cy = H / 2, R = H / 2 - 8; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
        const uvOf = (r, gr, b) => [-0.169 * r - 0.331 * gr + 0.5 * b, 0.5 * r - 0.419 * gr - 0.081 * b];
        // 75% color targets (R, Mg, B, Cy, G, Yl) and the skin tone line
        for (const [lab, rgb] of [['R', [0.75, 0, 0]], ['Mg', [0.75, 0, 0.75]], ['B', [0, 0, 0.75]], ['Cy', [0, 0.75, 0.75]], ['G', [0, 0.75, 0]], ['Yl', [0.75, 0.75, 0]]]) { const [u, v] = uvOf(...rgb); g.strokeRect(cx + u * 2 * R - 4, cy - v * 2 * R - 4, 8, 8); g.fillText(lab, cx + u * 2 * R + 6, cy - v * 2 * R + 3); }
        g.save(); g.strokeStyle = '#a86'; g.beginPath(); g.moveTo(cx, cy); const sk = uvOf(0.85, 0.62, 0.5); const sl = Math.hypot(...sk); g.lineTo(cx + (sk[0] / sl) * R, cy - (sk[1] / sl) * R); g.stroke(); g.restore();
        for (let o = 0; o < px.length; o += 4) { const r = px[o] / 255, gr = px[o + 1] / 255, b = px[o + 2] / 255; const u = -0.169 * r - 0.331 * gr + 0.5 * b, v = 0.5 * r - 0.419 * gr - 0.081 * b; g.fillStyle = `rgb(${px[o]},${px[o + 1]},${px[o + 2]})`; g.fillRect(cx + u * 2 * R, cy - v * 2 * R, 2, 2); }
      }
    }, 250);
    return () => clearInterval(id);
  }, [mode]);
  return (
    <div className="panel-pad">
      <div className="param">{[['waveform', 'Waveform (Luma)'], ['parade', 'RGB Parade'], ['histogram', 'Histogram'], ['vectorscope', 'Vectorscope YUV']].map(([m, label]) => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{label}</button>)}</div>
      <canvas ref={cv} className="scope" style={{ width: '100%', background: '#000' }} />
    </div>
  );
}
