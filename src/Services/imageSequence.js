// Image sequence import (frame_0001.png, frame_0002.png ...): the numbered files of one folder become one video clip.
// FFmpeg reads them through a %0Nd pattern and writes a video file into the project's Captured folder, which is then
// imported like any other media. Pure detection first (testable in Node), then the app glue.

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp', 'dpx', 'exr', 'tga']);

/**
 * Find numbered runs in a list of file names. A run is the same prefix, extension and digit count with consecutive
 * numbers. Returns [{ prefix, ext, pad, first, last, count, missing }] best (longest) first.
 */
export function findSequences(names) {
  const groups = new Map();
  for (const n of names) {
    const m = /^(.*?)(\d+)\.([A-Za-z0-9]+)$/.exec(n); if (!m || !IMG_EXT.has(m[3].toLowerCase())) continue;
    const key = `${m[1]}\u0000${m[2].length}\u0000${m[3].toLowerCase()}`; (groups.get(key) || groups.set(key, []).get(key)).push({ n: +m[2], name: n });
  }
  const out = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const [prefix, pad, ext] = key.split('\u0000'); list.sort((a, b) => a.n - b.n);
    // FFmpeg's image2 demuxer stops at the first gap: take the longest consecutive run
    let best = [], cur = [];
    for (const it of list) { if (cur.length && it.n === cur[cur.length - 1].n + 1) cur.push(it); else cur = [it]; if (cur.length > best.length) best = cur.slice(); }
    if (best.length < 2) continue;
    out.push({ prefix, ext, pad: +pad, first: best[0].n, last: best[best.length - 1].n, count: best.length, missing: list.length - best.length, firstName: best[0].name });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** FFmpeg input pattern for a run in `dir` (the separator of dir is kept): C:\frames\shot_%04d.png */
export const sequencePattern = (dir, s) => `${dir}${dir.includes('\\') ? '\\' : '/'}${s.prefix}%0${s.pad}d.${s.ext}`;

/** FFmpeg arguments that turn a run into a video: H.264 normally, VP9 with alpha when the frames have transparency. */
export function sequenceArgs(dir, s, fps, out, alpha) {
  return ['-y', '-hide_banner', '-nostdin', '-framerate', String(fps), '-start_number', String(s.first), '-i', sequencePattern(dir, s), '-frames:v', String(s.count),
    ...(alpha ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '20', '-auto-alt-ref', '0'] : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '14', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']), out];
}

/** File > Import Image Sequence...: choose the folder; the longest numbered run in it becomes one clip. */
export async function importImageSequence(notify) {
  const es = window.editorstage; const { getState } = await import('../Core/store'); const { scratchDir } = await import('../Core/scratch'); const { importPaths } = await import('./media');
  const dir = await es.pickFolder(); if (!dir) return null;
  const listing = await es.listDir(dir);
  const runs = findSequences(listing.files.length ? listing.files : []);
  if (!runs.length) { notify('No numbered image files (for example frame_0001.png, frame_0002.png) in that folder'); return null; }
  const s = runs[0]; const fps = getState().sequence.fps || 30;
  const alpha = s.ext === 'png' || s.ext === 'tif' || s.ext === 'tiff' ? !!(await es.probe(`${dir}${dir.includes('\\') ? '\\' : '/'}${s.firstName}`))?.alpha : false;
  const outDir = await scratchDir('captured'); const sep = outDir.includes('\\') ? '\\' : '/';
  const out = `${outDir}${sep}${s.prefix.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'sequence'}_${s.count}f.${alpha ? 'webm' : 'mp4'}`;
  notify(`Converting ${s.count} frames (${s.prefix}${'#'.repeat(s.pad)}.${s.ext}) at ${fps} fps...`);
  const r = await es.ffmpeg(sequenceArgs(dir, s, fps, out, alpha));
  if (!r.ok) { notify(`Image sequence import failed: ${r.error || 'FFmpeg error'}`); return null; }
  const items = await importPaths([out], notify);
  notify(`Imported ${s.count} frames as one clip${s.missing ? ` (${s.missing} frames after a gap were left out)` : ''}${runs.length > 1 ? `; ${runs.length - 1} other numbered runs in the folder were not imported` : ''}`);
  return items;
}
