# งานรอบถัดไป: 3 ฟีเจอร์สุดท้ายให้เท่า Premiere Pro (EditorStage)

อ่าน `docs/EDITORSTAGE_UPGRADE_PLAN.md` (หัวข้อ "1. กฎหลัก") และ `docs/PROGRESS.md` ก่อนเริ่ม แล้วทำตามกฎหลักทุกข้อเหมือนเดิม โดยเฉพาะ:
- ทุกการแก้ต้อง Undo/Redo ได้ผ่าน `edit(...)`
- `.esproj` เก่าต้องเปิดได้ (field ใหม่ต้องเป็น optional และมีค่า default)
- Preview = Export
- ห้ามมีเมนู stub และ `scripts/check_commands.mjs` ต้องได้ 0 missing / 0 stubs
- งานหนักทำใน Worker หรือ main process มี progress และกดยกเลิกได้
- ทำงาน offline 100% ห้ามเรียก service ออนไลน์
- shortcut ใหม่ห้ามชนกับของเดิมใน `src/Core/shortcuts.js` และทุก shortcut ที่แสดงในเมนูต้องมี key binding จริง

**ห้ามทำ** (ผู้ใช้ไม่ต้องการ): Source Patching, Team Projects / Productions, Frame.io, Generative Extend และรายการ "ห้ามทำ" เดิมใน `docs/PROMPT_TIMELINE_UPGRADE.md`

ทำทีละ Phase จบแต่ละ Phase ให้รัน `npm run build`, `npm test`, `npm run test:e2e` ให้ผ่าน แล้วสรุปสั้น ๆ ก่อนเริ่ม Phase ถัดไป

---

## Phase A — Trim Mode / Trim Monitor (Shift+T)

แบบ Premiere: เลือกรอยต่อ (edit point) แล้วกด **Shift+T** หรือดับเบิลคลิกที่รอยต่อด้วย Selection / Ripple / Rolling tool → Program Monitor เปลี่ยนเป็น Trim Monitor

### A1. หน้าจอ Trim Monitor
- แสดง 2 ภาพคู่กัน: ซ้าย = เฟรมสุดท้ายของคลิปขาออก (outgoing), ขวา = เฟรมแรกของคลิปขาเข้า (incoming)
- ใต้แต่ละภาพแสดง timecode ของ Out / In และจำนวนเฟรมที่ trim ไปแล้ว (เช่น `-3` / `+5`)
- ปุ่มด้านล่าง: **Trim -5**, **Trim -1**, **Apply Default Transitions to Selection**, **Trim +1**, **Trim +5** (ค่า "5" ใช้ค่า Large Trim Offset จาก Preferences > Trim ถ้ายังไม่มีให้เพิ่ม default 5)
- กดออกจาก Trim Mode ด้วย Shift+T อีกครั้ง, Esc หรือย้าย playhead ไปที่อื่น แล้ว Program Monitor กลับเป็นปกติ
- เพิ่มคำสั่ง `seq.trimMode` ในเมนู Sequence ("Trim Edit", Shift+T)

### A2. ประเภทการ trim (ใช้ฟังก์ชันที่มีอยู่แล้วใน `src/Core/editing.js`)
- คลิก/ลากบนภาพซ้าย = trim ด้าน outgoing, ภาพขวา = trim ด้าน incoming, ตรงกลางระหว่างสองภาพ = Rolling (`rollEdit`)
- ลากบนภาพหรือกด Ctrl+T สลับประเภท: Regular (`trimClip` แบบไม่ ripple) → Ripple (`trimClip` ripple) → Rolling (`rollEdit`)
- สีกรอบ / ไอคอนบน timeline บอกประเภทที่เลือก (Ripple = เหลือง, Rolling = แดง แบบ Premiere)
- ปุ่มลัดตอนอยู่ใน Trim Mode: **Ctrl+←/→** trim 1 เฟรม, **Ctrl+Shift+←/→** trim ตาม Large Trim Offset (ปุ่มเหล่านี้ทำงานเฉพาะตอนอยู่ใน Trim Mode ถ้าชนกับ Nudge เดิมให้ Trim Mode มีสิทธิ์ก่อน)
- เลือกหลายรอยต่อพร้อมกัน (Ctrl+คลิก) แล้ว trim ไปทางเดียวกันทั้งหมดได้
- trim แบบ Dynamic: กด J/K/L ระหว่างอยู่ใน Trim Mode = เล่นวน รอบรอยต่อ (pre-roll / post-roll จาก Preferences) และ trim ตามระยะที่เล่น ปล่อย K = หยุดแล้ว commit
- ทุกการ trim จนกดออกจาก Trim Mode เป็น undo step ทีละครั้ง (กด trim 1 ครั้ง = 1 step)

### A3. ข้อจำกัด
- ไม่ trim เกิน media ต้นฉบับ (ภาพจะค้างที่เฟรมสุดท้ายและแสดงกรอบแดงแบบ Premiere)
- track ที่ lock ไม่ถูก trim, sync lock ทำงานเหมือน `trimClip` เดิม
- รอยต่อที่มี transition: trim แล้วต้องเรียก `ed.fixTransitions(seq)`

---

## Phase B — Comparison View ใน Program Monitor

### B1. การเปิดใช้
- ปุ่ม **Comparison View** ในแถบปุ่มของ Program Monitor (เพิ่มใน Button Editor ด้วยถ้ามี) และคำสั่ง `view.comparisonView` ในเมนู View
- เมื่อเปิด Program Monitor แบ่งเป็น **Reference** (ซ้าย/บน) กับ **Current** (ขวา/ล่าง)

### B2. โหมด
- **Side by Side**: สองภาพคู่กัน
- **Vertical Split** / **Horizontal Split**: ภาพเดียวแบ่งครึ่ง มีเส้นแบ่งลากได้
- **Shot or Frame Comparison**:
  - *Shot*: Reference = เฟรมของคลิปอื่น (เลือกด้วย slider / ปุ่ม Previous/Next Edit / ลาก playhead ของ reference) ใช้เทียบสีระหว่างช็อต
  - *Frame*: Reference = คลิปเดียวกันแบบ "ก่อนแก้" คือ render โดยปิด effect ของ Lumetri / effect ทั้งหมดของคลิปนั้น (before / after)
- ปุ่ม **Swap Sides** สลับซ้ายขวา

### B3. การเชื่อมกับของเดิม
- **Color Match** ใน Lumetri (`src/Services/colorMatch.js`) ให้ใช้เฟรมจาก Reference ของ Comparison View เป็นภาพอ้างอิง (แบบ Premiere: เปิด Comparison View อัตโนมัติเมื่อกด Color Match)
- Lumetri Scopes แสดงผลของภาพ Current เท่านั้น
- Comparison View เป็นแค่การแสดงผล ไม่กระทบ export และไม่เขียนลง `.esproj` (ยกเว้นจะจำโหมดล่าสุดไว้ใน prefs)
- ต้องใช้ได้ทั้ง WebGL / WebGPU renderer และไม่ทำให้ playback กระตุกเกินจำเป็น (render Reference ครั้งเดียวต่อเฟรมที่เลือก ไม่ต้อง render ซ้ำทุกเฟรมตอนเล่น)

---

## Phase C — Remix (ยืด / หดเพลงให้ยาวตามต้องการ)

แบบ Premiere Remix: เปลี่ยนความยาวเพลงโดยตัดต่อเพลงใหม่ที่จุดที่เข้ากัน **ไม่ใช่การเปลี่ยน speed / pitch**

### C1. การใช้งาน
- เครื่องมือ **Remix Tool** ในแถบเครื่องมือ (อยู่กลุ่มเดียวกับ Rate Stretch) ใช้ลากขอบคลิปเสียงเพลงให้ยาว / สั้นลง
- หรือคลิกขวาคลิปเสียง > **Remix...** และใน Essential Sound > Music > Duration > Method: Remix ใส่ความยาวเป้าหมาย (timecode)
- คลิปที่ remix แล้วแสดงเส้นซิกแซกที่จุดตัด (แบบ Premiere) และ badge "Remix" บนคลิป

### C2. การวิเคราะห์เพลง (Worker, มี progress / cancel, ทำครั้งเดียวต่อไฟล์แล้ว cache)
- หา beat / downbeat (onset strength + tempo estimation)
- คำนวณ feature ต่อ beat (chroma + MFCC + loudness) แล้วทำ self-similarity matrix
- หาคู่จุดตัดที่เสียงเข้ากันที่สุด (อยู่บน beat, chroma/timbre ใกล้กัน, loudness ใกล้กัน)
- ให้คงช่วงเปิด (intro) และช่วงจบ (ending) เดิมไว้เสมอ แล้วตัด / ซ้ำท่อนตรงกลางให้ได้ความยาวเป้าหมาย คลาดเคลื่อนไม่เกิน ~1 beat (ถ้าต้องตรงเป๊ะให้ปรับที่ fade ท้าย)
- ตั้งค่าใน Essential Sound: **Segments** (ตัดสั้น ↔ ยาว), **Variations** (เน้นเปลี่ยนท่อน ↔ เน้นเหมือนเดิม) เหมือน Premiere

### C3. การเก็บข้อมูลและการเล่น
- เก็บเป็น field optional บนคลิป เช่น `clip.remix = { targetDur, segments: [{ srcIn, srcOut }], params }` ไม่เปลี่ยน media ต้นฉบับ
- จุดตัดแต่ละจุดใช้ crossfade สั้น (equal-power, ~20–50 ms ปรับได้) ไม่ให้มีเสียงคลิก
- เล่นใน `audioEngine.js` และ export ใน `exporter.js` ต้องได้ผลตรงกัน (Preview = Export)
- Undo ได้, ลากความยาวใหม่ = คำนวณ segment ใหม่จาก cache ทันที (ไม่วิเคราะห์ซ้ำ)
- ส่งออก XML / FCPXML / AAF: เขียนเป็นหลายคลิปเสียงตาม segment + crossfade (แปลงก่อนส่ง) ถ้าทำไม่ได้ให้แจ้งเตือนแบบเดียวกับ nested items

---

## การทดสอบ
- unit test: Trim Mode (regular / ripple / rolling, หลายรอยต่อ, ไม่เกิน media, track lock, transition), การหาจุดตัด Remix (ความยาวผลลัพธ์ใกล้เป้าหมาย, intro/ending คงเดิม, จุดตัดอยู่บน beat)
- e2e: เข้า Trim Mode ด้วย Shift+T แล้ว trim +5 / -1 แล้วตรวจตำแหน่งคลิป, Comparison View แบบ Frame แสดงภาพก่อน/หลัง Lumetri ต่างกันจริง (ตรวจ pixel), Remix เพลงทดสอบ (สร้างด้วย FFmpeg ให้มีจังหวะชัด) จาก 60s → 30s / 90s แล้ว export ตรวจความยาวและไม่มี click ที่จุดตัด (ตรวจ peak ผิดปกติ)
- **ทดสอบ Remix กับเพลงจริงในโฟลเดอร์ `D:\test music`** (อ่านจาก path นี้ตรง ๆ **ห้ามก๊อปไฟล์เข้า repo / `test-assets/`** เพราะเป็นเพลงมีลิขสิทธิ์ ถ้าไม่มีโฟลเดอร์นี้ให้ skip test ส่วนนี้ ไม่ให้ fail):
  - เพลงหลัก:
    - `Detective Conan theme (HoK x Detective Conan collab).mp3` (182s) → remix เป็น 60s และ 300s
    - `Ultraman_ The Ultimate Hero aka Ultraman Powered OP (60fps 4K) ウルトラマンパワードOP USA Ver..mp3` (95s) → remix เป็น 30s และ 150s
    - `シンガロンスーパー戦隊SONGTheme Tribute50th Anniversary Super Sentaiスーパー戦隊50周年記念ENG SUBS.mp3` (294s) → remix เป็น 90s (เพลงยาว ใช้วัดเวลาวิเคราะห์และ cache)
    - `Powered_mixdown.mp3` (95s) → remix เป็น 45s และ 120s แล้วฟังเทียบกับผลของเพลง Ultraman ต้นฉบับ (ความยาวเท่ากันแต่คนละ mix)
  - ไฟล์ซ้ำ (ใช้ทดสอบ cache): `Powered_mixd1own.mp3` (ขนาดไฟล์เท่ากับ `Powered_mixdown.mp3` ทุก byte น่าจะเป็นไฟล์เดียวกัน) และ `audio [music] (1).mp3` (294s ซ้ำกับเพลง Super Sentai) → ถ้า cache ใช้ hash เนื้อหา ต้องไม่วิเคราะห์ซ้ำ
  - ไฟล์ `ES_*.mp3` (Epidemic Sound, 2–37s) เป็น **sound effect ไม่ใช่เพลง** ใช้เป็นกรณีขอบ: หา beat ไม่เจอหรือสั้นเกินไปต้องแจ้งผู้ใช้ชัดเจน (เช่น "หาจังหวะเพลงไม่พบ ใช้ Remix ไม่ได้") ห้าม crash และห้ามได้ผลลัพธ์เสียงแตก
  - ตรวจทุกไฟล์: ความยาวผลลัพธ์ใกล้เป้าหมาย (±1 beat), intro / ending คงเดิม, ไม่มี click ที่จุดตัด, preview กับ export ตรงกัน และให้ export ผลลัพธ์ไว้ฟังด้วยหูใน scratch folder (ไม่ใช่ใน repo) พร้อมสรุปในรายงานว่าเพลงไหนฟังเนียน / เพลงไหนยังมีจุดตัดที่ได้ยินชัด
- เปิด `.esproj` เก่าได้ผลเหมือนเดิม
- อัปเดต `docs/PROGRESS.md` และ `README.md` เมื่อจบ
