import React, { useState } from 'react';
import { run } from '../Core/commands';
import { requestPanel } from '../Core/layout';

// Offline guided lessons (Window > Workspaces > Learning). Each step can open the panel or run the command it talks about.
const LESSONS = [
  { title: 'Import and organize media', steps: [
    ['Import video, audio and images (any format - FFmpeg converts the rest).', 'Import…', () => run('file.import')],
    ['Create a bin to keep the Project panel tidy, then drag items into it.', 'New Bin', () => run('file.newBin')],
    ['Browse drives without leaving the app.', 'Media Browser', () => requestPanel('mediaBrowser')],
  ] },
  { title: 'Assemble a rough cut', steps: [
    ['Double-click a clip in the Project panel to put it at the playhead, or drag it onto a track.', 'Project', () => requestPanel('project')],
    ['Mark In (I) and Out (O) in the Source Monitor, then Insert (,) or Overwrite (.).', 'Source Monitor', () => requestPanel('source')],
    ['Split clips at the playhead with Add Edit (Ctrl+K); remove gaps with Ripple Delete (Shift+Delete).', 'Add Edit', () => run('seq.addEdit')],
  ] },
  { title: 'Titles and motion', steps: [
    ['Add a title (Ctrl+T) and edit its text, font and style in Essential Graphics.', 'New Title', () => run('gfx.newText')],
    ['Animate any property: click the stopwatch in Effect Controls, move the playhead, change the value. Right-click a keyframe for Ease / Hold / Bezier.', 'Effect Controls', () => requestPanel('effectControls')],
  ] },
  { title: 'Color and sound', steps: [
    ['Correct exposure and white balance, add a look (.cube LUT) in Lumetri Color.', 'Lumetri Color', () => requestPanel('lumetriColor')],
    ['Tag clips as Dialogue / Music / SFX in Essential Sound for loudness, repair and ducking.', 'Essential Sound', () => requestPanel('essentialSound')],
  ] },
  { title: 'Smart Tools', steps: [
    ['Remove silent pauses automatically.', 'Auto-Cut Silence', () => run('ai.autoCut')],
    ['Create subtitles offline with Whisper (Thai and 98 other languages).', 'Auto-Subtitles', () => run('ai.subtitles')],
  ] },
  { title: 'Export and share', steps: [
    ['Export H.264 / HEVC / ProRes / GIF / audio (Ctrl+M).', 'Export Media', () => run('file.exportMedia')],
    ['Hand the edit to another NLE as Premiere XML, FCPXML or an EDL.', 'Export FCPXML', () => run('file.exportFCPXML')],
  ] },
];

export default function LearnPanel() {
  const [done, setDone] = useState(() => { try { return JSON.parse(localStorage.getItem('es-learn-done') || '{}'); } catch { return {}; } });
  const mark = (k) => { const d = { ...done, [k]: !done[k] }; setDone(d); try { localStorage.setItem('es-learn-done', JSON.stringify(d)); } catch { /* storage unavailable */ } };
  return (
    <div className="panel-pad learn">
      <h4>Learn EditorStage</h4>
      <div className="dim note">Short hands-on lessons. Everything works offline.</div>
      {LESSONS.map((l, i) => (
        <details key={l.title} open={i === 0} className="fx-section">
          <summary>{l.steps.every((_, j) => done[`${i}.${j}`]) ? '✔ ' : ''}{l.title}</summary>
          {l.steps.map(([text, label, act], j) => (
            <div key={j} className="learn-step">
              <input type="checkbox" title="Mark as done" checked={!!done[`${i}.${j}`]} onChange={() => mark(`${i}.${j}`)} />
              <span>{text}</span><button onClick={act}>{label}</button>
            </div>
          ))}
        </details>
      ))}
    </div>
  );
}
