// Developer helper: download the offline speech-to-text model into assets/models (bundled into the app by scripts/build.mjs).
// Usage: node scripts/fetch_models.mjs [base|small]   (default: base). The running app never downloads anything.
import fs from 'node:fs';
import path from 'node:path';

const size = process.argv[2] || 'base';
const repo = `onnx-community/whisper-${size}_timestamped`;
const files = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'added_tokens.json', 'normalizer.json',
  'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const out = path.join('assets', 'models', 'whisper', `whisper-${size}`);
for (const f of files) {
  const dst = path.join(out, f); if (fs.existsSync(dst) && fs.statSync(dst).size > 0) { console.log('have', f); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const r = await fetch(`https://huggingface.co/${repo}/resolve/main/${f}`); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
  fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer())); console.log('got', f, (fs.statSync(dst).size / 1e6).toFixed(1), 'MB');
}
