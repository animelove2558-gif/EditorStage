// Crash handling in the real app (audit C-01, C-02, C-03): the main window's renderer is killed for real
// (forcefullyCrashRenderer), hangs are simulated with the 'unresponsive' event, and page errors are thrown on purpose.
// Checks: a notice is shown, the page reloads, the log file records it, and the 3rd crash within a minute is not reloaded.
const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-crash-'));
app.setPath('userData', path.join(tmp, 'userData'));
const notices = [];
let nextAnswer = 0;
dialog.showMessageBox = async (_w, o) => { notices.push({ message: o.message, buttons: o.buttons }); return { response: nextAnswer }; };
require(path.join(root, 'electron', 'main.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logText = () => { try { return fs.readFileSync(path.join(tmp, 'userData', 'logs', 'editorstage.log'), 'utf8'); } catch { return ''; } };
const loaded = (wc) => new Promise((r) => wc.once('did-finish-load', r));

app.whenReady().then(() => setTimeout(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0]; const wc = win.webContents;
    if (wc.isLoading()) await loaded(wc);
    for (let i = 0; i < 100 && !(await wc.executeJavaScript('!!window.__es')); i++) await sleep(100);

    // page errors reach the log (window.onerror and unhandledrejection)
    await wc.executeJavaScript(`setTimeout(() => { throw new Error('e2e-thrown'); }, 0); Promise.reject(new Error('e2e-rejected')); 1`);
    await sleep(600);
    ok('a thrown page error is logged', /\[page-error\].*e2e-thrown/s.test(logText()));
    ok('an unhandled rejection is logged', /\[page-unhandledrejection\].*e2e-rejected/s.test(logText()));

    // 1st crash: notice, reload, log
    let reload = loaded(wc); wc.forcefullyCrashRenderer();
    await Promise.race([reload, sleep(15000)]);
    ok('crash 1: the user is told and the page reloads', notices.length === 1 && /will reload/.test(notices[0].message) && !wc.isCrashed(), JSON.stringify({ n: notices.length, c: wc.isCrashed(), l: wc.isLoading(), m: notices[0] && notices[0].message }));
    ok('crash 1 is in the log', /\[render-process-gone\] reason=crashed/.test(logText()));
    for (let i = 0; i < 100 && !(await wc.executeJavaScript('!!window.__es').catch(() => false)); i++) await sleep(100);
    ok('the reloaded page works again', await wc.executeJavaScript('!!window.__es'));

    // a hang: Wait keeps the page, Reload reloads it
    nextAnswer = 0; wc.emit('unresponsive'); await sleep(400);
    ok('unresponsive: Wait leaves the page alone', notices.length === 2 && /not responding/.test(notices[1].message) && /\[unresponsive\]/.test(logText()));
    nextAnswer = 1; reload = loaded(wc); wc.emit('unresponsive'); await Promise.race([reload, sleep(15000)]);
    ok('unresponsive: Reload reloads the page', notices.length === 4 && /will reload/.test(notices[3].message), JSON.stringify({ n: notices.length, l: wc.isLoading(), m: notices.map((x) => x.message) }));
    for (let i = 0; i < 100 && !(await wc.executeJavaScript('!!window.__es').catch(() => false)); i++) await sleep(100);

    // GPU process loss as the 3rd recovery within a minute: reported, logged, and not reloaded again (crash loop)
    nextAnswer = 0; const n = notices.length; let reloaded = false; wc.once('did-start-loading', () => { reloaded = true; });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
    await sleep(2000);
    ok('GPU process loss is logged', /\[child-process-gone\] type=GPU/.test(logText()));
    ok('crash loop: the 3rd crash in a minute is reported without reloading', notices.length === n + 1 && notices[n].buttons[0] === 'Close' && !reloaded && /\[crash-loop\]/.test(logText()), JSON.stringify(notices.slice(n)));
  } catch (e) { fail++; console.log('  FAIL exception', e && e.stack || e); }
  console.log(`crash e2e: ${pass} passed, ${fail} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
}, 500));
