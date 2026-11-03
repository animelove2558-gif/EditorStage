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
export { aafClips } from ${JSON.stringify(path.join(root, 'src/Services/interchange/aafExport.js'))};`);
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

// ---- optional: read back with pyaaf2 (dev check) ----
if (process.env.AAF_PYTHON) {
  const f = path.join(tmp, 'test.aaf'); fs.writeFileSync(f, aaf);
  const r = spawnSync(process.env.AAF_PYTHON, [path.join(root, 'scripts/aaf/verify_aaf.py'), f], { encoding: 'utf8' });
  ok('pyaaf2 reads the file: mobs, slots, essence', r.status === 0 && /OK/.test(r.stdout), r.stdout + r.stderr);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`aaf: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
