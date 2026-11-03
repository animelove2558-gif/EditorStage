// Markers (Premiere): sequence markers live in seq.markers (sequence time); clip markers in clip.markers and source markers
// (added in the Source Monitor) in media.markers, both in source time so they stay on their frame when the clip moves or is
// trimmed. A marker: { id, time, dur (seconds, 0 = point), name, comment, color, type: 'comment' | 'chapter' | 'segmentation' }.

import { sourceAt } from './clipTime';

/** Premiere's eight marker colours */
export const MARKER_COLORS = [['Green', '#4caf50'], ['Red', '#e53935'], ['Purple', '#ab47bc'], ['Orange', '#ff9800'], ['Yellow', '#fdd835'], ['White', '#eeeeee'], ['Blue', '#1e88e5'], ['Cyan', '#26c6da']];
export const MARKER_TYPES = [['comment', 'Comment Marker'], ['chapter', 'Chapter Marker'], ['segmentation', 'Segmentation Marker']];
export const markerColor = (m) => m?.color || MARKER_COLORS[0][1];

/** the marker of a list that sits on time t (within half a frame), or null */
export const markerAt = (list, t, fps) => (list || []).find((m) => Math.abs(m.time - t) < 0.5 / (fps || 30)) || null;

/**
 * Markers to draw on a timeline clip: its own clip markers and its media's source markers that fall inside the clip,
 * as { m, at (sequence time), owner: 'clip' | 'media' }.
 */
export function clipMarkers(c, media, fps) {
  const out = [];
  const speed = c.speed || 1; const toSeq = (src) => c.start + (src - (c.inPoint || 0)) / speed; // forward clips; reversed clips mirror below
  const place = (m, owner) => {
    const at = c.reverse ? c.start + c.dur - (m.time - (c.inPoint || 0)) / Math.abs(speed) : toSeq(m.time);
    if (at >= c.start - 1e-6 && at < c.start + c.dur - 1e-6) out.push({ m, at, owner });
  };
  (c.markers || []).forEach((m) => place(m, 'clip'));
  if (media && !c.timeRemap?.speed?.keys) (media.markers || []).forEach((m) => place(m, 'media'));
  return out;
}

/** source time of a clip at sequence time t (where a clip marker added at the playhead goes) */
export const clipSourceTimeAt = (c, t, fps, mediaDur) => sourceAt(c, t, fps, mediaDur ?? Infinity);
