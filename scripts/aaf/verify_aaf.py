# Dev check (not shipped): read an AAF written by EditorStage with pyaaf2 (MIT, pip install pyaaf2) and print OK when
# the composition, master / source mobs, slot lengths and embedded essence are consistent. Used by scripts/test_aaf.mjs
# when AAF_PYTHON points at a Python that has pyaaf2.
import sys
import aaf2

f = aaf2.open(sys.argv[1], 'r')
mobs = {m.mob_id: m for m in f.content.mobs}
top = list(f.content.toplevel())
assert len(top) == 1, 'one top-level composition'
comp = top[0]
essence = {e.mob_id: e for e in f.content.essencedata}
for slot in comp.slots:
    seg = slot.segment
    if isinstance(seg, aaf2.components.Timecode):
        continue
    total = 0
    for c in seg.components:
        total += c.length
        if isinstance(c, aaf2.components.SourceClip):
            master = mobs[c['SourceID'].value]
            assert isinstance(master, aaf2.mobs.MasterMob), 'clip refers to a master mob'
            src_clip = master.slot_at(1).segment
            source = mobs[src_clip['SourceID'].value]
            assert isinstance(source, aaf2.mobs.SourceMob), 'master refers to a source mob'
            d = source.descriptor
            n = d['Length'].value
            assert c.start + c.length <= n, 'clip inside its media'
            data = essence[source.mob_id].open('r').read()
            assert len(data) == n * d['BlockAlign'].value, 'essence size matches the descriptor'
    assert total == seg.length, 'sequence length = sum of its components'
print('OK', len(comp.slots), 'slots', len(mobs), 'mobs', len(essence), 'essence')
