// Effects library structure mirrors Premiere Pro's Effects panel (folder names are exact).
import { MORE_TRANSITIONS } from '../Renderers/fx/moreTransitions';
import { MORE_VIDEO_FX } from '../Renderers/fx/moreVideoFx';
import { MORE_AUDIO_FX } from '../Services/audioFx';
import { MORE_CROSSFADES } from '../Services/moreAudioFx';
export const AUDIO_EFFECTS = {
  'Amplitude and Compression': ['Amplify', 'Channel Volume', 'Dynamics', 'Hard Limiter', 'Multiband Compressor', 'Single-band Compressor', 'Tube-modeled Compressor'],
  'Delay and Echo': ['Analog Delay', 'Delay', 'Echo'],
  'Filter and EQ': ['Bandpass', 'FFT Filter', 'Graphic Equalizer (10 Bands)', 'Graphic Equalizer (20 Bands)', 'Graphic Equalizer (30 Bands)', 'Highpass', 'Lowpass', 'Notch Filter', 'Parametric Equalizer', 'Simple Notch Filter', 'Treble'],
  'Modulation': ['Chorus', 'Flanger', 'Phaser'],
  'Noise Reduction/Restoration': ['Automatic Click Remover', 'DeNoise', 'DeReverb'],
  'Reverb': ['Convolution Reverb', 'Studio Reverb', 'Surround Reverb'],
  'Special': ['Distortion', 'Guitar Suite', 'Loudness Radar', 'Mastering', 'Vocal Enhancer', 'Voice Changer'],
  'Stereo Imagery': ['Binauralizer', 'Panner'],
  'Time and Pitch': ['Pitch Shifter', 'Pitch and Time'],
};

export const AUDIO_TRANSITIONS = {
  'Crossfade': ['Constant Gain', 'Constant Power', 'Exponential Fade'],
  'Fade Curves': Object.keys(MORE_CROSSFADES),
};
// round 2: audio effects written for EditorStage (moreAudioFx.js)
for (const [folder, items] of Object.entries(MORE_AUDIO_FX)) AUDIO_EFFECTS[folder] = [...new Set([...(AUDIO_EFFECTS[folder] || []), ...Object.keys(items)])].sort((a, b) => a.localeCompare(b));

export const VIDEO_EFFECTS = {
  'Adjust': ['Extract', 'Levels', 'Lighting Effects', 'ProcAmp'],
  'Blur & Sharpen': ['Camera Blur', 'Channel Blur', 'Compound Blur', 'Directional Blur', 'Fast Blur', 'Gaussian Blur', 'Radial Blur', 'Sharpen', 'Unsharp Mask'],
  'Channel': ['Arithmetic', 'Blend', 'Calculations', 'Invert', 'Set Matte', 'Shift Channels'],
  'Color Correction': ['ASC CDL', 'Brightness & Contrast', 'Change Color', 'Change to Color', 'Channel Mixer', 'Color Balance', 'Equalize', 'Leave Color', 'Lumetri Color', 'Tint', 'Video Limiter'],
  'Distort': ['Corner Pin', 'Lens Distortion', 'Magnify', 'Mirror', 'Offset', 'Spherize', 'Transform', 'Turbulent Displace', 'Twirl', 'Warp Stabilizer', 'Wave Warp'],
  'Generate': ['4-Color Gradient', 'Cell Pattern', 'Checkerboard', 'Circle', 'Ellipse', 'Grid', 'Lens Flare', 'Lightning', 'Paint Bucket', 'Ramp', 'Write-on'],
  'Image Control': ['Black & White', 'Color Pass', 'Color Replace', 'Gamma Correction'],
  'Immersive Video': ['VR Chromatic Aberrations', 'VR Color Gradients', 'VR De-Noise', 'VR Glow', 'VR Plane to Sphere'],
  'Keying': ['Remove Background', 'Alpha Adjust', 'Color Key', 'Difference Matte', 'Image Matte Key', 'Luma Key', 'Non Red Key', 'Track Matte Key', 'Ultra Key'],
  'Noise & Grain': ['Add Noise', 'Dust & Scratches', 'Median', 'Noise', 'Noise Alpha'],
  'Perspective': ['Basic 3D', 'Bevel Alpha', 'Bevel Edges', 'Drop Shadow', 'Radial Shadow'],
  'Stylize': ['Alpha Glow', 'Brush Strokes', 'Color Emboss', 'Emboss', 'Find Edges', 'Mosaic', 'Posterize', 'Replicate', 'Roughen Edges', 'Solarize', 'Strobe Light', 'Texturize', 'Threshold'],
  'Time': ['Echo', 'Posterize Time', 'Time Warp'],
  'Transform': ['Auto Reframe', 'Crop', 'Edge Feather', 'Horizontal Flip', 'Vertical Flip'],
  'Utility': ['Cineon Converter'],
};

export const VIDEO_TRANSITIONS = {
  '3D Motion': ['Cube Spin', 'Flip Over'],
  'Dissolve': ['Additive Dissolve', 'Cross Dissolve', 'Dip to Black', 'Dip to White', 'Film Dissolve', 'Morph Cut', 'Non-Additive Dissolve'],
  'Iris': ['Iris Box', 'Iris Cross', 'Iris Diamond', 'Iris Round', 'Iris Star'],
  'Page Peel': ['Page Peel', 'Page Turn'],
  'Slide': ['Band Slide', 'Center Merge', 'Push', 'Slide', 'Split'],
  'Wipe': ['Band Wipe', 'Barn Doors', 'Checker Wipe', 'Clock Wipe', 'Gradient Wipe', 'Linear Wipe', 'Radial Wipe', 'Venetian Blinds', 'Wedge Wipe', 'Zig-Zag Blocks'],
  'Zoom': ['Cross Zoom'],
};

// round 2: video effects written for EditorStage (moreVideoFx*.js), merged into Premiere's folders or new ones
for (const [folder, items] of Object.entries(MORE_VIDEO_FX)) VIDEO_EFFECTS[folder] = [...new Set([...(VIDEO_EFFECTS[folder] || []), ...Object.keys(items)])].sort((a, b) => a.localeCompare(b));
// round 2: transitions written for EditorStage (src/Renderers/fx/moreTransitions.js), merged into Premiere's folders
for (const [folder, items] of Object.entries(MORE_TRANSITIONS)) VIDEO_TRANSITIONS[folder] = [...new Set([...(VIDEO_TRANSITIONS[folder] || []), ...Object.keys(items)])].sort((a, b) => a.localeCompare(b));

export const EFFECT_ROOTS = [
  { name: 'Presets', tree: {} },
  { name: 'Audio Effects', tree: AUDIO_EFFECTS },
  { name: 'Audio Transitions', tree: AUDIO_TRANSITIONS },
  { name: 'Video Effects', tree: VIDEO_EFFECTS },
  { name: 'Video Transitions', tree: VIDEO_TRANSITIONS },
];

// Effect Controls: fixed effects shown for every selected clip
export const INTRINSIC_EFFECTS = [
  { name: 'Motion', params: [
    { id: 'position', label: 'Position', type: 'point', value: [960, 540], keyframable: true },
    { id: 'scale', label: 'Scale', type: 'slider', min: 0, max: 400, value: 100, keyframable: true },
    { id: 'rotation', label: 'Rotation', type: 'slider', min: -360, max: 360, value: 0, keyframable: true },
    { id: 'anchor', label: 'Anchor Point', type: 'point', value: [960, 540], keyframable: true },
    { id: 'antiflicker', label: 'Anti-flicker Filter', type: 'slider', min: 0, max: 1, step: 0.01, value: 0, keyframable: true },
  ] },
  { name: 'Opacity', masks: true, params: [
    { id: 'opacity', label: 'Opacity', type: 'slider', min: 0, max: 100, value: 100, keyframable: true },
    { id: 'blend', label: 'Blend Mode', type: 'select', options: ['Normal', 'Multiply', 'Screen', 'Overlay', 'Add', 'Difference'], value: 'Normal' },
  ] },
  { name: 'Time Remapping', params: [
    { id: 'speed', label: 'Speed', type: 'slider', min: 0, max: 1000, value: 100, keyframable: true },
  ] },
  { name: 'Volume', params: [
    { id: 'bypass', label: 'Bypass', type: 'select', options: ['Off', 'On'], value: 'Off' },
    { id: 'level', label: 'Level', type: 'slider', min: -60, max: 15, step: 0.1, value: 0, keyframable: true },
  ] },
];

export const MASKS = [
  { id: 'polygon', label: 'Create 4-point polygon mask', icon: '▭' },
  { id: 'ellipse', label: 'Create ellipse mask', icon: '◯' },
  { id: 'bezier', label: 'Free draw bezier', icon: '✒' },
];

// Lumetri
export const LUMETRI_TABS = {
  'Basic Correction': ['Temperature', 'Tint', 'Exposure', 'Contrast', 'Highlights', 'Shadows', 'Whites', 'Blacks'],
  'Creative': ['Intensity', 'Faded Film', 'Sharpen', 'Vibrance', 'Saturation'],
  'Curves': ['RGB Curves', 'Hue vs Sat'],
  'Color Wheels & Match': ['Shadows', 'Midtones', 'Highlights'],
  'HSL Secondary': ['Hue', 'Saturation', 'Luma', 'Denoise', 'Blur'],
  'Vignette': ['Amount', 'Midpoint', 'Roundness', 'Feather'],
};
