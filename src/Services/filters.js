// Filters (Create > Filters, CapCut style): one-click looks with an Intensity slider. Every look is our own colour math
// (no LUT copied from another product); it is baked into a 33³ 3D LUT on first use and applied by the compositor after
// Lumetri, so Preview and Export use the same texture. clip.filter = { id, intensity (0..100) }.
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const mixc = (a, b, k) => a + (b - a) * k;
const sat = ([r, g, b], k) => { const l = lum(r, g, b); return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k]; };
const contrast = (c, k, p = 0.5) => c.map((v) => (v - p) * k + p);
const scurve = (c, k) => c.map((v) => { const s = v * v * (3 - 2 * v); return mixc(v, s, k); });
const gain = (c, [r, g, b]) => [c[0] * r, c[1] * g, c[2] * b];
const lift = (c, [r, g, b]) => [c[0] + (1 - c[0]) * r, c[1] + (1 - c[1]) * g, c[2] + (1 - c[2]) * b];
const fade = (c, k) => c.map((v) => k + v * (1 - k)); // raised blacks
const gamma = (c, k) => c.map((v) => Math.pow(Math.max(0, v), k));
/** Shadows tinted towards sh, highlights towards hi (amounts 0..1). */
const split = (c, sh, hi, ks, kh) => { const l = lum(...c); const ws = (1 - l) * (1 - l) * ks, wh = l * l * kh; return c.map((v, i) => v + (sh[i] - 0.5) * ws + (hi[i] - 0.5) * wh); };
const mono = (c, w = [0.2126, 0.7152, 0.0722]) => { const l = c[0] * w[0] + c[1] * w[1] + c[2] * w[2]; return [l, l, l]; };
const sepia = (c) => { const l = lum(...c); return [l * 1.07 + 0.05, l * 0.95 + 0.02, l * 0.78]; };
const hueShift = ([r, g, b], deg) => { // rotate around the grey axis
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), k = 1 / 3, sq = Math.sqrt(k);
  const r2 = r * (cs + (1 - cs) * k) + g * ((1 - cs) * k - sq * sn) + b * ((1 - cs) * k + sq * sn);
  const g2 = r * ((1 - cs) * k + sq * sn) + g * (cs + (1 - cs) * k) + b * ((1 - cs) * k - sq * sn);
  const b2 = r * ((1 - cs) * k - sq * sn) + g * ((1 - cs) * k + sq * sn) + b * (cs + (1 - cs) * k);
  return [r2, g2, b2];
};
/** [id, name, category, look(rgb) -> rgb] */
const LOOKS = [
  // Cinematic
  ['teal-orange', 'Teal & Orange', 'Cinematic', (c) => scurve(split(sat(c, 1.1), [0.2, 0.55, 0.65], [0.75, 0.55, 0.35], 0.55, 0.45), 0.35)],
  ['blockbuster', 'Blockbuster', 'Cinematic', (c) => contrast(split(sat(c, 0.9), [0.25, 0.5, 0.6], [0.7, 0.6, 0.45], 0.5, 0.3), 1.2)],
  ['moody-blue', 'Moody Blue', 'Cinematic', (c) => gamma(gain(sat(c, 0.7), [0.9, 0.97, 1.08]), 1.15)],
  ['noir-contrast', 'Noir Contrast', 'Cinematic', (c) => scurve(sat(c, 0.35), 0.9)],
  ['desert-gold', 'Desert Gold', 'Cinematic', (c) => scurve(gain(sat(c, 0.85), [1.1, 1.0, 0.8]), 0.3)],
  ['night-city', 'Night City', 'Cinematic', (c) => split(contrast(sat(c, 1.2), 1.1), [0.35, 0.3, 0.75], [0.8, 0.45, 0.7], 0.6, 0.35)],
  // Vintage
  ['vintage-fade', 'Vintage Fade', 'Vintage', (c) => fade(gain(sat(c, 0.7), [1.06, 1.0, 0.88]), 0.1)],
  ['retro-70s', 'Retro 70s', 'Vintage', (c) => fade(split(sat(c, 0.8), [0.55, 0.45, 0.3], [0.75, 0.6, 0.35], 0.4, 0.4), 0.06)],
  ['polaroid', 'Instant Photo', 'Vintage', (c) => fade(contrast(gain(sat(c, 0.85), [1.04, 1.02, 0.92]), 0.9), 0.08)],
  ['sepia', 'Sepia', 'Vintage', (c) => fade(sepia(c), 0.04)],
  ['faded-film', 'Faded Film', 'Vintage', (c) => fade(contrast(sat(c, 0.75), 0.85), 0.12)],
  ['old-postcard', 'Old Postcard', 'Vintage', (c) => fade(mixc3(sepia(c), sat(c, 0.6), 0.5), 0.1)],
  // Film
  ['film-warm', 'Film Warm', 'Film', (c) => scurve(lift(gain(c, [1.06, 1.0, 0.9]), [0.03, 0.02, 0.0]), 0.3)],
  ['film-cool', 'Film Cool', 'Film', (c) => scurve(lift(gain(c, [0.94, 1.0, 1.06]), [0.0, 0.02, 0.04]), 0.3)],
  ['slide-film', 'Slide Film', 'Film', (c) => scurve(sat(c, 1.35), 0.45)],
  ['cross-process', 'Cross Process', 'Film', (c) => [Math.pow(clamp(c[0]), 0.8), Math.pow(clamp(c[1]), 0.9) * 1.05, clamp(c[2]) * 0.75 + 0.12]],
  ['bleach-bypass', 'Bleach Bypass', 'Film', (c) => { const m = mono(c); const s = scurve(m, 1); return contrast(c.map((v, i) => mixc(v, v * s[i] * 1.6, 0.6)), 1.1); }],
  ['pastel-film', 'Pastel Film', 'Film', (c) => fade(sat(gamma(c, 0.85), 0.7), 0.08)],
  // Black & White
  ['mono-classic', 'Mono Classic', 'B&W', (c) => mono(c)],
  ['mono-high', 'Mono High Contrast', 'B&W', (c) => scurve(contrast(mono(c), 1.3), 0.6)],
  ['mono-soft', 'Mono Soft', 'B&W', (c) => fade(mono(c), 0.08)],
  ['mono-red', 'Mono Red Filter', 'B&W', (c) => mono(c, [0.75, 0.25, 0.0])],
  // Food
  ['fresh-food', 'Fresh Food', 'Food', (c) => scurve(gain(sat(c, 1.25), [1.03, 1.03, 0.97]), 0.2)],
  ['warm-bakery', 'Warm Bakery', 'Food', (c) => gamma(gain(sat(c, 1.1), [1.08, 1.0, 0.86]), 0.92)],
  ['vivid-fruit', 'Vivid Fruit', 'Food', (c) => scurve(sat(c, 1.5), 0.3)],
  // Portrait
  ['soft-skin', 'Soft Skin', 'Portrait', (c) => fade(gamma(gain(sat(c, 0.92), [1.03, 1.0, 0.98]), 0.9), 0.04)],
  ['rosy', 'Rosy', 'Portrait', (c) => gamma(gain(c, [1.06, 0.97, 1.0]), 0.95)],
  ['golden-hour', 'Golden Hour', 'Portrait', (c) => split(gain(sat(c, 1.05), [1.08, 1.0, 0.85]), [0.55, 0.45, 0.4], [0.8, 0.6, 0.3], 0.2, 0.4)],
  ['clean-portrait', 'Clean Portrait', 'Portrait', (c) => gamma(scurve(sat(c, 0.95), 0.15), 0.94)],
  // Lifestyle / landscape
  ['vivid-landscape', 'Vivid Landscape', 'Lifestyle', (c) => scurve(sat(c, 1.35), 0.35)],
  ['forest-green', 'Forest Green', 'Lifestyle', (c) => split(sat(c, 1.05), [0.35, 0.5, 0.4], [0.55, 0.65, 0.45], 0.4, 0.3)],
  ['ocean-blue', 'Ocean Blue', 'Lifestyle', (c) => gain(sat(c, 1.15), [0.92, 1.0, 1.1])],
  ['cyberpunk', 'Cyberpunk', 'Lifestyle', (c) => split(contrast(sat(hueShift(c, -12), 1.3), 1.15), [0.3, 0.35, 0.8], [0.9, 0.35, 0.75], 0.6, 0.45)],
  ['matte-lifestyle', 'Matte Lifestyle', 'Lifestyle', (c) => fade(contrast(sat(c, 0.9), 0.92), 0.07)],
  ['summer-bright', 'Summer Bright', 'Lifestyle', (c) => gamma(gain(sat(c, 1.2), [1.04, 1.02, 0.96]), 0.85)],
].map(([id, name, category, f]) => ({ id, name, category, f }));
function mixc3(a, b, k) { return a.map((v, i) => mixc(v, b[i], k)); }

export const FILTERS = LOOKS.map(({ id, name, category }) => ({ id, name, category }));
export const FILTER_CATEGORIES = [...new Set(LOOKS.map((l) => l.category))];
export const filterById = (id) => LOOKS.find((l) => l.id === id);
/** Apply a look to one colour (0..1) at intensity k (0..1). Used for thumbnails and tests (same math as the LUT). */
export function applyLook(id, rgb, k = 1) { const L = filterById(id); if (!L) return rgb; const o = L.f([...rgb]); return rgb.map((v, i) => clamp(mixc(v, clamp(o[i]), k))); }

const N = 33; const luts = new Map();
/** The look as a 3D LUT in the compositor's texture layout (x = blue * N + red, y = green). */
export function filterLut(id) {
  if (luts.has(id)) return luts.get(id); const L = filterById(id); if (!L) return null;
  const data = new Uint8Array(N * N * N * 4);
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const o = L.f([r / (N - 1), g / (N - 1), b / (N - 1)]); const i = (g * N * N + b * N + r) * 4;
    data[i] = Math.round(clamp(o[0]) * 255); data[i + 1] = Math.round(clamp(o[1]) * 255); data[i + 2] = Math.round(clamp(o[2]) * 255); data[i + 3] = 255;
  }
  const lut = { N, data }; luts.set(id, lut); return lut;
}
