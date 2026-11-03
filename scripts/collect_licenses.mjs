// Gathers the license texts that must travel with the installer into licenses/ (copied to resources/licenses by
// electron-builder, see "extraResources" in package.json). Run by `npm run dist*`; can be run alone: node scripts/collect_licenses.mjs
//   licenses/THIRD_PARTY_LICENSES.md   the summary (which component, which license, how it is used)
//   licenses/ffmpeg/                   GPL text, build information and where the source is (the bundled ffmpeg-static binary)
//   licenses/packages/<name>.txt       the LICENSE / NOTICE file of every production npm package (direct and indirect)
// The GPL / LGPL source archives (ffmpeg-<version>.tar.xz, vips-<version>.tar.xz) live in third_party_source/ and are
// copied to resources/source-code by electron-builder; this script stops the build when the one for a shipped version is missing.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'licenses');
const sourceDir = path.join(root, 'third_party_source');
const missingSource = [];
/** Name of a source archive the installer must carry; remembered when third_party_source/ does not have it. */
const requireSource = (file, url) => { if (!fs.existsSync(path.join(sourceDir, file))) missingSource.push(`${file}  (${url})`); return file; };
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'packages'), { recursive: true });
fs.mkdirSync(path.join(out, 'ffmpeg'), { recursive: true });

fs.copyFileSync(path.join(root, 'THIRD_PARTY_LICENSES.md'), path.join(out, 'THIRD_PARTY_LICENSES.md'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(out, 'EditorStage.txt'), `EditorStage ${app.version}
All rights reserved by BYS & RB
Copyright (c) BYS & RB. All rights reserved.

The third-party components in this program keep their own licenses: see THIRD_PARTY_LICENSES.md and the
packages/, ffmpeg/ and libvips/ folders here.
`);

// ---- npm packages that ship in the app (dev tools such as esbuild / electron-builder are not shipped) ----
const dirs = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  .split(/\r?\n/).filter((d) => d && path.resolve(d) !== root);
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;
// packages published without a license file: the standard text of the license they declare, with their copyright holder
const HOLDER = { 'onnxruntime-web': 'Microsoft Corporation', 'onnxruntime-node': 'Microsoft Corporation', 'onnxruntime-common': 'Microsoft Corporation', '@mediapipe/tasks-vision': 'Google LLC (The MediaPipe Authors)', 'clipper-lib': 'Angus Johnson (Clipper); Timo (JavaScript translation)' };
const holderOf = (pkg) => HOLDER[pkg.name] || (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name) || [].concat(pkg.contributors || []).map((c) => c.name || c).join(', ') || `the ${pkg.name} authors`;
const apacheText = () => fs.readFileSync(path.join(root, 'node_modules/@huggingface/transformers/LICENSE'), 'utf8').trim();
const STANDARD = {
  MIT: (h) => `MIT License\n\nCopyright (c) ${h}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: (h) => `ISC License\n\nCopyright (c) ${h}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  BSL: (h) => `Boost Software License - Version 1.0 - August 17th, 2003\n\nCopyright (c) ${h}\n\nPermission is hereby granted, free of charge, to any person or organization obtaining a copy of the software and accompanying documentation covered by this license (the "Software") to use, reproduce, display, distribute, execute, and transmit the Software, and to prepare derivative works of the Software, and to permit third-parties to whom the Software is furnished to do so, all subject to the following:\n\nThe copyright notices in the Software and this entire statement, including the above license grant, this restriction and the following disclaimer, must be included in all copies of the Software, in whole or in part, and all derivative works of the Software, unless such copies or derivative works are solely in the form of machine-executable object code generated by a source language processor.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  'Apache-2.0': (h) => `Copyright ${h}\n\n${apacheText()}`,
};
STANDARD['BSL-1.0'] = STANDARD.BSL;
const missing = []; let count = 0;
for (const dir of [...new Set(dirs)]) {
  let pkg; try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
  const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  const lic = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type || (pkg.licenses || []).map((l) => l.type || l).join(' OR ') || 'UNKNOWN';
  const head = `${pkg.name}@${pkg.version}\nLicense: ${lic}\n${pkg.homepage || pkg.repository?.url || pkg.repository || ''}\n${'='.repeat(78)}\n\n`;
  const body = files.map((f) => `----- ${f} -----\n${fs.readFileSync(path.join(dir, f), 'utf8').trim()}\n`).join('\n');
  let text = body;
  if (!files.length) {
    const std = STANDARD[lic];
    if (std) text = `----- ${lic} (standard text; the package was published without a license file) -----\n${std(holderOf(pkg))}\n`;
    else missing.push(`${pkg.name}@${pkg.version} (${lic})`);
  }
  fs.writeFileSync(path.join(out, 'packages', `${pkg.name.replace(/\//g, '__')}@${pkg.version}.txt`), head + (text || `(no license file; package.json declares: ${lic})\n`));
  count++;
}

// ---- FFmpeg (GPL build from ffmpeg-static) ----
const ff = path.join(root, 'node_modules', 'ffmpeg-static');
for (const f of fs.readdirSync(ff).filter((x) => /\.(LICENSE|README)$/.test(x))) fs.copyFileSync(path.join(ff, f), path.join(out, 'ffmpeg', f));
const readme = fs.readdirSync(ff).find((x) => x.endsWith('.README'));
const info = readme ? fs.readFileSync(path.join(ff, readme), 'utf8') : '';
const version = /Version:\s*(\S+)/.exec(info)?.[1] || 'unknown';
const source = /Source Code:\s*(\S+)/.exec(info)?.[1] || 'https://ffmpeg.org/download.html';
const ffmpegBase = /^\d+(\.\d+)*/.exec(version)?.[0] || version;
const ffmpegArchive = requireSource(`ffmpeg-${ffmpegBase}.tar.xz`, `https://ffmpeg.org/releases/ffmpeg-${ffmpegBase}.tar.xz`);
fs.writeFileSync(path.join(out, 'ffmpeg', 'SOURCE.txt'), `FFmpeg in EditorStage
=====================

EditorStage ships an unmodified FFmpeg executable (resources/app.asar.unpacked/node_modules/ffmpeg-static/).
Version: ${version}
License: GNU General Public License version 3 (see the .LICENSE file in this folder). The build configuration
is listed in the .README file in this folder.

EditorStage runs FFmpeg as a separate program (command-line arguments and pipes). EditorStage itself is not a
derivative of FFmpeg and is not covered by the GPL. FFmpeg remains under the GPL and you may use, study,
change and share it under that license.

Corresponding source code
- Included with this installation: resources/source-code/${ffmpegArchive} (in the EditorStage install folder)
- FFmpeg source of this exact build: ${source}
- The external libraries compiled into it (x264, x265, libvpx, libaom, opus, lame and the others in the
  configuration) come from their upstream projects, at the versions listed in the .README file.
- The same source is also available from BYS & RB, who distribute this copy of EditorStage. Ask them for it.

You may replace this FFmpeg with another build: Preferences > FFmpeg > Choose FFmpeg...
`);

// ---- libvips (LGPL-3.0-or-later): prebuilt DLLs shipped by sharp, an indirect dependency of @huggingface/transformers ----
const vipsDir = fs.readdirSync(path.join(root, 'node_modules', '@img')).map((d) => path.join(root, 'node_modules', '@img', d)).find((d) => fs.existsSync(path.join(d, 'versions.json')));
if (vipsDir) {
  fs.mkdirSync(path.join(out, 'libvips'), { recursive: true });
  const vers = JSON.parse(fs.readFileSync(path.join(vipsDir, 'versions.json'), 'utf8'));
  fs.copyFileSync(path.join(vipsDir, 'versions.json'), path.join(out, 'libvips', 'versions.json'));
  const vipsArchive = requireSource(`vips-${vers.vips}.tar.xz`, `https://github.com/libvips/libvips/releases/download/v${vers.vips}/vips-${vers.vips}.tar.xz`);
  fs.writeFileSync(path.join(out, 'libvips', 'SOURCE.txt'), `libvips in EditorStage
======================

The sharp image library (an indirect dependency of @huggingface/transformers) ships prebuilt, unmodified
libvips ${vers.vips} DLLs (node_modules/${path.relative(path.join(root, 'node_modules'), vipsDir).replace(/\\/g, '/')}/lib).
libvips is licensed under the GNU Lesser General Public License version 3 or later (see
packages/${path.basename(path.dirname(vipsDir))}__${path.basename(vipsDir)}@${JSON.parse(fs.readFileSync(path.join(vipsDir, 'package.json'), 'utf8')).version}.txt). The libraries built into it and their versions
are in versions.json in this folder.

The DLLs are separate files loaded at run time: you may replace them with your own build of the same version.
Included with this installation: resources/source-code/${vipsArchive} (in the EditorStage install folder).
Source: https://github.com/libvips/libvips (tag v${vers.vips}) and the build scripts at
https://github.com/lovell/sharp-libvips. The same source is also available from whoever gave you this copy of
EditorStage (BYS & RB). Ask them for it.
`);
}

console.log(`licenses/: ${count} packages, FFmpeg ${version}${missing.length ? `; no license file in: ${missing.join(', ')}` : ''}`);
if (missingSource.length) {
  console.error(`third_party_source/ is missing the source the installer must include. Download into third_party_source/:\n  ${missingSource.join('\n  ')}`);
  process.exit(1);
}
