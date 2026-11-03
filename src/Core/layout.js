import { Model, Actions, DockLocation } from 'flexlayout-react';
import { getState, set } from './store';

export const PANELS = [
  { id: 'audioClipMixer', name: 'Audio Clip Mixer' },
  { id: 'audioTrackMixer', name: 'Audio Track Mixer' },
  { id: 'effectControls', name: 'Effect Controls' },
  { id: 'effects', name: 'Effects' },
  { id: 'essentialGraphics', name: 'Essential Graphics' },
  { id: 'essentialSound', name: 'Essential Sound' },
  { id: 'history', name: 'History' },
  { id: 'info', name: 'Info' },
  { id: 'libraries', name: 'Libraries' },
  { id: 'lumetriColor', name: 'Lumetri Color' },
  { id: 'lumetriScopes', name: 'Lumetri Scopes' },
  { id: 'markers', name: 'Markers' },
  { id: 'mediaBrowser', name: 'Media Browser' },
  { id: 'metadata', name: 'Metadata' },
  { id: 'program', name: 'Program Monitor' },
  { id: 'project', name: 'Project' },
  { id: 'source', name: 'Source Monitor' },
  { id: 'text', name: 'Text' },
  { id: 'create', name: 'Create' },
  { id: 'timeline', name: 'Timeline' },
  { id: 'smartTools', name: 'Smart Tools' },
  { id: 'archive', name: 'Cold Archive Manager' },
  { id: 'versions', name: 'Version History' },
  { id: 'learn', name: 'Learn' },
  // dialogs-as-panels (not listed in Window menu)
  { id: 'find', name: 'Find', hidden: true },
].map((p) => ({ ...p, hidden: !!p.hidden }));

export const panelName = (id) => PANELS.find((p) => p.id === id)?.name ?? id;
const tab = (id) => ({ type: 'tab', id, name: panelName(id), component: id, enableClose: true });
const tabset = (weight, ids, extra = {}) => ({ type: 'tabset', weight, children: ids.map(tab), ...extra });
const row = (weight, children) => ({ type: 'row', weight, children });

const RAIL = ['lumetriColor', 'lumetriScopes', 'essentialGraphics', 'essentialSound'];
const LEFT_TOP = ['source', 'effectControls', 'audioClipMixer', 'metadata'];
const LEFT_BOTTOM = ['project', 'mediaBrowser', 'libraries', 'info', 'effects', 'create', 'history', 'markers', 'smartTools'];

/**
 * Premiere "Editing" layout:
 *   top:    [Source|Effect Controls|Audio Clip Mixer|Metadata] [Program Monitor] ([right rail])
 *   bottom: [Project|Media Browser|Libraries|Info|Effects|History|Markers] [Timeline (+vertical tools)]
 * The right rail tabset has id "rail" so View > Toggle Right Panel Rail works for every workspace.
 */
function build({ top = LEFT_TOP, rail = true, railTabs = RAIL, bottom = LEFT_BOTTOM } = {}) {
  // a panel lives in one place only (FlexLayout tab ids must be unique): the rail wins, then the top group
  const inRail = new Set(rail ? railTabs : []);
  top = top.filter((id) => !inRail.has(id)); bottom = bottom.filter((id) => !inRail.has(id) && !top.includes(id));
  return {
    global: { tabEnableClose: true, tabSetEnableMaximize: true, splitterSize: 4 },
    layout: row(100, [row(100, [
      row(55, [
        tabset(30, top),
        tabset(rail ? 40 : 70, ['program']),
        ...(rail ? [tabset(24, railTabs, { id: 'rail' })] : []),
      ]),
      row(45, [
        tabset(26, bottom),
        tabset(74, ['timeline']),
      ]),
    ])]),
  };
}
const VISIBLE = () => PANELS.filter((p) => !p.hidden).map((p) => p.id);

export const WORKSPACE_CONFIGS = {
  // every panel docked somewhere
  allPanels: () => {
    const railTabs = [...RAIL, 'audioTrackMixer'];
    const placed = new Set([...LEFT_TOP, 'program', 'timeline', ...railTabs]);
    return build({ railTabs, bottom: VISIBLE().filter((id) => !placed.has(id)) });
  },
  audio: () => build({ top: ['audioClipMixer', 'effectControls', 'source', 'metadata'], railTabs: ['essentialSound', 'audioTrackMixer', 'lumetriScopes'] }),
  color: () => build({ top: ['source', 'effectControls', 'audioClipMixer', 'metadata'], railTabs: ['lumetriColor', 'lumetriScopes', 'essentialGraphics', 'essentialSound'] }),
  editing: () => build(),
  effects: () => build({ top: ['effectControls', 'source', 'audioClipMixer', 'metadata'], railTabs: ['effects', 'lumetriColor'] }),
  // Essential Graphics docked full height on the right (Browse / Edit), Program + Timeline in the middle
  essentialGraphics: () => ({
    global: { tabEnableClose: true, tabSetEnableMaximize: true, splitterSize: 4 },
    layout: row(100, [
      row(75, [
        row(58, [tabset(28, ['effectControls', 'project', 'effects', 'source']), tabset(72, ['program'])]),
        row(42, [tabset(22, ['history', 'markers', 'mediaBrowser']), tabset(78, ['timeline'])]),
      ]),
      tabset(25, ['essentialGraphics', 'lumetriColor', 'essentialSound'], { id: 'rail' }),
    ]),
  }),
  graphics: () => build({ top: ['effectControls', 'source', 'audioClipMixer', 'metadata'], railTabs: ['essentialGraphics', 'effects'] }),
  // Learn panel (offline guided lessons) docked full height on the left
  learning: () => ({
    global: { tabEnableClose: true, tabSetEnableMaximize: true, splitterSize: 4 },
    layout: row(100, [
      tabset(22, ['learn', 'project', 'effects']),
      row(78, [
        row(55, [tabset(35, ['source', 'effectControls']), tabset(65, ['program'])]),
        row(45, [tabset(100, ['timeline'])]),
      ]),
    ]),
  }),
};

let model = Model.fromJson(build());
let current = 'editing';
let rev = 0;
const subs = new Set();
export const getModel = () => model;
export const onModelReset = (cb) => (subs.add(cb), () => subs.delete(cb));
const reset = () => { rev++; subs.forEach((cb) => cb(rev)); };

export function loadWorkspace(name) {
  current = WORKSPACE_CONFIGS[name] ? name : 'editing';
  model = Model.fromJson(WORKSPACE_CONFIGS[current]());
  set({ railOpen: JSON.stringify(WORKSPACE_CONFIGS[current]()).includes('"id":"rail"') });
  reset();
}

/** Remove the tabset with id "rail" from a layout config; its weight goes to the previous sibling. Returns true if found. */
function dropRail(node) {
  const kids = node.children || []; const i = kids.findIndex((k) => k.id === 'rail');
  if (i >= 0) { const [r] = kids.splice(i, 1); const nb = kids[Math.max(0, i - 1)]; if (nb) nb.weight = (nb.weight || 0) + (r.weight || 0); return true; }
  return kids.some(dropRail);
}
/** Show/hide the right-most collapsible rail (Lumetri / Essential panels). */
export function toggleRail() {
  const cfg = WORKSPACE_CONFIGS[current]();
  const open = !getState().railOpen;
  if (!open && !dropRail(cfg.layout)) return; // this workspace has no rail
  model = Model.fromJson(cfg);
  set({ railOpen: open });
  reset();
}
/** File > Close: close the selected panel of the active tab group. Returns false when no panel is active. */
export function closeActivePanel() {
  const ts = model.getActiveTabset?.(); const n = ts?.getSelectedNode?.();
  if (!n) return false;
  model.doAction(Actions.deleteTab(n.getId())); return true;
}

/** Show a panel (Window menu or dialog request). Focus if already open, else add to the first tabset. */
export function requestPanel(id) {
  let found = null;
  model.visitNodes((n) => { if (n.getType() === 'tab' && n.getComponent() === id) found = n; });
  if (found) { model.doAction(Actions.selectTab(found.getId())); return; }
  let target = null;
  model.visitNodes((n) => { if (!target && n.getType() === 'tabset') target = n; });
  if (target) model.doAction(Actions.addNode(tab(id), target.getId(), DockLocation.CENTER, -1, true));
}
