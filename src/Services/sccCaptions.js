// SCC (Scenarist Closed Caption, CEA-608 channel 1) writer and reader for pop-on captions.
// CEA-608 carries Latin text only (ASCII plus a few accented letters); other characters, including Thai, are replaced by "?"
// and counted, so the caller can tell the user. Times are timeline seconds; the timecode follows the sequence frame rate
// (drop-frame for 29.97 / 59.94, as SCC players expect).
import { framesToTC, tcToFrames, dropFrameDefault } from './interchange/timecode.js';

const parity = (b) => { let n = 0; for (let i = 0; i < 7; i++) n += (b >> i) & 1; return (b & 0x7f) | (n % 2 === 0 ? 0x80 : 0); };
const word = (hi, lo) => (parity(hi) << 8 | parity(lo)).toString(16).padStart(4, '0');
const RCL = [0x14, 0x20], ENM = [0x14, 0x2e], EDM = [0x14, 0x2c], EOC = [0x14, 0x2f];
const ROW_PAC = { 14: [0x14, 0x40], 15: [0x14, 0x60] }; // row 14 / 15, white, column 0
const SPECIAL = { 'á': 0x2a, 'é': 0x5c, 'í': 0x5e, 'ó': 0x5f, 'ú': 0x60, 'ç': 0x7b, '÷': 0x7c, 'Ñ': 0x7d, 'ñ': 0x7e };
const FROM_SPECIAL = Object.fromEntries(Object.entries(SPECIAL).map(([k, v]) => [v, k]));
const LINE = 32; const MAX_LINES = 2;

/** Break text into at most 2 lines of 32 characters, at spaces when possible. Returns { lines, cut } (cut: text that did not fit). */
export function wrapCaption(text) {
  const words = String(text).replace(/\s*\n\s*/g, ' ').trim().split(/\s+/).filter(Boolean); const lines = ['']; let cut = false;
  for (const w0 of words) {
    let w = w0;
    while (w.length > LINE) { if (lines[lines.length - 1]) lines.push(''); if (lines.length > MAX_LINES) { cut = true; w = ''; break; } lines[lines.length - 1] = w.slice(0, LINE); w = w.slice(LINE); lines.push(''); }
    if (!w) continue;
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if (cur.length + 1 + w.length <= LINE) lines[lines.length - 1] = cur + ' ' + w;
    else { lines.push(w); }
    if (lines.length > MAX_LINES) { cut = true; lines.length = MAX_LINES; }
  }
  return { lines: lines.filter(Boolean), cut };
}

// ASCII codes that CEA-608 shows as other letters (accented, or a block): they are not sent as ASCII
const RESERVED = new Set([0x2a, 0x5c, 0x5e, 0x5f, 0x60, 0x7b, 0x7c, 0x7d, 0x7e]);
function code(ch, stats) {
  if (SPECIAL[ch] !== undefined) return SPECIAL[ch];
  const c = ch.charCodeAt(0);
  if (c >= 0x20 && c <= 0x7e && !RESERVED.has(c)) return c;
  stats.replaced++; return c === 0x2a || c === 0x5f ? 0x2d : 0x3f;
}

/**
 * SCC text for caption segments [{ start, dur, text }] (seconds). Returns { text, replaced, cut } where replaced counts characters
 * CEA-608 cannot show and cut counts captions that had more than 2 lines of 32 characters.
 */
export function writeSCC(captions, fps = 29.97) {
  const drop = dropFrameDefault(fps); const tc = (f) => framesToTC(Math.max(0, f), fps, drop); const stats = { replaced: 0, cut: 0 };
  const items = [...captions].filter((c) => c && String(c.text || '').trim()).sort((a, b) => a.start - b.start);
  const out = ['Scenarist_SCC V1.0', '']; let cursor = 0; // first frame a new line may start at
  const pending = []; // { frame, words[] }
  const push = (frame, words) => pending.push({ frame, words });
  const built = items.map((c) => {
    const { lines, cut } = wrapCaption(c.text); if (cut) stats.cut++;
    const words = [word(...RCL), word(...RCL), word(...ENM), word(...ENM)];
    const rows = lines.length === 1 ? [15] : [14, 15];
    lines.forEach((l, k) => {
      const pac = ROW_PAC[rows[k]]; words.push(word(...pac), word(...pac));
      const codes = [...l].map((ch) => code(ch, stats));
      for (let j = 0; j < codes.length; j += 2) words.push(word(codes[j], j + 1 < codes.length ? codes[j + 1] : 0));
    });
    words.push(word(...EOC), word(...EOC));
    const startF = Math.round(c.start * fps);
    return { words, startF, endF: Math.round((c.start + c.dur) * fps), wantF: startF - (words.length - 2) }; // the first EOC word lands on the start frame
  });
  built.forEach((c, i) => {
    const loadF = Math.max(c.wantF, cursor);
    push(loadF, c.words); cursor = loadF + c.words.length;
    // the clear command goes out only when it fits before the next caption's data; otherwise the next caption replaces this one
    const next = built[i + 1]; const f = Math.max(c.endF, cursor);
    if (!next || f + 2 <= next.wantF) { push(f, [word(...EDM), word(...EDM)]); cursor = f + 2; }
  });
  for (const p of pending) out.push(`${tc(p.frame)}\t${p.words.join(' ')}`, '');
  return { text: out.join('\r\n'), replaced: stats.replaced, cut: stats.cut };
}

/** Decode SCC text into pop-on captions [{ start, dur, text }] (seconds). Roll-up and paint-on captions are ignored. */
export function parseSCC(text, fps = 29.97) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  if (!/^Scenarist_SCC V1\.0/i.test((lines[0] || '').trim())) throw new Error('not an SCC file (missing "Scenarist_SCC V1.0")');
  const caps = []; let showing = null; let buf = []; let last = '';
  const finish = (frame) => { if (showing) { showing.dur = Math.max(1 / fps, frame / fps - showing.start); caps.push(showing); showing = null; } };
  for (const line of lines.slice(1)) {
    const m = /^(\d+:\d+:\d+[:;]\d+)\s+(.*)$/.exec(line.trim()); if (!m) continue;
    let f = tcToFrames(m[1], fps);
    for (const w of m[2].split(/\s+/).filter(Boolean)) {
      const v = parseInt(w, 16); if (!Number.isFinite(v)) { f++; continue; }
      const hi = (v >> 8) & 0x7f, lo = v & 0x7f; const key = w.toLowerCase();
      if (hi >= 0x10 && hi <= 0x1f) { // control code (a repeat of the previous one is ignored)
        if (key === last) { last = ''; f++; continue; }
        last = key; if (hi === 0x14 || hi === 0x1c) {
          if (lo === 0x20) { buf = []; } // RCL: load a pop-on caption
          else if (lo === 0x2f) { finish(f); showing = { start: f / fps, dur: 0, text: buf.join('\n') }; buf = []; } // EOC: show it
          else if (lo === 0x2c) finish(f); // EDM: clear the screen
          else if (lo === 0x2e) { buf = []; }
          else if (lo >= 0x40) buf.push(''); // PAC on row 14 / 15: a new row
        } else if (lo >= 0x40 && lo <= 0x7f) { buf.push(''); } // PAC on another row: a new row
      } else {
        last = '';
        for (const b of [hi, lo]) {
          if (b < 0x20) continue;
          if (!buf.length) buf.push('');
          buf[buf.length - 1] += FROM_SPECIAL[b] || String.fromCharCode(b);
        }
      }
      f++;
    }
  }
  if (showing) { showing.dur = Math.max(showing.dur, 2); caps.push(showing); }
  return caps.filter((c) => c.text.trim());
}
