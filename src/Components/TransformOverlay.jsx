import React, { useRef, useState } from 'react';
import { useStore, set, getState, commitSeq } from '../Core/store';
import { evalParam, writeParam, DEFAULT_MOTION, frameScaled } from '../Core/params';
import { expandSelection } from '../Core/commands';
import { getPrepared } from '../Services/mogrt/render';

// Direct manipulation in the Program Monitor (Premiere-style): click a clip in the picture to select it, drag to move,
// drag the handles to scale (corners uniform, sides per axis), drag the round handle or just outside a corner to rotate.
// Writes the same Motion params as Effect Controls (keyframes are added when the param is animated).

const ROT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M5 11a6 6 0 1 0 6-6" fill="none" stroke="#000" stroke-width="3.5"/><path d="M5 11a6 6 0 1 0 6-6" fill="none" stroke="#fff" stroke-width="1.6"/><path d="M11 1v8l4-4z" fill="#fff" stroke="#000" stroke-width=".8"/></svg>')}") 11 11, crosshair`;
const RESIZE = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'];

const motionAt = (clip, local) => Object.fromEntries(Object.entries({ ...DEFAULT_MOTION(), ...(clip.motion || {}) }).map(([k, p]) => [k, evalParam(p, local)]));

/** Source pixel size the compositor fits into the frame (uploaded texture size when known). */
function sourceSize(clip, seq) {
  if (clip.nestId || clip.graphic || clip.caption) return [seq.width, seq.height];
  const st = window.__comp?.srcTex?.get(clip.elKey || clip.id);
  if (st && st.w && st.h) return [st.w, st.h];
  const m = clip.mediaId && getState().media.find((x) => x.id === clip.mediaId);
  if (m?.width && m?.height) return [m.width, m.height];
  const inst = clip.mogrt && getPrepared(clip.mogrt.libId);
  if (inst) return [inst.comp.width, inst.comp.height];
  return [seq.width, seq.height];
}

/** Source uv (y down) -> frame uv (y down), the same mapping as the compositor's DRAW_FRAG. */
function mapper(mo, fa, sa) {
  const ws = sa >= fa ? fa : sa, hs = sa >= fa ? fa / sa : 1;
  const sc = mo.scale / 100, sw = mo.uniform === false ? mo.scaleW / 100 : sc;
  const r = (mo.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return (u, v) => {
    const qx = (u - mo.anchor[0]) * ws * sw, qy = (mo.anchor[1] - v) * hs * sc;
    return [mo.position[0] + (qx * c - qy * s) / fa, mo.position[1] - (qx * s + qy * c)];
  };
}

/** Screen-space geometry of a clip at sequence time t in a W x H box. */
function geometry(clip, seq, t, W, H) {
  const [sw, sh] = sourceSize(clip, seq); const mo = frameScaled(motionAt(clip, Math.max(0, t - clip.start)), clip, sw, sh, seq.width, seq.height);
  const f = mapper(mo, seq.width / seq.height, sw / sh); const px = (p) => [p[0] * W, p[1] * H];
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => px(f(u, v)));
  const edges = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]].map(([u, v]) => px(f(u, v)));
  const r = (mo.rotation * Math.PI) / 180;
  return { mo, corners, edges, pivot: px(mo.position), ex: [Math.cos(r), -Math.sin(r)], ey: [Math.sin(r), Math.cos(r)] };
}

function inside(pt, poly) {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inn = !inn;
  }
  return inn;
}

/** Video clips visible at t, topmost track first (caption tracks are positioned by their own styles). */
function visibleClips(seq, t) {
  const order = seq.tracks.filter((tr) => tr.kind === 'video');
  return order.flatMap((tr) => seq.clips.filter((c) => c.track === tr.id && c.enabled && t >= c.start && t < c.start + c.dur));
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

export default function TransformOverlay({ W, H, enabled }) {
  const seq = useStore((s) => s.sequence);
  const t = useStore((s) => (s.playing ? -1 : s.playhead));
  const selId = useStore((s) => s.selection[0]);
  const linked = useStore((s) => s.toggles.linked);
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  if (!enabled || t < 0 || !W || !H) return null;

  const clips = visibleClips(seq, t);
  const sel = clips.find((c) => c.id === selId);
  const lockedTrack = (c) => !!seq.tracks.find((x) => x.id === c.track)?.locked;
  const g = sel ? geometry(sel, seq, t, W, H) : null;
  const mouse = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hitTest = (p) => clips.find((c) => inside(p, geometry(c, seq, t, W, H).corners));

  /** Drag gesture on clip `id`: compute(params at drag start, mouse now, event) -> Motion patch. One undo step on release. */
  const drag = (e, id, label, compute) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const before = getState().sequence; const clip = before.clips.find((c) => c.id === id); if (!clip || lockedTrack(clip)) return;
    const local = Math.max(0, getState().playhead - clip.start);
    const g0 = geometry(clip, before, getState().playhead, W, H); const m0 = mouse(e); let last = null;
    const move = (ev) => {
      const patch = compute(g0, m0, mouse(ev), ev);
      const s = { ...before, clips: before.clips.map((c) => {
        if (c.id !== id) return c;
        const m = { ...DEFAULT_MOTION(), ...c.motion };
        for (const [k, v] of Object.entries(patch)) m[k] = writeParam(m[k], v, local);
        return { ...c, motion: m };
      }) };
      last = s; set({ sequence: s });
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      if (last) commitSeq(label, before, last);
    };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const moveGesture = (e, id) => drag(e, id, 'Motion: Position', (g0, m0, m, ev) => {
    let dx = (m[0] - m0[0]) / W, dy = (m[1] - m0[1]) / H;
    if (ev.shiftKey) { if (Math.abs(dx * W) > Math.abs(dy * H)) dy = 0; else dx = 0; } // Shift: constrain to one axis
    return { position: [g0.mo.position[0] + dx, g0.mo.position[1] + dy] };
  });
  const cornerGesture = (e) => drag(e, sel.id, 'Motion: Scale', (g0, m0, m) => {
    const d0 = Math.hypot(...sub(m0, g0.pivot)) || 1; const f = Math.hypot(...sub(m, g0.pivot)) / d0;
    const p = { scale: Math.max(0, +(g0.mo.scale * f).toFixed(2)) };
    if (g0.mo.uniform === false) p.scaleW = Math.max(0, +(g0.mo.scaleW * f).toFixed(2));
    return p;
  });
  const edgeGesture = (e, horizontal) => drag(e, sel.id, horizontal ? 'Motion: Scale Width' : 'Motion: Scale', (g0, m0, m) => {
    const ax = horizontal ? g0.ex : g0.ey; const d0 = dot(sub(m0, g0.pivot), ax);
    const f = Math.abs(d0) < 1 ? 1 : Math.max(0, dot(sub(m, g0.pivot), ax) / d0);
    if (g0.mo.uniform === false) return horizontal ? { scaleW: +(g0.mo.scaleW * f).toFixed(2) } : { scale: +(g0.mo.scale * f).toFixed(2) };
    return { scale: +(g0.mo.scale * f).toFixed(2) };
  });
  const rotateGesture = (e) => {
    let acc = 0, prev = null; // unwrapped angle so dragging past +-180 degrees keeps turning
    drag(e, sel.id, 'Motion: Rotation', (g0, m0, m, ev) => {
      const a = Math.atan2(m[1] - g0.pivot[1], m[0] - g0.pivot[0]);
      if (prev === null) prev = Math.atan2(m0[1] - g0.pivot[1], m0[0] - g0.pivot[0]);
      let d = a - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; acc += d; prev = a;
      let rot = g0.mo.rotation - (acc * 180) / Math.PI; // screen y points down: clockwise on screen = negative rotation
      if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
      return { rotation: +rot.toFixed(2) };
    });
  };

  const bgDown = (e) => {
    if (e.button !== 0) return;
    const p = mouse(e); const hit = hitTest(p);
    if (!hit) { set({ selection: [], selectedTransition: null }); return; }
    set({ selection: expandSelection(getState().sequence, [hit.id], linked), selectedTransition: null });
    moveGesture(e, hit.id);
  };
  const bgMove = (e) => { if (e.buttons) return; const h = hitTest(mouse(e)); const id = h && h.id !== selId ? h.id : null; if (id !== hover) setHover(id); };
  const hoverClip = hover && clips.find((c) => c.id === hover);
  const pts = (arr) => arr.map((p) => p.join(',')).join(' ');
  const cursorFor = (p) => { const a = Math.atan2(p[1] - g.pivot[1], p[0] - g.pivot[0]); const k = ((Math.round((a * 4) / Math.PI) % 4) + 4) % 4; return RESIZE[k]; };
  const top = g && g.edges[0]; const stick = g && [top[0] - g.ey[0] * 26, top[1] - g.ey[1] * 26];
  const canEdit = sel && !lockedTrack(sel);

  return (
    <svg ref={ref} className="xform-ovl" width={W} height={H} onMouseDown={bgDown} onMouseMove={bgMove} onMouseLeave={() => setHover(null)}>
      {hoverClip && <polygon points={pts(geometry(hoverClip, seq, t, W, H).corners)} fill="none" stroke="#4af8" strokeWidth="1" strokeDasharray="4 3" pointerEvents="none" />}
      {g && <g>
        {canEdit && g.corners.map((p, i) => <circle key={'r' + i} cx={p[0]} cy={p[1]} r="16" fill="transparent" style={{ cursor: ROT_CURSOR }} onMouseDown={rotateGesture} />)}
        <polygon points={pts(g.corners)} fill="transparent" stroke="#4af" strokeWidth="1.5" style={{ cursor: canEdit ? 'move' : 'default' }} onMouseDown={(e) => canEdit && e.button === 0 && moveGesture(e, sel.id)} />
        {canEdit && <>
          <line x1={top[0]} y1={top[1]} x2={stick[0]} y2={stick[1]} stroke="#4af" strokeWidth="1.5" pointerEvents="none" />
          <circle cx={stick[0]} cy={stick[1]} r="5" fill="#fff" stroke="#4af" strokeWidth="1.5" style={{ cursor: ROT_CURSOR }} onMouseDown={rotateGesture}><title>Rotate (Shift: 15° steps)</title></circle>
          {g.edges.map((p, i) => <rect key={'e' + i} x={p[0] - 4} y={p[1] - 4} width="8" height="8" fill="#fff" stroke="#4af" strokeWidth="1.5" style={{ cursor: cursorFor(p) }} onMouseDown={(e) => edgeGesture(e, i % 2 === 1)} />)}
          {g.corners.map((p, i) => <rect key={'c' + i} x={p[0] - 4.5} y={p[1] - 4.5} width="9" height="9" fill="#fff" stroke="#4af" strokeWidth="1.5" style={{ cursor: cursorFor(p) }} onMouseDown={cornerGesture} />)}
        </>}
        <g pointerEvents="none" stroke="#fff" strokeWidth="1.2">
          <circle cx={g.pivot[0]} cy={g.pivot[1]} r="5" fill="none" />
          <line x1={g.pivot[0] - 8} y1={g.pivot[1]} x2={g.pivot[0] + 8} y2={g.pivot[1]} /><line x1={g.pivot[0]} y1={g.pivot[1] - 8} x2={g.pivot[0]} y2={g.pivot[1] + 8} />
        </g>
      </g>}
    </svg>
  );
}
