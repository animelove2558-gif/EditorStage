// 3D LUT loader/cache: .cube (Adobe/Resolve) and .3dl (Autodesk/Lustre)
const cache = new Map(); // path -> { N, data(Uint8Array RGBA of N*N x N) } | 'loading' | 'error'
export function parseCube(text) {
  let N = 0; const vals = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim(); if (!s || s[0] === '#' || /^(TITLE|DOMAIN)/i.test(s)) continue;
    if (/^LUT_3D_SIZE/i.test(s)) { N = parseInt(s.split(/\s+/)[1], 10); continue; }
    if (/^LUT_1D_SIZE/i.test(s)) throw new Error('1D LUTs are not supported');
    const p = s.split(/\s+/).map(Number); if (p.length === 3 && p.every(Number.isFinite)) vals.push(p);
  }
  if (!N || vals.length !== N * N * N) throw new Error('Invalid .cube file');
  const data = new Uint8Array(N * N * N * 4);
  // .cube order: red fastest, then green, then blue. Texture layout: x = blue*N + red, y = green.
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const v = vals[b * N * N + g * N + r]; const o = (g * N * N + b * N + r) * 4;
    data[o] = v[0] * 255; data[o + 1] = v[1] * 255; data[o + 2] = v[2] * 255; data[o + 3] = 255;
  }
  return { N, data };
}
/** .3dl: optional input mesh line, then N^3 integer RGB rows (blue fastest, then green, red slowest); output bit depth from the largest value. */
export function parse3dl(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim(); if (!s || s[0] === '#' || /^[A-Za-z]/.test(s)) continue;
    const p = s.split(/\s+/).map(Number); if (p.every(Number.isFinite)) rows.push(p);
  }
  let start = 0; if (rows.length && rows[0].length > 3) start = 1; // mesh line ("0 64 128 ... 1023")
  const vals = rows.slice(start).filter((r) => r.length === 3); const N = Math.round(Math.cbrt(vals.length));
  if (N < 2 || N * N * N !== vals.length) throw new Error('Invalid .3dl file');
  const mx = Math.max(...vals.map((v) => Math.max(...v))); const scale = mx > 4095 ? 65535 : mx > 1023 ? 4095 : 1023;
  const data = new Uint8Array(N * N * N * 4);
  for (let r = 0; r < N; r++) for (let g = 0; g < N; g++) for (let b = 0; b < N; b++) {
    const v = vals[r * N * N + g * N + b]; const o = (g * N * N + b * N + r) * 4;
    data[o] = Math.round((v[0] / scale) * 255); data[o + 1] = Math.round((v[1] / scale) * 255); data[o + 2] = Math.round((v[2] / scale) * 255); data[o + 3] = 255;
  }
  return { N, data };
}
export const parseLut = (path, text) => (/\.3dl$/i.test(path) ? parse3dl(text) : parseCube(text));
const pending = new Map(); // path -> Promise
/** Load (once) and resolve when the LUT is ready; export awaits this so the first frames are graded too. */
export function loadLut(path) {
  if (!pending.has(path)) {
    cache.set(path, 'loading');
    pending.set(path, window.editorstage.readText(path).then((t) => { const l = parseLut(path, t); cache.set(path, l); return l; }).catch((e) => { cache.set(path, 'error'); throw e; }));
    pending.get(path).catch(() => {});
  }
  return pending.get(path);
}
export function getLut(path) {
  const c = cache.get(path);
  if (c && c !== 'loading' && c !== 'error') return c;
  if (!c) loadLut(path);
  return null;
}
export const lutStatus = (path) => { const c = cache.get(path); return c === 'error' ? 'error' : c === 'loading' || !c ? 'loading' : 'ready'; };
