import { PANELS } from './layout';
import { canEditInAudioStage } from '../Services/audiostage';
import { getState } from './store';
import { isLinkedSelection, LABELS } from './commands';

/** Clip > Enable is checked while every selected clip is enabled (one state for the selection) */
export const clipEnabledState = () => { const s = getState(); const cs = s.sequence.clips.filter((c) => s.selection.includes(c.id)); return cs.length > 0 && cs.every((c) => c.enabled !== false); };

const S = '-';
const m = (label, cmd, shortcut, when) => ({ label, cmd, shortcut, when });
const sub = (label, children) => ({ label, children });
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '');
/** Build items whose command id is `<prefix>.<Label slug>` */
const list = (prefix, labels) => labels.map((l) => m(l, `${prefix}.${slug(l)}`));

const selClips = () => { const s = getState(); return s.sequence.clips.filter((c) => s.selection.includes(c.id)); };
const anySel = () => selClips().length > 0;
const mediaSel = () => selClips().some((c) => c.mediaId);
const check = (it, fn) => ({ ...it, checked: fn });
/** Scale to Frame Size is checked while every selected media clip is fitted to the frame */
const scaledToFrame = () => { const cs = selClips().filter((c) => c.mediaId); return cs.length > 0 && cs.every((c) => c.scaleToFrame !== false); };
const sampled = (mode) => () => { const cs = selClips().filter((c) => c.mediaId); return cs.length > 0 && cs.every((c) => (c.frameSampling || 'sample') === mode); };
const labelSub = () => sub('Label', [...LABELS.map(([n, hex]) => ({ ...m(n, 'clip.label'), arg: hex, swatch: hex })), S, m('Select Label Group', 'clip.selectLabelGroup')]);
const replaceSub = () => sub('Replace With Clip', [m('From Source Monitor', 'clip.replaceFromSource', undefined, mediaSel), m('From Bin', 'clip.replaceFromBin', undefined, mediaSel)]);
const timeInterpSub = () => sub('Time Interpolation', [check({ ...m('Frame Sampling', 'clip.timeInterpolation', undefined, mediaSel), arg: 'sample' }, sampled('sample')), check({ ...m('Frame Blending', 'clip.timeInterpolation', undefined, mediaSel), arg: 'blend' }, sampled('blend')), check({ ...m('Optical Flow', 'clip.timeInterpolation', undefined, mediaSel), arg: 'flow' }, sampled('flow'))]);
const multicamSub = () => sub('Multi-Camera', [m('Create Multi-Camera Source Sequence...', 'clip.multicamCreate'), m('Enable', 'clip.multicamEnable'), m('Toggle Multi-Camera View', 'clip.multicamView'), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => m(`Camera ${n}`, `clip.multicam${n}`, String(n)))]);

/**
 * Right-click menu of a timeline clip (Premiere order). top: groups 1-8, tail: the audio Smart Tools; the Timeline puts its
 * own keyframe / speed items between them. kind = kind of the clicked clip's track.
 */
export function clipContextMenu(kind) {
  const video = kind === 'video';
  const top = [
    m('Cut', 'edit.cut', 'Ctrl+X', anySel), m('Copy', 'edit.copy', 'Ctrl+C', anySel), m('Paste Attributes...', 'edit.pasteAttributes', 'Ctrl+Alt+V'), m('Remove Attributes...', 'edit.removeAttributes', undefined, anySel),
    m('Clear', 'edit.clear', 'Delete', anySel), m('Ripple Delete', 'edit.rippleDelete', 'Shift+Delete', anySel), S,
    m('Edit in AudioStage', 'edit.audiostage', 'Ctrl+Alt+A', canEditInAudioStage), m('Edit Original', 'clip.editOriginal', undefined, mediaSel), replaceSub(), S,
    check(m('Enable', 'clip.enable', 'Shift+E', anySel), clipEnabledState), m(() => (isLinkedSelection() ? 'Unlink' : 'Link'), 'clip.linkToggle', 'Ctrl+L', anySel),
    m('Group', 'clip.group', 'Ctrl+G', anySel), m('Ungroup', 'clip.ungroup', 'Ctrl+Shift+G', anySel), m('Synchronize...', 'clip.synchronize', undefined, anySel),
    m('Nest...', 'clip.nest', undefined, anySel), m('Make Subsequence', 'clip.makeSubsequence', 'Shift+U', anySel), multicamSub(), S,
    labelSub(), S,
    m('Speed/Duration...', 'clip.speed', 'Ctrl+R', anySel), ...(video ? [m('Scene Edit Detection...', 'clip.sceneEditDetection')] : []),
    m('Audio Gain...', 'clip.audioGain', 'G', anySel), m('Audio Channels...', 'clip.audioChannels', 'Shift+G', anySel), S,
    ...(video ? [m('Frame Hold Options...', 'clip.frameHold'), m('Add Frame Hold', 'clip.addFrameHold'), m('Insert Frame Hold Segment', 'clip.insertFrameHold'), m('Field Options...', 'clip.fieldOptions'), timeInterpSub(), S,
      check(m('Scale to Frame Size', 'clip.scaleToFrame', undefined, mediaSel), scaledToFrame), m('Set to Frame Size', 'clip.setToFrame', undefined, mediaSel), S] : []),
    m('Rename...', 'clip.rename', undefined, anySel), m('Make Subclip...', 'clip.makeSubclip', 'Ctrl+U', mediaSel), m('Reveal in Project', 'clip.revealInProject', undefined, mediaSel),
    m('Reveal in Explorer', 'clip.revealInExplorer', undefined, mediaSel), m('Properties...', 'clip.properties', undefined, anySel),
  ];
  const tail = kind === 'audio' ? [m('Remix...', 'clip.remix', undefined, anySel), sub('Smart Tools', [m('Auto-Cut Silence...', 'ai.autoCut'), m('Generate Subtitles...', 'ai.subtitles'), m('Separate Speakers to Tracks...', 'ai.diarize')])] : [];
  return { top, tail };
}

export const MENUS = [
  { label: 'File', items: [
    sub('New', [m('Project...', 'file.newProject', 'Ctrl+Alt+N'), m('Sequence...', 'file.newSequence', 'Ctrl+N'), m('Bin', 'file.newBin', 'Ctrl+/'), m('Search Bin', 'file.newSearchBin'), S, m('Adjustment Layer...', 'file.newAdjustmentLayer'), m('Bars and Tone...', 'file.newBarsAndTone'), m('Black Video...', 'file.newBlackVideo'), m('Color Matte...', 'file.newColorMatte'), m('Universal Counting Leader...', 'file.newCountdown'), m('Transparent Video...', 'file.newTransparentVideo')]),
    m('Open Project...', 'file.open', 'Ctrl+O'),
    { label: 'Open Recent', dynamic: 'recent' },
    m('Close', 'file.close', 'Ctrl+W'), m('Close Project', 'file.closeProject', 'Ctrl+Shift+W'), S,
    m('Save', 'file.save', 'Ctrl+S'), m('Save As...', 'file.saveAs', 'Ctrl+Shift+S'), m('Save a Copy...', 'file.saveCopy', 'Ctrl+Alt+S'), m('Revert', 'file.revert'), S,
    m('Save Revision...', 'file.saveRevision', 'Ctrl+Alt+R'), m('Version History...', 'panel.versions'), m('Cold Archive Manager...', 'panel.archive'), S,
    m('Capture...', 'file.capture', 'F5'), m('Import...', 'file.import', 'Ctrl+I'), m('Import Sequence (XML / FCPXML / EDL)...', 'file.importSequence'), S,
    m('Link Media...', 'file.linkMedia'), m('Make Offline...', 'file.makeOffline'),
    sub('Proxy', [m('Create Proxies...', 'media.createProxies'), m('Attach Proxies...', 'media.attachProxy'), m('Reconnect Full Resolution Media (Detach Proxy)', 'media.detachProxy'), S, m('Toggle Proxies', 'view.toggleProxies')]), S,
    sub('Export', [
      m('Media...', 'file.exportMedia', 'Ctrl+M'), m('Export Queue...', 'file.exportQueue'), m('Project Health Check...', 'file.healthCheck'), m('Frame...', 'file.exportFrame', 'Ctrl+Shift+E'), m('Selection as Premiere XML (FCP7 XML)...', 'file.exportSelection'), S,
      // OMF is not offered (AAF replaces it); AAF carries the audio tracks with embedded PCM for a DAW
      m('Final Cut Pro XML (FCPXML 1.9)...', 'file.exportFCPXML'), m('EDL (CMX3600)...', 'file.exportEDL'), m('AAF (Embedded Audio)...', 'file.exportAAF'),
    ]),
    sub('Project Settings', [m('General...', 'file.projSettings.general'), m('Scratch Disks...', 'file.projSettings.scratch'), m('Ingest Settings...', 'file.projSettings.ingest')]), S,
    m('Exit', 'app.quit', 'Ctrl+Q'),
  ] },
  { label: 'Edit', items: [
    m('Undo', 'edit.undo', 'Ctrl+Z'), m('Redo', 'edit.redo', 'Ctrl+Shift+Z'), S,
    m('Cut', 'edit.cut', 'Ctrl+X'), m('Copy', 'edit.copy', 'Ctrl+C'), m('Paste', 'edit.paste', 'Ctrl+V'),
    m('Paste Insert', 'edit.pasteInsert', 'Ctrl+Shift+V'), m('Paste Attributes...', 'edit.pasteAttributes', 'Ctrl+Alt+V'),
    m('Remove Attributes...', 'edit.removeAttributes'), m('Clear', 'edit.clear', 'Delete'), m('Ripple Delete', 'edit.rippleDelete', 'Shift+Delete'), S,
    m('Duplicate', 'edit.duplicate', 'Ctrl+Shift+/'), m('Select All', 'edit.selectAll', 'Ctrl+A'), m('Deselect All', 'edit.deselectAll', 'Ctrl+Shift+A'), S,
    m('Find...', 'edit.find', 'Ctrl+F'), S,
    m('Edit in AudioStage', 'edit.audiostage', 'Ctrl+Alt+A', canEditInAudioStage), m('Edit in Adobe Audition', 'edit.audition'), S,
    m('Keyboard Shortcuts...', 'edit.shortcuts', 'Ctrl+Alt+K'), m('Preferences...', 'edit.preferences'),
  ] },
  { label: 'Clip', items: [
    m('Rename...', 'clip.rename'), m('Make Subsequence', 'clip.makeSubsequence', 'Shift+U'), m('Make Subclip...', 'clip.makeSubclip', 'Ctrl+U'), m('Edit Subclip...', 'clip.editSubclip'), S,
    sub('Audio Options', [m('Audio Gain...', 'clip.audioGain', 'G'), m('Audio Channels...', 'clip.audioChannels', 'Shift+G')]),
    sub('Video Options', [m('Frame Hold Options...', 'clip.frameHold'), m('Add Frame Hold', 'clip.addFrameHold'), m('Insert Frame Hold Segment', 'clip.insertFrameHold'), S, m('Field Options...', 'clip.fieldOptions'), timeInterpSub(), S,
      check(m('Scale to Frame Size', 'clip.scaleToFrame', undefined, mediaSel), scaledToFrame), m('Set to Frame Size', 'clip.setToFrame', undefined, mediaSel)]),
    m('Speed/Duration...', 'clip.speed', 'Ctrl+R'), m('Remix...', 'clip.remix'), m('Track Object (Point Tracker)...', 'clip.trackObject'), m('Scene Edit Detection...', 'clip.sceneEditDetection'), S,
    sub('Nudge', [m('Nudge Clip Selection Up', 'clip.nudgeUp', 'Alt+Up'), m('Nudge Clip Selection Down', 'clip.nudgeDown', 'Alt+Down'), S,
      m('Nudge Clip Selection Left 1 Frame', 'clip.nudgeLeft', 'Alt+Left'), m('Nudge Clip Selection Right 1 Frame', 'clip.nudgeRight', 'Alt+Right'),
      m('Nudge Clip Selection Left 5 Frames', 'clip.nudgeLeft5', 'Alt+Shift+Left'), m('Nudge Clip Selection Right 5 Frames', 'clip.nudgeRight5', 'Alt+Shift+Right')]), S,
    m('Remove Effects...', 'clip.removeEffects'), check(m('Enable', 'clip.enable', 'Shift+E'), clipEnabledState), m(() => (isLinkedSelection() ? 'Unlink' : 'Link'), 'clip.linkToggle', 'Ctrl+L'),
    m('Group', 'clip.group', 'Ctrl+G'), m('Ungroup', 'clip.ungroup', 'Ctrl+Shift+G'), S,
    m('Synchronize', 'clip.synchronize'), m('Nest...', 'clip.nest'),
    multicamSub(), S, replaceSub(), labelSub(), S,
    m('Edit Original', 'clip.editOriginal', undefined, mediaSel), m('Reveal in Project', 'clip.revealInProject', undefined, mediaSel), m('Reveal in Explorer', 'clip.revealInExplorer', undefined, mediaSel), m('Properties...', 'clip.properties', undefined, anySel),
  ] },
  { label: 'Sequence', items: [
    m('Sequence Settings...', 'seq.settings'), S,
    m('Render Effects In to Out', 'seq.renderEffects', 'Enter'), m('Render In to Out', 'seq.renderInOut'), m('Render Audio', 'seq.renderAudio'), m('Delete Render Files', 'seq.deleteRender'), S,
    m('Match Frame', 'seq.matchFrame', 'F'), m('Add Edit', 'seq.addEdit', 'Ctrl+K'), m('Add Edit to All Tracks', 'seq.addEditAll', 'Ctrl+Shift+K'), S,
    m('Apply Video Transition', 'seq.videoTransition', 'Ctrl+D'), m('Apply Audio Transition', 'seq.audioTransition', 'Ctrl+Shift+D'),
    m('Apply Default Transitions to Selection', 'seq.defaultTransitions', 'Shift+D'), S,
    m('Lift', 'seq.lift', ';'), m('Extract', 'seq.extract', "'"), S,
    m('Ripple Trim Previous Edit to Playhead', 'seq.rippleTrimPrev', 'Q'), m('Ripple Trim Next Edit to Playhead', 'seq.rippleTrimNext', 'W'),
    m('Trim Previous Edit to Playhead', 'seq.trimPrev', 'Alt+Q'), m('Trim Next Edit to Playhead', 'seq.trimNext', 'Alt+W'),
    m('Trim Edit', 'seq.trimMode', 'Shift+T'), m('Extend Selected Edit to Playhead', 'seq.extendEdit', 'E'), m('Select Clip at Playhead', 'seq.selectAtPlayhead', 'D'), S,
    m('Zoom In', 'seq.zoomIn', '='), m('Zoom Out', 'seq.zoomOut', '-'), S,
    m('Snap in Timeline', 'seq.snap', 'S'), m('Linked Selection', 'seq.linked', 'Ctrl+Shift+L'), S,
    m('Add Video Track', 'timeline.addTrack.video'), m('Add Audio Track', 'timeline.addTrack.audio'), m('Add Caption Track', 'timeline.addCaptionTrack'), m('Delete Empty Tracks', 'timeline.deleteEmptyTracks'), S,
    m('Expand All Tracks', 'timeline.expandTracks'), m('Minimize All Tracks', 'timeline.minimizeTracks'),
  ] },
  { label: 'Markers', items: [
    m('Mark In', 'marker.markIn', 'I'), m('Mark Out', 'marker.markOut', 'O'), m('Mark Clip', 'marker.markClip', 'X'), m('Mark Selection', 'marker.markSelection', '/'), S,
    m('Go to In', 'marker.goIn', 'Shift+I'), m('Go to Out', 'marker.goOut', 'Shift+O'), S,
    m('Clear In', 'marker.clearIn', 'Ctrl+Shift+I'), m('Clear Out', 'marker.clearOut', 'Ctrl+Shift+O'), m('Clear In and Out', 'marker.clearInOut', 'Ctrl+Shift+X'), S,
    m('Add Marker', 'marker.add', 'M'), m('Go to Next Marker', 'marker.next', 'Shift+M'), m('Go to Previous Marker', 'marker.prev', 'Ctrl+Shift+M'), m('Edit Marker...', 'marker.edit'), m('Clear Selected Marker', 'marker.clearSelected', 'Ctrl+Alt+M'), m('Clear All Markers', 'marker.clear', 'Ctrl+Alt+Shift+M'),
  ] },
  { label: 'Graphics and Titles', items: [
    sub('New Layer', [m('Text', 'gfx.newText', 'Ctrl+T'), m('Vertical Text', 'gfx.newVText'), S, m('Rectangle', 'gfx.newRect'), m('Ellipse', 'gfx.newEllipse'), m('Polygon', 'gfx.newPolygon')]),
    S,
    m('Install Motion Graphics Template...', 'gfx.installMogrt'), m('Replace Fonts in Projects...', 'gfx.replaceFonts'),
  ] },
  { label: 'View', items: [
    sub('Playback Resolution', ['Full', '1/2', '1/4', '1/8', '1/16'].map((r) => m(r, `view.playRes.${r}`))),
    sub('Paused Resolution', ['Full', '1/2', '1/4', '1/8', '1/16'].map((r) => m(r, `view.pausedRes.${r}`))),
    sub('Magnification', ['Fit', '10%', '25%', '50%', '75%', '100%', '150%', '200%'].map((r) => m(r, `view.mag.${r}`))), S,
    sub('Video Thumbnails', [['None', 'none'], ['Head', 'head'], ['Head and Tail', 'headTail'], ['Continuous', 'continuous']].map(([l, t]) => ({ label: l, cmd: `view.thumbs.${t}`, checked: () => (getState().thumbMode || 'head') === t }))), S,
    m('Show Rulers', 'view.rulers'), m('Show Guides', 'view.guides', 'Ctrl+;'), S, m('Toggle Proxies', 'view.toggleProxies'), S,
    m('Snap in Program Monitor', 'view.snapProgram'), { label: 'Comparison View', cmd: 'view.comparisonView', checked: () => !!getState().compare?.on }, S,
    { label: 'Remote-Optimized Preview', cmd: 'view.remoteMode', checked: () => !!getState().remoteMode },
  ] },
  { label: 'Smart Tools', items: [
    m('Auto-Cut Silence & Dead Air...', 'ai.autoCut'), m('Auto-Subtitles (Speech to Text)...', 'ai.subtitles'), m('Separate Speakers to Tracks...', 'ai.diarize'), S,
    m('Smart Auto-Reframe Sequence...', 'ai.reframe'), m('Long-to-Shorts...', 'ai.shorts'), m('Smart B-Roll...', 'ai.broll'), S,
    m('Edit in AudioStage', 'edit.audiostage', null, canEditInAudioStage), S, m('Cold Archive Manager...', 'panel.archive'), m('Version History...', 'panel.versions'),
  ] },
  { label: 'Window', items: [
    sub('Workspaces', [
      m('All Panels', 'ws.allPanels'), m('Audio', 'ws.audio'), m('Color', 'ws.color'), m('Editing', 'ws.editing'), m('Effects', 'ws.effects'),
      m('Essential Graphics', 'ws.essentialGraphics'), m('Graphics', 'ws.graphics'), m('Learning', 'ws.learning'), S, m('Reset to Saved Layout', 'ws.reset'),
    ]),
    S, m('Toggle Right Panel Rail', 'view.toggleRail'), S,
    ...PANELS.filter((p) => !p.hidden).map((p) => m(p.name, `panel.${p.id}`)),
  ] },
  { label: 'Help', items: [m('Keyboard Shortcuts...', 'edit.shortcuts'), S, m('Third-Party Notices...', 'help.licenses'), S, m('About EditorStage...', 'help.about')] },
];
