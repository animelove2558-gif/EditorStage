// Tracker tests (Mask Tracking / Point Tracker): synthetic textured object moving / rotating / scaling over a textured background.
import { trackRegion, fitSimilarity, applySim, invertSim } from '../src/Services/tracker.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const W = 240, H = 160;
// deterministic value noise
const rnd = (x, y, s) => { const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return v - Math.floor(v); };
const tex = (u, v, s) => { const x = Math.floor(u), y = Math.floor(v), fx = u - x, fy = v - y; const a = rnd(x, y, s), b = rnd(x + 1, y, s), c = rnd(x, y + 1, s), d = rnd(x + 1, y + 1, s); return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy; };
/** object: 50x50 square, texture coords follow the object's similarity transform at frame k */
const pose = (k) => ({ cx: 60 + 3 * k, cy: 60 + 1.2 * k, r: 0.01 * k, s: 1 + 0.004 * k });
function render(k) {
  const f = new Uint8Array(W * H); const p = pose(k);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - p.cx, dy = y - p.cy; const c = Math.cos(-p.r), s = Math.sin(-p.r); const u = (c * dx - s * dy) / p.s, v = (s * dx + c * dy) / p.s;
    f[y * W + x] = Math.abs(u) < 25 && Math.abs(v) < 25 ? 40 + 200 * tex((u + 25) / 4, (v + 25) / 4, 1) : 30 + 40 * tex(x / 9, y / 9, 2);
  }
  return f;
}
const N = 30; const frames = new Uint8Array(W * H * N); for (let k = 0; k < N; k++) frames.set(render(k), k * W * H);
const region = [[40, 40], [80, 40], [80, 80], [40, 80]]; // inside the object at frame 0
const truth = (k, p) => { const a = pose(0), b = pose(k); const dx = p[0] - a.cx, dy = p[1] - a.cy; const c = Math.cos(b.r - a.r), s = Math.sin(b.r - a.r), sc = b.s / a.s; return [b.cx + sc * (c * dx - s * dy), b.cy + sc * (s * dx + c * dy)]; };

const fwd = trackRegion({ frames, w: W, h: H, start: 0, dir: 1, count: N - 1, region, mode: 'full' });
ok('forward: every frame tracked', fwd.length === N - 1, fwd.length);
const errAt = (r, k, p) => { const e = r.find((x) => x.i === k); if (!e) return Infinity; const q = applySim(e.T, p), t = truth(k, p); return Math.hypot(q[0] - t[0], q[1] - t[1]); };
const e1 = Math.max(...[10, 20, 29].map((k) => Math.max(errAt(fwd, k, [60, 60]), errAt(fwd, k, [40, 40]), errAt(fwd, k, [80, 80]))));
ok('forward: corners within 1.5 px (translation + rotation + scale)', e1 < 1.5, e1.toFixed(2));
const T29 = fwd.find((x) => x.i === 29).T; const sc = Math.hypot(T29.a, T29.b), rot = Math.atan2(T29.b, T29.a);
ok('forward: scale and rotation recovered', Math.abs(sc - pose(29).s) < 0.02 && Math.abs(rot - pose(29).r) < 0.02, `${sc.toFixed(3)} ${rot.toFixed(3)}`);
const pos = trackRegion({ frames, w: W, h: H, start: 0, dir: 1, count: 20, region, mode: 'position' });
const Tp = pos.find((x) => x.i === 20).T;
ok('Position mode: translation only', Tp.a === 1 && Tp.b === 0 && Math.abs(Tp.tx - 60) < 2.5 && Math.abs(Tp.ty - 24) < 2.5, JSON.stringify(Tp));
// backward from the last frame: region where the object is at frame 29
const reg29 = region.map((p) => truth(29, p));
const bwd = trackRegion({ frames, w: W, h: H, start: 29, dir: -1, count: 29, region: reg29, mode: 'full' });
const b0 = bwd.find((x) => x.i === 0); const back = b0 && applySim(b0.T, truth(29, [60, 60]));
ok('backward: returns to the start position', back && Math.hypot(back[0] - 60, back[1] - 60) < 1.5, JSON.stringify(back));
const one = trackRegion({ frames, w: W, h: H, start: 5, dir: 1, count: 1, region: region.map((p) => truth(5, p)), mode: 'full' });
ok('frame-by-frame: one step', one.length === 1 && one[0].i === 6);
// similarity helpers
const T = { a: 0.9, b: 0.3, tx: 5, ty: -2 }; const p = applySim(invertSim(T), applySim(T, [7, 3]));
ok('invertSim', Math.hypot(p[0] - 7, p[1] - 3) < 1e-9);
const P = [[0, 0], [10, 0], [0, 10], [10, 10], [5, 5]]; const Q = P.map((q) => applySim(T, q)); Q[4] = [100, 100]; // one outlier
const F = fitSimilarity(P, Q, 'full');
ok('fitSimilarity is robust to an outlier', Math.abs(F.a - 0.9) < 1e-6 && Math.abs(F.b - 0.3) < 1e-6 && Math.abs(F.tx - 5) < 1e-6, JSON.stringify(F));
// lost object: a frame of pure noise stops tracking
const lost = new Uint8Array(frames); for (let i = 10 * W * H; i < 11 * W * H; i++) lost[i] = (Math.random() * 255) | 0;
const lr = trackRegion({ frames: lost, w: W, h: H, start: 0, dir: 1, count: N - 1, region, mode: 'full' });
ok('stops when the object is lost', lr.length < 12, lr.length);
console.log(`tracker: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
