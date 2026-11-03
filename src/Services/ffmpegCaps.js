// What the FFmpeg binary in use can do (Preferences > FFmpeg picks it: the bundled GPL build, or an LGPL build without
// libx264 / libx265). The main process reads `ffmpeg -version` / `-encoders` once per binary (electron/ffmpegBin.js).
let info = null;
/** { path, source: 'preferences' | 'env' | 'build' | 'bundled', version, gpl, encoders: [names] } or null (cached). */
export function ffmpegInfo(refresh = false) {
  if (refresh || !info) info = (window.editorstage?.ffmpeg && window.editorstage.ffmpegInfo ? window.editorstage.ffmpegInfo() : Promise.resolve(null)).catch(() => null);
  return info;
}
export const resetFfmpegInfo = () => { info = null; };

/** Encoders that only exist in GPL builds of FFmpeg (--enable-gpl). */
export const GPL_ENCODERS = { libx264: 'x264 (H.264)', libx264rgb: 'x264 (H.264 RGB)', libx265: 'x265 (HEVC)', libxvid: 'Xvid (MPEG-4)' };
/** The -c:v value of an argument list. */
export const videoEncoderOf = (args) => { const i = (args || []).indexOf('-c:v'); return i >= 0 ? args[i + 1] : null; };
export const needsGpl = (args) => !!GPL_ENCODERS[videoEncoderOf(args)];
/** True when the binary has the encoder (unknown binaries are assumed to have it; FFmpeg then reports the error). */
export const hasEncoder = (inf, name) => !name || !inf?.encoders || inf.encoders.includes(name);

/** Features that encode with a GPL encoder in the bundled build, for Preferences > FFmpeg. */
export const GPL_FEATURES = [
  { label: 'Export: H.264 (MP4) and the platform presets', encoder: 'libx264', codec: 'h264' },
  { label: 'Export: H.265 / HEVC (MP4), HEVC Main10', encoder: 'libx265', codec: 'hevc' },
  { label: 'Render In to Out (preview files)', encoder: 'libx264', codec: 'h264' },
  { label: 'Create Proxies: H.264', encoder: 'libx264', codec: 'h264' },
  { label: 'Import: conversion of formats Chromium cannot play', encoder: 'libx264', codec: 'h264', main: true },
];
// what the main process converts imports with when libx264 is missing (electron/media.js VIDEO_ALT)
export const IMPORT_ALT = [['libopenh264', 'OpenH264'], ['h264_mf', 'Windows Media Foundation'], ['libvpx-vp9', 'VP9 / WebM']];
