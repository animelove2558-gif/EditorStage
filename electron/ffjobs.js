// FFmpeg encode jobs: raw frames are piped into a process's stdin. Several can run at once (Export Queue, generated media).
// Kept free of Electron so scripts/test_jobs.mjs can run it in Node. Also tracks every child process EditorStage starts,
// so they can all be stopped when the app quits (on Windows children outlive their parent).
const { spawn } = require('child_process');
const fs = require('fs');

const children = new Set();
/** spawn() that is registered for killAll(). */
function track(p) { children.add(p); const drop = () => children.delete(p); p.once('close', drop); p.once('error', drop); return p; }
const spawnTracked = (bin, args, opts = { windowsHide: true }) => track(spawn(bin, args, opts));
/** Stop every child process still running (app quit). Returns how many were stopped. */
function killAll() { let n = 0; for (const p of children) { if (p.exitCode === null && !p.killed) { try { p.kill(); n++; } catch { /* gone */ } } } children.clear(); return n; }
const running = () => [...children].filter((p) => p.exitCode === null && !p.killed).length;

function createJobs(ffmpegPath) {
  const jobs = new Map(); // id -> { p, err, progress }
  function jobStart(id, args) {
    const bin = ffmpegPath();
    if (!bin || !fs.existsSync(bin)) return { ok: false, error: 'FFmpeg binary not available' };
    if (jobs.has(id)) { try { jobs.get(id).p.kill(); } catch { /* gone */ } }
    const p = spawnTracked(bin, args);
    // the exit is recorded as soon as it happens: jobEnd after the encoder already died must not wait for a 'close' that never comes
    let markExit; const j = { p, err: '', exit: null, exited: new Promise((r) => { markExit = r; }) }; jobs.set(id, j);
    const finish = (code, error) => { if (j.exit) return; j.exit = { code, error }; markExit(j.exit); };
    p.stderr.on('data', (d) => { j.err = (j.err + d).slice(-1500); });
    p.stdin.on('error', () => {});
    p.on('error', (e) => finish(-1, String(e.message || e)));
    p.on('close', (code) => finish(code));
    return { ok: true };
  }
  const jobWrite = (id, buf) => new Promise((resolve) => {
    const j = jobs.get(id); if (!j || j.exit || j.p.exitCode !== null || !j.p.stdin.writable) return resolve(false); // the encoder already stopped
    let settled = false; const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    j.exited.then(() => done(false));
    try {
      const okw = j.p.stdin.write(Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
      if (okw) done(true); else j.p.stdin.once('drain', () => done(true));
    } catch { done(false); }
  });
  const jobResult = (j) => (j.exit.code === 0 ? { ok: true } : { ok: false, error: j.exit.error || j.err.trim().split('\n').slice(-2).join(' ') || `ffmpeg exit ${j.exit.code}` });
  /** Close the encoder's input and wait for it to finish; resolves at once when the process already exited. */
  const jobEnd = async (id) => {
    const j = jobs.get(id); if (!j) return { ok: false, error: 'no export running' };
    jobs.delete(id);
    if (!j.exit) { try { j.p.stdin.end(); } catch { /* already closed */ } }
    await j.exited;
    return jobResult(j);
  };
  const jobCancel = (id) => { const j = jobs.get(id); if (j) { try { j.p.kill(); } catch { /* gone */ } jobs.delete(id); } return true; };
  return { jobStart, jobWrite, jobEnd, jobCancel, jobs };
}

module.exports = { createJobs, spawnTracked, track, killAll, running };
