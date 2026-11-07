// Crash-loop detection for the graphics stack (audit C-07b). A start marker is written at launch and cleared once the app has
// lived for a while. Two launches in a row that die within 15 s, or the GPU process dying twice in one session, move the app to
// software graphics (hardware acceleration off) until the user asks for the default back.
// decide() and the state handling are pure so they can be tested without Electron; install() does the wiring.
const fs = require('fs');
const path = require('path');

const ALIVE_AFTER_MS = 15000, QUICK_DEATHS = 2, GPU_DEATHS = 2;
const fresh = () => ({ mode: 'default', pending: false, quickDeaths: 0, reason: '' });

/** State after a launch, from the state the last one left. */
function onLaunch(prev) {
  const s = { ...fresh(), ...(prev || {}) };
  s.quickDeaths = s.pending ? s.quickDeaths + 1 : 0; // the marker is still there: the last launch died early
  if (s.mode !== 'software' && s.quickDeaths >= QUICK_DEATHS) { s.mode = 'software'; s.reason = `${s.quickDeaths} launches in a row ended within ${ALIVE_AFTER_MS / 1000} s`; s.quickDeaths = 0; }
  s.pending = true;
  return s;
}
/** The app survived the first seconds or quit by itself. */
const onAlive = (s) => ({ ...s, pending: false, quickDeaths: 0 });
/** The GPU process died; returns the state and whether to relaunch in software graphics. */
function onGpuGone(s, deaths) {
  if (s.mode === 'software' || deaths < GPU_DEATHS) return { state: s, relaunch: false };
  return { state: { ...s, mode: 'software', reason: `the graphics process ended ${deaths} times` }, relaunch: true };
}

function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function write(file, s) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s)); } catch { /* read-only profile: no fallback */ } }

/**
 * Call once at the top of main.js, before app is ready. Handles app:gpu-status and app:gpu-use-default over IPC.
 * electron = { app, ipcMain }; log(tag, msg) is optional.
 */
function install({ app, ipcMain }, log = () => {}) {
  const file = path.join(app.getPath('userData'), 'gpu-guard.json');
  let state = onLaunch(read(file)); write(file, state);
  if (state.mode === 'software') { app.disableHardwareAcceleration(); log('gpu-guard', `software graphics: ${state.reason}`); }
  const alive = () => { if (!state.pending) return; state = onAlive(state); write(file, state); };
  app.whenReady().then(() => setTimeout(alive, ALIVE_AFTER_MS));
  app.on('will-quit', alive);
  let deaths = 0;
  app.on('child-process-gone', (_e, d) => {
    if (d.type !== 'GPU' || d.reason === 'clean-exit') return;
    const r = onGpuGone(state, ++deaths); state = r.state; write(file, state);
    if (r.relaunch) { log('gpu-guard', `moving to software graphics: ${state.reason}`); state = onAlive(state); write(file, state); app.relaunch(); app.exit(0); }
  });
  ipcMain.handle('app:gpu-status', () => ({ mode: state.mode, reason: state.reason }));
  ipcMain.handle('app:gpu-use-default', () => { state = { ...fresh() }; write(file, state); app.relaunch(); app.exit(0); });
  return { state: () => state };
}

module.exports = { install, onLaunch, onAlive, onGpuGone, ALIVE_AFTER_MS };
