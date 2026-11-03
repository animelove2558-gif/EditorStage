# EditorStage Upgrade — Progress

อ้างอิงแผน: `docs/EDITORSTAGE_UPGRADE_PLAN.md` · สถานะ: ✅ เสร็จและทดสอบแล้ว · 🟡 ทำบางส่วน / มีข้อจำกัด · ⬜ ยังไม่เริ่ม

## วิธีทดสอบ (ทุก Phase)

```
npm run build        # ต้องผ่าน
npm test             # unit: keyframes (26) + timeremap (41) + interchange (36) + tracker (9) + color (8) + thai (16) + tracks (54) + clipview (26) + check_commands (0 missing / 0 stubs)
npm run test:e2e     # เปิดแอปจริงใน Electron, export ด้วย FFmpeg แล้วตรวจ pixel/เสียงของไฟล์ผลลัพธ์ (phase1 44 + phase2 103 + phase3 38 + phase4 22 + phase5 53 checks)
```

ไฟล์ทดสอบของ e2e สร้างด้วย FFmpeg ที่ `test-assets/e2e/` (`scripts/e2e/make_assets.mjs`): `rgb_seconds.mp4` (แดง/เขียว/น้ำเงิน วินาทีละสี, เสียง 440 Hz ซ้ายอย่างเดียว), `fields.png` (เส้นคู่น้ำเงิน เส้นคี่แดง), `left_tone.wav`
e2e ใช้โฟลเดอร์ userData ชั่วคราว ไม่แตะโปรไฟล์จริง

---

## Phase 1 — แก้บั๊กและเมนูที่ยังเป็น stub — ✅ (รอผู้ใช้ตรวจก่อนเริ่ม Phase 2)

| # | ข้อ | สถานะ | หมายเหตุ |
|---|-----|-------|---------|
| 1 | Title เบลอตอน Export | ✅ | `graphicCanvas(clip, dims, seqDims)` วาดตามขนาดที่ render จริง (Preview = ขนาด Preview, Export = ขนาดเต็ม เช่น 3840×2160), cache แยกตามขนาด `${id}@${W}x${H}` (LRU 48) และ re-upload texture เฉพาะเมื่อภาพเปลี่ยน (`__ver`). e2e: export 4K แล้วขอบตัวอักษรคม (step สูงสุด ≥ 200/255) |
| 2 | FontPicker ร่วม (queryLocalFonts) | ✅ | `src/Components/FontPicker.jsx` + `src/Services/fonts.js`: ค้นหา, ตัวอย่าง "Aa กขค สวัสดี", กรองเฉพาะฟอนต์ที่มีอักษรไทย, ⚠ ฟอนต์ที่ไม่มีในเครื่อง. ใช้ใน Essential Graphics, Replace Fonts, MOGRT. เปิดโปรเจกต์แล้วแจ้งเตือนฟอนต์ที่หาย (title, caption, MOGRT ทุก sequence). Replace Fonts แทนทุก sequence รวม caption style และค่า MOGRT |
| 3 | Keyframe Interpolation | ✅ | Linear / Hold / Ease In / Ease Out / Ease In-Out / Bezier — คลิกขวาที่ ◆ หรือที่ key บน key lane ใน Effect Controls. คณิตศาสตร์อยู่ที่ `params.js` (`evalParam`) ที่เดียว ใช้ทั้ง Preview และ Export. unit 26 ข้อ + e2e: opacity ใน MOV ที่ export ตรงกับ `evalParam` (error ≤ 2.5/255) ทั้ง easeInOut / hold / bezier |
| 4 | ลบโค้ดตาย / RT block ใน commands.js | ✅ | `commands.js` เขียนรวมใหม่ 1 id = 1 นิยาม ไม่มี `stub()` ไม่มีข้อความ "scaffolded / logic pending". ลบ panel ที่ซ่อนแต่ไม่ได้ใช้ (export / shortcuts / preferences / sequenceSettings / projectSettings) และ component ตายใน Panels.jsx |
| 5a | clip.audioChannels | ✅ | Stereo / Mono / Swap / Left only / Right only — ใช้ `channelNode()` ตัวเดียวทั้ง playback และ export. e2e วัด RMS ทุกโหมด + WAV export |
| 5b | clip.fieldOptions | ✅ | Reverse Field Dominance / Always Deinterlace / Flicker Removal — shader บน GPU ที่ความละเอียด source (Preview = Export). e2e ตรวจ pixel ทุกโหมด |
| 5c | clip.frameHold | ✅ | Source TC / In / Out / Playhead / Marker + Hold Filters (keyframe หยุดตามเฟรมที่ค้าง). clip ที่ค้างภาพไม่เล่นเสียง (เหมือน Premiere). e2e ตรวจทุกโหมด |
| 5d | clip.makeSubclip / editSubclip | ✅ | สร้างจาก In/Out ของ Source Monitor, แก้ช่วง, Convert to Master Clip. subclip แสดง ✂ ใน Project panel |
| 5e | Export EDL / FCPXML / Premiere XML (+Selection) | ✅ | `src/Services/interchange/` (JS ล้วน ไม่มี dependency): CMX3600 (DF/NDF, dissolve, M2 speed, หลาย video track → แยกไฟล์), FCPXML 1.9, xmeml v5 (Premiere/FCP7: link, time remap, transition, marker). Export Selection = Premiere XML เฉพาะ clip ที่เลือก + คู่ที่ link |
| 5f | Import XML / EDL / FCPXML | ✅ | File > Import Sequence และ File > Import (เลือกไฟล์ได้เลย). จับคู่ media ตาม path, import ไฟล์ที่มีอยู่, ที่ไม่มีสร้างเป็น offline. e2e: export → import กลับได้ clip ตรงกันทั้ง 3 รูปแบบ |
| 5g | AAF / OMF | ✅ AAF (Phase C2) / OMF ไม่ทำ | AAF เขียนเองด้วย JS ล้วน (ดู Phase C2) — File > Export > AAF (Embedded Audio)... ; OMF ไม่ทำเพราะ AAF แทนได้ในทุก DAW ปัจจุบัน |
| 5h | Workspaces: All Panels, Essential Graphics, Learning | ✅ | All Panels = ทุก panel ที่มองเห็นได้. Learning มี Learn panel (บทเรียน offline). e2e โหลดทุก workspace |
| 6 | scripts/check_commands.mjs | ✅ | ตรวจ id จากเมนู, `run('…')` ทั้ง src, shortcuts และว่าทุก shortcut ที่แสดงในเมนูมี key binding จริง → **0 missing, 0 stubs** |

### สิ่งที่เปลี่ยนเพิ่มระหว่างทาง (บั๊กที่เจอจากการทดสอบ — กฎข้อ 5 Preview = Export)
- **Export ได้เฟรมผิดเมื่อ playhead ไม่ได้อยู่ที่ช่วงที่ export**: Program Monitor ยัง sync `<video>` ตัวเดียวกันกลับไปที่ playhead ระหว่าง export. แก้: `lockPlayback()` ใน `media.js` หยุด playback sync ระหว่าง export และรอ `loadedmetadata` ก่อน seek element ที่เพิ่งสร้าง
- **Export เสียงซ้ำ 2 เท่า** สำหรับ video ที่มี audio link อยู่ (ทั้ง video clip และ audio clip ถูก mix) → ข้าม clip ที่ `noAudio` เหมือน playback
- **Export ไม่มีเสียงของ nested sequence** → mix จาก `flatten(state)`
- **Workspace "Effects" และ "Graphics" เปิดแล้ว error** (panel เดียวกันอยู่ 2 ที่ → FlexLayout duplicate id) → `build()` ให้ 1 panel อยู่ที่เดียว
- ปุ่ม shortcut ที่แสดงในเมนูแต่ไม่มี binding 14 รายการ → bind ให้ครบ. Make Subclip = Ctrl+U, Make Subsequence = Shift+U (ตาม Premiere)
- เอา "Upgrade to Source Graphic" ออก: ใน EditorStage graphic ทุกตัวเป็น source graphic อยู่แล้ว ไม่มีอะไรให้ upgrade
- Libraries panel (เดิมเป็น placeholder) → ทำให้ใช้งานได้จริงแบบ offline: เก็บ media / graphic / สี ไว้ใช้ข้ามโปรเจกต์ (localStorage ในเครื่อง)
- เพิ่ม Frame Hold / Field Options / Audio Channels ในเมนูคลิกขวาของ clip บน Timeline

### เหตุผลการออกแบบ
- **ไฟล์ `.esproj` backward-compatible**: field ใหม่ทั้งหมดเป็น optional — `key.interp` (ไม่มี = Linear), `key.in/out`, `clip.frameHold`, `clip.fieldOptions`, `clip.audio.channels`, `media.subclip`. โปรเจกต์เก่าเปิดได้และให้ผลเหมือนเดิม (e2e เปิดไฟล์รูปแบบเก่าแล้ว render/mix ได้)
- **Undo/Redo**: ทุกการแก้ผ่าน `edit()`; `edit()` snapshot `seqs` (sequence ที่ไม่ active) ด้วย เพื่อให้ Replace Fonts ข้าม sequence undo ได้ (clone แบบ lazy เฉพาะเมื่อแตะ `ctx.seqs`)
- **Keyframe**: segment A→B ใช้ฝั่ง out ของ A และฝั่ง in ของ B (แบบ After Effects/Premiere); handle เป็น cubic-bezier แบบ normalized; Ease influence = 1/3; Bezier สร้าง handle อัตโนมัติแบบ Catmull-Rom. ค่าที่ไม่ใช่ตัวเลขเป็น step
- **Subclip** เป็น media item ใหม่ที่ชี้ไฟล์เดิม + `subclip: {parent, in, out}` — ไม่ copy ไฟล์, clip ที่อยู่ใน sequence แล้วไม่เปลี่ยน
- **Field Options** ทำเป็น shader pass ที่ความละเอียด source ก่อน transform เพื่อให้นับเส้นคู่/คี่ถูกต้องไม่ว่าจะ scale เท่าไร
- **Interchange ข้าม** title, caption, MOGRT และ nested sequence (ไม่มีตัวแทนในรูปแบบไฟล์เหล่านี้) และบอกจำนวนที่ข้ามหลัง export. EDL: ถ้า record TC เริ่มที่ 01:00:00:00 จะถือเป็น offset ของ sequence (แบบ Premiere/Avid)

### ข้อจำกัดที่รู้อยู่
- EDL เก็บได้ 1 video track ต่อไฟล์ (มาตรฐาน CMX3600) → V2 ขึ้นไปเขียนเป็นไฟล์ `<ชื่อ> V2.edl` แยก
- Import ไม่นำเข้า effect / color / keyframe จากโปรแกรมอื่น (นำเข้า clip, ตัด, speed, transition, marker, link)
- ไฟล์ ffmpeg ที่มากับ `ffmpeg-static` เป็น GPL build — เรียกใช้เป็นโปรแกรมแยก (ไม่ได้ link) ดูหมายเหตุใน `THIRD_PARTY_LICENSES.md` ก่อนแจกจ่ายเชิงพาณิชย์

---

## Phase 2 — ตัดต่อระดับมืออาชีพ — ✅

| # | ข้อ | สถานะ | หมายเหตุ |
|---|-----|-------|---------|
| 1 | Graph Editor + ease preset แบบ CapCut | ✅ | ปุ่ม 📈 ข้างพารามิเตอร์ที่มี keyframe ใน Effect Controls: กราฟ Value/Speed, ลาก key / ลาก bezier handle, ดับเบิลคลิกเพิ่ม key, Alt+คลิกลบ. Preset: Ease, Bounce, Elastic, Back (`params.js` `EASE_PRESETS`/`SHAPES`). split ที่อยู่กลาง segment bezier ตัดแบบ De Casteljau จึงไม่เปลี่ยนรูปกราฟ |
| 2 | Speed / Reverse / Time Remapping / Speed Curve / Maintain Pitch / Frame Blending | ✅ | โมเดลเวลาเดียว `src/Core/clipTime.js` ใช้ทั้ง Preview, เสียง, Export, split/trim/roll/slide/nest. Speed/Duration dialog: Speed, Duration, Reverse Speed, Maintain Audio Pitch, Ripple Edit, Time Interpolation (Frame Sampling / Frame Blending). เส้นความเร็วบน clip (คลิกขวา > Show Speed Keyframes): ลากขึ้นลง, Ctrl+คลิกเพิ่ม key, Alt+คลิกลบ. Speed Curve แบบ CapCut: Montage, Hero, Bullet, Jump Cut, Flash In, Flash Out, Custom (คงช่วง source เดิม). เสียงของ clip ที่เปลี่ยนเวลา render ใน Worker (varispeed หรือ WSOLA เมื่อ Maintain Pitch) แล้วใช้ buffer เดียวกันทั้งตอนเล่นและตอน export |
| 3 | Freeze Frame | ✅ | Clip > Video Options > Add Frame Hold / Insert Frame Hold Segment (2 วินาที, ripple) + File > Export > Frame (Ctrl+Shift+E, ปุ่ม 📷 ใน Program Monitor) PNG/JPEG render ด้วย compositor เดียวกับ Export, เลือก Import into project ได้ |
| 4 | File > New: Adjustment Layer, Bars and Tone, Black Video, Color Matte, Universal Counting Leader, Transparent Video | ✅ | `src/Services/synthetic.js`: project item ที่ไม่มีไฟล์ (`media.synthetic`) วาดด้วย canvas ทุกเฟรม, เสียง (tone 1 kHz −12 dBFS / cue blip) สร้างเป็น WAV ในหน่วยความจำ → บันทึก/เปิดโปรเจกต์ใหม่ได้ภาพเดิม. ดับเบิลคลิกใน Project panel = Modify (สี/ขนาด/ตัวเลือก Leader). **Adjustment Layer**: effect / Lumetri / Motion / Opacity / Mask ของ clip นี้ทำกับภาพรวมของทุก track ข้างล่าง (compositor `ctx.below`) |
| 5 | Mask Tracking + Point Tracker | ✅ | ทุก mask มีแถบ Mask Path: ⏱ (keyframe path), ◀◀ ◀| |▶ ▶▶ (Track backward / 1 เฟรม / forward) และวิธี Position · Position & Rotation · Position, Scale & Rotation. Tracker (`src/Services/tracker.js`) = Shi-Tomasi + pyramidal Lucas-Kanade + forward-backward check + robust similarity, ทำใน DSP Worker, decode เฟรมด้วย FFmpeg (gray ≤480 px, ตรงกับเฟรมที่ preview แสดงแม้ clip เปลี่ยนความเร็ว). ผลเป็น keyframe ธรรมดา (แก้/undo/save ได้). **Track Object (Point Tracker)** (Clip menu / ปุ่ม ⌖ Track ใน Motion): ให้ title/sticker/clip ใดๆ วิ่งตามจุดใน video ข้างล่าง เขียน Position (+Scale/Rotation ถ้าเลือก) keyframe. มีแถบความคืบหน้า + Cancel |
| 6 | Color: Color Match, Auto Color / Auto Tone, Input LUT + Creative LUT, Scopes | ✅ | Lumetri > Basic Correction: Input LUT (.cube/.3dl) + ปุ่ม Auto / Auto Tone / Auto Color. Creative > Look (.cube/.3dl) + Intensity. Color Wheels & Match: เลือก Reference clip + เฟรม, Face Detection (เทียบสีผิว), Apply Match. ค่าทั้งหมดเป็น slider ปกติ (แก้ต่อได้) ที่ fit จาก CPU model ของ shader เดียวกัน (`src/Services/colorMatch.js`, สถิติ Lab) ทำใน Worker. Export รอโหลด LUT ก่อน render เฟรมแรก. Scopes: Waveform (Luma), RGB Parade, Histogram, Vectorscope YUV (มีเป้าสี 75% และเส้น skin tone) — e2e ตรวจทั้ง 4 แบบ |
| 7 | Scene Edit Detection | ✅ | Clip menu / คลิกขวาบน Timeline: FFmpeg `scdet` หาจุดตัดฉากใน source (ตาม In/Out และ speed ของ clip) แล้วเลือกได้ว่า Apply a cut at each detected cut point (`splitClipsAt`, undo ได้ 1 ครั้ง) / Create subclips ใน bin / สร้าง marker. ปรับ threshold ได้, มีแถบคืบหน้า + Cancel |
| 8 | Text-Based Editing | ✅ | panel **Text** (Window > Text): Transcribe Sequence ด้วย Whisper ในเครื่อง (ไทย/อังกฤษ, เลือก model), transcript เก็บใน media (`media.transcript`) จึงใช้ซ้ำได้หลัง save. คลิกคำ = ไป playhead, เลือกคำแล้ว Delete (ripple ลบช่วงจริงบน timeline), Ctrl+X / Ctrl+V ย้ายท่อน, ค้นหา ▲▼, Fillers (เอ่อ อ่า แบบว่า um uh … แก้รายการได้) ลบทีเดียว, Remove Silences, Create Captions. ทุกการแก้เป็น edit ปกติ (undo ได้) |
| 9 | Proxy Workflow | ✅ | Project panel คลิกขวา > Proxy > Create Proxies (ProRes 422 Proxy หรือ H.264 short-GOP, ขนาด 360/540/720) ทำใน background queue พร้อม % และ Cancel, เก็บที่โฟลเดอร์ Proxies ข้าง source. Attach Proxies (ตรวจความยาวต้องตรงกัน), Detach. ปุ่ม **P** (Toggle Proxies) ใน Program Monitor. **Export ใช้ไฟล์ต้นฉบับเสมอ** (e2e ตรวจด้วย proxy สีขาว) |
| 10 | Relink / Offline Media | ✅ | เปิดโปรเจกต์ที่ไฟล์ย้ายที่ → item เป็น offline, clip แสดงกรอบแดง "Media Offline" (ทั้ง Preview และ Export) และเปิด dialog **Link Media**: Locate… ไฟล์หนึ่งแล้วค้นหาไฟล์ที่หายตัวอื่นในโฟลเดอร์เดียวกัน/โฟลเดอร์ย่อย/โฟลเดอร์โปรเจกต์ (ชื่อ + ขนาดไฟล์) relink ให้อัตโนมัติ. item คง id เดิม clip ทุกตัวตามไป, undo ได้. File > Make Offline ด้วย |
| 11 | Export (HW encoders, Queue, presets, loudness, AV1/10-bit, Smart Render, chapters) | ✅ | **Encoding**: ทดลอง encode จริงกับ NVENC / Quick Sync / AMF (H.264, HEVC, AV1) แสดงเฉพาะตัวที่ใช้ได้ ถ้าใช้ไม่ได้ตอน export ถอยไป software อัตโนมัติ. **Preset แพลตฟอร์ม**: YouTube 1080p / 4K, TikTok/Reels/Shorts 9:16, Instagram 1:1 / 4:5, Facebook, Podcast MP3, Broadcast master; ขนาดต่าง aspect เลือก Scale to Fit / Fill / Stretch. **Format ใหม่**: HEVC Main10, AV1, ProRes 422 HQ, ProRes 4444 with Alpha (พื้นหลังโปร่งใส, alpha แบบ straight), AAC (M4A). **Loudness Normalization** −14/−16/−23/−24 LUFS + True Peak (loudnorm 2 รอบบน mix). **Chapters** จาก marker (MP4/MOV/M4A/MKV). **Smart Render**: clip H.264/HEVC ที่ไม่ได้แก้และตัดตรง keyframe → stream copy (เฟรมเหมือนต้นฉบับทุกบิต) ไม่งั้นบอกเหตุผลแล้ว render ปกติ. **Export Queue** (ปุ่ม Queue / File > Export > Export Queue): render ทีละงานใน background จาก snapshot ของโปรเจกต์ตอนกด, ยกเลิก/ลบ/เปิดไฟล์ได้, export หลายงานพร้อมกันได้ด้วย job id แยก |
| 12 | Auto Ducking (keyframe) | ✅ | Essential Sound > Music > Ducking: Duck against (Dialogue/Music/SFX/Ambience/Untagged), Sensitivity, Reduce By, Fades แล้วกด **Generate Keyframes** → วิเคราะห์ช่วงที่มีเสียงพูดจริง (ไม่ใช่แค่ช่วงที่มี clip) แล้วเขียน keyframe Volume > Level บน clip เพลง แก้ต่อใน Effect Controls ได้, undo ได้. โปรเจกต์เก่าที่ใช้ live ducking ยังทำงานเหมือนเดิม |

### บั๊กเดิมที่เจอและแก้ระหว่าง Phase 2
- **split/trim หัว clip ไม่เลื่อน keyframe ของ Motion / Opacity / Volume / Mask / Effect** ของส่วนขวา (ภาพกระโดดหลัง split) → `trimHead()` เลื่อน keyframe ทุกพารามิเตอร์ให้อยู่กับเฟรมเดิมของ source
- ค่า keyframe ที่เป็น array ซ้อน (จุดของ mask) interpolate เป็น NaN → `lerp` แบบ recursive
- แก้จุด mask ใน Effect Controls เคยลบ keyframe ทั้งหมด → ตอนนี้เขียน key ที่ playhead เมื่อ path เป็นแบบ animate

### ข้อจำกัดที่รู้อยู่ (Phase 2)
- Optical Flow ใน Time Interpolation ยังซ่อนไว้ (ต้องใช้ RIFE จาก Phase 4)
- Frame Blending แสดงเฉพาะตอนหยุดและตอน export (ตอนเล่นแสดงเฟรมธรรมดาเพื่อความลื่น)
- Reverse ตอนเล่น preview ต้อง seek ทุกเฟรม อาจกระตุกกับไฟล์ long-GOP (export ถูกต้องทุกเฟรม)
- Ellipse mask track ได้ตำแหน่งและขนาด แต่ไม่หมุน (mask วงรีไม่มีพารามิเตอร์ rotation) — ใช้ polygon/free-draw ถ้าต้องการหมุนตาม
- Smart Render ใช้ได้เมื่อทั้งช่วงเป็น clip H.264/HEVC บน track เดียว ไม่มี effect/transition/gap, ขนาด/fps/pixel format ตรงกับ output และจุดตัดทุกจุดอยู่บน keyframe (ไม่ re-encode เฉพาะบาง GOP)
- Export Queue render ใน renderer เดียวกับ Preview: ระหว่าง render Program Monitor ถูกล็อก (แก้ไข timeline ต่อได้)
- Text-Based Editing ใช้ Whisper model ในเครื่อง (ดึงครั้งเดียวด้วย `scripts/fetch_models.mjs` แล้วใช้ offline); คุณภาพภาษาไทยของ model base ยังจำกัด
- Color Match ใช้ slider Basic Correction + Highlights wheel (gain) ไม่ได้ปรับ curves/LUT; Face Detection ใช้ตัวจำแนกสีผิวแบบ YCbCr (ไม่ใช้โมเดล AI)

## Phase 3 — ให้ครบแบบ CapCut (พาเนล Create) — ✅ (ขอบเขตที่ผู้ใช้เลือก)

พาเนลใหม่ **Create** (Window > Create, อยู่ข้าง Effects): แท็บ Filters · Canvas · Captions · Voice · AI — ชี้เมาส์ที่รายการ = ดูผลใน Program Monitor ทันที (ไม่เข้า undo, ออกแล้วคืนค่าเดิม), คลิก = ใช้จริง 1 undo step

| # | ข้อ | สถานะ | หมายเหตุ |
|---|-----|-------|---------|
| 3 | Remove Background | ✅ | effect **Remove Background** (Effects > Keying และ Create > AI): MediaPipe Selfie Segmenter (Apache-2.0, ไฟล์ 250 KB อยู่ในโปรแกรม ทำงาน offline บน CPU) ปรับ Threshold / Feather / Choke / Invert. mask คำนวณต่อเฟรม source แล้ว cache ไว้ (`src/Services/segment.js`) — Export รอ mask ของทุกเฟรมก่อน render จึงตรงกับ Preview |
| 5 | Canvas / Background Fill | ✅ | Blur (ปรับได้) / Color / Image ต่อ clip หรือทั้ง Sequence (ใช้กับ main track = video track ล่างสุด) — compositor วาดพื้นหลังใต้ clip ก่อน Opacity/Mask |
| 6 | Filters | ✅ | 35 look ที่เขียนเองทั้งหมด (`src/Services/filters.js`): Cinematic, Vintage, Film, B&W, Food, Portrait, Lifestyle + Intensity. bake เป็น 3D LUT 33³ ใช้ shader เดียวทั้ง Preview/Export, thumbnail ในพาเนลคำนวณจากเฟรมจริงที่ playhead |
| 10 | Auto Captions ขั้นสูง | ✅ | ตัดบรรทัดภาษาไทยด้วย `Intl.Segmenter` (`src/Services/textEngine.js` — ไม่ตัดกลางคำ, คำยาวเกินบรรทัดตัดระหว่าง grapheme cluster), ตั้งจำนวนตัวอักษรต่อบรรทัด / จำนวนบรรทัดต่อ caption, Caption Style presets 10 แบบ, เน้นคีย์เวิร์ดอัตโนมัติ (สี + ขนาด, ตัวเลขมาก่อน), อีโมจิอัตโนมัติ (ไทย/อังกฤษ, เปิดปิดได้), Export SRT / VTT / ASS, Burn-in เปิด/ปิดได้ใน Export + ไฟล์ .srt/.vtt คู่กับวิดีโอ |
| 12 | Voice Changer | ✅ | audio effect **Voice Changer**: Chipmunk, Deep, Robot, Radio, Telephone, Megaphone, Echo Hall, Monster + Mix (keyframe ได้) ประกอบจาก effect เดิม + pitch worklet. e2e วัดความถี่จริง (Chipmunk +7 st, Deep −5 st) |

ตัดออกตามที่ผู้ใช้สั่ง: Text Animation, Text Style Presets, Auto Beat Sync, Video Effects สำเร็จรูป, Stickers / Overlays, Templates, Text-to-Speech, AI Noise Reduction, Audio library

### บั๊กเดิมที่เจอและแก้ระหว่าง Phase 3
- **Compositor `dataTexture()` สร้าง texture บน texture unit ที่ active อยู่** ทำให้เฟรมแรกของ Export (compositor ใหม่) ใช้ LUT/curves texture แทนภาพของ clip — ตอนนี้สร้างบน unit สำรอง
- caption ภาษาไทยที่ไม่มีช่องว่างไม่เคยตัดบรรทัดเลย (ยาวล้นจอ) → ใช้ word segmentation

### ข้อจำกัด (Phase 3)
- Remove Background ใช้ model สำหรับ "คน" (selfie) — วัตถุอื่นต้องใช้ Ultra Key / Mask
- อีโมจิอัตโนมัติใช้พจนานุกรมคำสำคัญ (~25 กลุ่ม) ไม่ใช้ AI

## Phase 4 — เหนือกว่า Premiere Pro และ CapCut — ✅ (ขอบเขตที่ผู้ใช้เลือก)

| # | ข้อ | สถานะ | หมายเหตุ |
|---|-----|-------|---------|
| 2 | Long-to-Shorts | ✅ | Create > **Shorts** (และ Smart Tools > Long-to-Shorts...). วิเคราะห์ sequence ที่เปิดอยู่ (`src/Services/ai/shorts.js`): ขอบเขตช่วงจากประโยคใน transcript (ไม่มี transcript = ใช้ช่วงพูด/ช่องเงียบ), ให้คะแนน 5 ด้าน — Speech, Energy (RMS ของช่วงที่มีเสียง), Laughter / Loud (ช่วงที่ดังกว่าระดับปกติ ≥ 6 dB), Scene Changes (FFmpeg `scdet` ใน main process + จุดตัด clip), Keywords & Hooks (คำถาม/คำเปิดเรื่องไทย-อังกฤษ, ตัวเลข, ประโยคแรกนับสองเท่า). ทุกด้าน normalize แบบ rank แล้วผู้ใช้ปรับน้ำหนักได้ทันที, แก้เวลาเริ่ม/จบ, เลือกช่วงที่จะสร้าง. **Create Shorts** = sequence ใหม่ต่อช่วง (9:16 / 1:1 / 4:5 / 16:9 / เท่าเดิม) + Auto-Reframe + captions จาก transcript (เลือก preset) + ตัดช่องเงียบ — เพิ่มทุก sequence ใน 1 undo step, มี progress + Cancel |
| 3 | Smart B-Roll | ✅ | Create > **B-Roll** (และ Smart Tools > Smart B-Roll...). **Index Media** (`src/Services/ai/broll.js`): ชื่อไฟล์ (แยกคำไทยด้วย Intl.Segmenter, camelCase, พหูพจน์), คำพูดใน transcript ของไฟล์นั้น, วัตถุที่ object detector (EfficientDet-Lite0 ที่มีอยู่) เห็นใน 3 เฟรม — เก็บใน `media.brollIndex` (บันทึกกับโปรเจกต์). พจนานุกรมไทย/อังกฤษของ 80 class (เช่น หมา/สุนัข → dog, กาแฟ → cup) + กลุ่ม food. **Suggest B-Roll** แนะนำต่อประโยคของ transcript (ไม่แนะนำไฟล์ที่เห็นอยู่แล้วในช่วงนั้น), กดแล้ววางบน video track ว่างตัวแรกเหนือภาพ (สร้าง track ใหม่ถ้าไม่มี) เฉพาะภาพ ไม่มีเสียง ยาวเท่าประโยค, 1 undo step |
| 8 | Project Health Check | ✅ | File > Export > Project Health Check... และสรุปใน Export dialog (`src/Services/healthCheck.js`): offline media (Link Media…), ฟอนต์หาย (Replace Fonts…), ช่องว่างดำ (Close Gap ถ้าไม่มีเสียงตรงนั้น), เสียง clip (sample เต็มสเกลใน mix จริง), loudness ผิดเป้า (FFmpeg loudnorm, ±2 LU), caption/title เกิน action-safe 5% — กดแต่ละข้อแล้วพาไปตำแหน่งและเลือก clip |

ตัดออกตามที่ผู้ใช้สั่ง: Thai-first, AI Frame Interpolation, AI Upscale, Auto Edit to Music, Command Palette (ไม่ต้องมีชุดทดสอบ beat detection แล้ว)

### refactor ระหว่าง Phase 4 (พฤติกรรมเดิมไม่เปลี่ยน)
- `silence.js`: แยก `silentRanges(pcm, …)` และ `removeRangesIn(seq, ranges)` ออกจาก Auto-Cut Silence
- `reframe.js`: แยก `reframeClips(seq)` (ใช้กับ sequence ที่ยังไม่ได้เพิ่มในโปรเจกต์) + Cancel
- `stt.js`: แยก `captionsInto(seq, segs)` ออกจาก `placeCaptions`

### ข้อจำกัด (Phase 4)
- "เสียงหัวเราะ" วัดจากช่วงที่ดังผิดปกติ (หัวเราะ ตะโกน ปรบมือ) ไม่ได้ใช้ model จำแนกเสียง
- Long-to-Shorts ใช้ transcript ที่มีอยู่ (ปุ่ม Transcribe Speech ในแท็บ ใช้ Whisper offline) — ถ้าไม่มี transcript ให้คะแนนจากเสียงและภาพเท่านั้น และไม่สร้าง caption
- Smart B-Roll จับคู่ด้วยคำ (ชื่อไฟล์ / คำพูด / 80 class ของ detector + พจนานุกรม) ไม่ได้ใช้ embedding เชิงความหมาย — ไฟล์ชื่อ IMG_0001 ที่ภาพไม่มีวัตถุใน 80 class จะไม่ถูกแนะนำ
- การสร้าง Short และวาง B-roll undo ได้ แต่การสลับ sequence (เปิด Short) ล้าง undo history (พฤติกรรมเดิมของโปรแกรม)

---

## Phase 5 — Timeline & Track (`docs/PROMPT_TIMELINE_UPGRADE.md`)

### Phase A — สลับเลเยอร์และจัดการ Track — ✅

| # | ข้อ | สถานะ | หมายเหตุ |
|---|-----|-------|---------|
| A1 | ลากคลิปที่ link / หลายคลิป / group ข้าม track | ✅ | `ed.trackShiftMap(seq, ids, delta)`: delta นับตามลำดับเลข track (+1 = V1→V2, A1→A2) ใช้กับทุกประเภทแยกกัน (ภาพขึ้น เสียงลง แบบ Premiere, caption อยู่ใน caption track เท่านั้น), เลยแถวสุดท้าย = สร้าง track ใหม่ (`appendTrack`), ไม่ต่ำกว่า track 1. `moveClips()` รับ trackMap หลายคลิป, คลิปที่ย้ายพร้อมกันไม่ตัดกันเอง, transition ตามคลิปไป track ใหม่ (ถ้าสองฝั่งแยก track กันจะถูกลบ). Timeline ใช้กับทั้งกลุ่ม (linked / selection / `clip.group`) |
| A2 | Nudge | ✅ | Alt+↑/↓ (1 track, กติกาเดียวกับ A1), Alt+←/→ (1 เฟรม), Alt+Shift+←/→ (5 เฟรม) — Clip > Nudge, ไม่ชนกับ shortcut เดิม (ลูกศรเปล่ายังเป็น playhead / edit point) |
| A3 | ลากแบบกดปุ่มค้าง | ✅ | `ed.dragClips(..., mode)`: Ctrl = Insert (เหลือช่องว่างที่เดิม แทรกที่ใหม่ ดันคลิปหลังออก ใช้ sync lock), Ctrl+Alt = Rearrange (ยกออกปิดช่องว่าง แล้วแทรก — จุดวางวัดบน timeline เดิม: เลยช่องว่างไปแล้วเลื่อนกลับเท่าช่องว่าง), Alt = Duplicate (copy + link/group id ใหม่เป็นคู่, เลือกตัว copy). กด/ปล่อย Ctrl/Alt ระหว่างลากเปลี่ยนโหมดทันที. ตัวบอกโหมด: ป้ายข้างเมาส์ + เส้นแทรกสีเหลือง/ฟ้า + เคอร์เซอร์ (copy / e-resize). Ctrl ตอนปล่อยจาก Project panel = Insert. ทั้งหมด 1 undo step |
| A4 | จัดการ Track | ✅ | ลากหัว track ขึ้นลง / Move Track Up/Down (เฉพาะประเภทเดียวกัน), Rename (`track.name`), Add Track Above/Below, Delete Track (ถามยืนยันถ้ามีคลิป), Delete Empty Tracks (เมนู Sequence และคลิกขวา), ความสูง track (`track.h`, ลากขอบล่างหัว track, Track Height ในเมนูคลิกขวา, ปุ่ม Expand / Minimize All Tracks) บันทึกในโปรเจกต์. เมนูคลิกขวาที่หัว track: Rename, Move Up/Down, Add Above/Below, Delete, Delete Empty, Target, Lock, Sync Lock, Mute/Solo (audio), Track Height |
| A5 | Track Targeting | ✅ | ปุ่ม V1/A1 บนหัว track (`track.target`). Insert `,` / Overwrite `.` วางบน track แรกที่ target ของแต่ละประเภท (ไม่มี audio target = วางเฉพาะภาพ, ไม่มี video target = วางเฉพาะเสียงของไฟล์วิดีโอ), Paste / Paste Insert: track ต่ำสุดที่ copy ไปลง track ที่ target และคงระยะห่าง (ตอนนี้ paste เป็น overwrite และ link คู่ copy ใหม่), Match Frame: track บนสุดที่ target, Add Edit (Ctrl+K): เฉพาะ track ที่ target (Ctrl+Shift+K ทุก track) |

### พฤติกรรมเดิมที่ตรวจก่อนทำ (A5)
- Insert / Overwrite ใช้ track แรกที่ไม่ lock เรียงตาม id (V1 / A1) — Paste วางกลับ track เดิมของคลิปที่ copy และไม่ overwrite (คลิปซ้อนกันได้) — Match Frame เอาคลิปแรกใน array — Add Edit ตัดทุก track
- โปรเจกต์ที่ไม่มี field `target` เลย (โปรเจกต์เก่า + โปรเจกต์ใหม่ที่ยังไม่กดปุ่ม) ใช้ค่าเดิมทุกข้อ (V1 / A1 ถือว่าถูก target, Add Edit ตัดทุก track). กดปุ่มครั้งแรกจะเขียนค่า default ออกมาก่อน แล้วค่อยสลับปุ่มที่กด

### เหตุผลการออกแบบ (Phase 5A)
- **Track ที่ lock ขวาง (A1)**: เลือกแบบ "หยุดที่ track สุดท้ายที่ใช้ได้" และหยุด **ทั้งกลุ่มของประเภทนั้น** เท่ากัน — กลุ่มไม่ลง / ไม่กระโดดข้าม track ที่ lock และคลิปหลายตัวไม่ไปกองบน track เดียวกัน (ถ้าหยุดทีละคลิป คลิปจาก V1 กับ V2 อาจไปลง track เดียวกันแล้วทับกัน). ภาพกับเสียงหยุดแยกกัน
- **สลับลำดับ / ลบ track (A4)**: เลือกแบบ **เปลี่ยนเลข id ตามตำแหน่ง** (V1 = ล่างสุดเสมอ แบบ Premiere) แล้ว remap ทุกที่ (`ed.renumberTracks` / `remapTrackIds`): `clip.track`, `seq.transitions[].track`, พารามิเตอร์ effect ชนิด `trackSel` (Track Matte Key, Set Matte — ทั้งค่าและ keyframe) — แทนการเก็บ id เดิมแล้วเพิ่มชื่อแสดงผล เพราะโค้ดหลายส่วนถือว่าเลขใน id = ตำแหน่ง: interchange (EDL/FCPXML/XML เรียง track ตามเลข), multicam (ลำดับกล้อง = เรียง id), placeMedia / legacy target (เรียง id), main track ของ Canvas Fill. ส่วน name / mute / solo / lock / sync / target / ความสูง เป็น field ของ object track จึงย้ายไปกับ track เอง. ที่อื่นที่ตรวจแล้วไม่ต้อง remap: nested sequence / multicam source (track เป็นของ sequence ลูกเอง), caption track (`kind` แยก), ducking (ใช้ tag ของคลิป), Track Volume (อยู่บน object track), interchange (อ่านจาก id ตอน export). Effect ที่ชี้ track ที่ถูกลบจะกลายเป็น None
- **Rearrange**: ปิดช่องว่างบน track ต้นทางและ track ที่ sync lock เปิด เฉพาะ track ที่ไม่มีคลิปอื่นคร่อมช่องนั้น (กันคลิปซ้อน) ทำให้ title ที่อยู่เหนือคลิปเลื่อนตามคลิปของมัน
- เก็บทุกอย่างผ่าน `edit()` / `commitSeq()` (undo ได้, ความสูงตอนลากเป็น 1 step). field ใหม่ทั้งหมด optional: `track.name`, `track.h` (ไม่มี = 36 px), `track.target` (ไม่มี = พฤติกรรมเดิม)

### ข้อจำกัด (Phase 5A)
- Mute ของ video track ไม่มีผลกับ compositor (เหมือนเดิม) จึงไม่ใส่ "Toggle Track Output" ในเมนู
- Source patching แยก (ต้นทาง V1 → ปลายทาง Vn แบบสองคอลัมน์ของ Premiere) รวมเป็นปุ่ม target ชุดเดียว: Insert/Overwrite ใช้ track แรกที่ target ของแต่ละประเภท
- Insert line ของ Rearrange แสดงจุดวางบน timeline เดิม (ผลจริงที่หักช่องว่างแล้วเห็นได้จากคลิปที่ขยับให้ดูสด ๆ ระหว่างลาก)

### การทดสอบ (Phase 5A)
- `scripts/test_tracks.mjs` (54): linked / หลายคลิป / group / caption ข้าม track, สร้าง track ใหม่, track ที่ lock, overwrite หลายคลิป, transition, nudge, insert / rearrange / duplicate, remap id ตอนสลับลำดับ / ลบ / เพิ่ม track (รวม Track Matte keyframe), Delete Empty Tracks, targeting + โปรเจกต์เก่า
- `scripts/e2e/phase5.cjs` (36): สลับ V1/V2 (เมนูและลากหัว track) แล้ว export ตรวจ pixel ว่าเลเยอร์บนเปลี่ยน, Track Matte ยังชี้ถูกหลังสลับ / ลบ track, ลากวิดีโอที่ link กับเสียงด้วยเมาส์จริงไป V2/A2 แล้วตรวจเสียงและภาพยังตรงเวลา, Ctrl / Ctrl+Alt / Alt drag + 1 undo step, Ctrl drop จาก Project panel, Alt+ลูกศร, targeting (Overwrite / Paste / Add Edit), Rename / ความสูง / save-open, เปิด `.esproj` เก่าได้ผลเหมือนเดิม

### Phase B — การแสดงผลบน Timeline — ✅

| # | ข้อ | สถานะ | หมายเหตุ |
|---|-----|-------|---------|
| B1 | Thumbnail บนคลิปวิดีโอ | ✅ | View > Video Thumbnails: None / Head / Head and Tail / Continuous (ค่าเริ่มต้น Head, จำไว้ในเครื่องแบบ preference ไม่ใช่ใน project). `src/Services/thumbs.js`: ถอดเฟรมด้วย FFmpeg ใน main process (input seeking, รวม 8 เฟรมต่อการเรียก 1 ครั้ง, ทำพร้อมกัน 2 งาน) จากไฟล์เดียวกับที่ Preview เล่น (`playPath`), LRU cache 1500 ภาพ key = media + rev + เฟรม + ขนาด (ขนาดปัดเป็น 36/72/144/288 px). เฟรมของแต่ละช่องคำนวณด้วย `sourceAt` (speed / reverse / time remap / frame hold) — `thumbSlots()`. Image = ภาพนั้น, synthetic media วาดจาก canvas ของตัวเอง, nested sequence / MOGRT / graphic แสดง icon (🎬 ✦ T), adjustment layer ไม่แสดง. Continuous จำกัด 120 ช่องต่อคลิป (ซูมมากช่องจะกว้างขึ้น) |
| B2 | เส้น Volume / Opacity (rubber band) | ✅ | คลิกขวาที่คลิป > Show Clip Keyframes: Volume › Level (เสียง), Opacity, Motion › Position X / Position Y / Scale / Rotation, และ slider ทุกตัวของ effect บนคลิป (`src/Core/clipBands.js`). ลากเส้นเมื่อไม่มี keyframe = ทั้งคลิป, มี keyframe = สอง key ของช่วงนั้น, Ctrl+คลิก = เพิ่ม key, Alt+คลิก = ลบ, ลาก key ได้ทั้งเวลาและค่า (convention เดียวกับเส้น speed). อ่าน/เขียน `clip.opacity` / `clip.volume` / `clip.motion` / `effect.params` ตัวเดียวกับ Effect Controls และ `evalParam` → Preview = Export. การลาก 1 ครั้ง = 1 undo step. สเกลเส้นเสียง: แอมพลิจูด 0 (−∞) ถึง 2 (+6 dB), ครึ่งเส้น = 0 dB แบบ Premiere |

#### ข้อจำกัด (Phase 5B)
- Continuous สร้างภาพครบทั้งคลิป (ไม่ได้ถอดเฉพาะช่วงที่เห็นบนจอ) คลิปยาวมากจึงใช้เวลาโหลดช่วงแรก; cache อยู่ในหน่วยความจำ (เปิดโปรแกรมใหม่ต้องถอดใหม่)
- Thumbnail ของ nested sequence / MOGRT / graphic เป็น icon (ต้อง render ทั้ง sequence ย่อยด้วย compositor ซึ่งหนักเกินสำหรับ timeline)
- เส้น Position แสดงทีละแกน (X หรือ Y) และ effect แสดงได้เฉพาะพารามิเตอร์ที่เป็น slider

#### การทดสอบ (Phase 5B)
- `scripts/test_clipview.mjs` (26): thumbSlots ทุกโหมด + speed / reverse / frame hold / time remap / จำนวนช่องสูงสุด, การแปลงค่า↔ความสูงเส้น, ลากเส้น / เพิ่ม / ลบ / ลาก key, Position X, effect param, volume dB
- `scripts/e2e/phase5.cjs` เพิ่ม 17 ข้อ: thumbnail จาก FFmpeg ตรงกับสีของเฟรมจริง (head/tail, reverse, speed 200 %, continuous แดง→เขียว→น้ำเงิน, frame hold, ภาพนิ่ง, icon ของ nested), ลากเส้น Opacity ด้วยเมาส์ → export = preview = ค่าบนเส้น, Ctrl+คลิก / ลาก key / Alt+คลิก แล้ว export ตรงกับ `evalParam`, ลากเส้น Volume ลง −6 dB แล้ว mix ที่ export เบาลง 6 dB, เมนู Show Clip Keyframes

### Phase C1 — effect ที่เคยเป็น `status: 'approx'` — ✅ (ไม่เหลือ approx ทั้งวิดีโอและเสียง)

effect วิดีโอ 21 ตัวเขียนใหม่ใน `src/Renderers/fx/premiereFx.js` (ตารางเดิม `videoEffects.js` ชี้มาที่นี่), compositor รองรับเพิ่ม: `layer` (เลือก video track อื่นเป็น input — `u_layer`, ป้องกันสอง layer ชี้กันเองวนไม่จบ), `src` (input เดิมอ่านได้ทุก pass), `fns` (ฟังก์ชัน GLSL), `custom` (Equalize / Paint Bucket ที่ต้องมี histogram / flood fill). id ของพารามิเตอร์เดิมเก็บไว้เมื่อความหมายเดิม (โปรเจกต์เก่าเปิดได้และได้ค่าเดิม: Lighting `light/intensity/radius/ambient`, ลำดับ Operator ของ Arithmetic 4 ตัวแรก, Edge Type Roughen/Rusty ฯลฯ)

| effect | ของเดิม (≈) | ตอนนี้ (ตาม Premiere / After Effects) |
|--------|-----------|------------------------------------|
| Lighting Effects | วงสว่างวงเดียว | ไฟ 5 ดวง (None / Directional / Omni / Spotlight, สี, ตำแหน่ง, Major/Minor Radius, Angle, Focus), Ambience สี+ความแรง, Surface Gloss / Material, Exposure, Bump Layer (R/G/B/A, Bump Height, White is High) |
| Compound Blur | blur ตามความสว่างของตัวเอง | Blur Layer (track อื่น, None = ตัวเองแบบ AE), Maximum Blur, Invert Blur — 2 pass แยกแกน อ่าน map จาก layer เดิมทั้งสอง pass |
| Arithmetic | 4 operator | 13 operator ของ AE (And/Or/Xor/Add/Subtract/Difference/Min/Max/Block Above/Block Below/Slice/Multiply/Screen) คำนวณแบบ 8-bit integer + Clip Result Values (ปิด = wrap) |
| Blend | ผสมกับ grayscale ของตัวเอง | Blend With Layer, Mode: Crossfade / Color Only / Tint Only / Darken Only / Lighten Only, Blend With Original |
| Calculations | เลือก channel | Input Channel + Invert, Second Layer + Channel + Opacity + Invert, Blending Mode 13 แบบ, Preserve Transparency |
| Equalize | เส้นโค้ง smoothstep | histogram จริง 256 ระดับ (สุ่ม 64×36 จุดต่อเฟรม → CDF) — RGB / Brightness / Photoshop Style, Amount |
| Turbulent Displace | noise ชั้นเดียว | fractal noise (Complexity), Displacement 9 แบบ (Turbulent, Bulge, Twist, …Smoother, Vertical, Horizontal, Cross), Size, Offset, Evolution, Pinning |
| Lightning | เส้นเดียว | Segments, Amplitude, Detail Level / Amplitude, Branching (สูงสุด 6 กิ่ง) / Angle / Seg. Length / Width, Speed, Fixed Endpoint, Width / Variation / Core Width, Outside / Inside Color, Random Seed, Blending Mode |
| Paint Bucket | แทนสีที่ใกล้ Target Color ทั้งภาพ | flood fill จริงจาก Fill Point (เฉพาะบริเวณที่ต่อกัน, `fx/floodFill.js` บน CPU จากเฟรมที่อ่านกลับจาก GPU), Fill Selector 5 แบบ, Tolerance 0–255, View Threshold, Stroke (Antialias / Feather / Spread / Choke), Invert Fill, Blending Mode (รวม Behind Original / Fill Only) |
| VR Chromatic Aberrations / Color Gradients / De-Noise / Glow / Plane to Sphere | ทำบนภาพแบน | คำนวณบนทรงกลม equirectangular: sample วนรอบขอบซ้าย-ขวา, รัศมีแนวนอนปรับตาม latitude, Frame Layout (Monoscopic / Over-Under / Side by Side). CA แยก R/G/B + Center + Falloff; Gradients 4 จุดบนทรงกลม + Blending Mode; De-Noise เป็น bilateral; Glow แยก 2 pass + Saturation/Tint; Plane to Sphere ฉายภาพแบนลงทรงกลมจริง (ของเดิมกลับด้าน) + Pan/Tilt/Roll/Feather |
| Difference Matte | เทียบกับสีเดียว | Difference Layer, View (Final Output / Source Only / Matte Only), Matching Tolerance / Softness, Blur Before Difference |
| Bevel Alpha | ต่างค่า alpha 2 จุด | ramp ของ alpha (blur 2 pass, นอกเฟรม = โปร่งใส) → normal → แสง (Light Angle / Color / Intensity) |
| Bevel Edges | ต่างความสว่าง | มุมเอียงที่ขอบสี่เหลี่ยมของ layer (Edge Thickness เป็นสัดส่วน), Light Angle / Color / Intensity |
| Radial Shadow | เงาเลื่อน | เงาฉายออกจาก Light Source (ขยายตาม Projection Distance), Softness, Render Regular / Glass Edge + Color Influence, Shadow Only |
| Brush Strokes | เลื่อน pixel สุ่ม | ฝีแปรงจริง (แคปซูลตามมุม/ความยาว/ขนาด, สีจากจุดกลางฝีแปรง), Stroke Density / Randomness, Paint Surface 4 แบบ, Blend With Original |
| Roughen Edges | เลื่อน alpha | ระยะจากขอบ (Border) + fractal noise, Edge Type 7 แบบ (Roughen / Rusty / …Color / Cut / Photocopy), Edge Color, Edge Sharpness, Fractal Influence, Scale, Stretch, Offset, Complexity, Evolution |
| Texturize | noise | Texture Layer (track อื่น), Light Direction, Texture Contrast — None = ไม่เปลี่ยนภาพ (เหมือน Premiere) |

เสียง:
- **FFT Filter**: ออกแบบ magnitude บน bin ของ FFT (Pass Band / Reject Band ระหว่างสองความถี่, ขอบชัน) แล้วแปลงเป็น impulse response แบบ minimum-phase ด้วย cepstrum (`src/Services/fir.js`) เล่นผ่าน ConvolverNode → ตัดนอกย่าน ≤ −40 dB ห่างแค่ 1/3 octave (ของเดิม biquad 2 ตัว −12 dB/octave) และแทบไม่มี delay. FFT Size 1024–8192
- **Pitch and Time / Pitch Shifter**: phase vocoder ใน worklet (`pv-pitch`, STFT overlap 4 เท่า, peak-locked shifting แบบ Laroche–Dolson ทำให้ partial คงรูปและระดับเสียง), Precision Low/Medium/High (FFT 1024/2048/4096), Formant Preserve (spectral envelope จาก cepstrum คงตำแหน่ง formant). ตัว granular เดิมลบออก (Voice Changer ใช้ตัวใหม่ด้วย)
- **ชดเชย latency ตอน export**: effect ที่มี latency (`latency()` ใน AUDIO_FX: pitch, DeNoise/DeReverb, Click Remover, Voice Changer ที่ pitch) ให้ `renderAudioMix` เริ่มคลิปนั้นเร็วขึ้นเท่า latency + ป้อนเสียงก่อน/หลังช่วงที่ render (pre-roll ที่ตัดทิ้ง) → เสียงที่ export ตรงเวลาเป๊ะ (ของเดิม DeNoise ช้า 21 ms และช่วงแรกของทุกช่วงที่ render เงียบ)

#### ข้อจำกัด (Phase C1)
- effect ที่ใช้ layer อ่านภาพของ track นั้นหลัง Motion/effect ของคลิปบน track (เหมือน Track Matte) ไม่ใช่ source ดิบ และเพราะภาพทุก track ขนาดเท่า sequence ตัวเลือก "If Layer Sizes Differ / Stretch to Fit / Texture Placement" ของ Premiere จึงไม่มี (ไม่ต่างกัน)
- รูปแบบ noise / ฟ้าผ่า / ฝีแปรงเป็นของเราเอง (ทำงานแบบเดียวกันและพารามิเตอร์เดียวกัน แต่ pixel ไม่ตรงกับ Adobe ทุกจุด — Adobe ไม่เปิดเผย algorithm)
- Paint Bucket อ่านเฟรมกลับจาก GPU ทุกเฟรม (readPixels) — ช้ากว่า effect อื่นที่ความละเอียดสูง
- Preview เสียงยังมี latency ของ worklet (pitch 21–85 ms ตาม Precision) เพราะเล่นผ่าน media element ซึ่งเลื่อนล่วงหน้าไม่ได้ แต่อยู่ในช่วง sync ที่ playback ยอมอยู่แล้ว (±250 ms); export ชดเชยแล้ว
- Pitch and Time ใน clip effect เปลี่ยน pitch อย่างเดียว — การยืด/หดเวลาใช้ Clip > Speed/Duration + Maintain Audio Pitch (WSOLA เดิม) แบบ Premiere
- FFT Filter ใช้ 2 ความถี่ + โหมด แทนการวาดเส้นโค้งหลายจุด

#### การทดสอบ (Phase C1)
- `scripts/test_effects.mjs` (26): flood fill ทุก Fill Selector + tolerance + การต่อกันของพื้นที่, response ของ FFT Filter (pass 0 dB / stop ≤ −40 dB / minimum phase), phase vocoder รันใน vm (±12 / −5 / +7 semitone ทั้ง sine เดี่ยวและสองความถี่, ระดับเสียงคงที่, Formant Preserve), ตารางไม่มี approx เหลือ, id ไม่ชนคำสงวน GLSL, id เดิมยังอยู่
- `scripts/e2e/phase5c.cjs` (31): ทั้ง 21 effect compile/render ในแอปจริง, Equalize ยืด ramp 64–128 เต็มช่วง, Paint Bucket เติมเฉพาะกล่องที่ต่อกัน / Invert / opacity, Blend Darken/Lighten/Crossfade + Calculations Multiply กับ V1, ไม่มี layer = ไม่เปลี่ยน, Compound Blur ตาม layer, Difference Matte, Blend สอง layer ชี้กันไม่ค้าง, Arithmetic Xor/Slice/wrap, Lightning, Lighting, Bevel Edges/Alpha, Plane to Sphere, Radial Shadow, Turbulent Displace, Roughen Edges, Equalize export = preview, FFT Filter Reject/Pass Band กับเสียง 200 Hz + 5 kHz, Pitch ±12 semitone ใน export (880 / 220 Hz ระดับเสียงคงที่)

### Phase C2 — AAF exporter — ✅ (เสียงฝังในไฟล์ สำหรับ DAW)

File > Export > **AAF (Embedded Audio)...** (`file.exportAAF`) เขียน AAF ด้วย JS ล้วน ไม่มี dependency ตอนรัน:
- `src/Services/interchange/cfb.js` — Microsoft Compound File (MS-CFB v4: sector 4096, mini stream, mini FAT, DIFAT สำหรับไฟล์ > 457 MB, directory เป็น red-black tree ตามลำดับชื่อของ spec) + ตัวอ่าน (ใช้ในเทสต์)
- `src/Services/interchange/aaf.js` — object model ของ AAF (structured storage: property stream, strong ref / vector / set index, weak ref + "referenced properties") — `buildAAF(spec)`
- `src/Services/interchange/aafTemplate.js` — meta-dictionary + dictionary มาตรฐาน (class/type/data/codec/container definitions) สร้างจากไฟล์เปล่าของ pyaaf2 ด้วย `scripts/aaf/make_template.py`
- `src/Services/interchange/aafExport.js` — ดึงเสียงจาก sequence แล้วประกอบไฟล์

โครงสร้างแบบ "breakout to mono" ของ Premiere: CompositionMob (Top Level) มี 1 slot ต่อ channel (A1 L, A1 R, A2 L, ...) เป็น Sequence ของ Filler/SourceClip → MasterMob → SourceMob (PCMDescriptor 48 kHz / 24-bit / mono) + EssenceData (PCM ฝังในไฟล์) และ Timecode slot ตาม fps ของ sequence
- คลิปปกติ: FFmpeg (main process) ตัด source พร้อม handle 1 วินาทีหัว/ท้าย (DAW ยืดคลิปได้) — StartTime ของคลิปชี้ตำแหน่งจริงใน media
- คลิปที่ retime (Speed, Reverse, Time Remapping, Time Warp): ฝังเสียงที่ render แล้ว ตัวเดียวกับที่ Preview เล่น (`retimedAudio`)
- มี progress + Cancel (หน้าต่าง Rendering เดิม; Cancel kill FFmpeg ที่กำลังทำงาน ไม่เขียนไฟล์)

#### ข้อจำกัด (Phase C2)
- ตรวจความถูกต้องด้วย **pyaaf2** (อ่านกลับ, เปิดแบบ read-write แล้ว save ซ้ำได้, essence ตรง byte, ความยาว sequence = ผลรวม component, คลิปอยู่ใน media) และตัวอ่าน CFB ของเราเอง — **ยังไม่ได้ทดสอบเปิดใน Pro Tools / DaVinci Resolve / Nuendo จริง** (ไม่มีโปรแกรมในเครื่องทดสอบ) ควรลองกับ DAW ปลายทางก่อนใช้งานจริง
- ส่งเฉพาะ audio track; ไม่มี video reference, volume/pan keyframe, clip gain, audio effect และ crossfade (คลิปตัดที่จุดตัด — DAW ทำ fade ต่อเองได้จาก handle)
- ทุก track เป็น L/R สอง mono track เสมอ (ไฟล์ mono ซ้ำทั้งสองข้าง, 5.1 ถูก downmix เป็น stereo)
- ไฟล์ทั้งหมดอยู่ในหน่วยความจำก่อนเขียน (sequence เสียงยาวหลายชั่วโมงใช้ RAM ประมาณขนาดไฟล์)
- OMF ไม่ทำ

#### การทดสอบ (Phase C2)
- `scripts/test_aaf.mjs` (27): ลำดับชื่อ CFB, mini/big stream + storage ซ้อนอ่านกลับตรง, directory เป็น red-black tree ที่ถูกต้อง, ชื่อซ้ำถูกปฏิเสธ, root/Header/Dictionary/ContentStorage, set index ของ mob = mob id, class ของ mob, Top Level usage, slot + Filler + handle offset ตามลำดับเวลา, คลิปซ้อนถูกตัด, edit rate 48000 + physical track number, essence ตรง byte, PCMDescriptor, weak ref ชี้ data definition ที่มีใน dictionary, การเลือกคลิป (ข้ามคลิปไม่มีเสียง / offline / disabled / ภาพนิ่ง); ถ้าตั้ง `AAF_PYTHON` (Python ที่มี pyaaf2) จะอ่านกลับด้วย pyaaf2 อีกชั้น (`scripts/aaf/verify_aaf.py`)
- ทดสอบด้วยมือเพิ่ม: ไฟล์ 526 MB (ใช้ DIFAT) pyaaf2 อ่าน essence ครบ
- `scripts/e2e/phase5c.cjs` (+6 → 38): export จากแอปจริงผ่านคำสั่งเมนู — คลิปปกติได้ source 0–2 s (handle) 440 Hz, คลิป speed 2× ได้เสียง render 1 s 880 Hz, slot A1 L/R + A2 L/R + TC, Cancel ไม่เขียนไฟล์; ไฟล์จาก e2e ผ่าน `verify_aaf.py` ด้วย

### Phase C3 — ใช้ FFmpeg แบบ LGPL ได้ — ✅

- `electron/ffmpegBin.js` เลือก binary ตามลำดับ Preferences > FFmpeg (`userData/ffmpeg.json`) → env `EDITORSTAGE_FFMPEG` → build config `ffmpeg.json` (ใน `resources` ของแอปที่ build แล้ว หรือ root ของโปรเจกต์ตอน dev) → `ffmpeg-static` เดิม; `media.js` / `workflow.js` ใช้ตัวเดียวกันทั้งหมด
- ตรวจ license / ความสามารถจาก binary จริง: `-version` (`--enable-gpl`) + `-encoders` (cache ต่อ path) — IPC `ffmpeg:info`, `ffmpeg:setPath` (ตรวจว่าเป็น FFmpeg ก่อนบันทึก)
- feature ที่ใช้ GPL encoder (libx264 / libx265) และตัวแทนเมื่อ binary ไม่มี (`softwareVideo()` ใน exporter — ทดลอง encode สั้น ๆ ก่อนเลือก, cache ต่อ binary):
  - Export H.264 / platform presets / Render In to Out / Create Proxies H.264 → hardware (NVENC / Quick Sync / AMF) → Media Foundation → OpenH264 → VideoToolbox
  - Export HEVC / HEVC Main10 → hardware → `hevc_mf` → VideoToolbox
  - Import conversion (main process) → OpenH264 → `h264_mf` → VP9 WebM (ลองตัวถัดไปเมื่อ encoder ที่มีอยู่ใช้ไม่ได้จริง)
  - ไม่มีตัวไหนใช้ได้ → Export dialog แสดงเหตุผล (export ไม่เริ่ม) แทนการ error กลางทาง
- Preferences > FFmpeg: path + เวอร์ชัน + ที่มา + GPL/LGPL + ตาราง feature → encoder ที่จะใช้จริง, ปุ่ม Choose FFmpeg… / Use Default
- Export dialog: "Software Encoding → <ตัวแทน>" และหมายเหตุใต้ Format; หมายเหตุของ export บอก encoder ที่ใช้
- เอกสาร: `THIRD_PARTY_LICENSES.md` หัวข้อ *Using an LGPL FFmpeg* (วิธีใส่ใน installer ผ่าน `extraResources` + `ffmpeg.json`, ตาราง feature, ข้อควรระวังเรื่อง patent ของ OpenH264)

#### ข้อจำกัด (Phase C3)
- ตัวแทนคุมคุณภาพด้วย bitrate (ไม่มี CRF) — ไฟล์ใหญ่/เล็กกว่า x264 CRF 18 ได้ตามเนื้อหา
- ไม่ได้ทดสอบกับ LGPL build จริง (ไม่มีในเครื่อง, ทำงาน offline) — ทดสอบโดยให้ build ที่ bundle มารายงานว่าไม่มี libx264/libx265 ซึ่งเป็นทางเดียวกับที่โค้ดตัดสินใจ; `libopenh264` / VideoToolbox ไม่มีใน binary ทดสอบจึงไม่ได้ encode จริง
- Smart Render (copy stream) ไม่เกี่ยวกับ encoder จึงไม่เปลี่ยน

#### การทดสอบ (Phase C3)
- `scripts/e2e/phase5c3.cjs` (14): อ่าน version / GPL / encoder list, ซ่อน x264/x265 แล้ว — H.264 และ HEVC export ได้ codec ถูกต้องและไม่มี signature ของ x264/x265 ในไฟล์ + หมายเหตุบอก encoder, ProRes ไม่เปลี่ยน, preset Render In to Out ได้ตัวแทน, แปลงไฟล์ mpeg4 AVI ตอน import, Create Proxies H.264, Preferences: path ผิดถูกปฏิเสธ / path ถูกบันทึกและใช้ / หน้าต่างแสดงข้อมูลครบ / Use Default กลับไปตัวที่ bundle

---

## Phase 6 — แก้รอบ 2 (`docs/PROMPT_FIX_ROUND2.md`) — ลำดับ A → B → C → E → D

### Phase 6A — บั๊กพื้นฐาน — ✅ (`scripts/e2e/phase6a.cjs` 29/29)
- Unlink ไม่แตะ `noAudio` แล้ว (เสียงไม่ดับ / ไม่ซ้ำ) + Health Check ตรวจ "เสียงซ้อนสองชั้น"
- ถาม Save / Don't Save / Cancel ก่อน New / Open / Open Recent / Close Project / Revert / ปิดหน้าต่าง (มี timeout 2 วินาทีกันค้าง)
- เปิดไฟล์ `.esproj` จาก Explorer ได้ (single instance: เปิดซ้ำจะส่งไฟล์ไปหน้าต่างเดิม)
- Track ที่ล็อกไม่ถูกแก้/เลือกจากคำสั่งใดๆ
- Duplicate (Ctrl+Shift+/) ทำบน Timeline: วางสำเนาต่อท้ายคลิปเดิม (เหมือน Alt+ลาก) ไม่ได้ทำสำเนาใน Project panel
- Shift + ตัวเลข/สัญลักษณ์ ใช้ปุ่มจริง (code) ไม่ขึ้นกับ layout แป้นพิมพ์ไทย
- Nest: ถามชื่อ, video nest อยู่ track บนสุดของที่เลือก + audio nest ที่ link กัน; Reverse ไม่ให้ใช้กับ nest
- Enable/Disable ใช้สถานะเดียวกับทั้ง selection; I/O/Mark Clip ทำงานกับ monitor ที่ active (กรอบสีน้ำเงิน)

### Phase 6B — Link / เมนูคลิกขวา / ลากคลิป — ✅ (`scripts/e2e/phase6b.cjs` 29/29)
- Link (Ctrl+L สลับ Link/Unlink), ป้ายแดงบอกจำนวนเฟรมที่เลื่อนหลุด sync
- **ลากคลิปที่ link กัน (กฎ B6):** เปลี่ยน track เฉพาะชนิดที่จับลาก (ภาพไป track ภาพ เสียงอยู่ track เดิม) แต่เวลาเลื่อนไปด้วยกันเสมอ; Alt+คลิก = เลือกส่วนเดียว; **Nudge (ลูกศร)** เลื่อน track เฉพาะชนิดเดียว เรียงลำดับ ภาพ > caption > เสียง
- เมนูคลิกขวาคลิป/transition/ช่องว่าง/พื้นที่ว่างแบบ Premiere (Edit Original, Reveal in Project/Explorer, Properties, Replace With…, Label 8 สี, Select Label Group, Time Interpolation, Scale/Set to Frame Size, Ripple Delete ช่องว่าง, Set Transition Duration, Clear)
- ดับเบิลคลิก: nest เปิด sequence ข้างใน, graphic → Essential Graphics, caption → Text, คลิปสื่อ → Source Monitor เฟรมเดียวกัน
- **ตัด Merge Clips ออก**: ของเดิมแค่จับคลิปภาพ+เสียงมา link กัน (ซ้ำกับ Link) และไม่ได้ sync ตาม timecode/เสียงแบบ Premiere จริง จึงเอาออกเพื่อไม่ให้ผู้ใช้เข้าใจผิด — ใช้ Link (Ctrl+L) หรือ Synchronize แทน

### Phase 6C — ฟีเจอร์ระดับ Premiere — ✅ (`scripts/e2e/phase6c.cjs` 41/41)
- **C1 Markers:** marker ของ sequence / คลิป (เวลา source) / Source Monitor, 8 สี, ชนิด Comment/Chapter/Segmentation/Web Link, ช่วงเวลา (duration), ลากบน ruler (snap), ดับเบิลคลิกเปิด Marker dialog, Markers panel ค้นหา+แก้ inline; export ลง FCPXML (chapter-marker), Premiere XML, EDL (`* LOC:`), chapters
- **C2:** Q / W (ripple trim ถึง playhead), Alt+Q / Alt+W (trim ไม่ ripple), E (extend edit), D (เลือกคลิปที่ playhead), 1–9 (เลือกกล้อง multicam)
- **C3 Keyboard Shortcuts:** แก้ปุ่มลัดได้ทุกคำสั่ง (อัดปุ่ม, เตือนชน, ลบ, Reset, Import/Export `.eskeys`) เก็บใน `userData/keymap.json`; เมนูแสดงปุ่มที่ตั้งจริง
- **C4:** Paste Attributes (เลือกทีละรายการ + Scale Attribute Times) และ Remove Attributes / Remove Effects
- **C5 Audio Mixer:** meter ต่อ track + Master, fader (ดับเบิลคลิก = 0 dB), pan, Master volume; Audio Clip Mixer สำหรับคลิป; pan/master มีผลทั้ง playback, export, และใน nest
- **C6 Sequence Settings / New Sequence:** ขนาด (+ preset, สลับแนวตั้ง/นอน, ภาพตัวอย่าง), frame rate (เปลี่ยนแล้วจัดคลิป/marker/keyframe/transition ลงเฟรมใหม่ เป็น undo ขั้นเดียว), Pixel Aspect Ratio (export ใส่ `setsar`), Audio Sample Rate 44.1/48 kHz (export ใช้จริง); New Sequence (Ctrl+N) เปิด dialog ตั้งชื่อ/ขนาด/fps/จำนวน track
- **C7 Preferences** (`userData/prefs.json`, `src/Core/prefs.js`): ความยาวภาพนิ่ง, ความยาว transition ภาพ/เสียง, Auto Save (ทุกกี่นาที + เก็บกี่เวอร์ชัน — ลบ auto-save เก่า ไม่ลบที่ save เอง), Timeline auto-scroll (No/Page/Smooth), จำนวน track เริ่มต้น, อุปกรณ์เสียงออก, Pre-roll/Post-roll (Play Around = Shift+K), History States, ความสว่าง UI 3 ระดับ, ปุ่ม Reset Preferences
- **C8 Project panel:** List view คอลัมน์ Label/Name/Media Duration/Frame Rate/In/Out/Frame Size คลิกหัวเพื่อเรียง ▲▼; Icon view thumbnail ปรับขนาดได้ + hover scrub; เมนู Rename / Duplicate / Reveal in Explorer / Properties / Label; Metadata panel แก้ชื่อ / label / comment / description ของ item ที่เลือก
- **C9 History panel:** ไอคอนตามชนิดขั้นตอน, Delete (ถามยืนยัน — ลบขั้นที่เลือกและหลังจากนั้น, redo ไม่ได้), จำกัดจำนวนขั้นตาม Preferences

#### ข้อจำกัด (Phase 6C)
- Audio output device ใช้ `AudioContext.setSinkId` (Chromium/Electron ปัจจุบันรองรับ) — export ไม่ขึ้นกับอุปกรณ์นี้
- Pixel Aspect Ratio มีผลตอนส่งออก (ใส่ SAR ในไฟล์) ส่วนจอ Program แสดงเป็นพิกเซลสี่เหลี่ยม; ถ้า PAR ไม่ใช่ 1:1 จะไม่ใช้ Smart Render
- Hover scrub ใน Icon view ใช้ thumbnail ที่ decode ด้วย FFmpeg (ละเอียด 24 ตำแหน่งต่อคลิป) ไม่ใช่ทุกเฟรม

#### การทดสอบ (Phase 6C)
`npx electron scripts/e2e/phase6c.cjs` — 41 รายการ (อยู่ใน `npm run test:e2e`)

### Phase 6E — คลังเอฟเฟกต์ / Presets / Effects panel — ✅ (`scripts/e2e/phase6e.cjs` 19/19)
- **E2/E3 Video Effects + Transitions:** เพิ่มเอฟเฟกต์ภาพ 126 ตัว (`src/Renderers/fx/moreVideoFx*.js`) และ transition 130 ตัว (`moreTransitions.js`) เขียน GLSL เองทั้งหมด
  - โฟลเดอร์ที่ Premiere มีแต่เราขาด: Video (Clip Name, Simple Text, Timecode, SDR Conform), Transition (Block Dissolve, Gradient / Linear / Radial Wipe, Venetian Blinds), Obsolete (Fast Color Corrector, Three-Way, RGB Curves, Luma Curve ฯลฯ), Immersive Video, Rolling Shutter Repair
  - หมวดใหม่: Glitch, Light & Glow, Retro & Film, Artistic, Blur & Sharpen, Motion, Color Correction, Stylize, Keying
  - transition ใหม่ทุกตัวมีพารามิเตอร์ปรับได้ใน Effect Controls (ทิศทาง, ความนุ่มขอบ, สี, จุดกลาง)
- **Audio:** เพิ่มเอฟเฟกต์เสียง 56 ตัว (`src/Services/moreAudioFx.js` สร้างจาก Web Audio node) และ crossfade 9 แบบ (Logarithmic, S-Curve, Sine, Dip to Silence ฯลฯ); สุ่มแบบมี seed เพื่อให้ Preview = Export
- **E4 Presets** (`src/Core/presets.js`, ของในตัวอยู่ที่ `src/presets/`): 483 พรีเซ็ต
  - PiP 35, Motion 42 (Zoom, Pop, Spin, Slide, Ken Burns, Fades, Blend), Effect Ins & Outs 32, Stylize 95, เสียง 60, transition 51
  - **Lumetri Looks 168 แบบ** (56 look × Subtle / Medium / Strong) ใช้ค่า Lumetri ล้วน ไม่มีไฟล์ LUT
  - ชนิด Anchor to In Point / Anchor to Out Point / Scale แบบ Premiere; ใช้พรีเซ็ต = undo ขั้นเดียว, ข้าม track ที่ล็อก
  - **Save Preset** (ปุ่ม 💾 ที่หัวเอฟเฟกต์ใน Effect Controls): เลือกเอฟเฟกต์ + Motion / Opacity / Lumetri, ชนิด, คำอธิบาย → `userData/presets/*.json` (โฟลเดอร์ My Presets)
  - Import / Export `.espreset`; Import `.prfpset` ของ Premiere แบบ best effort (ดูข้อจำกัด)
- **E5 Effects panel:** ค้นหาทุกคำในชื่อ / โฟลเดอร์ / แท็ก / คำอธิบาย, ★ Favorites, Recently Used, ป้าย New / GPU, เอาเมาส์ชี้ค้าง = การ์ดตัวอย่างเคลื่อนไหว (เอฟเฟกต์ / transition / look) วาดด้วย Compositor แยกของตัวเอง; ลากหรือดับเบิลคลิกเพื่อใช้, คลิกขวาพรีเซ็ตของผู้ใช้ = ลบ
- **E6 License:** ทุกเอฟเฟกต์ / transition / พรีเซ็ตเป็นของเราเอง (source `own`) บันทึกใน `src/Core/fxLicenses.js`; `scripts/test_effect_licenses.mjs` (อยู่ใน `npm test`) ตรวจ license allowlist, ชื่อที่เลียนเครื่องหมายการค้า และโค้ดจากแหล่งต้องห้าม; เปลี่ยนชื่อ Polaroid → Instant Photo, Technicolor → Dye Transfer Color, Game Boy → Pocket Console

#### ข้อจำกัด (Phase 6E)
- `.prfpset` ของ Premiere: อ่านได้เฉพาะชื่อเอฟเฟกต์ที่เรามีตรงกัน ค่าพารามิเตอร์ Premiere เก็บเป็น binary ของตัวเอง จึงได้ค่าเริ่มต้น
- เอฟเฟกต์ที่ทำงานบน CPU (Paint Bucket, Remove Background ฯลฯ) ไม่มีภาพตัวอย่างตอน hover; พรีเซ็ตที่มีแต่ Motion / Opacity แสดงเป็นข้อความ
- DeEsser และ Noise Gate สร้างจาก DynamicsCompressor ของ Web Audio (ไม่มี sidechain จริง) จึงลดเสียงน้อยกว่าปลั๊กอินเฉพาะทาง

#### การทดสอบ (Phase 6E)
`npx electron scripts/e2e/phase6e.cjs` — 19 รายการ: transition ทุกตัว compile + p=0 → A, p=1 → B; เอฟเฟกต์ภาพใหม่ทุกตัว compile/render; เอฟเฟกต์เสียงทุกตัว render ไม่มี NaN และไม่เงียบ; จำนวนตามเป้า; พรีเซ็ตทุกตัวอ้างเอฟเฟกต์ / พารามิเตอร์ที่มีจริง; เวลา keyframe ของ Anchor In / Out / Scale; Save → .espreset → Import; .prfpset; hover preview (ภาพไม่กลับหัว); ค้นหาแท็ก / Favorites / Recent

### Phase 6D — ตรวจรอบสุดท้าย — ✅ (`scripts/e2e/phase6d.cjs` 9/9)
- เมนูและเมนูคลิกขวาที่ลงท้าย "..." ทั้ง 64 รายการเปิด dialog / หน้าต่างเลือกไฟล์ / panel ของมันจริง; ที่แก้เพิ่มในรอบนี้:
  - File > Make Offline... มี dialog ยืนยัน (ไฟล์สื่อคงอยู่บนดิสก์เสมอ ไม่มีตัวเลือกลบไฟล์)
  - Create Multi-Camera Source Sequence... มี dialog ตั้งชื่อ + จุด sync (Audio / In Points / Timeline Position)
  - Help > Third-Party Notices... เปิด dialog แสดง THIRD_PARTY_LICENSES.md (+ ปุ่มเปิดโฟลเดอร์ license ในตัวติดตั้ง)
- Track lock: `store.edit` คืนค่าคลิปบน track ที่ล็อกให้เหมือนเดิมเสมอไม่ว่าคำสั่งไหน (กันพลาดทุกคำสั่ง) + แก้ Scale / Set to Frame Size ที่ยังแก้คลิปที่ล็อก
- Linked Selection: Clear / Ripple Delete ลบภาพ + เสียงที่ link กันเมื่อเปิด Linked Selection (ปิด = ลบเฉพาะที่เลือก)
- 1 undo step: Apply Default Transitions (ภาพ + เสียง) รวมเป็นขั้นเดียว; ตรวจ 28 คำสั่งแก้คลิปว่าไม่เกิน 1 ขั้น
- ปุ่มลัดกับแป้นไทย: ส่ง keydown ที่ `key` เป็นตัวอักษรไทย + `code` ปุ่มจริง (I / O / M, Ctrl+A / Ctrl+K / Ctrl+Z) ทำงานถูก

### Phase 7 — Trim Mode / Comparison View / Remix (docs/PROMPT_PREMIERE_FINAL.md) — ✅

**7B Comparison View** (`scripts/e2e/phase7b.cjs` 12/12) — `src/Core/compare.js`; View > Comparison View, ◫ ปุ่มใน Program Monitor; Side by Side / Vertical Split / Horizontal Split (ลากเส้นแบ่งได้); Reference = เฟรมเดียวกันแบบไม่เกรดสี (before/after) หรือ shot อื่น (playhead / edit ก่อน / edit ถัดไป); Swap; จำค่าไว้ใน localStorage; Lumetri Color Match ใช้ shot reference

**7A Trim Mode** (`scripts/test_trim.mjs` 23/23, `scripts/e2e/phase7a.cjs` 18/18) — `src/Core/trimMode.js`, `editing.trimEdits`; Shift+T / Sequence > Trim Edit / ดับเบิลคลิกจุดต่อ / Ctrl+คลิกเพิ่มจุดต่อ; จอสองฝั่ง; regular / ripple / roll (Ctrl+T); −N/−1/+1/+N (Preferences > Large Trim Offset = 5); J/K/L dynamic trim, Space วนรอบจุดต่อ; ขอบแดงเมื่อชนลิมิต (media / clip ข้างเคียง / sync-lock); 1 trim = 1 undo

**7C Remix** (`scripts/test_remix.mjs` 46/46, `scripts/e2e/phase7c.cjs` 39/39) — `src/Services/remix.js` (วิเคราะห์ใน dsp worker), `remixClip.js`, `RemixControls.jsx`; Remix Tool (♫), Clip > Remix..., Essential Sound > Music > Duration; ตัดบน beat ที่เข้ากัน (chroma + MFCC + loudness ต่อ beat), เก็บ intro 8 beat / ending 8 beat, ไม่เปลี่ยน speed/pitch, crossfade แบบ equal-power (ค่าเริ่ม 30 ms); badge "Remix" + รอยหยักทุกจุดตัดบนคลิป; preview = export (render ผ่าน retimedAudio); export XML/FCPXML/EDL = 1 คลิปต่อ segment + crossfade; cache ตาม SHA-256 ของไฟล์ (memory + userData/remix-cache)
- เกณฑ์ "ไม่ใช่เพลง" (วัดจากไฟล์ใน D:	est music): ปฏิเสธเมื่อ < 8 วินาที หรือ beat < 16, BPM นอก 50–220, pulse < 5.5, steady < 0.6, conf < 0.04 — เพลงทั้ง 6 ไฟล์ผ่าน (pulse 5.9–9.3, steady 0.81–1.0), ES_* ทุกไฟล์ถูกปฏิเสธ (pulse ≤ 5.1 หรือ steady ≤ 0.37 หรือสั้นเกิน)
- ผลกับเพลงจริง (ความยาวได้ภายใน 1 beat ทุกกรณี, จุดตัดไม่มี click): Conan 182→60 s = 59.79 s, →300 s = 299.82 s; Ultraman 95→30 s = 29.88 s, →150 s = 150.02 s; Super Sentai 294→90 s = 90.42 s; Powered_mixdown 95→45 s = 45.19 s, →120 s = 120.17 s; วิเคราะห์ 1.5–4.3 s ต่อไฟล์ ครั้งเดียว
- หมายเหตุ: `Powered_mixd1own.mp3` และ `audio [music] (1).mp3` ไม่ได้มีไบต์ตรงกับไฟล์ต้นฉบับ (encode ต่างกัน) จึงถูกวิเคราะห์แยก; สำเนาไบต์ตรงกันใช้ cache (ทดสอบแล้ว)
- ข้อจำกัด: Remix ที่ยาวขึ้นจะเขียนทับคลิปที่อยู่ถัดไปบน track เดียวกัน (แบบ overwrite, undo ได้); คลิปที่ link กับวิดีโอต้อง Unlink ก่อน; คลิปที่ปรับ speed ต้อง reset ก่อน; AAF ยังไม่ได้ลองเปิดใน DAW จริง

### จำนวนเทียบ Premiere Pro (หลัง Phase 6)

| หมวด | Premiere Pro | EditorStage ก่อน Phase 6 | EditorStage ตอนนี้ |
|---|---|---|---|
| Video Effects | ~100+ (ตามภาคผนวกของแผน) | 102 | **228** |
| Video Transitions | ~45 | 32 | **162** |
| Audio Effects | ~45 | 40 | **96** |
| Audio Transitions | 3 | 3 | **12** |
| Presets ในตัว | ✅ | 0 | **483** |
| Lumetri Looks ในตัว | ✅ | 0 (Filters 35 แบบใน Create panel) | **168** |
| Save / Import / Export Preset | ✅ | ❌ | ✅ (.espreset; .prfpset บางส่วน) |
| Link / Unlink, Markers, Q/W/E/D, Keyboard Shortcuts editor, Audio Track Mixer, Sequence Settings, Preferences, History | ✅ | 🟡 | ✅ (Phase 6A–6C) |


## รายงานสรุป — Definition of Done

| เกณฑ์ | ผล |
|------|----|
| `npm run build` ผ่าน ไม่มี error/warning ใหม่ | ✅ |
| `scripts/check_commands.mjs` 0 missing / 0 stubs | ✅ (ทุก shortcut ในเมนูมี key binding จริง) |
| Undo/Redo, บันทึก/เปิด `.esproj` ได้ค่าเดิม, Preview = Export | ✅ ตรวจใน e2e ทุก Phase (export จริงด้วย FFmpeg แล้วดึงเฟรม/เสียงมาเทียบ) |
| ชุดทดสอบ keyframe, speed ramp, EDL/FCPXML round trip, Thai line breaking | ✅ `scripts/test_keyframes.mjs`, `test_timeremap.mjs`, `test_interchange.mjs`, `test_thai.mjs` (beat detection ตัดออกตามผู้ใช้) |
| README feature list + THIRD_PARTY_LICENSES ครบ | ✅ |

### เทียบกับ Premiere Pro และ CapCut (หลังอัปเกรด, ขอบเขตที่ผู้ใช้เลือก)

✅ มี · 🟡 มีบางส่วน · ❌ ไม่มี

| ความสามารถ | EditorStage | Premiere Pro | CapCut Desktop |
|-----------|:-----------:|:------------:|:--------------:|
| ทำงาน offline 100% / ฟรี | ✅ / ✅ | 🟡 (ต้อง login, เสียเงิน) | 🟡 (AI หลายตัวต้องออนไลน์, บางส่วนเสียเงิน) |
| Keyframe ease + Graph Editor | ✅ | ✅ | 🟡 (ease preset, ไม่มี graph) |
| Time Remapping / Speed Curve / Frame Blending | ✅ | ✅ (+ Optical Flow) | ✅ speed curve (+ Optical Flow) |
| Optical Flow / AI Frame Interpolation | ❌ (ตัดออก) | ✅ | ✅ |
| Mask Tracking / Point Tracker | ✅ | ✅ | 🟡 |
| Lumetri-style color, LUT, Color Match, Scopes | ✅ | ✅ | 🟡 (filters/adjust, ไม่มี scopes) |
| Filters สำเร็จรูป + hover preview | ✅ (35) | 🟡 (Creative Looks) | ✅ (มากกว่า, ออนไลน์) |
| Remove Background (คน) | ✅ offline | ❌ (ต้องใช้ Roto Brush ใน After Effects) | ✅ |
| Canvas / Background Fill | ✅ | ❌ | ✅ |
| Auto Captions + ตัดบรรทัดภาษาไทยไม่ตัดกลางคำ | ✅ offline | ✅ (Speech to Text, ภาษาไทยจำกัด) | ✅ (ออนไลน์) |
| Caption presets, keyword emphasis, emoji, SRT/VTT/ASS | ✅ | 🟡 (SRT, ไม่มี emoji อัตโนมัติ) | ✅ (ไม่มี ASS) |
| Text-Based Editing | ✅ | ✅ | 🟡 |
| Scene Edit Detection | ✅ | ✅ | ✅ |
| Auto Ducking (keyframe) | ✅ | ✅ | 🟡 |
| Voice Changer | ✅ (8) | ❌ | ✅ (มากกว่า) |
| Long-to-Shorts พร้อมปรับน้ำหนักคะแนนได้ | ✅ offline | ❌ | 🟡 (Long video to shorts, ออนไลน์ ปรับคะแนนไม่ได้) |
| Smart B-Roll จาก transcript (ไทย/อังกฤษ) | ✅ ใช้สื่อในโปรเจกต์ | ❌ | 🟡 (stock ออนไลน์) |
| Project Health Check ก่อน Export | ✅ (6 ด้าน + one-click fix) | 🟡 (เตือน offline media) | ❌ |
| EDL / FCPXML / Premiere XML | ✅ | ✅ (+ AAF/OMF) | ❌ |
| AAF / OMF | ✅ AAF เสียงฝังในไฟล์ (ไม่มี OMF) | ✅ | ❌ |
| HW encode, AV1, ProRes 4444 alpha, loudness normalize, Smart Render, Export Queue | ✅ | ✅ (Queue ผ่าน Media Encoder) | 🟡 (HW encode, ไม่มี ProRes alpha/queue) |
| Proxy / Relink | ✅ | ✅ | 🟡 |
| Stickers, Templates, Text-to-Speech, Audio library, Beat Sync | ❌ (ตัดออก) | 🟡 | ✅ (ออนไลน์) |
| Command Palette | ❌ (ตัดออก) | ❌ | ❌ |
