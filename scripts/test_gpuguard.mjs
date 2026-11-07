// Crash-loop detection (audit C-07b), driven with a stand-in for Electron against a real temp folder. Run: node scripts/test_gpuguard.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const G = createRequire(import.meta.url)('../electron/gpuGuard.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'es-gpuguard-'));

function launch() {
  const app = Object.assign(new EventEmitter(), { hw: true, relaunched: 0, exited: 0, getPath: () => dir, disableHardwareAcceleration() { this.hw = false; }, whenReady: () => new Promise(() => {}), relaunch() { this.relaunched++; }, exit() { this.exited++; } });
  const handlers = {}; const ipcMain = { handle: (k, f) => { handlers[k] = f; } };
  const guard = G.install({ app, ipcMain });
  return { app, handlers, guard };
}
const reset = () => fs.rmSync(path.join(dir, 'gpu-guard.json'), { force: true });

reset(); let a = launch();
ok('a first launch stays on hardware graphics', a.app.hw && a.guard.state().mode === 'default');
a.app.emit('will-quit');
a = launch(); ok('a normal quit does not count as a crash', a.app.hw && a.guard.state().quickDeaths === 0);
// quick deaths: launch without will-quit, again and again
a.app.emit('will-quit'); reset();
launch(); let b = launch();
ok('one quick death changes nothing yet', b.app.hw && b.guard.state().quickDeaths === 1);
b = launch();
ok('two quick deaths in a row: software graphics', !b.app.hw && b.guard.state().mode === 'software' && /launches/.test(b.guard.state().reason));
b.app.emit('will-quit');
b = launch(); ok('software graphics stays on the next launch', !b.app.hw);
ok('the renderer can read why', b.handlers['app:gpu-status']().mode === 'software');
b.handlers['app:gpu-use-default']();
ok('Use default graphics relaunches', b.app.relaunched === 1 && b.app.exited === 1);
b = launch(); ok('...and hardware graphics is back', b.app.hw && b.guard.state().mode === 'default');
// a survivor in between clears the count
b.app.emit('will-quit'); reset();
launch(); let c = launch(); c.app.emit('will-quit'); launch(); c = launch();
ok('a good run in between resets the count', c.app.hw && c.guard.state().quickDeaths === 1, JSON.stringify(c.guard.state()));
// GPU process deaths
c.app.emit('will-quit'); reset(); const d = launch();
d.app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed' });
d.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'clean-exit' });
d.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
ok('one GPU crash: no relaunch', d.app.relaunched === 0);
d.app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' });
ok('two GPU crashes: relaunch in software graphics', d.app.relaunched === 1 && d.guard.state().mode === 'software');
const e = launch(); ok('the relaunch starts in software graphics, not counted as a crash', !e.app.hw && e.guard.state().quickDeaths === 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`gpu guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
