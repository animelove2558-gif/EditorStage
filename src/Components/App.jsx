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
import { startAutoSave } from '../Services/versions';
import { run, confirmDiscard } from '../Core/commands';
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
    es.onCloseRequest(() => confirmDiscard(() => es.closeOk()));
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
    return C ? <C /> : <div className="panel-pad">Unknown panel: {node.getComponent()}</div>;
  }, []);

  return (
    <div className="app">
      <MenuBar title={`${name}${dirty ? ' *' : ''} - EditorStage`} />
      <div className="dock"><Layout model={getModel()} factory={factory} /></div>
      <Dialogs />
      <div className="statusbar">{log[log.length - 1] || 'Ready'}<span className="grow" /><button className={`sb-btn ${remote ? 'on' : ''}`} title="Remote-Optimized Preview (lower preview resolution and frame rate for remote desktop)" onClick={() => run('view.remoteMode')}>🖥 Remote {remote ? 'ON' : 'OFF'}</button><span>Tool: {tool}</span></div>
    </div>
  );
}
