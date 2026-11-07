// The eviction rule shared by the element pool and the compositor's texture caches (audit C-04, C-05). Run: node scripts/test_lru.mjs
import { lruVictims } from '../src/Core/lru.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const it = (key, used, o = {}) => ({ key, used, ...o });

ok('nothing to do under the caps', same(lruVictims([it('a', 1), it('b', 2)], { maxCount: 2 }), []));
ok('oldest goes first', same(lruVictims([it('a', 3), it('b', 1), it('c', 2)], { maxCount: 1 }), ['b', 'c']));
ok('pinned stays and counts towards the cap', same(lruVictims([it('a', 1, { pinned: true }), it('b', 2), it('c', 3)], { maxCount: 2 }), ['b']));
ok('all pinned: over the cap rather than evict', same(lruVictims([it('a', 1, { pinned: true }), it('b', 2, { pinned: true })], { maxCount: 1 }), []));
ok('byte budget', same(lruVictims([it('a', 1, { bytes: 60 }), it('b', 2, { bytes: 60 }), it('c', 3, { bytes: 60 })], { maxBytes: 100 }), ['a', 'b']));
ok('count and bytes together', same(lruVictims([it('a', 1, { bytes: 10 }), it('b', 2, { bytes: 90 }), it('c', 3, { bytes: 10 })], { maxCount: 3, maxBytes: 50 }), ['a', 'b']));
ok('no limits, nothing goes', same(lruVictims([it('a', 1, { bytes: 1e12 })]), []));

// a long walk through many clips stays at the cap, and the last ones used are the ones kept
const set = new Map(); const cap = 12;
for (let i = 0; i < 2000; i++) {
  set.set(`c${i}`, i);
  const items = [...set].map(([key, used]) => ({ key, used, pinned: used >= i - 1 }));
  for (const k of lruVictims(items, { maxCount: cap })) set.delete(k);
  if (set.size > cap) { ok('walk stays at the cap', false, `${set.size} at ${i}`); break; }
}
ok('walk ends with the newest entries', set.size === cap && set.has('c1999') && set.has('c1988') && !set.has('c1987'), [...set.keys()].join());

console.log(`lru: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
