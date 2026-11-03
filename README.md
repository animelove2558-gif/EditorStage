# EditorStage
Offline NLE (Electron + React + FlexLayout + WebGL2 compositor + Web Audio + FFmpeg).

- `npm start` - build + launch
- `npm run watch` - rebuild on change (run `npx electron .` in another terminal)
- `npm run dist:win` - Windows installer (.exe, NSIS)
- `npm run dist:mac` - macOS .dmg: must be run on a Mac (`ffmpeg-static` installs the FFmpeg binary of the machine it is installed on, and the app needs code signing / notarization there); it does not work from Windows
- Only `ffmpeg-static` is a runtime dependency (the main process needs it); everything the renderer uses is bundled into `dist/` by esbuild, so those packages are devDependencies and are not copied into the installer

## Layout
- `src/Renderers/Compositor.js` - multi-layer GPU compositor (motion, masks, opacity/blend, transitions)
- `src/Renderers/fx/videoEffects.js` - 100+ GLSL video effects; `fx/transitions.js` - 32 transitions
- `src/Services/audioFx.js`, `audioEngine.js` - Web Audio effects, crossfades, Essential Sound chain
- `src/Services/media.js` - universal import (native decode, FFmpeg fallback), playback sync
- `src/Services/exporter.js` - offline render -> FFmpeg (H.264/HEVC/ProRes/VP9/GIF/WAV/MP3)
- `src/Core/editing.js` - trim/ripple/rolling/slip/slide/rate-stretch/insert/overwrite/lift/extract
- `electron/` - main, preload, es-media:// protocol, FFmpeg IPC (network blocked = offline)

Effects flagged `unsupported` in the Effects panel are not implemented; no video or audio effect is an approximation any more (`≈` remains only on a few transitions).

**Effects rebuilt to follow Premiere / After Effects** (`src/Renderers/fx/premiereFx.js`): Lighting Effects (5 lights, bump layer), Compound Blur / Blend / Calculations / Difference Matte / Texturize with a layer input (another video track), Arithmetic (13 integer operators), Equalize (real histogram), Paint Bucket (connected flood fill), Turbulent Displace, Lightning (branches), the VR effects on equirectangular frames (wrap-around, Frame Layout), Bevel Alpha / Bevel Edges, Radial Shadow, Brush Strokes, Roughen Edges. Audio: FFT Filter (minimum-phase FIR drawn on FFT bins), Pitch Shifter / Pitch and Time (phase vocoder, Precision, Formant Preserve); export compensates the latency of pitch / denoise effects so sound stays in sync.

**AAF export** (File > Export > AAF (Embedded Audio)...): the audio tracks go to a DAW as an AAF file with embedded 48 kHz / 24-bit PCM. Each track is split into L/R mono tracks, plain clips carry 1 s handles, and retimed clips carry their rendered audio. The AAF is written in pure JS (`src/Services/interchange/cfb.js`, `aaf.js`) and validated with pyaaf2. It has not yet been tested in Pro Tools or Resolve.

**FFmpeg license choice:** Preferences > FFmpeg (or the `EDITORSTAGE_FFMPEG` variable, or a build-time `ffmpeg.json`) chooses the FFmpeg binary. With an LGPL build that lacks libx264 / libx265, H.264 / HEVC export, preview renders, proxies and import conversion switch to hardware, Media Foundation, OpenH264, VideoToolbox or VP9 encoders. See `THIRD_PARTY_LICENSES.md`.

## Smart Tools & workflow (menu **Smart Tools**, Window > Smart Tools / Cold Archive Manager / Version History)
- **Auto-Cut Silence & Dead Air** - RMS threshold (dB), minimum silence, padding; preview, then ripple delete on all tracks (`src/Services/ai/silence.js`).
- **Auto-Subtitles** - offline Whisper (transformers.js + ONNX WASM, `src/Services/ai/stt*.js`), 99 languages / translate to English, word timings, caption track with Plain / Karaoke / Word highlight / Word-by-word / Pop styles, SRT export. Model: `node scripts/fetch_models.mjs base` (bundled) or `small`.
- **Separate Speakers** - local diarization (VAD + MFCC/pitch voice prints + clustering), one audio track per speaker (`ai/diarize.js`).
- **Smart Auto-Reframe** - copies the sequence to 9:16 / 1:1 / 4:5 and keeps the tracked person/face/object in frame with Motion keyframes (`ai/reframe.js`).
- **Edit in AudioStage** - Edit menu / clip right-click: renders the clip to WAV 48 kHz 24-bit in "AudioStage Edits", opens AudioStage, reloads the clip when AudioStage saves (Ctrl+S). Needs the AudioStage version with `--editorstage-edit=` support.
- **Cold Archive Manager** - gzip + SHA-1-verified copies of unused media to an external drive, offline-searchable index, restore.
- **Version History** - every Save + auto-save stores a content-addressed revision in `<project>.history/` (unchanged parts stored once); branches.
- **Remote-Optimized Preview** - status-bar / View toggle (auto-on in RDP sessions): 480-640 px preview at 8-15 fps, no UI animation.
- Import: PSD/PSB, AI/PDF/EPS, camera RAW (embedded preview), alpha video -> VP9+alpha, unknown extensions probed with FFmpeg; `es-media://` serves byte ranges (seeking).

## Upgrade features (docs/EDITORSTAGE_UPGRADE_PLAN.md — progress and tests in docs/PROGRESS.md)
Everything runs offline; third-party code and models are listed in THIRD_PARTY_LICENSES.md.

**Editing & effects**
- Keyframe interpolation (Linear / Hold / Ease In / Ease Out / Ease In-Out / Bezier) and a Graph Editor (value / speed graphs, ease presets).
- Speed / Duration, Reverse, Time Remapping, speed curves, Maintain Audio Pitch, Frame Blending — one time model for preview, audio and export.
- Frame Hold (Add / Insert Frame Hold Segment), Export Frame (Ctrl+Shift+E), subclips (Make / Edit Subclip, Convert to Master Clip).
- File > New: Adjustment Layer, Bars and Tone, Black Video, Color Matte, Universal Counting Leader, Transparent Video.
- Mask Tracking and Point Tracker; Scene Edit Detection; Text-Based Editing (Text panel: delete / move words, remove fillers).
- Clip audio channels, field options; Proxy workflow; Relink / offline media; Shared Font Picker with Thai preview.

**Timeline & tracks**
- Drag linked / grouped / several clips across tracks: picture moves within the video tracks, sound within the audio tracks (V1→V2 takes A1→A2), new tracks are made past the last one, locked tracks stop the move.
- Drag modifiers: Ctrl = Insert, Ctrl+Alt = Rearrange (swap clip order, no gap), Alt = Duplicate (linked copies); Ctrl on a drop from the Project panel = Insert. A badge / insert line shows the mode; one undo step.
- Nudge: Alt+↑ / Alt+↓ (one track), Alt+← / Alt+→ (1 frame), Alt+Shift+← / → (5 frames) — Clip > Nudge.
- Tracks: drag headers or Move Track Up / Down to reorder (layer order in preview and export), Rename, Add Track Above / Below, Delete Track, Delete Empty Tracks, adjustable track height (drag the header edge, Expand / Minimize All Tracks), track targeting buttons (V1 / A1) used by Insert, Overwrite, Paste, Match Frame and Add Edit.
- Video thumbnails on clips (View > Video Thumbnails: None / Head / Head and Tail / Continuous) decoded by FFmpeg at the real source frames (speed, reverse, time remapping, frame hold).
- Clip keyframe rubber bands (right-click > Show Clip Keyframes): Volume level, Opacity, Motion and effect sliders — drag, Ctrl+click to add, Alt+click to delete.

**Color & audio**
- Lumetri: Input LUT + Creative LUT (.cube / .3dl), Auto / Auto Tone / Auto Color, Color Match, scopes.
- Essential Sound: Auto Ducking writes Volume keyframes; Voice Changer effect (8 voices).

**Create panel (CapCut-style)**
- Filters (35 looks + intensity, hover to preview), Canvas / Background Fill (blur / color / image), caption style presets, Voice, Remove Background (MediaPipe Selfie Segmenter).
- Auto Captions: Thai line breaking without splitting words, characters per line / lines per caption, keyword emphasis, automatic emoji, SRT / VTT / ASS export, burn-in or sidecar on export.
- **Shorts (Long-to-Shorts)**: scores moments by speech, energy, laughter / loud bursts, scene changes and hook words; adjustable weights and ranges; creates 9:16 sequences with Auto-Reframe, captions and silences cut.
- **B-Roll (Smart B-Roll)**: indexes clips and stills by file name, transcript and detected objects (Thai / English vocabulary), suggests cutaways per sentence and places them on the track above.

**Effects library & presets (Phase 6E)**
- 228 video effects, 162 video transitions (adjustable direction / softness / color), 96 audio effects, 12 audio transitions. Every one is written for EditorStage: GLSL on the GPU, Web Audio for sound.
- 483 built-in presets in Effects > Presets: picture-in-picture, motion (zoom, pop, spin, slide, Ken Burns, fades), effect ins and outs, stylized looks, audio chains, transition variants, plus **168 Lumetri looks**.
- Preset types Anchor to In Point / Anchor to Out Point / Scale. **Save Preset** from Effect Controls (💾) saves to My Presets. Import / export `.espreset`; Premiere `.prfpset` import is best effort (effect names only).
- Effects panel: search by name, folder or tag, ★ Favorites, Recently Used, New / GPU badges, animated hover preview.

**Final pass (Phase 6D)**
- Every "..." menu item opens its dialog: Make Offline, Create Multi-Camera Source Sequence and Third-Party Notices are new dialogs.
- Locked tracks are never changed by any command. Clear / Ripple Delete follow Linked Selection. Each command is one undo step. Shortcuts work with the Thai keyboard layout.

**Trim Mode, Comparison View, Remix (Phase 7 — docs/PROMPT_PREMIERE_FINAL.md)**
- **Trim Mode** (Sequence > Trim Edit, Shift+T; double-click an edit point; Ctrl+click adds more): two-up Program Monitor (outgoing / incoming frame), regular / ripple / roll trim (Ctrl+T cycles), −N / −1 / +1 / +N buttons and keys (Preferences > Large Trim Offset), J / K / L dynamic trimming, Space loops around the edit, red outline at a limit. One undo step per trim.
- **Comparison View** (View > Comparison View, ◫ in the Program Monitor): side by side, vertical or horizontal split (draggable). Reference = the same frame without grading (before / after) or another shot (playhead / previous / next edit). Lumetri Color Match uses the shot reference.
- **Remix** (Remix Tool ♫, Clip > Remix..., Essential Sound > Music > Duration): re-edits music to a target length by cutting on matching beats — intro and ending kept, no speed / pitch change, equal-power crossfades, Segments / Variations / Crossfade settings. Analysis runs offline once per file (cached by content in userData/remix-cache). Sound effects / audio without a steady beat are refused with a message. XML / FCPXML / EDL export a remix as one clip per segment with crossfades.

**Interchange & export**
- Export / import EDL (CMX3600), FCPXML 1.9, Premiere XML (xmeml v5).
- Export dialog: platform presets, H.264 / HEVC (incl. 10-bit) / AV1 / ProRes 422 HQ / ProRes 4444 with alpha / AAC, hardware encoders detected by a test encode (NVENC / Quick Sync / AMF), Source Scaling (fit / fill / stretch), loudness normalization (two-pass loudnorm, true peak), chapters from markers, Smart Render (stream copy when nothing changed), Export Queue.
- Project Health Check (File > Export): offline media, missing fonts, black gaps, clipping, loudness off target, captions / titles outside action-safe — with go-to and one-click fixes.

## Tests
- `npm test` — unit tests (effect / preset licensing, keyframes, time remapping, EDL / FCPXML / XML round trip, tracker, color, Thai line breaking, tracks, clip thumbnails / keyframe bands, Trim Mode, Remix) + `scripts/check_commands.mjs` (0 missing / 0 stub commands).
- `npm run test:e2e` — drives the real app in Electron, exports with FFmpeg and checks pixels / audio of the files (phase1 – phase5, phase6a – phase6e and phase7a – phase7c suites). phase7c also remixes the music in `D:	est music` when that folder exists (read in place, never copied into the repo; `REMIX_MUSIC_DIR` / `REMIX_LISTEN_DIR` change the folders).
