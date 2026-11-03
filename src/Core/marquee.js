// Marquee selection on the timeline (Premiere): drag a box from an empty spot with the Selection tool; every clip the box
// touches, even partly, is selected, across video, audio and caption tracks. Clips on locked tracks are left out.

/**
 * Ids of the clips a box touches. rows: the timeline rows top to bottom, { trackId (null for a new-track row), h };
 * box: { x0, y0, x1, y1 } in timeline content pixels (x from time 0, y from the top of the first row).
 */
export function clipsInBox(seq, rows, box, pps) {
  const left = Math.min(box.x0, box.x1), right = Math.max(box.x0, box.x1);
  const top = Math.min(box.y0, box.y1), bottom = Math.max(box.y0, box.y1);
  const hitTracks = new Set(); let y = 0;
  for (const r of rows) {
    if (r.trackId && y < bottom && y + r.h > top) hitTracks.add(r.trackId);
    y += r.h;
  }
  const locked = new Set(seq.tracks.filter((t) => t.locked).map((t) => t.id));
  return seq.clips.filter((c) => hitTracks.has(c.track) && !locked.has(c.track) && c.start * pps < right && (c.start + c.dur) * pps > left).map((c) => c.id);
}
