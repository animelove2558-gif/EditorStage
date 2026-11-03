import { set, getState } from './store';

// Premiere Pro vertical tools panel: each group shows its active tool, the rest sit in a flyout.
export const TOOL_GROUPS = [
  { id: 'select', tools: [{ id: 'selection', label: 'Selection Tool', key: 'v', icon: '➤' }] },
  { id: 'track', tools: [
    { id: 'trackForward', label: 'Track Select Forward Tool', key: 'a', icon: '⇥' },
    { id: 'trackBackward', label: 'Track Select Backward Tool', key: 'a', shift: true, icon: '⇤' },
  ] },
  { id: 'edit', tools: [
    { id: 'ripple', label: 'Ripple Edit Tool', key: 'b', icon: '⇔' },
    { id: 'rolling', label: 'Rolling Edit Tool', key: 'n', icon: '⇋' },
    { id: 'rate', label: 'Rate Stretch Tool', key: 'r', icon: '⏱' },
    { id: 'remix', label: 'Remix Tool', key: null, icon: '♫' }, // drag the end of a music clip: re-edits the music to that length
  ] },
  { id: 'razor', tools: [{ id: 'razor', label: 'Razor Tool', key: 'c', icon: '✂' }] },
  { id: 'slip', tools: [
    { id: 'slip', label: 'Slip Tool', key: 'y', icon: '↔' },
    { id: 'slide', label: 'Slide Tool', key: 'u', icon: '⇄' },
  ] },
  { id: 'pen', tools: [
    { id: 'pen', label: 'Pen Tool', key: 'p', icon: '✒' },
    { id: 'rect', label: 'Rectangle Tool', key: null, icon: '▭' },
    { id: 'ellipse', label: 'Ellipse Tool', key: null, icon: '◯' },
    { id: 'polygon', label: 'Polygon Tool', key: null, icon: '⬠' },
  ] },
  { id: 'hand', tools: [
    { id: 'hand', label: 'Hand Tool', key: 'h', icon: '✋' },
    { id: 'zoom', label: 'Zoom Tool', key: 'z', icon: '🔍' },
  ] },
  { id: 'type', tools: [
    { id: 'type', label: 'Type Tool', key: 't', icon: 'T' },
    { id: 'vtype', label: 'Vertical Type Tool', key: null, icon: 'Ꞁ' },
  ] },
];

export const TOOLS = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => ({ ...t, group: g.id })));

/** Activate a tool and make it the visible tool of its group. */
export function selectTool(id) {
  const t = TOOLS.find((x) => x.id === id);
  if (!t) return;
  set((s) => ({ tool: id, groupTool: { ...s.groupTool, [t.group]: id } }));
}
export const toolLabel = (id) => TOOLS.find((t) => t.id === id)?.label ?? id;
export { getState };
