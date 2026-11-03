// Color tests: Lab conversion, Auto Tone, Auto Color, Color Match (whole frame and skin tones). Run: node scripts/test_color.mjs
import { rgbToLab, simulate, labStats, autoTone, autoColor, colorMatch, matchCurves } from '../src/Services/colorMatch.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const near = (a, b, t) => Math.abs(a - b) <= t;
const W = 64, H = 36;
const rnd = (i) => { const v = Math.sin(i * 12.9898) * 43758.5453; return v - Math.floor(v); };
/** a "scene": gradient + texture + a skin-colored patch */
function scene(fn) {
  const px = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3; let r, g, b;
    if (x > 40 && x < 56 && y > 8 && y < 28) { r = 0.85; g = 0.62; b = 0.5; } // skin
    else { const l = 0.1 + 0.8 * (x / W) * (0.6 + 0.4 * rnd(y * W + x)); r = l * (0.8 + 0.4 * (y / H)); g = l; b = l * (1.2 - 0.4 * (y / H)); }
    [r, g, b] = fn([Math.min(1, r), Math.min(1, g), Math.min(1, b)]); px[i] = r; px[i + 1] = g; px[i + 2] = b;
  }
  return px;
}
const id = (c) => c;
// Lab reference values
const w = rgbToLab(1, 1, 1), k = rgbToLab(0, 0, 0), red = rgbToLab(1, 0, 0);
ok('Lab white / black / red', near(w[0], 100, 0.1) && near(w[1], 0, 0.1) && near(w[2], 0, 0.1) && near(k[0], 0, 0.01) && near(red[0], 53.24, 0.1) && near(red[1], 80.09, 0.2) && near(red[2], 67.2, 0.2), JSON.stringify([w, red]));
// simulate: identity and saturation 0 -> gray
const ref = scene(id);
const same = simulate(ref, { exposure: 0, temperature: 0, tint: 0, contrast: 0, saturation: 100 });
ok('simulate: neutral settings change nothing', same.every((v, i) => near(v, ref[i], 1e-6)));
const gray = simulate(ref, { saturation: 0 }); ok('simulate: saturation 0 is gray', gray.every((v, i) => i % 3 || (near(v, gray[i + 1], 1e-6) && near(v, gray[i + 2], 1e-6))));
// Auto Tone: a dark, flat version gets its range back
const flat = scene(([r, g, b]) => [0.2 + r * 0.3, 0.2 + g * 0.3, 0.2 + b * 0.3]);
const t = autoTone(flat); const before = labStats(flat), after = labStats(simulate(flat, { ...t }));
ok('Auto Tone stretches a flat image', after.p99 - after.p01 > (before.p99 - before.p01) * 2.5 && after.p01 < before.p01 && after.p99 > 80, JSON.stringify({ t, b: [before.p01, before.p99], a: [after.p01, after.p99] }));
// Auto Color: a blue cast is removed
const cast = scene(([r, g, b]) => [r * 0.85, g * 0.95, Math.min(1, b * 1.15 + 0.05)]);
const ac = autoColor(cast); const sC = labStats(cast), sA = labStats(simulate(cast, ac));
ok('Auto Color moves toward neutral (blue cast: temperature up)', ac.temperature > 5 && Math.hypot(sA.a, sA.b) < Math.hypot(sC.a, sC.b) * 0.6, JSON.stringify({ ac, before: [sC.a, sC.b], after: [sA.a, sA.b] }));
// Color Match: darker + warm target -> reference statistics
const tgt = scene(([r, g, b]) => [Math.min(1, r * 0.7 + 0.06), g * 0.68, b * 0.55]);
const R = labStats(ref);
const cm = colorMatch(tgt, ref, { faces: false }); const M = labStats(simulate(tgt, cm)), T0 = labStats(tgt);
ok('Color Match: brightness matches', Math.abs(M.L - R.L) < 2 && Math.abs(T0.L - R.L) > 5, JSON.stringify({ ref: R.L, before: T0.L, after: M.L }));
ok('Color Match: color balance matches', Math.hypot(M.a - R.a, M.b - R.b) < Math.hypot(T0.a - R.a, T0.b - R.b) * 0.35, JSON.stringify({ ref: [R.a, R.b], before: [T0.a, T0.b], after: [M.a, M.b] }));
const cmf = colorMatch(tgt, ref, { faces: true });
ok('Color Match with Face Detection uses the skin tones', cmf.usedSkin === true);
// ---- D7: Color Match with RGB Curves, face model regions ----
const ident = { master: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]], hs: [[0, 0.5], [1, 0.5]] };
const a0 = simulate(ref, {}), a1 = simulate(ref, { curves: ident });
ok('identity curves change nothing in the CPU model', a0.every((v, i) => Math.abs(v - a1[i]) < 2 / 255));
const mc = matchCurves(tgt, ref);
ok('matched curves are increasing', ['r', 'g', 'b'].every((k) => mc[k].every((p, i) => i === 0 || (p[0] > mc[k][i - 1][0] && p[1] >= mc[k][i - 1][1]))), JSON.stringify(mc.r));
const chanMean = (px, o) => { let s = 0; for (let i = o; i < px.length; i += 3) s += px[i]; return s / (px.length / 3); };
const err = (px) => [0, 1, 2].reduce((s, o) => s + Math.abs(chanMean(px, o) - chanMean(ref, o)), 0);
const cc = colorMatch(tgt, ref, { faces: false, curves: true });
const matched = simulate(tgt, { exposure: 0, contrast: 0, ...cc });
ok('Color Match with curves writes RGB curves', !!cc.curves && cc.curves.r.length > 2);
ok('...and brings each channel close to the reference', err(matched) < err(tgt) * 0.3, JSON.stringify({ before: err(tgt), after: err(matched) }));
const none = new Array(W * H).fill(false);
const cfm = colorMatch(tgt, ref, { faces: true, faceBoxes: { target: none, reference: none } });
ok('a face model that finds the face elsewhere keeps background skin-like pixels out', cfm.usedSkin === false);
const box = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) box.push(x > 38 && x < 58 && y > 6 && y < 30);
const cfb = colorMatch(tgt, ref, { faces: true, faceBoxes: { target: box, reference: box } });
ok('...and the skin inside the detected faces is matched', cfb.usedSkin === true && cfb.usedFaceModel === true);

console.log(`color: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
