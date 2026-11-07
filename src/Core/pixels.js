// Raw frame helpers for the exporter (pure, no DOM).

/** Copy RGBA pixels to packed RGB (alpha dropped). rgb must hold width * height * 3 bytes. Returns rgb. */
export function rgbaToRgb(rgba, rgb) {
  for (let i = 0, o = 0, n = rgba.length; i < n; i += 4, o += 3) { rgb[o] = rgba[i]; rgb[o + 1] = rgba[i + 1]; rgb[o + 2] = rgba[i + 2]; }
  return rgb;
}
