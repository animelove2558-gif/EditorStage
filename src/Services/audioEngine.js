import { AUDIO_FX, crossfadeGains } from './audioFx';
import { resolveParams, evalParam } from '../Core/params';
import pitchSrc from './pitch.wk';
import { validPreviewAt } from '../Core/previewState';
import { needsRetimedAudio, retimedAudio, toAudioBuffer, mediaFor } from './retimedAudio';
export const loadWorklets = (c) => c.audioWorklet.addModule(URL.createObjectURL(new Blob([pitchSrc], { type: 'text/javascript' }))).then(() => { c.__pitchReady = true; });

// Per-clip Web Audio chain: element -> [clip effects] -> [Essential Sound repair/clarity] -> gain -> master.
let ctx = null; let master = null;
const chains = new Map();
const db = (x) => Math.pow(10, x / 20);
/** stereo panner fed as stereo (a mono source is up-mixed first), so pan 0 leaves the level exactly as it was */
export const stereoPanner = (c) => { const p = c.createStereoPanner(); p.channelCount = 2; p.channelCountMode = 'explicit'; p.channelInterpretation = 'speakers'; return p; };

let sinkWanted = ''; // the chosen output device ('' = system default)
/**
 * The output can stop under us: headphones unplugged, Bluetooth dropped, sleep/wake. A suspended or interrupted context is
 * resumed (playback starts it again on the next frame anyway); after a device change the chosen device is applied again.
 */
export function watchOutputDevice(c, nav = typeof navigator !== 'undefined' ? navigator : null) {
  c.addEventListener?.('statechange', () => { if (c.state === 'suspended' || c.state === 'interrupted') c.resume?.().catch(() => {}); });
  nav?.mediaDevices?.addEventListener?.('devicechange', () => {
    if (c.state === 'suspended' || c.state === 'interrupted') c.resume?.().catch(() => {});
    if (c.setSinkId) c.setSinkId(sinkWanted).catch(() => {}); // an unplugged device falls back to the default
  });
}
export function audioContext() {
  if (!ctx) { ctx = new AudioContext(); watchOutputDevice(ctx); master = ctx.createGain(); master.connect(ctx.destination); loadWorklets(ctx).then(() => { for (const ch of chains.values()) ch.sig = null; }).catch((e) => console.warn('pitch worklet', e)); }
  return ctx;
}
export const masterNode = () => { audioContext(); return master; };
/** Preferences > Audio Output: play through this device ('default' = the system device) */
export async function setAudioOutput(id) { if (!ctx && (!id || id === 'default')) return; try { const c = audioContext(); sinkWanted = !id || id === 'default' ? '' : id; if (c.setSinkId) await c.setSinkId(sinkWanted); } catch (e) { console.warn('audio output', e?.message || e); } }

const sigOf = (clip) => JSON.stringify([
  (clip.effects || []).filter((e) => e.enabled && e.category === 'Audio').map((e) => [e.name, Object.fromEntries(Object.entries(e.params || {}).map(([k, p]) => [k, p.v]))]),
  clip.audio?.repair, clip.audio?.clarity, clip.audio?.tag, clip.audio?.channels,
]);

export const CHANNEL_MODES = [['stereo', 'Stereo (as recorded)'], ['mono', 'Mono (mix L + R to both)'], ['swap', 'Swap Left / Right'], ['left', 'Left channel only (to both)'], ['right', 'Right channel only (to both)']];
/** Clip > Audio Options > Audio Channels: channel routing node (null for plain stereo). Used by playback and export. */
export function channelNode(c, mode) {
  if (!mode || mode === 'stereo') return null;
  if (mode === 'mono') { const g = c.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; return { input: g, output: g }; } // (L+R)/2, up-mixed to both speakers
  const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
  const route = { swap: [[0, 1], [1, 0]], left: [[0, 0], [0, 1]], right: [[1, 0], [1, 1]] }[mode] || [[0, 0], [1, 1]];
  for (const [from, to] of route) split.connect(merge, from, to);
  return { input: split, output: merge };
}

export function essentialNodes(c, a) {
  const out = [];
  const bq = (type, f, q = 0.7, g = 0) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b; };
  if (a?.repair?.['Reduce Rumble']) out.push(bq('highpass', 40 + (a.repair['Reduce RumbleAmt'] ?? 5) * 12));
  if (a?.repair?.['DeHum']) out.push(bq('notch', 60, 20), bq('notch', 120, 20));
  if (a?.repair?.['DeEss']) out.push(bq('peaking', 7000, 2, -6));
  if (a?.repair?.['Reduce Noise']) { out.push(bq('lowpass', 16000 - (a.repair['Reduce NoiseAmt'] ?? 5) * 600)); const k = c.createDynamicsCompressor(); k.threshold.value = -45; k.ratio.value = 2.5; out.push(k); }
  if (a?.repair?.['Reduce Reverb']) out.push(bq('lowshelf', 200, 0.7, -4));
  if (a?.clarity?.['Dynamics']) { const k = c.createDynamicsCompressor(); k.threshold.value = -24; k.ratio.value = 4; out.push(k); }
  if (a?.clarity?.['EQ']) out.push(bq('peaking', 3000, 1, 3), bq('lowshelf', 120, 0.7, -2));
  if (a?.clarity?.['Enhance Speech']) out.push(bq('highpass', 90), bq('peaking', 3500, 1, 4));
  return out;
}

function buildChain(clip, el) {
  const c = audioContext();
  let ch = chains.get(clip.id);
  if (ch && ch.el !== el) { disposeClipAudio(clip.id); ch = null; } // its element was evicted or replaced: this chain plays nothing
  if (!ch) {
    const src = c.createMediaElementSource(el);
    ch = { el, src, input: c.createGain(), gain: c.createGain(), pan: stereoPanner(c), nodes: [], sig: null, bus: null };
    src.connect(ch.input); // retimed clips feed rendered audio into ch.input too (their element is muted)
    ch.gain.connect(ch.pan); // pan -> the track bus (meter) -> master, connected in updateAudio
    chains.set(clip.id, ch);
  }
  const sig = sigOf(clip);
  if (ch.sig === sig) return ch;
  try { ch.input.disconnect(); } catch { /* not connected */ }
  for (const n of ch.nodes) { try { n.output.disconnect(); } catch { /* ok */ } }
  const nodes = []; let retry = false;
  const chn = channelNode(c, clip.audio?.channels); if (chn) nodes.push(chn);
  for (const fx of clip.effects || []) {
    if (!fx.enabled || fx.category !== 'Audio') continue;
    const def = AUDIO_FX[fx.name]; if (!def || def.status === 'unsupported') continue;
    try { nodes.push(def.build(c, resolveParams(fx.params, 0), fx)); } catch (e) { if (def.worklet) retry = true; else console.warn('audio fx', fx.name, e); }
  }
  for (const n of essentialNodes(c, clip.audio)) nodes.push({ input: n, output: n });
  let prev = ch.input;
  for (const n of nodes) { prev.connect(n.input); prev = n.output; }
  prev.connect(ch.gain);
  ch.nodes = nodes; ch.sig = retry ? null : sig;
  return ch;
}

/** Gain from audio transitions covering time t for this clip (1 if none). */
function transitionGain(seq, clip, t) {
  let g = 1;
  for (const tr of seq.transitions || []) {
    if (tr.kind !== 'audio' || tr.track !== clip.track) continue;
    if (t < tr.at - tr.dur / 2 || t > tr.at + tr.dur / 2) continue;
    const p = (t - (tr.at - tr.dur / 2)) / tr.dur;
    const [ga, gb] = crossfadeGains(tr.name, p);
    if (clip.id === tr.aId) g *= ga; else if (clip.id === tr.bId) g *= gb;
  }
  return g;
}

/** Gain (linear) of a clip at sequence time t: mute/solo, Volume effect, Essential gain, ducking, audio transitions. */
export function computeGain(seq, clip, t, solo, dialogueActive) {
  const track = seq.tracks.find((x) => x.id === clip.track);
  const local = t - clip.start;
  if (!clip.enabled || track?.muted || (solo && !track?.solo)) return 0;
  let g = db(track?.volume ?? 0);
  const vol = clip.volume || {};
  if (!evalParam(vol.bypass, local)) g *= db(evalParam(vol.level, local) ?? 0);
  g *= db(clip.audio?.gain ?? 0);
  if (clip.audio?.duck && dialogueActive) g *= db(clip.audio.duckAmt ?? -12);
  // nested clips around this one (Core/flatten): their Volume and gain apply to everything inside
  for (const o of clip.outer || []) { const lt = t - o.start; if (!evalParam(o.volume?.bypass, lt)) g *= db(evalParam(o.volume?.level, lt) ?? 0); g *= db(o.gain ?? 0); }
  return g * transitionGain(seq, clip, t);
}

/**
 * Pan of a clip at sequence time t, -1 (left) .. 1 (right): its track's pan (Audio Track Mixer) plus the clip's Panner
 * (Audio Clip Mixer / Effect Controls), and the Panner of nested clips around it.
 */
export function computePan(seq, clip, t) {
  const track = seq.tracks.find((x) => x.id === clip.track); let p = (track?.pan || 0) + (evalParam(clip.pan, t - clip.start) || 0);
  for (const o of clip.outer || []) p += evalParam(o.pan, t - o.start) || 0;
  return Math.max(-1, Math.min(1, p / 100));
}
/** Master volume of the sequence (Audio Track Mixer > Master), linear */
export const masterGain = (seq) => db(seq.masterVolume || 0);

// ---- meters: peak level of each audio track bus and of the master (Audio Track Mixer / Audio Clip Mixer) ----
const buses = new Map(); // track id -> { gain, an }
let masterAn = null;
function busFor(trackId) {
  const c = audioContext(); let b = buses.get(trackId);
  if (!b) { const gain = c.createGain(); const an = c.createAnalyser(); an.fftSize = 1024; gain.connect(an); gain.connect(master); b = { gain, an }; buses.set(trackId, b); }
  return b;
}
const peakOf = (an) => { if (!an) return 0; const buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v)); return p; };
/** peak level (linear 0..) of a track bus, or of the master output when trackId is null */
export function meterPeak(trackId) {
  if (!ctx) return 0;
  if (!trackId) { if (!masterAn) { masterAn = ctx.createAnalyser(); masterAn.fftSize = 1024; master.connect(masterAn); } return peakOf(masterAn); }
  return peakOf(buses.get(trackId)?.an);
}
const clipMeters = new Map(); // clip id -> analyser
/** peak level of one clip's sound (Audio Clip Mixer) */
export function clipPeak(id) { const ch = chains.get(id); if (!ch || !ctx) return 0; let an = clipMeters.get(id); if (!an) { an = ctx.createAnalyser(); an.fftSize = 1024; ch.pan.connect(an); clipMeters.set(id, an); } return peakOf(an); }

export const dialogueAt = (seq, t) => seq.clips.some((c) => c.audio?.tag === 'Dialogue' && c.enabled && t >= c.start && t < c.start + c.dur && !isMuted(seq, c));

/** Per-frame: ensure chains, set gains (track mute/solo, Volume effect, Essential gain, ducking, transitions). */
let apEl = null, apSrc = null;
function audioPreview(state, ap) {
  if (!ap) { if (apEl && !apEl.paused) apEl.pause(); return; }
  audioContext(); const url = 'es-media://local/' + encodeURIComponent(ap.path);
  if (!apEl || apEl.__url !== url) { if (apEl) apEl.pause(); apEl = new Audio(); apEl.crossOrigin = 'anonymous'; apEl.__url = url; apEl.src = url; apSrc = ctx.createMediaElementSource(apEl); apSrc.connect(master); }
  const tg = state.playhead - ap.start; if (Math.abs(apEl.currentTime - tg) > (state.playing ? 0.25 : 0.03)) apEl.currentTime = tg;
  if (state.playing && (state.rate || 1) > 0) { if (apEl.paused) apEl.play().catch(() => {}); } else if (!apEl.paused) apEl.pause();
}

export function updateAudio(state, elementFor, isActive) {
  const seq = state.sequence; const t = state.playhead;
  const ap = validPreviewAt(t, 'audio'); audioPreview(state, ap);
  const now = audioContext().currentTime; // creates the context (and master) on first use
  master.gain.setTargetAtTime(ap ? 1 : masterGain(seq), now, 0.015); // a rendered preview already has the master volume
  const solo = seq.tracks.some((x) => x.solo);
  const dialogueActive = seq.clips.some((c) => c.audio?.tag === 'Dialogue' && c.enabled && t >= c.start && t < c.start + c.dur && !isMuted(seq, c));
  if (state.playing && audioContext().state === 'suspended') audioContext().resume();
  for (const clip of seq.clips) {
    const ch0 = chains.get(clip.id);
    const active = isActive(clip);
    if (!active) { if (ch0) ch0.gain.gain.value = 0; continue; }
    const el = elementFor(clip); if (!el || !el.play) continue;
    let ch;
    try { ch = buildChain(clip, el); } catch (e) { continue; }
    const g = ap ? 0 : computeGain(seq, clip, t, solo, dialogueActive);
    ch.gain.gain.setTargetAtTime(g, audioContext().currentTime, 0.015);
    ch.pan.pan.setTargetAtTime(computePan(seq, clip, t), audioContext().currentTime, 0.015);
    const bus = clip.track.split('/')[0]; // a nested clip meters on the track of its nest
    if (ch.bus !== bus) { if (ch.bus) { try { ch.pan.disconnect(busFor(ch.bus).gain); } catch { /* not connected */ } } ch.pan.connect(busFor(bus).gain); ch.bus = bus; }
    driveRetimed(ch, clip, seq, t, state.playing && (state.rate || 1) === 1 && !ap);
  }
  for (const [id, r] of retimed) if (!seq.clips.some((c) => c.id === id && isActive(c))) { stopRetimed(r); if (!seq.clips.some((c) => c.id === id)) retimed.delete(id); }
}

// ---- retimed clips (reverse / speed / ramps): play the rendered buffer that export uses ----
const retimed = new Map(); // clip id -> { key, buf, w0, node, startedAt, offset }
const stopRetimed = (r) => { if (r?.node) { try { r.node.stop(); r.node.disconnect(); } catch { /* ended */ } r.node = null; } };
function driveRetimed(ch, clip, seq, t, playing) {
  if (!needsRetimedAudio(clip) || clip.noAudio) { stopRetimed(retimed.get(clip.id)); return; }
  const media = mediaFor(clip); if (!media || (media.kind !== 'audio' && media.kind !== 'video')) return;
  const c = audioContext(); const p = retimedAudio(c, seq, clip, media);
  let r = retimed.get(clip.id);
  if (!r || r.p !== p) { stopRetimed(r); r = { p, buf: null }; retimed.set(clip.id, r); p.then((x) => { if (retimed.get(clip.id) === r) { r.buf = toAudioBuffer(c, x); r.w0 = x.w0; } }).catch(() => {}); }
  if (!playing || !r.buf) { stopRetimed(r); return; }
  const want = t - r.w0;
  if (r.node && Math.abs(r.offset + (c.currentTime - r.startedAt) - want) < 0.08) return;
  stopRetimed(r);
  if (want < 0 || want >= r.buf.duration) return;
  const node = c.createBufferSource(); node.buffer = r.buf; node.connect(ch.input); node.start(0, want);
  r.node = node; r.startedAt = c.currentTime; r.offset = want;
}
const isMuted = (seq, c) => !!seq.tracks.find((x) => x.id === c.track)?.muted;

export function disposeClipAudio(id) {
  const ch = chains.get(id); if (!ch) return;
  stopRetimed(retimed.get(id)); retimed.delete(id);
  // the whole chain: a worklet effect left connected would keep processing for as long as the page lives
  for (const n of [ch.src, ch.input, ...ch.nodes.map((x) => x.output), ch.gain, ch.pan]) { try { n.disconnect(); } catch { /* not connected */ } }
  clipMeters.delete(id);
  chains.delete(id);
}
/** The chains fed by an element that is being dropped (a nested clip's chain has another key than its element). */
export function disposeElementAudio(el) { for (const [id, ch] of [...chains]) if (ch.el === el) disposeClipAudio(id); }
export const debugChains = () => [...chains.keys()];

export const debugChainInfo = () => [...chains.entries()].map(([k, c]) => [k, c.nodes.length, !!c.sig]);

export const getChain = (id) => chains.get(id);
