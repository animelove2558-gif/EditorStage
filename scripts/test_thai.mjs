// Thai line breaking (src/Services/textEngine.js): lines never break inside a word, long words split only between
// grapheme clusters, offsets point back into the text. Run: node scripts/test_thai.mjs
import { breakLines, words, graphemes } from '../src/Services/textEngine.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra); } };
const len = (s) => s.length; // 1 px per UTF-16 unit
const gl = (s) => graphemes(s).length;
// word boundaries (UTF-16 offsets) of a text
const bounds = (t) => { const b = new Set([0]); let o = 0; for (const w of words(t)) { o += w.length; b.add(o); } return b; };
// a break inside a word is allowed only when that word alone is longer than the line
const okBreak = (t, at, n) => { if (bounds(t).has(at)) return true; let o = 0; for (const w of words(t)) { if (at > o && at < o + w.length) return gl(w) > n; o += w.length; } return false; };
const offsetsOk = (t, ls) => ls.every((l) => t.slice(l.start, l.start + l.text.length) === l.text);

const th = 'วันนี้อากาศดีมากเราจะไปเที่ยวทะเลกันที่จังหวัดชลบุรีพร้อมครอบครัว';
for (const n of [6, 8, 12, 20]) {
  const ls = breakLines(th, len, { maxChars: n }); const b = bounds(th);
  ok(`Thai, ${n} clusters per line: every break is between words`, ls.slice(1).every((l) => okBreak(th, l.start, n)) && (n < 8 || ls.slice(1).every((l) => b.has(l.start))), JSON.stringify(ls));
  ok(`Thai, ${n} clusters per line: lines fit and join back to the text`, ls.every((l) => gl(l.text) <= n || words(l.text).length === 1) && ls.map((l) => l.text).join('') === th && offsetsOk(th, ls));
}
const lsW = breakLines(th, len, { maxW: 15 });
ok('Thai, width limit: breaks between words and every line fits', lsW.every((l) => l.text.length <= 15) && lsW.slice(1).every((l) => bounds(th).has(l.start)), JSON.stringify(lsW));
ok('Thai: words are dictionary words (อากาศ / เที่ยว / จังหวัด / ครอบครัว)', ['อากาศ', 'เที่ยว', 'จังหวัด', 'ครอบครัว'].every((w) => words(th).includes(w)), JSON.stringify(words(th)));

const longWord = 'กรุงเทพมหานครอมรรัตนโกสินทร์มหินทรายุธยา';
const lsL = breakLines(longWord, len, { maxChars: 5 });
ok('a word longer than the line is split between grapheme clusters', lsL.length > 1 && lsL.every((l) => gl(l.text) <= 5) && lsL.every((l) => !/^\p{M}/u.test(l.text)) && lsL.map((l) => l.text).join('') === longWord, JSON.stringify(lsL));
ok('grapheme clusters keep vowels and tone marks with their consonant (น้ำ, ที่ = 1 cluster; เที่ยว = เ+ที่+ย+ว)', gl('น้ำ') === 1 && gl('ที่') === 1 && gl('เที่ยว') === 4);

const en = 'The quick brown fox jumps over the lazy dog';
const lsE = breakLines(en, len, { maxW: 12 });
ok('English: breaks at spaces, no leading or trailing spaces', lsE.every((l) => l.text === l.text.trim() && l.text.length <= 12) && lsE.map((l) => l.text).join(' ') === en && offsetsOk(en, lsE), JSON.stringify(lsE));
const mixed = 'ใช้ EditorStage ตัดต่อวิดีโอ 4K ได้ฟรี';
const lsM = breakLines(mixed, len, { maxChars: 14 });
ok('mixed Thai / English / numbers: breaks between words', lsM.slice(1).every((l) => bounds(mixed).has(l.start)) && offsetsOk(mixed, lsM), JSON.stringify(lsM));
const nl = breakLines('บรรทัดแรก\nบรรทัดที่สอง', len, {});
ok('explicit newlines are kept', nl.length === 2 && nl[0].text === 'บรรทัดแรก' && nl[1].text === 'บรรทัดที่สอง' && nl[1].start === 10, JSON.stringify(nl));
ok('no limit: one line', breakLines(th, len, {}).length === 1);

console.log(`\nthai line breaking: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
