import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');
mkdirSync('dist', { recursive: true });

const common = { bundle: true, sourcemap: true, target: 'chrome130', logLevel: 'info', loader: { '.js': 'jsx', '.wk': 'text' } };

const ctxs = await Promise.all([
  esbuild.context({ ...common, entryPoints: ['src/main.jsx'], outfile: 'dist/renderer.js', format: 'iife', define: { 'process.env.NODE_ENV': process.env.ES_DEV ? '"development"' : '"production"' } }),
  esbuild.context({ ...common, entryPoints: ['src/mogrt-test.js'], outfile: 'dist/mogrt-test.js', format: 'iife' }),
  esbuild.context({ ...common, entryPoints: ['src/Core/workers/decoder.worker.js'], outfile: 'dist/decoder.worker.js', format: 'iife' }),
  esbuild.context({ ...common, entryPoints: ['src/Services/ai/stt.worker.js'], outfile: 'dist/stt.worker.js', format: 'iife' }),
  esbuild.context({ ...common, entryPoints: ['src/Core/workers/dsp.worker.js'], outfile: 'dist/dsp.worker.js', format: 'iife' }),
]);

cpSync('src/index.html', 'dist/index.html');
if (existsSync('build/icon.png')) cpSync('build/icon.png', 'dist/logo.png'); // window icon + Help > About
cpSync('src/mogrt-test.html', 'dist/mogrt-test.html');
cpSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'dist/pdf.worker.min.mjs'); // Illustrator/PDF footage in templates
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'dist/mp/wasm', { recursive: true });
cpSync('assets/models', 'dist/mp/models', { recursive: true, filter: (s) => !s.includes('whisper') });
// offline speech-to-text: Whisper model files + ONNX Runtime WASM
if (existsSync('assets/models/whisper')) cpSync('assets/models/whisper', 'dist/models/whisper', { recursive: true });
mkdirSync('dist/ort', { recursive: true });
for (const f of ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs']) cpSync(`node_modules/@huggingface/transformers/dist/${f}`, `dist/ort/${f}`);
cpSync('src/styles', 'dist/styles', { recursive: true });
cpSync('node_modules/flexlayout-react/style/dark.css', 'dist/styles/flexlayout-dark.css');

if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('watching...');
} else {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  await Promise.all(ctxs.map((c) => c.dispose()));
}
