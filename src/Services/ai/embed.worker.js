// Sentence embeddings for Smart B-Roll (paraphrase-multilingual-MiniLM-L12-v2, 50+ languages including Thai), offline.
// The model is an optional pack the user downloads once (electron/models.js); it is read from es-app://app/models/embed/.
import { pipeline, env } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
// es-app://app/models/ serves the bundled models (dist/models) and downloaded packs (userData/models, electron/models.js)
env.localModelPath = 'es-app://app/models/';
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = new URL('ort/', self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

const EMBED_MODEL = 'embed/paraphrase-multilingual-MiniLM-L12-v2';
let fx = null;
const load = () => (fx ||= pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8', device: 'wasm' }).catch((e) => { fx = null; throw e; }));

self.onmessage = async (e) => {
  const { id, texts } = e.data;
  try {
    const p = await load(); const vecs = [];
    for (let i = 0; i < texts.length; i += 16) {
      const out = await p(texts.slice(i, i + 16), { pooling: 'mean', normalize: true });
      const [n, d] = out.dims; for (let k = 0; k < n; k++) vecs.push(Array.from(out.data.subarray(k * d, (k + 1) * d)));
    }
    self.postMessage({ id, vecs });
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};
