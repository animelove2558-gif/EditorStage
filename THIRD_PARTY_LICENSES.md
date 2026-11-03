# Third-Party Licenses

EditorStage ships or uses the components below. Rule: commercial-friendly licenses only. No Non-Commercial licenses, and no license that would put the whole program under GPL.
Versions are the ones installed in `node_modules`. The license was read from each package's `package.json` / LICENSE file.

## Runtime (bundled into the app)

| Component | Version | License | Use | Notes |
|---|---|---|---|---|
| react, react-dom | 18.3.1 | MIT | UI | |
| flexlayout-react | 0.8.19 | ISC | Docking panels / workspaces | |
| electron | 33.4.11 | MIT (includes Chromium BSD-3 and others) | App shell | Chromium's own credits ship with Electron (`LICENSES.chromium.html`) |
| jszip | 3.10.2 | MIT OR GPL-3.0-or-later | .mogrt / archives | **Used under MIT** |
| acorn | 8.19.0 | MIT | MOGRT expression parsing | |
| clipper-lib | 6.4.2 | Boost Software License 1.0 | Shape / mask offsetting | permissive |
| pdfjs-dist | 4.10.38 | Apache-2.0 | PDF import | |
| @huggingface/transformers | 3.7.5 | Apache-2.0 | Offline speech-to-text runtime | |
| onnxruntime-web | 1.22.0-dev | MIT | ML inference (WASM) | |
| @mediapipe/tasks-vision | 1.1.0 | Apache-2.0 | Face / object detection (auto reframe) | |
| ffmpeg-static | 5.3.0 | GPL-3.0-or-later (wrapper and binary) | Decode / encode / probe | See **FFmpeg** below |
| sharp + @img/sharp-win32-x64 | 0.34.5 | Apache-2.0 (sharp); LGPL-3.0-or-later (libvips DLLs) | Indirect dependency of @huggingface/transformers (its Node image loader). **Not shipped since 3.1.0**: the renderer bundle in `dist/` never loads it, and the bundled packages are no longer copied into the installer as node_modules (with onnxruntime-node). Its license text is still listed in `packages/` | Before 3.1.0 the DLLs were shipped with `licenses/libvips/` and the libvips source |

## Models (bundled, run offline)

| Model | License | Source |
|---|---|---|
| MediaPipe Selfie Segmenter (`selfie_segmenter.tflite`, float16) | Apache-2.0 | Remove Background; bundled in `assets/models`, from Google's MediaPipe model storage |
| Whisper base (ONNX, timestamped) | MIT (OpenAI Whisper weights) | `onnx-community/whisper-base_timestamped`, fetched by `scripts/fetch_models.mjs` |
| MediaPipe Face Landmarker (`face_landmarker.task`) | Apache-2.0 (per its MediaPipe model card) | Google MediaPipe |
| EfficientDet-Lite0 (`efficientdet_lite0.tflite`) | Apache-2.0 | Google MediaPipe / TensorFlow model garden |

## Build-time only (not shipped)

| Component | Version | License |
|---|---|---|
| esbuild | 0.24.2 | MIT |
| pyaaf2 (Python, dev only: AAF template + verification) | 1.7.1 | MIT |
| electron-builder | 25.1.8 | MIT |

## FFmpeg

`ffmpeg-static` provides a prebuilt FFmpeg executable. That build is configured with `--enable-gpl` (it includes libx264 and libx265, so the binary is GPL).
EditorStage runs it as a **separate process** (`child_process`), with arguments and pipes only. It is not linked into the app, so the EditorStage code itself does not become GPL. This is "mere aggregation".
Before distributing commercially:
1. Ship the FFmpeg GPL license text with the installer.
2. Provide the FFmpeg source, or a written offer for it, for the exact binary version shipped.
3. Optional, to avoid GPL obligations entirely: replace it with an LGPL build without libx264/libx265, and encode H.264/HEVC with hardware encoders (`h264_nvenc`, `h264_qsv`, `h264_amf`, `h264_mf`) or OpenH264 (BSD).

### Using an LGPL FFmpeg (Phase 5C3)

EditorStage runs whichever FFmpeg binary it finds first (`electron/ffmpegBin.js`):

1. **Preferences > FFmpeg > Choose FFmpeg...**: the path is saved in `userData/ffmpeg.json`. Use Default goes back to the order below.
2. **`EDITORSTAGE_FFMPEG`** environment variable.
3. **Build time:** a `ffmpeg.json` file `{ "path": "ffmpeg/ffmpeg.exe" }`. In a packaged app it sits in the `resources` folder; in development it sits in the project root. A relative path is resolved from the folder that holds `ffmpeg.json`. To ship an LGPL build in the installer:
   - add `"extraResources": [{ "from": "vendor/ffmpeg", "to": "ffmpeg" }, "ffmpeg.json"]` to the `build` section of `package.json`;
   - optionally remove `ffmpeg-static` from `dependencies`, so that no GPL binary is shipped at all. The app does not need it when another binary is configured.
4. The bundled `ffmpeg-static` (GPL).

The license is detected, not assumed. `ffmpeg -version` shows whether the build has `--enable-gpl`, and `ffmpeg -encoders` lists what the binary can actually encode. Preferences > FFmpeg shows both, plus the encoder each feature will use. If a feature needs an encoder the binary lacks, it switches to the first non-GPL encoder that passes a short test encode:

| Feature (bundled build encoder) | Without libx264 / libx265 (LGPL build) |
|---|---|
| Export H.264 (MP4) and the platform presets (`libx264`) | NVENC / Quick Sync / AMF → `h264_mf` (Windows Media Foundation) → `libopenh264` → `h264_videotoolbox` (macOS); bitrate ≈ 0.2 bit/pixel/frame |
| Export H.265 / HEVC, HEVC Main10 (`libx265`) | NVENC / Quick Sync / AMF → `hevc_mf` → `hevc_videotoolbox`; ≈ 0.12 bit/pixel/frame |
| Render In to Out preview files (`libx264`) | same as H.264 |
| Create Proxies: H.264 (`libx264`) | same as H.264 (ProRes Proxy uses `prores_ks`, LGPL) |
| Import conversion of formats Chromium cannot play (`libx264`) | `libopenh264` → `h264_mf` → `libvpx-vp9` (WebM) |

- Everything else already uses LGPL or BSD code: ProRes (`prores_ks`), AV1 (`libaom`), VP9 (`libvpx`), AAC (native), Opus, MP3 (`libmp3lame`, LGPL), PCM, and every filter used (`loudnorm`, `scdet`, ...).
- The Export dialog shows which encoder will replace x264 / x265, or why the format is unavailable when none works. The export notes say which encoder was used.
- Hardware encoders run in the GPU driver. Media Foundation and VideoToolbox are part of the operating system, and their codec licenses come with Windows / macOS.
- **OpenH264:** Cisco's patent license covers only Cisco's own prebuilt binary (`openh264-*.dll`), loaded at run time. An FFmpeg build that compiles OpenH264 from source is BSD for copyright, but the H.264 patents are then not covered by Cisco. Prefer hardware encoders or Media Foundation when shipping, or check the patent position for your market.
- Tested with the bundled build set to report libx264 / libx265 as missing (`EDITORSTAGE_FFMPEG_HIDE_ENCODERS`, `scripts/e2e/phase5c3.cjs`). The outputs are checked to contain no x264 / x265 bitstream signature.

## What ships in the installer

`npm run dist*` runs `scripts/collect_licenses.mjs`, which writes `licenses/`. electron-builder then copies it to `resources/licenses/` in the installed app:
- `THIRD_PARTY_LICENSES.md`: this file.
- `packages/`: the LICENSE / NOTICE text of every npm package in the app, direct and indirect: the runtime dependency (ffmpeg-static) and every package esbuild bundles into `dist/` (React, FlexLayout, transformers / ONNX Runtime Web, MediaPipe, pdf.js, JSZip, acorn, clipper-lib and their dependencies). Packages published without a license file get the standard text of the license they declare.
- `ffmpeg/`: the GPL text, the build information, and `SOURCE.txt`, which says where the source is.
- `models/`: the license of each bundled AI model (table above) with the license text.
- `libvips/`: only written when sharp is packaged as a runtime module (not the case since 3.1.0).
- `resources/source-code/`: the FFmpeg source archive (`third_party_source/ffmpeg-<version>.tar.xz`; the collect script stops the build when it does not match the shipped binary version).

Electron's own `LICENSE.electron.txt` and `LICENSES.chromium.html` sit next to `EditorStage.exe`.

**Before giving the installer to others (GPL / LGPL source):**
- Keep the source of the shipped FFmpeg build available for as long as you distribute it. The simplest way is to put the FFmpeg source archive (and the libvips source, for builds before 3.1.0) on the same page as the installer.
- `SOURCE.txt` also tells users they can ask you for it.

## Added per phase

- **Phase 1:** no new third-party libraries or models. EDL / FCPXML / FCP7 XML reading and writing, the XML parser, the font picker, keyframe easing, field processing and audio channel routing are all original code in this repository.
- **Phase 2:** no new npm packages or models. The tracker (Lucas-Kanade / Shi-Tomasi), color match, scene detection, proxy, relink, export queue, Smart Render and ducking code is original. These features call more of the same FFmpeg binary:
  - `scdet` and `showinfo` filters (scene / keyframe detection) and `loudnorm` (EBU R128 loudness normalization) are part of FFmpeg (LGPL).
  - AV1 export uses libaom (BSD-2-Clause, with the AOMedia patent license); ProRes uses FFmpeg's own `prores_ks` (LGPL).
  - Hardware encoding uses NVIDIA NVENC, Intel Quick Sync and AMD AMF via FFmpeg. The headers are MIT-licensed (nv-codec-headers, AMF SDK headers) and the encoders run in the user's GPU driver. Nothing is bundled.
  - Text-Based Editing reuses the Whisper model listed above.
- **Phase 3:** one new model: MediaPipe Selfie Segmenter (Apache-2.0), run by the already bundled `@mediapipe/tasks-vision`. The 35 filter looks, caption presets, keyword and emoji rules, voice presets and canvas fill are original code. No LUT, sticker or audio from another product is included.
- **Phase 4:** no new npm packages or models.
  - Long-to-Shorts reuses FFmpeg `scdet` (scene changes), Whisper (transcript) and the reframe models above (EfficientDet-Lite0, Face Landmarker).
  - Smart B-Roll reuses EfficientDet-Lite0. Its Thai / English vocabulary for the 80 COCO class names is original. The COCO class names are facts, not copyrighted content.
  - Project Health Check uses FFmpeg `loudnorm` for measurement.
  - Moment scoring, B-roll matching and the health checks are original code.
- **Phase 5C1:** no new libraries or models. The rebuilt effects (lighting, blends, flood fill, VR, bevels, FFT filter, phase vocoder) are original code written from the published behaviour of the effects. They are not ported from Adobe code.
- **Phase 5C2 (AAF export):** no runtime dependency. The compound-file writer (`cfb.js`, written from Microsoft's open [MS-CFB] spec) and the AAF object writer (`aaf.js`) are original code.
  - `aafTemplate.js` holds the standard AAF meta-dictionary and dictionary: the class, type, data, codec and container definitions every AAF file carries.
  - It was generated by `scripts/aaf/make_template.py` from an empty file written by **pyaaf2** (MIT, © Mark Reid). pyaaf2's model tables come from the AAF SDK object specification (AAF Association / AMWA).
  - These are format definitions, not program code. pyaaf2 is MIT either way, so they can be shipped commercially.
  - pyaaf2 is used only at development time, to make the template and, through `scripts/aaf/verify_aaf.py`, to read exported files back. It is not shipped.
- **Phase 5C3 (LGPL FFmpeg option):** no new dependencies. The detection and the replacement encoders are original code. See *Using an LGPL FFmpeg* above.
- **Phase 6 (round 2): no new libraries, models, LUTs or preset packs.**

### Effects library (Phase 6E)

Every effect, transition and preset is EditorStage's own code (source `own`):
- 126 video effects (`src/Renderers/fx/moreVideoFx*.js`) and 130 video transitions (`moreTransitions.js`), written in GLSL.
- 56 audio effects and 9 crossfade curves (`src/Services/moreAudioFx.js`), built from standard Web Audio nodes.
- 483 built-in presets (`src/presets/`):
  - 168 Lumetri looks, made of plain Lumetri values with no LUT files.
  - Picture-in-picture, motion, effect in/out, stylized, audio and transition presets.

Nothing in the library is copied or ported from:
- Shadertoy, LYGIA, or ISF packs
- FFmpeg filter source
- Adobe, Red Giant, FilmConvert or CapCut presets or LUTs

Names are descriptive and do not imitate brands or film stocks. The Premiere-named effects re-implement Premiere's controls from their published behavior.

`src/Core/fxLicenses.js` records the source and license of each item. `npm test` runs `scripts/test_effect_licenses.mjs`, which fails if:
- an item has a license outside the allowlist (own, MIT, BSD-2/3-Clause, Zlib, Apache-2.0, CC0-1.0, Unlicense, public domain, CC-BY-4.0)
- a name imitates a trademark
- the effect folders contain code from a banned source

Premiere `.prfpset` import is best effort. Only the effect names that EditorStage also has are read. Premiere stores the parameter values in its own binary format, so those effects come in at their default values.
