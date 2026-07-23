// IMPORTANT: never express translucency as rgba() here. SVG 1.1 only accepts an
// opaque colour in `fill`/`stop-color`, and the deck's renderer follows that to
// the letter — it drops the whole rgba() and paints the element fully OPAQUE.
// (Chromium accepts rgba() as an extension, so a browser preview will look
// correct while the actual button renders a solid black slab over the artwork.)
// Alpha therefore always goes in its own attribute: fill-opacity, stop-opacity.
const SIZE = 200;
const BG = '#141417';
const TEXT = '#ffffff';
const MUTED = '#c8c8d2';
const ACCENT = '#1db954';
const BLACK = '#000000';
// Small breathing room on each side — the text may run nearly edge to edge.
const TEXT_MARGIN = 8;
// The panel carries legibility, so the pause dim only has to hint at the state —
// the badge and the greyed bar already say it outright.
const PAUSE_DIM = 0.22;
// The panel behind the title/artist/time block and the progress bar.
const PANEL_OPACITY = 0.55;
// Slightly heavier at the very bottom so the progress bar's track reads clearly.
const PANEL_OPACITY_BOTTOM = 0.72;
// Height of the soft fade above the text, in px.
const PANEL_FADE = 26;
// Thickness of the progress bar, which runs along the top edge.
const BAR_HEIGHT = 9;
// Baseline of the elapsed/duration row, which sits just under the bar.
const TIME_Y = 31;
const TIME_SIZE = 17;

// Marquee, for text that overflows even at the smallest step. Verified on the
// hardware: the deck's renderer honours both <clipPath> and SMIL, so a
// scrolling title costs one frame instead of a stream of them.
// How fast the text slides, in px per second. Slow enough to read.
const MARQUEE_SPEED = 34;
// Dwell at each end before turning around, so both the start and the end of the
// title can actually be read.
const MARQUEE_PAUSE_MS = 1400;
// A few px past the overflow, so the last glyph clears the edge instead of
// sitting flush against it.
const MARQUEE_TAIL = 4;
// Shared with needsMarquee, so the decision to animate uses the same ladder the
// drawing does.
const TITLE_SIZES = [27, 25, 23, 21, 19];
const ARTIST_SIZES = [21, 20, 19, 18, 17];

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgDoc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${body}</svg>`;
}

function toDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// Per-glyph advance widths in em, measured from the actual bold UI font the
// deck renders with. A flat average ratio overestimates badly — lowercase and
// spaces dominate song titles, so "Ela Vai Voltar (Tediante)" measures 11.2em
// where a 0.58 average guessed 14.5em and truncated a title that in fact fits.
const GLYPH_EM = {
  a: 0.556, b: 0.611, c: 0.556, d: 0.611, e: 0.556, f: 0.333, g: 0.611, h: 0.611,
  i: 0.278, j: 0.278, k: 0.556, l: 0.278, m: 0.889, n: 0.611, o: 0.611, p: 0.611,
  q: 0.611, r: 0.389, s: 0.556, t: 0.333, u: 0.611, v: 0.556, w: 0.778, x: 0.556,
  y: 0.556, z: 0.5,
  A: 0.722, B: 0.722, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722,
  I: 0.278, J: 0.556, K: 0.722, L: 0.611, M: 0.833, N: 0.722, O: 0.778, P: 0.667,
  Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667,
  Y: 0.667, Z: 0.611,
  0: 0.556, 1: 0.556, 2: 0.556, 3: 0.556, 4: 0.556, 5: 0.556, 6: 0.556, 7: 0.556,
  8: 0.556, 9: 0.556,
  ' ': 0.278, '.': 0.278, ',': 0.278, ':': 0.333, ';': 0.333, '!': 0.333, '?': 0.611,
  '(': 0.333, ')': 0.333, '[': 0.333, ']': 0.333, '-': 0.333, '–': 0.556, '—': 1,
  "'": 0.238, '"': 0.474, '’': 0.238, '&': 0.722, '/': 0.278, '*': 0.389, '+': 0.584,
  '…': 1,
};
const DEFAULT_EM = 0.6;
// Anything from CJK ideographs / kana onward is full-width in practice.
const WIDE_FROM = 0x2e80;

function glyphEm(ch) {
  const w = GLYPH_EM[ch];
  if (w !== undefined) return w;
  if (ch.codePointAt(0) >= WIDE_FROM) return 1;
  // Accented latin advances the same as its base letter, so strip the mark and
  // look that up rather than falling back to the average.
  const base = ch.normalize('NFD')[0];
  return GLYPH_EM[base] ?? DEFAULT_EM;
}

function measure(str, fontSize) {
  let em = 0;
  for (const ch of String(str)) em += glyphEm(ch);
  return em * fontSize;
}

function fitText(text, fontSize, maxWidth = SIZE - TEXT_MARGIN * 2) {
  const s = String(text || '');
  if (!s) return '';
  if (measure(s, fontSize) <= maxWidth) return s;

  const ellipsisW = measure('…', fontSize);
  let width = 0;
  let out = '';
  for (const ch of s) {
    const w = glyphEm(ch) * fontSize;
    if (width + w + ellipsisW > maxWidth) break;
    width += w;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

// Long titles look better one or two points smaller than scrolled, so step the
// size down first and only report an overflow once the smallest size still
// doesn't fit. Nothing is ever truncated here — the caller scrolls instead.
function autoFitScroll(str, sizes, maxWidth) {
  const s = String(str || '');
  for (const size of sizes) {
    if (measure(s, size) <= maxWidth) return { text: s, size, overflow: 0 };
  }
  const size = sizes[sizes.length - 1];
  return { text: s, size, overflow: measure(s, size) - maxWidth };
}

// Drawn twice: an offset black copy underneath, then the real one. Cheap, and
// unlike a stroke outline it needs no SVG2 features from the deck's renderer.
function text(str, { x = SIZE / 2, y, size, weight = '700', fill = TEXT, anchor = 'middle' }) {
  const t = escapeXml(str);
  const font = `font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"`;
  return (
    `<text x="${x + 1}" y="${y + 1}" ${font} fill="${BLACK}" fill-opacity="0.75">${t}</text>` +
    `<text x="${x}" y="${y}" ${font} fill="${fill}">${t}</text>`
  );
}

// One full there-and-back cycle as (time, offset) breakpoints: dwell, slide out,
// dwell, slide back.
function marqueeCycle(travel, travelMs) {
  return [
    [0, 0],
    [MARQUEE_PAUSE_MS, 0],
    [MARQUEE_PAUSE_MS + travelMs, -travel],
    [2 * MARQUEE_PAUSE_MS + travelMs, -travel],
    [2 * (MARQUEE_PAUSE_MS + travelMs), 0],
  ];
}

function offsetAt(cycle, t) {
  for (let i = 1; i < cycle.length; i++) {
    const [t0, v0] = cycle[i - 1];
    const [t1, v1] = cycle[i];
    if (t <= t1) {
      const span = t1 - t0;
      return span === 0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / span;
    }
  }
  return cycle[cycle.length - 1][1];
}

// Every frame is a still picture and the plugin sends a new one several times a
// second — see MARQUEE_FRAME_MS in app.js.
//
// This started out as an SVG animation, which would have cost a single frame
// for the whole scroll. The hardware said otherwise, in three rounds: a
// negative `begin` was ignored, `keyTimes` looked ignored too, and even with
// neither of them the text still stepped instead of running. Whatever the deck
// does with a SMIL timeline, it isn't a smooth clock. Drawing each position
// ourselves depends on nothing but <clipPath>, which the hardware did confirm.
function marqueeText(str, { y, size, weight, fill, overflow, id }) {
  const travel = overflow + MARQUEE_TAIL;
  const travelMs = (travel / MARQUEE_SPEED) * 1000;
  const cycle = marqueeCycle(travel, travelMs);
  const totalMs = cycle[cycle.length - 1][0];
  const offset = offsetAt(cycle, Date.now() % totalMs);
  const win = `<rect x="${TEXT_MARGIN}" y="${y - size}" width="${SIZE - TEXT_MARGIN * 2}" height="${size * 1.35}"/>`;

  return (
    `<defs><clipPath id="${id}">${win}</clipPath></defs>` +
    `<g clip-path="url(#${id})">` +
    text(str, { x: TEXT_MARGIN + offset, y, size, weight, fill, anchor: 'start' }) +
    `</g>`
  );
}

// Whether this track's text needs animating at all, so the caller can run the
// fast frame timer only while something is actually scrolling.
export function needsMarquee({ title, artist, showText }) {
  if (!showText) return false;
  const w = SIZE - TEXT_MARGIN * 2;
  return (
    autoFitScroll(title || 'Unknown track', TITLE_SIZES, w).overflow > 0 ||
    autoFitScroll(artist || '', ARTIST_SIZES, w).overflow > 0
  );
}

// Centred when it fits, scrolling when it doesn't.
function textLine(fit, opts) {
  if (!fit.overflow) return text(fit.text, { ...opts, size: fit.size });
  return marqueeText(fit.text, { ...opts, size: fit.size, overflow: fit.overflow });
}

export function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function artLayer(artDataUrl, dim) {
  if (!artDataUrl) {
    return (
      `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>` +
      `<text x="${SIZE / 2}" y="98" font-size="70" text-anchor="middle" fill="#3a3a44">♫</text>`
    );
  }
  return (
    `<image href="${artDataUrl}" x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid slice"/>` +
    (dim ? `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BLACK}" fill-opacity="${PAUSE_DIM}"/>` : '')
  );
}

// Full-bleed panel behind the whole lower block — title, artist, time row and
// the progress bar all sit on top of it. It runs edge to edge and down to the
// bottom, with a short fade at the top so it doesn't cut a hard line across the
// cover. Alpha lives in stop-opacity, never in the colour — see the note at the
// top of this file.
function textPanel(contentTopY) {
  const fadeTop = Math.max(0, contentTopY - PANEL_FADE);
  const height = SIZE - fadeTop;
  // Where the fade finishes, as a percentage of the panel's own height.
  const solidAt = height > 0 ? Math.round((PANEL_FADE / height) * 100) : 0;
  return (
    `<defs><linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${BLACK}" stop-opacity="0"/>` +
    `<stop offset="${solidAt}%" stop-color="${BLACK}" stop-opacity="${PANEL_OPACITY}"/>` +
    `<stop offset="100%" stop-color="${BLACK}" stop-opacity="${PANEL_OPACITY_BOTTOM}"/>` +
    `</linearGradient></defs>` +
    `<rect x="0" y="${fadeTop}" width="${SIZE}" height="${height}" fill="url(#panel)"/>`
  );
}

// The bar sits at the very top of the button, so it needs its own scrim: on a
// light cover the 28% white track would otherwise vanish. Short fade downwards
// so it reads as a shadow under the bar rather than a band. When the time row
// is on, the scrim has to reach past its baseline as well.
function topScrim(withTimeRow) {
  const height = withTimeRow ? TIME_Y + 8 : BAR_HEIGHT + 12;
  const solidAt = Math.round(((withTimeRow ? TIME_Y : BAR_HEIGHT) / height) * 100);
  return (
    `<defs><linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${BLACK}" stop-opacity="${PANEL_OPACITY_BOTTOM}"/>` +
    `<stop offset="${solidAt}%" stop-color="${BLACK}" stop-opacity="${PANEL_OPACITY}"/>` +
    `<stop offset="100%" stop-color="${BLACK}" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    `<rect x="0" y="0" width="${SIZE}" height="${height}" fill="url(#topScrim)"/>`
  );
}

function progressBar(ratio, y, color = ACCENT) {
  const clamped = Math.min(1, Math.max(0, ratio || 0));
  const w = Math.round(SIZE * clamped);
  return (
    `<rect x="0" y="${y}" width="${SIZE}" height="${BAR_HEIGHT}" fill="${TEXT}" fill-opacity="0.28"/>` +
    (w > 0 ? `<rect x="0" y="${y}" width="${w}" height="${BAR_HEIGHT}" fill="${color}"/>` : '')
  );
}

function pauseBadge() {
  return (
    `<circle cx="${SIZE / 2}" cy="82" r="32" fill="${BLACK}" fill-opacity="0.55"/>` +
    `<rect x="${SIZE / 2 - 12}" y="66" width="9" height="33" rx="2" fill="${TEXT}"/>` +
    `<rect x="${SIZE / 2 + 3}" y="66" width="9" height="33" rx="2" fill="${TEXT}"/>`
  );
}

export function renderTrack({ title, artist, artDataUrl, positionMs, durationMs, playing, showText, showTime }) {
  const ratio = durationMs > 0 ? positionMs / durationMs : 0;
  const timeRow = showTime && durationMs > 0;
  const parts = [artLayer(artDataUrl, !playing)];

  if (!playing) parts.push(pauseBadge());

  if (showText) {
    const artistY = 178;
    const titleY = artistY - 32;
    const w = SIZE - TEXT_MARGIN * 2;
    const t = autoFitScroll(title || 'Unknown track', TITLE_SIZES, w);
    const a = autoFitScroll(artist || '', ARTIST_SIZES, w);

    // Track the title's actual cap height rather than assume fixed bounds — it
    // shrinks a couple of points on long names, and the panel follows it.
    const panelTop = titleY - t.size * 0.8 - 7;
    parts.push(textPanel(panelTop));
    parts.push(textLine(t, { y: titleY, weight: '700', id: 'mqTitle' }));
    parts.push(textLine(a, { y: artistY, weight: '600', fill: MUTED, id: 'mqArtist' }));
  }

  parts.push(topScrim(timeRow));
  parts.push(progressBar(ratio, 0, playing ? ACCENT : MUTED));
  if (timeRow) {
    parts.push(text(formatTime(positionMs), { x: 8, y: TIME_Y, size: TIME_SIZE, weight: '600', fill: MUTED, anchor: 'start' }));
    parts.push(text(formatTime(durationMs), { x: SIZE - 8, y: TIME_Y, size: TIME_SIZE, weight: '600', fill: MUTED, anchor: 'end' }));
  }
  return toDataUrl(svgDoc(parts.join('')));
}

function renderMessage({ icon, line1, line2 }) {
  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`,
    icon ? `<text x="${SIZE / 2}" y="92" font-size="66" text-anchor="middle" fill="#4a4a55">${escapeXml(icon)}</text>` : '',
    line1 ? text(fitText(line1, 27), { y: 142, size: 27, weight: '700' }) : '',
    line2 ? text(fitText(line2, 20), { y: 174, size: 20, weight: '600', fill: MUTED }) : '',
  ].join('');
  return toDataUrl(svgDoc(body));
}

export function renderIdle(sourceLabel) {
  return renderMessage({ icon: '♫', line1: 'Nothing playing', line2: sourceLabel });
}

export function renderNotRunning(sourceLabel) {
  return renderMessage({ icon: '♫', line1: sourceLabel, line2: 'not running' });
}

export function renderError(msg) {
  return renderMessage({ icon: '⚠', line1: 'Now Playing', line2: msg || 'error' });
}
