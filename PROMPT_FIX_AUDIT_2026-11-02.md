# พรอมต์สำหรับ Claude Code — EditorStage: แก้ปัญหา + เติมของที่ขาด (ตรวจเมื่อ 2 พ.ย. 2026)

> วางพรอมต์นี้ใน Claude Code ที่เปิดโฟลเดอร์ `D:\BYS All Stages Projects\EditorStage`
> ทำงานเฉพาะในโฟลเดอร์นี้ ห้ามแก้โปรแกรมอื่น (การเชื่อมกับ AudioStage ให้แก้ฝั่ง EditorStage เท่านั้น)

## วิธีทำงาน
- อ่าน `README.md`, `docs/PROGRESS.md`, `docs/PROMPT_PREMIERE_FINAL.md` ก่อน
- ทำตามลำดับ A → B → C → D แล้วติ๊ก ☑ ในไฟล์นี้ + บันทึกใน `docs/PROGRESS.md` (เพิ่มหัวข้อ "Phase 8 — แก้จากการตรวจ 2 พ.ย. 2026")
- หลังแก้แต่ละข้อ: `npm run build` (ไม่มี warning ใหม่) + `npm test` + e2e ที่เกี่ยวข้องต้องผ่าน
- รอบนี้ตรวจแบบอ่านโค้ด/วิเคราะห์อัตโนมัติ ไม่พบบั๊กร้ายแรงที่ทำให้โปรแกรมล่ม ส่วนใหญ่เป็นของที่ยังขาดและความเรียบร้อย

---

## A. ปัญหาที่ควรแก้

### ☑ A1 — ไม่มีปุ่มปิดการแสดงผลของ video track (Toggle Track Output / รูปตา)
- ที่: `src/Components/Timeline.jsx` (หัว track มีแค่ Mute `M` สำหรับเสียง ~บรรทัด 189, 586) และ `src/Renderers/Compositor.js` `renderSequence()` (~บรรทัด 787–796) วาดทุก video track เสมอ
- ผล: ซ่อน V2/V3 ชั่วคราวเพื่อดูภาพด้านล่างไม่ได้ (Premiere มี) — `docs/PROGRESS.md` เขียนไว้ว่า "Mute ของ video track ไม่มีผลกับ compositor"
- แก้: เพิ่ม `track.hidden` (ปุ่มตาในหัว track + เมนูคลิกขวา "Toggle Track Output" + undo ได้ + บันทึกใน `.esproj`) แล้วข้ามใน `renderSequence()`, exporter, thumbnails, multicam, Smart Render
- เกณฑ์ผ่าน: Preview = Export (ซ่อน track แล้ว export ต้องไม่มี track นั้น) + test ใน e2e

### ☑ A2 — โค้ด WebGPU / WebCodecs เขียนไว้แต่ไม่ได้ต่อใช้งาน (dead code)
- ไฟล์ที่ไม่มีใครเรียกใช้เลย (ตรวจจาก import graph ของ `src/main.jsx`):
  - `src/Renderers/WebGPURenderer.js` (โครงเปล่า 12 บรรทัด)
  - `src/Renderers/WebGLRenderer.js`
  - `src/Services/codec.js` (probe WebCodecs + สร้าง decode worker)
- `scripts/build.mjs` ยัง build `dist/decoder.worker.js` แต่ไม่มีโค้ดไหนสร้าง Worker นี้ → ไฟล์ติดไปในตัวติดตั้งเปล่าๆ
- `package.json` description เขียนว่า "Electron + WebCodecs/WebGL/WebGPU/WASM" ซึ่งไม่ตรงกับของจริง (Compositor ใช้ WebGL2 อย่างเดียว ถอดเฟรมผ่าน `<video>`/FFmpeg)
- แก้ (เลือกอย่างใดอย่างหนึ่ง):
  - ทำให้ใช้งานจริง: ถอดเฟรมด้วย `VideoDecoder` (hardware) ตอน scrub/export เพื่อให้ไฟล์ long-GOP ไม่กระตุก (แก้ข้อจำกัด "Reverse ตอนเล่น preview ต้อง seek ทุกเฟรม")
  - หรือ ลบ/ย้ายไฟล์ที่ไม่ใช้ออกจาก `src/` เอา `decoder.worker.js` ออกจาก build และแก้ description ให้ตรง

### ☑ A3 — หน้าทดสอบ mogrt ติดไปในตัวโปรแกรมจริง
- ที่: `scripts/build.mjs` บรรทัด 11 และ 19 build `src/mogrt-test.js` + คัดลอก `mogrt-test.html` ลง `dist/` → ถูกแพ็กเข้าตัวติดตั้ง (`build.files` = `dist/**`)
- แก้: build หน้า test เฉพาะตอนพัฒนา (เช่น env `ES_DEV`) หรือใส่ `"!dist/mogrt-test.*"` ใน `build.files`

### ☑ A4 — หน้าต่างหลักไม่มีตัวกัน window.open / การเปลี่ยนหน้า
- ที่: `electron/main.js` ~บรรทัด 23 (`sandbox: false`) ไม่มี `setWindowOpenHandler` และ `will-navigate`
- ผล: ลิงก์ใน MOGRT/ข้อความ/ไฟล์ที่ลากมาวางอาจเปิดหน้าต่าง Electron ใหม่ที่มี preload API เต็ม หรือเปลี่ยนหน้าหลัก
- แก้: deny ทุก window.open (http/https → `shell.openExternal`), `will-navigate` → `preventDefault()` เมื่อไม่ใช่ไฟล์ของแอป

### ☑ A5 — โปรเจกต์ไม่มี git
- โฟลเดอร์มี `.gitignore` แต่ไม่มี `.git` → ย้อนกลับไม่ได้ถ้าแก้พัง
- แก้: `git init` + commit แรก (ตรวจ `.gitignore` ให้ไม่รวม `node_modules`, `dist`, `release`, `assets/models` ขนาดใหญ่, `third_party_source/*.tar.xz`)

### ☑ A6 — script ทดสอบ / build ที่ไม่สม่ำเสมอ
- `package.json` → `test:e2e` ใช้ `electron` ปนกับ `npx electron` (phase6e, phase6d) → ทำให้เหมือนกันทั้งหมด
- `dist:mac` ใช้ไม่ได้จริงจากเครื่อง Windows (`ffmpeg-static` ติดตั้ง binary ของ Windows, ต้อง build บน macOS + code sign) → ซ่อน script หรือเขียนหมายเหตุใน README

---

## B. ใบอนุญาต (ก่อนแจกจ่ายในวงกว้าง)
- ☑ `ffmpeg-static` เป็น GPL build — ตรวจว่าตัวติดตั้งมี source offer/ไฟล์ license ครบตาม `THIRD_PARTY_LICENSES.md` และ `licenses/` (มี `third_party_source/*.tar.xz` แล้ว — ตรวจว่าตรงเวอร์ชันกับ binary ที่แพ็กจริง)
- ☑ โมเดล AI ใน `assets/models/` (Whisper, EfficientDet, MediaPipe face/selfie) — ตรวจว่า license ของแต่ละโมเดลอยู่ใน Third-Party Notices ครบ

---

## C. เอกสาร
- ☑ README / About ระบุเวอร์ชัน 3.0.0 ตรงกับ `package.json` แล้ว — ตรวจอีกครั้งหลังแก้ทุกข้อและเพิ่ม version ถ้าจะ build ใหม่

---

## D. ฟีเจอร์ที่ยังขาด (จาก "ข้อจำกัด" ใน `docs/PROGRESS.md`)
เรียงจากคุ้มที่สุด:
1. ☑ **Toggle Track Output** (ข้อ A1)
2. ☐ **Optical Flow / AI frame interpolation** (Time Interpolation ยังซ่อนไว้ — ตารางเทียบ Premiere เป็น ❌)
3. ☐ Export Queue render แยกจาก Preview (ตอนนี้ Program Monitor ถูกล็อกระหว่าง render) — ใช้ hidden window / worker
4. ☐ Source patching แบบสองคอลัมน์ (V1 ต้นทาง → Vn ปลายทาง) แบบ Premiere
5. ☑ Remix ที่ยาวขึ้นไม่ควรเขียนทับคลิปถัดไป (ให้ ripple หรือถามก่อน)
6. ☐ Ellipse mask หมุนตาม tracking ได้
7. ☐ Color Match ปรับ curves/LUT ได้ (ตอนนี้แค่ Basic + gain), Face Detection ใช้โมเดลแทนตัวจำแนกสีผิว
8. ☐ Remove Background ใช้กับวัตถุอื่นนอกจากคน
9. ☐ Smart B-Roll ใช้ embedding เชิงความหมาย (ตอนนี้จับคู่ด้วยคำ)
10. ☐ AAF: ส่ง video reference, volume/pan keyframe, clip gain, crossfade; รองรับ 5.1 (ตอนนี้ downmix เป็น stereo); OMF
11. ☐ Import EDL/FCPXML ให้นำ effect/color/keyframe เข้ามาด้วย
12. ☑ ตัวแทน (proxy) คุมด้วย CRF แทน bitrate
13. ☐ Undo history ไม่หายเมื่อสลับ sequence (ตอนเปิด Short)
14. ☐ Thumbnail ของ nested sequence / MOGRT เป็นภาพจริง (ตอนนี้เป็น icon)
15. ☐ Whisper ภาษาไทย: ให้เลือกโมเดลใหญ่ขึ้น (small/medium) แบบดาวน์โหลดเพิ่ม เพราะ base ภาษาไทยยังไม่แม่น

## เกณฑ์ "เสร็จ"
- A1–A6 เสร็จ, `npm test` และ `npm run test:e2e` ผ่าน, `scripts/check_commands.mjs` 0 missing / 0 stubs
- build ตัวติดตั้งใหม่ (เพิ่ม version) เปิด `release/win-unpacked/EditorStage.exe` ได้ไม่มี error
- สรุปท้ายไฟล์นี้ว่าแก้อะไรไป อะไรยังไม่ได้ทำและเพราะอะไร

---

# รอบ 2 — ตรวจละเอียด (3 พ.ย. 2026)

**วิธีตรวจ:** อ่านโค้ด `electron/*`, `src/Core/store.js`, `src/Core/commands.js`, `src/Services/{exporter,media,versions}.js`, `EffectControls.jsx`, `shortcuts.js`, ไล่ดูไฟล์ใน `release/win-unpacked` ที่ build แล้ว และ**รันโค้ดจริง**กับ `src/Core/store.js` (bundle ด้วย esbuild แล้วรันใน Node) เพื่อยืนยันบั๊กกลุ่ม undo

**ผลชุดทดสอบ:** `npm test` ผ่านทั้งหมด (keyframes 26, timeremap 41, interchange 36, tracker 9, color 8, thai 16, tracks 55, clip view 26, effects 26, effect licenses 6, aaf 27, keys 26, marquee 10, trim 23, remix 46; `check_commands` 0 missing / 0 stubs) — `npm run test:e2e` **ยังไม่ได้รัน**ในรอบนี้ (หน่วยความจำเครื่องเหลือน้อย) ให้รันหลังแก้

**สถานะข้อ A1–A6 รอบแรก:** ยังไม่ได้แก้ทุกข้อ (ตรวจแล้ว 3 พ.ย.: ไม่มี `track.hidden`, ไฟล์ WebGPU/WebGL/codec ยังอยู่, `mogrt-test.*` ยังอยู่ใน `dist/`, ไม่มี `setWindowOpenHandler`/`will-navigate`, ไม่มี `.git`, description ยังเขียน WebCodecs/WebGPU)

สัญลักษณ์: 🔴 = ข้อมูลผู้ใช้หาย/เสียได้ · ✅ยืนยัน = รันโค้ดจริงแล้วเห็นผล · 🔎 = อ่านโค้ดแล้วเห็นชัด (ยังไม่ได้รันในแอป)

## E. บั๊กที่พบเพิ่ม (ทำก่อนหมวด D)

### ☑ E1 — 🔴 ✅ยืนยัน Undo/Redo ไม่ทำให้โปรเจกต์เป็น "ยังไม่บันทึก" → ปิดโปรแกรมแล้วไม่ถาม
- ที่: `src/Core/store.js` `undo()` / `redo()` (บรรทัด 130–145) ไม่ตั้ง `dirty: true`
- ผล (รันจริง): แก้ → Save → Undo → `dirty` ยังเป็น `false` → ปิดหน้าต่างไม่มีกล่อง Save / Don't Save → ไฟล์ `.esproj` ยังมีการแก้ที่ผู้ใช้ undo ไปแล้ว (เปิดใหม่ = ไม่ตรงกับที่เห็นตอนปิด)
- แก้: `undo()` / `redo()` / `deleteHistoryFrom()` ตั้ง `dirty: true` (ดีกว่า: จำ `savedIndex` ตอน Save แล้ว `dirty = historyIndex !== savedIndex` แบบ Premiere)

### ☑ E2 — ✅ยืนยัน ลากสไลเดอร์ต่อทันทีหลัง Undo (ภายใน 0.9 วินาที) = History เพี้ยน, Redo ทิ้งค่าใหม่
- ที่: `store.js` `edit()` — `lastCoalesce` ไม่ถูกล้างใน `undo()` / `redo()` / `commitSeq()` → edit ที่ตามมาถือว่า "รวมกับ step เดิม" จึงไม่ push snapshot และไม่ล้าง `redoStack`
- ผล (รันจริง): Opacity 0 → ลากเป็น 10 → Ctrl+Z (กลับเป็น 0) → ลากต่อเป็น 50 → Ctrl+Shift+Z ได้ **10** (ค่า 50 ที่เพิ่งลากหาย) → Ctrl+Z ได้ 50 — ลำดับประวัติผิด
- แก้: ตั้ง `lastCoalesce = { key: null, time: 0 }` ใน `undo`, `redo`, `commitSeq`, `switchSequence`, `loadProject`, `resetProject`

### ☑ E3 — ✅ยืนยัน สลับ sequence แล้วแผง History ยังโชว์ step เดิมที่ undo ไม่ได้แล้ว
- ที่: `store.js` `switchSequence()` ล้าง `undoStack/redoStack` แต่ไม่ล้าง `history` / `historyIndex`
- ผล (รันจริง): แก้ 2 step → สลับ sequence → History แสดง 2 step, index 2 → กด Undo ไม่เกิดอะไร / คลิก step ในแผง History ไม่ได้ผล
- แก้ขั้นต่ำ: รีเซ็ต `history` / `historyIndex` พร้อมกัน; ดีกว่า (= D13): เก็บ undo stack แยกต่อ sequence

### ☑ E4 — 🔴 🔎 แก้งานระหว่างกำลัง Save = งานที่แก้ระหว่างนั้นถูกนับว่า "บันทึกแล้ว"
- ที่: `src/Core/commands.js` `saveProject()` บรรทัด 357–359: `await writeFile(...)` แล้วค่อย `set({ dirty: false })`
- ผล: โปรเจกต์ใหญ่เขียนไฟล์หลายร้อย ms → ผู้ใช้แก้อะไรระหว่างนั้น → หลังเขียนเสร็จ `dirty=false` ทั้งที่ไฟล์ไม่มีการแก้นั้น → ปิดแล้วไม่ถาม
- แก้: จำตัวนับ edit ก่อนเขียน แล้ว `dirty = editCounter !== gen` หลังเขียนเสร็จ

### ☑ E5 — 🔴 🔎 Save ล้มเหลวเงียบ + เขียนทับไฟล์เดิมตรงๆ
- ที่: `electron/main.js` `fs:write` = `fs.writeFile(p, …)` (ไม่ atomic), `commands.js` `file.save` / `saveAs` / `saveCopy` ไม่มี try/catch
- ผล: ดิสก์เต็ม / OneDrive ล็อกไฟล์ / ไฟดับระหว่างเขียน → `.esproj` เดิมเสีย (ไฟล์ครึ่งเดียว = JSON.parse พัง เปิดไม่ได้ทั้งโปรเจกต์) และผู้ใช้ไม่เห็นข้อความอะไร; ในกล่อง "Save before closing" ถ้า Save พังก็ค้าง
- แก้: เขียน `<file>.tmp` → fsync → rename (ลองซ้ำเมื่อ EPERM/EBUSY), ตรวจพื้นที่ว่าง, แจ้ง error ชัดเจน + เสนอ Save As; ใช้กับ `.esproj`, presets, keymap, prefs, EDL/XML/AAF ด้วย

### ☑ E6 — 🔎 File > Open ไฟล์ `.esproj` ที่เสีย = ไม่มีข้อความอะไรเลย
- ที่: `commands.js` `openPath()` — `JSON.parse` / `loadProject` ไม่มี try/catch (`file.open` ไม่ได้ `.catch`; `openRecent` มี)
- แก้: แจ้ง "ไฟล์โปรเจกต์เสีย" + เสนอเปิดจาก Project History / Auto-save แทน; ตรวจโครงสร้างขั้นต่ำ (`sequence.tracks`, `clips` เป็น array) ก่อน `loadProject`

### ☑ E7 — 🔴 🔎 Auto-save ของโปรเจกต์ที่ยังไม่ได้ Save ใช้โฟลเดอร์ตามชื่อ → โปรเจกต์ "Untitled" ทุกตัวปนกัน
- ที่: `src/Services/versions.js` `historyDir()` บรรทัด 17: `userData/autosave/<projectName>.history`
- ผล: โปรเจกต์ใหม่ 2 ตัวชื่อ Untitled (หรือชื่อซ้ำก่อนกด Save) เขียนประวัติลงที่เดียวกัน → Restore อาจได้โปรเจกต์อีกตัว
- แก้: ให้แต่ละโปรเจกต์มี `projectId` (uuid) เก็บในไฟล์ แล้วใช้ id เป็นชื่อโฟลเดอร์ (ย้ายไป `<project>.history` ตอน Save ครั้งแรก)

### ☑ E8 — 🔴 🔎 ไม่มีการกู้คืนหลังโปรแกรมแครช
- Auto-save เก็บแค่ revision ในประวัติ แต่ตอนเปิดโปรแกรมไม่ได้ตรวจว่าครั้งก่อนปิดไม่ปกติ → ผู้ใช้ไม่รู้ว่ามีงานให้กู้
- แก้: crash marker (แบบ `AudioStage/app/js/autosave.js` `boot()`) → เปิดใหม่แล้วถาม "กู้คืนงานล่าสุด (auto-save เวลา …)?"

### ☑ E9 — 🔎 Save และ Auto-save เขียน `refs.json` พร้อมกันได้ → revision หาย
- ที่: `versions.js` `commitRevision()` อ่าน refs → เขียน objects (await หลายครั้ง) → เขียน refs; Save กับ timer auto-save ทำงานซ้อนกันได้ → ตัวที่เขียนทีหลังทับ revision ของอีกตัว
- แก้: คิวเดียว (promise chain) สำหรับ commitRevision; ข้าม auto-save ถ้ามีตัวที่กำลังทำ
- เพิ่ม: objects ที่ไม่มี revision ไหนอ้างถึงแล้ว (หลัง `pruneAuto`) ไม่เคยถูกลบ → โฟลเดอร์ `.history` โตไม่หยุด — ทำ gc

### ☑ E10 — 🔴 🔎 Export ค้างตลอดไปเมื่อ FFmpeg หยุดทำงานกลางทาง
- ที่: `electron/media.js` `jobEnd()` ลงทะเบียน `p.on('close')` หลังจาก process ปิดไปแล้ว → event ไม่มาอีก → promise ไม่จบ; `exporter.js` บรรทัด 424 เรียก `job.end` ตรงจังหวะนี้พอดี (เมื่อ `job.write` คืน false เพราะ encoder ตาย เช่น ดิสก์เต็ม, encoder ฮาร์ดแวร์ไม่รองรับขนาด)
- ผล: กล่อง Rendering ค้าง, Program Monitor ถูกล็อก (`lockPlayback(true)`) จนต้องปิดโปรแกรม
- แก้: เก็บ exit code ตอน `close` ไว้ใน job; `jobEnd` ถ้า process ปิดแล้วให้ resolve ทันทีพร้อม stderr
- เพิ่ม: Cancel / error แล้ว**ไฟล์ปลายทางครึ่งเดียวยังค้างอยู่** → ลบ (หรือ render ลง `.part` แล้ว rename เมื่อสำเร็จ)

### ☑ E11 — 🔎 Transcode cache คืน "ไฟล์ครึ่งเดียว" ถ้าครั้งก่อนโปรแกรมปิดกลางคัน
- ที่: `electron/media.js` `media:transcode` — FFmpeg เขียนตรงไปที่ `media-cache/<key>.mp4`; ถ้าโปรแกรมปิด/แครชระหว่างแปลง ครั้งต่อไป `existsSync(out)` = ถือว่าพร้อมใช้ → คลิปเล่นได้แค่ครึ่ง/เล่นไม่ได้ตลอด
- แก้: แปลงลงไฟล์ชั่วคราวแล้ว rename เมื่อ exit 0; กันการแปลงไฟล์เดียวกันซ้อน 2 งาน

### ☑ E12 — 🔎 ช่องตัวเลขใน Effect Controls: ลบเลขเพื่อพิมพ์ใหม่ = ค่ากลายเป็น 0 ทันที (และสร้าง keyframe ที่ 0)
- ที่: `src/Components/EffectControls.jsx` บรรทัด 87, 90–91, 337, 341, 422 (`onChange={(e) => onWrite(+e.target.value)}`), `MogrtPanel.jsx` 106/110, `Panels.jsx` 501 และช่อง `type="number"` อื่นรวม 44 จุด
- ผล: ลบ "100" เพื่อพิมพ์ "80" → ขณะช่องว่างค่าเป็น 0 → ภาพกระพริบ, ถ้าเปิด stopwatch ไว้จะได้ keyframe ค่า 0 เพิ่ม; พิมพ์ "-" ระหว่างทางก็เป็น 0
- แก้: คอมโพเนนต์ช่องตัวเลขตัวเดียว (เก็บข้อความระหว่างพิมพ์, commit เมื่อเป็นตัวเลขครบ/Enter/blur, Esc คืนค่า, Shift+ลูกศร ×10, ลาก label = scrub แบบ Premiere) — ดูตัวอย่าง `CanvasStage/src/Components/NumInput.jsx` (อ่าน/คัดลอกได้ ห้ามแก้)

### ☑ E13 — 🔎 คลิก checkbox / slider แล้วคีย์ลัดทั้งหมดใช้ไม่ได้ (Space, J/K/L, Ctrl+Z…) จนกว่าจะคลิกที่อื่น
- ที่: `src/Core/shortcuts.js` บรรทัด 80: `if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;` — ข้ามทุก `<input>` รวม checkbox, range, color
- แก้: ข้ามเฉพาะช่องที่พิมพ์ข้อความได้ (`text`, `number`, `search`, textarea, contentEditable); checkbox/range/button ให้คีย์ลัดทำงาน (ยกเว้นลูกศรบน range)

### ☑ E14 — 🔎 ตัวติดตั้งใหญ่เกินจำเป็นหลายร้อย MB (โมดูล native ที่ไม่ได้ใช้)
- ตรวจ `release/win-unpacked/resources`: `app.asar` 472 MB + `app.asar.unpacked/node_modules` 342 MB (onnxruntime-node 208 MB, ffmpeg-static 80 MB, @napi-rs 37 MB, @img/sharp 19 MB)
- สาเหตุ: `@huggingface/transformers`, `@mediapipe/tasks-vision`, `pdfjs-dist`, `react`, `react-dom`, `flexlayout-react`, `jszip`, `acorn`, `clipper-lib` อยู่ใน `dependencies` ทั้งที่ esbuild bundle เข้า `dist/` แล้ว (renderer ใช้ onnxruntime-**web** ใน `dist/ort`) — main process ใช้แค่ `ffmpeg-static` → electron-builder แพ็ก node_modules ซ้ำ + โมดูล native ของ Node (onnxruntime-node, sharp) ที่ไม่มีใครเรียก
- แก้: ย้ายทุกตัวยกเว้น `ffmpeg-static` ไป `devDependencies`; ไม่แพ็ก `dist/**/*.map` (source map ~15 MB) และ `dist/mogrt-test.*` (A3); แล้วเปิด `win-unpacked/EditorStage.exe` ทดสอบ AI tools (Whisper, Remove Background, Auto Reframe) ว่ายังทำงาน
- เกณฑ์ผ่าน: ตัวติดตั้งเล็กลงชัดเจน + ทุกฟีเจอร์ AI ยังใช้ได้ออฟไลน์

### ☑ E15 — 🔎 ความปลอดภัยฝั่ง main process (ต่อจาก A4)
- `fs:write`, `fs:rm`, `fs:mkdir`, `archive:restore`, `media:extractAudio`, `ffmpeg:run` (argument อะไรก็ได้ = เขียนไฟล์ที่ไหนก็ได้) รับ path ทุกที่ในเครื่อง; `shell:open` เปิดไฟล์ .exe/.bat ได้; `ffmpeg:setPath` / `audiostage:setPath` รับ path ของโปรแกรมอะไรก็ได้แล้วสั่งรัน — รวมกับ `sandbox: false` และไม่มีตัวกันการเปลี่ยนหน้า (A4) ถ้ามีช่องให้สคริปต์แปลกปลอม (MOGRT expression, SVG, ข้อความ HTML) รันในหน้าหลักได้ = รันโปรแกรมและลบไฟล์ทั้งเครื่องได้
- `win:control 'devtools'` เปิด DevTools ได้ในตัวที่ติดตั้งแล้ว
- `es-app` protocol ตรวจ `full.startsWith(distDir)` โดยไม่มีตัวคั่น → โฟลเดอร์ `dist-xxx` ข้างๆ ผ่านได้ (ใช้ `path.relative` แทน)
- `setDisplayMediaRequestHandler` ให้จับภาพหน้าจอ**ทั้งจอ + เสียงลำโพง**ทันทีโดยไม่ถามผู้ใช้
- แก้: เปิด `sandbox: true` ถ้าทำได้; จำกัด path ที่เขียน/ลบได้ = ไฟล์/โฟลเดอร์ที่ผู้ใช้เลือกผ่าน dialog + userData/temp/media-cache; `shell:open` ไม่เปิดไฟล์ executable; `setPath` ต้องมาจาก dialog เท่านั้น; DevTools เฉพาะ `!app.isPackaged`; ถามก่อนจับภาพหน้าจอ (ตัวอย่างที่ทำแล้ว: `PDFStage/electron/fileGuard.js`, `CanvasStage/electron/fileGuard.js`)

### ☑ E16 — 🔎 ปิดโปรแกรมระหว่าง Export / Render / Transcode = FFmpeg ยังรันค้างอยู่เบื้องหลัง
- process ลูกบน Windows ไม่ถูกปิดตามโปรแกรมแม่ → ffmpeg.exe ค้างใน Task Manager เขียนไฟล์ต่อ/กินซีพียู
- แก้: `app.on('before-quit')` kill ทุก job / run / transcode ที่ยังรันอยู่ (+ ถามยืนยันถ้ามี export ค้างในคิว)

### ☑ E17 — 🔎 เสียงพากย์ (Voice-Over Record) เก็บไว้แค่ในโฟลเดอร์ cache ของโปรแกรม
- `commands.js` `importRecording()` เขียน `.webm` ลง temp แล้วแปลงไปไว้ `userData/media-cache` → ไฟล์เสียงพากย์ไม่อยู่ข้างโปรเจกต์ ย้ายโปรเจกต์ไปเครื่องอื่น/ล้าง userData = เสียงพากย์หาย; ไฟล์ `.webm` ใน temp ไม่ถูกลบ; path ใช้ `\\` ตายตัว (ใช้บน macOS ไม่ได้)
- แก้: บันทึกลงโฟลเดอร์ Captured/Scratch disk ข้างโปรเจกต์ และลบไฟล์ temp

### ☑ E18 — 🔎 Multi-Camera / Synchronize ใช้สำเนาคลิปที่จับไว้ก่อน await
- `commands.js` `createMulticam()` / `synchronizeClips()` คำนวณ audio offset (หลายวินาทีกับคลิปยาว) แล้วใช้สำเนาคลิปก่อนรอ → ถ้าผู้ใช้ trim/ย้ายคลิประหว่างรอ ผลลัพธ์ใช้ค่าก่อนแก้
- แก้: อ่านคลิปใหม่จาก state ล่าสุดตาม id หลัง await (คลิปหาย = ยกเลิกพร้อมข้อความ) หรือแสดง progress แบบ modal ระหว่างคำนวณ

## F. สิ่งที่ควรเพิ่ม (นอกเหนือจาก D)
1. ☑ ตัวบอก "*" ที่ชื่อโปรเจกต์ใน title bar ตรงกับสถานะจริง (ผูกกับ `savedIndex` ของข้อ E1)
2. ☑ Project Settings > Scratch Disks ให้เลือกโฟลเดอร์ captured audio/video/previews ได้จริง (ตอนนี้เป็นข้อความเฉยๆ)
3. ☑ บันทึก In/Out ของ sequence (`inPoint`/`outPoint`) ลง `.esproj` (ตอนนี้ `projectJson` ไม่เก็บ → เปิดใหม่หาย)
4. ☑ Export Queue: ถ้าไฟล์ปลายทางมีอยู่แล้วให้ถาม (FFmpeg `-y` เขียนทับทันที)
5. ☑ test อัตโนมัติสำหรับ E1–E4, E10 ใน `scripts/test_*.mjs` (store.js รันใน Node ได้เมื่อ bundle ด้วย esbuild)

## ลำดับแนะนำ
E1 → E2 → E4 → E5 → E10 → E3 → E6 → E7 → E8 → E9 → E11 → E12 → E13 → A1–A6 → E14 → E15 → E16 → E17 → E18 → F → D

---

# สรุปผลการแก้ (3 พ.ย. 2026) — EditorStage 3.1.0

ทำตามลำดับแนะนำ แล้วจึง D บางข้อ. มี git แล้ว (commit แรก = สภาพก่อนแก้) และ commit แยกทุกกลุ่ม (`[Phase 8.1]` … `[Phase 8.10]`). รายละเอียดอยู่ใน `docs/PROGRESS.md` หัวข้อ "Phase 8 — แก้จากการตรวจ 2–3 พ.ย. 2026"

**ผลทดสอบ:** `npm test` 506/506 (19 ชุด; ใหม่: `test_store` 34, `test_jobs` 15, `test_versions` 30, `test_guard` 30; เพิ่มใน `test_keys` และ `test_tracks`), `check_commands` 0 missing / 0 stubs, `npm run build` ไม่มี warning, e2e ทุก phase ผ่าน (phase1–7c + phase8 ใหม่ 25/25; รันทีละ phase ตามล็อก Electron)

**ตัวติดตั้ง:** `release/EditorStage Setup 3.1.0.exe` = 210 MB (3.0.0 = 356 MB); `app.asar` 451 → 210 MB, `app.asar.unpacked` 342 → 80 MB (เหลือ ffmpeg-static), source-code 39 → 10 MB. เปิด `release/win-unpacked/EditorStage.exe` (profile แยก) แล้ว: หน้าโหลด, version 3.1.0, MediaPipe โหลดได้, onnxruntime-web wasm + Whisper ถอดเสียงได้

## แก้แล้ว
- **A1–A6, B, C** ทั้งหมด (A2 เลือกทางลบไฟล์ที่ไม่ใช้ — การถอดเฟรมด้วย VideoDecoder ไม่ได้ทำ)
- **E1–E18** ทั้งหมด
- **F1–F5** ทั้งหมด (F4: save dialog ของ Windows ถามเรื่องไฟล์มีอยู่แล้วอยู่แล้ว + ไฟล์เดิมถูกแทนเมื่อ export เสร็จเท่านั้น + ส่งงานซ้ำไฟล์เดียวกันในคิวจะถาม)
- **D1** (= A1), **D5** (Remix ripple), **D12** (proxy H.264 ใช้ `-crf 23` อยู่แล้ว; encoder สำรองของ FFmpeg แบบ LGPL — OpenH264 / Media Foundation — ไม่มีโหมด CRF จึงยังใช้ bitrate)
- พบเพิ่มจากการตรวจซ้ำและแก้แล้ว: bins / ชื่อโปรเจกต์ / In-Out / scratch disks เปลี่ยนแล้วไม่เคยทำให้ "ยังไม่บันทึก"; `collect_licenses` จะไม่รวม license ของ package ที่ bundle เมื่อย้ายไป devDependencies (แก้ + เพิ่ม license ของโมเดล); `job:end` ต้องฟัง 'exit' ด้วย ('close' รอ stdin)

## ยังไม่ได้ทำ (และเหตุผล)
- **D2, D3, D4, D6, D7, D8, D9, D10, D11, D14, D15**: เป็นฟีเจอร์ใหม่ขนาดใหญ่ (บางข้อต้องใช้โมเดลใหม่/ดาวน์โหลดเพิ่ม) เกินขอบเขตรอบแก้บั๊กนี้ — คำสั่งให้ทำ D เฉพาะข้อเล็กถ้ามีเวลา
- **D13** undo แยกต่อ sequence: undo snapshot เก็บทั้งโปรเจกต์ (รวม sequence อื่น) ต้องออกแบบ history ใหม่; รอบนี้ทำขั้นต่ำของ E3 (History เริ่มใหม่เมื่อสลับ sequence)
- E15 ทำแบบจำกัดสิทธิ์บางส่วน: `sandbox: true` เปิดแล้ว แต่ยังอ่านไฟล์ได้ทุกที่ และเขียนไฟล์ข้อมูล (ไม่ใช่โปรแกรม) ได้ทุกที่ เพราะ proxy, AudioStage Edits, caption sidecar เขียนข้างไฟล์ต้นฉบับ — กันไฟล์โปรแกรม/สคริปต์, Startup, การลบไฟล์นอกพื้นที่ของโปรแกรม
- ยังไม่ได้ code-sign ตัวติดตั้ง (ไม่มี certificate)
