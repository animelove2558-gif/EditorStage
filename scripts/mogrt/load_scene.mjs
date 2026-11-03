// Loads a Scene for the test scripts: the python oracle JSON (default) or the JS .aep reader (MOGRT_SCENE=js).
import fs from 'node:fs';
import { parseAep } from '../../src/Services/mogrt/aep/index.js';

const root = new URL('../../test-assets/mogrt/', import.meta.url);

export const sceneSource = () => (process.env.MOGRT_SCENE === 'js' ? 'js' : 'oracle');

export function loadScene(name) {
  if (sceneSource() === 'js') return JSON.parse(JSON.stringify(parseAep(new Uint8Array(fs.readFileSync(new URL(`${name}/project.aep`, root))))));
  return JSON.parse(fs.readFileSync(new URL(`${name}/scene.oracle.json`, root), 'utf8'));
}
