// WebGPU backend skeleton. Falls back to WebGLRenderer when unavailable.
export async function createGPUContext(canvas) {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });
  return { device, context, format };
}
// TODO: port effect passes to WGSL compute/render pipelines using GPUExternalTexture from VideoFrame.
