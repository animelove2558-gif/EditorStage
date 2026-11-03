// Decode worker: receives encoded chunks, returns VideoFrames (transferred, zero-copy).
let decoder = null;

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case 'configure': {
      decoder?.close();
      decoder = new VideoDecoder({
        output: (frame) => { self.postMessage({ type: 'frame', frame, timestamp: frame.timestamp }, [frame]); },
        error: (e) => self.postMessage({ type: 'error', message: String(e) }),
      });
      decoder.configure(data.config);
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'chunk':
      decoder?.decode(new EncodedVideoChunk(data.chunk));
      break;
    case 'flush':
      await decoder?.flush();
      self.postMessage({ type: 'flushed' });
      break;
    case 'close':
      decoder?.close(); decoder = null;
      break;
  }
};
