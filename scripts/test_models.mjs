// Optional AI model packs (electron/models.js) and Smart B-Roll scoring by meaning (src/Services/ai/brollScore.js).
// Phase 9 audit items D9 / D15. The download is tested against a local HTTP server standing in for huggingface.co.
// Run: node scripts/test_models.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { cosine, meaningScore, packVec, describeMedia, MIN_SIM, FULL_SIM } from '../src/Services/ai/brollScore.js';
const require = createRequire(import.meta.url);
const models = require('../electron/models.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-models-'));

// ---- the pack table
const { PACKS } = models;
ok('packs: Whisper Small, Whisper Medium and the multilingual sentence model', ['whisper-small', 'whisper-medium', 'multilingual-embed'].every((k) => PACKS[k]));
for (const [id, p] of Object.entries(PACKS)) {
  ok(`${id}: pinned to a commit`, /^[0-9a-f]{40}$/.test(p.rev));
  ok(`${id}: every file has a size and a hash`, p.files.every(([f, n, h]) => f && n > 0 && /^([0-9a-f]{40}|[0-9a-f]{64})$/.test(h)));
  ok(`${id}: big files are checked by SHA-256`, p.files.filter(([, n]) => n > 1e7).every(([, , h]) => h.length === 64));
  ok(`${id}: no file path leaves the pack folder`, p.files.every(([f]) => !f.split('/').includes('..') && !path.isAbsolute(f)));
}
ok('Whisper Small / Medium ship the quantized encoder + decoder (q8)', ['whisper-small', 'whisper-medium'].every((k) => PACKS[k].files.some(([f]) => f === 'onnx/encoder_model_quantized.onnx') && PACKS[k].files.some(([f]) => f === 'onnx/decoder_model_merged_quantized.onnx')));
ok('pack sizes: small < 300 MB, medium < 1.1 GB, sentence model < 150 MB', models.packSize(PACKS['whisper-small']) < 3e8 && models.packSize(PACKS['whisper-medium']) < 1.1e9 && models.packSize(PACKS['multilingual-embed']) < 1.5e8);

// ---- hashes
const f1 = path.join(tmp, 'a.txt'); fs.writeFileSync(f1, 'hello\n');
ok('Git blob SHA-1 of a small file', (await models.hashFile(f1, 'gitsha1')) === 'ce013625030ba8dba906f756967f9e9ca394464a');
ok('SHA-256 of a file', (await models.hashFile(f1, 'sha256')) === crypto.createHash('sha256').update('hello\n').digest('hex'));

// ---- download from a stand-in server: a fake pack with one small (Git SHA-1) and one big (SHA-256) file
const small = Buffer.from('{"model_type":"test"}');
const big = crypto.randomBytes(300000);
const gitsha = (b) => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
PACKS.test = { label: 'test', repo: 'org/test', rev: 'a'.repeat(40), dir: 'test/pack', files: [['config.json', small.length, gitsha(small)], ['onnx/model.onnx', big.length, crypto.createHash('sha256').update(big).digest('hex')]] };
let serve = { 'config.json': small, 'onnx/model.onnx': big }; let hits = []; let slow = false;
const srv = http.createServer((req, res) => {
  hits.push(req.url); const m = /^\/org\/test\/resolve\/a{40}\/(.+)$/.exec(req.url); const b = m && serve[m[1]];
  if (!b) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Length': b.length });
  if (!slow) return res.end(b);
  let i = 0; const t = setInterval(() => { if (i >= b.length || res.destroyed) { clearInterval(t); return res.end(); } res.write(b.subarray(i, i + 4096)); i += 4096; }, 5);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const root = path.join(tmp, 'models');
let prog = [];
const dir = await models.downloadPack('test', root, { base, onProgress: (p) => prog.push(p) });
ok('download: files land in <root>/<dir>/', dir === path.join(root, 'test', 'pack') && fs.readFileSync(path.join(dir, 'onnx', 'model.onnx')).equals(big));
ok('download: asks for the pinned revision', hits.every((u) => u.includes('/resolve/' + 'a'.repeat(40) + '/')), hits.join(' '));
ok('download: progress reaches the pack size', prog.length > 0 && prog.at(-1).got === big.length + small.length && prog.at(-1).total === big.length + small.length);
ok('download: no .part file left', !fs.existsSync(path.join(dir, 'onnx', 'model.onnx.part')));
ok('packDir finds the installed pack', models.packDir('test', [path.join(tmp, 'nothing'), root]) === dir);
hits = []; await models.downloadPack('test', root, { base });
ok('download again: files already in place are not fetched', hits.length === 0, hits.join(' '));

// a file changed on the server (same size) is refused and not installed
fs.rmSync(path.join(dir, 'onnx', 'model.onnx'));
const bad = Buffer.from(big); bad[1000] ^= 0xff; serve = { ...serve, 'onnx/model.onnx': bad };
let err = null; try { await models.downloadPack('test', root, { base }); } catch (e) { err = e; }
ok('download: a file that does not match its hash is refused', err && /does not match/.test(err.message), String(err));
ok('download: the refused file is removed (no file, no .part)', !fs.existsSync(path.join(dir, 'onnx', 'model.onnx')) && !fs.existsSync(path.join(dir, 'onnx', 'model.onnx.part')));
ok('packDir: a pack with a missing file is not installed', models.packDir('test', [root]) === null);
// more data than listed
serve = { ...serve, 'onnx/model.onnx': Buffer.concat([big, Buffer.alloc(10)]) }; err = null;
try { await models.downloadPack('test', root, { base }); } catch (e) { err = e; }
ok('download: a server sending more than the listed size is refused', err && /more data/.test(err.message), String(err));
// missing on the server
serve = { 'config.json': small }; err = null;
try { await models.downloadPack('test', root, { base }); } catch (e) { err = e; }
ok('download: HTTP 404 is an error', err && /HTTP 404/.test(err.message), String(err));
// cancel
serve = { 'config.json': small, 'onnx/model.onnx': big }; slow = true; const ac = new AbortController(); err = null;
const pr = models.downloadPack('test', root, { base, signal: ac.signal, onProgress: (p) => { if (p.file === 'onnx/model.onnx' && p.got > small.length + 20000) ac.abort(); } });
try { await pr; } catch (e) { err = e; }
ok('download: Cancel stops it', err && /Cancelled|abort/i.test(err.message), String(err));
ok('download: a cancelled file leaves nothing behind', !fs.existsSync(path.join(dir, 'onnx', 'model.onnx')) && !fs.existsSync(path.join(dir, 'onnx', 'model.onnx.part')));
slow = false;
let unk = null; try { await models.downloadPack('nope', root, { base }); } catch (e) { unk = e; }
ok('download: an unknown pack id is refused', unk && /unknown/.test(unk.message));
srv.close();

// ---- es-app://app/models/<rel> resolution
fs.mkdirSync(path.join(tmp, 'dist', 'whisper', 'whisper-base'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'dist', 'whisper', 'whisper-base', 'config.json'), '{}');
const roots = [path.join(tmp, 'dist'), root];
ok('model file: bundled file comes from dist/models', models.resolveModelFile('whisper/whisper-base/config.json', roots) === path.join(tmp, 'dist', 'whisper', 'whisper-base', 'config.json'));
ok('model file: a downloaded pack file comes from userData/models', models.resolveModelFile('test/pack/config.json', roots) === path.join(root, 'test', 'pack', 'config.json'));
ok('model file: missing -> null (404)', models.resolveModelFile('whisper/whisper-small/config.json', roots) === null);
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'x');
ok('model file: ../ cannot leave the model folders', models.resolveModelFile('../secret.txt', roots) === null && models.resolveModelFile('test/../../secret.txt', roots) === null);

// ---- IPC handlers with a fake ipcMain / app
const handlers = {}; const ipc = { handle: (k, f) => { handlers[k] = f; } };
const app = { getPath: () => path.join(tmp, 'user') };
models.install(ipc, app);
const list = await handlers['models:list']();
ok('models:list: every pack with its size, nothing installed yet', list.length === Object.keys(PACKS).length && list.every((p) => p.bytes > 0 && p.installed === false && p.label));
let e2 = null; try { await handlers['models:download']({ sender: {} }, 'not-a-pack'); } catch (e) { e2 = e; }
ok('models:download: only listed packs', e2 && /unknown/.test(e2.message));
ok('models:cancel: nothing running -> false', (await handlers['models:cancel'](null, 'whisper-small')) === false);

// ---- scoring by meaning
const u = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
ok('cosine: same direction 1, opposite -1, orthogonal 0', Math.abs(cosine([1, 2, 3], [2, 4, 6]) - 1) < 1e-9 && Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-9 && cosine([1, 0], [0, 1]) === 0);
ok('cosine: missing / different sizes -> 0', cosine(null, [1]) === 0 && cosine([1, 2], [1]) === 0 && cosine([], []) === 0 && cosine([0, 0], [1, 1]) === 0);
ok('meaningScore: 0 below the threshold, 1 at FULL_SIM, rising between', meaningScore(MIN_SIM - 0.1) === 0 && meaningScore(MIN_SIM) === 0 && Math.abs(meaningScore(FULL_SIM) - 1) < 1e-9 && meaningScore((MIN_SIM + FULL_SIM) / 2) > 0.4 && meaningScore((MIN_SIM + FULL_SIM) / 2) < 0.6);
const v = u([0.123456, -0.98765, 0.5]); const pv = packVec(Float32Array.from(v));
ok('packVec: plain array, 4 decimals, cosine unchanged', Array.isArray(pv) && pv.every((x) => Math.round(x * 1e4) === x * 1e4) && Math.abs(cosine(pv, v) - 1) < 1e-6);
ok('describeMedia: name words + what the picture shows + speech', describeMedia('DogWalk_in-park.mp4', [['dog', 1, 'picture'], ['walk', 1, 'name']], [{ text: 'hello' }, { text: ' there' }]) === 'Dog Walk in park. shows dog. hello there');
ok('describeMedia: name only', describeMedia('beach.jpg') === 'beach');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
