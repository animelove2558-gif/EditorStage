// End-to-end harness: runs the real app (dist/) in Electron, drives it through window.__es and the DOM, exports with the
// real exporter + FFmpeg; suites check the pixels / samples of the output files. A suite file calls suite(name, fn).
const { app, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');

const root = path.resolve(__dirname, '..', '..');
const assets = path.join(root, 'test-assets', 'e2e');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'es-e2e-'));
app.setPath('userData', path.join(tmp, 'userData')); // never touch the real profile

// file dialogs answer from these queues
const nextSave = []; const nextOpen = [];
let dialogCalls = 0;
dialog.showSaveDialog = async () => (dialogCalls++, { canceled: !nextSave.length, filePath: nextSave.shift() });
dialog.showOpenDialog = async () => { dialogCalls++; const p = nextOpen.shift(); return { canceled: !p, filePaths: p ? [p] : [] }; };

require(path.join(root, 'electron', 'main.js'));

let pass = 0, fail = 0; const errors = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const A = (n) => path.join(assets, n).replace(/\\/g, '\\\\');
const out = (n) => path.join(tmp, n);

/** Decode a video file to rgb24 frames. */
function frames(file, w, h) {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const n = w * h * 3; const list = []; for (let o = 0; o + n <= r.stdout.length; o += n) list.push(r.stdout.subarray(o, o + n)); return list;
}
const px = (f, w, x, y) => { const i = (y * w + x) * 3; return [f[i], f[i + 1], f[i + 2]]; };
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Per-channel RMS of a 16-bit stereo WAV (data chunk located by scanning). */
function wavRms(file) {
  const b = fs.readFileSync(file); let o = 12; while (o < b.length && b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const n = (b.readUInt32LE(o + 4) / 4) | 0; let l = 0, r = 0;
  for (let i = 0; i < n; i++) { const L = b.readInt16LE(o + 8 + i * 4) / 32768, R = b.readInt16LE(o + 10 + i * 4) / 32768; l += L * L; r += R * R; }
  return [Math.sqrt(l / n), Math.sqrt(r / n)];
}

/** Run a suite: fn(h) gets { js, ok, A, out, frames, px, near, wavRms, nextSave, nextOpen, tmp }. Exits with the result. */
function suite(name, fn) {
  app.whenReady().then(() => setTimeout(async () => {
    const win = BrowserWindow.getAllWindows()[0]; const wc = win.webContents;
    wc.on('console-message', (_e, level, msg, line, src) => { if (level >= 3) errors.push(`${msg} (${path.basename(String(src))}:${line})`); });
    wc.on('render-process-gone', (_e, d) => { errors.push('renderer gone: ' + d.reason); });
    const js = async (code) => {
      const r = await wc.executeJavaScript(`(async () => { const E = window.__es; try { return { v: await (async () => { ${code} })() }; } catch (e) { return { err: String(e && e.stack || e) }; } })()`, true);
      if (r.err) throw new Error(r.err); return r.v;
    };
    try {
      if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
      for (let i = 0; i < 100 && !(await js('return !!window.__es')); i++) await new Promise((r) => setTimeout(r, 100));
      await js(`
        const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
        window.T = {
          tick,
          fresh(w, h, fps = 30) { E.store.resetProject(); E.store.edit('setup', ({ seq }) => { seq.width = w; seq.height = h; seq.fps = fps; }); },
          async imp(p) { const [m] = await E.media.importPaths([p]); for (let i = 0; i < 200 && E.media.mediaById(m.id)?.status !== 'ready'; i++) await tick(50); return E.media.mediaById(m.id); },
          place(m, start = 0, track) { let ids; E.store.edit('place', ({ seq }) => { ids = E.cmds.placeMedia(seq, m, start, track); }); return ids; },
          patch(id, fn) { E.store.edit('patch', ({ seq }) => fn(seq.clips.find((c) => c.id === id))); },
          clip(id) { return E.store.getState().sequence.clips.find((c) => c.id === id); },
          async exp(path, preset, w, h, start, end, audio = false) {
            const s = E.store.getState().sequence;
            const r = await E.exporter.exportSequence({ path, preset, width: w, height: h, fps: s.fps, start, end, audio }, () => {}, () => false);
            if (!r || r.ok === false) throw new Error('export failed: ' + (r && r.error)); return true;
          },
          async pcm(a, b) { return E.exporter.renderAudioMix(E.store.getState(), a, b); },
          async mix(a, b) { const pcm = await E.exporter.renderAudioMix(E.store.getState(), a, b); let l = 0, r = 0; const n = pcm.length / 2; for (let i = 0; i < n; i++) { const L = pcm[2 * i] / 32768, R = pcm[2 * i + 1] / 32768; l += L * L; r += R * R; } return [Math.sqrt(l / n), Math.sqrt(r / n)]; },
          async modal() { for (let i = 0; i < 40 && !document.querySelector('.modal'); i++) await tick(25); return document.querySelector('.modal'); },
          button(label) { return [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === label); },
        };
        return true;`);
      console.log(name);
      await fn({ js, ok, A, out, frames, px, near, wavRms, nextSave, nextOpen, tmp, dialogCalls: () => dialogCalls });
      const real = errors.filter((e) => !/Autofill|DevTools|Electron Security Warning|TensorFlow Lite XNNPACK/.test(e));
      ok('no renderer console errors', !real.length, '\n    ' + real.join('\n    '));
    } catch (e) { fail++; console.log('  FAIL harness:', e.stack || e.message); }
    console.log(`\n${name}: ${pass} passed, ${fail} failed  (output files in ${tmp})`);
    app.exit(fail ? 1 : 0);
  }, 200));
}
module.exports = { suite };
