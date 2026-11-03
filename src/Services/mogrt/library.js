import { loadMogrtPackage, decodeControls } from './package';

// Installed templates: file in userData/mogrt-library, parsed package cached in memory.
const cache = new Map(); // libId -> Promise<entry>

export function openMogrt(libId) {
  if (!cache.has(libId)) {
    cache.set(libId, (async () => {
      const bytes = await window.editorstage.mogrt.read(libId);
      const pkg = await loadMogrtPackage(bytes);
      const controls = decodeControls(pkg.definition);
      return { libId, pkg, controls, thumbUrl: pkg.thumbPng ? URL.createObjectURL(pkg.thumbPng) : null, videoUrl: pkg.thumbMp4 ? URL.createObjectURL(pkg.thumbMp4) : null };
    })().catch((e) => { cache.delete(libId); throw e; }));
  }
  return cache.get(libId);
}
export async function listInstalled() {
  const files = await window.editorstage.mogrt.list();
  const out = [];
  for (const f of files) { try { out.push(await openMogrt(f.id)); } catch (e) { out.push({ libId: f.id, error: String(e.message || e) }); } }
  return out;
}
export async function installMogrt(srcPath) {
  const { id } = await window.editorstage.mogrt.install(srcPath);
  return openMogrt(id);
}
export async function removeMogrt(libId) { await window.editorstage.mogrt.remove(libId); cache.delete(libId); }
