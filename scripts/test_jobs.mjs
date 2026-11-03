// Encode jobs of the main process (electron/ffjobs.js), run in Node with Node itself standing in for FFmpeg.
// Phase 8 audit E10 (Export hung for ever when the encoder died mid-way) and E16 (child processes stopped on quit).
// Run: node scripts/test_jobs.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createJobs, spawnTracked, killAll, running } = require('../electron/ffjobs.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = createJobs(() => process.execPath);
const frame = new Uint8Array(64 * 1024);

// a well-behaved encoder: reads stdin to the end, exits 0
{
  const st = J.jobStart('a', ['-e', "process.stdin.on('data',()=>{});process.stdin.on('end',()=>process.exit(0))"]);
  ok('job starts', st.ok);
  ok('write to a running encoder succeeds', (await J.jobWrite('a', frame)) === true);
  const r = await withTimeout(J.jobEnd('a'), 5000);
  ok('end of a finished encode resolves ok', r !== 'TIMEOUT' && r.ok === true, JSON.stringify(r));
}
// the encoder dies before the frames are written (disk full, unsupported size...)
{
  J.jobStart('b', ['-e', "console.error('Error: No space left on device');process.exit(3)"]);
  await sleep(600); // it is gone now
  const w = await withTimeout(J.jobWrite('b', frame), 5000);
  ok('write after the encoder died returns false (no hang)', w === false, String(w));
  const r = await withTimeout(J.jobEnd('b'), 5000);
  ok('end after the encoder died resolves at once', r !== 'TIMEOUT', String(r));
  ok('...with the encoder error', r.ok === false && /No space left/.test(r.error), JSON.stringify(r));
}
// the encoder dies while a write waits for drain
{
  J.jobStart('c', ['-e', 'setTimeout(()=>process.exit(5),300)']); // never reads stdin
  const big = new Uint8Array(8 << 20);
  const w = await withTimeout(J.jobWrite('c', big), 5000);
  ok('a write blocked on a dying encoder resolves', w !== 'TIMEOUT', String(w));
  const r = await withTimeout(J.jobEnd('c'), 5000);
  ok('...and end reports the exit code', r !== 'TIMEOUT' && r.ok === false && /5/.test(r.error), JSON.stringify(r));
}
// a missing binary
{
  const J2 = createJobs(() => 'Z:\\nope\\ffmpeg.exe');
  ok('a missing FFmpeg binary is reported, not spawned', J2.jobStart('x', []).ok === false);
  ok('end of an unknown job resolves', (await J.jobEnd('nope')).ok === false);
}
// cancel
{
  J.jobStart('d', ['-e', 'setInterval(()=>{},1000)']);
  const t0 = Date.now(); await J.jobCancel('d');
  ok('cancel waits until the encoder exited (its file is released)', Date.now() - t0 < 3000 && running() === 0, String(running()));
  ok('write after cancel returns false', (await J.jobWrite('d', frame)) === false);
}
// E16: every child process is stopped when the app quits
{
  const p1 = spawnTracked(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  J.jobStart('e', ['-e', 'setInterval(()=>{},1000)']);
  await sleep(200);
  ok('running children are counted', running() >= 2, String(running()));
  const closed = new Promise((r) => p1.once('close', r));
  const n = killAll();
  ok('killAll stops them', n >= 2, String(n));
  ok('...the processes really exit', (await withTimeout(closed, 5000)) !== 'TIMEOUT');
  ok('nothing is left running', running() === 0);
}

console.log(`jobs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
