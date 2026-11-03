# งานรอบถัดไป: Timeline & Track (EditorStage)

อ่าน `docs/EDITORSTAGE_UPGRADE_PLAN.md` (หัวข้อ "1. กฎหลัก") และ `docs/PROGRESS.md` ก่อนเริ่ม แล้วทำตามกฎหลักทุกข้อเหมือนเดิม โดยเฉพาะ:
- ทุกการแก้ต้อง Undo/Redo ได้ผ่าน `edit(...)`
- `.esproj` เก่าต้องเปิดได้ (field ใหม่ต้องเป็น optional และมีค่า default)
- Preview = Export
- ห้ามมีเมนู stub และ `scripts/check_commands.mjs` ต้องได้ 0 missing / 0 stubs
- งานหนักทำใน Worker หรือ main process มี progress และกดยกเลิกได้
- shortcut ใหม่ห้ามชนกับของเดิมใน `src/Core/shortcuts.js` และทุก shortcut ที่แสดงในเมนูต้องมี key binding จริง

**ห้ามทำ** (ผู้ใช้ตัดออกแล้ว): Text Animation, Text Style Presets, Auto Beat Sync, Video Effects สำเร็จรูป, Stickers / Overlays, Templates, Text-to-Speech, AI Noise Reduction, Audio library, Thai-first, Optical Flow / AI Frame Interpolation, AI Upscale, Auto Edit to Music, Command Palette

ทำทีละ Phase จบแต่ละ Phase ให้รัน `npm run build`, `npm test`, `npm run test:e2e` ให้ผ่าน แล้วสรุปสั้น ๆ ก่อนเริ่ม Phase ถัดไป

---

## Phase A — สลับเลเยอร์และจัดการ Track

### A1. ลากคลิปที่ link กัน / หลายคลิป ข้าม track ได้ (สำคัญที่สุด)
ตอนนี้ `Timeline.jsx` (gesture "Move Clip") เปลี่ยน track ได้เฉพาะตอน `grp.length === 1` เท่านั้น ถ้าเป็นวิดีโอที่มีเสียง link อยู่ (Linked Selection เปิดเป็นค่าเริ่มต้น) หรือเลือกหลายคลิป จะลากขึ้นลง track ไม่ได้
- ให้คำนวณ "จำนวน track ที่เลื่อน" จากคลิปที่จับลาก แล้วใช้กับทุกคลิปในกลุ่ม **แยกตามประเภท**: วิดีโอเลื่อนในกลุ่ม video track, เสียงเลื่อนในกลุ่ม audio track (แบบ Premiere: ลากภาพจาก V1 ไป V2 → เสียงไป A2 ตาม ถ้าลากเฉพาะเสียงลงก็ทำแบบเดียวกัน)
- ถ้าเลื่อนเกิน track ที่มีอยู่ ให้สร้าง track ใหม่ (ใช้ `addTrackTo`) ถ้ามี track ที่ lock ขวางอยู่ ให้คลิปนั้นอยู่ที่เดิมหรือหยุดที่ track สุดท้ายที่ใช้ได้ (เลือกแบบใดแบบหนึ่งแล้วเขียนเหตุผลไว้)
- ห้ามย้ายข้ามประเภท (วิดีโอห้ามลง audio track, caption ไปได้เฉพาะ caption track)
- แก้ `moveClips()` ใน `editing.js` ให้รองรับ trackMap หลายคลิป และ overwrite ถูกต้องเมื่อหลายคลิปย้ายพร้อมกัน
- ลาก clip ที่เป็น group (`clip.group`) ก็ต้องย้ายข้าม track ได้แบบเดียวกัน

### A2. ปุ่มลัดเลื่อนคลิป
- **Alt+↑ / Alt+↓** = เลื่อนคลิปที่เลือกขึ้น/ลง 1 track (Nudge Clip Selection Up/Down) ใช้กติกาเดียวกับ A1
- **Alt+← / Alt+→** = เลื่อนคลิปที่เลือก 1 เฟรม และ **Alt+Shift+← / →** = 5 เฟรม (แบบ Premiere)
- เพิ่มคำสั่งเหล่านี้ในเมนู Clip / Sequence พร้อมแสดง shortcut

### A3. การลากแบบมีปุ่มกดค้าง (ตอนนี้ปล่อยแล้วทับของเดิมอย่างเดียว)
- **Ctrl+ลาก** = Insert: แทรกแล้วดันคลิปที่อยู่ข้างหลังออกไป (ใช้ sync lock เหมือน `insertClip`)
- **Ctrl+Alt+ลาก** = Rearrange: ยกคลิปออก (extract) แล้วแทรกที่ตำแหน่งใหม่ ทำให้สลับลำดับคลิปบน track ได้โดยไม่เหลือช่องว่าง
- **Alt+ลาก** = Duplicate: ก๊อปปี้คลิปไปที่ใหม่ (คลิปเดิมอยู่ที่เดิม) ถ้า Alt+ลากคลิปที่ link กัน ให้ก๊อปปี้ทั้งคู่และ link คู่ใหม่ด้วยกัน
- ลากจาก Project panel แล้วกด Ctrl ตอนปล่อย = Insert
- แสดงตัวบอกโหมดตอนลาก (เคอร์เซอร์ / ลูกศรแทรก / กรอบสีต่างกัน) ให้รู้ว่าจะ Overwrite, Insert, Rearrange หรือ Duplicate
- ทั้งหมดเป็น 1 undo step

### A4. จัดการ Track
- **สลับลำดับ track**: ลากหัว track ขึ้นลง + คลิกขวา Move Track Up / Move Track Down (เฉพาะในกลุ่มประเภทเดียวกัน)
  - ลำดับใหม่ต้องมีผลกับ compositor (track บนทับ track ล่าง) ทั้ง Preview และ Export
  - ถ้าเปลี่ยนเลข track id (V1/V2…) ให้ remap **ทุกที่ที่อ้าง track id** เช่น `clip.track`, `seq.transitions[].track`, พารามิเตอร์ effect ที่เลือก track (เช่น Track Matte Key, ดูจาก `dynTracks` ใน `EffectControls.jsx`), multicam, nested sequence, caption track, ducking และ interchange — ถ้าจะใช้วิธีเพิ่ม field ชื่อแสดงผลแทนการเปลี่ยน id ก็ได้ แต่ต้องอธิบายว่าเลือกแบบไหนเพราะอะไร
- **Delete Track** และ **Delete Empty Tracks** (ถามยืนยันถ้าลบ track ที่มีคลิป)
- **Rename Track** (field ใหม่ `track.name` แบบ optional ไม่มีก็แสดง id เดิม)
- **ความสูงของ track**: ลากขอบล่างของหัว track เพื่อปรับ, ปุ่มย่อ/ขยายทุก track (ตอนนี้ `TRACK_H = 36` ตายตัว) เก็บค่าไว้ในโปรเจกต์
- **เมนูคลิกขวาที่หัว track** ให้มีคำสั่งของ track นั้นจริง: Rename, Move Up/Down, Delete Track, Delete Empty Tracks, Add Track Above/Below, Lock, Mute/Solo (audio), ปรับความสูง

### A5. Track Targeting / Source Patching
- ตรวจพฤติกรรมเดิมก่อน (ตอนนี้ Insert `,` / Overwrite `.` / Paste ดูเหมือนจะเลือก track แรกที่ไม่ lock เอง)
- เพิ่มปุ่ม target บนหัว track (แบบ V1/A1 ที่กดเปิดปิดได้ของ Premiere) ให้ Insert, Overwrite, Paste, Match Frame และ Add Edit ใช้ track ที่ target ไว้
- field ใหม่ต้อง optional — โปรเจกต์เก่าต้องทำงานเหมือนเดิม

## Phase B — การแสดงผลบน Timeline

### B1. ภาพตัวอย่าง (thumbnail) บนคลิปวิดีโอ
- ตัวเลือก View: None / Head / Head and Tail / Continuous (filmstrip)
- ถอดเฟรมด้วย FFmpeg หรือ Worker ไม่ให้ UI ค้าง มี cache ตาม media + เวลา + ขนาด
- ต้องตรงกับเฟรมจริงเมื่อคลิปเปลี่ยน speed / reverse / time remap / frame hold (ใช้ `clipTime.js`)
- ใช้กับ image, synthetic media, nested sequence และ MOGRT ด้วย (หรือแสดง icon แทนถ้ายังทำไม่ได้)

### B2. เส้น Volume / Opacity บนคลิป (rubber band)
- คลิปเสียง: เส้น Volume > Level, คลิปวิดีโอ: เส้น Opacity — เปิด/ปิดได้จากคลิกขวาที่คลิป (Show Clip Keyframes) แบบเดียวกับ Show Speed Keyframes ที่มีอยู่
- ลากเส้นขึ้นลงเมื่อไม่มี keyframe = ปรับค่าทั้งคลิป, Ctrl+คลิก = เพิ่ม keyframe, Alt+คลิก = ลบ, ลาก keyframe ได้ทั้งเวลาและค่า (ใช้ convention เดียวกับเส้น speed ที่มีอยู่)
- ใช้ข้อมูล keyframe ตัวเดียวกับ Effect Controls และ `evalParam` (Preview = Export)
- เลือกพารามิเตอร์อื่นของคลิปมาแสดงบนเส้นได้ (เช่น Position, Scale, effect) แบบ Premiere

## Phase C — เพิ่มเติม (ทำหลัง A และ B)

### C1. effect ที่ยังเป็น `approx`
- ไล่ effect ที่มี `status: 'approx'` ใน `src/Renderers/fx/videoEffects.js` (23 ตัว) และ `src/Services/audioFx.js` (FFT Filter, Pitch and Time) แล้วทำให้ผลใกล้กับ Premiere มากที่สุด ตัวที่ทำครบแล้วให้เอา flag ออก ตัวที่ยังไม่ได้ให้เขียนเหตุผลไว้ใน PROGRESS.md
- ห้ามแตะเรื่อง AI Noise Reduction (ผู้ใช้ตัดออก)

### C2. AAF / OMF
- ลองเขียน exporter เองจาก spec (JS ล้วน ไม่ใช้ไลบรารีที่ license ไม่ผ่านกฎข้อ 2) อย่างน้อย AAF แบบ embedded audio สำหรับส่งเสียงไป DAW
- ถ้าทำให้ถูกต้องและเปิดใน DAW ได้จริงไม่ได้ ให้ซ่อนไว้เหมือนเดิมและเขียนเหตุผล

### C3. ไลเซนส์ FFmpeg
- ตอนนี้ `ffmpeg-static` เป็น GPL build ให้เพิ่มทางเลือกใช้ FFmpeg แบบ LGPL (ตั้ง path ได้ใน Preferences / ตอน build) และตรวจว่าฟีเจอร์ไหนต้องใช้ encoder ที่เป็น GPL (เช่น libx264/libx265) พร้อม fallback ไป encoder ที่ไม่ใช่ GPL (hardware encoder, openh264 ฯลฯ) — สรุปไว้ใน `THIRD_PARTY_LICENSES.md`

---

## การทดสอบ
- unit test ใหม่: `moveClips` แบบหลายคลิป / link / group ข้าม track, nudge, insert-drag, rearrange, duplicate, การ remap track id ตอนสลับลำดับ / ลบ track
- e2e (`scripts/e2e/phase5.cjs`): สลับลำดับ V1/V2 แล้ว export ตรวจ pixel ว่าเลเยอร์บนเปลี่ยนจริง, ย้ายวิดีโอที่ link กับเสียงไป V2/A2 แล้วตรวจว่าเสียงยังตรงเวลา, Track Matte ยังชี้ track ถูกตัวหลังสลับลำดับ, เส้น Opacity / Volume บนคลิปให้ผลตรงกับ export, เปิด `.esproj` เก่าได้ผลเหมือนเดิม
- อัปเดต `docs/PROGRESS.md` (เพิ่ม Phase 5) และ `README.md` เมื่อจบ
