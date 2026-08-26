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

export { SIZE, BG, TEXT, MUTED, ACCENT, BLACK, TEXT_MARGIN, escapeXml, svgDoc, toDataUrl, glyphEm, measure, fitText, text };
