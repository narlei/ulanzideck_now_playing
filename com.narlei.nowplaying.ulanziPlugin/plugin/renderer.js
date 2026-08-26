import { SIZE, BG, TEXT, MUTED, ACCENT, BLACK, TEXT_MARGIN, escapeXml, svgDoc, toDataUrl, measure, fitText, text } from './svg.js';

// Alpha always goes in its own attribute here, never in the colour — see the
// note at the top of svg.js.
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
// Short dwell at the top of each lap so the start of the title can be read
// before it moves. Kept brief — a long pause reads as a stall, not a rest.
const MARQUEE_LEAD_MS = 900;
// Blank space between the end of the text and the repeated copy chasing it.
const MARQUEE_GAP = 40;
// Shared with needsMarquee, so the decision to animate uses the same ladder the
// drawing does.
const TITLE_SIZES = [27, 25, 23, 21, 19];
const ARTIST_SIZES = [21, 20, 19, 18, 17];

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

// Every frame is a still picture and the plugin sends a new one several times a
// second — see MARQUEE_FRAME_MS in app.js.
//
// This started out as an SVG animation, which would have cost a single frame
// for the whole scroll. The hardware said otherwise, in three rounds: a
// negative `begin` was ignored, `keyTimes` looked ignored too, and even with
// neither of them the text still stepped instead of running. Whatever the deck
// does with a SMIL timeline, it isn't a smooth clock. Drawing each position
// ourselves depends on nothing but <clipPath>, which the hardware did confirm.
//
// The scroll runs one way and wraps, rather than sliding out and back: a
// there-and-back cycle spends most of its length parked at one end or the other
// and then reverses, which on a key this size reads as jerking rather than
// scrolling. A second copy of the text follows a gap behind the first, so when
// the run wraps the picture is already identical and nothing visibly snaps.
//
// `nowMs` is passed in rather than read here so every line on a key shares one
// clock and they stay in phase across a frame.
function marqueeText(str, { y, size, weight, fill, id, nowMs }) {
  // One lap moves the text by its own width plus the gap — at which point the
  // trailing copy sits exactly where the leading one started.
  const span = measure(str, size) + MARQUEE_GAP;
  const lapMs = (span / MARQUEE_SPEED) * 1000;
  const t = nowMs % (MARQUEE_LEAD_MS + lapMs);
  const offset = t <= MARQUEE_LEAD_MS
    ? 0
    : -((t - MARQUEE_LEAD_MS) / 1000) * MARQUEE_SPEED;
  const win = `<rect x="${TEXT_MARGIN}" y="${y - size}" width="${SIZE - TEXT_MARGIN * 2}" height="${size * 1.35}"/>`;
  const draw = (x) => text(str, { x, y, size, weight, fill, anchor: 'start' });

  return (
    `<defs><clipPath id="${id}">${win}</clipPath></defs>` +
    `<g clip-path="url(#${id})">` +
    draw(TEXT_MARGIN + offset) +
    draw(TEXT_MARGIN + offset + span) +
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
  return marqueeText(fit.text, { ...opts, size: fit.size });
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

export function renderTrack({ title, artist, artDataUrl, positionMs, durationMs, playing, showText, showTime, nowMs = Date.now() }) {
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
    // Only a playing track scrolls, so a paused one has to be pinned to the
    // start of the cycle rather than to the clock. Left on the clock it still
    // moved — just sampled once per idle tick, which came out as the text
    // sitting dead still and then jumping several seconds' worth at a time.
    const clock = playing ? nowMs : 0;
    parts.push(textLine(t, { y: titleY, weight: '700', id: 'mqTitle', nowMs: clock }));
    parts.push(textLine(a, { y: artistY, weight: '600', fill: MUTED, id: 'mqArtist', nowMs: clock }));
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
