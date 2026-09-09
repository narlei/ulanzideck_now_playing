import { execFile } from 'node:child_process';

// Field separator for the AppleScript payloads. Unit Separator (U+001F) can't
// realistically appear in a track title, so splitting on it is safe where "|"
// or a tab would not be.
const SEP = String.fromCharCode(31);

export const SOURCES = {
  spotify: { id: 'spotify', app: 'Spotify', label: 'Spotify' },
  music: { id: 'music', app: 'Music', label: 'Apple Music' },
};

function osascript(script, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(String(stdout).trim());
    });
  });
}

// `application "X" is running` is the one form that does NOT launch the app as a
// side effect — every other `tell` would start Spotify/Music just by asking.
function runningGuard(appName, body) {
  return `if application "${appName}" is running then\n${body}\nelse\nreturn "NOTRUNNING"\nend if`;
}

const SPOTIFY_READ = runningGuard('Spotify', `
tell application "Spotify"
  try
    set t to current track
    set sep to (character id 31)
    set pState to player state as text
    set posMs to (round (player position * 1000))
    return "OK" & sep & pState & sep & (id of t) & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & ((duration of t) as text) & sep & (posMs as text) & sep & (artwork url of t)
  on error
    return "NOTRACK"
  end try
end tell`);

const MUSIC_READ = runningGuard('Music', `
tell application "Music"
  try
    set t to current track
    set sep to (character id 31)
    set pState to player state as text
    set posMs to (round (player position * 1000))
    set durMs to (round ((duration of t) * 1000))
    set tid to ((persistent ID of t) as text)
    return "OK" & sep & pState & sep & tid & sep & (name of t) & sep & (artist of t) & sep & (album of t) & sep & (durMs as text) & sep & (posMs as text) & sep & ""
  on error
    return "NOTRACK"
  end try
end tell`);

function parseReadResult(raw, sourceId) {
  // When the reading was taken. The position it carries is only true as of this
  // instant, and a playing track has moved on by the time the next poll lands —
  // callers advance it from here rather than showing a second-old number.
  const capturedAt = Date.now();
  if (raw === 'NOTRUNNING') return { status: 'not-running', source: sourceId, capturedAt };
  if (raw === 'NOTRACK') return { status: 'no-track', source: sourceId, capturedAt };

  const parts = raw.split(SEP);
  if (parts[0] !== 'OK' || parts.length < 9) return { status: 'no-track', source: sourceId, capturedAt };

  const [, state, trackId, title, artist, album, durationMs, positionMs, artworkUrl] = parts;
  const playing = state === 'playing';
  return {
    status: playing ? 'playing' : 'paused',
    source: sourceId,
    playing,
    trackId: trackId || `${title}::${artist}`,
    title: title || '',
    artist: artist || '',
    album: album || '',
    durationMs: Number(durationMs) || 0,
    positionMs: Number(positionMs) || 0,
    artworkUrl: artworkUrl || '',
    capturedAt,
  };
}

export async function readSource(sourceId) {
  const script = sourceId === 'music' ? MUSIC_READ : SPOTIFY_READ;
  try {
    return parseReadResult(await osascript(script), sourceId);
  } catch (e) {
    return { status: 'error', source: sourceId, message: e?.message || 'osascript failed', capturedAt: Date.now() };
  }
}

// "auto" prefers whichever player is actually playing; if both are merely open
// and paused, the first one with a loaded track wins so the button still shows
// what you were last listening to.
export async function readNowPlaying(preferred = 'auto') {
  if (preferred === 'spotify' || preferred === 'music') return readSource(preferred);

  const results = await Promise.all([readSource('spotify'), readSource('music')]);
  return (
    results.find((r) => r.status === 'playing') ||
    results.find((r) => r.status === 'paused') ||
    results.find((r) => r.status === 'no-track') ||
    results[0]
  );
}

const COMMANDS = {
  playPause: 'playpause',
  next: 'next track',
  previous: 'previous track',
};

export async function sendCommand(sourceId, command) {
  const src = SOURCES[sourceId];
  const verb = COMMANDS[command];
  if (!src || !verb) return;
  await osascript(runningGuard(src.app, `tell application "${src.app}" to ${verb}`));
}

// Seeking is a write to the same `player position` both apps expose for
// reading, in seconds. Whole seconds only: Spotify takes a real happily but
// Music's property is an integer in some versions, and at a 5s minimum step the
// rounding is invisible either way.
export async function seekTo(sourceId, positionMs) {
  const src = SOURCES[sourceId];
  if (!src) return;
  const seconds = Math.max(0, Math.round(positionMs / 1000));
  await osascript(runningGuard(src.app, `tell application "${src.app}" to set player position to ${seconds}`));
}
