# EditorStage — แผนอัปเกรดให้เหนือกว่า Premiere Pro และ CapCut

> ไฟล์นี้คือคำสั่งงานสำหรับ Claude Code อ่านให้จบก่อนเริ่มงาน แล้วทำทีละ Phase ตามลำดับ

## 0. บริบทโปรเจกต์

- EditorStage คือโปรแกรมตัดต่อวิดีโอแบบ Offline (Electron 33 + React 18 + FlexLayout + WebGL2 compositor + Web Audio + FFmpeg) build ด้วย esbuild (`scripts/build.mjs`)
- โครงสร้างหลัก:
  - `src/Core/` — `commands.js` (คำสั่งทั้งหมด), `menus.js`, `editing.js`, `params.js` (keyframes), `store.js`, `shortcuts.js`, `tools.js`, `effectsCatalog.js`
  - `src/Renderers/Compositor.js` — compositor หลายเลเยอร์บน GPU; `fx/videoEffects.js` (GLSL ~100 เอฟเฟกต์), `fx/transitions.js`
  - `src/Services/` — `media.js`, `exporter.js`, `audioEngine.js`, `audioFx.js`, `graphics.js` (Title/Shape), `stabilize.js`, `morph.js`, `vision.js`, `preview.js`, `versions.js`, `archive.js`, `audiostage.js`, `mogrt/*`
  - `src/Services/ai/` — `stt.js` (Whisper ผ่าน transformers.js), `captions.js`, `diarize.js`, `reframe.js`, `silence.js`
  - `src/Components/` — `Panels.jsx`, `Panels2.jsx`, `Timeline.jsx`, `EffectControls.jsx`, `Dialogs.jsx`, `SmartTools.jsx`, `MogrtPanel.jsx`, `TransformOverlay.jsx`, `WorkflowPanels.jsx`
  - `electron/` — `main.js`, `preload.js`, `media.js`, `workflow.js` (IPC ไปยัง FFmpeg ฯลฯ)
- ใน `commands.js` ส่วนบนจะประกาศคำสั่งเป็น `stub(...)` ก่อน แล้วส่วนล่างค่อย `Object.assign(commands, …)` เขียนทับด้วยของจริง ดังนั้นตอนเช็คว่าคำสั่งไหนยังเป็น stub ต้องดูค่า **สุดท้าย** ของแต่ละ id

## 1. กฎหลัก (ต้องทำตามทุกข้อ)

1. **ฟรีและ Offline 100%**: ไม่มีระบบสมาชิก ไม่มีลายน้ำ ไม่มีฟีเจอร์ล็อก และไม่ต้องต่ออินเทอร์เน็ตตอนใช้งาน (ดาวน์โหลด model ล่วงหน้าผ่านสคริปต์แบบเดียวกับ `scripts/fetch_models.mjs` ได้)
2. **ไลเซนส์**: ไลบรารีหรือ model ทุกตัวที่เพิ่มต้องใช้เชิงพาณิชย์ได้ (MIT / BSD / Apache-2.0 / MPL / ISC / CC0 / CC-BY) **ห้าม** ใช้ตัวที่เป็น Non-Commercial (เช่น RMBG-1.4, MMS-TTS) หรือ GPL ที่บังคับเปิดซอร์สทั้งโปรแกรม ให้ตรวจไลเซนส์จริงก่อนใช้ทุกครั้ง และบันทึกลง `THIRD_PARTY_LICENSES.md` (ชื่อ, เวอร์ชัน, ไลเซนส์, ลิงก์)
3. **ห้ามทำ** การเชื่อมต่อกับ Photoshop-clone / Illustrator-clone ในรอบนี้ เพราะสองโปรแกรมนั้นยังไม่ได้สร้าง (การเชื่อมกับ AudioStage ที่มีอยู่แล้วให้คงไว้)
4. **ห้ามมีเมนูที่เป็น stub** ในตอนส่งงาน ทุกเมนูต้องทำงานจริง ถ้าทำไม่ได้จริงให้ซ่อนเมนูนั้นและเขียนเหตุผลไว้ในรายงาน ห้ามแสดงข้อความ "scaffolded - logic pending" ให้ผู้ใช้เห็น
5. **ห้ามทำของเดิมพัง**: ทุกการแก้ไขต้องรองรับ Undo/Redo ผ่าน `edit(...)` ใน store ไฟล์โปรเจกต์ `.esproj` เก่าต้องเปิดได้ (ถ้าเพิ่ม field ใหม่ต้องมีค่า default) และสิ่งที่เห็นใน Preview ต้องตรงกับไฟล์ที่ Export
6. **ประสิทธิภาพ**: งานหนัก (AI, วิเคราะห์เสียง, tracking) ต้องรันใน Web Worker หรือ main process มี progress bar และกดยกเลิกได้ UI ห้ามค้าง
7. **ทำทีละ Phase**: จบแต่ละ Phase ให้รัน `npm run build` ให้ผ่าน ทดสอบฟีเจอร์ด้วยไฟล์ใน `test-assets/` (สร้างไฟล์ทดสอบเพิ่มด้วย FFmpeg ได้) แล้วสรุปสั้น ๆ ว่าทำอะไรไป และอะไรยังไม่ได้ทำพร้อมเหตุผล
8. ชื่อเมนูและพาเนลให้ใช้แบบ Premiere Pro ต่อไป (ภาษาอังกฤษ) ส่วนฟีเจอร์ใหม่สไตล์ CapCut ให้รวมไว้ในพาเนลใหม่ชื่อ **Create** (ดู Phase 3)

---

## Phase 1 — แก้บั๊กและเมนูที่ยังเป็น stub

1. **Title เบลอตอน Export**: `src/Services/graphics.js` → `graphicCanvas()` ตอนนี้จำกัดความกว้างไว้ที่ 1280px (`Math.min(1, 1280 / dims.w)`) ให้แก้เป็นวาดตามความละเอียดที่ใช้ render อยู่ ณ ตอนนั้น (Preview ใช้ขนาด Preview, Export ใช้ขนาดเต็มของ Sequence เช่น 4K) และให้ cache แยกตามขนาด
2. **ฟอนต์**: Title ตอนนี้ใช้ได้แค่ 10 ฟอนต์ใน `FONTS` ให้ใช้ `queryLocalFonts()` เหมือนที่ `MogrtPanel.jsx` ทำ (FontPicker) ทำ FontPicker ตัวเดียวใช้ร่วมกัน มีช่องค้นหาและแสดงตัวอย่างฟอนต์ รองรับฟอนต์ไทย ถ้าโปรเจกต์ใช้ฟอนต์ที่เครื่องนี้ไม่มี ให้แจ้งเตือน
3. **Keyframe Interpolation**: `src/Core/params.js` ตอนนี้มีแค่ linear ให้เพิ่มชนิด keyframe เป็น Linear / Hold / Ease In / Ease Out / Ease In-Out / Bezier (เก็บ tangent ไว้ใน keyframe) ใช้ได้ทุกพารามิเตอร์ที่ keyframable ได้ คลิกขวาที่ keyframe ใน Effect Controls เพื่อเปลี่ยนชนิดได้ และ Export ต้องใช้สูตรเดียวกัน
4. ลบ `RT` ที่ไม่ได้ประกาศไว้ใน `commands.js` (ประมาณบรรทัด 485–495 ที่ตั้งชื่อตัวแปรเป็น `RT_UNUSED` แต่ไปอ้าง `RT`) และลบ block ที่ถูกเขียนทับจนไม่ได้ใช้แล้ว
5. ทำคำสั่งเหล่านี้ให้ทำงานจริง (ตอนนี้ยังไม่มีคำสั่งจริง หรือตกไปที่ stub):
   - `clip.audioChannels` — Dialog สำหรับ map ช่องเสียง (Mono/Stereo, สลับ L/R, ใช้แค่ L หรือแค่ R)
   - `clip.fieldOptions` — Reverse Field Dominance / Always Deinterlace / Flicker Removal (ใช้ `yadif` ของ FFmpeg ตอน import/proxy หรือทำเป็น shader)
   - `clip.frameHold` — Hold On (Source TC / In Point / Out Point / Marker), Hold Filters ทั้งคู่ใช้ร่วมกับ **Add Frame Hold** และ **Insert Frame Hold Segment** (ดู Phase 2)
   - `clip.editSubclip` — ตั้ง In/Out ของ subclip ใน Project panel
   - `file.exportEDL` (CMX3600), `file.exportFCPXML` (FCPXML 1.9+), `file.exportSelection` (Premiere/FCP7 XML `xmeml`) และ `file.exportAAF` / `file.exportOMF` ถ้าทำได้ (ถ้าเขียน AAF/OMF ให้ถูกต้องไม่ได้ ให้ซ่อนเมนูตามกฎข้อ 4) เพิ่ม **Import** XML/EDL/FCPXML ด้วย
   - `ws.allPanels`, `ws.essentialGraphics`, `ws.learning` — ใน `layout.js` ยังไม่มี layout ของสามตัวนี้
6. ไล่ทุกเมนูใน `menus.js` และทุกปุ่มใน Components แล้วเขียนสคริปต์ `scripts/check_commands.mjs` ที่แสดงรายชื่อ command id ที่ไม่มีอยู่จริงหรือยังเป็น stub ต้องได้ผลเป็น 0 ก่อนจบงาน

## Phase 2 — ตัดต่อระดับมืออาชีพ (ทำให้เกิน Premiere Pro)

1. **Graph Editor** ใน Effect Controls: แสดงกราฟ Value/Speed ของพารามิเตอร์ ลาก bezier handle ได้ และมี preset ease แบบ CapCut (Ease, Bounce, Elastic, Back)
2. **Speed Ramp / Time Remapping**: ทำให้ Time Remapping (`speed` keyframable) ใช้ได้จริงทั้งใน Preview, เสียง และ Export ลากเส้นความเร็วบน clip ใน Timeline ได้แบบ Premiere และ:
   - Speed Curve preset แบบ CapCut: Montage, Hero, Bullet, Jump Cut, Flash In, Flash Out และ Custom
   - ช่องเลือก "Maintain Audio Pitch"
   - Frame Sampling: Frame Sampling / Frame Blending / Optical Flow (Optical Flow ใช้ RIFE จาก Phase 4)
   - Reverse clip
3. **Freeze Frame**: Add Frame Hold, Insert Frame Hold Segment และ Export Frame (PNG/JPG) จาก Program Monitor
4. **Adjustment Layer, Color Matte, Bars and Tone, Black Video, Transparent Video, Countdown Leader** ใน File > New
5. **Mask Tracking**: ปุ่ม Track Forward / Backward / Frame-by-frame บน Mask แต่ละอัน ให้ track ด้วย optical flow / feature (ทำใน Worker) และให้ Mask ที่ track แล้วกลายเป็น keyframe ทำ **Point Tracker** ด้วย เพื่อให้ Title/Sticker วิ่งตามวัตถุได้ (ซึ่ง Premiere ทำไม่ได้)
6. **Color**:
   - Color Match (เทียบกับเฟรมอ้างอิง ใช้สถิติ Lab + skin tone) และ Auto Color / Auto Tone
   - LUT: นำเข้า `.cube` / `.3dl` ได้ทั้งแบบ Input LUT และ Creative LUT พร้อมตัวปรับ Intensity
   - เช็คว่า Scopes (Waveform / Vectorscope / Histogram / RGB Parade) ใช้ได้ครบทุกตัว
7. **Scene Edit Detection**: ใช้ filter `scdet` ของ FFmpeg ตัดคลิปหรือวาง Marker ตรงจุดเปลี่ยนฉาก
8. **Text-Based Editing**: ใช้ Whisper ที่มีอยู่ทำ Transcript ที่เลือกคำได้ ลบหรือย้ายข้อความแล้ว Timeline ripple ตาม มีปุ่มลบคำฟุ่มเฟือย (อืม, เอ่อ, um, uh, แบบว่า ฯลฯ ตั้ง list เองได้) และลบช่วงเงียบ ค้นหาคำใน Transcript ได้
9. **Proxy Workflow**: Create Proxies (ProRes Proxy / H.264 low-res), ปุ่มสลับ Proxy, Attach/Relink Proxy และ Export ต้องใช้ไฟล์ต้นฉบับเสมอ
10. **Relink / Offline Media**: เมื่อไฟล์หาย ให้แสดงสถานะ Offline และมี Dialog Locate (ค้นหาอัตโนมัติจากชื่อและขนาดไฟล์)
11. **Export**:
    - ตรวจ encoder ด้วย `ffmpeg -encoders` แล้วรองรับ **NVENC / QSV / AMF** (H.264/HEVC/AV1) ถ้ามีในเครื่อง ถ้าไม่มีให้กลับไปใช้ libx264
    - **Export Queue** (สั่งหลายงาน, ทำงานเบื้องหลัง, ยกเลิกได้)
    - Preset แยกแพลตฟอร์ม: YouTube 1080p/4K, TikTok/Reels/Shorts 9:16, Instagram 1:1/4:5, Facebook และ Podcast audio
    - Loudness Normalize ตอน Export (−14 LUFS สำหรับ Streaming, −23 LUFS สำหรับ Broadcast) พร้อม True Peak limit
    - AV1, 10-bit (HEVC Main10 / ProRes 422 HQ / 4444 + alpha), Smart Render (copy stream เมื่อคลิปไม่ได้ถูกแก้ไข)
    - เขียน Chapters / Markers ลงในไฟล์ MP4 ได้
12. **Auto Ducking**: ใน Essential Sound ให้กดปุ่มแล้วสร้าง keyframe ลดเสียงเพลงอัตโนมัติตอนมีเสียงพูด (มีพื้นฐานใน `audioEngine.js` อยู่แล้ว ให้ทำเป็น keyframe ที่แก้ไขต่อได้)

## Phase 3 — ให้ครบแบบ CapCut (พาเนลใหม่ **Create**)

สร้างพาเนล **Create** แบบแท็บ: Text, Stickers, Effects, Filters, Transitions, Audio, Templates, AI โดยทุกอย่างลากลง Timeline ได้และดู preview ได้เมื่อเอาเมาส์ชี้

1. **Text Animation**: In / Out / Loop (Fade, Typewriter, Pop, Bounce, Slide, Zoom, Shake, Wave, Glitch, Blur-in, ทีละตัวอักษร / ทีละคำ / ทีละบรรทัด) ขยับได้ทั้งตัวอักษร, คำ และบรรทัด
2. **Text Style Presets**: ไม่น้อยกว่า 40 แบบ (Stroke หลายชั้น, Glow, Shadow, Gradient fill, กล่องพื้นหลังมุมโค้ง, Neon, Comic) ผู้ใช้บันทึก preset เองได้ ตัว Title ต้องรองรับ: letter/line spacing, หลายสีในข้อความเดียว (rich text), ข้อความตามเส้นโค้ง, Auto-fit ในกล่อง
3. **ลบพื้นหลังด้วย AI (Remove Background)**: ใช้ MediaPipe Image/Selfie Segmenter (มี `@mediapipe/tasks-vision` อยู่แล้ว) หรือ model segmentation อื่นที่ไลเซนส์ผ่าน ทำเป็นเอฟเฟกต์ที่ปรับ edge feather/choke ได้ และ cache mask ไว้ใช้ตอน Export
4. **Auto Beat Sync**: วิเคราะห์จังหวะเพลง (onset detection + tempo, เขียนเองใน Worker) แล้ววาง Beat Markers ตั้งระดับ Beat/Downbeat ได้ และมีคำสั่ง **Cut to Beat** ตัดหรือจัดคลิปที่เลือกให้ลงจังหวะ
5. **Canvas / Background Fill**: เมื่อสัดส่วนคลิปไม่ตรงกับ Sequence ให้เลือกพื้นหลังเป็น Blur (ปรับระดับได้), สี หรือรูปภาพ ได้ทั้งต่อคลิปและทั้ง Sequence
6. **Filters**: LUT pack ที่ทำเองอย่างน้อย 30 แบบ (Cinematic, Vintage, Teal&Orange, B&W, Film, Food, Portrait…) กดแล้วใช้ได้เลยพร้อมตัวปรับ Intensity ห้ามคัดลอก LUT ของ CapCut หรือ Adobe
7. **Video Effects สำเร็จรูป** สไตล์ CapCut ที่เขียนด้วย GLSL ใน `videoEffects.js`: Shake, Flash, RGB Split, VHS, Film Grain, Light Leak (procedural), Zoom Blur Punch, Glitch, Lens Flash, Blur In/Out, Mirror Kaleidoscope, Old TV, Split Screen 2/3/4/9
8. **Stickers / Overlays**: คลัง Sticker ที่ทำเอง (SVG/PNG/Lottie, ไลเซนส์ของเราเองหรือ CC0) อย่างน้อย 50 ชิ้นเป็นจุดเริ่มต้น ผู้ใช้ import เพิ่มเองได้ (รวม GIF/APNG/WebP animated) และใช้ Point Tracker จาก Phase 2 ให้ Sticker วิ่งตามวัตถุได้
9. **Templates**: ระบบ Template ของ EditorStage เอง (`.estemplate` = sequence + placeholder) กดแทนที่สื่อได้ และ "Save as Template" จาก Sequence ใดก็ได้ ส่วน MOGRT ที่มีอยู่แล้วให้แสดงอยู่ในแท็บนี้ด้วย
10. **Auto Captions ขั้นสูง**: ต่อยอดจาก `captions.js` / `SmartTools.jsx`
    - Caption Style presets แบบ CapCut, เน้นคีย์เวิร์ดอัตโนมัติ (สี/ขนาด), อีโมจิอัตโนมัติ (เปิด/ปิดได้)
    - **ภาษาไทยต้องตัดบรรทัดถูกคำ**: ใช้ `Intl.Segmenter('th', { granularity: 'word' })` ห้ามตัดกลางคำ และตั้งจำนวนอักษรต่อบรรทัด/จำนวนบรรทัดได้
    - Export SRT / VTT / ASS และ Burn-in
11. **Text-to-Speech**: ใช้ TTS engine แบบ offline ที่ไลเซนส์ใช้เชิงพาณิชย์ได้ (ให้หาและตรวจไลเซนส์เอง โดยเฉพาะเสียงภาษาไทย ถ้าไม่มีเสียงไทยที่ไลเซนส์ผ่าน ให้รองรับเฉพาะภาษาที่มี และเขียนลงรายงาน) แปลง Caption track เป็นเสียงพูดได้ทั้ง track
12. **Voice Changer / Voice Effects**: Chipmunk, Deep, Robot, Radio, Telephone, Megaphone, Echo Hall, Monster ประกอบจาก `audioFx.js` + pitch worklet ที่มีอยู่
13. **AI Noise Reduction**: ใช้ RNNoise (WASM, BSD-3) แทน DeNoise แบบ filter ประมาณเดิม และทำ **Enhance Speech** = RNNoise + EQ + compressor + de-esser + loudness ในปุ่มเดียว ส่วน DeReverb ให้ปรับให้ดีขึ้นด้วย หรือเอาสถานะ `approx` ออกเมื่อคุณภาพดีพอ
14. **Audio library**: SFX และเพลงที่ไลเซนส์ CC0 หรือที่ทำเอง (ถ้าไม่มีให้ทำแค่ระบบคลังที่ผู้ใช้เพิ่มไฟล์เองได้ พร้อม tag และค้นหา)

## Phase 4 — เหนือกว่าทั้ง Premiere Pro และ CapCut

1. **Thai-first**:
   - UI สลับภาษา ไทย/English ได้ (ระบบ i18n, ชื่อเมนูภาษาอังกฤษยังเป็นค่าเริ่มต้น)
   - Whisper: เพิ่มตัวเลือก model `small` / `medium` / model ที่ fine-tune ภาษาไทย (ไลเซนส์ต้องผ่าน) โดยดาวน์โหลดผ่านสคริปต์ และแสดงคำเตือนว่า `base` ฟังภาษาไทยได้ไม่แม่น
   - ตรวจแก้คำผิดใน Caption ด้วยพจนานุกรมที่ผู้ใช้เพิ่มเองได้ (ชื่อคน, ชื่อแบรนด์)
   - รวมฟอนต์ไทยไลเซนส์ OFL (เช่น Sarabun, Kanit, Prompt, Mitr, Noto Sans Thai) ไว้ในโปรแกรม
2. **Long-to-Shorts**: เลือกคลิปยาว (podcast/สตรีม/vlog) แล้ว AI หาช่วงที่น่าสนใจ (จาก transcript + พลังงานเสียง + การเปลี่ยนฉาก + เสียงหัวเราะ/เสียงดัง) สร้าง Sequence 9:16 หลายอันพร้อม Reframe + Captions + Silence Cut อัตโนมัติ (ใช้ `reframe.js`, `captions.js`, `silence.js`) ผู้ใช้ปรับคะแนนและแก้ไขต่อได้
3. **Smart B-Roll**: ทำ index สื่อในโปรเจกต์ (ชื่อไฟล์, transcript, label จาก `vision.js`/object detection ที่มีอยู่) แล้วแนะนำ B-roll ตาม transcript ในช่วงนั้น กดวางบน track ด้านบนได้
4. **AI Frame Interpolation**: ใช้ RIFE (MIT, ONNX ผ่าน onnxruntime) ทำ Optical Flow slow-motion และแปลง fps (24→60)
5. **AI Upscale**: ใช้ Real-ESRGAN (BSD-3, ONNX) ทำเอฟเฟกต์ Super Resolution 2×/4× (render ใน Export หรือ pre-render เป็นไฟล์)
6. **Auto Edit to Music**: เลือกคลิปหลายตัว + เพลง แล้วสร้าง montage ตาม beat (ใช้ Beat Sync จาก Phase 3) เลือกช่วงที่ดีที่สุดของแต่ละคลิป (ภาพชัด, ไม่สั่น, มีหน้าคน) พร้อม transition และ filter
7. **Command Palette** (Ctrl+Shift+P): ค้นหาและรันทุกคำสั่งหรือเอฟเฟกต์ได้จากคีย์บอร์ด
8. **Project Health Check** ก่อน Export: เตือนเมื่อมี offline media, ฟอนต์หาย, ช่องว่างดำใน Timeline, เสียง clip, loudness ผิดเป้า, Caption เกินขอบ safe area

## 2. Definition of Done

- `npm run build` ผ่าน ไม่มี error/warning ใหม่ และ `npm start` เปิดโปรแกรมได้
- `scripts/check_commands.mjs` ได้ผล 0 stub / 0 command ที่หาไม่เจอ
- ทุกฟีเจอร์ใหม่: Undo/Redo ได้, บันทึกลง `.esproj` แล้วเปิดใหม่ได้ค่าเดิม, Preview ตรงกับ Export (ทดสอบด้วยการ Export จริงแล้วดึงเฟรมมาเทียบ)
- เพิ่มชุดทดสอบใน `scripts/` (แบบเดียวกับ `scripts/mogrt/test_*.mjs`) สำหรับ keyframe interpolation, speed ramp time mapping, EDL/FCPXML export-import round trip, Thai line breaking, beat detection
- `README.md` อัปเดตรายการฟีเจอร์ และ `THIRD_PARTY_LICENSES.md` ครบทุกตัว
- รายงานสุดท้าย: ตารางฟีเจอร์ (ทำแล้ว / บางส่วน / ไม่ได้ทำ + เหตุผล) เทียบกับ Premiere Pro และ CapCut

## 3. วิธีทำงาน

- เริ่มจาก Phase 1 ให้จบก่อน แล้วค่อยไป Phase 2 → 3 → 4
- ถ้างานใหญ่เกิน 1 session ให้ commit ทีละฟีเจอร์ด้วยข้อความ commit ที่ชัดเจน และเขียนความคืบหน้าลง `docs/PROGRESS.md` (✅/🟡/⬜ ต่อข้อ) เพื่อให้ session ถัดไปทำต่อได้
- ถ้าเจอทางเลือกเชิงออกแบบที่ใหญ่ (เช่น เปลี่ยนรูปแบบไฟล์ `.esproj`) ให้เลือกแบบที่ backward-compatible และเขียนเหตุผลไว้ใน `docs/PROGRESS.md`
- **ไม่ทำ**: Edit in Photoshop-clone / Illustrator-clone, ระบบบัญชีหรือ cloud, การอัปโหลดขึ้นโซเชียลโดยตรง
