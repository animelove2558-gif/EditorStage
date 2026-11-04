// Smart B-Roll scoring by meaning (no imports, unit-tested by scripts/test_broll.mjs). Sentence vectors come from the
// optional multilingual sentence model (embed.worker.js); they are unit length, so the dot product is the cosine.

/** cosine similarity of two vectors (0 when either is missing or the sizes differ) */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** similarity below this is unrelated text for this model; at FULL a file scores like one matching label */
export const MIN_SIM = 0.3, FULL_SIM = 0.7;
/** score added for a sentence/file similarity: 0 below MIN_SIM, rising to 1 at FULL_SIM (more above) */
export const meaningScore = (sim) => (sim <= MIN_SIM ? 0 : (sim - MIN_SIM) / (FULL_SIM - MIN_SIM));

/** store a vector compactly in the project (4 decimals are plenty for a cosine) */
export const packVec = (v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4);

/** what a file is about, as one text for the sentence model: its name, what the detector saw, the start of its speech */
export function describeMedia(name, labels = [], words = []) {
  const n = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim();
  const seen = labels.filter((l) => l[2] === 'picture').map((l) => l[0]);
  const speech = words.slice(0, 60).map((w) => w.text).join('').trim();
  return [n, seen.length ? `shows ${seen.join(', ')}` : '', speech].filter(Boolean).join('. ');
}
