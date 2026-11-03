// Speech-to-text worker: Whisper (multilingual, word timestamps) via transformers.js + ONNX Runtime (WASM), fully offline.
// Model files: dist/models/whisper/<model>/ ; runtime: dist/ort/ (both copied by scripts/build.mjs).
import { pipeline, env } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL('models/', self.location.href).href;
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL('ort/', self.location.href).href;
env.backends.onnx.wasm.numThreads = 1; // no cross-origin isolation -> no SharedArrayBuffer threads
env.backends.onnx.wasm.proxy = false;

let asr = null, asrModel = null;
async function load(model) {
  if (asr && asrModel === model) return asr;
  asr = await pipeline('automatic-speech-recognition', model, {
    dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' }, device: 'wasm',
    progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'loading', file: p.file, progress: p.progress }); },
  });
  asrModel = model; return asr;
}

/** pick block boundaries at the quietest 100 ms near every `target` seconds so words are not split */
function blocks(audio, sr, target = 28) {
  const out = []; let a = 0; const n = audio.length;
  while (a < n) {
    let b = Math.min(n, a + target * sr);
    if (b < n) {
      const lo = Math.max(a + 10 * sr, b - 4 * sr); let best = b, bestE = Infinity; const w = sr / 10;
      for (let s = lo; s + w <= b; s += w / 2) { let e = 0; for (let i = s; i < s + w; i += 4) e += audio[i] * audio[i]; if (e < bestE) { bestE = e; best = s + w / 2; } }
      b = Math.round(best);
    }
    out.push([a, b]); a = b;
  }
  return out;
}

self.onmessage = async (e) => {
  const { id, audio, sr = 16000, model = 'whisper/whisper-base', language = null, task = 'transcribe' } = e.data;
  try {
    const p = await load(model);
    self.postMessage({ type: 'ready', id });
    const words = []; const bs = blocks(audio, sr); let done = 0; let detected = null;
    for (const [a, b] of bs) {
      const seg = audio.subarray(a, b);
      // skip near-silent blocks (Whisper hallucinates on silence)
      let peak = 0; for (let i = 0; i < seg.length; i += 8) peak = Math.max(peak, Math.abs(seg[i]));
      if (peak > 0.01) {
        const opts = { return_timestamps: 'word', task, chunk_length_s: 30 };
        if (language) opts.language = language;
        const r = await p(seg, opts);
        if (r.language) detected = r.language;
        for (const c of r.chunks || []) {
          const t0 = (c.timestamp?.[0] ?? 0) + a / sr, t1 = (c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0) + a / sr;
          if (String(c.text).trim()) words.push({ text: c.text, t0, t1: Math.max(t1, t0 + 0.05) });
        }
      }
      done++; self.postMessage({ type: 'progress', id, progress: done / bs.length, words: words.length });
    }
    self.postMessage({ type: 'done', id, words, language: detected || language });
  } catch (err) { self.postMessage({ type: 'error', id, error: String(err?.message || err) }); }
};
