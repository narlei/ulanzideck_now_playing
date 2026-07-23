// Generates the three store art assets (cover + two banners) as self-contained
// SVGs, embedding the plugin's REAL button renders so the mockups are authentic.
// Rasterize with Chrome headless afterwards — see `make banners`.
// Run: node tools/gen-banners.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  renderTrack,
  renderIdle,
  renderNotRunning,
} from '../plugin/renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', '..', 'resources');
const ICON_PATH = path.join(__dirname, '..', 'resources', 'icon.png');

const ICON_URL = `data:image/png;base64,${readFileSync(ICON_PATH).toString('base64')}`;

// ---- shared palette / helpers -------------------------------------------------
const BG0 = '#0a0e1a';
const BG1 = '#0d1117';
const WHITE = '#ffffff';
const MUTED = '#8b93a7';
const CARD = '#15181f';
const CARD_BORDER = 'rgba(255,255,255,0.07)';
const KEY_BG = '#0e0e12';
const SPOTIFY_GREEN = '#1db954';

let uid = 0;
const nextId = () => `id${uid++}`;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function txt(s, x, y, size, { fill = WHITE, weight = 700, anchor = 'start', spacing = 0, family } = {}) {
  const ls = spacing ? ` letter-spacing="${spacing}"` : '';
  const ff = family || 'Helvetica Neue, Helvetica, Arial, sans-serif';
  return `<text x="${x}" y="${y}" font-family="${ff}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${esc(s)}</text>`;
}

function keyCell(x, y, size, imgUrl, radius = 22) {
  const clip = nextId();
  const frame = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${radius}" fill="${KEY_BG}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
  if (!imgUrl) return frame;
  const pad = Math.round(size * 0.06);
  const inner = size - pad * 2;
  return (
    `<defs><clipPath id="${clip}"><rect x="${x + pad}" y="${y + pad}" width="${inner}" height="${inner}" rx="${radius - 6}"/></clipPath></defs>` +
    frame +
    `<image href="${imgUrl}" x="${x + pad}" y="${y + pad}" width="${inner}" height="${inner}" clip-path="url(#${clip})"/>`
  );
}

function appIcon(x, y, size) {
  const clip = nextId();
  const glow = nextId();
  return (
    `<defs>` +
    `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.24}"/></clipPath>` +
    `<filter id="${glow}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18" result="b"/><feColorMatrix in="b" type="matrix" values="0 0 0 0 0.11  0 0 0 0 0.72  0 0 0 0 0.33  0 0 0 0.5 0"/></filter>` +
    `</defs>` +
    `<rect x="${x - 4}" y="${y - 4}" width="${size + 8}" height="${size + 8}" rx="${size * 0.28}" filter="url(#${glow})" fill="${SPOTIFY_GREEN}" opacity="0.6"/>` +
    `<image href="${ICON_URL}" x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#${clip})"/>`
  );
}

function pillRow(x, y, labels, size = 30, gap = 20) {
  let cx = x;
  let out = '';
  for (const l of labels) {
    const padX = Math.round(size * 0.9);
    const w = Math.round(l.length * size * 0.56 + padX * 2);
    const h = Math.round(size * 1.9);
    out +=
      `<rect x="${cx}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>` +
      txt(l, cx + w / 2, y + h / 2 + size * 0.34, size, { fill: '#d3d8e3', weight: 600, anchor: 'middle' });
    cx += w + gap;
  }
  return out;
}

function checkItem(x, y, label, size = 40, accent = SPOTIFY_GREEN) {
  const box = size * 1.1;
  const by = y - box * 0.75;
  return (
    `<rect x="${x}" y="${by}" width="${box}" height="${box}" rx="${box * 0.28}" fill="${accent}" fill-opacity="0.14" stroke="${accent}" stroke-width="2"/>` +
    `<path d="M ${x + box * 0.25} ${by + box * 0.52} L ${x + box * 0.44} ${by + box * 0.7} L ${x + box * 0.76} ${by + box * 0.3}" fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    txt(label, x + box + size * 0.5, y, size, { fill: '#e6e9f0', weight: 600 })
  );
}

function bgLayer(w, h) {
  const g = nextId();
  const glow = nextId();
  return (
    `<defs>` +
    `<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BG0}"/><stop offset="1" stop-color="${BG1}"/></linearGradient>` +
    `<radialGradient id="${glow}" cx="0.14" cy="0.1" r="0.5"><stop offset="0" stop-color="rgba(46,86,170,0.38)"/><stop offset="1" stop-color="rgba(46,86,170,0)"/></radialGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#${g})"/>` +
    `<rect width="${w}" height="${h}" fill="url(#${glow})"/>`
  );
}

function headlineGradientDef(id) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3ecf6b"/><stop offset="0.55" stop-color="#22d3ee"/><stop offset="1" stop-color="#4772fa"/></linearGradient>`;
}

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

// ---- demo artwork -------------------------------------------------------------
// Synthetic sleeves, not real album covers: store art shouldn't ship somebody
// else's copyrighted artwork, and invented records keep the mockups honest
// about being mockups. Track names are fictional for the same reason.
function sleeve(stops, motif = '') {
  const g = nextId();
  const inner = svg(400, 400,
    `<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">` +
    stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
    `</linearGradient></defs>` +
    `<rect width="400" height="400" fill="url(#${g})"/>` + motif
  );
  return `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`;
}

const ART = {
  neon: sleeve([[0, '#2b1055'], [0.55, '#7597de'], [1, '#ff2e88']],
    `<circle cx="200" cy="205" r="96" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="10"/>` +
    `<circle cx="200" cy="205" r="150" fill="none" stroke="#ffffff" stroke-opacity="0.2" stroke-width="6"/>`),
  tide: sleeve([[0, '#0f3443'], [1, '#34e89e']],
    `<path d="M0 250 Q100 200 200 250 T400 250 V400 H0 Z" fill="#ffffff" fill-opacity="0.16"/>` +
    `<path d="M0 300 Q100 250 200 300 T400 300 V400 H0 Z" fill="#ffffff" fill-opacity="0.12"/>`),
  ember: sleeve([[0, '#20002c'], [0.6, '#804d6b'], [1, '#ffb88c']],
    `<circle cx="200" cy="150" r="72" fill="#ffd86f" fill-opacity="0.85"/>` +
    `<path d="M0 250 L120 170 L210 250 L290 195 L400 275 V400 H0 Z" fill="#1a0f22" fill-opacity="0.75"/>` +
    `<path d="M0 300 L140 235 L260 300 L400 245 V400 H0 Z" fill="#10070f" fill-opacity="0.8"/>`),
  paper: sleeve([[0, '#f7f7f2'], [1, '#d9d4c5']],
    `<circle cx="200" cy="180" r="80" fill="none" stroke="#2b2b2b" stroke-opacity="0.45" stroke-width="8"/>` +
    `<rect x="60" y="300" width="280" height="10" fill="#2b2b2b" fill-opacity="0.3"/>`),
};

// ---- button renders reused across banners ------------------------------------
const TRACK = { title: 'Neon Harbour', artist: 'Violet Arcade', durationMs: 214000 };

const B = {
  playing: renderTrack({ ...TRACK, artDataUrl: ART.neon, positionMs: 78000, playing: true, showText: true, showTime: true }),
  paused: renderTrack({ title: 'Slow Tide', artist: 'Marina Voss', durationMs: 187000, artDataUrl: ART.tide, positionMs: 96000, playing: false, showText: true, showTime: true }),
  coverOnly: renderTrack({ ...TRACK, artDataUrl: ART.ember, positionMs: 140000, playing: true, showText: false, showTime: false }),
  lightArt: renderTrack({ title: 'Paper Wings', artist: 'Elin Sørensen', durationMs: 231000, artDataUrl: ART.paper, positionMs: 44000, playing: true, showText: true, showTime: true }),
  noArt: renderTrack({ title: 'Untitled Demo', artist: 'Local File', durationMs: 165000, artDataUrl: '', positionMs: 51000, playing: true, showText: true, showTime: true }),
  idle: renderIdle('Spotify'),
  closed: renderNotRunning('Apple Music'),
};

function ICON_KEY() {
  const inner = svg(200, 200,
    `<rect width="200" height="200" fill="#1f1f23"/>` +
    `<image href="${ICON_URL}" x="46" y="26" width="108" height="108"/>` +
    `<text x="100" y="176" font-family="Helvetica Neue, Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff" text-anchor="middle">Playing</text>`
  );
  return `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`;
}

// ================================ COVER (1600x800) ============================
function buildCover() {
  const W = 1600, H = 800;
  const gid = nextId();
  let s = bgLayer(W, H);
  s += `<defs>${headlineGradientDef(gid)}</defs>`;

  s += appIcon(90, 150, 120);
  s += txt('Now Playing', 240, 210, 60, { weight: 800 });
  s += txt('UlanziDeck · macOS', 242, 250, 26, { fill: MUTED, weight: 600 });

  s += txt('Your music.', 90, 400, 88, { weight: 800 });
  s += txt('On your deck.', 90, 500, 88, { weight: 800, fill: `url(#${gid})` });

  s += txt('Cover · title · artist · live progress.', 92, 560, 32, { fill: '#aeb6c6', weight: 500 });

  s += pillRow(90, 610, ['Spotify', 'Apple Music', 'Tap to pause'], 28, 18);

  const px = 900, py = 190, pw = 610, ph = 430;
  s += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="34" fill="#141414" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
  s += txt('U · STUDIO', px + pw / 2, py + 60, 26, { fill: '#6b7180', weight: 700, anchor: 'middle', spacing: 8 });

  const keySize = 118, gap = 24;
  const gx = px + 40, gy = py + 90;
  const row0 = [B.playing, B.paused, B.coverOnly, ICON_KEY()];
  for (let i = 0; i < 4; i++) s += keyCell(gx + i * (keySize + gap), gy, keySize, row0[i]);
  for (let i = 0; i < 4; i++) s += keyCell(gx + i * (keySize + gap), gy + keySize + gap, keySize, null);

  return svg(W, H, s);
}

// ============================== BANNER 1 (2400x1600) =========================
// "Every state. One glance." — the grid of button states.
function buildBanner1() {
  const W = 2400, H = 1600;
  const gid = nextId();
  let s = bgLayer(W, H);
  s += `<defs>${headlineGradientDef(gid)}</defs>`;

  const lx = 130;
  s += `<circle cx="${lx + 8}" cy="335" r="9" fill="${SPOTIFY_GREEN}"/>`;
  s += txt('ONE SMART BUTTON', lx + 34, 345, 32, { fill: '#9aa2b4', weight: 700, spacing: 6 });
  s += txt('Every state.', lx, 500, 118, { weight: 800 });
  s += txt('One glance.', lx, 630, 118, { weight: 800, fill: `url(#${gid})` });
  s += txt('The album cover fills the key, the title and artist', lx, 770, 42, { fill: '#aeb6c6', weight: 500 });
  s += txt('sit on top of it, and a progress bar fills as the', lx, 828, 42, { fill: '#aeb6c6', weight: 500 });
  s += txt('song plays. A click pauses it or skips.', lx, 886, 42, { fill: '#aeb6c6', weight: 500 });

  s += checkItem(lx, 1130, 'Real cover art, straight from the player');
  s += checkItem(lx, 1230, 'Live progress bar and elapsed time');
  s += checkItem(lx, 1330, 'Reads Spotify and Apple Music');

  const cards = [
    { img: B.playing, accent: SPOTIFY_GREEN, title: 'Playing', sub: 'cover · progress' },
    { img: B.paused, accent: '#e3b341', title: 'Paused', sub: 'dimmed + badge' },
    { img: B.lightArt, accent: '#22d3ee', title: 'Any cover', sub: 'stays readable' },
    { img: B.coverOnly, accent: '#4772fa', title: 'Cover only', sub: 'text hidden' },
    { img: B.noArt, accent: MUTED, title: 'No artwork', sub: 'falls back' },
    { img: B.idle, accent: '#8b93a7', title: 'Nothing playing', sub: 'idle' },
  ];
  const cols = 3, cw = 360, ch = 500, gapx = 44, gapy = 60;
  const x0 = 1120, y0 = 300;
  for (let i = 0; i < cards.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = x0 + col * (cw + gapx);
    const cy = y0 + row * (ch + gapy);
    const c = cards[i];
    s += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="30" fill="${CARD}" stroke="${CARD_BORDER}" stroke-width="1"/>`;
    s += `<rect x="${cx + 24}" y="${cy}" width="${cw - 48}" height="6" rx="3" fill="${c.accent}"/>`;
    const bsize = 236;
    s += keyCell(cx + (cw - bsize) / 2, cy + 46, bsize, c.img, 26);
    s += txt(c.title, cx + cw / 2, cy + 380, 40, { weight: 800, anchor: 'middle' });
    s += txt(c.sub, cx + cw / 2, cy + 428, 30, { fill: MUTED, weight: 600, anchor: 'middle' });
  }
  return svg(W, H, s);
}

// ============================== BANNER 2 (2400x1600) =========================
// "Pick your player." — the Property Inspector.
function buildBanner2() {
  const W = 2400, H = 1600;
  const gid = nextId();
  let s = bgLayer(W, H);
  s += `<defs>${headlineGradientDef(gid)}</defs>`;

  const lx = 130;
  const cyan = '#22d3ee';
  s += `<circle cx="${lx + 8}" cy="335" r="9" fill="${cyan}"/>`;
  s += txt('MAKE IT YOURS', lx + 34, 345, 32, { fill: '#9aa2b4', weight: 700, spacing: 6 });
  s += txt('Pick your', lx, 500, 118, { weight: 800 });
  s += txt('player.', lx, 630, 118, { weight: 800, fill: `url(#${gid})` });
  s += txt('Auto follows whichever of Spotify or Apple Music', lx, 770, 42, { fill: '#aeb6c6', weight: 500 });
  s += txt('is actually playing — or pin a button to one of', lx, 828, 42, { fill: '#aeb6c6', weight: 500 });
  s += txt('them. Choose what a click does, too.', lx, 886, 42, { fill: '#aeb6c6', weight: 500 });

  s += checkItem(lx, 1130, 'Click to pause, skip, or go back', 40, cyan);
  s += checkItem(lx, 1230, 'Hide the text for a cover-only key', 40, cyan);
  s += checkItem(lx, 1330, 'Neither app is ever launched for you', 40, cyan);

  // Property Inspector panel (dark macOS-style), sized to hug its four rows
  // rather than leaving half the window empty.
  const px = 1150, py = 330, pw = 1120, ph = 580;
  s += `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="26" fill="#1e1f22" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
  s += `<rect x="${px}" y="${py}" width="${pw}" height="70" rx="26" fill="#26272b"/>`;
  s += `<rect x="${px}" y="${py + 40}" width="${pw}" height="30" fill="#26272b"/>`;
  s += `<circle cx="${px + 34}" cy="${py + 35}" r="9" fill="#ff5f57"/><circle cx="${px + 64}" cy="${py + 35}" r="9" fill="#febc2e"/><circle cx="${px + 94}" cy="${py + 35}" r="9" fill="#28c840"/>`;
  s += txt('Now Playing', px + pw / 2, py + 44, 28, { fill: '#c9cdd6', weight: 600, anchor: 'middle' });

  // The four real settings rows.
  const fields = [
    { label: 'Player', value: 'Auto (whatever is playing)', focus: true },
    { label: 'On click', value: 'Play / Pause', focus: false },
    { label: 'Title & artist', value: 'Show', focus: false },
    { label: 'Elapsed time', value: 'Show', focus: false },
  ];
  const selX = px + 400, selW = pw - 460, selH = 64;
  let fy = py + 140;
  let focusedSelBottom = 0;
  for (const f of fields) {
    s += txt(f.label, px + 60, fy + 6, 30, { fill: '#c9cdd6', weight: 600 });
    s += `<rect x="${selX}" y="${fy - 40}" width="${selW}" height="${selH}" rx="10" fill="#18191b" stroke="${f.focus ? SPOTIFY_GREEN : 'rgba(255,255,255,0.10)'}" stroke-width="${f.focus ? 2 : 1}"/>`;
    s += txt(f.value, selX + 24, fy + 3, 28, { fill: f.focus ? '#ffffff' : '#cfd4e0', weight: 600 });
    s += `<path d="M ${selX + selW - 44} ${fy - 16} l 14 16 l 14 -16" fill="none" stroke="#8b93a7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (f.focus) focusedSelBottom = fy - 40 + selH;
    fy += 108;
  }

  // The open list hangs directly off the Player select and overlaps the rows
  // beneath it, the way a real popup menu does — floating it below the last
  // field would read as belonging to that field instead.
  const dy = focusedSelBottom + 10;
  const rows = [
    { t: 'Auto (whatever is playing)', sel: true },
    { t: 'Spotify', sel: false },
    { t: 'Apple Music', sel: false },
  ];
  const rowH = 74;
  const shadow = nextId();
  s += `<defs><filter id="${shadow}" x="-20%" y="-20%" width="140%" height="160%">` +
    `<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.65"/></filter></defs>`;
  s += `<rect x="${selX}" y="${dy}" width="${selW}" height="${rows.length * rowH + 20}" rx="12" fill="#0f1012" stroke="rgba(255,255,255,0.12)" stroke-width="1" filter="url(#${shadow})"/>`;
  rows.forEach((r, i) => {
    const ry = dy + 10 + i * rowH;
    if (r.sel) s += `<rect x="${selX + 8}" y="${ry}" width="${selW - 16}" height="${rowH - 8}" rx="8" fill="${SPOTIFY_GREEN}" fill-opacity="0.16"/>`;
    s += txt(r.t, selX + 28, ry + rowH / 2 + 6, 27, { fill: r.sel ? '#e6ffe9' : '#cfd4e0', weight: r.sel ? 700 : 500 });
    if (r.sel) s += `<path d="M ${selX + selW - 60} ${ry + rowH / 2 - 2} l 12 12 l 22 -24" fill="none" stroke="${SPOTIFY_GREEN}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  });

  // What those settings produce, so the panel isn't just an abstract form.
  const previewSize = 300;
  const pvx = px + (pw - previewSize) / 2;
  const pvy = py + ph + 110;
  s += txt('…and the key it produces', px + pw / 2, pvy - 40, 32, { fill: MUTED, weight: 600, anchor: 'middle' });
  s += keyCell(pvx, pvy, previewSize, B.playing, 30);

  return svg(W, H, s);
}

writeFileSync(path.join(OUT, 'cover.svg'), buildCover());
writeFileSync(path.join(OUT, 'banner1.svg'), buildBanner1());
writeFileSync(path.join(OUT, 'banner2.svg'), buildBanner2());
console.log('wrote cover.svg, banner1.svg, banner2.svg to', OUT);
