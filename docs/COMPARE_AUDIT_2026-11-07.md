# EditorStage: crash, bug and gap audit against filmcraft (2026-11-07)

Audit only. No application code was changed. Reference: `filmcraft` (Rust, MIT/Apache-2.0), read as a checklist of
behaviour only (README, ROADMAP, `docs/gaps.md`, `AGENTS.md`, crate names). Nothing from it was built or run.

## Method and limits

- Read `docs/PROGRESS.md` and `PROMPT_FIX_AUDIT_2026-11-02.md` first. Items already finished there are not repeated: atomic
  saves with free-space check (`electron/fileGuard.js:172`), path guard, navigation lock (`main.js:60`), project parser with
  structural checks (`src/Core/projectFile.js`), per-sequence history cap of 100 (`store.js:125`), rolling auto-save
  versions with session recovery (`Services/versions.js`), render-window crash handling (`electron/renderWindow.js:32`),
  ffmpeg child tracking and kill on quit (`electron/ffjobs.js`), export-time GL context release (`exporter.js:440,464`).
- Unit tests, run once on 2026-11-07: `npm test` finished with 668 passed, 0 failed across 20 suites
  (`check_commands`: 267 ids referenced, 280 defined, 0 missing, 0 stubs). E2E suites were not run (they need Electron and
  the RAM lock); this audit did not launch the app.
- No crash dumps and no tester logs exist on this machine. Crash causes below are inferred from code. CONFIRMED means the
  code path was read and proven with file:line; it does not mean a crash was reproduced. SUSPECTED means plausible but not
  proven by reading alone.
- Tiers: T1 mechanical (Sonnet/Haiku), T2 hard (Opus), T3 hardest (top model). Sizes S/M/L.

## Part 1. Crash and bug risks (ordered by user impact)

### C-01 No handler for the main window's renderer crash, hang, or GPU process loss
- Status: CONFIRMED
- Evidence: `electron/main.js:21-51` creates the main window with only `close`, `maximize`, `unmaximize` handlers. No
  `render-process-gone`, `unresponsive` or `app.on('child-process-gone')` exists anywhere (grep over `electron/` finds
  `render-process-gone` only in `renderWindow.js:32`).
- Trigger: out-of-memory in the renderer, GPU driver reset, a crash inside a decoder.
- Impact: the user sees a dead white or black window with no message and no way back except killing the app. Work since the
  last auto-save is lost with no explanation.
- Fix: on `render-process-gone` (reason not `clean-exit`) and `child-process-gone` (type GPU) show a dialog, reload the page
  so `bootRecovery()` (`Services/versions.js:179`) offers recovery; on `unresponsive` offer Wait / Reload. Count crashes and
  stop reloading after 2 in a minute.
- Size: S. Tier: T1.

### C-02 No crash or error log anywhere
- Status: CONFIRMED
- Evidence: no `uncaughtException`, `unhandledRejection`, `window.onerror`, or `unhandledrejection` handler in `electron/`
  or `src/` (grep). `src/main.jsx:77` renders `<App />` with nothing around it. Errors only reach a DevTools console that
  the installed app does not have (`main.js:29`, `devTools: !app.isPackaged`).
- Trigger: any error in production.
- Impact: testers report "it crashes" and nothing can be diagnosed. This is also why this audit has no evidence.
- Fix: write a rotating log to `userData/logs/` from main (`uncaughtException`, `unhandledRejection`, window events from
  C-01, ffmpeg non-zero exits with the last stderr lines) and from the renderer (forward `error` / `unhandledrejection` over
  one IPC channel). Add Help > Open Log Folder. Keep paths and project names, nothing else personal.
- Size: S. Tier: T1.

### C-03 No root error boundary: one render exception blanks the whole UI
- Status: CONFIRMED
- Evidence: the only boundary is `Boundary` in `src/Components/Dialogs.jsx:907-911`, used for dialogs. `src/main.jsx:77`
  mounts `<App />` unprotected; panels in `Panels.jsx`, `Timeline.jsx`, `EffectControls.jsx` have none.
- Trigger: a React render error from unexpected clip or effect data (for example a damaged keyframe list inside a project
  that passed `parseProject`, which checks tracks and clips only, not effect or keyframe shapes).
- Impact: React 18 unmounts the full tree: blank window, unsaved work unreachable.
- Fix: boundary around the root and one around each dock panel with "Panel failed, Reload panel" and a Save Project As
  rescue button; log through C-02.
- Size: S. Tier: T1.

### C-04 Playback element pool is never pruned
- Work status (2026-11-07, T2): Code done, unit tested (`scripts/test_lru.mjs`), not yet run in the real app: the Electron lock was unavailable. Memory not measured, before or after. `src/Services/media.js` caps 12 video and 24 audio elements.
- Status: CONFIRMED (code path); memory effect SUSPECTED until measured
- Evidence: `src/Services/media.js:139` `pool`; entries are added at `:159` (one `<video>`/`<audio>` per clip key) and
  removed only by `dropElement` (`:162`) on a changed file or `invalidateMedia` / `releaseKeyed` (`:168`, `:290`). The idle
  pass at `:251` only calls `pause()` after 1.5 s; it never drops the element. Each element keeps a decoder and buffered
  data, plus its Web Audio chain (`disposeClipAudio` runs only from `dropElement`).
- Trigger: scrubbing or playing through a project with many clips (a few hundred cuts, a long-to-shorts result), or a long
  session.
- Impact: renderer memory and hardware decoder instances grow with every clip ever shown. Chromium limits concurrent
  hardware decoders and eventually fails decodes or kills the renderer (C-01). Likely the most common cause of "crashes
  after a while".
- Fix: LRU with a cap (for example 12 video, 24 audio elements, never dropping the ones near the playhead or playing), call
  `dropElement` on eviction and when a clip is deleted from the sequence.
- Size: M. Tier: T2.

### C-05 GPU textures and framebuffers are never released
- Work status (2026-11-07, T2): Code done, not yet run in the real app: the Electron lock was unavailable. Memory not measured. `Compositor.trimCaches` caps source textures at 16 / 512 MB and each pass cache at 8 / 256 MB; `resize` frees them.
- Status: CONFIRMED (code path)
- Evidence: `src/Renderers/Compositor.js:329-330` creates a texture per `key` in `srcTex` and no code deletes an entry (the
  only `srcTex` references outside the class are reads: `Compositor.js:733`, `TransformOverlay.jsx:19`). Keys include
  `${clipKey}#b` (`:439`) and `${clipKey}#e${k}` (`:492`), so one clip can own several full-frame textures. `fbos` (`:269`,
  `:408-413`) and the field, blend and flow caches (`:355-400`) are also keyed per clip. Only `_dt` is capped (`:570`, 40).
  `resize()` frees the pool but not these maps (`:305-308`).
- Trigger: scrubbing across many clips; 4K sources (about 33 MB per RGBA texture).
- Impact: VRAM grows without bound, then `texImage2D` fails or the context is lost (C-06) and the monitor turns black.
- Fix: a `release(key)` and LRU on `srcTex` / `fbos` driven by the same eviction as C-04 and by clip deletion; free all
  entries on `resize`.
- Size: M. Tier: T2.

### C-06 No WebGL context loss or restore handling
- Work status (2026-11-07, T2): Code done, not yet run in the real app: the Electron lock was unavailable. Lost and restored handlers rebuild all GL resources; monitors show a notice; export redraws the frame or fails with a message.
- Status: CONFIRMED
- Evidence: no `webglcontextlost` / `webglcontextrestored` listener anywhere in `src/` (grep). `Compositor.js:265` creates
  the context; all programs, textures and VAOs live in JS maps that become invalid after a loss. Up to six contexts exist at
  once (main monitor `Panels.jsx:57`, reference `:88`, `:69`, `fxPreview.js:22`, exporter, render window) against
  Chromium's limit of 16 per process before the oldest is dropped.
- Trigger: GPU driver reset or sleep/wake, many simultaneous contexts, VRAM exhaustion (C-05).
- Impact: Program Monitor goes black permanently until restart; no message.
- Fix: listen for lost (`preventDefault`) and restored; on restore rebuild programs and clear every cache; show a notice
  while lost. Keep the number of live contexts small (share one compositor between monitors where possible).
- Size: M. Tier: T2.

### C-07 Unstable GPU switches are forced on, and there is no fallback after repeated GPU crashes
- Work status (2026-11-07, T2): (b) Module and tests done (`electron/gpuGuard.js`, `scripts/test_gpuguard.mjs`, 12 passed). NOT ACTIVE: `electron/main.js` must call `require('./gpuGuard').install({ app, ipcMain })` before app ready, and there is no notice or "Use default graphics" button yet.
- Status: CONFIRMED (flags present); impact SUSPECTED
- Evidence: `electron/main.js:16-18` appends `enable-unsafe-webgpu`, `enable-features=WebCodecs,VaapiVideoDecoder,...` and
  `ignore-gpu-blocklist`. The code uses WebGL2 only (the audit of 2 Nov found WebGPU/WebCodecs files were dead code), so the
  WebGPU flag has no benefit. `ignore-gpu-blocklist` makes Chromium use drivers it deliberately avoids. filmcraft's
  `docs/gaps.md` G4 lists the same class of reports (Intel UHD driver crash, Windows 11 failures) and ships a start-up
  fallback that moves to a safer graphics mode after two quick-death launches.
- Trigger: older Intel / AMD drivers, laptops with hybrid graphics.
- Impact: GPU process crashes, black monitor, renderer loss on testers' machines.
- Fix: (a) remove `enable-unsafe-webgpu` and `ignore-gpu-blocklist` (T1, S). (b) Crash-loop detection: write a start marker,
  clear it after the first paint; if two launches in a row die within 15 s, or the GPU process dies twice
  (`child-process-gone`), relaunch with `app.disableHardwareAcceleration()` (software GL) and show a notice with a
  "Use default graphics" button (T2, M).
- Size: S + M. Tier: T1 for (a), T2 for (b).

### C-08 Compositor creation failure is silent
- Status: CONFIRMED
- Evidence: `Panels.jsx:57` `try { comp = new Compositor(...) } catch (e) { console.error(e); }`; same at `:69`, `:88`;
  `Compositor.js:266` throws `WebGL2 unavailable`. With no DevTools in the installed app (`main.js:29`) nobody sees it.
- Trigger: WebGL2 blocked or software-disabled, GPU process unavailable.
- Impact: empty Program Monitor and Source Monitor; the user cannot tell why, and scrubbing does nothing.
- Fix: show an on-monitor message ("Graphics unavailable: <reason>. Try Help > Use Software Graphics") and log it.
- Size: S. Tier: T1.

### C-09 Recovery journal is minutes behind: default auto-save is every 5 minutes
- Work status (2026-11-07, T2): Done and unit tested (`scripts/test_versions.mjs`); recovery dialog not exercised in the real app. Journal written about 2 s after the last edit, gap at least 20 times the write cost; off when auto-save is off.
- Status: CONFIRMED
- Evidence: `src/Core/prefs.js:8` `autoSaveMin: 5`; `Services/versions.js:155-157` writes on an interval. filmcraft's README
  says a recovery journal is written about one second after each edit.
- Trigger: any crash (C-01, C-04..C-06) or power cut.
- Impact: up to 5 minutes of edits lost; combined with C-01 this is what testers feel as "it crashed and I lost work".
- Fix: a debounced (about 2 s after the last edit) small journal write of the dirty sequence into the existing history
  folder, throttled so a very large project is not rewritten on every slider drag; keep the 5 min full version for history.
  `bootRecovery` already restores the marker session; extend it to prefer the journal when newer.
- Size: M. Tier: T2.

### C-10 Custom protocol handlers can throw on malformed requests
- Status: SUSPECTED
- Evidence: `electron/main.js:160` and `:172` call `decodeURIComponent` with no try/catch; `:165` `net.fetch(...)` rejection
  is unhandled inside the `es-app` handler. The app's own URLs are always `encodeURIComponent`-encoded
  (`Services/media.js:33`), so this needs a crafted or truncated URL.
- Impact: unhandled promise rejection in main (no handler, see C-02); the request hangs or fails with a generic error.
- Fix: wrap both handlers, return 400 / 404 on error.
- Size: S. Tier: T1.

### C-11 `media:probe` and `ffmpeg:run` have no timeout
- Status: SUSPECTED
- Evidence: `electron/media.js:214-229` and `:199-209` wait for `close` forever; only `ffmpegBin.js:43` uses a timeout
  (15 s) for version probes. A probe is started for every import.
- Trigger: a file on a disconnected network share or a sleeping external drive, a corrupt file that makes ffmpeg stall.
- Impact: import spinner never finishes; with several files the ffmpeg processes pile up until quit.
- Fix: kill the probe after 30 s and return `{ ok: false }`; optional idle timeout for `ffmpeg:run`.
- Size: S. Tier: T1.

### C-12 Audio output removal or device change is not handled
- Status: SUSPECTED
- Evidence: no `devicechange` or `statechange` handler anywhere in `src/` (grep); `Services/audioEngine.js` owns the
  `AudioContext`. filmcraft restarts a dropped stream at the same position (its G17).
- Trigger: unplugging headphones, Bluetooth disconnect, driver reset, sleep/wake (context becomes `suspended` or
  `closed`).
- Impact: silent playback until the app restarts; export is not affected.
- Fix: on `statechange` to `suspended`/`interrupted` call `resume()` on the next play; on `devicechange` re-apply
  `setSinkId` and rebuild the context if it is `closed`.
- Size: S. Tier: T1.

### C-13 Undo history keeps whole-sequence snapshots; stacks of deleted sequences stay
- Work status (2026-11-07, T2): (b) Done and unit tested. Measured with 2,000 clips in Node: 100 steps hold 247 MB of heap (each step is a whole sequence copy, more than this entry assumed); a budget of 20 snapshots holds 50 MB. Default budget 100 M JSON characters per sequence, at least 5 steps kept.
- Status: SUSPECTED
- Evidence: `src/Core/store.js:160-213` records `before` / `after` sequence objects per step (100 steps per sequence,
  `:125`); the code already keeps unchanged sub-objects shared (`:184`), which limits cost, but `stacks` (`:112`) is never
  cleaned when a sequence is deleted.
- Impact: slow growth of memory in very long sessions on large sequences; not a first-order crash cause.
- Fix: measure with a 2,000-clip sequence; delete the stack when a sequence is removed; consider a byte budget instead of
  a step count.
- Size: S to M. Tier: T1 for the stack cleanup, T2 if a byte budget is added.

### C-14 Single-instance lock is requested after the window setup has been registered
- Status: SUSPECTED
- Evidence: `electron/main.js:200` `if (!app.requestSingleInstanceLock()) app.quit();` comes after `app.whenReady().then(...)`
  (`:157`) which creates the window. Whether the second process still reaches `createWindow` before exiting was not tested.
- Impact: a second launch from Explorer (double-click on a project) may flash a window or briefly compete for the
  userData files.
- Fix: move the lock check to the top of `main.js` and return before registering handlers.
- Size: S. Tier: T1.

### C-15 Packaged FFmpeg path depends on implicit unpacking
- Status: SUSPECTED (low). The 4 Nov packaged smoke test passed, so this works today.
- Evidence: `electron/ffmpegBin.js:15` rewrites `app.asar` to `app.asar.unpacked`; `package.json` `build` has no
  `asarUnpack`. It works only while electron-builder auto-unpacks executables.
- Fix: add `"asarUnpack": ["node_modules/ffmpeg-static/**"]` and a post-build check that the file exists. Install
  paths with spaces or Thai characters are safe, spawn takes an argument array.
- Size: S. Tier: T1.

### C-16 Export frames cross IPC as full raw buffers
- Work status (2026-11-07, T2): Partly done: frames without alpha go as rgb24 (25% fewer IPC bytes; H.264 and ProRes output identical to rgba, largest difference 0, `scripts/test_export_memory.mjs`), audio decode cache freed after each mix. Peak memory of a real export not measured; export not yet run in the real app: the Electron lock was unavailable.
- Status: SUSPECTED (performance and memory pressure)
- Evidence: `electron/media.js:187` `job:write` receives each raw frame from the renderer (`ffjobs.js:90`). Back-pressure is
  handled correctly (`drain`), but a 4K RGBA frame is about 33 MB copied per frame through structured clone.
- Impact: high peak memory and GC pauses on 4K or long exports; contributes to renderer out-of-memory during export.
- Fix: reduce the pixel format before the IPC (rgb24 / yuv420 readback in the shader) and reuse buffers; measure first.
- Size: M. Tier: T2.

## Part 2. Gap analysis against filmcraft (what a user would notice)

Already covered by EditorStage and therefore not listed: three-point editing and trims, trim monitor and dynamic trimming,
markers, nesting, keyframe graph editor, Lumetri-style grading with LUTs and scopes, masks and tracking, 35+ filters,
transitions, loudness measurement, AAF, EDL, FCPXML and Premiere XML, proxies, export queue in a background window,
Smart Render, render preview files, auto-save versions, atomic saves, Thai text and captions. Ignored as not relevant to a
desktop JS app: own codec implementations, wgpu, WebAssembly build, CLI / MCP control channel, egui.

### G-01 Crash handling and safe graphics mode
See C-01, C-02, C-07, C-09. Counted once there.

### G-02 OpenTimelineIO import and export
- Status: CONFIRMED missing (no `.otio` handling in `src/`, `electron/` or `scripts/`)
- Reference: README Interchange, OTIO round-trip.
- Impact: no open interchange route to Resolve, Blender, Nuke or review tools besides XML and EDL.
- Fix: a JSON writer / reader for Timeline, Track, Clip, Gap, Transition, Marker with `metadata.editorstage` for extras,
  next to `Services/interchange/`.
- Size: M. Tier: T1.

### G-03 DNxHR / DNxHD and MXF export
- Status: CONFIRMED missing (no `dnx` in `src/`)
- Reference: README Export (DNxHR in MOV, MXF OP1a).
- Impact: broadcast and finishing delivery formats are absent next to ProRes.
- Fix: add ffmpeg `dnxhd` presets (DNxHR LB to 444, MOV) and an MXF OP1a muxer preset in the export dialog; needs the
  `ffmpegCaps.js` encoder check. MXF with DNxHR and start timecode may need extra args; verify with the bundled build.
- Size: M. Tier: T1.

### G-04 Image sequence import and export (PNG, with alpha)
- Status: CONFIRMED missing in `src/` (no image-sequence import path; only one e2e script mentions it)
- Reference: README Stills and Export (PNG sequences).
- Impact: VFX and animation round trips need numbered frames; import of `frame_0001.png` as one clip is not possible.
- Fix: detect numbered files on import and map them to one clip through ffmpeg `-framerate -i %04d.png`; add export
  "PNG sequence" with the existing frame loop.
- Size: M. Tier: T1.

### G-05 Export Markers as CSV
- Status: CONFIRMED missing (no CSV marker export in `src/`)
- Reference: README Markers, review notes export.
- Impact: sequence review notes cannot leave the app.
- Fix: Markers menu command writing name, colour, in, out, duration, comment (UTF-8 with BOM for Thai in Excel).
- Size: S. Tier: T1.

### G-06 Audio mixer depth: sends, submixes, automation modes
- Work status (2026-11-07, T2): Not started. Size L, touching playback, export and the mixer UI; it needs real-app verification.
- Status: partly. A mixer panel exists (`Panels`/audio files mention track mixer); no submix, send or Read / Latch /
  Touch / Write automation recording was found (`grep` for submix, send, latch finds nothing).
- Reference: README Audio (insert slots, sends, submixes, mix track, console-style automation).
- Impact: mix work needs manual keyframing; no buses for dialogue / music stems.
- Fix: stage it: (1) Touch / Latch recording of volume and pan into track keyframes during playback (T2), (2) submix
  tracks and sends in `audioEngine.js` (T2). Audio-effect insert slots per track if absent.
- Size: L. Tier: T2.

### G-07 SCC / CEA-608 / CEA-708 caption formats
- Status: CONFIRMED missing (no SCC or CEA writer; SRT, VTT, ASS exist)
- Reference: README Titles and captions.
- Impact: broadcast caption delivery is not possible.
- Fix: SCC import and export with frame-accurate timing and drop-frame support; 708 can be left out.
- Size: M. Tier: T1.

### G-08 OMF export
- Work status (2026-11-07, T2): Not done. No OMF reader exists on this machine to verify output, and the entry itself says to do it only if a Pro Tools user needs it.
- Status: CONFIRMED missing (already recorded as a limitation in `docs/PROGRESS.md` Phase 9: no OMF reader on this machine
  to verify output).
- Reference: README Interchange, OMF 2.0.
- Fix: only if a Pro Tools user needs it; AAF already covers Pro Tools, Resolve and Premiere.
- Size: L. Tier: T2.

### G-09 Exact integer time base
- Work status (2026-11-07, T2): Drift test written. Model (`scripts/test_drift.mjs`, cut at every frame for 2 hours at 29.97, 23.976 and 59.94, plus EDL, FCPXML and Premiere XML): no drift, 47 passed. It assumes seeks round to the microsecond; if they truncate, 3 of 215,784 frames at 29.97 land one frame early. Real-file check (`scripts/e2e/drift.cjs`) written but NOT run, so the decision is still open. Decimal rates slip one source frame after 9.27 h (29.97), 11.59 h (23.976), 4.63 h (59.94).
- Status: SUSPECTED gap (not verified)
- Reference: all edits on 254,016,000,000 ticks per second so 23.976, 29.97 drop-frame and 59.94 never drift.
- Evidence: no tick-based time in `src/` (grep for ticks and the constant finds only unrelated files); sequence time is
  seconds as floats (`Core/clipTime.js`).
- Impact: possible one-frame drift on very long 29.97 / 23.976 sequences and in XML / AAF round trips. Not measured.
- Recommendation: first add a long-sequence drift test (2 hours at 29.97, cut at every frame, export, compare frame counts)
  before deciding. A full change of the time model would be a subsystem rewrite touching every module.
- Size: L (only if the test fails). Tier: T3, justified only by a failing drift test.

### G-10 Audio device recovery
See C-12.

### G-11 Items present in filmcraft that were not verified in our app
Not claimed as gaps because evidence was not gathered: OpenType shaping and bidirectional text beyond Thai, Immersive VR
effects, Hue-vs curves depth (files exist), Teletext captions, MPEG-TS / MXF / AVI import coverage through ffmpeg,
hardware-decoder selection, UI localization (filmcraft targets 12 languages, 3 missing).

## Counts

| Tier | Items |
|------|-------|
| T1 | C-01, C-02, C-03, C-07a, C-08, C-10, C-11, C-12, C-13a, C-14, C-15, G-02, G-03, G-04, G-05, G-07 (16) |
| T2 | C-04, C-05, C-06, C-07b, C-09, C-13b, C-16, G-06, G-08 (9) |
| T3 | G-09 (1, conditional) |

Suggested order of work: C-02 and C-01 first (they make every later crash diagnosable), then C-04, C-05, C-06 together
(one eviction design for elements, textures and contexts), C-07, C-09, C-03, C-08, then the T1 gaps.

## T1 status (2026-11-07, after implementation)

Done and run: C-01 (crash e2e with a forcefully crashed renderer, simulated hang and GPU loss), C-02, C-10, C-13a, C-14, G-02, G-03
(real DNxHR and MXF exports), G-04 export (real PNG sequence with alpha), G-05, G-07. Done, covered by unit or config tests only:
C-03 (never triggered by a real render error), C-07a, C-07b wiring (software fallback not run), C-08, C-11, C-12 (resume and
sink re-apply only; a closed context is not rebuilt), C-15, G-04 import (conversion tested, menu command not clicked).
Per-item table: `docs/PROGRESS.md`. Tests: `test_crashlog`, `test_scc`, `test_presets`, `test_interchange`, `test_store`,
`scripts/e2e/crash.cjs`, `scripts/e2e/gaps.cjs`.
