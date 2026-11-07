import { framesToTC, dropFrameDefault } from './interchange/timecode.js';
const MARKER_COLORS = [['Green', '#4caf50'], ['Red', '#e53935'], ['Purple', '#ab47bc'], ['Orange', '#ff9800'], ['Yellow', '#fdd835'], ['White', '#eeeeee'], ['Blue', '#1e88e5'], ['Cyan', '#26c6da']]; // same as Core/markers.js

const colorName = (hex) => (MARKER_COLORS.find(([, h]) => h.toLowerCase() === String(hex || '').toLowerCase()) || MARKER_COLORS[0])[0];
const cell = (v) => { const t = String(v ?? ''); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/**
 * Sequence markers as CSV for review notes: name, colour, type, in, out, duration (timecode), seconds, comment.
 * Starts with a byte order mark so Excel reads Thai text as UTF-8. Lines end with CRLF.
 */
export function markersToCsv(markers, fps = 30) {
  const drop = dropFrameDefault(fps); const tc = (t) => framesToTC(Math.round(t * fps), fps, drop);
  const rows = [['Name', 'Color', 'Type', 'In', 'Out', 'Duration', 'In (seconds)', 'Comment']];
  for (const m of [...(markers || [])].sort((a, b) => a.time - b.time)) {
    const end = m.time + (m.dur || 0);
    rows.push([m.name || '', colorName(m.color), m.type || 'comment', tc(m.time), tc(end), tc(m.dur || 0), m.time.toFixed(3), m.comment || '']);
  }
  return '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
