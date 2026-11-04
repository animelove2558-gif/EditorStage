// MediaPipe Tasks (1.1.0) posts usage statistics to odml.pa.googleapis.com every minute. EditorStage is offline (the
// main process and the page's Content Security Policy block it anyway, but each attempt logs a console error), so the
// request is answered here without touching the network; the logger then stops itself.
const HOST = 'https://odml.pa.googleapis.com/';
if (typeof window !== 'undefined' && window.fetch && !window.fetch.esNoTelemetry) {
  const real = window.fetch.bind(window);
  const f = (input, init) => (String(input?.url || input).startsWith(HOST) ? Promise.resolve(new Response(null, { status: 204 })) : real(input, init));
  f.esNoTelemetry = true; window.fetch = f;
}
