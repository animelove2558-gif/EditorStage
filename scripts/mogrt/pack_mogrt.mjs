// Re-pack an extracted sample (test-assets/mogrt/<name>) into a real .mogrt (outer zip + nested project.aegraphic).
// Usage: node scripts/mogrt/pack_mogrt.mjs <sampleDir> <out.mogrt>
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const [dir, out] = process.argv.slice(2);
const inner = new JSZip();
inner.file('project.aep', fs.readFileSync(path.join(dir, 'project.aep')));
const fdir = path.join(dir, 'footage');
if (fs.existsSync(fdir)) for (const f of fs.readdirSync(fdir)) inner.file(`(Footage)/${f}`, fs.readFileSync(path.join(fdir, f)));
const outer = new JSZip();
outer.file('definition.json', fs.readFileSync(path.join(dir, 'definition.json')));
outer.file('project.aegraphic', await inner.generateAsync({ type: 'uint8array' }));
for (const t of ['thumb.png', 'thumb.mp4']) if (fs.existsSync(path.join(dir, t))) outer.file(t, fs.readFileSync(path.join(dir, t)));
fs.writeFileSync(out, await outer.generateAsync({ type: 'uint8array' }));
console.log('packed', out);
