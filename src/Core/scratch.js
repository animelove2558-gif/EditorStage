// Project Settings > Scratch Disks: where captured audio / video (Voice-Over Record, Capture) and rendered previews go.
// null = the default: captures in "<project folder>/Captured" ("userData/Captured" before the first Save), previews in
// the system temp folder. A chosen folder is stored in the project (state.scratch) and used as is.
import { getState } from './store';

export const SCRATCH_KINDS = { captured: 'Captured', previews: 'Preview Files' };
const sepOf = (p) => (String(p).includes('\\') ? '\\' : '/');
const dirOf = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));

/** The folder (not created) for `kind` with the given state: { dir, isDefault }. base: { userData, temp } folders. */
export function scratchFolder(state, kind, base) {
  const custom = state.scratch?.[kind];
  if (custom) return { dir: custom, isDefault: false };
  if (kind === 'previews') return { dir: base.temp, isDefault: true };
  const root = state.projectPath ? dirOf(state.projectPath) : base.userData;
  return { dir: `${root}${sepOf(root)}${SCRATCH_KINDS[kind]}`, isDefault: true };
}
/** The folder for `kind`, created when missing. */
export async function scratchDir(kind) {
  const es = window.editorstage;
  const { dir } = scratchFolder(getState(), kind, { userData: await es.userData(), temp: await es.tmpDir() });
  await es.mkdir(dir); return dir;
}
