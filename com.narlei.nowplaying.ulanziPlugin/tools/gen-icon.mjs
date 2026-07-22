// Generates resources/icon.png from an inline SVG. macOS has no SVG rasterizer
// in sips, so qlmanage (Quick Look) does the conversion. Run from the plugin
// folder: node tools/gen-icon.mjs
import { writeFileSync, rmSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources');
const SVG_PATH = path.join(OUT_DIR, 'icon.svg');
const SIZE = 288;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 288" width="288" height="288">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f2430"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="288" height="288" rx="56" fill="url(#bg)"/>

  <!-- beamed eighth notes -->
  <g fill="#ffffff">
    <rect x="112" y="70" width="11" height="112" rx="5"/>
    <rect x="186" y="56" width="11" height="98" rx="5"/>
    <path d="M112 66 L197 52 L197 84 L112 98 Z"/>
    <ellipse cx="97" cy="184" rx="27" ry="21" transform="rotate(-16 97 184)"/>
    <ellipse cx="171" cy="156" rx="27" ry="21" transform="rotate(-16 171 156)"/>
  </g>

  <!-- progress bar, the thing that makes it read as "now playing" -->
  <rect x="52" y="228" width="184" height="14" rx="7" fill="rgba(255,255,255,0.22)"/>
  <rect x="52" y="228" width="112" height="14" rx="7" fill="#1db954"/>
</svg>
`;

writeFileSync(SVG_PATH, svg);
execFileSync('/usr/bin/qlmanage', ['-t', '-s', String(SIZE), '-o', OUT_DIR, SVG_PATH], { stdio: 'ignore' });
renameSync(path.join(OUT_DIR, 'icon.svg.png'), path.join(OUT_DIR, 'icon.png'));
rmSync(SVG_PATH, { force: true });
console.log(`✅ ${path.join(OUT_DIR, 'icon.png')} (${SIZE}x${SIZE})`);
