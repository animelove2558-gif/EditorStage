// Lumetri automatic color: Auto Tone, Auto Color (white balance) and Color Match (to a reference frame, optionally weighting
// skin tones). Results are ordinary Lumetri slider values (exposure, contrast, temperature, tint, saturation), fitted against
// a CPU model of the same Basic Correction math the shader runs, so the sliders stay editable and preview = export.

/** sRGB 0..1 -> CIE Lab (D65). */
export function rgbToLab(r, g, b) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** Skin-tone classifier (YCbCr box widely used for skin detection). */
export const isSkin = (r, g, b) => { const cb = 128 - 37.797 * r - 74.203 * g + 112 * b, cr = 128 + 112 * r - 93.786 * g - 18.214 * b; return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && r > g && r > b; };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
/** CPU model of the Lumetri Basic Correction + wheel gains (same order as LUMETRI_BODY). p: { exposure, temperature, tint, highlights, shadows, whites, blacks, contrast, gainR/G/B, saturation }. */
export function simulate(px, p) {
  const out = new Float32Array(px.length); const ex = Math.pow(2, p.exposure || 0), k = 1 + (p.contrast || 0) / 100, sat = (p.saturation ?? 100) / 100;
  for (let i = 0; i < px.length; i += 3) {
    let r = px[i] * ex + (p.temperature || 0) / 400, g = px[i + 1] * ex + (p.tint || 0) / 400, b = px[i + 2] * ex - (p.temperature || 0) / 400;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; const tone = ((p.highlights || 0) / 200) * sstep(0.5, 1, l) + ((p.shadows || 0) / 200) * (1 - sstep(0, 0.5, l)) + ((p.whites || 0) / 300) * sstep(0.75, 1, l) + ((p.blacks || 0) / 300) * (1 - sstep(0, 0.25, l));
    r += tone; g += tone; b += tone;
    // contrast, then Color Wheels gain (multiplicative per channel); the shader clamps only before the saturation step
    r = clamp01(Math.max(0, (r - 0.5) * k + 0.5) * (1 + (p.gainR || 0) / 200)); g = clamp01(Math.max(0, (g - 0.5) * k + 0.5) * (1 + (p.gainG || 0) / 200)); b = clamp01(Math.max(0, (b - 0.5) * k + 0.5) * (1 + (p.gainB || 0) / 200));
    if (sat !== 1) { const v = Math.max(r, g, b), mn = Math.min(r, g, b), s = v > 1e-10 ? (v - mn) / v : 0; const f = s > 0 ? Math.min(sat, 1 / s) : sat; r = v - (v - r) * f; g = v - (v - g) * f; b = v - (v - b) * f; }
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
  return out;
}
/** Lab statistics of RGB pixels (Float 0..1, packed rgb). sel: optional per-pixel boolean array. */
export function labStats(px, sel = null) {
  let n = 0, sL = 0, sL2 = 0, sa = 0, sb = 0, sC = 0; const Ls = [];
  for (let i = 0, j = 0; i < px.length; i += 3, j++) {
    if (sel && !sel[j]) continue;
    const [L, a, b] = rgbToLab(px[i], px[i + 1], px[i + 2]); n++; sL += L; sL2 += L * L; sa += a; sb += b; sC += Math.hypot(a, b); Ls.push(L);
  }
  if (!n) return null;
  Ls.sort((x, y) => x - y); const pc = (q) => Ls[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  const mL = sL / n;
  return { n, L: mL, Lsd: Math.sqrt(Math.max(0, sL2 / n - mL * mL)), a: sa / n, b: sb / n, C: sC / n, p01: pc(0.01), p50: pc(0.5), p99: pc(0.99) };
}
/** Coordinate descent over named parameters with ranges: minimises cost(params). */
function fit(cost, start, ranges, iters = 40) {
  const p = { ...start }; let best = cost(p);
  const step = Object.fromEntries(Object.entries(ranges).map(([k, [lo, hi]]) => [k, (hi - lo) / 8]));
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (const [k, [lo, hi]] of Object.entries(ranges)) {
      for (const d of [step[k], -step[k]]) {
        const q = { ...p, [k]: Math.min(hi, Math.max(lo, p[k] + d)) }; const c = cost(q);
        if (c < best - 1e-9) { best = c; Object.assign(p, q); moved = true; break; }
      }
    }
    if (!moved) { let small = true; for (const k of Object.keys(step)) { step[k] /= 2; if (step[k] > 1e-3) small = false; } if (small) break; }
  }
  for (const k of Object.keys(ranges)) p[k] = Math.round(p[k] * 100) / 100;
  return p;
}
const BASE = { exposure: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, contrast: 0, gainR: 0, gainG: 0, gainB: 0, saturation: 100 };

/** Auto Tone: exposure, contrast, whites and blacks so that the 1st / 99th luminance percentiles land near black / white and mid-tones sit mid-gray. */
export function autoTone(px) {
  return fit((p) => { const s = labStats(simulate(px, { ...BASE, ...p })); return (s.p01 - 3) ** 2 + (s.p99 - 96) ** 2 + 0.3 * (s.p50 - 50) ** 2; },
    { exposure: 0, contrast: 0, whites: 0, blacks: 0 }, { exposure: [-3, 3], contrast: [-60, 100], whites: [-100, 100], blacks: [-100, 100] });
}
/** Auto Color: temperature + tint so near-neutral pixels average to gray (gray world on low-chroma pixels). */
export function autoColor(px, tone = {}) {
  const src = labStats(px); const sel = []; for (let i = 0; i < px.length; i += 3) { const [, a, b] = rgbToLab(px[i], px[i + 1], px[i + 2]); sel.push(Math.hypot(a, b) < Math.max(12, src.C * 1.2)); }
  return fit((p) => { const s = labStats(simulate(px, { ...BASE, ...tone, ...p }), sel); return s ? s.a ** 2 + s.b ** 2 : 0; },
    { temperature: 0, tint: 0 }, { temperature: [-100, 100], tint: [-100, 100] });
}
/**
 * Color Match: Basic Correction + highlight wheel (gain) values that give the target frame the reference frame's Lab statistics.
 * faces: match the skin-tone pixels' color (when both frames show enough skin) instead of the whole-frame average.
 */
export function colorMatch(target, reference, { faces = true } = {}) {
  const R = labStats(reference); const skin = (px) => { const s = []; for (let i = 0; i < px.length; i += 3) s.push(isSkin(px[i], px[i + 1], px[i + 2])); return s; };
  let tSel = null, rSkin = null;
  if (faces) { const ts = skin(target), rs = skin(reference); const share = (s) => s.filter(Boolean).length / s.length; if (share(ts) > 0.02 && share(rs) > 0.02) { tSel = ts; rSkin = labStats(reference, rs); } }
  const p = fit((q) => {
    const sim = simulate(target, { ...BASE, ...q }); const s = labStats(sim);
    let c = (s.L - R.L) ** 2 + (s.Lsd - R.Lsd) ** 2 + 0.25 * ((s.p01 - R.p01) ** 2 + (s.p99 - R.p99) ** 2) + 0.5 * (s.C - R.C) ** 2;
    if (rSkin) { const k = labStats(sim, tSel); c += 2 * ((k.a - rSkin.a) ** 2 + (k.b - rSkin.b) ** 2) + (s.a - R.a) ** 2 + (s.b - R.b) ** 2; }
    else c += (s.a - R.a) ** 2 + (s.b - R.b) ** 2;
    return c;
  }, { exposure: 0, contrast: 0, gainR: 0, gainG: 0, gainB: 0, saturation: 100 }, { exposure: [-3, 3], contrast: [-60, 100], gainR: [-100, 100], gainG: [-100, 100], gainB: [-100, 100], saturation: [0, 200] }, 80);
  return { ...p, usedSkin: !!rSkin };
}
/** ImageData (RGBA 0..255) -> packed Float32 rgb 0..1. */
export const toRgb = (img) => { const d = img.data; const out = new Float32Array((d.length / 4) * 3); for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { out[j] = d[i] / 255; out[j + 1] = d[i + 1] / 255; out[j + 2] = d[i + 2] / 255; } return out; };
