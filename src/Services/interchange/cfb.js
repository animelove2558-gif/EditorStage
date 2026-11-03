// Microsoft Compound File Binary writer ([MS-CFB], version 4: 4096-byte sectors, 64-byte mini sectors) — the container
// AAF files use. Pure: takes a tree, returns the file as a list of byte chunks (written one after another).
//   storage = { name, clsid?: Uint8Array(16), children: [storage | stream] }   stream = { name, data: Uint8Array }
const SECTOR = 4096, MINI = 64, CUTOFF = 4096, PER_SECTOR = SECTOR / 4, DIR_PER_SECTOR = SECTOR / 128;
const FREESECT = 0xffffffff, ENDOFCHAIN = 0xfffffffe, FATSECT = 0xfffffffd, DIFSECT = 0xfffffffc, NOSTREAM = 0xffffffff;

/** Sibling order inside a storage: shorter names first, then code units compared upper-cased ([MS-CFB] 2.6.4). */
export function compareNames(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  const A = a.toUpperCase(), B = b.toUpperCase();
  return A < B ? -1 : A > B ? 1 : 0;
}

export function writeCFB(root) {
  // ---- directory entries (root = 0), children as a balanced red-black tree ----
  const entries = [];
  const add = (node, type) => { const e = { node, type, left: NOSTREAM, right: NOSTREAM, child: NOSTREAM, color: 1, start: ENDOFCHAIN, size: 0 }; entries.push(e); return entries.length - 1; };
  const build = (node, idx) => {
    const kids = [...(node.children || [])].sort((x, y) => compareNames(x.name, y.name));
    for (let i = 1; i < kids.length; i++) if (compareNames(kids[i - 1].name, kids[i].name) === 0) throw new Error(`duplicate name in storage ${node.name}: ${kids[i].name}`);
    const ids = kids.map((k) => add(k, k.children ? 1 : 2));
    // balanced tree: middle element at the top; nodes on the incomplete last level are red, all others black
    const depthMax = Math.floor(Math.log2(ids.length || 1));
    const tree = (lo, hi, depth) => {
      if (lo > hi) return NOSTREAM;
      const mid = (lo + hi) >> 1; const e = entries[ids[mid]];
      e.left = tree(lo, mid - 1, depth + 1); e.right = tree(mid + 1, hi, depth + 1);
      e.color = depth === depthMax && ids.length + 1 !== 2 ** (depthMax + 1) ? 0 : 1;
      return ids[mid];
    };
    entries[idx].child = tree(0, ids.length - 1, 0);
    kids.forEach((k, i) => { if (k.children) build(k, ids[i]); });
  };
  add(root, 5); build(root, 0);
  for (const e of entries) {
    const units = e.node.name.length; if (units > 31) throw new Error(`name too long: ${e.node.name}`);
  }

  // ---- mini stream (streams under 4096 bytes) ----
  const miniChunks = []; const miniFat = []; let miniSectors = 0;
  const bigStreams = [];
  for (const e of entries) {
    if (e.type !== 2) continue;
    const n = e.node.data.length; e.size = n;
    if (n === 0) { e.start = ENDOFCHAIN; continue; }
    if (n < CUTOFF) {
      const count = Math.ceil(n / MINI); e.start = miniSectors;
      for (let i = 0; i < count; i++) miniFat.push(i === count - 1 ? ENDOFCHAIN : miniSectors + i + 1);
      miniSectors += count; miniChunks.push(e.node.data); const pad = count * MINI - n; if (pad) miniChunks.push(new Uint8Array(pad));
    } else bigStreams.push(e);
  }
  const miniStreamSize = miniSectors * MINI;

  // ---- sector layout: big streams, mini stream, mini FAT, directory, FAT, DIFAT ----
  let next = 0; const fat = [];
  const chain = (count) => { const s = next; for (let i = 0; i < count; i++) fat[next + i] = i === count - 1 ? ENDOFCHAIN : next + i + 1; next += count; return s; };
  for (const e of bigStreams) e.start = chain(Math.ceil(e.size / SECTOR));
  const miniStreamStart = miniStreamSize ? chain(Math.ceil(miniStreamSize / SECTOR)) : ENDOFCHAIN;
  const miniFatSectors = Math.ceil(miniFat.length / PER_SECTOR);
  const miniFatStart = miniFatSectors ? chain(miniFatSectors) : ENDOFCHAIN;
  const dirSectors = Math.ceil(entries.length / DIR_PER_SECTOR);
  const dirStart = chain(dirSectors);
  // FAT + DIFAT sectors also need FAT entries: grow until it fits
  let fatSectors = 0, difatSectors = 0;
  for (;;) {
    const total = next + fatSectors + difatSectors;
    const needFat = Math.ceil(total / PER_SECTOR); const needDifat = needFat > 109 ? Math.ceil((needFat - 109) / (PER_SECTOR - 1)) : 0;
    if (needFat === fatSectors && needDifat === difatSectors) break;
    fatSectors = needFat; difatSectors = needDifat;
  }
  const fatStart = next; for (let i = 0; i < fatSectors; i++) fat[next++] = FATSECT;
  const difatStart = difatSectors ? next : ENDOFCHAIN; for (let i = 0; i < difatSectors; i++) fat[next++] = DIFSECT;
  const totalSectors = next;
  entries[0].start = miniStreamStart; entries[0].size = miniStreamSize;

  // ---- bytes ----
  const header = new Uint8Array(SECTOR); const hv = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  hv.setUint16(24, 0x003e, true); hv.setUint16(26, 0x0004, true); hv.setUint16(28, 0xfffe, true); hv.setUint16(30, 12, true); hv.setUint16(32, 6, true);
  hv.setUint32(40, dirSectors, true); hv.setUint32(44, fatSectors, true); hv.setUint32(48, dirStart, true); hv.setUint32(52, 0, true);
  hv.setUint32(56, CUTOFF, true); hv.setUint32(60, miniFatStart, true); hv.setUint32(64, miniFatSectors, true);
  hv.setUint32(68, difatStart, true); hv.setUint32(72, difatSectors, true);
  for (let i = 0; i < 109; i++) hv.setUint32(76 + i * 4, i < fatSectors ? fatStart + i : FREESECT, true);

  const chunks = [header];
  const padTo = (n) => { const r = n % SECTOR; if (r) chunks.push(new Uint8Array(SECTOR - r)); };
  for (const e of bigStreams) { chunks.push(e.node.data); padTo(e.size); }
  if (miniStreamSize) { let n = 0; for (const c of miniChunks) { chunks.push(c); n += c.length; } padTo(n); }
  if (miniFatSectors) { const b = new Uint8Array(miniFatSectors * SECTOR).fill(0xff); const v = new DataView(b.buffer); miniFat.forEach((x, i) => v.setUint32(i * 4, x, true)); chunks.push(b); }
  const dir = new Uint8Array(dirSectors * SECTOR); const dv = new DataView(dir.buffer);
  for (let i = 0; i < dirSectors * DIR_PER_SECTOR; i++) {
    const o = i * 128; const e = entries[i];
    if (!e) { dv.setUint32(o + 68, NOSTREAM, true); dv.setUint32(o + 72, NOSTREAM, true); dv.setUint32(o + 76, NOSTREAM, true); continue; }
    const name = e.node.name;
    for (let k = 0; k < name.length; k++) dv.setUint16(o + k * 2, name.charCodeAt(k), true);
    dv.setUint16(o + 64, (name.length + 1) * 2, true); dir[o + 66] = e.type; dir[o + 67] = e.color;
    dv.setUint32(o + 68, e.left, true); dv.setUint32(o + 72, e.right, true); dv.setUint32(o + 76, e.child, true);
    if (e.type !== 2 && e.node.clsid) dir.set(e.node.clsid, o + 80);
    dv.setUint32(o + 116, e.type === 1 ? 0 : e.start, true);
    dv.setUint32(o + 120, e.size % 2 ** 32, true); dv.setUint32(o + 124, Math.floor(e.size / 2 ** 32), true);
  }
  chunks.push(dir);
  const fatBytes = new Uint8Array(fatSectors * SECTOR).fill(0xff); const fv = new DataView(fatBytes.buffer);
  for (let i = 0; i < totalSectors; i++) fv.setUint32(i * 4, fat[i] ?? FREESECT, true);
  chunks.push(fatBytes);
  if (difatSectors) {
    const b = new Uint8Array(difatSectors * SECTOR).fill(0xff); const v = new DataView(b.buffer); let k = 109;
    for (let s = 0; s < difatSectors; s++) {
      for (let i = 0; i < PER_SECTOR - 1; i++, k++) if (k < fatSectors) v.setUint32(s * SECTOR + i * 4, fatStart + k, true);
      v.setUint32(s * SECTOR + (PER_SECTOR - 1) * 4, s === difatSectors - 1 ? ENDOFCHAIN : difatStart + s + 1, true);
    }
    chunks.push(b);
  }
  return chunks;
}

/** Concatenate chunks (tests / small files). */
export const joinChunks = (chunks) => { const n = chunks.reduce((a, c) => a + c.length, 0); const out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; };

/** Reader for the same format (tests and the e2e suite): { tree, read(path) }. Follows FAT / mini FAT chains. */
export function readCFB(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint32(0, true) !== 0xe011cfd0) throw new Error('not a compound file');
  const ss = 1 << v.getUint16(30, true), ms = 1 << v.getUint16(32, true), cutoff = v.getUint32(56, true);
  const off = (s) => (s + 1) * ss;
  const fatSecs = []; for (let i = 0; i < 109; i++) { const s = v.getUint32(76 + i * 4, true); if (s !== FREESECT) fatSecs.push(s); }
  let dif = v.getUint32(68, true); for (let n = v.getUint32(72, true); n > 0 && dif !== ENDOFCHAIN; n--) { for (let i = 0; i < ss / 4 - 1; i++) { const s = v.getUint32(off(dif) + i * 4, true); if (s !== FREESECT) fatSecs.push(s); } dif = v.getUint32(off(dif) + ss - 4, true); }
  const fat = []; for (const s of fatSecs) for (let i = 0; i < ss / 4; i++) fat.push(v.getUint32(off(s) + i * 4, true));
  const chainOf = (s, table) => { const out = []; const seen = new Set(); while (s !== ENDOFCHAIN && s !== FREESECT) { if (seen.has(s)) throw new Error('FAT loop'); seen.add(s); out.push(s); s = table[s]; if (s === undefined) throw new Error('chain leaves the FAT'); } return out; };
  const readBig = (s, size) => { const out = new Uint8Array(size); let o = 0; for (const x of chainOf(s, fat)) { const n = Math.min(ss, size - o); if (n <= 0) break; out.set(buf.subarray(off(x), off(x) + n), o); o += n; } if (o < size) throw new Error('stream shorter than its size'); return out; };
  const dirBytes = readBig(v.getUint32(48, true), chainOf(v.getUint32(48, true), fat).length * ss);
  const dv = new DataView(dirBytes.buffer);
  const E = []; for (let o = 0; o < dirBytes.length; o += 128) { const nl = dv.getUint16(o + 64, true); let name = ''; for (let k = 0; k < nl / 2 - 1; k++) name += String.fromCharCode(dv.getUint16(o + k * 2, true)); E.push({ name, type: dirBytes[o + 66], color: dirBytes[o + 67], left: dv.getUint32(o + 68, true), right: dv.getUint32(o + 72, true), child: dv.getUint32(o + 76, true), clsid: dirBytes.slice(o + 80, o + 96), start: dv.getUint32(o + 116, true), size: dv.getUint32(o + 120, true) + dv.getUint32(o + 124, true) * 2 ** 32 }); }
  const miniFat = []; { const s0 = v.getUint32(60, true); if (s0 !== ENDOFCHAIN) for (const x of chainOf(s0, fat)) for (let i = 0; i < ss / 4; i++) miniFat.push(v.getUint32(off(x) + i * 4, true)); }
  const mini = E[0].size ? readBig(E[0].start, E[0].size) : new Uint8Array(0);
  const readData = (e) => { if (e.size >= cutoff) return readBig(e.start, e.size); const out = new Uint8Array(e.size); let o = 0; for (const x of chainOf(e.start, miniFat)) { const n = Math.min(ms, e.size - o); if (n <= 0) break; out.set(mini.subarray(x * ms, x * ms + n), o); o += n; } return out; };
  const kids = (i) => { const out = []; const walk = (j) => { if (j === NOSTREAM) return; walk(E[j].left); out.push(j); walk(E[j].right); }; walk(E[i].child); return out; };
  const node = (i) => { const e = E[i]; return e.type === 2 ? { name: e.name, size: e.size, entry: e, data: () => readData(e) } : { name: e.name, clsid: e.clsid, entry: e, children: kids(i).map(node) }; };
  return { tree: node(0), entries: E, sectorSize: ss };
}
