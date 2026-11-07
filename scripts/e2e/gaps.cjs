// Real exports for the formats added in the 2026-11-07 audit (G-03 DNxHR / MXF, G-04 PNG sequence) and PNG-sequence import.
// Run with the Electron lock held: npx electron scripts/e2e/gaps.cjs
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const { suite } = require('./harness.cjs');

suite('gaps e2e', async ({ js, ok, out, frames, px, near }) => {
  const J = (x) => JSON.stringify(x);
  const W = 320, H = 180;

  // a white rectangle on an empty (transparent) sequence, 1 second
  await js(`T.fresh(${W}, ${H}); E.gfx.addGraphic('rect', 0, { x: 0.5, y: 0.5, w: 0.5, h: 0.5, color: '#ffffff', stroke: false }); return true;`);

  console.log('DNxHR / MXF');
  for (const [preset, file] of [['Avid DNxHR HQ (MOV)', 'dnx.mov'], ['MXF OP1a DNxHR HQ', 'dnx.mxf']]) {
    const r = await js(`return T.exp(${J(out(file))}, ${J(preset)}, ${W}, ${H}, 0, 0.5);`);
    const info = spawnSync(ffmpeg, ['-hide_banner', '-i', out(file)], { encoding: 'utf8' }).stderr;
    ok(`${preset}: the export finishes`, r === true || (r && r.ok !== false), J(r));
    ok(`${preset}: the file is DNxHR`, /dnxhd \(DNXHR HQ/.test(info), info.split('\n').filter((l) => /Stream|Input/.test(l)).join(' | '));
    const fr = frames(out(file), W, H);
    ok(`${preset}: frames decode and show the rectangle`, fr.length >= 10 && near(px(fr[0], W, W / 2, H / 2), [255, 255, 255], 40), J(px(fr[0], W, W / 2, H / 2)));
  }

  console.log('PNG sequence export');
  const r = await js(`return E.exporter.exportSequence({ path: ${J(out('seq.png'))}, preset: 'PNG Sequence (RGBA)', width: ${W}, height: ${H}, fps: 30, start: 0, end: 0.5, audio: false, loudness: null, fit: 'fit', encoder: 'software' }, () => {}, () => false);`);
  const files = fs.readdirSync(path.dirname(out('seq.png'))).filter((f) => /^seq_\d{5}\.png$/.test(f)).sort();
  ok('PNG sequence: the export finishes', r && r.ok !== false, J(r));
  ok('PNG sequence: numbered frames 00001..', files.length === 15 && files[0] === 'seq_00001.png' && files[14] === 'seq_00015.png', files.join());
  const rgba = spawnSync(ffmpeg, ['-v', 'error', '-i', out('seq_00001.png'), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 }).stdout;
  const at = (x, y) => [...rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];
  ok('PNG sequence: transparent outside, opaque white inside', at(2, 2)[3] === 0 && at(W / 2, H / 2)[3] === 255 && at(W / 2, H / 2)[0] > 240, J([at(2, 2), at(W / 2, H / 2)]));
});
