// RIFX chunk tree reader for After Effects .aep files (big-endian).
// Pure Uint8Array / DataView; no Node APIs. Parsing is lazy per LIST so unknown chunks cost nothing.

const CONTAINER_TYPES = new Set(['fnam', 'pdnm', 'RCom', 'tdsn', 'vfdn']);
const utf8 = new TextDecoder('utf-8');

function ascii4(u8, p) {
  return String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
}

export class Chunk {
  constructor(src, type, start, len) {
    this.src = src; // { u8, dv }
    this.type = type; // 4cc ('LIST' / 'RIFX' for containers)
    this.start = start; // body offset
    this.len = len;
    this._kids = null;
    this._lt = null;
  }

  get end() {
    return this.start + this.len;
  }

  get isList() {
    return this.type === 'LIST' || this.type === 'RIFX';
  }

  /** 4cc list sub-type ('tdgp', 'Layr', ...) or '' for non-lists. */
  get listType() {
    if (this._lt === null) {
      this._lt = this.isList && this.len >= 4 ? ascii4(this.src.u8, this.start) : '';
    }
    return this._lt;
  }

  /** Child chunks (lists and string containers); [] for leaves / btdk. */
  get kids() {
    if (this._kids) return this._kids;
    let kids = [];
    try {
      if (this.isList) {
        if (this.listType !== 'btdk' && this.len >= 4) {
          kids = parseChunks(this.src, this.start + 4, this.end);
        }
      } else if (CONTAINER_TYPES.has(this.type)) {
        if (tilesAsChunks(this.src, this.start, this.end)) kids = parseChunks(this.src, this.start, this.end);
      }
    } catch (e) {
      kids = [];
    }
    this._kids = kids;
    return kids;
  }

  /** Raw body bytes of a btdk list (after the list type). */
  get listBody() {
    return this.src.u8.subarray(this.start + 4, this.end);
  }

  u1(o) { return this.src.u8[this.start + o]; }
  u2(o) { return this.src.dv.getUint16(this.start + o, false); }
  u4(o) { return this.src.dv.getUint32(this.start + o, false); }
  s4(o) { return this.src.dv.getInt32(this.start + o, false); }
  f4(o) { return this.src.dv.getFloat32(this.start + o, false); }
  f8(o) { return this.src.dv.getFloat64(this.start + o, false); }
  u4le(o) { return this.src.dv.getUint32(this.start + o, true); }

  /** Whole body as UTF-8 text (Utf8 / alas / cmta ...). */
  text() {
    return utf8.decode(this.src.u8.subarray(this.start, this.end));
  }

  /** Match name: fixed-width NUL padded. */
  tdmn() {
    let e = this.end;
    const u8 = this.src.u8;
    while (e > this.start && u8[e - 1] === 0) e--;
    return utf8.decode(u8.subarray(this.start, e));
  }

  /** String held by a container chunk (fnam/pdnm/tdsn/RCom): Utf8 child or legacy NUL-terminated body. */
  containerString() {
    for (const k of this.kids) if (k.type === 'Utf8') return k.text();
    if (this.kids.length === 0 && this.len > 0) {
      const u8 = this.src.u8;
      let e = this.start;
      while (e < this.end && u8[e] !== 0) e++;
      return utf8.decode(u8.subarray(this.start, e));
    }
    return '';
  }
}

function tilesAsChunks(src, start, end) {
  let pos = start;
  const { u8, dv } = src;
  while (pos < end) {
    if (end - pos < 8) return false;
    for (let i = 0; i < 4; i++) {
      const b = u8[pos + i];
      if (b < 0x20 || b >= 0x7f) return false;
    }
    const len = dv.getUint32(pos + 4, false);
    pos += 8 + len + (len & 1);
    if (pos > end) return false;
  }
  return pos === end;
}

export function parseChunks(src, start, end) {
  const out = [];
  const { u8, dv } = src;
  let pos = start;
  while (pos + 8 <= end) {
    const type = ascii4(u8, pos);
    let len = dv.getUint32(pos + 4, false);
    const body = pos + 8;
    if (body + len > end) len = Math.max(0, end - body); // truncated / drifted: clamp, never throw
    out.push(new Chunk(src, type, body, len));
    pos = body + len + (len & 1);
  }
  return out;
}

/** Parse a whole .aep: returns the RIFX root chunk (children via .kids). */
export function readRoot(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const src = { u8, dv };
  if (u8.length < 12 || ascii4(u8, 0) !== 'RIFX') throw new Error('Not an RIFX (After Effects) file');
  let len = dv.getUint32(4, false);
  if (8 + len > u8.length) len = u8.length - 8;
  return new Chunk(src, 'RIFX', 8, len);
}

export const findT = (kids, type) => { for (const k of kids) if (k.type === type) return k; return null; };
export const filterT = (kids, type) => kids.filter((k) => k.type === type);
export const findL = (kids, lt) => { for (const k of kids) if (k.isList && k.listType === lt) return k; return null; };
export const filterL = (kids, lt) => kids.filter((k) => k.isList && k.listType === lt);

export { utf8 as utf8Decoder };
