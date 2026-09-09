// Generates resources/icon.png from an inline SVG. macOS has no SVG rasterizer
// in sips, so qlmanage (Quick Look) does the conversion. Run from the plugin
// folder: node tools/gen-icon.mjs
import { writeFileSync, rmSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources');
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

// Action icon for the volume key: the same slab, with a speaker and the column
// the button itself fills up with.
const volumeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 288" width="288" height="288">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f2430"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
    <clipPath id="slab"><rect x="0" y="0" width="288" height="288" rx="56"/></clipPath>
  </defs>
  <rect x="0" y="0" width="288" height="288" rx="56" fill="url(#bg)"/>

  <!-- the fill, at the level the key would show it; clipped so it keeps the
       slab's rounded corners instead of squaring off the bottom -->
  <g clip-path="url(#slab)">
    <rect x="0" y="172" width="288" height="116" fill="#1db954" fill-opacity="0.85"/>
    <rect x="0" y="172" width="288" height="5" fill="#1db954"/>
  </g>

  <g fill="#ffffff">
    <path d="M74 122 L100 122 L134 92 L134 196 L100 166 L74 166 Z"/>
  </g>
  <g stroke="#ffffff" stroke-width="11" fill="none" stroke-linecap="round">
    <path d="M158 116 A 32 32 0 0 1 158 172"/>
    <path d="M180 96 A 58 58 0 0 1 180 192"/>
  </g>
</svg>
`;

// Action icon for the seek key: the ring the button itself draws, with the
// arrows that say the dial moves it.
const seekSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 288 288" width="288" height="288">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f2430"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="288" height="288" rx="56" fill="url(#bg)"/>

  <circle cx="144" cy="144" r="92" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="20"/>
  <path d="M144 52 A 92 92 0 0 1 223.67 190" fill="none" stroke="#1db954" stroke-width="20" stroke-linecap="round"/>
  <circle cx="223.67" cy="190" r="11" fill="#ffffff"/>

  <!-- rewind / fast-forward, the pair the dial maps to -->
  <g fill="#ffffff">
    <path d="M132 112 L104 144 L132 176 Z"/>
    <path d="M100 112 L72 144 L100 176 Z" fill-opacity="0.55"/>
    <path d="M156 112 L184 144 L156 176 Z"/>
    <path d="M188 112 L216 144 L188 176 Z" fill-opacity="0.55"/>
  </g>
</svg>
`;

function render(name, source) {
  const svgPath = path.join(OUT_DIR, `${name}.svg`);
  writeFileSync(svgPath, source);
  execFileSync('/usr/bin/qlmanage', ['-t', '-s', String(SIZE), '-o', OUT_DIR, svgPath], { stdio: 'ignore' });
  renameSync(path.join(OUT_DIR, `${name}.svg.png`), path.join(OUT_DIR, `${name}.png`));
  rmSync(svgPath, { force: true });
  console.log(`✅ ${path.join(OUT_DIR, `${name}.png`)} (${SIZE}x${SIZE})`);
}

render('icon', svg);
render('icon-volume', volumeSvg);
render('icon-seek', seekSvg);
