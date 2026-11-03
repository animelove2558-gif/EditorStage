// Auto-Subtitles: transcribe timeline audio in a worker (Whisper, offline) and build caption clips on a caption track.
import { edit, getState } from '../../Core/store';
import { sequencePCM, timelineSpan } from './audioSource';
import { defaultCaptionStyle, markKeywords } from './captions';
import { breakLines } from '../textEngine';

export const MODELS = [
  { id: 'whisper/whisper-base', label: 'Whisper Base (bundled, ~140 MB, 99 languages)' },
  { id: 'whisper/whisper-small', label: 'Whisper Small (more accurate, add with scripts/fetch_models.mjs small)' },
];
// Whisper language names (transformers.js accepts these or ISO codes); '' = auto-detect
export const LANGUAGES = [['', 'Auto-detect'], ['thai', 'ไทย (Thai)'], ['english', 'English'], ['japanese', '日本語'], ['chinese', '中文'], ['korean', '한국어'], ['vietnamese', 'Tiếng Việt'],
  ['indonesian', 'Bahasa Indonesia'], ['malay', 'Bahasa Melayu'], ['lao', 'ລາວ'], ['khmer', 'ខ្មែរ'], ['burmese', 'မြန်မာ'], ['hindi', 'हिन्दी'], ['arabic', 'العربية'], ['french', 'Français'],
  ['german', 'Deutsch'], ['spanish', 'Español'], ['portuguese', 'Português'], ['italian', 'Italiano'], ['russian', 'Русский'], ['turkish', 'Türkçe'], ['dutch', 'Nederlands'], ['polish', 'Polski']];

let worker = null, seqId = 0; const waiting = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('stt.worker.js', document.baseURI).href);
  worker.onmessage = (e) => { const w = waiting.get(e.data.id) || [...waiting.values()][0]; if (w) w(e.data); };
  worker.onerror = (e) => { for (const w of waiting.values()) w({ type: 'error', error: e.message || 'speech worker failed to start' }); };
  return worker;
}

/** Stop a running transcription (the worker is restarted). */
export function cancelTranscription() { if (!worker) return; worker.terminate(); worker = null; for (const w of [...waiting.values()]) w({ type: 'error', error: 'Cancelled' }); waiting.clear(); }
/** Transcribe audio (mono Float32 @16 kHz). onProgress({stage, progress}). Resolves {words:[{text,t0,t1}], language}. */
export function transcribe(audio, { model = MODELS[0].id, language = '', task = 'transcribe' } = {}, onProgress = () => {}) {
  const id = ++seqId; const w = getWorker();
  return new Promise((resolve, reject) => {
    waiting.set(id, (m) => {
      if (m.type === 'loading') onProgress({ stage: 'Loading model', progress: (m.progress || 0) / 100 });
      else if (m.type === 'ready') onProgress({ stage: 'Transcribing', progress: 0 });
      else if (m.type === 'progress') onProgress({ stage: 'Transcribing', progress: m.progress, words: m.words });
      else if (m.type === 'done') { waiting.delete(id); resolve(m); }
      else if (m.type === 'error') { waiting.delete(id); reject(new Error(m.error)); }
    });
    w.postMessage({ id, audio, sr: 16000, model, language: language || null, task }, [audio.buffer]);
  });
}

// ---------------------------------------------------------------- words -> caption segments
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? (loc) => new Intl.Segmenter(loc, { granularity: 'word' }) : null;
const noSpaceScript = /[฀-๿຀-໿ក-៿က-႟぀-ヿ一-鿿]/;
/** Whisper "words" in Thai/Lao/Khmer/CJK can be whole phrases: split them with Intl.Segmenter and spread the time by length. */
export function refineWords(words) {
  const out = [];
  for (const w of words) {
    const t = String(w.text);
    if (seg && noSpaceScript.test(t) && t.trim().length > 6) {
      const parts = [...seg(undefined).segment(t.trim())].map((x) => x.segment).filter((x) => x.length);
      const total = parts.reduce((s, p) => s + p.length, 0) || 1; let acc = w.t0;
      parts.forEach((p, i) => { const d = ((w.t1 - w.t0) * p.length) / total; out.push({ text: (i === 0 && /^\s/.test(t) ? ' ' : '') + p, t0: acc, t1: acc + d }); acc += d; });
    } else out.push({ ...w });
  }
  return out;
}
/** Group words into caption lines: break on pauses, punctuation, max characters and max duration. */
export function segmentWords(words, { maxChars = 42, maxDur = 5, pause = 0.7 } = {}) {
  const segs = []; let cur = null;
  const flush = () => { if (cur && cur.words.length) segs.push(cur); cur = null; };
  for (const w of words) {
    const text = String(w.text);
    if (cur) {
      const len = cur.words.map((x) => x.text).join('').trim().length + text.length;
      const gap = w.t0 - cur.t1; const prev = cur.words[cur.words.length - 1].text.trim();
      // a sentence-final word may overflow a little rather than be left alone on the next caption
      const tail = /[.!?。！？,]$/.test(text.trim()) && len <= maxChars * 1.35 && w.t1 - cur.t0 <= maxDur * 1.3;
      if (gap > pause || (len > maxChars && !tail) || (w.t1 - cur.t0 > maxDur && !tail) || /[.!?。！？]$/.test(prev)) flush();
    }
    if (!cur) cur = { t0: w.t0, t1: w.t1, words: [] };
    cur.words.push({ text, t0: w.t0, t1: w.t1 }); cur.t1 = Math.max(cur.t1, w.t1);
  }
  flush();
  return segs.map((s) => ({ ...s, text: s.words.map((x) => x.text).join('').trim() }));
}

const uid = () => Math.random().toString(36).slice(2, 9);
/** Put caption segments (timeline seconds) on a caption track (created if needed). Returns the track id. */
export function placeCaptions(segs, { trackId = null, style = defaultCaptionStyle(), replace = true, language = '' } = {}) {
  let tid = trackId;
  edit('Auto-Subtitles', ({ seq, sel }) => {
    const ids = captionsInto(seq, segs, { trackId, style, replace, language }); tid = ids.track;
    sel.splice(0, sel.length, ...ids.slice(0, 1));
  });
  return tid;
}
/** placeCaptions on a sequence object (mutates it). Returns the new clip ids, with .track set to the caption track id. */
export function captionsInto(seq, segs, { trackId = null, style = defaultCaptionStyle(), replace = true, language = '' } = {}) {
  let tid = trackId;
  if (!tid || !seq.tracks.some((t) => t.id === tid)) {
    const n = seq.tracks.filter((t) => t.kind === 'caption').length + 1; tid = `CC${n}`;
    seq.tracks.unshift({ id: tid, kind: 'caption', muted: false, solo: false, locked: false, sync: true, name: language ? `Captions (${language})` : 'Captions' });
  }
  if (replace) seq.clips = seq.clips.filter((c) => c.track !== tid);
  const ids = [];
  for (const s of segs) {
    const id = uid(); ids.push(id);
    seq.clips.push({ id, track: tid, start: s.t0, dur: Math.max(0.3, s.t1 - s.t0), name: s.text, color: '#7a5cbf', effects: [], enabled: true, inPoint: 0, speed: 1,
      caption: { text: s.text, words: markKeywords(s.words.map((w) => ({ text: w.text, t0: w.t0 - s.t0, t1: w.t1 - s.t0 }))), style: { ...style } } });
  }
  ids.track = tid; return ids;
}

/** Full pipeline for the Smart Tools panel. */
export async function autoSubtitles({ ids = null, model, language, task, maxChars, maxDur, lines = 1, style }, onProgress = () => {}) {
  const seq = getState().sequence; const span = timelineSpan(seq, ids); if (!span) throw new Error('No audio clips on the timeline');
  onProgress({ stage: 'Reading audio', progress: 0 });
  const pcm = await sequencePCM(seq, span[0], span[1], 16000, ids);
  const r = await transcribe(pcm, { model, language, task }, onProgress);
  const words = refineWords(r.words).map((w) => ({ ...w, t0: w.t0 + span[0], t1: w.t1 + span[0] }));
  const segs = segmentWords(words, { maxChars: maxChars * Math.max(1, lines), maxDur });
  placeCaptions(segs, { style: { ...style, charsPerLine: lines > 1 ? maxChars : style.charsPerLine || 0 }, language: r.language || language });
  return { segments: segs.length, words: words.length, language: r.language };
}

const trackCaptions = (seq, trackId) => seq.clips.filter((c) => c.track === trackId && c.caption && c.enabled !== false).sort((a, b) => a.start - b.start);
const stamp = (t, sep, msDigits = 3) => { const ms = Math.round(Math.max(0, t) * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3).slice(0, msDigits)}`; };
/** Caption text broken into the lines it shows on screen (Thai never breaks inside a word). */
function captionLines(c) {
  const st = c.caption.style || {}; const n = st.charsPerLine || 0; const t = String(c.caption.text);
  return n ? breakLines(t, (x) => x.length, { maxChars: n }).map((l) => l.text).join('\n') : t;
}
/** SubRip export of a caption track. */
export function captionsToSrt(seq, trackId) {
  return trackCaptions(seq, trackId).map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.start + c.dur, ',')}\n${captionLines(c)}\n`).join('\n');
}
/** WebVTT export. */
export function captionsToVtt(seq, trackId) {
  return 'WEBVTT\n\n' + trackCaptions(seq, trackId).map((c, i) => `${i + 1}\n${stamp(c.start, '.')} --> ${stamp(c.start + c.dur, '.')}\n${captionLines(c)}\n`).join('\n');
}
/** Advanced SubStation Alpha export: font, size, colours, outline and position follow the caption style. */
export function captionsToAss(seq, trackId) {
  const cs = trackCaptions(seq, trackId); const st = { ...defaultCaptionStyle(), ...(cs[0]?.caption.style || {}) };
  const col = (hex, a = 0) => { const h = String(hex).replace('#', '').padEnd(6, '0'); return `&H${a.toString(16).padStart(2, '0').toUpperCase()}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };
  const H = seq.height, W = seq.width; const size = Math.round((st.sizePct / 100) * H);
  const align = st.position === 'top' ? 8 : st.position === 'middle' ? 5 : 2; const margin = Math.round((st.marginPct / 100) * H);
  const font = String(st.font).split(',')[0].trim().replace(/"/g, '');
  const t = (x) => stamp(x, '.', 2).replace(/^0/, '');
  const esc = (x) => String(x).replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n` +
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    `Style: Default,${font},${size},${col(st.color)},${col(st.highlight)},${col(st.box ? st.boxColor : st.stroke, st.box ? Math.round((1 - st.boxOpacity) * 255) : 0)},${col('#000000', 128)},${st.weight >= 600 ? -1 : 0},0,0,0,100,100,0,0,${st.box ? 3 : 1},${st.box ? Math.round(size * 0.2) : Math.max(0, Math.round((st.strokePct / 100) * H))},${st.shadow ? 1 : 0},${align},${Math.round(W * 0.09)},${Math.round(W * 0.09)},${margin},1\n\n` +
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    cs.map((c) => `Dialogue: 0,${t(c.start)},${t(c.start + c.dur)},Default,,0,0,0,,${esc(st.uppercase ? captionLines(c).toUpperCase() : captionLines(c))}`).join('\n') + '\n';
}
