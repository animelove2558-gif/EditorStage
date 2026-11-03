// WebCodecs capability probe + decode worker bridge + encoder skeleton.
export async function probeCapabilities() {
  const caps = { webcodecs: 'VideoDecoder' in window, webgl2: false, webgpu: false, wasm: typeof WebAssembly === 'object', codecs: {} };
  caps.webgl2 = !!document.createElement('canvas').getContext('webgl2');
  try { caps.webgpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { /* none */ }
  if (caps.webcodecs) {
    const tests = { 'H.264': 'avc1.640028', 'HEVC': 'hvc1.1.6.L93.B0', 'VP9': 'vp09.00.10.08', 'AV1': 'av01.0.04M.08' };
    for (const [n, codec] of Object.entries(tests)) {
      try {
        const r = await VideoDecoder.isConfigSupported({ codec, hardwareAcceleration: 'prefer-hardware' });
        caps.codecs[n] = !!r.supported;
      } catch { caps.codecs[n] = false; }
    }
  }
  return caps;
}

export function createDecoderWorker() {
  return new Worker('decoder.worker.js');
}

/** Encoder skeleton: feed VideoFrames, receive EncodedVideoChunks. Muxing (mp4/webm) is the next milestone. */
export function createEncoder({ width, height, fps, bitrate = 10_000_000, codec = 'avc1.640028' }, onChunk) {
  const enc = new VideoEncoder({ output: onChunk, error: console.error });
  enc.configure({ codec, width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' });
  return enc;
}
