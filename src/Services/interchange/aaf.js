// AAF writer (audio interchange with embedded PCM), pure JS on top of cfb.js.
// The meta dictionary + dictionary (class / type / data / codec / container definitions) come from aafTemplate.js —
// the definitions an empty file made with pyaaf2 (MIT) carries; scripts/aaf/make_template.py regenerates it.
// Object model (the one Premiere's "breakout to mono" AAF uses):
//   CompositionMob (top level) ── one TimelineMobSlot per output track: Sequence of Filler / SourceClip → MasterMob
//   MasterMob ── SourceClip → SourceMob (PCMDescriptor) ── EssenceData (raw PCM in the file)
import TEMPLATE from './aafTemplate.js';
import { writeCFB } from './cfb.js';

// ---- byte helpers ----
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const num = (bytes, fn) => { const b = new Uint8Array(bytes); fn(new DataView(b.buffer)); return b; };
const u8 = (x) => new Uint8Array([x]);
const u16 = (x) => num(2, (v) => v.setUint16(0, x, true));
const u32 = (x) => num(4, (v) => v.setUint32(0, x >>> 0, true));
const i64 = (x) => num(8, (v) => v.setBigInt64(0, BigInt(Math.round(x)), true));
const rational = (n, d = 1) => num(8, (v) => { v.setInt32(0, n, true); v.setInt32(4, d, true); });
const bool = (x) => u8(x ? 1 : 0);
const utf16 = (s) => num(s.length * 2, (v) => { for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i), true); });
const str = (s) => cat(utf16(String(s)), u16(0));
const b64 = (s) => (typeof atob === 'function' ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64')));
/** AUID / UUID text → the 16 bytes AAF stores (Microsoft GUID layout: first three groups little-endian). */
export function auid(text) {
  const h = text.replace(/-/g, ''); const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  const sw = (a, z) => { for (let i = a, j = z; i < j; i++, j--) [b[i], b[j]] = [b[j], b[i]]; };
  sw(0, 3); sw(4, 5); sw(6, 7); return b;
}
const timestamp = (d) => cat(num(2, (v) => v.setInt16(0, d.getFullYear(), true)), new Uint8Array([d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), 0]));
const rand16 = (rng) => { const b = new Uint8Array(16); for (let i = 0; i < 16; i++) b[i] = Math.floor(rng() * 256); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; return b; };
/** SMPTE UMID (32 bytes) as Mob.MobID: basic UMID label + material number. */
export const mobId = (material) => cat(new Uint8Array([0x06, 0x0a, 0x2b, 0x34, 0x01, 0x01, 0x01, 0x05, 0x01, 0x01, 0x0f, 0x20, 0x13, 0x00, 0x00, 0x00]), material);
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// ---- definitions referenced by weak references ----
const cls = (n) => `0d010101-0101-${n}-060e-2b3402060101`;
const CLASS = { Header: cls('2f00'), ContentStorage: cls('1800'), Identification: cls('3000'), CompositionMob: cls('3500'), MasterMob: cls('3600'), SourceMob: cls('3700'), TimelineMobSlot: cls('3b00'), Sequence: cls('0f00'), Filler: cls('0900'), SourceClip: cls('1100'), Timecode: cls('1400'), EssenceData: cls('2300'), PCMDescriptor: cls('4800') };
const DATA_DEF = { Sound: '01030202-0200-0000-060e-2b3404010101', Timecode: '01030201-0100-0000-060e-2b3404010101' };
const CONTAINER_AAF = '4313b571-d8ba-11d2-809b-006008143e6f';
const USAGE_TOP_LEVEL = '0d010102-0101-0700-060e-2b3404010101';
const OP_EDIT_PROTOCOL = '0d011201-0100-0000-060e-2b3404010105';
// weak-reference target tables ("referenced properties"): the template's paths + ContainerDefinitions
const WEAK_PATHS = [...TEMPLATE.weakrefPaths, [2, 0x3b04, 0x2608]];
const weakIndex = (path) => WEAK_PATHS.findIndex((p) => p.join() === path.join());
const DD_INDEX = weakIndex([2, 0x3b04, 0x2605]), CD_INDEX = weakIndex([2, 0x3b04, 0x2608]);
if (DD_INDEX < 0) throw new Error('AAF template has no DataDefinitions weak-reference table');
// weak reference value: table index, key property (DefinitionObject.Identification 0x1b01), key size, key
const weak = (index, key) => cat(u16(index), u16(0x1b01), u8(16), auid(key));
const dataDef = (k) => weak(DD_INDEX, DATA_DEF[k]);

// ---- property stored forms ([MS-AAF] structured storage) ----
const SF = { DATA: 0x82, STREAM: 0x42, STRONG: 0x22, VECTOR: 0x32, SET: 0x3a, WEAK: 0x02 };
// a property list is [pid, kind, value, name?]: kind 'data' | 'weak' | 'obj' | 'vec' | 'set' | 'stream'
const obj = (klass, props) => ({ klass, props });
/** Name of a vector / set (elements get "{hex}" appended, so long names are shortened to fit 31 characters). */
const collName = (s) => (s.length > 21 ? s.slice(0, 8) + '-' + s.slice(-12) : s);

/** Turn an object into a CFB storage node named `name`. */
function storage(o, name) {
  const node = { name, clsid: auid(o.klass), children: [] };
  const ents = []; const vals = [];
  for (const [pid, kind, value, pname, extra] of o.props) {
    const base = `${pname}-${pid.toString(16).padStart(4, '0')}`;
    if (kind === 'data') { ents.push([pid, SF.DATA]); vals.push(value); }
    else if (kind === 'weak') { ents.push([pid, SF.WEAK]); vals.push(value); }
    else if (kind === 'stream') { ents.push([pid, SF.STREAM]); vals.push(cat(u8(0x55), str(base))); node.children.push({ name: base, data: value }); }
    else if (kind === 'obj') { ents.push([pid, SF.STRONG]); vals.push(str(base)); node.children.push(storage(value, base)); }
    else if (kind === 'vec' || kind === 'set') {
      const cn = collName(base); ents.push([pid, kind === 'vec' ? SF.VECTOR : SF.SET]); vals.push(str(cn));
      const n = value.length; const head = cat(u32(n), u32(n), u32(0xffffffff));
      let index;
      if (kind === 'vec') index = cat(head, ...value.map((_, i) => u32(i)));
      else { const { keyPid, keyOf } = extra; const keys = value.map(keyOf); index = cat(head, u16(keyPid), u8(keys[0]?.length || 16), ...value.map((_, i) => cat(u32(i), u32(1), keys[i]))); }
      node.children.push({ name: `${cn} index`, data: index });
      value.forEach((child, i) => node.children.push(storage(child, `${cn}{${i.toString(16)}}`)));
    } else throw new Error(`unknown property kind ${kind}`);
  }
  const head = cat(u8(0x4c), u8(32), u16(ents.length), ...ents.map(([pid, sf], i) => cat(u16(pid), u16(sf), u16(vals[i].length))));
  node.children.push({ name: 'properties', data: cat(head, ...vals) });
  return node;
}
/** Template node (definitions) → CFB node. */
const fromTemplate = (n) => (n.d !== undefined ? { name: n.n, data: b64(n.d) } : { name: n.n, clsid: auid(n.c), children: (n.k || []).map(fromTemplate) });

// ---- AAF objects ----
const slot = (id, rate, segment, { name = '', track } = {}) => obj(CLASS.TimelineMobSlot, [
  [0x4801, 'data', u32(id), 'SlotID'], [0x4802, 'data', str(name), 'SlotName'],
  ...(track ? [[0x4804, 'data', u32(track), 'PhysicalTrackNumber']] : []),
  [0x4b01, 'data', rational(rate), 'EditRate'], [0x4b02, 'data', i64(0), 'Origin'], [0x4803, 'obj', segment, 'Segment']]);
const sourceClip = (kind, len, start, ref, refSlot) => obj(CLASS.SourceClip, [
  [0x0201, 'weak', dataDef(kind), 'DataDefinition'], [0x0202, 'data', i64(len), 'Length'], [0x1201, 'data', i64(start), 'StartTime'],
  [0x1101, 'data', ref, 'SourceID'], [0x1102, 'data', u32(refSlot), 'SourceMobSlotID']]);
const filler = (kind, len) => obj(CLASS.Filler, [[0x0201, 'weak', dataDef(kind), 'DataDefinition'], [0x0202, 'data', i64(len), 'Length']]);
const sequence = (kind, len, comps) => obj(CLASS.Sequence, [[0x0201, 'weak', dataDef(kind), 'DataDefinition'], [0x0202, 'data', i64(len), 'Length'], [0x1001, 'vec', comps, 'Components']]);
const mobProps = (id, name, now, slots) => [[0x4401, 'data', id, 'MobID'], [0x4402, 'data', str(name), 'Name'], [0x4403, 'vec', slots, 'Slots'], [0x4404, 'data', now, 'LastModified'], [0x4405, 'data', now, 'CreationTime']];

/**
 * Build an AAF file. Times are in samples at `sampleRate` (the audio slots' edit rate).
 * spec = { name, fps, sampleRate, sources: [{ name, pcm: Uint8Array (interleaved little-endian), channels, bits, samples }],
 *          tracks: [{ name, clips: [{ source, start, len, offset }] }], date?, seed? }
 * Returns { chunks } (CFB byte chunks, written one after another) and the mob ids for checks.
 */
export function buildAAF(spec) {
  const SR = spec.sampleRate || 48000; const now = timestamp(spec.date || new Date());
  let seed = spec.seed ?? Math.floor(Math.random() * 2 ** 31); const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const id = () => mobId(rand16(rng)); const zeroId = new Uint8Array(32);
  const mobs = []; const essence = []; const masters = [];
  for (const s of spec.sources) {
    const bits = s.bits || 24, ch = s.channels || 1, align = (bits / 8) * ch;
    if (s.pcm.length !== s.samples * align) throw new Error(`source ${s.name}: ${s.pcm.length} bytes is not ${s.samples} samples × ${align}`);
    const srcId = id(), mId = id();
    const desc = obj(CLASS.PCMDescriptor, [
      [0x3001, 'data', rational(SR), 'SampleRate'], [0x3002, 'data', i64(s.samples), 'Length'],
      ...(CD_INDEX >= 0 ? [[0x3004, 'weak', weak(CD_INDEX, CONTAINER_AAF), 'ContainerFormat']] : []),
      [0x3d03, 'data', rational(SR), 'AudioSamplingRate'], [0x3d07, 'data', u32(ch), 'Channels'], [0x3d01, 'data', u32(bits), 'QuantizationBits'],
      [0x3d0a, 'data', u16(align), 'BlockAlign'], [0x3d09, 'data', u32(align * SR), 'AverageBPS']]);
    mobs.push(obj(CLASS.SourceMob, [...mobProps(srcId, s.name, now, [slot(1, SR, sourceClip('Sound', s.samples, 0, zeroId, 0))]), [0x4701, 'obj', desc, 'EssenceDescription']]));
    mobs.push(obj(CLASS.MasterMob, mobProps(mId, s.name, now, [slot(1, SR, sourceClip('Sound', s.samples, 0, srcId, 1))])));
    essence.push(obj(CLASS.EssenceData, [[0x2701, 'data', srcId, 'MobID'], [0x2702, 'stream', s.pcm, 'Data']]));
    masters.push({ id: mId, samples: s.samples });
  }
  // composition: one slot per track (sorted by start, gaps become filler), then a timecode slot
  const fps = Math.round(spec.fps || 25); const slots = []; let total = 0;
  spec.tracks.forEach((t, ti) => {
    const comps = []; let at = 0;
    for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
      const m = masters[c.source]; if (!m) throw new Error(`clip refers to missing source ${c.source}`);
      let start = Math.round(c.start), off = Math.round(c.offset || 0), len = Math.round(c.len);
      if (start < at) { const cut = at - start; start += cut; off += cut; len -= cut; } // overlap: keep the earlier clip
      len = Math.min(len, m.samples - off); if (len <= 0) continue;
      if (start > at) comps.push(filler('Sound', start - at));
      comps.push(sourceClip('Sound', len, off, m.id, 1)); at = start + len;
    }
    total = Math.max(total, at);
    slots.push({ t, ti, comps, len: at });
  });
  const compSlots = slots.map(({ t, ti, comps, len }) => slot(ti + 1, SR, sequence('Sound', len, comps), { name: t.name || `A${ti + 1}`, track: ti + 1 }));
  const tcLen = Math.ceil((total / SR) * fps);
  const tc = obj(CLASS.Timecode, [[0x0201, 'weak', dataDef('Timecode'), 'DataDefinition'], [0x0202, 'data', i64(tcLen), 'Length'], [0x1501, 'data', i64(0), 'Start'], [0x1502, 'data', u16(fps), 'FPS'], [0x1503, 'data', bool(false), 'Drop']]);
  compSlots.push(slot(slots.length + 1, fps, tc, { name: 'TC1', track: 1 }));
  const compId = id();
  mobs.unshift(obj(CLASS.CompositionMob, [...mobProps(compId, spec.name || 'Sequence', now, compSlots), [0x4408, 'data', auid(USAGE_TOP_LEVEL), 'UsageCode']]));

  const content = obj(CLASS.ContentStorage, [
    [0x1901, 'set', mobs, 'Mobs', { keyPid: 0x4401, keyOf: (m) => m.props.find((p) => p[0] === 0x4401)[2] }],
    [0x1902, 'set', essence, 'EssenceData', { keyPid: 0x2701, keyOf: (e) => e.props.find((p) => p[0] === 0x2701)[2] }]]);
  const ident = obj(CLASS.Identification, [
    [0x3c01, 'data', str('BYS'), 'CompanyName'], [0x3c02, 'data', str('EditorStage'), 'ProductName'], [0x3c04, 'data', str(spec.version || '1.0'), 'ProductVersionString'],
    [0x3c05, 'data', auid('5d1f1e8a-6c1b-4f0e-9a52-3b1e6a2d7c41'), 'ProductID'], [0x3c06, 'data', now, 'Date'], [0x3c08, 'data', str('EditorStage'), 'Platform'], [0x3c09, 'data', rand16(rng), 'GenerationAUID']]);
  const header = storage(obj(CLASS.Header, [
    [0x3b01, 'data', u16(0x4949), 'ByteOrder'], [0x3b02, 'data', now, 'LastModified'], [0x3b03, 'obj', content, 'Content'],
    [0x3b05, 'data', new Uint8Array([1, 2]), 'Version'], [0x3b06, 'vec', [ident], 'IdentificationList'], [0x3b07, 'data', u32(1), 'ObjectModelVersion'],
    [0x3b09, 'data', auid(OP_EDIT_PROTOCOL), 'OperationalPattern']]), 'Header-2');
  // the dictionary storage is the template's; Header's properties reference it as a strong object
  header.children.push(fromTemplate(TEMPLATE.dictionary));
  const hp = header.children.find((c) => c.name === 'properties');
  hp.data = addStrongRef(hp.data, 0x3b04, TEMPLATE.dictionary.n);

  const refs = cat(u8(0x4c), u16(WEAK_PATHS.length), u32(WEAK_PATHS.reduce((a, p) => a + p.length + 1, 0)), ...WEAK_PATHS.map((p) => cat(...p.map(u16), u16(0))));
  const rootProps = cat(u8(0x4c), u8(32), u16(2), u16(0x0001), u16(SF.STRONG), u16(str(TEMPLATE.metaDictionary.n).length), u16(0x0002), u16(SF.STRONG), u16(str('Header-2').length), str(TEMPLATE.metaDictionary.n), str('Header-2'));
  const root = { name: 'Root Entry', clsid: auid(TEMPLATE.rootClass), children: [fromTemplate(TEMPLATE.metaDictionary), header, { name: 'properties', data: rootProps }, { name: 'referenced properties', data: refs }] };
  return { chunks: writeCFB(root), compositionId: hex(compId), masterIds: masters.map((m) => hex(m.id)) };
}

/** Append one strong-reference property to an encoded property stream. */
function addStrongRef(stream, pid, childName) {
  const v = new DataView(stream.buffer, stream.byteOffset, stream.byteLength); const n = v.getUint16(2, true);
  const ents = stream.subarray(4, 4 + n * 6), vals = stream.subarray(4 + n * 6), val = str(childName);
  return cat(u8(0x4c), u8(32), u16(n + 1), ents, u16(pid), u16(SF.STRONG), u16(val.length), vals, val);
}
