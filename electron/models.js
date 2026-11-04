// Optional AI model packs (Whisper Small / Medium for speech to text, a multilingual sentence model for Smart B-Roll).
// EditorStage works offline and the page cannot reach the network: a pack is downloaded only when the user presses its
// Download button, by the main process, from a fixed Hugging Face revision. Every file is checked against the size and
// hash listed here before it is moved into place (userData/models/<dir>/), so a changed or damaged file is never used.
// The page reads the files through es-app://app/models/... like the bundled Whisper Base.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// [file, bytes, hash]: a 64-digit hash is the SHA-256 of the file (Git LFS), a 40-digit one is its Git blob SHA-1
const WHISPER_SMALL = [
  ['added_tokens.json', 34604, 'e3d256c988462aa153dcabe2aa38b8e9b436c06f'], ['config.json', 2227, 'b0447377b1ade057f991a6a0870d2a91de762f7f'],
  ['generation_config.json', 3893, '703dc78ee83e87fca3ace72170253cdfe4cd2d13'], ['normalizer.json', 52666, 'dd6ae819ad738ac1a546e9f9282ef325c33b9ea0'],
  ['preprocessor_config.json', 339, '91876762a536a746d268353c5cba57286e76b058'], ['special_tokens_map.json', 2194, 'bf69932dca4b3719b59fdd8f6cc1978109509f6c'],
  ['tokenizer.json', 2480466, '1e95340ff836fad1b5932e800fb7b8c5e6d78a74'], ['tokenizer_config.json', 282683, 'd13b786c04765fb1a06492b53587752cd67665ea'],
  ['onnx/encoder_model_quantized.onnx', 92240498, '9f5635b596e6084045c7426ca6f6f99db8ce606ea895397c3b4a3c0aa3f9b070'],
  ['onnx/decoder_model_merged_quantized.onnx', 156795750, 'c831996a6d5a535cf17447b0d7ecc36da6b72696e6fb906852ba6136b9199abb'],
];
const WHISPER_MEDIUM = [
  ['added_tokens.json', 34604, 'e3d256c988462aa153dcabe2aa38b8e9b436c06f'], ['config.json', 1417, '4cf77144a295106a2d0258c91d27b3911926b2d5'],
  ['generation_config.json', 3779, '0a4b22a21df9cef3b3e181f7eb9f1edefa123b35'], ['normalizer.json', 52666, 'dd6ae819ad738ac1a546e9f9282ef325c33b9ea0'],
  ['preprocessor_config.json', 339, '91876762a536a746d268353c5cba57286e76b058'], ['special_tokens_map.json', 2194, 'bf69932dca4b3719b59fdd8f6cc1978109509f6c'],
  ['tokenizer.json', 3930494, '7e30a8ca85fc59e4ce975a4e6d488771714891fb'], ['tokenizer_config.json', 282713, '3ae24e088bb83a2aaa76a3bf6e3f1cef13e78b53'],
  ['onnx/encoder_model_quantized.onnx', 313154567, '2507d090bf9f1d468f4c1cef274aa34eda025894118f5476e24a0d80308a5315'],
  ['onnx/decoder_model_merged_quantized.onnx', 672561526, '9ddfe49c075a1ffcdef4738377db2a8681cdd5c5b124fda6df1c902e5722d6d1'],
];
const EMBED = [
  ['config.json', 673, 'ce7fe159b2eee53ef2b9704a72a4efa6c22248b4'], ['special_tokens_map.json', 280, 'd5698132694f4f1bcff08fa7d937b1701812598e'],
  ['tokenizer.json', 17082913, 'b60b6b43406a48bf3638526314f3d232d97058bc93472ff2de930d43686fa441'], ['tokenizer_config.json', 496, '9f3bfd538ec86d360dc988dac25e3cfb0c4c14d5'],
  ['onnx/model_quantized.onnx', 118308126, '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc'],
];
const PACKS = {
  'whisper-small': { label: 'Whisper Small (speech to text, better Thai)', license: 'MIT', repo: 'onnx-community/whisper-small_timestamped', rev: '65caa70f294b46e1c33ff820aae6b16d048ab818', dir: 'whisper/whisper-small', files: WHISPER_SMALL },
  'whisper-medium': { label: 'Whisper Medium (speech to text, best Thai, slow)', license: 'MIT', repo: 'onnx-community/whisper-medium_timestamped', rev: '9fe933aaa6b0244316eb961f36d33dfedf0c0b0c', dir: 'whisper/whisper-medium', files: WHISPER_MEDIUM },
  'multilingual-embed': { label: 'Multilingual sentence model (Smart B-Roll by meaning)', license: 'Apache-2.0', repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', rev: '2c4055b12046f11709e9df2c122e59ffbdc2f900', dir: 'embed/paraphrase-multilingual-MiniLM-L12-v2', files: EMBED },
};
const packSize = (p) => p.files.reduce((s, f) => s + f[1], 0);

/** hash of a file as listed in a pack (SHA-256, or the Git blob SHA-1 for small files) */
function hashFile(file, kind) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(kind === 'sha256' ? 'sha256' : 'sha1');
    if (kind !== 'sha256') h.update(`blob ${fs.statSync(file).size}\0`);
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
const hashKind = (hash) => (hash.length === 64 ? 'sha256' : 'gitsha1');

/** where a pack's files are: a folder with every file at its listed size (dist/models for a developer copy, else userData) */
function packDir(id, roots) {
  const p = PACKS[id]; if (!p) return null;
  for (const r of roots) {
    const d = path.join(r, ...p.dir.split('/'));
    if (p.files.every(([f, n]) => { try { return fs.statSync(path.join(d, ...f.split('/'))).size === n; } catch { return false; } })) return d;
  }
  return null;
}

/**
 * Download a pack into <root>/<dir>/. Each file goes to <file>.part, is checked (size + hash), then renamed; files already in
 * place with the right size are kept. onProgress({ got, total, file }). signal: AbortSignal. base: the server (tests).
 */
async function downloadPack(id, root, { onProgress = () => {}, signal, base = 'https://huggingface.co', fetchImpl = fetch } = {}) {
  const p = PACKS[id]; if (!p) throw new Error(`unknown model pack ${id}`);
  const dir = path.join(root, ...p.dir.split('/')); const total = packSize(p); let got = 0;
  for (const [f, size, hash] of p.files) {
    const dst = path.join(dir, ...f.split('/'));
    try { if (fs.statSync(dst).size === size) { got += size; onProgress({ got, total, file: f }); continue; } } catch { /* not there yet */ }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const part = `${dst}.part`;
    const r = await fetchImpl(`${base}/${p.repo}/resolve/${p.rev}/${f}`, { signal, redirect: 'follow' });
    if (!r.ok || !r.body) throw new Error(`${f}: download failed (HTTP ${r.status})`);
    const out = fs.createWriteStream(part); let n = 0;
    try {
      for await (const chunk of r.body) {
        n += chunk.length; if (n > size) throw new Error(`${f}: the server sent more data than expected`);
        if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
        onProgress({ got: got + n, total, file: f });
      }
      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    } catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw signal?.aborted ? new Error('Cancelled') : e; }
    if (n !== size || (await hashFile(part, hashKind(hash))) !== hash) { fs.rmSync(part, { force: true }); throw new Error(`${f}: the downloaded file does not match (damaged or changed on the server)`); }
    fs.renameSync(part, dst); got += size;
  }
  return dir;
}

/** IPC: models:list, models:download (one at a time per pack), models:cancel; progress goes to the window that asked */
function install(ipcMain, app) {
  const roots = () => [path.join(__dirname, '..', 'dist', 'models'), path.join(app.getPath('userData'), 'models')];
  const running = new Map();
  ipcMain.handle('models:list', () => Object.entries(PACKS).map(([id, p]) => ({ id, label: p.label, license: p.license, repo: p.repo, bytes: packSize(p), installed: !!packDir(id, roots()), downloading: running.has(id) })));
  ipcMain.handle('models:download', async (e, id) => {
    if (!PACKS[id]) throw new Error(`unknown model pack ${id}`);
    if (packDir(id, roots())) return { ok: true };
    if (running.has(id)) return running.get(id).done;
    const ac = new AbortController(); const wc = e.sender; let last = 0;
    const done = downloadPack(id, path.join(app.getPath('userData'), 'models'), {
      signal: ac.signal,
      onProgress: (pr) => { const now = Date.now(); if (now - last > 200 || pr.got === pr.total) { last = now; if (!wc.isDestroyed()) wc.send('models:progress', { id, ...pr }); } },
    }).then(() => ({ ok: true }), (err) => ({ ok: false, error: String(err?.message || err) })).finally(() => running.delete(id));
    running.set(id, { ac, done }); return done;
  });
  ipcMain.handle('models:cancel', (_e, id) => { const r = running.get(id); if (r) r.ac.abort(); return !!r; });
  return { roots };
}

/** es-app://app/models/<rel>: the file from dist/models, else from a downloaded pack in userData/models */
function resolveModelFile(rel, roots) {
  for (const r of roots) { const full = path.join(r, ...rel.split('/')); if (full.startsWith(r + path.sep) && fs.existsSync(full)) return full; }
  return null;
}

module.exports = { PACKS, packSize, packDir, downloadPack, hashFile, install, resolveModelFile };
