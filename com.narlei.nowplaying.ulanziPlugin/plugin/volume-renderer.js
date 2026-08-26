import { SIZE, BG, TEXT, MUTED, ACCENT, svgDoc, toDataUrl, text } from './svg.js';

// Alpha always goes in its own attribute here, never in the colour — see the
// note at the top of svg.js.

// The level is drawn as a column filling from the bottom rather than as a thin
// bar: the whole key is the meter, so a change of a couple of percent is still
// several pixels of movement and reads across a desk.
const LOUD = '#f2b01e';
const MAX = '#e5484d';
// Where the fill stops being plain green. Above LOUD_FROM you are into "this is
// loud" territory and above MAX_FROM you are at the top of the scale.
const LOUD_FROM = 75;
const MAX_FROM = 95;
// Bright line along the top of the fill, so the leading edge is visible even
// against the brightest part of the column.
const EDGE_HEIGHT = 3;
// A tick every 10%, which gives the eye something fixed to measure the fill
// against while it moves.
const TICK_STEP = 10;
const NUMBER_SIZE = 74;
const NUMBER_Y = 128;
const PCT_SIZE = 24;
const LABEL_Y = 178;
const LABEL_SIZE = 19;
const ICON_Y = 26;

function fillColor(level) {
  if (level >= MAX_FROM) return MAX;
  if (level >= LOUD_FROM) return LOUD;
  return ACCENT;
}

function ticks() {
  const out = [];
  for (let pct = TICK_STEP; pct < 100; pct += TICK_STEP) {
    const y = SIZE - (SIZE * pct) / 100;
    const long = pct % 50 === 0;
    out.push(
      `<rect x="0" y="${y}" width="${long ? SIZE : 14}" height="1" fill="${TEXT}" fill-opacity="${long ? 0.16 : 0.1}"/>`,
    );
  }
  return out.join('');
}

// Speaker outline, drawn small in the top-left corner. Muted adds the cross;
// otherwise the number of arcs follows the level, which is the same shorthand
// macOS uses in its own volume HUD.
function speakerIcon(level, muted) {
  const x = 14;
  const y = ICON_Y;
  const body =
    `<path d="M${x} ${y - 6} L${x + 8} ${y - 6} L${x + 18} ${y - 15} L${x + 18} ${y + 15} ` +
    `L${x + 8} ${y + 6} L${x} ${y + 6} Z" fill="${TEXT}" fill-opacity="0.85"/>`;

  if (muted) {
    const cx = x + 26;
    return (
      body +
      `<path d="M${cx} ${y - 8} L${cx + 16} ${y + 8} M${cx + 16} ${y - 8} L${cx} ${y + 8}" ` +
      `stroke="${MAX}" stroke-width="4" stroke-linecap="round" fill="none"/>`
    );
  }

  const arcs = [];
  const waves = level >= 66 ? 3 : level >= 33 ? 2 : level > 0 ? 1 : 0;
  for (let i = 0; i < waves; i++) {
    const r = 8 + i * 7;
    arcs.push(
      `<path d="M${x + 22} ${y - r} A ${r} ${r} 0 0 1 ${x + 22} ${y + r}" ` +
        `stroke="${TEXT}" stroke-opacity="0.85" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    );
  }
  return body + arcs.join('');
}

export function renderVolume({ level, muted, showPercent = true }) {
  const pct = Math.min(100, Math.max(0, Math.round(level)));
  const height = Math.round((SIZE * pct) / 100);
  const top = SIZE - height;
  const color = muted ? MUTED : fillColor(pct);
  const parts = [`<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`];

  if (height > 0) {
    parts.push(
      `<defs><linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="${color}" stop-opacity="${muted ? 0.3 : 0.95}"/>` +
        `<stop offset="100%" stop-color="${color}" stop-opacity="${muted ? 0.16 : 0.55}"/>` +
        `</linearGradient></defs>` +
        `<rect x="0" y="${top}" width="${SIZE}" height="${height}" fill="url(#vol)"/>`,
    );
    parts.push(
      `<rect x="0" y="${top}" width="${SIZE}" height="${EDGE_HEIGHT}" fill="${color}" ` +
        `fill-opacity="${muted ? 0.45 : 1}"/>`,
    );
  }

  parts.push(ticks());
  parts.push(speakerIcon(pct, muted));

  if (showPercent) {
    // The number and the "%" are placed as one unit: the digits are centred a
    // little left of the key's middle so the suffix can sit beside them without
    // the pair drifting off-centre when the level goes from 9 to 100.
    const digits = String(pct);
    const digitsW = digits.length * NUMBER_SIZE * 0.556;
    const pctW = PCT_SIZE * 0.6;
    const startX = (SIZE - (digitsW + 4 + pctW)) / 2;
    parts.push(
      text(digits, { x: startX, y: NUMBER_Y, size: NUMBER_SIZE, weight: '700', anchor: 'start' }),
    );
    parts.push(
      text('%', {
        x: startX + digitsW + 4,
        y: NUMBER_Y,
        size: PCT_SIZE,
        weight: '600',
        fill: MUTED,
        anchor: 'start',
      }),
    );
  }

  parts.push(
    text(muted ? 'MUTED' : 'VOLUME', {
      y: LABEL_Y,
      size: LABEL_SIZE,
      weight: '700',
      fill: muted ? MAX : MUTED,
    }),
  );

  return toDataUrl(svgDoc(parts.join('')));
}

// Shown until the first reading arrives, and if the watcher ever dies.
export function renderVolumeUnknown(message) {
  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`,
    speakerIcon(0, false),
    text('—', { y: NUMBER_Y, size: NUMBER_SIZE, weight: '700', fill: MUTED }),
    text(message || 'VOLUME', { y: LABEL_Y, size: LABEL_SIZE, weight: '700', fill: MUTED }),
  ].join('');
  return toDataUrl(svgDoc(body));
}
