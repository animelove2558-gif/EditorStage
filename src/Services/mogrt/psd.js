// Minimal Photoshop (.psd / .psb) reader: decodes the flattened composite image ("image data" section) to RGBA.
// Supports RGB / Grayscale / CMYK (approximate), 8 and 16 bit, raw and PackBits (RLE) compression.

export function decodePsd(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = 0;
  const u16 = () => { const v = dv.getUint16(p); p += 2; return v; }, u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
  if (u32() !== 0x38425053) throw new Error('not a PSD'); // '8BPS'
  const version = u16(); const big = version === 2; p += 6;
  const channels = u16(), height = u32(), width = u32(), depth = u16(), mode = u16();
  const skip = (n) => { p += n; };                         // (not "p += u32()": u32 itself advances p)
  skip(u32());                                             // color mode data
  skip(u32());                                             // image resources
  if (big) { const hi = u32(), lo = u32(); skip(hi * 2 ** 32 + lo); } else skip(u32()); // layer & mask info
  const comp = u16(); const bpc = depth === 16 ? 2 : depth === 1 ? 0.125 : 1;
  const rowBytes = Math.ceil(width * bpc); const planes = [];
  if (comp === 0) {
    for (let c = 0; c < channels; c++) { planes.push(u8.subarray(p, p + rowBytes * height)); p += rowBytes * height; }
  } else if (comp === 1) {
    const counts = []; for (let i = 0; i < channels * height; i++) counts.push(big ? u32() : u16());
    for (let c = 0; c < channels; c++) {
      const out = new Uint8Array(rowBytes * height);
      for (let y = 0; y < height; y++) {
        const end = p + counts[c * height + y]; let o = y * rowBytes;
        while (p < end && o < (y + 1) * rowBytes) {
          const n = (u8[p++] << 24) >> 24;
          if (n >= 0) { out.set(u8.subarray(p, p + n + 1), o); p += n + 1; o += n + 1; }
          else if (n !== -128) { out.fill(u8[p++], o, o + 1 - n); o += 1 - n; }
        }
        p = end;
      }
      planes.push(out);
    }
  } else throw new Error('PSD: unsupported (ZIP) compression');
  const px = new Uint8ClampedArray(width * height * 4);
  const get = (c, i) => { const pl = planes[c]; if (!pl) return 255; if (depth === 16) return pl[i * 2]; if (depth === 1) return (pl[(i / width | 0) * rowBytes + ((i % width) >> 3)] >> (7 - (i % 8))) & 1 ? 0 : 255; return pl[i]; };
  for (let i = 0; i < width * height; i++) {
    let r, g, b, a = 255;
    if (mode === 3) { r = get(0, i); g = get(1, i); b = get(2, i); if (channels > 3) a = get(3, i); }
    else if (mode === 4) { const C = 255 - get(0, i), M = 255 - get(1, i), Y = 255 - get(2, i), K = 255 - get(3, i); r = 255 - Math.min(255, C + K); g = 255 - Math.min(255, M + K); b = 255 - Math.min(255, Y + K); r = 255 - ((255 - r)); g = 255 - ((255 - g)); b = 255 - ((255 - b)); if (channels > 4) a = get(4, i); }
    else { r = g = b = get(0, i); if (channels > 1) a = get(1, i); }
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = a;
  }
  return new ImageData(px, width, height);
}
