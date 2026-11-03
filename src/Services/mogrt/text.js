// Text layout + painting for evaluated After Effects text layers: per-run character styles, paragraph styles, box text,
// text animators (range / wiggly / expression selectors, every animator property), Fill & Stroke order, and path text.
import { graphemes, isSpace } from './textUnits';

const FALLBACK = `"Noto Sans Thai", "Leelawadee UI", "Segoe UI", "Arial", sans-serif`;
const wseg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const rgb = (c, a = 1) => `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)},${clamp01(a)})`;
/** AE horizontalScale arrives as a ratio (1 = 100%) from the reader, but accept percent too */
const ratio = (v) => { const x = v ?? 1; return x > 5 ? x / 100 : x; };

export function cssFont(doc, sizePx) {
  const style = String(doc.fontStyle || '');
  const bold = /bold|black|heavy/i.test(style) || doc.fauxBold; const italic = /italic|oblique/i.test(style) || doc.fauxItalic;
  // AE stores the PostScript name (doc.font); registerTemplateFonts() aliases it as a CSS family, so try it first
  const ps = String(doc.font || '');
  const families = [...new Set([doc.fontFamily, ps, ps.replace(/[-_].*$/, '')].filter(Boolean))];
  return `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${sizePx}px ${families.map((f) => `"${f}", `).join('')}${FALLBACK}`;
}

const normFont = (s) => String(s || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
/**
 * Make the template's fonts resolvable by their PostScript names (what text documents reference):
 * embedded font files are registered under the matching PostScript name (and their file name), installed fonts via
 * local("<PostScript name>"). Returns the names that could not be resolved (missing fonts).
 */
export async function registerTemplateFonts(usedFonts, embedded = []) {
  const missing = [];
  const add = async (family, src) => { const ff = new FontFace(family, src); await ff.load(); document.fonts.add(ff); };
  for (const f of embedded) { try { await add(f.name.replace(/\.[^.]+$/, ''), f.data); } catch { /* unsupported font file */ } }
  for (const ps of usedFonts || []) {
    const file = embedded.find((f) => normFont(f.name) === normFont(ps));
    try { await add(ps, file ? file.data : `local("${ps.replace(/"/g, '')}")`); } catch { missing.push(ps); }
  }
  return missing;
}

// ------------------------------------------------------------------ layout
/** style of the character at UTF-16 offset `off` (doc-wide values overridden by its style run) */
function styleAt(doc, off) {
  const r = doc.styleRuns && doc.styleRuns.find((x) => off >= x.start && off < x.end);
  if (!r) return doc;
  const s = { ...doc }; for (const [k, v] of Object.entries(r)) if (k !== 'start' && k !== 'end' && v !== null && v !== undefined) s[k] = v;
  return s;
}
const paraAt = (doc, off) => { const r = doc.paraRuns && doc.paraRuns.find((x) => off >= x.start && off < x.end); return r ? { ...doc, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== undefined)) } : doc; };

/**
 * Lines of glyph units: { units:[{text, w, size, style, space, char, charNoSpace, word, x}], width, para, ascent }.
 * Unit indices follow textUnits() (line breaks excluded) so selectors and expression selectors agree.
 */
export function layoutText(ctx, doc) {
  const raw = String(doc.text ?? '');
  const boxW = doc.boxText && doc.boxTextSize ? doc.boxTextSize[0] : 0;
  const lines = []; let off = 0, ch = 0, chNs = 0, word = -1;
  const paras = raw.split(/\r\n|\r|\n|\u0003/);
  const fontCache = new Map(); const measure = (st, g) => { const f = cssFont(st, st.fontSize || 40); if (ctx.font !== f) ctx.font = f; return ctx.measureText(g).width; };
  for (let pi = 0; pi < paras.length; pi++) {
    const para = paras[pi]; const pst = paraAt(doc, off);
    const indentL = (pst.startIndent || 0), indentR = (pst.endIndent || 0), first = pst.firstLineIndent || 0;
    const segs = wseg && boxW ? [...wseg.segment(para)].map((x) => x.segment) : [para];
    let cur = [], curW = 0, inWord = false; let lineFirst = true;
    const avail = () => (boxW ? boxW - indentL - indentR - (lineFirst ? first : 0) : Infinity);
    const push = () => { lines.push({ units: cur, width: curW, para: pst, paraIndex: pi, firstInPara: lineFirst }); cur = []; curW = 0; lineFirst = false; };
    let segOff = off;
    for (const sgm of segs) {
      const units = [];
      let u16 = segOff;
      for (const g of graphemes(sgm)) {
        const st = styleAt(doc, u16); u16 += g.length;
        const sp = isSpace(g); if (!sp && !inWord) { word++; inWord = true; } else if (sp) inWord = false;
        const size = st.fontSize || 40; const t = st.allCaps ? g.toUpperCase() : st.smallCaps && g !== g.toUpperCase() ? g.toUpperCase() : g;
        const key = cssFont(st, size) + '\u0000' + t; let w = fontCache.get(key); if (w === undefined) { w = measure(st, t); fontCache.set(key, w); }
        const scaleSc = st.smallCaps && g !== g.toUpperCase() ? 0.7 : 1;
        const track = ((st.tracking || 0) / 1000) * size;
        units.push({ text: t, w: w * ratio(st.horizontalScale) * scaleSc + track, track, size: size * scaleSc, style: st, space: sp, word: Math.max(0, word), off: u16 - g.length });
      }
      segOff = u16;
      const wW = units.reduce((s, u) => s + u.w, 0);
      if (boxW && curW + wW > avail() && cur.length) {
        // drop trailing spaces of the broken line from its width
        push();
        for (const u of units) { if (!u.space) break; u.w = 0; } // leading spaces of a wrapped line take no room (kept for unit indices)
      }
      // a single word longer than the box breaks by character
      if (boxW && wW > avail()) { for (const u of units) { if (curW + u.w > avail() && cur.length) push(); cur.push(u); curW += u.w; } }
      else { cur.push(...units); curW += units.reduce((s, u) => s + u.w, 0); }
    }
    push();
    off += para.length + 1;
  }
  for (const l of lines) {
    let w = l.width; for (let i = l.units.length - 1; i >= 0 && l.units[i].space; i--) w -= l.units[i].w; // trailing spaces do not count for alignment
    if (l.units.length) w -= l.units[l.units.length - 1].track || 0;
    l.alignWidth = w;
    for (const u of l.units) { u.char = ch++; u.charNoSpace = u.space ? -1 : chNs++; }
    l.maxSize = Math.max(...l.units.map((u) => u.size), doc.fontSize || 40);
  }
  return { lines, counts: { characters: ch, charactersExcludingSpaces: chNs, words: word + 1, lines: lines.length } };
}

// ------------------------------------------------------------------ selectors
function easeShape(x, hi, lo) { // AE Ease High / Ease Low (percent) on the selector ramp
  if (!hi && !lo) return x; const h = (hi || 0) / 100, l = (lo || 0) / 100;
  const a = x * x * (3 - 2 * x); return x + (a - x) * ((x > 0.5 ? h : l) * 1);
}
function rangeCoverage(sel, j, n) {
  const idx = sel.units === 'index';
  let s = sel.start ?? 0, e = sel.end ?? (idx ? n : 100); const off = sel.offset ?? 0;
  if (idx) { s = (s + off) / n; e = (e + off) / n; } else { s = (s + off) / 100; e = (e + off) / 100; }
  if (s > e) [s, e] = [e, s];
  const u0 = j / n, u1 = (j + 1) / n, x = (j + 0.5) / n;
  const shape = String(sel.shape || 'square').toLowerCase();
  let f;
  if (shape === 'square') {
    const ov = Math.max(0, Math.min(u1, e) - Math.max(u0, s)); f = Math.min(1, ov * n);
    const sm = (sel.smoothness ?? 100) / 100; if (sm < 1) f = f >= 1 - 1e-9 ? 1 : f * sm < 0.5 ? 0 : 1;
  } else {
    if (e - s < 1e-9) return 0;
    const u = (x - s) / (e - s);
    if (shape === 'rampup') f = u <= 0 ? 0 : u >= 1 ? 1 : u;
    else if (shape === 'rampdown') f = u <= 0 ? 1 : u >= 1 ? 0 : 1 - u;
    else if (u < 0 || u > 1) f = 0;
    else if (shape === 'triangle') f = 1 - Math.abs(2 * u - 1);
    else if (shape === 'round') f = Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
    else { const tt = 1 - Math.abs(2 * u - 1); f = tt * tt * (3 - 2 * tt); }
  }
  f = easeShape(f, sel.easeHigh, sel.easeLow);
  return f * ((sel.amount ?? 100) / 100);
}
const hash1 = (x) => { const r = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return r - Math.floor(r); };
const noise1 = (x, seed) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i + seed * 17.13) * (1 - u) + hash1(i + 1 + seed * 17.13) * u; };
function wigglyValue(sel, j, n, dim) {
  const tt = (sel.time || 0) * (sel.wigglesPerSecond ?? 2) + (sel.temporalPhase || 0) / 360;
  const corr = (sel.correlation ?? 50) / 100; const sp = (sel.spatialPhase || 0) / 360;
  const v = noise1(tt + j * (1 - corr) * 2.3 + sp + (sel.lockDimensions ? 0 : dim * 31.7), (sel.randomSeed || 0) + 1) * 2 - 1;
  const lo = (sel.minAmount ?? -100) / 100, hi = (sel.maxAmount ?? 100) / 100;
  return lo + ((v + 1) / 2) * (hi - lo);
}
function combine(mode, a, b) {
  switch (String(mode || 'add').toLowerCase()) {
    case 'subtract': return a - b;
    case 'intersect': return a * b; case 'min': return Math.min(a, b); case 'max': return Math.max(a, b);
    case 'difference': return Math.abs(a - b);
    default: return a + b;
  }
}
const unitIndex = (u, basedOn, lineIdx) => (basedOn === 'words' ? u.word : basedOn === 'lines' ? lineIdx : basedOn === 'charactersExcludingSpaces' ? u.charNoSpace : u.char);
const countFor = (counts, basedOn) => (basedOn === 'words' ? counts.words : basedOn === 'lines' ? counts.lines : basedOn === 'charactersExcludingSpaces' ? counts.charactersExcludingSpaces : counts.characters);

function randomOrder(n, seed) { const a = Array.from({ length: n }, (_, i) => i); let s = (seed * 9301 + 49297) % 233280 || 7; for (let i = n - 1; i > 0; i--) { s = (s * 16807) % 2147483647; const k = s % (i + 1); [a[i], a[k]] = [a[k], a[i]]; } return a; }

/** selector amount (-1..1, per dimension 0..2) of an animator for one unit */
function animatorAmount(an, u, lineIdx, counts, dim, cache) {
  let amt = 0; let first = true;
  for (const sel of an.selectors || []) {
    const basedOn = sel.basedOn || 'characters'; const n = Math.max(1, countFor(counts, basedOn));
    let j = unitIndex(u, basedOn, lineIdx); let c;
    if (j < 0) { c = 0; } // spaces with "excluding spaces"
    else if (sel.type === 'range') {
      if (sel.randomize) { const key = 'ro' + n + ':' + sel.randomSeed; if (!cache[key]) cache[key] = randomOrder(n, sel.randomSeed || 0); j = cache[key][j]; }
      c = rangeCoverage(sel, j, n);
    } else if (sel.type === 'wiggly') c = wigglyValue(sel, j, n, dim);
    else if (sel.type === 'expression') c = (sel.amounts?.[j] ?? 100) / 100;
    else c = 1;
    const m = String(sel.mode || 'add').toLowerCase();
    if (first) { amt = combine(m, m === 'subtract' || m === 'intersect' || m === 'min' ? 1 : 0, c); first = false; } else amt = combine(m, amt, c);
  }
  if (first) amt = 1;
  return Math.max(-1, Math.min(1, amt));
}

const lerpColor = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
function hsbShift(c, dh, ds, db) {
  if (!dh && !ds && !db) return c;
  const [r, g, b] = c; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  let s = mx ? d / mx : 0, v = mx; h = (h + dh + 360) % 360; s = clamp01(s + ds / 100); v = clamp01(v + db / 100);
  const C = v * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - C; const [rr, gg, bb] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
  return [rr + m, gg + m, bb + m];
}

/** accumulate every animator property for a unit */
function unitAnim(animators, u, li, counts, cache) {
  const o = { dx: 0, dy: 0, ax: 0, ay: 0, rot: 0, rx: 0, ry: 0, sx: 1, sy: 1, skew: 0, skewAxis: 0, op: 1, fillOp: 1, strokeOp: 1, fill: null, stroke: null,
    fh: 0, fs: 0, fb: 0, sh: 0, ss: 0, sb: 0, strokeW: 0, track: 0, lineSpacing: 0, charOffset: 0, blur: 0 };
  for (const an of animators || []) {
    const p = an.properties || {}; if (!Object.keys(p).length) continue;
    const a = animatorAmount(an, u, li, counts, 0, cache);
    const a1 = (an.selectors || []).some((s) => s.type === 'wiggly' && !s.lockDimensions) ? animatorAmount(an, u, li, counts, 1, cache) : a;
    if (p.position) { o.dx += (p.position[0] || 0) * a; o.dy += (p.position[1] || 0) * a1; }
    if (p.anchorPoint) { o.ax += (p.anchorPoint[0] || 0) * a; o.ay += (p.anchorPoint[1] || 0) * a1; }
    if (p.rotation != null) o.rot += p.rotation * a;
    if (p.rotationX != null) o.rx += p.rotationX * a;
    if (p.rotationY != null) o.ry += p.rotationY * a;
    if (p.scale) { o.sx *= 1 + a * ((p.scale[0] ?? 100) / 100 - 1); o.sy *= 1 + a1 * ((p.scale[1] ?? 100) / 100 - 1); }
    if (p.skew != null) { o.skew += p.skew * a; if (p.skewAxis != null) o.skewAxis = p.skewAxis; }
    if (p.opacity != null) o.op *= 1 + a * (p.opacity - 1);
    if (p.fillOpacity != null) o.fillOp *= 1 + a * (p.fillOpacity - 1);
    if (p.strokeOpacity != null) o.strokeOp *= 1 + a * (p.strokeOpacity - 1);
    if (p.fillColor) o.fill = { c: p.fillColor, k: clamp01(Math.abs(a) * (p.fillColor[3] ?? 1)) };
    if (p.strokeColor) o.stroke = { c: p.strokeColor, k: clamp01(Math.abs(a) * (p.strokeColor[3] ?? 1)) };
    if (p.fillHue != null) o.fh += p.fillHue * a; if (p.fillSaturation != null) o.fs += p.fillSaturation * a; if (p.fillBrightness != null) o.fb += p.fillBrightness * a;
    if (p.strokeHue != null) o.sh += p.strokeHue * a; if (p.strokeSaturation != null) o.ss += p.strokeSaturation * a; if (p.strokeBrightness != null) o.sb += p.strokeBrightness * a;
    if (p.strokeWidth != null) o.strokeW += p.strokeWidth * a;
    if (p.tracking != null) o.track += p.tracking * a;
    if (p.lineSpacing != null) o.lineSpacing += (Array.isArray(p.lineSpacing) ? p.lineSpacing[1] : p.lineSpacing) * a;
    if (p.characterOffset != null) o.charOffset += Math.round(p.characterOffset * a);
    if (p.blur != null) o.blur += (Array.isArray(p.blur) ? Math.max(p.blur[0], p.blur[1]) : p.blur) * Math.abs(a);
  }
  o.op = clamp01(o.op); o.fillOp = clamp01(o.fillOp); o.strokeOp = clamp01(o.strokeOp);
  return o;
}
const offsetChar = (s, k) => { if (!k || s.length !== 1) return s; const c = s.charCodeAt(0); const ranges = [[48, 57], [65, 90], [97, 122], [0x0e01, 0x0e2e]]; for (const [a, b] of ranges) if (c >= a && c <= b) return String.fromCharCode(a + ((((c - a + k) % (b - a + 1)) + (b - a + 1)) % (b - a + 1))); return String.fromCharCode(Math.max(32, c + k)); };

// ------------------------------------------------------------------ path text
function pathSampler(path, reverse) {
  const v = path.vertices || [], n = v.length; const pts = [];
  if (!n) return null; const last = path.closed ? n : n - 1;
  const add = (p) => pts.push(p);
  add(v[0]);
  for (let i = 0; i < last; i++) {
    const a = v[i], b = v[(i + 1) % n], ot = path.outTangents?.[i] || [0, 0], it = path.inTangents?.[(i + 1) % n] || [0, 0];
    const c1 = [a[0] + ot[0], a[1] + ot[1]], c2 = [b[0] + it[0], b[1] + it[1]];
    for (let k = 1; k <= 24; k++) { const t = k / 24, u = 1 - t; add([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]); }
  }
  if (reverse) pts.reverse();
  const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[acc.length - 1];
  return { total, closed: !!path.closed, at(d) {
    if (path.closed && total > 0) d = ((d % total) + total) % total;
    let i = 1; while (i < acc.length - 1 && acc[i] < d) i++;
    const a = pts[i - 1], b = pts[i], seg = acc[i] - acc[i - 1] || 1; const f = (d - acc[i - 1]) / seg;
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (d < 0) return { x: pts[0][0] + Math.cos(ang) * d, y: pts[0][1] + Math.sin(ang) * d, ang };
    if (d > total) return { x: b[0] + Math.cos(ang) * (d - total), y: b[1] + Math.sin(ang) * (d - total), ang };
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, ang };
  } };
}

/** Paint a text layer. ctx is in layer space: (0,0) = the text anchor (baseline start / centre / end by justification). */
export function drawText(ctx, text) {
  const doc = text.document; if (!doc || !String(doc.text ?? '').length) return;
  const L = layoutText(ctx, doc); const counts = L.counts; const cache = {};
  const size = doc.fontSize || 40; const leadOf = (st) => (st.autoLeading || !st.leading ? (st.fontSize || size) * 1.2 : st.leading);
  const boxed = doc.boxText && doc.boxTextSize;
  ctx.font = cssFont(doc, size);
  const ascent = ctx.measureText('d').actualBoundingBoxAscent || size * 0.75;
  const animators = text.animators || []; const more = text.moreOptions || {};
  const order = more.renderOrder || 'perCharacter';
  // vertical placement
  let y0 = 0;
  const totalH = L.lines.reduce((s, l, i) => s + (i ? leadOf(doc) : 0), 0);
  if (boxed) {
    y0 = (doc.boxTextPos?.[1] || 0) + ascent;
    const va = doc.boxVerticalAlignment; const free = doc.boxTextSize[1] - (totalH + ascent + size * 0.25);
    if (va === 'CENTER') y0 += Math.max(0, free / 2); else if (va === 'BOTTOM') y0 += Math.max(0, free);
  }
  const path = text.pathOptions && text.pathOptions.path ? pathSampler(text.pathOptions.path, text.pathOptions.reverse) : null;

  // build glyph draw list
  const glyphs = []; let y = y0 + (doc.baselineShift ? 0 : 0);
  for (let li = 0; li < L.lines.length; li++) {
    const line = L.lines[li]; const pst = line.para || doc; const just = String(pst.justification || doc.justification || 'LEFT_JUSTIFY');
    const align = /CENTER/.test(just) ? 'center' : /RIGHT/.test(just) ? 'right' : 'left';
    if (li && line.firstInPara) y += (pst.spaceBefore || 0);
    const indL = (pst.startIndent || 0) + (line.firstInPara ? pst.firstLineIndent || 0 : 0), indR = pst.endIndent || 0;
    let x;
    if (boxed) { const bx = doc.boxTextPos?.[0] || 0, bw = doc.boxTextSize[0]; x = align === 'center' ? bx + indL + (bw - indL - indR - line.alignWidth) / 2 : align === 'right' ? bx + bw - indR - line.alignWidth : bx + indL; }
    else x = align === 'center' ? -line.alignWidth / 2 : align === 'right' ? -line.alignWidth : indL;
    // full justification (box text, not the last line of a paragraph)
    let extra = 0; const lastOfPara = li === L.lines.length - 1 || L.lines[li + 1].paraIndex !== line.paraIndex;
    if (boxed && /FULL/.test(just) && (!lastOfPara || /LASTLINE_FULL/.test(just))) { const gaps = line.units.filter((u) => u.space).length; if (gaps) extra = (doc.boxTextSize[0] - indL - indR - line.alignWidth) / gaps; x = (doc.boxTextPos?.[0] || 0) + indL; }
    let lineTrack = 0; let lsSum = 0, lsN = 0;
    for (const u of line.units) {
      const a = animators.length ? unitAnim(animators, u, li, counts, cache) : null;
      if (a) { lsSum += a.lineSpacing; lsN++; }
      glyphs.push({ u, a, x: x + lineTrack, y: y - (u.style.baselineShift || 0), li });
      x += u.w + (u.space ? extra : 0); if (a) lineTrack += (a.track / 1000) * u.size;
    }
    y += leadOf(doc) + (lsN ? lsSum / lsN : 0); // Line Spacing animator: average selection of the line
    if (lastOfPara) y += pst.spaceAfter || 0;
  }
  // path text: remap glyph x positions onto the path
  if (path) {
    const po = text.pathOptions; const lineW = Math.max(...L.lines.map((l) => l.alignWidth), 0);
    const just = String(doc.justification || 'LEFT_JUSTIFY'); const avail = path.total - (po.firstMargin || 0) - (po.lastMargin || 0);
    const start = /CENTER/.test(just) ? (po.firstMargin || 0) + (avail - lineW) / 2 + lineW / 2 : /RIGHT/.test(just) ? path.total - (po.lastMargin || 0) : po.firstMargin || 0;
    const sx = po.forceAlignment && lineW > 0 ? avail / lineW : 1;
    for (const g of glyphs) {
      const d = (po.forceAlignment ? (po.firstMargin || 0) + (g.x - (L.lines[g.li].units[0] ? glyphs.find((q) => q.li === g.li).x : 0)) * sx : start + g.x) + g.u.w / 2;
      const p = path.at(d); g.path = { x: p.x, y: p.y, ang: po.perpendicular !== false ? p.ang : 0, lineOff: g.y - y0 };
    }
  }

  const fillOn0 = doc.applyFill !== false;
  const passes = order === 'allFillsOverAllStrokes' ? ['stroke', 'fill'] : order === 'allStrokesOverAllFills' ? ['fill', 'stroke'] : ['both'];
  ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round'; ctx.miterLimit = 4;
  for (const pass of passes) {
    for (const g of glyphs) {
      const { u, a } = g; if (u.space && !(a && a.charOffset)) continue;
      const st = u.style; const op = a ? a.op : 1; if (op <= 0.001) continue;
      const fillOn = st.applyFill !== false && fillOn0 !== false, strokeOn = !!st.applyStroke && ((st.strokeWidth || 0) + (a ? a.strokeW : 0)) > 0;
      if (!fillOn && !strokeOn) continue;
      ctx.save();
      if (g.path) { ctx.translate(g.path.x, g.path.y); ctx.rotate(g.path.ang); ctx.translate(-u.w / 2, g.path.lineOff); }
      else ctx.translate(g.x, g.y);
      if (a) {
        ctx.translate(a.dx, a.dy);
        // per-character anchor: horizontal centre on the baseline (Anchor Point Grouping "Character")
        const px = u.w / 2 + (more.groupingAlignment?.[0] || 0) / 100 * u.w, py = -(more.groupingAlignment?.[1] || 0) / 100 * u.size;
        ctx.translate(px, py);
        if (a.rot) ctx.rotate((a.rot * Math.PI) / 180);
        if (a.skew) { const ax = (a.skewAxis * Math.PI) / 180; ctx.rotate(ax); ctx.transform(1, 0, Math.tan((-a.skew * Math.PI) / 180), 1, 0, 0); ctx.rotate(-ax); }
        ctx.scale(a.sx * Math.cos((a.ry * Math.PI) / 180), a.sy * Math.cos((a.rx * Math.PI) / 180));
        ctx.translate(-px - a.ax, -py - a.ay);
        if (a.blur > 0.1) ctx.filter = `blur(${(a.blur / 2).toFixed(2)}px)`;
      }
      const hs = ratio(st.horizontalScale), vs = ratio(st.verticalScale); if (hs !== 1 || vs !== 1) ctx.scale(hs, vs);
      ctx.globalAlpha *= op; ctx.font = cssFont(st, u.size);
      const ch = a && a.charOffset ? offsetChar(u.text, a.charOffset) : u.text;
      let fc = st.fillColor || [1, 1, 1]; if (a && a.fill) fc = lerpColor(fc, a.fill.c, a.fill.k); if (a) fc = hsbShift(fc, a.fh, a.fs, a.fb);
      let sc = st.strokeColor || [0, 0, 0]; if (a && a.stroke) sc = lerpColor(sc, a.stroke.c, a.stroke.k); if (a) sc = hsbShift(sc, a.sh, a.ss, a.sb);
      const doStroke = () => { if (!strokeOn) return; ctx.lineWidth = (st.strokeWidth || 0) + (a ? a.strokeW : 0); ctx.strokeStyle = rgb(sc, a ? a.strokeOp : 1); ctx.strokeText(ch, 0, 0); };
      const doFill = () => { if (!fillOn) return; ctx.fillStyle = rgb(fc, a ? a.fillOp : 1); ctx.fillText(ch, 0, 0); };
      if (pass === 'fill') doFill(); else if (pass === 'stroke') doStroke();
      else if (st.strokeOverFill !== false) { doFill(); doStroke(); } else { doStroke(); doFill(); }
      ctx.restore();
    }
  }
}

/** Text measurements (sourceRectAtTime parity): width/height of the laid-out text, ascent of the first line. */
export function measureText(ctx, doc) {
  const L = layoutText(ctx, doc); const size = doc.fontSize || 40;
  const w = Math.max(0, ...L.lines.map((l) => l.alignWidth)); const lead = doc.autoLeading || !doc.leading ? size * 1.2 : doc.leading;
  ctx.font = cssFont(doc, size);
  const ascent = ctx.measureText(String(doc.text || '').split(/\r\n|\r|\n/)[0] || 'H').actualBoundingBoxAscent || size * 0.8;
  return { width: w, height: (L.lines.length - 1) * lead + ascent + size * 0.2, lineHeight: lead, ascent, lines: L.lines.length };
}

/** rough layer-space bounds of a text layer (for buffer sizing) */
export function textBounds(ctx, text) {
  const doc = text.document; if (!doc) return null; const m = measureText(ctx, doc); const size = doc.fontSize || 40;
  const just = String(doc.justification || ''); let x0 = /CENTER/.test(just) ? -m.width / 2 : /RIGHT/.test(just) ? -m.width : 0; let y0 = -m.ascent;
  if (doc.boxText && doc.boxTextSize) { x0 = doc.boxTextPos?.[0] || 0; y0 = doc.boxTextPos?.[1] || 0; return [x0 - size, y0 - size, x0 + doc.boxTextSize[0] + size, y0 + Math.max(doc.boxTextSize[1], m.height) + size]; }
  return [x0 - size, y0 - size, x0 + m.width + size, y0 + m.height + size];
}
