// Smart B-Roll (Create > B-Roll, Smart Tools > Smart B-Roll...): index the project's video and still images (file name,
// transcript, objects seen by the on-device detector) and suggest cutaways for what is being said in each sentence of the
// sequence transcript. Placing a suggestion puts the shot on the first free video track above the picture (no audio).
import { getState, edit } from '../../Core/store';
import { placeMedia, addTrackTo } from '../../Core/commands';
import { fileUrl } from '../media';
import { detectObjects } from '../vision';
import { sequenceWords } from './transcript';
import { segmentWords } from './stt';

// COCO classes of the object detector (EfficientDet-Lite0) with Thai and English words that mean the same thing.
const CONCEPTS = {
  person: 'person people man woman men women boy girl kid kids child children friend friends คน ผู้คน ผู้ชาย ผู้หญิง เด็ก เพื่อน',
  bicycle: 'bicycle bike cycling จักรยาน ปั่น', car: 'car cars drive driving รถ รถยนต์ ขับรถ', motorcycle: 'motorcycle motorbike มอเตอร์ไซค์ มอไซค์',
  airplane: 'airplane plane flight airport เครื่องบิน สนามบิน', bus: 'bus รถเมล์ รถบัส', train: 'train railway รถไฟ', truck: 'truck รถบรรทุก', boat: 'boat ship เรือ',
  'traffic light': 'traffic ไฟแดง จราจร', bench: 'bench ม้านั่ง', bird: 'bird birds นก', cat: 'cat cats kitten แมว น้องแมว', dog: 'dog dogs puppy หมา สุนัข น้องหมา',
  horse: 'horse ม้า', sheep: 'sheep แกะ', cow: 'cow cows วัว', elephant: 'elephant ช้าง', bear: 'bear หมี', zebra: 'zebra ม้าลาย', giraffe: 'giraffe ยีราฟ',
  backpack: 'backpack กระเป๋าเป้', umbrella: 'umbrella rain ร่ม ฝน', handbag: 'handbag bag กระเป๋า', suitcase: 'suitcase luggage travel trip กระเป๋าเดินทาง เดินทาง เที่ยว',
  skis: 'ski skiing สกี', snowboard: 'snowboard snow หิมะ', 'sports ball': 'ball football soccer basketball ลูกบอล บอล ฟุตบอล', kite: 'kite ว่าว',
  skateboard: 'skateboard สเก็ตบอร์ด', surfboard: 'surf surfing surfboard โต้คลื่น', 'tennis racket': 'tennis เทนนิส',
  bottle: 'bottle water ขวด น้ำ', 'wine glass': 'wine ไวน์', cup: 'cup coffee tea mug แก้ว กาแฟ ชา', fork: 'fork ส้อม', knife: 'knife มีด', spoon: 'spoon ช้อน', bowl: 'bowl ชาม',
  banana: 'banana กล้วย', apple: 'apple แอปเปิ้ล', sandwich: 'sandwich แซนด์วิช', orange: 'orange ส้ม', broccoli: 'broccoli บร็อคโคลี่', carrot: 'carrot แครอท',
  'hot dog': 'hotdog ฮอทดอก', pizza: 'pizza พิซซ่า', donut: 'donut doughnut โดนัท', cake: 'cake dessert เค้ก ขนม ของหวาน',
  chair: 'chair เก้าอี้', couch: 'couch sofa โซฟา', 'potted plant': 'plant plants garden ต้นไม้ สวน', bed: 'bed sleep bedroom เตียง นอน', 'dining table': 'table dinner โต๊ะ',
  toilet: 'toilet bathroom ห้องน้ำ', tv: 'tv television ทีวี โทรทัศน์', laptop: 'laptop computer notebook แล็ปท็อป โน้ตบุ๊ก คอมพิวเตอร์ คอม',
  mouse: 'mouse เมาส์', remote: 'remote รีโมท', keyboard: 'keyboard typing คีย์บอร์ด พิมพ์', 'cell phone': 'phone smartphone mobile โทรศัพท์ มือถือ',
  microwave: 'microwave ไมโครเวฟ', oven: 'oven bake เตาอบ อบ', toaster: 'toaster', sink: 'sink อ่างล้างจาน', refrigerator: 'fridge refrigerator ตู้เย็น',
  book: 'book books reading หนังสือ อ่าน', clock: 'clock time นาฬิกา เวลา', vase: 'vase flower flowers แจกัน ดอกไม้', scissors: 'scissors กรรไกร',
  'teddy bear': 'teddy toy ตุ๊กตา ของเล่น', 'hair drier': 'hairdryer ไดร์เป่าผม', toothbrush: 'toothbrush แปรงสีฟัน',
  food: 'food eat eating meal lunch dinner breakfast cook cooking อาหาร กิน ทาน อร่อย ทำอาหาร ข้าว',
};
const FOOD = new Set(['banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'bowl']);
const WORD2C = new Map(); for (const [c, ws] of Object.entries(CONCEPTS)) for (const w of ws.split(' ')) if (!WORD2C.has(w)) WORD2C.set(w, c);
const STOP = new Set('the a an and or but to of in on at for is are was were be been it its this that these those i you we they he she my your our so just like with from have has had do does did not no yes very really can will would there here what when then than มัน ครับ ค่ะ คะ นะ ที่ และ ก็ ว่า ได้ ไป มา มี เป็น จะ ไม่ ให้ กับ ของ ใน แล้ว คือ อยู่ นี้ นั้น เรา ผม ฉัน หนู เขา'.split(' '));
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const stem = (w) => (w.length > 4 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** Words of a text (Thai segmented), lower-case, stop words dropped. */
export function tokens(text) {
  const t = String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_\-.()[\]{},!?'"“”:;/\\|#+=*&^%$@~`<>0-9]+/g, ' ');
  const out = [];
  for (const part of t.split(/\s+/)) {
    if (!part) continue;
    const pieces = /[฀-๿]/.test(part) && seg ? [...seg.segment(part)].filter((s) => s.isWordLike).map((s) => s.segment) : [part];
    for (const p of pieces) if (p.length > 1 && !STOP.has(p)) out.push(p);
  }
  return out;
}
/** The concept a word stands for (a detector class, 'food', or the word itself). */
export const concept = (w) => WORD2C.get(w) || WORD2C.get(stem(w)) || stem(w);
/** Concepts of a text, also matching two-word classes ("cell phone", "hot dog"). */
export function concepts(text) {
  const tk = tokens(text); const out = new Set(tk.map(concept));
  for (let i = 0; i + 1 < tk.length; i++) { const two = `${tk[i]} ${tk[i + 1]}`; if (CONCEPTS[two]) out.add(two); }
  return out;
}

const seekTo = (el, t) => new Promise((res) => { const d = () => { el.removeEventListener('seeked', d); res(); }; el.addEventListener('seeked', d); el.currentTime = t; setTimeout(d, 2000); });
/** Objects seen in a file: Map(concept -> best score). Video: 3 frames (20 / 50 / 80 %). */
async function seenIn(m) {
  const seen = new Map(); const add = (objs) => { for (const o of objs) { const c = o.cat; seen.set(c, Math.max(seen.get(c) || 0, o.score)); if (FOOD.has(c)) seen.set('food', Math.max(seen.get('food') || 0, o.score)); } };
  if (m.kind === 'image') { const img = new Image(); img.src = fileUrl(m.playPath); await img.decode(); add(await detectObjects(img)); return seen; }
  const el = document.createElement('video'); el.crossOrigin = 'anonymous'; el.muted = true; el.preload = 'auto'; el.src = fileUrl(m.playPath);
  await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error(`cannot load ${m.name}`)); });
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = Math.max(2, Math.round((320 * (el.videoHeight || 9)) / (el.videoWidth || 16))); const g = cv.getContext('2d');
  const a = m.subclip?.in ?? 0, b = m.subclip?.out ?? m.duration;
  for (const f of [0.2, 0.5, 0.8]) { await seekTo(el, a + (b - a) * f); g.drawImage(el, 0, 0, cv.width, cv.height); add(await detectObjects(cv)); }
  el.removeAttribute('src'); el.load();
  return seen;
}
const usable = (m) => (m.kind === 'video' || m.kind === 'image') && m.status === 'ready' && !m.synthetic;

let running = null;
export function cancelIndex() { if (running) running.cancelled = true; }
/**
 * Index the video / still images of the project (only the ones not indexed yet, or all with force). Saved with the project
 * (media.brollIndex = { labels: [[concept, weight, source]] }). One undo step. Returns the number indexed.
 */
export async function indexMedia({ force = false, vision = true } = {}, onProgress = () => {}) {
  const list = getState().media.filter((m) => usable(m) && (force || !m.brollIndex));
  const me = running = { cancelled: false }; const res = {};
  try {
    for (let i = 0; i < list.length; i++) {
      const m = list[i]; onProgress({ stage: m.name, progress: i / list.length });
      const lab = new Map(); const put = (c, w, src) => { const p = lab.get(c); if (!p || p[0] < w) lab.set(c, [w, src]); };
      for (const c of concepts(m.name.replace(/\.[a-z0-9]{2,4}$/i, ''))) put(c, 1, 'name');
      if (m.transcript?.words?.length) {
        const freq = new Map(); for (const c of concepts(m.transcript.words.map((w) => w.text).join(' '))) freq.set(c, (freq.get(c) || 0) + 1);
        for (const c of [...freq.keys()].slice(0, 40)) put(c, 0.4, 'speech');
      }
      if (vision) { try { for (const [c, s] of await seenIn(m)) if (s >= 0.35) put(c, Math.min(1, 0.3 + s), 'picture'); } catch { /* no picture analysis for this file */ } }
      if (me.cancelled) throw new Error('Cancelled');
      res[m.id] = { labels: [...lab].map(([c, [w, src]]) => [c, +w.toFixed(2), src]), vision };
    }
    if (list.length) edit('Index Media for B-Roll', ({ media }) => { for (const x of media) if (res[x.id]) x.brollIndex = res[x.id]; });
    onProgress({ stage: '', progress: 1 });
    return list.length;
  } finally { running = null; }
}

const vtracks = (seq) => seq.tracks.filter((t) => t.kind === 'video').map((t) => t.id).sort((a, b) => (+a.slice(1) || 0) - (+b.slice(1) || 0));
/**
 * Suggestions for the sentences of the active sequence: [{ t0, t1, text, candidates: [{ mediaId, name, score, why: [word] }] }].
 * Media already visible in that sentence is not suggested.
 */
export function suggestBRoll({ max = 5, maxDur = 8 } = {}) {
  const s = getState(); const seq = s.sequence; const words = sequenceWords(seq);
  if (!words.length) throw new Error('The sequence has no transcript yet');
  const idx = s.media.filter((m) => usable(m) && m.brollIndex);
  const segs = segmentWords(words, { maxChars: 80, maxDur, pause: 0.6 });
  const vt = new Set(vtracks(seq));
  return segs.map((g) => {
    const want = concepts(g.text);
    const shown = new Set(seq.clips.filter((c) => vt.has(c.track) && c.mediaId && c.start < g.t1 && c.start + c.dur > g.t0).map((c) => c.mediaId));
    const candidates = [];
    for (const m of idx) {
      if (shown.has(m.id)) continue;
      let score = 0; const why = [];
      for (const [c, w] of m.brollIndex.labels) if (want.has(c)) { score += w; why.push(c); }
      if (score > 0) candidates.push({ mediaId: m.id, name: m.name, score: +score.toFixed(2), why });
    }
    candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { t0: g.t0, t1: g.t1, text: g.text, candidates: candidates.slice(0, max) };
  }).filter((g) => g.candidates.length);
}

/** Put a file over [t0, t1) on the first video track above everything shown there (a new track when needed). One undo step. */
export function placeBRoll({ t0, t1 }, mediaId) {
  const m = getState().media.find((x) => x.id === mediaId); if (!m) return null;
  let id = null;
  edit(`Add B-Roll ${m.name}`, ({ seq, sel }) => {
    const ids = vtracks(seq); const busy = (tid) => seq.clips.some((c) => c.track === tid && c.start < t1 - 1e-6 && c.start + c.dur > t0 + 1e-6);
    let top = -1; ids.forEach((tid, i) => { if (busy(tid)) top = i; });
    let track = ids.slice(top + 1).find((tid) => !busy(tid) && !seq.tracks.find((t) => t.id === tid)?.locked);
    if (!track) track = addTrackTo(seq, 'video');
    const len = m.kind === 'image' ? t1 - t0 : Math.min(t1 - t0, (m.subclip?.out ?? m.duration) - (m.subclip?.in ?? 0));
    const out = placeMedia(seq, m, t0, track, { dur: len });
    id = out[0];
    // B-roll is picture only: drop the linked audio clip
    const v = seq.clips.find((c) => c.id === id);
    if (v?.linkId) { const link = v.linkId; seq.clips = seq.clips.filter((c) => !(c.linkId === link && c.id !== id)); delete v.linkId; v.noAudio = true; }
    if (v) v.name = `${m.name} (B-Roll)`;
    sel.splice(0, sel.length, id);
  });
  return id;
}
