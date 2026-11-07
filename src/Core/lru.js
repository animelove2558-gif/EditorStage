// One eviction rule for everything that holds decoders or GPU memory per clip (media.js element pool, Compositor textures).

/**
 * Which items to free so the set fits its limits. items: [{ key, used (bigger = more recent), bytes?, pinned? }].
 * Pinned items are never chosen but do count towards the limits, so a set of pinned items can stay over them.
 * Returns the keys to free, least recently used first.
 */
export function lruVictims(items, { maxCount = Infinity, maxBytes = Infinity } = {}) {
  let count = items.length, bytes = 0;
  for (const it of items) bytes += it.bytes || 0;
  if (count <= maxCount && bytes <= maxBytes) return [];
  const out = [];
  for (const it of items.filter((x) => !x.pinned).sort((a, b) => a.used - b.used)) {
    if (count <= maxCount && bytes <= maxBytes) break;
    out.push(it.key); count--; bytes -= it.bytes || 0;
  }
  return out;
}
