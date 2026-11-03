// General compute worker (keeps the UI responsive): retimed audio, and the other analysis jobs registered in OPS.
// Message in:  { id, op, args }   out: { id, ok, result } | { id, ok: false, error } | { id, progress }
import { renderRetimed } from '../../Services/retime';
import { trackRegion } from '../../Services/tracker';
import { autoTone, autoColor, colorMatch } from '../../Services/colorMatch';
import { analyzeMusic, renderRemix } from '../../Services/remix';

const OPS = {
  retime: (a) => renderRetimed(a),
  track: (a, progress) => trackRegion(a, progress),
  autoTone: (a) => { const t = autoTone(a.px); return { ...t, ...autoColor(a.px, t) }; },
  autoToneOnly: (a) => autoTone(a.px),
  autoColor: (a) => autoColor(a.px),
  colorMatch: (a) => colorMatch(a.target, a.reference, { faces: a.faces }),
  remixAnalyze: (a, progress) => analyzeMusic(a.pcm, a.sr, progress), // Remix: beats + per-beat features of a music file
  remixRender: (a) => renderRemix(a.chans, a.sr, a.segments, a.xfade, a.pre, a.n, a.srcOffset),
};
const transferablesOf = (r) => {
  const out = []; const visit = (v) => { if (!v) return; if (ArrayBuffer.isView(v)) out.push(v.buffer); else if (Array.isArray(v)) v.forEach(visit); else if (typeof v === 'object') Object.values(v).forEach(visit); };
  visit(r); return [...new Set(out)];
};
self.onmessage = async ({ data }) => {
  const { id, op, args } = data; const f = OPS[op];
  if (!f) { self.postMessage({ id, ok: false, error: `unknown op ${op}` }); return; }
  try { const result = await f(args, (p) => self.postMessage({ id, progress: p })); self.postMessage({ id, ok: true, result }, transferablesOf(result)); }
  catch (e) { self.postMessage({ id, ok: false, error: String(e?.message || e) }); }
};
