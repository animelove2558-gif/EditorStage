# งานรอบถัดไป: แก้บั๊ก + Link / Unlink / Nest + เติมส่วนที่ขาดเทียบ Premiere Pro (EditorStage 2.2.0)

อ่าน `docs/EDITORSTAGE_UPGRADE_PLAN.md` (หัวข้อ "1. กฎหลัก") และ `docs/PROGRESS.md` ก่อนเริ่ม แล้วทำตามกฎหลักทุกข้อเหมือนเดิม โดยเฉพาะ:
- ทุกการแก้ที่เปลี่ยนโปรเจกต์ต้อง Undo/Redo ได้ผ่าน `edit(...)` และเป็น 1 undo step ต่อ 1 คำสั่ง
- `.esproj` เก่าต้องเปิดได้ (field ใหม่ต้องเป็น optional และมีค่า default)
- Preview = Export (เสียงและภาพต้องตรงกันทั้งสองทาง)
- ห้ามมีเมนู stub และ `scripts/check_commands.mjs` ต้องได้ 0 missing / 0 stubs
- shortcut ใหม่ห้ามชนกับของเดิมใน `src/Core/shortcuts.js` ทุก shortcut ที่แสดงในเมนูต้องมี key binding จริง และต้องใช้ได้ทุกภาษาแป้นพิมพ์ (ใช้ `shortcutKey()` ใน `src/Core/keys.js`)
- เมนูที่ลงท้ายด้วย `...` ต้องเปิด dialog จริง ถ้าไม่มี dialog ให้เอา `...` ออก

**ห้ามทำ** (ผู้ใช้ตัดออกแล้ว): Text Animation, Text Style Presets, Auto Beat Sync, Stickers / Overlays, Templates, Text-to-Speech, AI Noise Reduction, Audio library, Thai-first, Optical Flow / AI Frame Interpolation, AI Upscale, Auto Edit to Music, Command Palette
(รอบนี้ผู้ใช้ **เปิด** "Video Effects สำเร็จรูป" กลับมาแล้ว — ดู Phase E)

**ห้ามสร้าง installer** (`npm run dist*`) จนกว่าผู้ใช้จะสั่ง

ทำทีละ Phase ตามลำดับ **A → B → C → E → D** จบแต่ละ Phase ให้รัน `npm run build`, `npm test`, `npm run test:e2e` ให้ผ่าน แล้วสรุปสั้น ๆ ก่อนเริ่ม Phase ถัดไป ทุกบั๊กใน Phase A ต้องมี test (unit หรือ e2e) ที่ fail ก่อนแก้และผ่านหลังแก้

---

## Phase A — บั๊กที่ยืนยันแล้ว (ทำก่อนทุกอย่าง)

บั๊กทุกข้อในหัวข้อนี้ทดสอบแล้วในแอปจริง (Electron + `window.__es`) ผลที่ได้อยู่ในวงเล็บ "หลักฐาน"

### A1. Unlink แล้วเสียงดังเป็นสองเท่า (ร้ายแรง: ไฟล์ export ผิด)
- `clip.unlink` ใน `src/Core/commands.js` ตั้ง `noAudio = false` ให้คลิปวิดีโอ ทำให้คลิปวิดีโอเล่นเสียงในไฟล์ของตัวเองเพิ่มขึ้นมา ขณะที่คลิปเสียงแยกก็ยังเล่นอยู่ เสียงเลยซ้อนกันสองชั้น
- หลักฐาน: วาง `rgb_seconds.mp4` แล้ว Unlink ค่า RMS ช่องซ้ายเพิ่มจาก 0.088 เป็น 0.177 (ดังขึ้น 6 dB) ทั้งใน `renderAudioMix` (Export) และ Preview (`media.js` ไม่ mute element เพราะ `noAudio` เป็น false)
- แก้: Unlink ต้องไม่เปลี่ยน `noAudio` (แบบ Premiere: คลิปวิดีโอที่ unlink แล้วยังไม่มีเสียง เสียงอยู่ที่คลิปเสียงเท่านั้น) และตรวจที่อื่นที่ทำแบบเดียวกัน
- โปรเจกต์ที่บันทึกไว้แล้วและโดนบั๊กนี้ (คลิปวิดีโอ `asAudio` ไม่มี, ไม่มี `linkId`, `noAudio` false และมีคลิปเสียงจากไฟล์เดียวกันที่ตำแหน่ง/inPoint เดียวกัน) ให้ Project Health Check (`src/Services/healthCheck.js`) เตือนว่า "เสียงซ้อน" พร้อมปุ่ม fix
- test: RMS ก่อนและหลัง Unlink ต้องเท่ากัน ทั้ง Export และค่า mute ของ element ใน Preview

### A2. ปิดโปรแกรม / ปิดโปรเจกต์ / เปิดโปรเจกต์ใหม่ โดยไม่ถามให้บันทึก (ร้ายแรง: งานหาย)
- `file.closeProject`, `file.newProject` เรียก `resetProject()` ทันที `file.open` / Open Recent / `file.revert` โหลดทับทันที และหน้าต่าง Electron (`electron/main.js`) ไม่มี handler `close` เลย
- หลักฐาน: แก้โปรเจกต์ (`dirty: true`) แล้วสั่ง Close Project ไม่มี dialog ขึ้น คลิปหายหมด
- แก้: ถ้า `dirty` ให้ถาม "Save changes to <ชื่อ>?" ปุ่ม Save / Don't Save / Cancel (แบบ Premiere) ก่อน: ปิดหน้าต่าง (ปุ่ม X, `app.quit`, Alt+F4), Close Project, New Project, Open Project, Open Recent, Revert, เปิดไฟล์ `.esproj` จาก Explorer ขณะที่โปรแกรมเปิดอยู่
- ฝั่ง main: ดัก `win.on('close')` → ถาม renderer ผ่าน IPC แล้วค่อยปิดจริงเมื่อ renderer ตอบว่าปิดได้
- test e2e: dirty → Close Project → มี dialog → Cancel แล้วคลิปยังอยู่ / Don't Save แล้วโปรเจกต์ว่าง

### A3. ลบคลิปบน track ที่ล็อกไว้ได้
- `edit.selectAll` เลือกคลิปทุก track รวม track ที่ lock และ `removeSelected()` ไม่เช็ก lock
- หลักฐาน: lock V1 → Select All → Delete คลิปบน V1 ถูกลบ
- แก้: Select All ไม่เลือกคลิปบน track ที่ lock (แบบ Premiere) และทุกคำสั่งที่แก้คลิป (Clear, Ripple Delete, Cut, Nudge, Enable, Speed, Paste Attributes, Remove Attributes, Remove Effects, Unlink/Link, Group, Nest, Rename, Audio Gain ฯลฯ) ต้องข้ามคลิปบน track ที่ lock ทำเป็น helper กลางตัวเดียวแทนการเช็กทีละที่

### A4. Duplicate วางทับคลิปอื่นและ link มั่ว
- `edit.duplicate` ก๊อปคลิปไปไว้ที่ `start + dur` แบบ push ตรง ๆ ไม่ overwrite และคัดลอก `linkId` / `group` เดิมไปด้วย
- หลักฐาน: คลิป 0–3 s และคลิปถัดไป 3–7 s บน V1 → Duplicate คลิปแรก ได้คลิปใหม่ 3–6 s ซ้อนทับคลิปที่ 3–7 s และมี `linkId` เดียวกับคลิปต้นฉบับ
- แก้: ใช้ `ed.duplicateClips()` (ที่ Paste ใช้อยู่ ซึ่งสร้าง link/group ใหม่ให้คู่ที่ก๊อป) และวางแบบ overwrite ให้ถูกต้อง หรือเปลี่ยนให้ตรงกับ Premiere: Edit > Duplicate ใช้กับ item ใน Project panel (ทำสำเนา media/sequence) ส่วนการก๊อปคลิปบน timeline ใช้ Alt+ลาก / Copy-Paste — เลือกแบบใดแบบหนึ่งแล้วเขียนเหตุผลใน PROGRESS.md

### A5. Ctrl+Shift+/ (Duplicate) กดไม่ติด
- `combos` มี `'ctrl+shift+/'` แต่แป้น US เมื่อกด Shift+/ จะได้ `e.key === '?'` จึงไม่ตรงกับ combo
- หลักฐาน: ส่ง keydown `{ key: '?', code: 'Slash', ctrlKey, shiftKey }` แล้วจำนวนคลิปไม่เปลี่ยน
- แก้ใน `shortcutKey()` (`src/Core/keys.js`): เมื่อกด Shift ร่วมกับปุ่มเครื่องหมาย/ตัวเลข ให้ใช้ปุ่มจริงจาก `e.code` (ยกเว้นแป้นละติน AZERTY ที่ต้องใช้ตัวอักษรบนปุ่มตามเดิม) แล้วเพิ่ม test ใน `scripts/test_keys.mjs` และตรวจทุก combo ที่มี `shift+` กับปุ่มเครื่องหมาย

### A6. Nest วางผิด track และทับคลิปอื่น
- `seqFromSelection(true)` วาง nested clip บน video track ตัวแรกเสมอ (`'V1'` ถ้าไม่มี video) แม้เลือกแต่คลิปเสียง
- หลักฐาน: ปิด Linked Selection → เลือกเฉพาะคลิปเสียงบน A1 → Nest ได้ nested clip ที่ V1 เวลา 0 s ซ้อนทับคลิปวิดีโอที่อยู่ตรงนั้น
- แก้แบบ Premiere:
  - มี dialog **Nested Sequence Name** ก่อนสร้าง (เมนูมี `...` อยู่แล้ว)
  - nested clip ไปอยู่ที่ track บนสุดที่มีคลิปวิดีโอที่เลือก ถ้าเลือกแต่เสียง ให้เป็นคลิปบน audio track ตัวแรกที่มีคลิปเสียงที่เลือก
  - ถ้า nest ทั้งภาพและเสียง ให้สร้างคลิปเสียงของ nested sequence บน audio track ด้วย และ link กับคลิปวิดีโอของ nest (ปรับ volume / mute เสียงของ nest ได้จาก timeline) ต้องไม่ทำให้เสียงเล่นซ้ำ (ระวังแบบเดียวกับ A1)
  - ต้องไม่ทับคลิปที่ไม่ได้เลือก
- ตรวจด้วยว่า Speed/Duration, Reverse และ Time Remapping บน nested clip มีผลจริงทั้ง Preview และ Export (`src/Core/flatten.js` ใช้แค่ `start` / `inPoint` ไม่ดู `speed`) ถ้ายังไม่รองรับ ให้ทำให้รองรับ หรือปิดคำสั่งเหล่านั้นสำหรับ nested clip พร้อมบอกเหตุผล

### A7. Enable / Disable กับหลายคลิปพร้อมกันกลับค่าทีละคลิป
- `clip.enable` สลับค่าของแต่ละคลิปแยกกัน ถ้าเลือกคลิปที่ปิดอยู่บางตัว ผลจะสลับกันไปมา
- หลักฐาน: คลิป [ปิด, เปิด] → Enable → ได้ [เปิด, ปิด]
- แก้: ถ้ามีคลิปไหนเปิดอยู่ ให้ปิดทุกคลิป ถ้าปิดหมด ให้เปิดทุกคลิป และเมนู Clip > Enable แสดงเครื่องหมายถูกเมื่อคลิปที่เลือกเปิดอยู่ (แบบ Premiere)

### A8. Mark In / Out ด้วยคีย์บอร์ดไม่ทำงานกับ Source Monitor
- `setIO` ตั้ง In/Out ของ sequence เสมอ แม้กำลังใช้ Source Monitor อยู่ (ปุ่ม `{` `}` ใน Source ทำงาน แต่กด I / O ไม่ทำงาน)
- แก้: I, O, Shift+I, Shift+O, Ctrl+Shift+I/O/X, X ต้องใช้กับ monitor ที่ active (Source หรือ Program/Timeline) แบบ Premiere

---

## Phase B — Link / Unlink / Group / Nest และเมนูคลิกขวา

### B1. คำสั่ง Link (ตอนนี้ไม่มีเลย มีแต่ Unlink)
- เพิ่ม `clip.link`: เลือกคลิปวิดีโอและคลิปเสียง (หลายคลิปได้) แล้ว link เข้าด้วยกัน ใช้ `linkId` เดียวกัน และ **ไม่ย้ายตำแหน่งคลิป** (`clip.mergeClips` ตอนนี้ย้ายเสียงไปที่ `v.start` ซึ่งไม่ใช่พฤติกรรมของ Link)
- ถ้าคลิปเสียงมาจากไฟล์เดียวกับคลิปวิดีโอ แต่ตำแหน่งเลื่อนกัน (out of sync) ให้แสดงตัวเลขเฟรมที่เลื่อนบนคลิปแบบ Premiere (badge สีแดง เช่น `+12`) อย่างน้อยให้แสดงได้ ส่วนคลิกขวาที่ badge เพื่อ Move/Slip into Sync ถือเป็นงานเสริม
- เมนู Clip และ shortcut **Ctrl+L เป็นตัวสลับ**: ถ้าคลิปที่เลือกยัง link กันอยู่ แสดง "Unlink" ถ้ายังไม่ link แสดง "Link" (แบบ Premiere)
- การ link ต้องเคารพ `noAudio`: คลิปวิดีโอที่มีคลิปเสียงแยก link อยู่ต้องไม่เล่นเสียงของตัวเอง

### B2. Merge Clips ให้ตรงกับ Premiere
- ตอนนี้ `clip.mergeClips` ทำงานเหมือน Link (ไม่มี dialog แม้เมนูมี `...`)
- Premiere: Merge Clips สร้าง **merged clip ใหม่ใน Project panel** จากวิดีโอ 1 ตัว + เสียงหลายตัว มี dialog ให้เลือก sync point (In point / Out point / Timecode / Clip markers / Audio) และตัวเลือกเอาเสียงจากกล้องออก
- ถ้าทำ merged clip ไม่ได้ในรอบนี้ ให้ลบ Merge Clips ออกจากเมนูแล้วเขียนเหตุผลใน PROGRESS.md (ห้ามคงไว้เป็นคำสั่งที่ทำอย่างอื่น)

### B3. เมนูคลิกขวาที่คลิปบน Timeline (ตอนนี้ไม่มี Link/Unlink, Group, Nest, Cut, Copy ฯลฯ)
เมนูปัจจุบัน (`Timeline.jsx`) มีแค่ Edit in AudioStage, (คลิปเสียง: Auto-Cut, Subtitles, Separate Speakers), Rename, Speed/Duration, Show Clip Keyframes, Show Speed Keyframes, Speed Curve, (คลิปวิดีโอ: Frame Hold, Scene Edit Detection, Field Options), Audio Channels, Enable/Disable, Ripple Delete

จัดใหม่ตามลำดับเมนูของ Premiere ใช้คำสั่งที่มีอยู่แล้ว (ทุกตัวมี shortcut แสดงด้านขวา ใช้กับทุกคลิปที่เลือก และ disable เมื่อใช้ไม่ได้):
1. Cut, Copy, Paste Attributes…, Remove Attributes…, Clear, Ripple Delete
2. Edit in AudioStage, Edit Original (เปิดไฟล์ต้นฉบับด้วยโปรแกรมของระบบ), Replace With Clip ▸ From Source Monitor / From Bin
3. **Enable** (✓), **Link / Unlink** (ตาม B1), **Group**, **Ungroup**, Synchronize…, Merge Clips… (ถ้ายังอยู่), **Nest…**, Make Subsequence, Multi-Camera ▸
4. **Label ▸** สีของคลิป (8 สีแบบ Premiere ใช้ `c.color` ที่มีอยู่, Select Label Group)
5. Speed/Duration…, Scene Edit Detection…, Audio Gain…, Audio Channels…
6. Frame Hold Options…, Add Frame Hold, Insert Frame Hold Segment, Field Options…, **Time Interpolation ▸** (Frame Sampling / Frame Blending — ใช้ค่าที่ Speed dialog มีอยู่แล้ว)
7. **Scale to Frame Size**, **Set to Frame Size** (ตอนนี้ยังไม่มีทั้งสองคำสั่ง: Set = ปรับ Motion > Scale ให้พอดีเฟรม, Scale = ปรับขนาดภาพต้นทางให้พอดีเฟรม)
8. Rename…, Make Subclip…, **Reveal in Project** (เลือก media ใน Project panel), **Reveal in Explorer**, Properties… (dialog แสดงข้อมูลไฟล์: path, codec, ขนาด, fps, ความยาว, ช่องเสียง)
9. Show Clip Keyframes ▸, Show Speed Keyframes, Speed Curve ▸ (ที่มีอยู่)
10. เฉพาะคลิปเสียง: Auto-Cut Silence…, Generate Subtitles…, Separate Speakers to Tracks… (ที่มีอยู่ ย้ายไปท้ายเมนูหรือ submenu "Smart Tools")

ถ้าคลิกขวาที่คลิปที่ยังไม่ได้เลือก ให้เลือกคลิปนั้น (รวม link/group) ก่อน ถ้าคลิกขวาที่คลิปที่อยู่ในชุดที่เลือก ให้คงชุดเดิมไว้ (ทำอยู่แล้ว ห้ามพัง)

### B4. เมนูคลิกขวาที่อื่นบน Timeline
- **ช่องว่างระหว่างคลิป (gap)**: คลิกเลือก gap ได้ (ไฮไลต์) + คลิกขวา **Ripple Delete** (ปิดช่องว่าง เคารพ sync lock / lock) และกด Delete ปิด gap ได้ แบบ Premiere
- **Transition**: Clear และ Set Transition Duration… (ตอนนี้คลิกขวาที่ transition ไม่มีเมนูเลย)
- **ที่ว่างนอกคลิป**: เพิ่ม Paste, Paste Insert ไว้บนสุด (ตอนนี้มีแค่ Add Track / Delete Empty Tracks / Zoom to Fit)
- **Ruler / marker บน ruler**: ดูข้อ C1

### B5. Double-click บนคลิป
- ตอนนี้ double-click ทำงานเฉพาะ nested clip (เปิด sequence) ให้คลิปปกติ double-click แล้วเปิดใน Source Monitor ที่เฟรมเดียวกัน (Premiere) และ graphic/text clip เปิดแก้ใน Essential Graphics

### B6. ลากวิดีโอข้าม track แล้วเสียงที่ link อยู่ย้าย track ตามเอง (ผู้ใช้ไม่ต้องการ — ต้องแก้)
**ปัญหา** (ผู้ใช้รายงาน): ลากวิดีโอจาก V1 ขึ้น V2 เพื่อวางซ้อน แต่เสียงที่ link อยู่ย้ายจาก A1 ไป A2 เองทั้งที่ไม่ได้ลากเสียง

หลักฐาน (ลากด้วย mouse event จริงในแอป, `rgb_seconds.mp4` วางที่ V1/A1 เวลา 0 s แล้วลากวิดีโอขึ้น V2 และไปข้างหน้า 1 s):

| | วิดีโอ | เสียง |
|---|---|---|
| ก่อนลาก | V1 @ 0 s | A1 @ 0 s |
| Linked Selection เปิด (ค่าเริ่มต้น) | V2 @ 1 s | **A2 @ 1 s** ← ย้าย track เอง |
| Linked Selection ปิด | V2 @ 1 s | A1 @ 0 s ← ไม่เลื่อนเวลาตาม ภาพกับเสียงหลุด sync |

สาเหตุ: `ed.trackShiftMap()` (`src/Core/editing.js`) เลื่อน track ให้ **ทุกประเภท** ในกลุ่มด้วยจำนวนเท่ากัน (วิดีโอ +1 → เสียง +1) ตอนนี้จึงไม่มีทางลากเฉพาะภาพข้าม track โดยที่เสียงยังเลื่อนเวลาตามอยู่

**พฤติกรรมใหม่ที่ต้องการ** (ผู้ใช้เลือกแล้ว: ต่างจาก Premiere ตรงนี้โดยตั้งใจ):
1. **เวลาไปด้วยกัน แต่ track ย้ายเฉพาะประเภทที่จับลาก**
   - จับคลิปวิดีโอลาก: คลิปวิดีโอทั้งกลุ่มย้าย track ตามเมาส์ คลิปเสียงที่ link/group/เลือกอยู่ **เลื่อนเวลาเท่ากัน (sync ไม่หลุด) แต่อยู่ track เดิม**
   - จับคลิปเสียงลาก: กลับกัน เสียงย้าย track วิดีโออยู่ track เดิม
   - คลิป caption ใช้กติกาเดียวกัน (ย้าย track เฉพาะเมื่อจับ caption ลาก)
   - การ overwrite / insert / rearrange / duplicate (`ed.dragClips`) ของคลิปที่ไม่ย้าย track ต้องเกิดบน track เดิมของมันตามเวลาใหม่ และทั้งหมดยังเป็น 1 undo step
   - ป้ายบอกโหมดและเส้น insert ตอนลากยังทำงานเหมือนเดิม
2. **Alt+คลิก = เลือกเฉพาะส่วนนั้น** (แบบ Premiere)
   - Alt+mousedown บนคลิปแล้วปล่อยโดยไม่ลาก (เกณฑ์ < 4 px) → เลือกเฉพาะคลิปนั้น ไม่ขยายไปคลิปที่ link / group อยู่ และ Shift+Alt+คลิก = เพิ่ม/เอาออกทีละส่วน
   - Alt+**ลาก** ยังเป็น Duplicate เหมือนเดิม (`dragMode`)
   - ลากคลิปที่อยู่ในชุดที่เลือกแล้ว ให้ใช้ชุดที่เลือกตามที่เป็นอยู่ ห้ามขยายกลับไปรวมคลิปที่ link (ตอนนี้ `clipDown` เรียก `expandSelection` ทุกครั้ง ทำให้เลือกเฉพาะภาพไว้แล้วลากไปก็ยังลากเสียงตามมาด้วย) — ถ้าคลิกคลิปที่ยังไม่ได้เลือก ให้ขยายตาม Linked Selection เหมือนเดิม
   - เมื่อย้ายเฉพาะภาพหรือเฉพาะเสียงจนเวลาไม่ตรงกัน ให้แสดงตัวเลขเฟรมที่เลื่อน (ใช้ badge เดียวกับ B1)
3. **Nudge ขึ้น/ลง (Alt+↑ / Alt+↓)** ใช้กติกาเดียวกัน: ย้าย track เฉพาะคลิปวิดีโอที่เลือก (ถ้ามี) ถ้าเลือกแต่เสียงจึงย้ายเสียง — เขียนกติกาที่เลือกไว้ใน PROGRESS.md
4. Linked Selection ปิด: พฤติกรรมเดิม (ย้ายเฉพาะคลิปที่เลือก) ไม่เปลี่ยน

**test ที่ต้องแก้ตาม** (ตอนนี้ล็อกพฤติกรรมเก่าไว้): `scripts/test_tracks.mjs` บรรทัด 30 (`drag picture V1→V2: its linked sound goes A1→A2`), 36 (`drag sound A2→A1: picture follows`), 41 (`V4 and A4 are created`), 62 (locked A2 กับคลิปคู่) ให้เปลี่ยนเป็นพฤติกรรมใหม่ และตรวจ `scripts/e2e/phase5.cjs` ส่วนลากคลิปข้าม track
**test ใหม่**: e2e ลากด้วย mouse event จริง — (ก) ลากวิดีโอ V1→V2 +1 s: วิดีโอ V2 @ 1 s, เสียง A1 @ 1 s (ข) ลากเสียง A1→A2: วิดีโออยู่ V1 (ค) Alt+คลิกวิดีโอ แล้วลาก: เสียงไม่ขยับเลย (ง) Alt+ลาก ยังเป็น Duplicate (จ) undo 1 ครั้งกลับสภาพเดิม

---

## Phase C — ส่วนที่ยังขาดหรือยังไม่ครบเมื่อเทียบกับ Premiere Pro

### C1. Markers (ยังทำได้น้อยมาก)
ตอนนี้: เพิ่ม (M), ไปข้างหน้า/ถอยหลัง, ลบทั้งหมด, Markers panel แสดงแค่เวลาเป็นวินาที marker บน ruler คลิกไม่ได้
- double-click marker (ruler และ Markers panel) หรือกด M สองครั้งที่ตำแหน่งเดิม → dialog **Marker**: Name, Duration (marker แบบช่วง), Comments, Color (8 สี), Marker Type (Comment / Chapter / Segmentation)
- ลาก marker บน ruler ได้ (snap), คลิกเลือก marker, **Clear Selected Marker (Ctrl+Alt+M)** — `Ctrl+Alt+Shift+M` = Clear All ใช้อยู่แล้ว
- Markers panel แบบ Premiere: timecode (ไม่ใช่วินาที), ชื่อ, comment, สี, ค้นหา, คลิกแล้วกระโดด, แก้ชื่อ/comment ได้ในที่
- **Clip markers**: กด M เมื่อเลือกคลิปใน Source Monitor หรือในคลิป → marker ติดไปกับคลิป
- Export markers: เพิ่มใน FCPXML / Premiere XML / EDL (ถ้ารูปแบบรองรับ) และ chapter marker ใส่ลงไฟล์ MP4/MOV ตอน export (FFmpeg metadata)

### C2. คีย์ลัดที่ Premiere มีแต่ยังไม่มี (เช็กแล้วว่าไม่ชนกับของเดิม)
- **Q** Ripple Trim Previous Edit to Playhead, **W** Ripple Trim Next Edit to Playhead
- **Alt+Q / Alt+W** Trim Previous / Next Edit to Playhead (ไม่ ripple)
- **E** Extend Selected Edit to Playhead
- **D** Select Clip at Playhead (ตาม track ที่ target)
- **1–9** ตัดกล้อง multicam (ตอนนี้ Multi-Camera มีแค่ Camera 1–4 ในเมนู และกดเลขได้เฉพาะตอนเปิด multicam view) — รองรับได้อย่างน้อย 9 กล้อง
- ทุกตัวใส่ในเมนูที่เหมาะสม (Sequence / Clip) ใส่ใน Keyboard Shortcuts dialog และใช้ได้ทุกภาษาแป้นพิมพ์

### C3. Keyboard Shortcuts dialog แก้ไม่ได้
- ตอนนี้แสดงรายการอย่างเดียว Premiere ให้เปลี่ยนปุ่มเองได้
- ทำ: ค้นหาคำสั่ง, คลิกช่อง shortcut แล้วกดปุ่มใหม่, เตือนเมื่อชน (แสดงว่าชนกับคำสั่งไหน), Reset to Default, บันทึกเป็น preset ใน userData (ไม่ใช่ในโปรเจกต์), export/import ไฟล์ preset
- `combos` ใน `shortcuts.js` และ shortcut ที่แสดงในเมนูต้องอ่านจาก keymap เดียวกัน (เปลี่ยนแล้วเมนูเปลี่ยนตาม)

### C4. Paste Attributes / Remove Attributes / Remove Effects ไม่มี dialog
- เมนูมี `...` แต่ทำทันทีทั้งหมด Premiere มี dialog ติ๊กเลือก: Motion, Opacity, Time Remapping, Volume, Channel Volume, Panner, แต่ละ effect แยกตัว, และ "Scale attribute times" (Paste Attributes)
- Paste Attributes ตอนนี้ไม่ copy `timeRemap`, `masks`, `audio` และใช้แค่คลิปแรกในคลิปบอร์ด ให้ครบตาม dialog

### C5. Audio Track Mixer
- มีแค่ fader volume + Mute/Solo ต่อ track
- เพิ่ม: **Pan** ต่อ track (ใช้ทั้ง Preview และ Export), **Master track** (volume รวม), **meter** แสดงระดับเสียง (peak, กันเสียงแตก clip สีแดง) ทั้งต่อ track และ master, ชื่อ track ตาม `track.name`, ช่องตัวเลข dB พิมพ์ได้, double-click fader = 0 dB
- Audio Clip Mixer: ทำงานกับหลายคลิป, มี Pan ต่อคลิป, meter
- ลบ component `Mixer` / `History` ตัวเก่าที่ไม่ได้ใช้ใน `src/Components/Panels.jsx` (dead code มีอยู่คู่กับตัวใน `Panels2.jsx`)

### C6. Sequence Settings
- เปลี่ยน fps แล้วคลิป/marker/keyframe ไม่ถูกปรับให้ลงเฟรม (อาจไม่ตรงเฟรม) ให้ snap ทุกเวลาลงเฟรมใหม่หลังเปลี่ยน หรือเตือนก่อนเปลี่ยน
- เพิ่ม Audio Sample Rate (44.1 / 48 kHz) และ Pixel Aspect Ratio (Square เป็นค่าเริ่มต้น) ให้ export ใช้ค่านี้
- New Sequence (Ctrl+N) ไม่มี dialog ตั้งค่า (สร้างด้วยค่าของ sequence ปัจจุบันทันที) ให้มี dialog ชื่อ + preset + ขนาด + fps แบบ Premiere

### C7. Preferences ส่วนใหญ่ยังเป็นข้อความอ่านอย่างเดียว
เพิ่มค่าที่ตั้งได้จริงและเก็บใน userData:
- Still Image Default Duration (ตอนนี้ค่าคงที่ในโค้ด), Video / Audio Transition Default Duration
- Auto Save: ย้ายจาก Smart Tools มาไว้ที่ Preferences ด้วย (ช่วงเวลา, จำนวนไฟล์ที่เก็บ)
- Timeline: Playback auto-scrolling (No Scroll / Page / Smooth), Default track count ของ sequence ใหม่
- Audio Output device, Playback pre-roll / post-roll
- Appearance: ความสว่าง UI (อย่างน้อย 2 ระดับ)
- ปุ่ม Reset Preferences

### C8. Project panel / media
ตรวจกับ Premiere แล้วเติมส่วนที่ขาด (เช็กโค้ดจริงใน `Panels2.jsx` ก่อนทำ เพราะบางอย่างอาจมีแล้ว):
- List view / Icon view, เรียงตามคอลัมน์ (Name, Media Duration, Frame Rate, Video In/Out, Label), ปรับขนาด thumbnail
- Label color ของ item (ใช้ชุดสีเดียวกับ B3)
- Duplicate item, Rename, Reveal in Explorer, Properties
- Hover scrub (เลื่อนเมาส์บน thumbnail แล้วเห็นเฟรม)
- Metadata panel ตอนนี้แสดงแค่ชื่อ sequence + ขนาด ให้แสดง metadata ของ item ที่เลือก (path, codec, fps, ขนาด, ความยาว, sample rate, ช่องเสียง) และแก้ชื่อ / comment / label ได้

### C9. History panel
- คลิกย้อนได้แล้ว แต่ให้เพิ่ม icon ตามประเภทคำสั่ง, ปุ่ม Delete (ล้างประวัติทั้งหมดพร้อมยืนยัน) และแสดงจำนวน step สูงสุดที่เก็บ

---

## Phase E — Effects, Transitions และ Presets ให้มากกว่า Premiere Pro

ผู้ใช้ต้องการให้มี effect มากกว่า Premiere Pro และโฟลเดอร์ **Presets ใน Effects panel ตอนนี้ว่างเปล่า** (`EFFECT_ROOTS` ใน `src/Core/effectsCatalog.js` มี `{ name: 'Presets', tree: {} }` และไม่มีระบบบันทึก preset เลย) ทำ Phase นี้หลัง A–C

### E0. สถานะตอนนี้ (นับจาก `effectsCatalog.js`)

| ประเภท | EditorStage 2.2.0 | Premiere Pro (โดยประมาณ ให้ตรวจกับเวอร์ชันล่าสุด) | เป้าหมายรอบนี้ |
|---|---|---|---|
| Video Effects | 102 | ~100+ | **≥ 220** |
| Video Transitions | 32 | ~45 | **≥ 150** |
| Audio Effects | 40 | ~45 | **≥ 75** |
| Audio Transitions | 3 | 3 | **≥ 12** |
| Presets (Effects panel) | 0 (โฟลเดอร์ว่าง) | ~100 (ส่วนใหญ่เป็น PiP) | **≥ 400** |
| Lumetri Looks / LUT ในตัว | 0 (มี Filters 35 แบบใน Create panel) | ~70 (Cinematic, Film Stock, SpeedLooks ฯลฯ) | **≥ 150** |

จำนวนเป็นเป้า แต่ **คุณภาพสำคัญกว่าจำนวน** ทุกตัวต้องผ่านเกณฑ์ใน E7 ห้ามใส่ตัวซ้ำที่แค่เปลี่ยนชื่อเพื่อให้ครบจำนวน (แยกเป็น preset แทน)

### E1. กฎ license (ห้ามข้าม)
ใช้ได้เฉพาะของที่ **ใช้เชิงพาณิชย์ได้ฟรีและแจกต่อในโปรแกรมได้** ไม่เช่นนั้นให้เขียนเอง (ดีที่สุด เพราะไม่มีเงื่อนไข)

**อนุญาต** (ตรวจแล้ว ต.ค. 2026 — ยังต้องดู header ของแต่ละไฟล์ก่อนใช้เสมอ):
| แหล่ง | license | ใช้ทำอะไร |
|---|---|---|
| [gl-transitions](https://github.com/gl-transitions/gl-transitions) | MIT (แต่ละ transition ระบุ license ใน header — ทุกตัวเป็น MIT ยกเว้นสองตัวที่เป็น BSD) | Video Transitions ~100 แบบ (GLSL พร้อมใช้, รูปแบบ `transition(uv)` แปลงเข้า `TRANSITION_FRAG` ได้ตรง ๆ) |
| [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | Zlib (ต่อยอดจาก three.js ซึ่งเป็น MIT) | Bloom, Chromatic Aberration, Glitch, Noise, Scanline, Dot-Screen, Grid, Pixelation, God Rays, Shock Wave, Tone Mapping, Color Depth, Vignette |
| three.js `examples/jsm/shaders` | MIT | Film, RGB Shift, Halftone, Kaleidoscope, Mirror, Technicolor, Bleach Bypass, Sobel, Afterimage, Bokeh |
| [glfx.js](https://github.com/evanw/glfx.js) | MIT | Ink, Hexagonal Pixelate, Color Halftone, Tilt Shift, Lens Blur, Zoom Blur, Swirl, Bulge/Pinch, Denoise, Edge Work |
| [Tone.js](https://github.com/Tonejs/Tone.js) | MIT | Audio: AutoFilter, AutoPanner, AutoWah, BitCrusher, Chebyshev, FrequencyShifter, PingPongDelay, StereoWidener, Tremolo, Vibrato, JCReverb, Freeverb |
| Freeverb (Jezar) | Public domain | Reverb algorithm |
| [Poly Haven](https://polyhaven.com/license) | CC0 | texture สำหรับ effect (เช่น paper, grunge, dust) ถ้าจำเป็น — แต่ procedural ดีกว่าเพราะไม่เพิ่มขนาด installer |
| ambientCG | CC0 (**ยืนยันจากหน้าเว็บของเขาเองก่อนใช้** ผมเห็นแต่แหล่งที่สามยืนยัน) | texture |
| [OpenAIR](https://www.openair.hosted.york.ac.uk/) | **แต่ละไฟล์ต่างกัน** — ใช้ได้เฉพาะ IR ที่เป็น CC0 / CC BY (ไม่มี NC, ไม่มี ND) และต้องใส่ attribution | impulse response สำหรับ Convolution Reverb (ทางเลือก — แนะนำสร้าง IR เองแบบ synthetic ก่อน) |

**ห้ามใช้**:
- **Shadertoy** — ค่าเริ่มต้นเป็น non-commercial (CC BY-NC-SA) ใช้ได้เฉพาะ shader ที่ผู้เขียนระบุ license อื่นไว้ชัดเจนในโค้ด และต้องเก็บหลักฐานไว้ (มีผู้เขียนหลายคนที่ห้ามใช้เชิงพาณิชย์โดยตรง)
- **LYGIA** — Prosperity License (ห้ามเชิงพาณิชย์) + Patron License สำหรับผู้สนับสนุนเท่านั้น
- ISF / VJ shader pack ที่ port มาจาก Shadertoy, LUT pack ฟรีจากเว็บขาย preset (ส่วนใหญ่ห้ามแจกต่อในซอฟต์แวร์), preset / LUT ของ Adobe, Red Giant, FilmConvert, CapCut และ effect ที่เลียนชื่อการค้า
- โค้ด filter ของ FFmpeg (LGPL/GPL) ห้าม copy มาเป็น JS/GLSL — ศึกษาอัลกอริทึมจากเอกสาร/บทความแล้วเขียนเองได้

**บันทึกที่มาทุกตัว**: ทุก effect / transition / preset / LUT / IR มี field `source` (`'own'` หรือชื่อแหล่ง + URL + commit/เวอร์ชัน) และ `license` ใน catalog, header comment ในไฟล์ shader ที่ port มา (คงชื่อผู้เขียนและ license เดิม), และ `scripts/collect_licenses.mjs` รวม license ของแหล่งที่ใช้ลง `licenses/` อัตโนมัติ + เพิ่มหัวข้อใน `THIRD_PARTY_LICENSES.md`
**test**: `scripts/test_effect_licenses.mjs` — ทุกรายการใน catalog ต้องมี `source` และ `license` อยู่ใน allowlist (`own`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `Zlib`, `Apache-2.0`, `CC0-1.0`, `Unlicense`, `public-domain`, `CC-BY-4.0`) ถ้าไม่อยู่ให้ test fail

### E2. ทำส่วนที่ Premiere มีแต่ยังขาดให้ครบก่อน
ตรวจกับ Effects panel ของ Premiere Pro เวอร์ชันล่าสุดแล้วเติมให้ครบ (รายการด้านล่างเป็นจุดเริ่ม):
- Video Effects > **Video**: Clip Name, Simple Text, Timecode, SDR Conform
- Video Effects > **Transition** (effect ที่ keyframe ได้): Block Dissolve, Gradient Wipe, Linear Wipe, Radial Wipe, Venetian Blinds
- Video Effects > **Immersive Video** เพิ่ม: VR Blur, VR Digital Glitch, VR Fractal Noise, VR Projection, VR Rotate Sphere, VR Sharpen
- Video Effects > **Distort**: Rolling Shutter Repair
- Video Transitions > **Wipe** เพิ่ม: Inset, Paint Splatter, Pinwheel, Random Blocks, Random Wipe, Spiral Boxes, Wipe
- Video Transitions > **Slide**: Whip
- Video Transitions > **Immersive Video**: VR Chroma Leaks, VR Gradient Wipe, VR Iris Wipe, VR Light Leaks, VR Light Rays, VR Mobius Zoom, VR Random Blocks, VR Spherical Blur
- Video Effects > **Obsolete** (เปิดโปรเจกต์/XML จาก Premiere แล้วไม่หาย): Fast Color Corrector, Three-Way Color Corrector, RGB Curves, Luma Curve, Color Balance (HLS) ฯลฯ — ใส่ไว้ในโฟลเดอร์ Obsolete แบบ Premiere

### E3. ส่วนที่ "มากกว่า Premiere" (โฟลเดอร์ใหม่ ใช้ชื่อภาษาอังกฤษแบบ Premiere)
ทำเป็น GLSL ใน pipeline เดิม (`premiereFx.js` / `videoEffects.js` / `transitions.js`) ทุกพารามิเตอร์ keyframe ได้ ตัวอย่างรายการ (เลือก/เพิ่มได้ ขอแค่ไม่ซ้ำกัน):

**Video Effects**
- **Glitch**: RGB Split, Digital Glitch, Block Glitch, Scan Lines, VHS, Datamosh-look (จำลองด้วย block shift ไม่ใช่ optical flow), Signal Noise, Pixel Sort, Wave Glitch, Bad TV, Interlace Tear, Chroma Bleed
- **Light & Glow**: Bloom, Glow (threshold/radius/color), Light Rays / God Rays, Light Leak (procedural), Lens Flare แบบ anamorphic, Star Glow / Cross Filter, Neon Edge, Halation, Bokeh Overlay (procedural), Light Sweep / Shine
- **Retro & Film**: Film Grain (ขนาด/สี/ตาม luma), Film Damage (scratches, dust, flicker — procedural), Old Film, Super 8, 16mm Gate Weave, Sepia, Cross Process, Bleach Bypass, Technicolor 2-strip/3-strip, Halftone, Color Halftone, CRT, Game Boy (palette), 8-bit Dither, Posterize + Dither
- **Artistic**: Oil Paint (Kuwahara), Watercolor, Pencil Sketch, Cartoon / Toon Shade, Ink, Comic, Mosaic Tiles, Hexagon Pixelate, Triangle Pixelate, Voronoi Glass, Stained Glass, ASCII
- **Blur (เพิ่ม)**: Tilt Shift, Lens Blur (bokeh shape), Zoom Blur, Spin Blur, Motion Tile Blur, Bilateral (skin smooth), Smart Blur
- **Distort (เพิ่ม)**: Bulge / Pinch, Ripple, Water Ripple, Heat Haze, Kaleidoscope, Polar Coordinates, Fisheye, Barrel / Pincushion, Glass Distortion, Shockwave, Tile / Motion Tile, Mirror Quad, Displacement Map
- **Motion / Camera**: Camera Shake (procedural, seed), Handheld Wobble, Earthquake, Zoom Punch, Whip Blur, Auto Ken Burns (ใช้ Motion ภายใน), Bounce, Swing
- **Color (เพิ่ม)**: Duotone, Tritone, Gradient Map, Split Toning, Selective Color (6 สี), Hue Shift / Hue Cycle, Day for Night, Infrared, Thermal, Color Grade by Temperature/Tint, Vibrance, Black & White Mixer (6 ช่อง)
- **Stylize (เพิ่ม)**: Outline / Stroke (alpha), Long Shadow, Vignette (shape/color), Frame / Border (procedural), Letterbox (สัดส่วน 2.35/2.39/1.85/4:3), Rounded Corners, Split Screen (2/3/4/9 ช่อง), Clone / Grid Repeat
- **Keying (เพิ่ม)**: Spill Suppressor, Chroma Key แบบ 3D color distance, Edge Matte Choker, Alpha Refine (ไม่ใช่ AI)

**Video Transitions** (port จาก gl-transitions ที่เป็น MIT/BSD ให้ได้มากที่สุด แล้วจัดโฟลเดอร์ + เขียนเพิ่มเอง)
- **Glitch**, **Light Leaks**, **Blur** (Blur Dissolve, Zoom Blur, Spin Blur, Directional Blur), **Shape** (Heart, Star, Circle Open/Close, Hexagon, Diamond grid), **Zoom & Spin** (Zoom In/Out, Spin Zoom, Whip Pan 4 ทิศ, Swirl), **3D** (Cube, Door, Fold, Flip, Page Curl, Doorway), **Blocks & Grid** (Pixelize, Mosaic, Squares Wire, Random Squares, Grid Flip), **Liquid** (Ripple, Water Drop, Morph-look, Displacement), **Film** (Film Burn, Flash, Dip to Color, Luma Fade ตาม luma ของภาพ)
- ทุกแบบมีพารามิเตอร์ (ทิศทาง, สี, ความนุ่มขอบ ฯลฯ) ใน Effect Controls ของ transition และรองรับ Alignment (Center / Start / End at Cut) เหมือนเดิม

**Audio Effects** (เขียนเองใน `audioFx.js` / Worklet ให้ Preview = Export, อ้างอัลกอริทึมจาก Tone.js / Freeverb ได้)
- **Voice**: Telephone, Radio, Walkie-Talkie, Megaphone, Underwater, Robot, Alien, Monster/Deep, Chipmunk, Whisper-ize, Vocoder (carrier ภายใน), Harmonizer, Auto-Tune แบบง่าย (pitch snap ตาม scale), De-esser, Breath Reducer (gate อิงความถี่), Voice Leveler
- **Creative**: Tremolo, Vibrato, Auto-Pan, Auto-Wah, Ring Modulator, Bit Crusher, Sample-rate Reducer, Tape Stop, Tape Saturation, Lo-Fi, Vinyl (crackle procedural), Stutter/Gate Pattern, Reverse Reverb, Shimmer Reverb, Ping-Pong Delay, Tape Delay, Frequency Shifter, Stereo Widener, Mono Maker, Mid/Side EQ
- **Restoration (ไม่ใช่ AI)**: Hum Remover 50/60 Hz + harmonics (ไทยใช้ 50 Hz), Rumble Filter, Click/Pop Remover แบบ interpolation, Clip Restoration (de-clip), Noise Gate, Expander, Spectral Gate แบบ FFT (ห้ามใช้ ML — AI Noise Reduction ถูกตัดออก)
- **Mastering**: Loudness Maximizer (target LUFS), True Peak Limiter, Multiband Compressor 4 band, Exciter, Stereo Imager, Dither
- Convolution Reverb: IR ในตัวอย่างน้อย 20 ห้อง (small room, hall, church, plate, spring, cave, car, bathroom, stadium ฯลฯ) — **สร้างแบบ synthetic เอง** (filtered noise + early reflections) หรือ OpenAIR เฉพาะไฟล์ที่ license ผ่าน E1

**Audio Transitions** เพิ่ม: Linear, Logarithmic, S-Curve, Equal Power (เลือกโค้งได้), Cut + Short Fade (anti-click), Dip to Silence, Reverb Tail Out, Filter Sweep (lowpass), Echo Out — ทั้งหมดใช้ `transitionGain` / chain เดียวกันทั้ง Preview และ Export

### E4. ระบบ Presets (ตอนนี้ไม่มีเลย)
- **Save Preset…**: คลิกขวาที่ effect หนึ่งตัวหรือหลายตัวใน Effect Controls → dialog: Name, Type (**Scale** / **Anchor to In Point** / **Anchor to Out Point** สำหรับ keyframe แบบ Premiere), Description
- เก็บ user preset ใน `userData/presets/*.json` (ไม่ผูกกับโปรเจกต์) ส่วน built-in preset ไว้ใน `src/presets/**/*.json` แล้ว bundle เข้าแอป
- Effects panel > **Presets**: แสดง built-in (ล็อกแก้ไม่ได้) + **My Presets** (rename, delete, ย้ายเข้า bin, export/import ไฟล์ `.espreset`), ลากไปวางบนคลิปได้ (หลายคลิปพร้อมกัน), double-click = ใส่ให้คลิปที่เลือก
- preset หนึ่งตัวเก็บได้ทั้ง video effect chain, Motion/Opacity, Lumetri, audio effect chain, transition + duration + alignment
- ทดลอง **import `.prfpset` ของ Premiere** แบบ best-effort สำหรับ effect ที่ map ได้ (แจ้งรายการที่ข้าม) — ถ้าทำไม่ได้ให้เขียนเหตุผล

### E5. Built-in presets (ต้องไม่เป็นโฟลเดอร์ว่าง) — เป้า ≥ 400 รายการ, ทุกตัวสร้างเอง (`source: 'own'`)
- **แบบ Premiere** (ชื่อและการทำงานเทียบเท่า): Bevel Edges (Thick/Thin), Blurs (Fast Blur In/Out), Lens Distortion Removal (ค่ากลางสำหรับกล้อง action cam แบบ generic — ห้ามใช้ชื่อยี่ห้อ), Mosaics (In/Out), **PiPs** (25% / 40% / 50% ที่ 4 มุม + กลาง, แต่ละตัวมี Slide In / Slide Out / Scale In / Scale Out / Spin In / Spin Out), Solarizes (In/Out), Twirls (In/Out)
- **Motion**: Zoom In / Zoom Out (slow/fast), Ken Burns (8 ทิศ), Punch-In (2 ระดับ), Slide In/Out (4 ทิศ), Pop In/Out, Bounce In, Spin In/Out, Drop In, Shake (light/medium/heavy), Wobble, Whip Pan เข้า/ออก (4 ทิศ), Pulse, Heartbeat, Flip In (X/Y) — ใช้ Motion + easing ของ keyframe ที่มีอยู่
- **Blur / Focus**: Focus In/Out, Blur In/Out, Rack Focus, Tilt-Shift Miniature, Dreamy Glow
- **Glitch / Retro**: Glitch Hit (short/long), VHS Look, CRT TV, Old Film, Super 8, Damaged Film, 8-bit
- **Light**: Flash In/Out, Light Leak (warm/cool/rainbow), Bloom Soft/Strong, Neon Glow
- **Color (Lumetri Looks ≥ 150)**: สร้างเป็น Lumetri preset + baked `.cube` ด้วยคณิตศาสตร์สีของเราเอง (แบบเดียวกับ `src/Services/filters.js`) หมวด: Cinematic (teal & orange, blockbuster, noir, thriller), Film Emulation แบบ generic (ห้ามใช้ชื่อฟิล์มยี่ห้อจริงเป็นชื่อ preset), Vintage, Black & White (10+ แบบ), Day for Night, Warm / Cool, Pastel, Moody, Matte, High Contrast, Food, Travel, Portrait / Skin, Wedding, Technical (Rec.709 legal, Log → Rec.709 สำหรับ log curve ที่สเปกเปิดเผย, Desaturate highlights) — export LUT ได้จาก Lumetri
- **Audio**: Podcast Voice, Broadcast Voice, YouTube Voice, Phone Call, Radio DJ, Walkie-Talkie, Megaphone, Underwater, Cave / Hall / Church / Room, Robot, Monster, Chipmunk, Hum Removal 50 Hz / 60 Hz, Rumble Cut, De-ess, Music Bed (duck-ready EQ), Master: Gentle / Loud / Podcast -16 LUFS / YouTube -14 LUFS / Broadcast -23 LUFS
- **Transitions**: แต่ละ transition มี preset ทิศทาง/ความยาว (เช่น Whip Pan Left 10 frames), Default transition เลือกจาก preset ได้
- **ห้าม** มี preset ประเภท Text Style / Text Animation (ผู้ใช้ตัดออก)

### E6. Effects panel ต้องใช้ง่ายเมื่อมีของเยอะ
- ช่องค้นหา (ชื่อ, หมวด, คำค้นภาษาไทย/อังกฤษผ่าน tag), **Favorites** (ดาว), **Recently Used**
- badge: **New** (เพิ่มในรอบนี้), **GPU** (accelerated), **32-bit/YUV** แบบ Premiere (ถ้ามีความหมายกับ pipeline เรา), **Approx** ถ้ายังไม่เหมือน Premiere
- **Hover preview**: ชี้ที่ effect / transition / preset แล้ว Program Monitor แสดงผลกับคลิปใต้ playhead (ใช้ระบบ hover preview ที่ Filters มีอยู่แล้ว) และ thumbnail เล็กใน panel
- Effect Controls: ปุ่ม Reset ต่อ effect, เปิด/ปิด (fx), ลากเรียงลำดับ, copy/paste effect เดี่ยว

### E7. เกณฑ์ผ่านของทุก effect / transition / preset
1. Preview = Export: pixel ตรงกันในเกณฑ์ที่ใช้ใน e2e เดิม (เทียบ `renderFrame` กับไฟล์ export) — สุ่มตรวจอัตโนมัติทุกตัวด้วยค่า default และค่าสุ่ม 3 ชุด
2. ไม่มี NaN / ค่าเกิน, alpha ถูกต้อง, ภาพไม่เลื่อน 1 pixel ที่ขอบ, รองรับ 4K และ sequence แนวตั้ง
3. Transition: p=0 ได้ A ทั้งภาพ, p=1 ได้ B ทั้งภาพ
4. Audio effect: bypass = dry ตรงกันทุก sample, ไม่มี NaN/denormal, latency ชดเชยแล้ว, Preview กับ Export ต่างกันไม่เกิน -60 dB
5. ความเร็ว: 1080p 30 fps เล่นได้แบบ real-time บน iGPU ระดับกลางสำหรับ effect ทั่วไป ตัวที่หนักให้ติด badge "Render" และใช้ Render Effects In to Out ได้
6. Undo/Redo ได้, บันทึกแล้วเปิดใหม่ค่าเหมือนเดิม, โปรเจกต์เก่าเปิดได้
7. `test_effect_licenses.mjs` ผ่าน

### E8. ลำดับการทำ (ทำทีละก้อน รัน test ทุกก้อน)
1. ระบบ Presets (E4) + test license (E1) + Effects panel search/favorites (E6)
2. ส่วนที่ Premiere มีแต่ขาด (E2)
3. Transitions จาก gl-transitions + ของเราเอง (E3)
4. Video effects ใหม่ (E3) ทีละโฟลเดอร์
5. Audio effects + audio transitions (E3)
6. Built-in presets + Lumetri Looks (E5)
7. อัปเดต README feature list, PROGRESS.md (ตารางจำนวนเทียบ Premiere ใหม่), THIRD_PARTY_LICENSES.md

---

## Phase D — ตรวจรอบสุดท้าย

1. ไล่ทุกเมนูใน `src/Core/menus.js` และทุกเมนูคลิกขวา: เมนูที่มี `...` ต้องเปิด dialog ทุกตัว
2. ไล่ทุกคำสั่งที่แก้คลิปว่าเคารพ track lock และ Linked Selection และเป็น 1 undo step
3. ไล่ทุก shortcut ด้วยแป้นอังกฤษและแป้นไทย (เพิ่ม test ที่ส่ง keydown ทั้ง `key` ภาษาไทยและ `code`)
4. เพิ่ม e2e ใหม่ (`scripts/e2e/phase6*.cjs`) สำหรับ Phase A–C และใส่ใน `npm run test:e2e`
5. อัปเดต `README.md` (feature list) และ `docs/PROGRESS.md` พร้อมตารางเทียบ Premiere ที่อัปเดตแล้ว
6. **ไม่ต้อง build installer** สรุปผลให้ผู้ใช้แล้วรอคำสั่ง

---

## ภาคผนวก — ตารางเทียบกับ Premiere Pro (สถานะใน 2.2.0 ก่อนแก้)

✅ มีและใช้ได้ · 🟡 มีบางส่วน / มีบั๊ก · ❌ ไม่มี

| หัวข้อ | Premiere Pro | EditorStage 2.2.0 | อยู่ใน |
|---|---|---|---|
| Link | Clip > Link, Ctrl+L สลับ Link/Unlink | ❌ ไม่มีคำสั่ง (Merge Clips ทำหน้าที่แทนแบบผิดความหมาย) | B1 |
| Unlink | ใช้ได้ เสียงไม่เปลี่ยน | 🟡 เสียงดังเป็นสองเท่าหลัง Unlink | A1, B1 |
| ลากวิดีโอข้าม track | วิดีโอขึ้น 1 track → เสียงลง 1 track ตาม | 🟡 เหมือน Premiere แต่ผู้ใช้ไม่ต้องการ: ให้เสียงอยู่ track เดิม (เลื่อนเวลาตาม) | B6 |
| Alt+คลิก เลือกเฉพาะภาพ/เสียง | ✅ | ❌ | B6 |
| Group / Ungroup | เมนู + คลิกขวา | 🟡 มีในเมนู Clip ไม่มีในคลิกขวา | B3 |
| Nest | dialog ตั้งชื่อ, วางถูก track, เสียงแยก | 🟡 ไม่มี dialog, วางผิด track/ทับคลิป | A6 |
| Merge Clips | สร้าง merged clip ใน Project + dialog | 🟡 ทำงานเหมือน Link ไม่มี dialog | B2 |
| เมนูคลิกขวาที่คลิป | ~35 คำสั่ง | 🟡 ~15 คำสั่ง ขาด Cut/Copy/Link/Group/Nest/Label ฯลฯ | B3 |
| Ripple Delete ช่องว่าง (gap) | คลิกขวา gap | ❌ | B4 |
| คลิกขวา Transition | Clear, Set Duration | ❌ | B4 |
| Double-click คลิป → Source Monitor | ✅ | 🟡 เฉพาะ nested clip | B5 |
| Label สีคลิป | ✅ | ❌ (มี `color` แต่เลือกไม่ได้) | B3, C8 |
| Scale / Set to Frame Size | ✅ | ❌ | B3 |
| Reveal in Project / Explorer, Properties | ✅ | ❌ | B3 |
| Duplicate | สำเนา item ใน Project | 🟡 ก๊อปคลิปทับกันและ link มั่ว, shortcut กดไม่ติด | A4, A5 |
| Enable หลายคลิป | ตั้งค่าเดียวกันทั้งหมด | 🟡 สลับทีละคลิป | A7 |
| Track lock ป้องกันการแก้ | ✅ | 🟡 Select All + Delete ลบได้ | A3 |
| ถามบันทึกก่อนปิด | ✅ | ❌ งานหายได้ | A2 |
| Mark In/Out ใน Source Monitor ด้วยคีย์ | ✅ | 🟡 ใช้ได้แค่ปุ่มบน monitor | A8 |
| Markers (ชื่อ/สี/ช่วง/comment/ลาก/ลบทีละตัว/clip marker) | ✅ | 🟡 เพิ่ม/ลบทั้งหมดได้เท่านั้น | C1 |
| Q / W / E / D trim & select | ✅ | ❌ | C2 |
| Multicam กล้อง 1–9 | ✅ (สูงสุด 16) | 🟡 4 กล้องในเมนู | C2 |
| แก้ Keyboard Shortcuts | ✅ | ❌ ดูได้อย่างเดียว | C3 |
| Paste / Remove Attributes dialog | ✅ | 🟡 ทำทั้งหมดทันที ไม่มีให้เลือก | C4 |
| Audio Track Mixer (pan, master, meter) | ✅ | 🟡 มีแค่ volume / mute / solo | C5 |
| Sequence Settings (sample rate, PAR, conform fps), New Sequence dialog | ✅ | 🟡 | C6 |
| Preferences ที่ตั้งค่าได้ | ✅ | 🟡 ส่วนใหญ่เป็นข้อความ (ตั้งได้แค่ FFmpeg) | C7 |
| Project panel views / metadata | ✅ | 🟡 ต้องตรวจเพิ่ม | C8 |
| Video Effects / Transitions | ~100+ / ~45 | 🟡 102 / 32 (ขาดโฟลเดอร์ Video, Transition, Obsolete, Immersive transitions ฯลฯ) | E2, E3 |
| Audio Effects / Transitions | ~45 / 3 | 🟡 40 / 3 | E3 |
| Presets ใน Effects panel + Save Preset | ✅ | ❌ โฟลเดอร์ว่าง ไม่มีระบบบันทึก | E4, E5 |
| Lumetri Looks ในตัว | ✅ | ❌ (มี Filters 35 แบบใน Create panel) | E5 |
| Keyframe / Graph Editor, Time Remapping, Track Matte, Lumetri, Scopes, Captions, Multicam, Proxy, Export Queue, EDL/FCPXML/AAF | ✅ | ✅ (ตาม PROGRESS.md) | — |

---

## วิธีที่ใช้ตรวจ (สำหรับอ้างอิง)

- อ่านโค้ด: `src/Core/commands.js`, `src/Core/menus.js`, `src/Core/shortcuts.js`, `src/Components/Timeline.jsx`, `src/Components/Panels.jsx`, `src/Components/Panels2.jsx`, `src/Components/Dialogs.jsx`, `src/Core/flatten.js`, `src/Services/exporter.js`, `src/Services/audioEngine.js`, `src/Services/media.js`, `electron/main.js`
- รันในแอปจริงผ่าน harness ของ e2e (`scripts/e2e/harness.cjs`): ทดสอบ A1, A3, A4, A5, A6, A7, A2 (close project) และการไม่มีคำสั่ง Link — ผลอยู่ในวงเล็บ "หลักฐาน" ของแต่ละข้อ
- ข้อที่ยังไม่ได้รันพิสูจน์ (มาจากการอ่านโค้ด): A2 ส่วนปุ่มปิดหน้าต่าง, A6 ส่วน speed ของ nested clip, A8, และหัวข้อ Phase C ทั้งหมด — ให้ตรวจซ้ำก่อนแก้
