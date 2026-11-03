import { edit, getState } from '../Core/store';

// Title/shape graphics rendered to a 2D canvas that the compositor uses as a clip source.
const cache = new Map(); // `${clipId}@${W}x${H}` -> { sig, canvas } (one entry per render size: Preview and Export do not evict each other)
const MAX_CACHE = 48;

export const defaultGraphic = (type) => ({
  type, text: type === 'vtext' ? 'Vertical' : 'New Title', font: 'Arial', size: 96, bold: true, italic: false, align: 'center',
  color: '#ffffff', stroke: false, strokeColor: '#000000', strokeW: 6, shadow: true, bg: false, bgColor: '#000000',
  x: 0.5, y: type === 'text' ? 0.8 : 0.5, w: 0.4, h: 0.3, radius: 0, sides: 5,
});

/**
 * Draw a title/shape at the size it is being rendered at: `dims` is the render target (Preview size, or the full
 * sequence size during Export, e.g. 3840x2160); `seqDims` is the sequence frame the graphic's pixel values refer to.
 */
export function graphicCanvas(clip, dims, seqDims = dims) {
  const g = clip.graphic; if (!g) return null;
  const W = Math.max(2, Math.round(dims.w)), H = Math.max(2, Math.round(dims.h));
  const sc = W / Math.max(1, seqDims.w);
  const key = `${clip.id}@${W}x${H}`;
  const sig = JSON.stringify(g);
  let e = cache.get(key);
  if (e && e.sig === sig) { cache.delete(key); cache.set(key, e); return e.canvas; } // LRU touch
  const canvas = e?.canvas || document.createElement('canvas'); if (canvas.width !== W) canvas.width = W; if (canvas.height !== H) canvas.height = H;
  const c = canvas.getContext('2d'); c.clearRect(0, 0, W, H); c.save();
  const px = (v) => v * sc;
  if (g.type === 'text' || g.type === 'vtext') {
    c.font = `${g.italic ? 'italic ' : ''}${g.bold ? 'bold ' : ''}${px(g.size)}px "${g.font}"`;
    c.textBaseline = 'middle'; c.textAlign = g.align;
    const lines = String(g.text).split('\n'); const lh = px(g.size) * 1.2;
    const cx = g.x * W, cy = g.y * H;
    if (g.bg) {
      const mw = Math.max(...lines.map((l) => c.measureText(l).width)); c.fillStyle = g.bgColor;
      c.fillRect(cx - (g.align === 'left' ? 0 : g.align === 'right' ? mw : mw / 2) - px(12), cy - (lines.length * lh) / 2 - px(8), mw + px(24), lines.length * lh + px(16));
    }
    if (g.shadow) { c.shadowColor = '#000a'; c.shadowBlur = px(10); c.shadowOffsetY = px(3); }
    lines.forEach((l, i) => {
      const y = cy - ((lines.length - 1) * lh) / 2 + i * lh;
      if (g.type === 'vtext') { [...l].forEach((ch, j) => { const yy = cy - ((l.length - 1) * lh) / 2 + j * lh; if (g.stroke) { c.lineWidth = px(g.strokeW); c.strokeStyle = g.strokeColor; c.strokeText(ch, cx + i * lh, yy); } c.fillStyle = g.color; c.fillText(ch, cx + i * lh, yy); }); return; }
      if (g.stroke) { c.lineWidth = px(g.strokeW); c.lineJoin = 'round'; c.strokeStyle = g.strokeColor; c.strokeText(l, cx, y); }
      c.fillStyle = g.color; c.fillText(l, cx, y);
    });
  } else {
    c.fillStyle = g.color;
    const cx = g.x * W, cy = g.y * H, w = g.w * W, h = g.h * H;
    c.beginPath();
    if (g.type === 'rect') { const r = Math.min(px(g.radius), w / 2, h / 2); c.roundRect(cx - w / 2, cy - h / 2, w, h, r); }
    else if (g.type === 'ellipse') c.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    else { const n = Math.max(3, g.sides | 0); for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; const x = cx + (w / 2) * Math.cos(a), y = cy + (h / 2) * Math.sin(a); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); }
    c.fill();
    if (g.stroke) { c.lineWidth = px(g.strokeW); c.strokeStyle = g.strokeColor; c.stroke(); }
  }
  c.restore();
  cache.delete(key); cache.set(key, { sig, canvas });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  canvas.__ver = (canvas.__ver || 0) + 1; // compositor re-uploads only when the drawing changed
  return canvas;
}

const uid = () => Math.random().toString(36).slice(2, 8);
/** Create a graphic clip at `at` on the top video track; returns its id. */
export function addGraphic(type, at = getState().playhead, over = {}) {
  let id = null;
  edit(`New ${type === 'text' ? 'Text' : type === 'vtext' ? 'Vertical Text' : type[0].toUpperCase() + type.slice(1)} Layer`, ({ seq, sel }) => {
    const tracks = seq.tracks.filter((t) => t.kind === 'video' && !t.locked); if (!tracks.length) return;
    id = uid();
    seq.clips.push({ id, track: tracks[0].id, start: at, dur: 5, name: type === 'text' || type === 'vtext' ? 'Graphic' : `${type} Shape`, graphicKind: type, graphic: { ...defaultGraphic(type), ...over },
      color: '#a64ca6', effects: [], enabled: true });
    sel.splice(0, sel.length, id);
  });
  return id;
}
