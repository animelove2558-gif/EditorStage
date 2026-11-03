// COS parser (btdk text documents) + TEXT_DOCUMENT value extraction. Port of py_aep cos/cos.py + models/text.

const WS = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c, 0x00]);
const isDigit = (c) => c >= 0x30 && c <= 0x39;
const isAlpha = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isHex = (c) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);

class CosName { constructor(v) { this.value = v; } toString() { return this.value; } }

const T = { ID: 1, NUM: 2, STR: 3, HEX: 4, BOOL: 5, OBJ: 6, OBJEND: 7, ARR: 8, ARREND: 9, NULL: 10, EOF: 11, IOBJ: 12, IEND: 13, REF: 14, STREAM: 15 };

class CosParser {
  constructor(u8) {
    this.b = u8;
    this.p = 0;
    this.tok = null;
  }

  parse() {
    this.lex();
    if (this.tok.t === T.ID) return this.parseDictContent();
    const v = this.parseValue();
    if (this.tok.t === T.EOF) return v;
    return [v, ...this.parseArrayContent()];
  }

  expect(t) { if (this.tok.t !== t) throw new SyntaxError('COS: unexpected token'); }

  parseValue() {
    const k = this.tok;
    if (k.t === T.ID) { this.lex(); return new CosName(k.v); }
    if (k.t === T.STR || k.t === T.HEX || k.t === T.NULL || k.t === T.BOOL || k.t === T.STREAM) { this.lex(); return k.v; }
    if (k.t === T.NUM) {
      this.lex();
      if (this.tok.t === T.NUM) {
        const savedP = this.p, savedTok = this.tok;
        this.lex();
        if (this.tok.t === T.IOBJ) {
          this.lex();
          const data = this.parseValue();
          this.expect(T.IEND);
          this.lex();
          return data;
        } else if (this.tok.t === T.REF) {
          this.lex();
          return null;
        }
        this.p = savedP; this.tok = savedTok;
      }
      return k.v;
    }
    if (k.t === T.OBJ) {
      this.lex();
      const v = this.parseDictContent();
      this.expect(T.OBJEND);
      this.lex();
      if (this.tok.t === T.STREAM) this.lex();
      return v;
    }
    if (k.t === T.ARR) {
      this.lex();
      const v = this.parseArrayContent();
      this.expect(T.ARREND);
      this.lex();
      return v;
    }
    throw new SyntaxError('COS: expected value');
  }

  parseDictContent() {
    const o = {};
    for (;;) {
      if (this.tok.t === T.EOF || this.tok.t === T.OBJEND) break;
      this.expect(T.ID);
      const key = this.tok.v;
      this.lex();
      o[key] = this.parseValue();
    }
    return o;
  }

  parseArrayContent() {
    const a = [];
    for (;;) {
      if (this.tok.t === T.EOF || this.tok.t === T.ARREND) break;
      a.push(this.parseValue());
    }
    return a;
  }

  lex() { this.tok = this.lexToken(); }

  lexToken() {
    const b = this.b;
    let c;
    for (;;) {
      if (this.p >= b.length) return { t: T.EOF };
      c = b[this.p++];
      if (c === 0x25) { while (this.p < b.length && b[this.p] !== 0x0a) this.p++; this.p++; continue; }
      if (!WS.has(c)) break;
    }
    if (c === 0x3c) { // <
      const n = b[this.p++];
      if (n === 0x3c) return { t: T.OBJ };
      if (n !== undefined && isHex(n)) return this.lexHex(n);
      throw new SyntaxError('COS: bad <');
    }
    if (c === 0x3e) { if (b[this.p++] !== 0x3e) throw new SyntaxError('COS: bad >'); return { t: T.OBJEND }; }
    if (c === 0x5b) return { t: T.ARR };
    if (c === 0x5d) return { t: T.ARREND };
    if (c === 0x2f) return this.lexIdent();
    if (c === 0x28) return this.lexString();
    if (isAlpha(c)) return this.lexKeyword(c);
    if (isDigit(c) || c === 0x2e || c === 0x2b || c === 0x2d) return this.lexNumber(c);
    throw new SyntaxError('COS: unknown token ' + c);
  }

  lexNumber(c) {
    const b = this.b;
    let s = String.fromCharCode(c);
    let isFloat = c === 0x2e;
    while (this.p < b.length) {
      const d = b[this.p];
      if (isDigit(d)) { s += String.fromCharCode(d); this.p++; }
      else if (d === 0x2e && !isFloat) { isFloat = true; s += '.'; this.p++; }
      else break;
    }
    return { t: T.NUM, v: isFloat ? parseFloat(s) : parseInt(s, 10) };
  }

  lexKeyword(c) {
    const b = this.b;
    let kw = String.fromCharCode(c);
    while (this.p < b.length && isAlpha(b[this.p])) kw += String.fromCharCode(b[this.p++]);
    switch (kw) {
      case 'true': return { t: T.BOOL, v: true };
      case 'false': return { t: T.BOOL, v: false };
      case 'null': return { t: T.NULL, v: null };
      case 'obj': return { t: T.IOBJ };
      case 'endobj': return { t: T.IEND };
      case 'R': return { t: T.REF };
      case 'xref': return { t: T.EOF };
      case 'stream': return this.lexStream();
      default: throw new SyntaxError('COS: unknown keyword ' + kw);
    }
  }

  lexStream() {
    const b = this.b;
    if (b[this.p] === 0x0d) this.p++;
    if (b[this.p] === 0x0a) this.p++;
    const marker = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d];
    let i = this.p;
    outer: for (; i + marker.length <= b.length; i++) {
      for (let j = 0; j < marker.length; j++) if (b[i + j] !== marker[j]) continue outer;
      break;
    }
    if (i + marker.length > b.length) throw new SyntaxError('COS: unterminated stream');
    const data = b.subarray(this.p, i);
    this.p = i + marker.length;
    return { t: T.STREAM, v: data };
  }

  lexString() {
    const b = this.b;
    const bytes = [];
    for (;;) {
      if (this.p >= b.length) throw new SyntaxError('COS: unterminated string');
      const c = b[this.p++];
      if (c === 0x29) break;
      if (c === 0x5c) {
        const e = b[this.p++];
        if (e === undefined) throw new SyntaxError('COS: unterminated string');
        if (e === 0x6e) bytes.push(0x0a);
        else if (e === 0x72) bytes.push(0x0d);
        else if (e === 0x62) bytes.push(0x08);
        else if (e === 0x66) bytes.push(0x0c);
        else if (e === 0x28 || e === 0x29 || e === 0x5c) bytes.push(e);
        else if (e >= 0x30 && e <= 0x37) {
          let o = e - 0x30;
          for (let k = 0; k < 2; k++) {
            const n = b[this.p];
            if (n === undefined || n < 0x30 || n > 0x37) break;
            this.p++;
            o = o * 8 + n - 0x30;
          }
          bytes.push(o & 0xff);
        } else throw new SyntaxError('COS: bad escape');
      } else bytes.push(c);
    }
    let arr = Uint8Array.from(bytes);
    let enc = 'utf-8';
    if (arr[0] === 0xef && arr[1] === 0xbb && arr[2] === 0xbf) arr = arr.subarray(3);
    else if (arr[0] === 0xfe && arr[1] === 0xff) { arr = arr.subarray(2); enc = 'utf-16be'; }
    else if (arr[0] === 0xff && arr[1] === 0xfe) { arr = arr.subarray(2); enc = 'utf-16le'; }
    let s;
    try {
      s = new TextDecoder(enc, { fatal: true }).decode(arr);
    } catch (e) {
      s = new TextDecoder(enc).decode(arr);
    }
    return { t: T.STR, v: s };
  }

  lexHex(first) {
    const b = this.b;
    let h = String.fromCharCode(first);
    for (;;) {
      if (this.p >= b.length) throw new SyntaxError('COS: unterminated hex');
      const c = b[this.p++];
      if (isHex(c)) h += String.fromCharCode(c);
      else if (c === 0x3e) break;
      else if (!WS.has(c)) throw new SyntaxError('COS: bad hex');
    }
    if (h.length % 2) h += '0';
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return { t: T.HEX, v: out };
  }

  lexIdent() {
    const b = this.b;
    let id = '';
    const special = '()[]<>{}/%';
    for (;;) {
      if (this.p >= b.length) break;
      const c = b[this.p];
      if (c < 0x21 || c > 0x7e) break;
      this.p++;
      if (c === 0x23) {
        let hx = '';
        for (let k = 0; k < 2; k++) {
          const n = b[this.p++];
          if (n === undefined || !isHex(n)) throw new SyntaxError('COS: bad ident');
          hx += String.fromCharCode(n);
        }
        id += String.fromCharCode(parseInt(hx, 16));
      } else if (special.includes(String.fromCharCode(c))) { this.p--; break; }
      else id += String.fromCharCode(c);
    }
    return { t: T.ID, v: id };
  }
}

export function parseCos(u8) {
  return new CosParser(u8).parse();
}

export function cosGet(data, ...keys) {
  let cur = data;
  for (const key of keys) {
    if (cur === null || cur === undefined) return null;
    if (Array.isArray(cur)) {
      const i = Number(key);
      cur = Number.isInteger(i) && i >= 0 && i < cur.length ? cur[i] : null;
    } else if (typeof cur === 'object' && !(cur instanceof CosName)) {
      const v = cur[String(key)];
      cur = v === undefined ? null : v;
    } else return null;
  }
  return cur === undefined ? null : cur;
}

const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof CosName);
const isNum = (v) => typeof v === 'number';

const JUST = ['LEFT_JUSTIFY', 'RIGHT_JUSTIFY', 'CENTER_JUSTIFY', 'FULL_JUSTIFY_LASTLINE_LEFT', 'FULL_JUSTIFY_LASTLINE_RIGHT', 'FULL_JUSTIFY_LASTLINE_CENTER', 'FULL_JUSTIFY_LASTLINE_FULL'];
const E = {
  caps: ['FONT_NORMAL_CAPS', 'FONT_SMALL_CAPS', 'FONT_ALL_CAPS', 'FONT_ALL_SMALL_CAPS'],
  base: ['FONT_NORMAL_BASELINE', 'FONT_FAUXED_SUPERSCRIPT', 'FONT_FAUXED_SUBSCRIPT'],
  kern: ['NO_AUTO_KERN', 'METRIC_KERN', 'OPTICAL_KERN'],
  digit: ['DEFAULT_DIGITS', 'ARABIC_DIGITS', 'HINDI_DIGITS', 'FARSI_DIGITS', 'ARABIC_DIGITS_RTL'],
  valign: ['TOP', 'CENTER', 'BOTTOM', 'JUSTIFY'],
  bdir: ['BASELINE_WITH_STREAM', 'BASELINE_VERTICAL_ROTATED', 'BASELINE_VERTICAL_CROSS_STREAM'],
  lead: ['ROMAN_LEADING_TYPE', 'JAPANESE_LEADING_TYPE'],
  join: ['LINE_JOIN_MITER', 'LINE_JOIN_ROUND', 'LINE_JOIN_BEVEL'],
  dir: ['DIRECTION_LEFT_TO_RIGHT', 'DIRECTION_RIGHT_TO_LEFT'],
};

function enumOf(names, v, dflt) {
  if (v === null || v === undefined) return dflt;
  return Number.isInteger(v) && v >= 0 && v < names.length ? names[v] : null;
}
function get(d, key, dflt) {
  if (!d) return dflt;
  const v = d[key];
  return v === undefined || v === null ? dflt : v;
}
function parseColor(paint) {
  const argb = cosGet(paint, '0', '1');
  if (Array.isArray(argb) && argb.length >= 4) return [Number(argb[1]), Number(argb[2]), Number(argb[3])];
  return null;
}

/** Parse a btdk body into { docs: TEXT_DOCUMENT[], fonts: string[], usedFonts: string[] } (never throws). */
export function parseBtdk(u8) {
  let cos;
  try { cos = parseCos(u8); } catch (e) { return null; }
  if (!isDict(cos)) return null;
  const fonts = [];
  const fa = cosGet(cos, '0', '1', '0');
  if (Array.isArray(fa)) {
    for (const entry of fa) {
      const fd = cosGet(entry, '0', '0');
      if (isDict(fd)) fonts.push(String(fd['0'] === undefined ? '' : fd['0']));
    }
  }
  const docArr = cosGet(cos, '1', '1');
  const docs = [];
  const used = new Set();
  if (Array.isArray(docArr)) {
    for (const entry of docArr) {
      const c = cosGet(entry, '0', '6', '0', 0, '0', '0', '6');
      const p = cosGet(entry, '0', '5', '0', 0, '0', '0', '5');
      docs.push(buildDoc(entry, isDict(c) ? c : null, isDict(p) ? p : null, fonts, cos));
      const runs = cosGet(entry, '0', '6', '0');
      if (Array.isArray(runs)) {
        for (const r of runs) {
          const idx = cosGet(r, '0', '0', '6', '0');
          if (Number.isInteger(idx) && idx >= 0 && idx < fonts.length) used.add(fonts[idx]);
        }
      }
    }
  }
  return { docs, fonts, usedFonts: [...used] };
}

function buildDoc(doc, c, p, fonts, cos) {
  const raw = cosGet(doc, '0', '0');
  let text = '';
  if (raw !== null) {
    let s = String(raw);
    if (s.endsWith('\r')) s = s.slice(0, -1);
    text = s.replace(/\r/g, '\n');
  }
  const fi = c ? c['0'] : undefined;
  const font = Number.isInteger(fi) && fi >= 0 && fi < fonts.length ? fonts[fi] : null;
  const fontSize = c && isNum(c['1']) ? c['1'] : null;
  const autoLeading = c ? Boolean(get(c, '4', true)) : true;
  let leading = null;
  if (c && isNum(c['5'])) {
    leading = c['5'];
    if (autoLeading && p) {
      const f = get(p, '7', 1.2);
      if (fontSize !== null) leading = fontSize * Number(f);
    }
  }
  const frame = cosGet(cos, '0', '8', '0', 0, '0');
  const fr = isDict(frame) ? frame : null;
  const boxText = !!(fr && isDict(fr['1']));
  let outline = fr ? cosGet(fr, '1', '0') : null;
  if (!(Array.isArray(outline) && outline.length >= 14)) outline = null;
  const caps = c && c['12'] !== undefined && c['12'] !== null ? enumOf(E.caps, c['12'], null) : null;
  const base = c && c['13'] !== undefined && c['13'] !== null ? enumOf(E.base, c['13'], null) : null;
  const kern = cosGet(doc, '0', '7');
  const vsel = cosGet(fr, '2', '13');
  const bool = (d, k, dflt) => (d && d[k] !== undefined && d[k] !== null ? Boolean(d[k]) : dflt);
  const num = (d, k, dflt) => (d && d[k] !== undefined && d[k] !== null ? Number(d[k]) : dflt);
  // per-run styles (JS reader addition): spans in UTF-16 units of the stored text; only emitted when runs differ
  const runStyle = (s) => {
    const i = s ? s['0'] : undefined; const cp = s && s['12'] !== undefined && s['12'] !== null ? enumOf(E.caps, s['12'], null) : null;
    return { font: Number.isInteger(i) && i >= 0 && i < fonts.length ? fonts[i] : null, fontSize: s && isNum(s['1']) ? s['1'] : null,
      fillColor: s ? parseColor(s['53']) : null, strokeColor: s ? parseColor(s['54']) : null, strokeWidth: num(s, '63', null),
      applyFill: bool(s, '56', null), applyStroke: bool(s, '57', null), strokeOverFill: bool(s, '58', null), fauxBold: bool(s, '2', null), fauxItalic: bool(s, '3', null),
      tracking: s && isNum(s['8']) ? s['8'] : null, baselineShift: num(s, '9', null), horizontalScale: num(s, '6', null), verticalScale: num(s, '7', null),
      allCaps: cp === null ? null : cp === 'FONT_ALL_CAPS', smallCaps: cp === null ? null : cp === 'FONT_SMALL_CAPS' };
  };
  const spans = (key, sub) => {
    const runs = cosGet(doc, '0', key, '0'); const out = []; let pos = 0;
    if (Array.isArray(runs)) for (const r of runs) { const len = isDict(r) ? r['1'] : null; if (!Number.isInteger(len) || len < 0) continue; const pl = cosGet(r, '0', '0', sub); out.push({ start: pos, end: pos + len, style: isDict(pl) ? pl : {} }); pos += len; }
    return out;
  };
  const cr = spans('6', '6').map((r) => ({ start: r.start, end: r.end, ...runStyle(r.style) }));
  const styleRuns = cr.length > 1 && cr.some((r) => JSON.stringify({ ...r, start: 0, end: 0 }) !== JSON.stringify({ ...cr[0], start: 0, end: 0 })) ? cr : null;
  const pr = spans('5', '5').map((r) => ({ start: r.start, end: r.end, justification: enumOf(JUST, r.style['0'], null), firstLineIndent: num(r.style, '1', 0), startIndent: num(r.style, '2', 0), endIndent: num(r.style, '3', 0), spaceBefore: num(r.style, '4', 0), spaceAfter: num(r.style, '5', 0) }));
  const paraRuns = pr.length > 1 ? pr : null;
  return {
    styleRuns,
    paraRuns,
    text,
    font,
    fontFamily: null,
    fontStyle: null,
    fontSize,
    fillColor: c ? parseColor(c['53']) : null,
    strokeColor: c ? parseColor(c['54']) : null,
    strokeWidth: num(c, '63', 1.0),
    applyFill: bool(c, '56', null),
    applyStroke: bool(c, '57', false),
    strokeOverFill: bool(c, '58', true),
    justification: p ? enumOf(JUST, p['0'], null) : null,
    tracking: c && isNum(c['8']) ? c['8'] : null,
    leading,
    autoLeading,
    baselineShift: num(c, '9', null),
    horizontalScale: num(c, '6', null),
    verticalScale: num(c, '7', null),
    tsume: num(c, '36', 0.0),
    fauxBold: bool(c, '2', null),
    fauxItalic: bool(c, '3', null),
    allCaps: caps === null ? null : caps === 'FONT_ALL_CAPS',
    smallCaps: caps === null ? null : caps === 'FONT_SMALL_CAPS',
    superscript: base === null ? null : base === 'FONT_FAUXED_SUPERSCRIPT',
    subscript: base === null ? null : base === 'FONT_FAUXED_SUBSCRIPT',
    boxText,
    boxTextSize: outline ? [Math.abs(outline[12] - outline[0]), Math.abs(outline[13] - outline[1])] : null,
    boxTextPos: outline ? [outline[0], outline[1]] : null,
    pointText: !boxText,
    kerning: Number.isInteger(kern) ? kern : 0,
    firstLineIndent: num(p, '1', 0.0),
    startIndent: num(p, '2', 0.0),
    endIndent: num(p, '3', 0.0),
    spaceBefore: num(p, '4', 0.0),
    spaceAfter: num(p, '5', 0.0),
    direction: enumOf(E.dir, p ? p['33'] : undefined, 'DIRECTION_LEFT_TO_RIGHT'),
    lineJoinType: enumOf(E.join, c ? c['62'] : undefined, 'LINE_JOIN_MITER'),
    fontBaselineOption: base,
    fontCapsOption: caps,
    autoKernType: c ? enumOf(E.kern, c['11'], 'NO_AUTO_KERN') : 'NO_AUTO_KERN',
    digitSet: enumOf(E.digit, c ? c['70'] : undefined, 'DEFAULT_DIGITS'),
    boxVerticalAlignment: Number.isInteger(vsel) ? enumOf(E.valign, vsel, 'TOP') : 'TOP',
    ligature: bool(c, '18', false),
    hangingRoman: bool(p, '21', false),
    noBreak: bool(c, '52', false),
    everyLineComposer: bool(p, '29', false),
    // COS stores this 1-based (member value - 11611)
    baselineDirection: enumOf(E.bdir, c && Number.isInteger(c['35']) ? c['35'] - 1 : undefined, 'BASELINE_WITH_STREAM'),
    leadingType: enumOf(E.lead, p ? p['8'] : undefined, 'ROMAN_LEADING_TYPE'),
  };
}
