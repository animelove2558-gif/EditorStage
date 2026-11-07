import React, { useEffect, useState, useCallback } from 'react';
import { Layout } from 'flexlayout-react';
import MenuBar from './MenuBar';
import { getModel, onModelReset } from '../Core/layout';
import { installShortcuts } from '../Core/shortcuts';
import { useStore, set, getState, setHistoryLimit, subscribe } from '../Core/store';
import { installTrimWatch } from '../Core/trimMode';
import { PANEL_COMPONENTS } from './Panels';
import Dialogs from './Dialogs';
import { sequenceEnd } from '../Core/editing';
import { installAudioStageSync, rearmWatches } from '../Services/audiostage';
import ErrorBoundary from './ErrorBoundary';
import { startAutoSave, bootRecovery, recoverSession, clearSessionMarker } from '../Services/versions';
import { run, confirmDiscard, openDialog } from '../Core/commands';
import { loadPrefs, onPrefs } from '../Core/prefs';
import { setAudioOutput } from '../Services/audioEngine';

export default function App() {
  const [, force] = useState(0);
  const tool = useStore((s) => s.tool);
  const log = useStore((s) => s.log);
  const dirty = useStore((s) => s.dirty);
  const name = useStore((s) => s.projectName);

  useEffect(() => installShortcuts(), []);
  const remote = useStore((s) => s.remoteMode);
  useEffect(() => { document.body.classList.toggle('remote-mode', !!remote); }, [remote]);
  const [gpu, setGpu] = useState(null); // set when the app started in software graphics after repeated graphics crashes
  useEffect(() => { window.editorstage.gpuStatus?.().then((g) => { if (g?.mode === 'software') setGpu(g); }).catch(() => {}); }, []);
  useEffect(() => { // workflow services: AudioStage file sync, auto-save, remote-desktop detection
    installAudioStageSync(); rearmWatches();
    // Preferences: auto-save interval and audio output follow the saved preferences (and every later change)
    let lastMin = null, lastOut = null;
    onPrefs((p) => { if (p.autoSaveMin !== lastMin) { lastMin = p.autoSaveMin; startAutoSave(p.autoSaveMin); } if (p.audioOutput !== lastOut) { lastOut = p.audioOutput; setAudioOutput(p.audioOutput); } setHistoryLimit(p.historySteps); });
    loadPrefs();
    window.editorstage?.env?.().then((e) => {
      let pref = null; try { pref = localStorage.getItem('es-remote-mode'); } catch { /* */ }
      if (pref != null) set({ remoteMode: pref === '1' });
      else if (e?.remoteSession) set((s) => ({ remoteMode: true, log: [...s.log.slice(-49), 'Remote Desktop session detected — Remote-Optimized Preview turned on (View menu)'] }));
    });
  }, []);
  useEffect(() => { // window close asks to save; .esproj opened from Explorer (start-up or a second launch)
    const es = window.editorstage; if (!es?.onCloseRequest) return;
    // a normal close removes the crash marker (Services/versions.js) before the window goes
    const closeNow = () => confirmDiscard(() => { clearSessionMarker().finally(() => es.closeOk()); });
    es.onCloseRequest(() => {
      // exports still running / queued would be stopped (their FFmpeg processes end with the app): ask first
      const s = getState(); const busy = (s.exportQueue || []).filter((j) => j.status === 'rendering' || j.status === 'queued').length + (s.renderProgress ? 1 : 0);
      if (!busy) return closeNow();
      openDialog('confirm', { title: 'Exports Running', message: `${busy} export${busy > 1 ? 's are' : ' is'} still rendering or queued. Quit EditorStage and stop ${busy > 1 ? 'them' : 'it'}?`, okLabel: 'Stop and Quit', onOk: closeNow });
    });
    // the previous session did not close normally: offer its newest auto-save
    bootRecovery().then((r) => {
      if (!r) return;
      const when = new Date(r.rev.time).toLocaleString();
      openDialog('confirm', { title: 'Recover Project', message: `EditorStage did not close normally last time. Restore ${r.marker.projectName || 'the project'} from the auto-save of ${when}?`, okLabel: 'Restore',
        onOk: () => recoverSession(r).then(() => set((s) => ({ log: [...s.log.slice(-49), `Recovered ${r.marker.projectName || 'project'} from the auto-save of ${when} - save it to keep the changes`] }))).catch((e) => set((s) => ({ log: [...s.log.slice(-49), 'Recovery failed: ' + (e.message || e)] }))) });
    }).catch(() => {});
    es.onOpenFile((p) => run('file.openExternal', p));
    es.takeOpenFile().then((p) => p && run('file.openExternal', p));
  }, []);
  const projectPath = useStore((s) => s.projectPath);
  useEffect(() => { rearmWatches(); }, [projectPath]);
  useEffect(() => onModelReset((r) => force(r)), []);

  useEffect(() => installTrimWatch(subscribe), []);
  // transport clock
  useEffect(() => {
    let raf, last = performance.now();
    const tick = (t) => {
      const s = getState();
      if (s.playing) {
        const rate = s.rate || 1; const next = s.playhead + ((t - last) / 1000) * rate;
        const end = sequenceEnd(s.sequence) || s.sequence.duration;
        const lo = s.loop && s.inPoint != null ? s.inPoint : 0, hi = s.loop && s.outPoint != null ? s.outPoint : end;
        // playStop.from: loop back to it (Trim Mode Space plays around the edit until stopped)
        if (s.playStop && next >= s.playStop.at) set(s.playStop.from != null ? { playhead: s.playStop.from } : { playhead: s.playStop.back, playing: false, rate: 1, playStop: null });
        else if (next >= hi) set(s.loop ? { playhead: lo } : { playhead: hi, playing: false, rate: 1 });
        else if (next <= 0) set({ playhead: 0, playing: false, rate: 1 });
        else set({ playhead: next });
      }
      else if (s.playStop) set({ playStop: null }); // stopped some other way: Play Around ends
      last = t; raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const factory = useCallback((node) => {
    const C = PANEL_COMPONENTS[node.getComponent()];
    return C ? <ErrorBoundary name={node.getName?.() || node.getComponent()}><C /></ErrorBoundary> : <div className="panel-pad">Unknown panel: {node.getComponent()}</div>;
  }, []);

  return (
    <div className="app">
      <MenuBar title={`${name}${dirty ? ' *' : ''} - EditorStage`} />
      <div className="dock"><Layout model={getModel()} factory={factory} /></div>
      {gpu && <div className="gpu-notice" role="status">EditorStage is using software graphics because {gpu.reason}. Playback may be slower. <button onClick={() => window.editorstage.gpuUseDefault()}>Use default graphics</button> <button onClick={() => setGpu(null)}>Dismiss</button></div>}
      <Dialogs />
      <div className="statusbar">{log[log.length - 1] || 'Ready'}<span className="grow" /><button className={`sb-btn ${remote ? 'on' : ''}`} title="Remote-Optimized Preview (lower preview resolution and frame rate for remote desktop)" onClick={() => run('view.remoteMode')}>🖥 Remote {remote ? 'ON' : 'OFF'}</button><span>Tool: {tool}</span></div>
    </div>
  );
}
