// Vector / scalar math helpers with After Effects expression semantics. Pure ES module.

export const isVec = (a) => Array.isArray(a);
const num = (x) => (typeof x === 'number' ? x : Number(x));

function lift2(a, b, f) {
  const va = isVec(a), vb = isVec(b);
  if (!va && !vb) return f(num(a), num(b));
  if (va && vb) {
    const n = Math.max(a.length, b.length), out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = f(i < a.length ? num(a[i]) : 0, i < b.length ? num(b[i]) : 0);
    return out;
  }
  if (va) return a.map((x) => f(num(x), num(b)));
  return b.map((y) => f(num(a), num(y)));
}

export const add = (a, b) => lift2(a, b, (x, y) => x + y);
export const sub = (a, b) => lift2(a, b, (x, y) => x - y);
export const mul = (a, b) => lift2(a, b, (x, y) => x * y);
export const div = (a, b) => lift2(a, b, (x, y) => x / y);
export const mod = (a, b) => lift2(a, b, (x, y) => x % y);

export function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
export function cross(a, b) {
  if (a.length === 2 && b.length === 2) return a[0] * b[1] - a[1] * b[0];
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function vlength(a, b) {
  if (b !== undefined) {
    if (!isVec(a)) return Math.abs(num(b) - num(a));
    return vlength(sub(a, b));
  }
  if (!isVec(a)) return Math.abs(num(a));
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}
export function normalize(a) {
  const l = vlength(a);
  return l === 0 ? a.map(() => 0) : a.map((x) => x / l);
}
export function clamp(v, lo, hi) {
  if (isVec(v)) return v.map((x, i) => clamp(x, isVec(lo) ? lo[i] : lo, isVec(hi) ? hi[i] : hi));
  return Math.min(Math.max(v, lo), hi);
}
export const degreesToRadians = (d) => (d * Math.PI) / 180;
export const radiansToDegrees = (r) => (r * 180) / Math.PI;

export function lookAt(from, at) {
  const f = [from[0], from[1], from[2] || 0], a = [at[0], at[1], at[2] || 0];
  const d = sub(a, f), len = vlength(d);
  if (len === 0) return [0, 0, 0];
  const ry = radiansToDegrees(Math.atan2(d[0], d[2]));
  const rx = radiansToDegrees(-Math.asin(d[1] / len));
  return [rx, ry, 0];
}

// ---- interpolation helpers ----
function lerpVal(t, v1, v2) {
  if (isVec(v1) || isVec(v2)) {
    const a = isVec(v1) ? v1 : null, b = isVec(v2) ? v2 : null;
    const n = Math.max(a ? a.length : 0, b ? b.length : 0), out = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = a ? a[i] : v1, y = b ? b[i] : v2;
      out[i] = x + (y - x) * t;
    }
    return out;
  }
  return v1 + (v2 - v1) * t;
}
function norm(t, t1, t2) {
  if (t1 === t2) return t >= t2 ? 1 : 0;
  return Math.min(1, Math.max(0, (t - t1) / (t2 - t1)));
}
function args5(a) {
  // (t, v1, v2) or (t, tMin, tMax, v1, v2)
  if (a.length < 5) return [a[0], 0, 1, a[1], a[2]];
  return a;
}
export function linear(...a) {
  const [t, t1, t2, v1, v2] = args5(a);
  // vector t (rare): per component
  if (isVec(t)) return t.map((tt, i) => linear(tt, t1, t2, isVec(v1) ? v1[i] : v1, isVec(v2) ? v2[i] : v2));
  return lerpVal(norm(t, t1, t2), v1, v2);
}
const easeCurve = (u) => u * u * (3 - 2 * u);
const easeInCurve = (u) => u * u * (2 - u);
const easeOutCurve = (u) => u + u * u - u * u * u;
const mkEase = (curve) => (...a) => {
  const [t, t1, t2, v1, v2] = args5(a);
  if (isVec(t)) return t.map((tt, i) => mkEase(curve)(tt, t1, t2, isVec(v1) ? v1[i] : v1, isVec(v2) ? v2[i] : v2));
  return lerpVal(curve(norm(t, t1, t2)), v1, v2);
};
export const ease = mkEase(easeCurve);
export const easeIn = mkEase(easeInCurve);
export const easeOut = mkEase(easeOutCurve);

// ---- PRNG ----
export function hashInts(...xs) {
  let h = 0x811c9dc5 | 0;
  for (const x of xs) {
    let v = Math.floor(Number(x) || 0) | 0;
    for (let k = 0; k < 4; k++) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      v >>>= 8;
    }
  }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export class Rng {
  constructor(seed) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next() { // mulberry32
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
export function randomRange(rng, a, b) {
  // random(), random(max), random(min,max), vector forms
  if (a === undefined) return rng.next();
  if (b === undefined) {
    if (isVec(a)) return a.map((x) => rng.next() * x);
    return rng.next() * a;
  }
  if (isVec(a) || isVec(b)) {
    const n = Math.max(isVec(a) ? a.length : 0, isVec(b) ? b.length : 0), out = [];
    for (let i = 0; i < n; i++) { const lo = isVec(a) ? a[i] : a, hi = isVec(b) ? b[i] : b; out.push(lo + rng.next() * (hi - lo)); }
    return out;
  }
  return a + rng.next() * (b - a);
}
function gauss1(rng) {
  let u = 0;
  while (u === 0) u = rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function gaussRandom(rng, a, b) {
  const g = () => 0.5 + gauss1(rng) * 0.3040; // ~90% of values in 0..1
  if (a === undefined) return g();
  if (b === undefined) return isVec(a) ? a.map((x) => g() * x) : g() * a;
  if (isVec(a) || isVec(b)) {
    const n = Math.max(isVec(a) ? a.length : 0, isVec(b) ? b.length : 0), out = [];
    for (let i = 0; i < n; i++) { const lo = isVec(a) ? a[i] : a, hi = isVec(b) ? b[i] : b; out.push(lo + g() * (hi - lo)); }
    return out;
  }
  return a + g() * (b - a);
}

// ---- Perlin noise ----
const PERM = (() => {
  const p = new Uint8Array(512), base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  const r = new Rng(1234567);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
export function perlin3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const p = PERM;
  const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
  const L = (a, b, t) => a + t * (b - a);
  return L(
    L(L(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), L(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
    L(L(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), L(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}
// AE noise(): range roughly -1..1
export function noise(v) {
  if (isVec(v)) {
    if (v.length === 1) return perlin3(v[0] + 0.31, 0.57, 0.113) * 1.6;
    if (v.length === 2) return perlin3(v[0] + 0.31, v[1] + 0.57, 0.113) * 1.4;
    return perlin3(v[0] + 0.31, v[1] + 0.57, v[2] + 0.113) * 1.3;
  }
  return perlin3(v + 0.31, 0.57, 0.113) * 1.6;
}

// ---- color ----
export function rgbToHsl(c) {
  const r = c[0], g = c[1], b = c[2], a = c.length > 3 ? c[3] : 1;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l, a];
}
export function hslToRgb(c) {
  const h = c[0], s = c[1], l = c[2], a = c.length > 3 ? c[3] : 1;
  if (s === 0) return [l, l, l, a];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3), a];
}

// ---- time ----
export function timeToFrames(t, fps, isDuration) {
  const x = t * fps;
  const r = isDuration ? Math.round(x) : Math.floor(x + 1e-6);
  return r;
}
export const framesToTime = (f, fps) => f / fps;
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
export function timeToTimecode(t, base = 30, isDuration = false) {
  const neg = t < 0; t = Math.abs(t);
  const total = Math.floor(t * base + 1e-6);
  const ff = total % base, secs = Math.floor(total / base);
  const s = secs % 60, m = Math.floor(secs / 60) % 60, h = Math.floor(secs / 3600);
  return (neg ? '-' : '') + `${h}:${pad2(m)}:${pad2(s)}:${pad2(ff)}`;
}
export function timeToFeetAndFrames(t, fps = 24, framesPerFoot = 16) {
  const total = Math.floor(t * fps + 1e-6);
  return `${Math.floor(total / framesPerFoot)}+${String(total % framesPerFoot).padStart(2, '0')}`;
}
