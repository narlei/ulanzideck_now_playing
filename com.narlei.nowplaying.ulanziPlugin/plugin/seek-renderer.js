import { SIZE, BG, TEXT, MUTED, ACCENT, BLACK, svgDoc, toDataUrl, text, measure, polar, arcPath } from './svg.js';

// Alpha always goes in its own attribute here, never in the colour — see the
// note at the top of svg.js.

// The ring is the whole key: a bar this short would move a couple of pixels per
// minute on a long track, where a circle of this radius moves a visible arc.
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 76;
const RING_WIDTH = 15;
// Small disc riding the head of the arc, so the current position is readable at
// a glance even when the arc's own end is against a bright part of the cover.
const HEAD_R = 8;
// Colour used while a seek is still settling, and for the ±N badge.
const SEEK = '#4aa8ff';

const TIME_SIZE = 46;
// The clock has to clear the ring's inner edge, with a little air on each side.
const TIME_MAX_W = (R - RING_WIDTH / 2) * 2 - 16;
const TIME_Y = 108;
const SUB_SIZE = 20;
const SUB_Y = 136;
const STATE_Y = 62;

// The cover, when it is used as the background, is dimmed hard: this key is a
// control and the ring and the clock have to stay readable over any artwork.
const COVER_DIM = 0.62;

// h:mm:ss past the hour. A DJ set shown as "125:14" is both wrong-looking and
// too wide for the ring — the minutes alone run past its inner edge.
function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Even in h:mm:ss a long track is a wide string, so the elapsed time steps down
// until it fits rather than running out over the ring.
function fitSize(str, size, maxWidth) {
  let out = size;
  while (out > 20 && measure(str, out) > maxWidth) out -= 2;
  return out;
}

function background(artDataUrl) {
  if (!artDataUrl) return `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`;
  return (
    `<image href="${artDataUrl}" x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid slice"/>` +
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BLACK}" fill-opacity="${COVER_DIM}"/>`
  );
}

function ring(ratio, color) {
  const sweep = Math.min(1, Math.max(0, ratio)) * 360;
  const parts = [
    `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${TEXT}" stroke-opacity="0.18" stroke-width="${RING_WIDTH}"/>`,
  ];
  if (sweep <= 0) return parts.join('');

  parts.push(
    `<path d="${arcPath(CX, CY, R, sweep)}" fill="none" stroke="${color}" ` +
      `stroke-width="${RING_WIDTH}" stroke-linecap="round"/>`,
  );
  const [hx, hy] = polar(CX, CY, R, sweep);
  parts.push(`<circle cx="${hx}" cy="${hy}" r="${HEAD_R}" fill="${TEXT}"/>`);
  return parts.join('');
}

// Play / pause / seeking, drawn inside the top of the ring. Tiny on purpose —
// the clock in the middle is what the key is for.
function stateGlyph(playing, seeking) {
  if (seeking) {
    // Two chevrons, pointing the way the seek went.
    const d = seeking > 0 ? 1 : -1;
    const arm = (x) =>
      `<path d="M${x - 4 * d} ${STATE_Y - 8} L${x + 4 * d} ${STATE_Y} L${x - 4 * d} ${STATE_Y + 8}" ` +
      `fill="none" stroke="${SEEK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
    return arm(CX - 5 * d) + arm(CX + 5 * d);
  }
  if (playing) {
    return `<path d="M${CX - 7} ${STATE_Y - 9} L${CX + 9} ${STATE_Y} L${CX - 7} ${STATE_Y + 9} Z" fill="${TEXT}" fill-opacity="0.75"/>`;
  }
  return (
    `<rect x="${CX - 9}" y="${STATE_Y - 9}" width="6" height="18" rx="2" fill="${TEXT}" fill-opacity="0.75"/>` +
    `<rect x="${CX + 3}" y="${STATE_Y - 9}" width="6" height="18" rx="2" fill="${TEXT}" fill-opacity="0.75"/>`
  );
}

function seekBadge(deltaMs) {
  const secs = Math.round(deltaMs / 1000);
  const label = `${secs > 0 ? '+' : '−'}${Math.abs(secs)}s`;
  return text(label, { y: SUB_Y, size: SUB_SIZE + 2, weight: '700', fill: SEEK });
}

export function renderSeek({ positionMs, durationMs, playing, artDataUrl = '', seekDeltaMs = 0 }) {
  const live = !(durationMs > 0);
  const ratio = live ? 0 : positionMs / durationMs;
  const seeking = seekDeltaMs !== 0;
  const parts = [
    background(artDataUrl),
    ring(ratio, seeking ? SEEK : playing ? ACCENT : MUTED),
    stateGlyph(playing, seeking ? seekDeltaMs : 0),
  ];

  const now = clock(positionMs);
  parts.push(text(now, { y: TIME_Y, size: fitSize(now, TIME_SIZE, TIME_MAX_W), weight: '700' }));

  if (seeking) parts.push(seekBadge(seekDeltaMs));
  else if (live) parts.push(text('LIVE', { y: SUB_Y, size: SUB_SIZE, weight: '700', fill: MUTED }));
  else parts.push(text(clock(durationMs), { y: SUB_Y, size: SUB_SIZE, weight: '600', fill: MUTED }));

  return toDataUrl(svgDoc(parts.join('')));
}
