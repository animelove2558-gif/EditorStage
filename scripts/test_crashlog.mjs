// Crash log (electron/crashLog.js), the crash-loop counter, page error forwarding, and config checks for the crash work
// (audit C-02, C-01, C-15, C-07). Run: node scripts/test_crashlog.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const L = require(path.join(root, 'electron', 'crashLog.js'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-log-'));
ok('log before setDir is a no-op that does not throw', L.log('x', 'y') === false);
L.setDir(path.join(dir, 'logs'));
ok('log writes an entry', L.log('test', new Error('boom')) === true);
const text = fs.readFileSync(L.logFile(), 'utf8');
ok('entry has time, kind and the stack', /^\d{4}-\d\d-\d\dT.* \[test\] Error: boom/.test(text) && text.includes('test_crashlog.mjs'));
ok('multi-line messages stay inside one entry', (L.log('k', 'a\nb\r\nc'), fs.readFileSync(L.logFile(), 'utf8').split('\n').filter((l) => /\[k\]/.test(l)).length === 1));
const big = 'x'.repeat(3900);
for (let i = 0; i < 400; i++) L.log('fill', big);
const files = fs.readdirSync(path.join(dir, 'logs')).sort();
ok('log rotates and keeps at most 3 files', files.length === 3 && files.includes('editorstage.1.log') && files.includes('editorstage.2.log'), files.join());
ok('the current log stays under the size cap plus one entry', fs.statSync(L.logFile()).size < L.MAX_BYTES + 5000);
L.setDir(path.join(dir, 'a\0b')); ok('an unusable folder never throws', L.log('x', 'y') === false);

let t = 0; const burst = L.createBurst(2, 60000, () => t);
ok('1st and 2nd crash in a minute are allowed', !burst.hit() && !burst.hit());
ok('3rd crash within a minute stops the reloads', burst.hit() === true);
t = 61000; ok('after a quiet minute reloading is allowed again', burst.hit() === false);

// page side: reportError dedupes and caps
const calls = []; globalThis.window = { editorstage: { logError: (k, m) => calls.push([k, m]) } };
const outFile = path.join(dir, 'errorLog.mjs');
await esbuild.build({ absWorkingDir: root, entryPoints: [path.join(root, 'src/Services/errorLog.js')], bundle: true, platform: 'node', format: 'esm', outfile: outFile, logLevel: 'error' });
const { reportError } = await import(pathToFileURL(outFile).href);
ok('reportError forwards once per distinct error', reportError('error', 'same text') && !reportError('error', 'same text') && calls.length === 1);
for (let i = 0; i < 40; i++) reportError('error', 'e' + i);
ok('reportError caps the entries per session', calls.length <= 20);

// config: flags removed, FFmpeg unpacked from the archive, single-instance lock taken first
const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
ok('unsafe WebGPU and GPU blocklist overrides are gone', !/enable-unsafe-webgpu|ignore-gpu-blocklist/.test(main.replace(/\/\/.*$/gm, '')));
ok('single-instance lock is taken before the app is ready', main.indexOf('requestSingleInstanceLock') < main.indexOf('app.whenReady'));
ok('main handles render-process-gone, unresponsive and child-process-gone', ['render-process-gone', 'unresponsive', 'child-process-gone'].every((e) => main.includes(`'${e}'`)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ok('electron-builder unpacks ffmpeg-static', (pkg.build.asarUnpack || []).some((g) => g.includes('ffmpeg-static')));
ok('the bundled ffmpeg binary exists', fs.existsSync(require('ffmpeg-static')));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`crashlog: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
