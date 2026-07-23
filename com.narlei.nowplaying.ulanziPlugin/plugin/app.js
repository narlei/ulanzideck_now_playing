import UlanziApi from './plugin-common-node/index.js';
import { readNowPlaying, sendCommand, SOURCES } from './players.js';
import { getArtwork } from './artwork.js';
import { renderTrack, renderIdle, renderNotRunning, renderError, needsMarquee } from './renderer.js';

const PLUGIN_UUID = 'com.narlei.nowplaying.plugin';
const TICK_PLAYING_MS = 1000;
const TICK_IDLE_MS = 3000;
// Scrolling text is drawn frame by frame here rather than animated by the deck,
// so it needs its own timer. This one only redraws from the cached snapshot —
// it never polls the player. At MARQUEE_SPEED that works out to ~2px of travel
// per frame, which is the point where the steps stop being visible as steps.
// It is an upper bound, not a promise — see the high-water mark below.
const MARQUEE_FRAME_MS = 60;
// A track frame is ~32KB of base64, most of it the cover art, and the deck has
// to decode, parse, rasterize and push it to the key over USB before it can
// take the next one. That is much slower than the frame timer, and `ws` queues
// whatever we hand it: offering frames faster than the socket drains built an
// unbounded backlog, so what the key showed was seconds behind and arrived in
// bursts — the freeze-then-jump. Skipping a frame is free; queueing one is not.
const SOCKET_HIGH_WATER = 48 * 1024;
// How often to report the rate the deck is actually sustaining.
const MARQUEE_STATS_MS = 10000;

const $UD = new UlanziApi();
const INSTANCES = new Map();
// One poll per *source setting* per tick, not one per button: three buttons all
// watching Spotify would otherwise fire three osascript calls a second.
const SNAPSHOTS = new Map();

let tickTimer = null;
let tickMs = 0;
let polling = false;
let frameTimer = null;
let frames = 0;
let dropped = 0;
let statsAt = 0;

// Unflushed bytes still sitting in the socket. Growing means the deck is behind
// and anything we add now would be shown late rather than shown sooner.
function socketBusy() {
  const ws = $UD.websocket;
  return !!ws && ws.bufferedAmount > SOCKET_HIGH_WATER;
}

function log(...args) {
  console.log('[now-playing]', ...args);
}

function defaultSettings() {
  return { source: 'auto', clickAction: 'playPause', showText: 'on', showTime: 'on' };
}

function settingsOf(inst) {
  return { ...defaultSettings(), ...(inst.settings || {}) };
}

function sourceLabel(sourceId) {
  if (sourceId === 'auto') return 'Spotify / Apple Music';
  return SOURCES[sourceId]?.label || sourceId;
}

// `nowMs` is threaded through so that every key repainted in the same frame
// scrolls from the same clock reading, instead of each one sampling Date.now()
// a few milliseconds apart and drifting out of step.
function renderForInstance(inst, nowMs = Date.now()) {
  const s = settingsOf(inst);
  const snap = SNAPSHOTS.get(s.source);

  if (!snap) {
    $UD.setBaseDataIcon(inst.context, renderIdle(sourceLabel(s.source)));
    return;
  }
  if (snap.status === 'error') {
    $UD.setBaseDataIcon(inst.context, renderError(snap.message));
    return;
  }
  if (snap.status === 'not-running') {
    $UD.setBaseDataIcon(inst.context, renderNotRunning(sourceLabel(s.source)));
    return;
  }
  if (snap.status === 'no-track') {
    $UD.setBaseDataIcon(inst.context, renderIdle(sourceLabel(s.source)));
    return;
  }

  $UD.setBaseDataIcon(inst.context, renderTrack({
    title: snap.title,
    artist: snap.artist,
    artDataUrl: snap.artDataUrl || '',
    positionMs: snap.positionMs,
    durationMs: snap.durationMs,
    playing: snap.playing,
    showText: s.showText !== 'off',
    showTime: s.showTime !== 'off',
    nowMs,
  }));
}

function renderAll() {
  const nowMs = Date.now();
  for (const inst of INSTANCES.values()) {
    if (inst.active) renderForInstance(inst, nowMs);
  }
  scheduleFrames();
}

// Whether this particular button has text long enough to scroll. Anything that
// fits stays on the 1s tick, so the fast timer costs nothing in the common case.
function instMarquees(inst) {
  if (!inst.active) return false;
  const s = settingsOf(inst);
  const snap = SNAPSHOTS.get(s.source);
  if (!snap || snap.status !== 'playing') return false;
  return needsMarquee({ title: snap.title, artist: snap.artist, showText: s.showText !== 'off' });
}

function anyMarquee() {
  for (const inst of INSTANCES.values()) {
    if (instMarquees(inst)) return true;
  }
  return false;
}

function scheduleFrames() {
  const wanted = anyMarquee();
  if (wanted === !!frameTimer) return;
  if (!wanted) {
    clearInterval(frameTimer);
    frameTimer = null;
    return;
  }
  frames = 0;
  dropped = 0;
  statsAt = Date.now();
  frameTimer = setInterval(() => {
    // Backpressure first: if the previous frame hasn't even left the socket,
    // drawing another one only makes the backlog worse. The offset is computed
    // from the wall clock, so a skipped frame costs nothing but smoothness —
    // the next one drawn is at the position it should be at, not the next in
    // some sequence. The marquee therefore settles at whatever rate the deck
    // can genuinely sustain, evenly, instead of galloping and stalling.
    if (socketBusy()) {
      dropped++;
      return;
    }

    // Only the keys that are actually scrolling. Repainting a static key 16
    // times a second buys nothing and every repaint pushes a full-size icon
    // down the socket, which is what the scrolling keys are competing for.
    const nowMs = Date.now();
    for (const inst of INSTANCES.values()) {
      if (instMarquees(inst)) renderForInstance(inst, nowMs);
    }
    frames++;

    const elapsed = nowMs - statsAt;
    if (elapsed >= MARQUEE_STATS_MS) {
      log(`marquee ${(frames / (elapsed / 1000)).toFixed(1)} fps, ${dropped} frames dropped to backpressure`);
      frames = 0;
      dropped = 0;
      statsAt = nowMs;
    }
  }, MARQUEE_FRAME_MS);
}

function neededSources() {
  const set = new Set();
  for (const inst of INSTANCES.values()) {
    if (inst.active) set.add(settingsOf(inst).source);
  }
  return set;
}

async function pollOnce() {
  if (polling) return;
  const sources = neededSources();
  if (!sources.size) return;

  polling = true;
  try {
    await Promise.all([...sources].map(async (sourceId) => {
      const snap = await readNowPlaying(sourceId);
      const prev = SNAPSHOTS.get(sourceId);

      // Artwork survives across ticks of the same track — refetching it every
      // second would hammer curl/sips for a picture that never changed.
      if (snap.trackId && prev && prev.trackId === snap.trackId && prev.artDataUrl !== undefined) {
        snap.artDataUrl = prev.artDataUrl;
      } else if (snap.trackId) {
        snap.artDataUrl = await getArtwork(snap);
      }

      SNAPSHOTS.set(sourceId, snap);
    }));

    // Drop snapshots for sources nobody watches anymore.
    for (const key of [...SNAPSHOTS.keys()]) {
      if (!sources.has(key)) SNAPSHOTS.delete(key);
    }
  } catch (e) {
    log('poll failed', e?.message);
  } finally {
    polling = false;
    renderAll();
    scheduleTick();
  }
}

function scheduleTick() {
  const anyPlaying = [...SNAPSHOTS.values()].some((s) => s.status === 'playing');
  const wanted = anyPlaying ? TICK_PLAYING_MS : TICK_IDLE_MS;
  if (tickTimer && wanted === tickMs) return;

  if (tickTimer) clearInterval(tickTimer);
  tickMs = wanted;
  tickTimer = setInterval(pollOnce, tickMs);
}

function stopTicking() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  tickMs = 0;
  if (frameTimer) clearInterval(frameTimer);
  frameTimer = null;
}

function syncPolling() {
  if (neededSources().size === 0) {
    stopTicking();
    SNAPSHOTS.clear();
    return;
  }
  scheduleTick();
  pollOnce();
}

function ensureInstance(context, settings) {
  let inst = INSTANCES.get(context);
  if (!inst) {
    inst = {
      context,
      settings: settings && Object.keys(settings).length ? settings : defaultSettings(),
      active: true,
    };
    INSTANCES.set(context, inst);
    renderForInstance(inst);
    syncPolling();
    return inst;
  }

  if (settings && Object.keys(settings).length) {
    const prevSource = settingsOf(inst).source;
    inst.settings = settings;
    renderForInstance(inst);
    if (settingsOf(inst).source !== prevSource) syncPolling();
  }
  return inst;
}

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => log('connected'));

$UD.onAdd((msg) => {
  log('add', msg.context);
  ensureInstance(msg.context, msg.param || {});
});

$UD.onParamFromApp((msg) => {
  renderForInstance(ensureInstance(msg.context, msg.param || {}));
});

$UD.onParamFromPlugin((msg) => {
  renderForInstance(ensureInstance(msg.context, msg.param || {}));
});

// Where the Property Inspector's setSettings() actually lands — without this
// the button keeps running with the settings it started with.
$UD.onDidReceiveSettings((msg) => {
  const settings = msg.settings || msg.param || {};
  log('didReceiveSettings', msg.context, settings);
  ensureInstance(msg.context, settings);
});

$UD.onRun(async (msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  const s = settingsOf(inst);
  if (s.clickAction === 'none') return;

  const snap = SNAPSHOTS.get(s.source);
  // "auto" resolves to whichever player the snapshot actually came from, so the
  // key controls the app you're hearing rather than a guess.
  const target = s.source === 'auto' ? snap?.source : s.source;
  if (!target) return;

  try {
    await sendCommand(target, s.clickAction);
  } catch (e) {
    log('command failed', s.clickAction, e?.message);
  }
  // Give the player a beat to apply the command before repainting the key.
  setTimeout(pollOnce, 250);
});

$UD.onSetActive((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) return;
  inst.active = !!msg.active;
  if (inst.active) renderForInstance(inst);
  syncPolling();
});

$UD.onClear((msg) => {
  if (!msg.param) return;
  for (const item of msg.param) {
    if (INSTANCES.delete(item.context)) log('clear', item.context);
  }
  syncPolling();
});

$UD.onError((err) => log('socket error', err));
$UD.onClose(() => log('socket closed'));
