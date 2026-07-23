import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The deck receives the whole button image as a base64 data URL on every
// repaint — and while a long title is scrolling that is many times a second,
// not once. The cover dominates that payload, so it is squeezed hard before it
// is embedded.
//
// Resolution is what the eye reads on a key this size, and compression is what
// costs bytes, so the trade goes to quality rather than to pixels: at 180px the
// key is still rendering close to 1:1, while dropping quality from 70 to 45
// roughly halves the frame. Downscaling instead would have saved the same bytes
// and looked visibly soft.
const ART_PX = 180;
const ART_QUALITY = 45;
const CACHE_LIMIT = 8;

const TMP_DIR = path.join(os.tmpdir(), 'ulanzi-now-playing');
const cache = new Map();

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(String(stdout));
    });
  });
}

function remember(key, value) {
  cache.set(key, value);
  // Plain FIFO eviction — the working set is "the last few tracks played", so
  // anything fancier would never earn its keep.
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
}

async function shrinkToBase64(srcFile) {
  const outFile = `${srcFile}.small.jpg`;
  await run('/usr/bin/sips', [
    '-Z', String(ART_PX),
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(ART_QUALITY),
    srcFile, '--out', outFile,
  ]);
  const buf = await fs.readFile(outFile);
  await fs.rm(outFile, { force: true });
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function fetchRemoteArt(url, key) {
  const raw = path.join(TMP_DIR, `${key}.raw`);
  await run('/usr/bin/curl', ['-sL', '--max-time', '6', '-o', raw, url]);
  try {
    return await shrinkToBase64(raw);
  } finally {
    await fs.rm(raw, { force: true });
  }
}

// Apple Music has no artwork URL — the cover only exists as raw bytes inside the
// track, so AppleScript dumps it to a file and sips takes it from there.
async function extractMusicArt(key) {
  const raw = path.join(TMP_DIR, `${key}.raw`);
  const script = `
if application "Music" is running then
  tell application "Music"
    try
      set d to raw data of artwork 1 of current track
    on error
      return "NOART"
    end try
  end tell
  try
    set fh to open for access (POSIX file "${raw}") with write permission
    set eof fh to 0
    write d to fh
    close access fh
    return "OK"
  on error
    try
      close access (POSIX file "${raw}")
    end try
    return "NOART"
  end try
else
  return "NOART"
end if`;

  const result = (await run('/usr/bin/osascript', ['-e', script])).trim();
  if (result !== 'OK') return '';
  try {
    return await shrinkToBase64(raw);
  } finally {
    await fs.rm(raw, { force: true });
  }
}

function cacheKey(track) {
  return `${track.source}:${track.trackId}`;
}

/**
 * Returns a ready-to-embed data URL for the track's cover, or '' when the track
 * has no artwork. Never throws — a missing cover just falls back to the plain
 * background, which is far better than a button stuck on an error state.
 */
export async function getArtwork(track) {
  if (!track || !track.trackId) return '';
  const key = cacheKey(track);
  if (cache.has(key)) return cache.get(key);

  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
    const art = track.artworkUrl
      ? await fetchRemoteArt(track.artworkUrl, safeKey)
      : track.source === 'music'
        ? await extractMusicArt(safeKey)
        : '';
    return remember(key, art);
  } catch {
    // Cache the failure too, so a track whose cover can't be fetched doesn't
    // retry curl/sips once per second for as long as it plays.
    return remember(key, '');
  }
}
