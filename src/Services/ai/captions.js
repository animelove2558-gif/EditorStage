// Caption clips (caption tracks): rendering with animated styles (Karaoke fill, word highlight, word-by-word, pop).
// A caption clip: { caption: { text, words:[{text,t0,t1,emph?}] (clip-local seconds), style } }
import { breakLines, graphemes } from '../textEngine';

export const CAPTION_STYLES = [
  ['plain', 'Plain'], ['karaoke', 'Karaoke (fill)'], ['highlight', 'Word highlight (box)'], ['wordByWord', 'Word-by-word'], ['pop', 'Pop (scale current word)'],
];
export const defaultCaptionStyle = () => ({
  preset: 'highlight', font: 'Noto Sans Thai, Leelawadee UI, Segoe UI, Arial, sans-serif', weight: 800, sizePct: 5.2, color: '#ffffff', highlight: '#ffd400', highlightText: '#111111',
  stroke: '#000000', strokePct: 0.5, shadow: true, box: false, boxColor: '#000000', boxOpacity: 0.55, position: 'bottom', marginPct: 9, maxWidthPct: 82, uppercase: false, lineHeight: 1.25,
  charsPerLine: 0, emphasis: false, emphColor: '#ffd400', emphScale: 1.15, emoji: false,
});
/** Ready-made caption looks (CapCut style). Each is a partial style applied over the current one. */
export const CAPTION_PRESETS = {
  'Clean White': { preset: 'plain', color: '#ffffff', stroke: '#000000', strokePct: 0.35, shadow: true, box: false, weight: 700 },
  'Bold Yellow Highlight': { preset: 'highlight', color: '#ffffff', highlight: '#ffd400', highlightText: '#111111', stroke: '#000000', strokePct: 0.5, weight: 900 },
  'Karaoke Green': { preset: 'karaoke', color: '#ffffff', highlight: '#3ddc84', stroke: '#000000', strokePct: 0.5, weight: 800 },
  'Pop Words': { preset: 'pop', color: '#ffffff', highlight: '#ff4fa3', stroke: '#000000', strokePct: 0.6, weight: 900, sizePct: 6 },
  'Word by Word': { preset: 'wordByWord', color: '#ffffff', highlight: '#ffffff', stroke: '#000000', strokePct: 0.6, weight: 900, sizePct: 6.5, position: 'middle' },
  'Black Box': { preset: 'plain', color: '#ffffff', box: true, boxColor: '#000000', boxOpacity: 0.7, strokePct: 0, shadow: false, weight: 600 },
  'Yellow Box': { preset: 'plain', color: '#111111', box: true, boxColor: '#ffd400', boxOpacity: 1, strokePct: 0, shadow: false, weight: 800 },
  'Neon Blue': { preset: 'highlight', color: '#bdf3ff', highlight: '#00c8ff', highlightText: '#001018', stroke: '#003a5c', strokePct: 0.45, weight: 800 },
  'Podcast Uppercase': { preset: 'karaoke', color: '#ffffff', highlight: '#ffb300', stroke: '#000000', strokePct: 0.5, uppercase: true, weight: 900 },
  'Subtle Bottom': { preset: 'plain', color: '#f0f0f0', stroke: '#000000', strokePct: 0.25, shadow: true, sizePct: 4.2, weight: 600, marginPct: 6 },
};

// automatic emoji after keywords (Thai and English); render-time, so the toggle is reversible
const EMOJI = [
  [/^(love|รัก)/i, '❤️'], [/^(laugh|funny|lol|haha|ตลก|ขำ|555)/i, '😂'], [/^(happy|ดีใจ|มีความสุข)/i, '😊'], [/^(sad|เศร้า|เสียใจ)/i, '😢'],
  [/^(money|cash|เงิน|รวย)/i, '💰'], [/^(fire|hot|ไฟ|ร้อน|ปัง)/i, '🔥'], [/^(wow|amazing|ว้าว|สุดยอด|เจ๋ง)/i, '🤩'], [/^(idea|ไอเดีย)/i, '💡'],
  [/^(time|เวลา)/i, '⏰'], [/^(food|eat|อาหาร|กิน|อร่อย)/i, '🍜'], [/^(music|song|เพลง|ดนตรี)/i, '🎵'], [/^(win|winner|ชนะ)/i, '🏆'],
  [/^(phone|โทรศัพท์|มือถือ)/i, '📱'], [/^(car|รถ)/i, '🚗'], [/^(home|house|บ้าน)/i, '🏠'], [/^(coffee|กาแฟ)/i, '☕'], [/^(cat|แมว)/i, '🐱'], [/^(dog|หมา|สุนัข)/i, '🐶'],
  [/^(question|why|ทำไม|สงสัย)/i, '🤔'], [/^(yes|ok|okay|ใช่|โอเค)$/i, '👍'], [/^(stop|หยุด)/i, '✋'], [/^(start|เริ่ม)/i, '🚀'], [/^(new|ใหม่)$/i, '✨'],
];
export function emojiFor(text) { const w = String(text).trim().replace(/[.,!?]+$/, ''); if (!w) return ''; const hit = EMOJI.find(([re]) => re.test(w)); return hit ? ` ${hit[1]}` : ''; }
const STOP = new Set('the a an and or but to of in on at for is are was were be it this that i you we they he she my your so just like ครับ ค่ะ คะ นะ ที่ และ ก็ ว่า ได้ ไป มา มี เป็น จะ แล้ว ของ ให้ กับ ใน คือ ไม่ เรา ผม ฉัน'.split(' '));
/** Mark the keyword of each caption (numbers first, else the longest non-filler word) as emphasised. */
export function markKeywords(words) {
  const cand = words.map((w, i) => ({ i, t: String(w.text).trim().toLowerCase().replace(/[.,!?]+$/, '') })).filter((x) => x.t && !STOP.has(x.t));
  if (!cand.length) return words;
  const num = cand.find((x) => /\d/.test(x.t)); const len = (x) => graphemes(x.t).length;
  const best = num || cand.reduce((a, b) => (len(b) > len(a) ? b : a));
  return words.map((w, i) => (i === best.i ? { ...w, emph: true } : w));
}

const slots = new Map(); // clip id -> { canvas, key }
const wordAt = (words, t) => { let k = -1; for (let i = 0; i < words.length; i++) if (words[i].t0 <= t + 1e-3) k = i; return k; };

/** Canvas (sequence size) with the caption at clip-local time t. */
export function captionCanvas(clip, t, dims) {
  const W = Math.max(16, Math.round(dims?.w || 1920)), H = Math.max(16, Math.round(dims?.h || 1080));
  const cap = clip.caption || {}; const st = { ...defaultCaptionStyle(), ...(cap.style || {}) };
  const local = Math.max(0, t - clip.start);
  const words = cap.words?.length ? cap.words : [{ text: cap.text || '', t0: 0, t1: clip.dur }];
  const cur = wordAt(words, local); const prog = cur >= 0 ? Math.max(0, Math.min(1, (local - words[cur].t0) / Math.max(0.05, words[cur].t1 - words[cur].t0))) : 0;
  const animated = st.preset !== 'plain';
  const key = JSON.stringify([W, H, cap.text, words.map((w) => (w.emph ? 1 : 0)).join(''), st, animated ? cur : 0, st.preset === 'karaoke' || st.preset === 'pop' ? Math.round(prog * 20) : 0]);
  let slot = slots.get(clip.id); if (!slot) { slot = { canvas: document.createElement('canvas'), key: '' }; slots.set(clip.id, slot); }
  if (slot.key === key) return slot.canvas;
  const c = slot.canvas; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d'); g.clearRect(0, 0, W, H);
  const size = (st.sizePct / 100) * H; const font = `${st.weight} ${size}px ${st.font}`; g.font = font; g.textBaseline = 'alphabetic';
  const tx = (s) => (st.uppercase ? s.toUpperCase() : s);
  // layout: Thai-aware line breaking over the whole caption text (never inside a word); each line is cut back into
  // pieces of the timed words so animated styles still follow the word timings
  const maxW = (st.maxWidthPct / 100) * W;
  const texts = words.map((w) => tx(w.text) + (st.emoji ? emojiFor(w.text) : ''));
  const owner = []; texts.forEach((t, i) => { for (let k = 0; k < t.length; k++) owner.push(i); });
  const lines = breakLines(texts.join(''), (x) => g.measureText(x).width, { maxW, maxChars: st.charsPerLine || 0 }).map((ln) => {
    const out = []; for (let k = 0; k < ln.text.length; k++) { const i = owner[ln.start + k]; const last = out[out.length - 1]; if (last && last.i === i) last.text += ln.text[k]; else out.push({ i, text: ln.text[k] }); }
    for (const it of out) { it.w = g.measureText(it.text).width; it.emph = st.emphasis && !!words[it.i]?.emph; }
    return out;
  });
  const lh = size * st.lineHeight; const blockH = lh * lines.length;
  const yTop = st.position === 'top' ? (st.marginPct / 100) * H : st.position === 'middle' ? (H - blockH) / 2 : H - (st.marginPct / 100) * H - blockH;
  const strokeW = (st.strokePct / 100) * H;
  lines.forEach((line, li) => {
    const total = line.reduce((s, x) => s + x.w, 0); let x = (W - total) / 2; const y = yTop + lh * li + size * 0.95;
    if (st.box) { g.fillStyle = hexA(st.boxColor, st.boxOpacity); const pad = size * 0.25; roundRect(g, x - pad, y - size * 0.95 - pad * 0.4, total + pad * 2, lh + pad * 0.3, size * 0.2); g.fill(); }
    for (const it of line) {
      const shown = st.preset !== 'wordByWord' || it.i <= cur; const isCur = it.i === cur; const past = it.i < cur;
      if (shown) {
        g.save(); let scale = 1;
        if (st.preset === 'pop' && isCur) scale = 1 + 0.18 * Math.sin(Math.min(1, prog * 2.5) * Math.PI);
        if (it.emph) scale *= st.emphScale || 1.15;
        const cx = x + it.w / 2; g.translate(cx, y); g.scale(scale, scale); g.translate(-cx, -y);
        if (st.preset === 'highlight' && isCur) { const pad = size * 0.12; g.fillStyle = st.highlight; roundRect(g, x - pad, y - size * 0.88, it.w + pad * 2, size * 1.12, size * 0.18); g.fill(); }
        if (st.shadow) { g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = size * 0.12; g.shadowOffsetY = size * 0.05; }
        if (strokeW > 0 && !(st.preset === 'highlight' && isCur)) { g.lineJoin = 'round'; g.lineWidth = strokeW * 2; g.strokeStyle = st.stroke; g.strokeText(it.text, x, y); }
        g.shadowColor = 'transparent';
        const col = it.emph && !(st.preset === 'highlight' && isCur) ? st.emphColor : st.preset === 'highlight' && isCur ? st.highlightText : (st.preset === 'karaoke' && past) || ((st.preset === 'wordByWord' || st.preset === 'pop') && isCur) ? st.highlight : st.color;
        g.fillStyle = col; g.fillText(it.text, x, y);
        if (st.preset === 'karaoke' && isCur) { g.save(); g.beginPath(); g.rect(x, y - size * 1.2, it.w * prog, size * 1.6); g.clip(); g.fillStyle = st.highlight; g.fillText(it.text, x, y); g.restore(); }
        g.restore();
      }
      x += it.w;
    }
  });
  slot.key = key; return c;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function hexA(hex, a) { const n = parseInt(String(hex).replace('#', ''), 16) || 0; return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
