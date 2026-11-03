// Text "units" shared by the evaluator (expression selectors) and the text painter, so both count characters the same way.
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export const graphemes = (s) => (seg ? [...seg.segment(String(s))].map((x) => x.segment) : [...String(s)]);
export const isSpace = (g) => /^\s+$/.test(g);

/**
 * Units of a text by AE "Based On": characters (grapheme clusters, line breaks excluded), charactersExcludingSpaces, words, lines (paragraphs).
 * Returns { glyphs: [{text, line, word, char, charNoSpace}], counts: {characters, charactersExcludingSpaces, words, lines} }.
 */
export function textUnits(text) {
  const glyphs = []; let line = 0, word = -1, inWord = false, ch = 0, chNs = 0;
  for (const g of graphemes(text)) {
    if (g === '\n' || g === '\r' || g === '\r\n' || g === '\u0003') { line++; inWord = false; continue; }
    const sp = isSpace(g);
    if (!sp && !inWord) { word++; inWord = true; } else if (sp) inWord = false;
    glyphs.push({ text: g, line, word: Math.max(0, word), char: ch++, charNoSpace: sp ? -1 : chNs++, space: sp });
  }
  return { glyphs, counts: { characters: ch, charactersExcludingSpaces: chNs, words: word + 1, lines: line + 1 } };
}
export const unitOf = (g, basedOn) => (basedOn === 'words' ? g.word : basedOn === 'lines' ? g.line : basedOn === 'charactersExcludingSpaces' ? g.charNoSpace : g.char);
