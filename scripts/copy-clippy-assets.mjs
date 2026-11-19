// Extracts the Clippy agent assets from node_modules/clippyjs into public/clippy/
// so the app serves them locally (no CDN). Run: node scripts/copy-clippy-assets.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const dir = resolve('node_modules/clippyjs/dist/agents/clippy');
const out = resolve('public/clippy');
mkdirSync(out, { recursive: true });

const load = async (f) => (await import(pathToFileURL(resolve(dir, f)).href)).default;

const agent = await load('agent.mjs');
const map = await load('map.mjs'); // data:image/png;base64,...
const sounds = await load('sounds-mp3.mjs'); // { name: data URL }

writeFileSync(resolve(out, 'agent.json'), JSON.stringify(agent));
writeFileSync(resolve(out, 'map.png'), Buffer.from(map.split(',')[1], 'base64'));
writeFileSync(resolve(out, 'sounds.json'), JSON.stringify(sounds));
console.log('Clippy assets written to public/clippy/');
