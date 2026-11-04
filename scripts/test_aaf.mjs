// AAF export (Phase 5C2): compound-file writer/reader, AAF object structure, embedded essence, clip selection.
// Run: node scripts/test_aaf.mjs   (set AAF_PYTHON=<python with pyaaf2> to also read the file back with pyaaf2)
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-aaf-'));
const entry = path.join(tmp, 'entry.js'); const out = path.join(tmp, 'bundle.mjs');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/Services/interchange/cfb.js'))};
export * from ${JSON.stringify(path.join(root, 'src/Services/interchange/aaf.js'))};
export { default as TEMPLATE } from ${JSON.stringify(path.join(root, 'src/Services/interchange/aafTemplate.js'))};
export { aafClips, clipGainAt, gainEnvelope, crossfades, aafVideo, SURROUND } from ${JSON.stringify(path.join(root, 'src/Services/interchange/aafExport.js'))};`);
await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error', loader: { '.js': 'jsx', '.wk': 'text' } });
const m = await import(pathToFileURL(out).href);

let pass = 0, fail = 0;
function ok(name, cond, extra = '') { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } }
const hex = (b) => Buffer.from(b).toString('hex');

// ---- compound file ----
ok('sibling order: shorter names first, then case-insensitive', ['b', 'A', 'aa', 'Ab'].sort(m.compareNames).join() === 'A,b,aa,Ab');
const rnd = (n, seed) => { const b = new Uint8Array(n); let s = seed; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2 ** 31; b[i] = s >> 16; } return b; };
const kids = Array.from({ length: 40 }, (_, i) => ({ name: `s${i}`, data: rnd(i * 37, i + 1) }));
const tree = { name: 'Root Entry', children: [...kids, { name: 'big', data: rnd(20000, 9) }, { name: 'sub', clsid: new Uint8Array(16).fill(7), children: [{ name: 'x', data: rnd(5000, 3) }, { name: 'y', data: new Uint8Array(0) }] }] };
const file = m.joinChunks(m.writeCFB(tree));
ok('CFB: whole 4096-byte sectors', file.length % 4096 === 0);
const rd = m.readCFB(file);
const find = (n, name) => n.children.find((c) => c.name === name);
ok('CFB: every mini stream reads back', kids.every((k) => hex(find(rd.tree, k.name).data()) === hex(k.data)));
ok('CFB: big stream + nested storage read back', hex(find(rd.tree, 'big').data()) === hex(tree.children[40].data) && hex(find(find(rd.tree, 'sub'), 'x').data()) === hex(tree.children[41].children[0].data) && find(find(rd.tree, 'sub'), 'y').size === 0);
ok('CFB: storage CLSID kept', hex(find(rd.tree, 'sub').clsid) === '07'.repeat(16));
// red-black tree: in-order = sorted, no red node with a red child, equal black height on every path
function rbCheck(E, i) {
  if (i === 0xffffffff) return { ok: true, bh: 1, names: [] };
  const e = E[i], l = rbCheck(E, e.left), r = rbCheck(E, e.right);
  const redKid = e.color === 0 && [e.left, e.right].some((j) => j !== 0xffffffff && E[j].color === 0);
  return { ok: l.ok && r.ok && !redKid && l.bh === r.bh, bh: l.bh + (e.color === 1 ? 1 : 0), names: [...l.names, e.name, ...r.names] };
}
const rb = rbCheck(rd.entries, rd.entries[0].child);
ok('CFB: directory is a valid red-black tree in name order', rb.ok && rb.names.join() === [...rb.names].sort(m.compareNames).join() && rb.names.length === 42);
ok('CFB: duplicate names are refused', (() => { try { m.writeCFB({ name: 'Root Entry', children: [{ name: 'a', data: new Uint8Array(1) }, { name: 'A', data: new Uint8Array(1) }] }); return false; } catch { return true; } })());

// ---- AAF ----
const SR = 48000;
const tone = (f, n) => { const b = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { const v = Math.round(Math.sin((2 * Math.PI * f * i) / SR) * 0.5 * 8388607); b[i * 3] = v & 255; b[i * 3 + 1] = (v >> 8) & 255; b[i * 3 + 2] = (v >> 16) & 255; } return b; };
const srcA = tone(440, 3 * SR), srcB = tone(880, 4000);
const spec = { name: 'Test Seq', fps: 25, sampleRate: SR, seed: 7, date: new Date(2026, 9, 26, 12, 0, 0),
  sources: [{ name: 'tone440', pcm: srcA, samples: 3 * SR }, { name: 'tiny', pcm: srcB, samples: 4000 }],
  tracks: [{ name: 'A1 L', clips: [{ source: 1, start: 3 * SR, len: 480, offset: 0 }, { source: 0, start: SR, len: SR, offset: SR / 2 }] },
    { name: 'A1 R', clips: [{ source: 0, start: 0, len: 2 * SR, offset: 0 }, { source: 1, start: SR, len: 4000, offset: 0 }] }] };
const built = m.buildAAF(spec); const aaf = m.joinChunks(built.chunks);
const A = m.readCFB(aaf);
// property stream decoder: { pid: { sf, v } }
const props = (stg) => { const d = find(stg, 'properties').data(); const v = new DataView(d.buffer); const n = v.getUint16(2, true); const o = {}; let at = 4 + n * 6;
  for (let i = 0; i < n; i++) { const pid = v.getUint16(4 + i * 6, true), sf = v.getUint16(6 + i * 6, true), len = v.getUint16(8 + i * 6, true); o[pid] = { sf, v: d.slice(at, at + len) }; at += len; } return o; };
const u16s = (b) => { let s = ''; for (let i = 0; i + 1 < b.length; i += 2) { const c = b[i] | (b[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); } return s; };
const i64 = (b) => Number(new DataView(b.buffer, b.byteOffset).getBigInt64(0, true));
const rp = props(A.tree);
ok('AAF: root names MetaDictionary + Header', u16s(rp[1].v) === 'MetaDictionary-1' && u16s(rp[2].v) === 'Header-2' && rp[1].sf === 0x22);
ok('AAF: root CLSID is the AAF file class', hex(A.tree.clsid) === hex(m.auid(m.TEMPLATE.rootClass)));
const header = find(A.tree, 'Header-2'); const hp = props(header);
ok('AAF: header has byte order, version, op pattern, content, dictionary', hex(hp[0x3b01].v) === '4949' && hex(hp[0x3b05].v) === '0102' && hp[0x3b03] && u16s(hp[0x3b04].v) === 'Dictionary-3b04' && hp[0x3b09]);
ok('AAF: dictionary copied from the template', !!find(find(header, 'Dictionary-3b04'), 'DataDefinitions-2605 index'));
const content = find(header, 'Content-3b03');
const mobIdx = find(content, 'Mobs-1901 index').data(); const miv = new DataView(mobIdx.buffer);
ok('AAF: mob set = 1 composition + master + source per clip channel', miv.getUint32(0, true) === 5 && miv.getUint16(12, true) === 0x4401 && mobIdx[14] === 32);
const mobs = [0, 1, 2, 3, 4].map((i) => find(content, `Mobs-1901{${i}}`));
const clsOf = (s) => hex(s.clsid).slice(12, 16);
ok('AAF: mob classes (CompositionMob, SourceMob, MasterMob)', clsOf(mobs[0]) === '0035' && mobs.filter((s) => clsOf(s) === '0037').length === 2 && mobs.filter((s) => clsOf(s) === '0036').length === 2, mobs.map(clsOf).join());
ok('AAF: set keys are the mob ids', mobs.every((s, i) => hex(props(s)[0x4401].v) === hex(mobIdx.slice(15 + i * 40 + 8, 15 + i * 40 + 40))));
const comp = mobs[0]; const cp = props(comp);
ok('AAF: composition is the top-level mob', hex(cp[0x4408].v) === hex(m.auid('0d010102-0101-0700-060e-2b3404010101')) && u16s(cp[0x4402].v) === 'Test Seq');
const slots = [0, 1, 2].map((i) => find(comp, `Slots-4403{${i}}`));
ok('AAF: 2 audio slots + timecode slot', !!slots[2] && !find(comp, 'Slots-4403{3}') && clsOf(find(slots[2], 'Segment-4803')) === '0014');
const comps = (slot) => { const seg = find(slot, 'Segment-4803'); const n = new DataView(find(seg, 'Components-1001 index').data().buffer).getUint32(0, true); return Array.from({ length: n }, (_, i) => { const c = find(seg, `Components-1001{${i.toString(16)}}`); const p = props(c); return { cls: clsOf(c), len: i64(p[0x0202].v), start: p[0x1201] ? i64(p[0x1201].v) : null }; }); };
const a1 = comps(slots[0]), a2 = comps(slots[1]);
ok('AAF: A1 = filler, clip (handle offset), filler, clip — in time order', a1.map((c) => c.cls).join() === '0009,0011,0009,0011' && a1[0].len === SR && a1[1].start === SR / 2 && a1[2].len === SR && a1[3].len === 480, JSON.stringify(a1));
ok('AAF: a clip hidden under an earlier one is dropped (its head is trimmed past its media)', a2.length === 1 && a2[0].len === 2 * SR, JSON.stringify(a2));
ok('AAF: audio slots run at the sample rate, physical track numbers 1, 2', slots.slice(0, 2).every((s, i) => { const p = props(s); return new DataView(p[0x4b01].v.buffer).getInt32(0, true) === SR && new DataView(p[0x4804].v.buffer).getUint32(0, true) === i + 1; }));
const essIdx = new DataView(find(content, 'EssenceData-1902 index').data().buffer);
const ess = [0, 1].map((i) => find(content, `EssenceData-1902{${i}}`));
ok('AAF: essence embedded byte-exact', essIdx.getUint32(0, true) === 2 && hex(find(ess[0], 'Data-2702').data()) === hex(srcA) && hex(find(ess[1], 'Data-2702').data()) === hex(srcB));
const srcMob = mobs.find((s) => clsOf(s) === '0037'); const desc = find(srcMob, 'EssenceDescription-4701'); const dp = props(desc);
ok('AAF: PCM descriptor 1 ch / 24 bit / 48 kHz / AAF container', clsOf(desc) === '0048' && new DataView(dp[0x3d07].v.buffer).getUint32(0, true) === 1 && new DataView(dp[0x3d01].v.buffer).getUint32(0, true) === 24 && new DataView(dp[0x3d0a].v.buffer).getUint16(0, true) === 3 && dp[0x3004].sf === 0x02);
ok('AAF: essence MobID = its source mob', hex(props(ess[0])[0x2701].v) === hex(props(srcMob)[0x4401].v));
const refs = find(A.tree, 'referenced properties').data();
ok('AAF: weak-reference tables = template + ContainerDefinitions', new DataView(refs.buffer).getUint16(1, true) === m.TEMPLATE.weakrefPaths.length + 1);
// the DataDefinition weak references point at keys the dictionary holds
const ddIdx = find(find(header, 'Dictionary-3b04'), 'DataDefinitions-2605 index').data();
const sound = hex(m.auid('01030202-0200-0000-060e-2b3404010101')), tcKey = hex(m.auid('01030201-0100-0000-060e-2b3404010101'));
ok('AAF: Sound and Timecode data definitions exist in the dictionary', hex(ddIdx).includes(sound) && hex(ddIdx).includes(tcKey));
ok('AAF: wrong PCM length is refused', (() => { try { m.buildAAF({ ...spec, sources: [{ name: 'x', pcm: new Uint8Array(10), samples: 4 }], tracks: [] }); return false; } catch { return true; } })());

// ---- which clips go into the file ----
const media = [{ id: 'a', kind: 'audio', name: 'a.wav', duration: 10 }, { id: 'v', kind: 'video', name: 'v.mp4', duration: 10 }, { id: 'n', kind: 'video', name: 'n.mp4', hasAudio: false }, { id: 'o', kind: 'audio', name: 'o.wav', status: 'offline' }, { id: 'i', kind: 'image', name: 'i.png' }];
const seq = { tracks: [{ id: 'V1', kind: 'video' }, { id: 'A1', kind: 'audio' }, { id: 'A2', kind: 'audio' }, { id: 'A3', kind: 'audio' }],
  clips: [{ id: 1, track: 'A1', start: 5, dur: 1, mediaId: 'a' }, { id: 2, track: 'A1', start: 0, dur: 1, mediaId: 'v' }, { id: 3, track: 'A2', start: 0, dur: 1, mediaId: 'n' }, { id: 4, track: 'A2', start: 2, dur: 1, mediaId: 'o' },
    { id: 5, track: 'A2', start: 3, dur: 1, mediaId: 'a', enabled: false }, { id: 6, track: 'V1', start: 0, dur: 1, mediaId: 'v' }, { id: 7, track: 'A2', start: 4, dur: 1, mediaId: 'i' }] };
const pick = m.aafClips(seq, media);
ok('clips: audio tracks only, sorted, trailing empty tracks dropped', pick.tracks.length === 1 && pick.tracks[0].clips.map((c) => c.clip.id).join() === '2,1', JSON.stringify(pick.tracks.map((t) => t.id)));
ok('clips: no-audio / offline / disabled / still clips skipped', pick.skipped === 4);

// ---- Phase 9 D10: volume / clip gain / pan, crossfades, 5.1 breakout, video reference ----
// the class and property ids of every object must be ones the file's own MetaDictionary defines (with inheritance)
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const tprops = (node) => { const p = node.k.find((c) => c.n === 'properties'); const d = b64(p.d); const v = new DataView(d.buffer); const n = v.getUint16(2, true); const o = {}; let at = 4 + n * 6;
  for (let i = 0; i < n; i++) { const pid = v.getUint16(4 + i * 6, true), len = v.getUint16(8 + i * 6, true); o[pid] = d.slice(at, at + len); at += len; } return o; };
const META = new Map(); // class AUID hex (stored bytes) -> { parent, pids:Set, name }
for (const c of m.TEMPLATE.metaDictionary.k.filter((x) => x.n.startsWith('ClassDefinitions') && x.n.includes('{'))) {
  const p = tprops(c); const pids = new Set(c.k.filter((x) => x.n.includes('{')).map((q) => new DataView(tprops(q)[0x0d].buffer).getUint16(0, true)));
  META.set(hex(p[5]), { parent: hex(p[8].slice(-16)), pids, name: u16s(p[6]) });
}
const allowed = (clsHex) => { const s = new Set(); let k = clsHex; for (let i = 0; i < 20 && META.has(k); i++) { const e = META.get(k); e.pids.forEach((x) => s.add(x)); if (e.parent === k) break; k = e.parent; } return s; };
function checkTree(stg, bad, where = '') {
  const clsHex = hex(stg.clsid); const pr = find(stg, 'properties');
  if (pr && where && clsHex !== '00'.repeat(16)) { // (the root storage is the file class, not an object)
    if (!META.has(clsHex)) bad.push(`${where}${stg.name}: unknown class ${clsHex}`);
    else { const ok2 = allowed(clsHex); for (const pid of Object.keys(props(stg)).map(Number)) if (!ok2.has(pid)) bad.push(`${where}${stg.name}: ${META.get(clsHex).name} has no property 0x${pid.toString(16)}`); }
  }
  for (const c of stg.children || []) if (c.children) checkTree(c, bad, where + stg.name + '/');
}
const SRC = (n, f) => ({ name: `t${f}`, pcm: tone(f, n), samples: n });
const env = [[0, 1], [0.5, 0.25], [1, 1]];
const spec2 = { name: 'FX', fps: 25, sampleRate: SR, seed: 3, date: new Date(2026, 10, 4),
  sources: [SRC(2 * SR, 440), SRC(2 * SR, 660), SRC(SR, 220)],
  tracks: [{ name: 'A1 L', clips: [
    { source: 0, start: 0, len: SR + SR / 4, offset: 0, gain: 0.5 },
    { source: 1, start: SR - SR / 4, len: SR + SR / 4, offset: SR / 2, xfadeIn: SR / 2, gain: env },
    { source: 2, start: 3 * SR, len: SR / 2, offset: 0, gain: 1 }] }],
  video: { sources: [{ name: 'shot.mp4', url: 'file:///D:/Media/shot%201.mp4', width: 1920, height: 1080, frames: 250 }], tracks: [{ name: 'V1', clips: [{ source: 0, start: 25, len: 50, offset: 10 }] }] } };
const B = m.readCFB(m.joinChunks(m.buildAAF(spec2).chunks));
const bh = find(B.tree, 'Header-2'); const bc = find(bh, 'Content-3b03'); const bdict = find(bh, 'Dictionary-3b04');
const bmobs = []; for (let i = 0; find(bc, `Mobs-1901{${i.toString(16)}}`); i++) bmobs.push(find(bc, `Mobs-1901{${i.toString(16)}}`));
const bcomp = bmobs.find((s) => clsOf(s) === '0035');
const bslots = []; for (let i = 0; find(bcomp, `Slots-4403{${i}}`); i++) bslots.push(find(bcomp, `Slots-4403{${i}}`));
const segOf = (sl) => find(sl, 'Segment-4803');
const kidsOf = (seg) => { const n = new DataView(find(seg, 'Components-1001 index').data().buffer).getUint32(0, true); return Array.from({ length: n }, (_, i) => find(seg, `Components-1001{${i.toString(16)}}`)); };
const ak = kidsOf(segOf(bslots[0]));
ok('D10: A1 = gain(clip), crossfade, gain(clip), filler, plain clip', ak.map(clsOf).join() === '000a,0017,000a,0009,0011', ak.map(clsOf).join());
const lenOf = (s) => i64(props(s)[0x0202].v);
ok('D10: sequence length = clips - crossfade overlap (+ filler)', lenOf(segOf(bslots[0])) === 3 * SR + SR / 2 && lenOf(ak[1]) === SR / 2 && i64(props(ak[1])[0x1802].v) === SR / 4, `${lenOf(segOf(bslots[0]))}`);
const opKey = (og) => hex(props(og)[0x0b01].v.slice(-16));
ok('D10: the crossfade is a Mono Audio Dissolve', opKey(find(ak[1], 'OperationGroup-1801')) === hex(m.auid('0c3bea41-fc05-11d2-8a29-0050040ef7d2')));
ok('D10: volume is a Mono Audio Gain around the clip', opKey(ak[0]) === hex(m.auid('9d2ea894-0968-11d3-8a38-0050040ef7d2')) && clsOf(find(ak[0], 'InputSegments-0b02{0}')) === '0011');
const rat = (b, o = 0) => { const v = new DataView(b.buffer, b.byteOffset); return v.getInt32(o, true) / v.getInt32(o + 4, true); };
const indirect = (b) => ({ order: b[0], type: hex(b.slice(1, 17)), value: rat(b, 17) });
const cv = find(ak[0], 'Parameters-0b03{0}'); const cvp = props(cv);
ok('D10: clip gain 0.5 = ConstantValue Amplitude 0.5 (Rational, indirect)', clsOf(cv) === '003d' && hex(cvp[0x4c01].v) === hex(m.auid('e4962321-2267-11d3-8a4c-0050040ef7d2')) && indirect(cvp[0x4d01].v).value === 0.5 && indirect(cvp[0x4d01].v).type === hex(m.auid('03010100-0000-0000-060e-2b3401040101')) && indirect(cvp[0x4d01].v).order === 0x4c);
const vv = find(ak[2], 'Parameters-0b03{0}'); const pts = []; for (let i = 0; find(vv, `PointList-4e02{${i}}`); i++) { const pp = props(find(vv, `PointList-4e02{${i}}`)); pts.push([rat(pp[0x1a03].v), indirect(pp[0x1a02].v).value]); }
ok('D10: volume keyframes = VaryingValue control points (time = fraction of the clip), linear interpolation', clsOf(vv) === '003e' && JSON.stringify(pts) === JSON.stringify(env) && hex(props(vv)[0x4e01].v.slice(-16)) === hex(m.auid('5b6c85a4-0ede-11d3-80a9-006008143e6f')), JSON.stringify(pts));
ok('D10: a clip at unity gain has no effect around it', clsOf(ak[4]) === '0011');
const setKeys = (stg, name) => { const d = find(stg, name).data(); const n = new DataView(d.buffer).getUint32(0, true); return Array.from({ length: n }, (_, i) => hex(d.slice(15 + i * 24 + 8, 15 + i * 24 + 24))); };
ok('D10: the dictionary defines the gain / dissolve operations, Amplitude and Linear', ['9d2ea894-0968-11d3-8a38-0050040ef7d2', '0c3bea41-fc05-11d2-8a29-0050040ef7d2'].every((k) => setKeys(bdict, 'Operatio-nitions-2603 index').includes(hex(m.auid(k))))
  && setKeys(bdict, 'Paramete-nitions-2604 index')[0] === hex(m.auid('e4962321-2267-11d3-8a4c-0050040ef7d2')) && setKeys(bdict, 'Interpol-nitions-2609 index')[0] === hex(m.auid('5b6c85a4-0ede-11d3-80a9-006008143e6f')));
const brefs = find(B.tree, 'referenced properties').data();
ok('D10: weak-reference tables + OperationDefinitions and InterpolationDefinitions', new DataView(brefs.buffer).getUint16(1, true) === m.TEMPLATE.weakrefPaths.length + 3);
const vslot = bslots.find((s) => clsOf(segOf(s)) === '000f' && hex(props(segOf(s))[0x0201].v.slice(-16)) === hex(m.auid('01030202-0100-0000-060e-2b3404010101')));
const vk = vslot ? kidsOf(segOf(vslot)) : [];
ok('D10: video reference track: filler 1 s, then the clip from frame 10 (25 fps edit rate)', vk.map(clsOf).join() === '0009,0011' && lenOf(vk[0]) === 25 && i64(props(vk[1])[0x1201].v) === 10 && lenOf(vk[1]) === 50 && rat(props(vslot)[0x4b01].v) === 25);
const vsrc = bmobs.find((s) => clsOf(s) === '0037' && clsOf(find(s, 'EssenceDescription-4701')) === '0028'); const vd = vsrc && find(vsrc, 'EssenceDescription-4701');
ok('D10: the video source is a CDCI descriptor 1920x1080 with a NetworkLocator to the file (not embedded)', vd && new DataView(props(vd)[0x3203].v.buffer).getUint32(0, true) === 1920 && u16s(props(find(vd, 'Locator-2f01{0}'))[0x4001].v) === 'file:///D:/Media/shot%201.mp4' && !find(bc, 'EssenceData-1902{3}'));
ok('D10: timecode runs to the end of the longest track', i64(props(segOf(bslots[bslots.length - 1]))[0x0202].v) === Math.max(Math.ceil(3.5 * 25), 75));
const bad = []; checkTree(B.tree, bad); checkTree(A.tree, bad);
ok('D10: every object class and property id is defined by the MetaDictionary (incl. the new effect / video objects)', bad.length === 0, bad.slice(0, 5).join(' | '));
ok('D10: crossfade not at the end of the clip before -> the overlap is trimmed as before (no Transition)', (() => {
  const sp = { ...spec2, video: null, tracks: [{ name: 'A1', clips: [{ source: 0, start: 0, len: SR, offset: 0 }, { source: 1, start: SR / 2, len: SR, offset: 0, xfadeIn: SR / 4 }] }] };
  const C = m.readCFB(m.joinChunks(m.buildAAF(sp).chunks)); const cm = find(find(find(C.tree, 'Header-2'), 'Content-3b03'), 'Mobs-1901{0}');
  const k = kidsOf(find(find(cm, 'Slots-4403{0}'), 'Segment-4803')); return k.map(clsOf).join() === '0011,0011'; })());
ok('D10: sliceEnvelope keeps the gain curve of the part that is left', JSON.stringify(m.sliceEnvelope([[0, 1], [1, 0]], 100, 50, 50)) === '[[0,0.5],[1,0]]' && JSON.stringify(m.sliceEnvelope([[0, 0], [0.5, 1], [1, 0]], 100, 25, 50)) === '[[0,0.5],[0.5,1],[1,0.5]]');
// export helpers
const kc = (o) => ({ id: 'k', start: 10, dur: 4, track: 'A1', enabled: true, ...o });
ok('D10: clip gain = Volume level (dB) x clip gain (dB)', Math.abs(m.clipGainAt(kc({ volume: { level: { v: -6, keys: null } }, audio: { gain: 6 } }), 1, 'L') - 1) < 1e-9 && Math.abs(m.clipGainAt(kc({ volume: { level: { v: -20, keys: null } } }), 1, 'C') - 0.1) < 1e-9);
ok('D10: Panner right 50 % -> L at half gain, R unchanged (balance)', Math.abs(m.clipGainAt(kc({ pan: { v: 50, keys: null } }), 0, 'L') - 0.5) < 1e-9 && m.clipGainAt(kc({ pan: { v: 50, keys: null } }), 0, 'R') === 1 && m.clipGainAt(kc({ pan: { v: 50, keys: null } }), 0, 'C') === 1);
ok('D10: no keyframes -> one constant gain', m.gainEnvelope(kc({ volume: { level: { v: -6, keys: null } } }), 'L', 0, 4) === m.clipGainAt(kc({ volume: { level: { v: -6, keys: null } } }), 0, 'L'));
const ke = m.gainEnvelope(kc({ volume: { level: { v: 0, keys: [{ t: 1, v: 0 }, { t: 3, v: -20 }] } } }), 'L', 0, 4);
ok('D10: Volume keyframes -> control points from 0 to 1 that follow the dB ramp within 0.5 %', Array.isArray(ke) && ke[0][0] === 0 && ke[ke.length - 1][0] === 1 && Math.abs(ke[0][1] - 1) < 1e-6 && Math.abs(ke[ke.length - 1][1] - 0.1) < 1e-4 && ke.length < 30
  && [1.5, 2, 2.5].every((t) => { const f = t / 4; const i = ke.findIndex((p) => p[0] >= f); const [a, b] = [ke[i - 1], ke[i]]; const g = a[1] + ((b[1] - a[1]) * (f - a[0])) / (b[0] - a[0]); const want = 10 ** ((-20 * (t - 1) / 2) / 20); return Math.abs(g - want) / want < 0.006; }), JSON.stringify(ke));
const xseq = { clips: [kc({ id: 'a', start: 0, dur: 5 }), kc({ id: 'b', start: 5, dur: 5 }), kc({ id: 'c', start: 12, dur: 2 })], transitions: [{ kind: 'audio', track: 'A1', aId: 'a', bId: 'b', at: 5, dur: 1 }, { kind: 'audio', track: 'A2', aId: 'a', bId: 'b', at: 5, dur: 1 }, { kind: 'video', track: 'A1', aId: 'b', bId: 'c', at: 12, dur: 1 }] };
const xf = m.crossfades(xseq, 'A1');
ok('D10: audio crossfades of a track (clips that meet), other tracks / video transitions ignored', xf.size === 1 && xf.get('b').dur === 1 && xf.get('b').aId === 'a');
const vseq = { tracks: [{ id: 'V2', kind: 'video' }, { id: 'V1', kind: 'video' }, { id: 'V3', kind: 'video', hidden: true }, { id: 'A1', kind: 'audio' }],
  clips: [{ id: 1, track: 'V1', start: 0, dur: 2, mediaId: 'v', enabled: true }, { id: 2, track: 'V2', start: 0, dur: 2, mediaId: 'img', enabled: true }, { id: 3, track: 'V1', start: 3, dur: 1, mediaId: 'v', enabled: true, speed: 2 }, { id: 4, track: 'V3', start: 0, dur: 1, mediaId: 'v', enabled: true }, { id: 5, track: 'V1', start: 5, dur: 1, mediaId: 'v', enabled: false }] };
const vv2 = m.aafVideo(vseq, [{ id: 'v', kind: 'video', path: 'D:/a.mp4', status: 'ready' }, { id: 'img', kind: 'image', path: 'D:/a.png' }]);
ok('D10: video reference: file clips at normal speed on visible tracks (no stills, retimed, disabled)', vv2.length === 1 && vv2[0].id === 'V1' && vv2[0].clips.map((x) => x.clip.id).join() === '1', JSON.stringify(vv2.map((t) => [t.id, t.clips.map((x) => x.clip.id)])));
ok('D10: 5.1 breakout order L R C LFE Ls Rs', m.SURROUND.join() === 'L,R,C,LFE,Ls,Rs');

// ---- optional: read back with pyaaf2 (dev check) ----
if (process.env.AAF_PYTHON) {
  const f = path.join(tmp, 'test.aaf'); fs.writeFileSync(f, aaf);
  const r = spawnSync(process.env.AAF_PYTHON, [path.join(root, 'scripts/aaf/verify_aaf.py'), f], { encoding: 'utf8' });
  ok('pyaaf2 reads the file: mobs, slots, essence', r.status === 0 && /OK/.test(r.stdout), r.stdout + r.stderr);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`aaf: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
