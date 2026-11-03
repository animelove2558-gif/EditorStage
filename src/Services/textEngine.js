// Line breaking for captions: words come from Intl.Segmenter, so Thai (written without spaces) never breaks inside a
// word; a word wider than the line is split between grapheme clusters (vowels / tone marks stay on their consonant).

const wordSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const graphSeg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
/** Word segments (spaces and punctuation are their own segments). */
export const words = (s) => (wordSeg ? [...wordSeg.segment(s)].map((x) => x.segment) : String(s).split(/(\s+)/).filter(Boolean));
/** Grapheme clusters (a Thai consonant with its vowel / tone marks is one cluster). */
export const graphemes = (s) => (graphSeg ? [...graphSeg.segment(s)].map((x) => x.segment) : [...s]);
const glen = (s) => graphemes(s).length;

/**
 * Break text into lines. measure(str) -> px. maxW: line width (px, Infinity = only explicit newlines). maxChars: limit of
 * grapheme clusters per line (0 = none). Returns [{ text, start }] (start = UTF-16 offset of the line in `text`).
 */
export function breakLines(text, measure, { maxW = Infinity, maxChars = 0 } = {}) {
  const out = []; let base = 0;
  const fits = (s) => (maxW === Infinity || measure(s) <= maxW + 0.01) && (!maxChars || glen(s) <= maxChars);
  for (const para of String(text).split('\n')) {
    let line = '', start = base, pos = base;
    const push = () => out.push({ text: line.replace(/\s+$/, ''), start });
    for (const seg of words(para)) {
      if (fits((line + seg).replace(/\s+$/, ''))) { line += seg; pos += seg.length; continue; }
      if (line.trim()) push();
      const lead = seg.length - seg.replace(/^\s+/, '').length; line = seg.slice(lead); start = pos + lead; pos += seg.length;
      if (!line) { start = pos; continue; }
      if (!fits(line)) { // a single word wider than a line: split between grapheme clusters
        let cur = '', cs = start;
        for (const g of graphemes(line)) { if (cur && !fits(cur + g)) { out.push({ text: cur, start: cs }); cs += cur.length; cur = ''; } cur += g; }
        line = cur; start = cs;
      }
    }
    push(); base += para.length + 1;
  }
  return out;
}
