import { spawn, execFile } from 'node:child_process';

// Reading the system volume the same way the track poller reads the players —
// one `osascript` per tick — does not work here. A cold `osascript` costs about
// 180ms of process start alone, so a poll fast enough to watch the level climb
// would spend more time forking than reading. Instead one osascript is started
// once and loops inside AppleScript, printing every reading.
//
// `log` rather than `return`: a script only returns when it ends, and this one
// never does. `log` writes the line to stderr immediately, unbuffered, which is
// exactly the stream we want.
const WATCH_INTERVAL = 0.1;
const WATCH_SCRIPT = `repeat
  set s to (get volume settings)
  log ((output volume of s as text) & "," & (output muted of s as text))
  delay ${WATCH_INTERVAL}
end repeat`;

// If the watcher dies (osascript killed, the machine slept), come back — but not
// in a tight loop, in case it is failing for a reason that will not clear.
const RESTART_MS = 2000;

let child = null;
let restartTimer = null;
let listener = null;
let last = null;

function log(...args) {
  console.log('[now-playing/volume]', ...args);
}

function parseLine(line) {
  const [level, muted] = line.split(',');
  const n = Number(level);
  if (!Number.isFinite(n)) return null;
  return { level: Math.round(n), muted: muted === 'true' };
}

function emit(reading) {
  last = reading;
  if (listener) listener(reading);
}

function spawnWatcher() {
  child = spawn('/usr/bin/osascript', ['-e', WATCH_SCRIPT], { stdio: ['ignore', 'ignore', 'pipe'] });

  // A reading can arrive split across chunks, so lines are reassembled rather
  // than assumed to be one chunk each.
  let buffer = '';
  child.stderr.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const reading = parseLine(line.trim());
      if (reading) emit(reading);
    }
  });

  child.on('error', (e) => log('watcher failed to start', e?.message));
  child.on('exit', (code, signal) => {
    child = null;
    if (!listener) return;
    log(`watcher exited (${signal || code}), restarting in ${RESTART_MS}ms`);
    restartTimer = setTimeout(spawnWatcher, RESTART_MS);
  });
}

// Only ever one watcher, however many volume keys are on the deck: they all read
// the same number.
export function startVolumeWatch(onReading) {
  listener = onReading;
  if (last) onReading(last);
  if (!child) spawnWatcher();
}

export function stopVolumeWatch() {
  listener = null;
  last = null;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  if (child) child.kill();
  child = null;
}

export function currentVolume() {
  return last;
}

function osascript(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], { timeout: 4000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(String(stdout).trim());
    });
  });
}

export function clampLevel(level) {
  return Math.min(100, Math.max(0, Math.round(level)));
}

// Setting the volume does cost a process start, but it happens per user action
// rather than per tick, and app.js coalesces a burst of dial ticks into one
// call. Level and mute go in the same statement so the two can never land as
// two separate readings — a flicker of "loud and unmuted" between them would be
// audible, not just visible.
export async function setVolume(level, muted = false) {
  const v = clampLevel(level);
  await osascript(`set volume output volume ${v} output muted ${muted ? 'true' : 'false'}`);
}

export async function setMuted(muted) {
  await osascript(`set volume output muted ${muted ? 'true' : 'false'}`);
}
