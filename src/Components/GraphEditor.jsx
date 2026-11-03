import React from 'react';
import { evalParam, setKeyHandles, setKeyInterp, moveKey, removeKeyAt, writeParam, handlesOf, EASE_PRESETS, INTERPS } from '../Core/params';

// Graph Editor (Effect Controls): Value and Speed graphs of one keyframed parameter over the clip.
//   drag a key to retime it / change its value, drag a Bezier handle to shape the curve, double-click to add a key,
//   Alt+click a key to delete it, ease preset buttons (CapCut names) apply to the selected key's outgoing segment.
// Every change goes through onChange(newParam, label) -> edit(), so it is undoable and Export uses the same curve.
const H = 140, PAD = 10, HR = 5;
const comps = (v) => (Array.isArray(v) ? v : [v]);
const COLORS = ['#7fb3ff', '#ff9f6b', '#9be37c', '#e88cff'];

export default function GraphEditor({ p, dur, local, onChange, onPlayheadTo }) {
  const cv = React.useRef(null); const wrap = React.useRef(null);
  const [mode, setMode] = React.useState('value'); const [sel, setSel] = React.useState(p.keys?.[0]?.t ?? null);
  const [W, setW] = React.useState(300);
  React.useEffect(() => { const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.floor(e.contentRect.width)))); ro.observe(wrap.current); return () => ro.disconnect(); }, []);
  const keys = p.keys || []; const span = Math.max(dur, keys.length ? keys[keys.length - 1].t : 0, 1e-3);
  const scalar = typeof keys[0]?.v === 'number';
  const N = Math.min(400, W);
  const samples = React.useMemo(() => {
    const vals = []; for (let i = 0; i <= N; i++) vals.push(comps(evalParam(p, (i / N) * span)));
    if (mode === 'value') return vals;
    const dt = span / N; return vals.map((v, i) => { const a = vals[Math.max(0, i - 1)], b = vals[Math.min(N, i + 1)]; const d = Math.hypot(...b.map((x, j) => x - a[j])) / (dt * (Math.min(N, i + 1) - Math.max(0, i - 1)) || 1); return [d]; });
  }, [p, span, N, mode]);
  let lo = Infinity, hi = -Infinity; for (const v of samples) for (const x of v) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (mode === 'value') for (const k of keys) for (const x of comps(k.v)) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (mode === 'speed') lo = 0;
  if (!(hi > lo)) { hi = lo + 1; lo -= 1; } const padv = (hi - lo) * 0.12; lo -= padv; hi += padv;
  const X = (t) => PAD + (t / span) * (W - 2 * PAD), Y = (v) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const T = (x) => ((x - PAD) / (W - 2 * PAD)) * span, V = (y) => lo + ((H - PAD - y) / (H - 2 * PAD)) * (hi - lo);
  const si = keys.findIndex((k) => sel != null && Math.abs(k.t - sel) < 1e-6);
  // Bezier handles of the selected key (scalar params, value graph): its incoming and outgoing segments
  const handles = [];
  if (mode === 'value' && scalar && si >= 0) {
    const A = keys[si - 1], K = keys[si], B = keys[si + 1];
    if (A && K.v !== A.v) { const h = handlesOf(A, K).in; handles.push({ side: 'in', key: K.t, x: X(A.t + h[0] * (K.t - A.t)), y: Y(A.v + h[1] * (K.v - A.v)), ax: X(K.t), ay: Y(K.v), seg: [A, K] }); }
    if (B && K.v !== B.v && K.interp !== 'hold') { const h = handlesOf(K, B).out; handles.push({ side: 'out', key: K.t, x: X(K.t + h[0] * (B.t - K.t)), y: Y(K.v + h[1] * (B.v - K.v)), ax: X(K.t), ay: Y(K.v), seg: [K, B] }); }
  }

  React.useEffect(() => {
    const c = cv.current; const g = c.getContext('2d'); const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#151515'; g.fillRect(0, 0, W, H); g.strokeStyle = '#2a2a2a'; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = PAD + ((H - 2 * PAD) * i) / 4; g.beginPath(); g.moveTo(PAD, y); g.lineTo(W - PAD, y); g.stroke(); }
    g.fillStyle = '#777'; g.font = '10px sans-serif'; g.fillText((hi - padv).toFixed(Math.abs(hi) < 10 ? 2 : 0), 2, PAD + 8); g.fillText((lo + padv).toFixed(Math.abs(lo) < 10 ? 2 : 0), 2, H - 2);
    const nc = samples[0].length;
    for (let j = 0; j < nc; j++) { g.strokeStyle = COLORS[j % COLORS.length]; g.lineWidth = 1.5; g.beginPath(); samples.forEach((v, i) => { const x = X((i / N) * span), y = Y(v[j]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    g.strokeStyle = '#4a90e2'; g.beginPath(); g.moveTo(X(local), 0); g.lineTo(X(local), H); g.stroke();
    if (dur < span) { g.fillStyle = '#0006'; g.fillRect(X(dur), 0, W - X(dur), H); }
    for (const k of keys) for (const [j, x] of comps(mode === 'value' ? k.v : [0]).entries()) {
      const yy = mode === 'value' ? Y(x) : H - PAD; g.fillStyle = Math.abs(k.t - (sel ?? -1)) < 1e-6 ? '#ffd24a' : COLORS[j % COLORS.length];
      g.save(); g.translate(X(k.t), yy); g.rotate(Math.PI / 4); g.fillRect(-4, -4, 8, 8); g.restore();
    }
    for (const h of handles) { g.strokeStyle = '#ffd24a'; g.beginPath(); g.moveTo(h.ax, h.ay); g.lineTo(h.x, h.y); g.stroke(); g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(h.x, h.y, HR - 1, 0, 7); g.fill(); }
  });

  const pos = (e) => { const r = cv.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hitKey = (x, y) => keys.find((k) => Math.abs(X(k.t) - x) < 7 && (mode !== 'value' || comps(k.v).some((v) => Math.abs(Y(v) - y) < 7)));
  const down = (e) => {
    e.preventDefault(); const [x, y] = pos(e);
    const h = handles.find((q) => Math.hypot(q.x - x, q.y - y) < HR + 3);
    if (h) {
      const [A, B] = h.seg;
      const mv = (ev) => {
        const [mx, my] = pos(ev); const hx = Math.min(1, Math.max(0, (T(mx) - A.t) / (B.t - A.t))); const hy = (V(my) - A.v) / (B.v - A.v);
        onChange(setKeyHandles(p, h.side === 'out' ? A.t : B.t, h.side === 'out' ? { out: [hx, hy] } : { in: [hx, hy] }), 'Keyframe handle');
      };
      return drag(mv);
    }
    const k = hitKey(x, y);
    if (!k) return;
    if (e.altKey) { onChange(removeKeyAt(p, k.t), 'Delete keyframe'); setSel(null); return; }
    setSel(k.t); onPlayheadTo?.(k.t);
    const idx = keys.indexOf(k); const y0 = y;
    // every move is applied to the param as it was at mousedown (absolute, no drift)
    const mv = (ev) => {
      const [mx, my] = pos(ev);
      const nv = mode === 'value' && scalar && Math.abs(my - y0) > 2 ? V(my) : k.v;
      const np = moveKey(p, k.t, Math.max(0, T(mx)), nv); onChange(np, 'Move keyframe'); setSel(np.keys[idx].t);
    };
    drag(mv);
  };
  const drag = (mv) => { const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); };
  const dbl = (e) => { const [x] = pos(e); const t = Math.min(dur, Math.max(0, T(x))); onChange(writeParam(p, evalParam(p, t), t), 'Add keyframe'); setSel(t); };
  const selKey = si >= 0 ? keys[si] : null;
  return (
    <div className="graph" ref={wrap}>
      <div className="graph-bar">
        <button className={mode === 'value' ? 'active' : ''} onClick={() => setMode('value')}>Value</button>
        <button className={mode === 'speed' ? 'active' : ''} onClick={() => setMode('speed')}>Speed</button>
        <span className="grow" />
        {EASE_PRESETS.map((x) => <button key={x.id} disabled={!selKey} title={`${x.label}: shape the segment after the selected keyframe`} className={selKey?.interp === x.id ? 'active' : ''} onClick={() => onChange(setKeyInterp(p, selKey.t, x.id), `${x.label} ease`)}>{x.label}</button>)}
        <select disabled={!selKey} value={selKey?.interp || 'linear'} title="Interpolation of the selected keyframe" onChange={(e) => onChange(setKeyInterp(p, selKey.t, e.target.value), 'Keyframe interpolation')}>
          {INTERPS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </div>
      <canvas ref={cv} style={{ width: W, height: H, cursor: 'crosshair', display: 'block' }} onMouseDown={down} onDoubleClick={dbl} />
      <div className="dim note">Drag keys and yellow handles · double-click: add key · Alt+click: delete key{scalar ? '' : ' · handles are edited on number parameters'}</div>
    </div>
  );
}
