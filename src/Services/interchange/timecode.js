// SMPTE timecode <-> frames (non-drop and 29.97/59.94 drop-frame).
export const isNtsc = (fps) => Math.abs(fps * 1.001 - Math.round(fps * 1.001)) < 0.01 && Math.abs(fps - Math.round(fps)) > 0.001;
export const timebase = (fps) => Math.round(fps); // nominal frames per second used in timecode
export const dropFrameDefault = (fps) => isNtsc(fps) && (timebase(fps) === 30 || timebase(fps) === 60);

const p2 = (n) => String(n).padStart(2, '0');
export function framesToTC(frames, fps, drop = false) {
  const tb = timebase(fps); let f = Math.max(0, Math.round(frames));
  if (drop) { // add back the frame numbers skipped by drop-frame counting
    const d = tb === 60 ? 4 : 2; const per10 = tb * 600 - d * 9; const per1 = tb * 60 - d;
    const tens = Math.floor(f / per10); let rem = f % per10;
    f += d * 9 * tens + (rem > d ? d * Math.floor((rem - d) / per1) : 0);
  }
  const ff = f % tb, s = Math.floor(f / tb);
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}${drop ? ';' : ':'}${p2(ff)}`;
}
export function tcToFrames(tc, fps) {
  const m = /^(\d+):(\d+):(\d+)([:;.,])(\d+)$/.exec(String(tc).trim()); if (!m) throw new Error(`Bad timecode "${tc}"`);
  const [h, mi, s, f] = [+m[1], +m[2], +m[3], +m[5]]; const tb = timebase(fps); const drop = m[4] === ';' || m[4] === ',';
  let frames = ((h * 60 + mi) * 60 + s) * tb + f;
  if (drop) { const d = tb === 60 ? 4 : 2; const totalMin = h * 60 + mi; frames -= d * (totalMin - Math.floor(totalMin / 10)); }
  return frames;
}
