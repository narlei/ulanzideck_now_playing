import UlanziApi from './plugin-common-node/index.js';
import { readNowPlaying, sendCommand, SOURCES } from './players.js';
import { getArtwork } from './artwork.js';
import { renderTrack, renderIdle, renderNotRunning, renderError, needsMarquee } from './renderer.js';
import { renderVolume, renderVolumeUnknown } from './volume-renderer.js';
import { startVolumeWatch, stopVolumeWatch, setVolume, setMuted, clampLevel } from './volume.js';

const PLUGIN_UUID = 'com.narlei.nowplaying.plugin';
const ACTION_VOLUME = `${PLUGIN_UUID}.volume`;
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

// The action a context belongs to is encoded in the context itself — see
// encodeContext in the common lib — so a key can be routed without waiting for
// the `add` that carried its uuid.
function actionOf(context) {
  return String(context).split('___')[0];
}

function isVolume(inst) {
  return inst.action === ACTION_VOLUME;
}

function defaultSettings(action) {
  if (action === ACTION_VOLUME) {
    return { clickAction: 'mute', step: '5', showPercent: 'on' };
  }
  return { source: 'auto', clickAction: 'playPause', showText: 'on', showTime: 'on' };
}

function settingsOf(inst) {
  return { ...defaultSettings(inst.action), ...(inst.settings || {}) };
}

function sourceLabel(sourceId) {
  if (sourceId === 'auto') return 'Spotify / Apple Music';
  return SOURCES[sourceId]?.label || sourceId;
}

// `nowMs` is threaded through so that every key repainted in the same frame
// scrolls from the same clock reading, instead of each one sampling Date.now()
// a few milliseconds apart and drifting out of step.
function renderForInstance(inst, nowMs = Date.now()) {
  if (isVolume(inst)) return renderVolumeInstance(inst);

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
  if (!inst.active || isVolume(inst)) return false;
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
    if (inst.active && !isVolume(inst)) set.add(settingsOf(inst).source);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Volume
//
// The level is streamed, not polled — see the note at the top of volume.js —
// so the key redraws within about a tenth of a second of the volume moving,
// whether it moved from this button, the keyboard keys or anything else. Frames
// only go out when the reading actually changes, so a key sitting at 40% costs
// nothing.

// Reading currently shown on the keys. While the user is adjusting, this is the
// value we asked for rather than the last one the system reported.
let volumeNow = null;
// The value we are steering towards, with the deadline after which the system
// gets the last word again. `set volume` costs a process start, so a burst of
// dial ticks would otherwise arrive as a queue of osascript calls, each landing
// after the key had already been drawn somewhere else — the bar would jump
// backwards between ticks.
let volumeWanted = null;
let volumeGuardUntil = 0;
let volumeApplyTimer = null;
let volumeWatching = false;
// How long the watcher is allowed to disagree with what we asked for before we
// assume the write failed (or something else moved the volume) and defer to it.
const VOLUME_GUARD_MS = 1200;
// A dial tick can arrive every few milliseconds; one `set volume` per burst is
// enough, and the key is already showing the target in the meantime.
const VOLUME_APPLY_MS = 60;

function renderVolumeInstance(inst) {
  const s = settingsOf(inst);
  const icon = volumeNow
    ? renderVolume({ level: volumeNow.level, muted: volumeNow.muted, showPercent: s.showPercent !== 'off' })
    : renderVolumeUnknown();

  // Same picture as last time means nothing to send. Volume keys are otherwise
  // free to spam the socket the marquee is competing for.
  if (icon === inst.lastIcon) return;
  inst.lastIcon = icon;
  $UD.setBaseDataIcon(inst.context, icon);
}

function renderVolumeAll() {
  for (const inst of INSTANCES.values()) {
    if (inst.active && isVolume(inst)) renderVolumeInstance(inst);
  }
}

function onVolumeReading(reading) {
  // While a write is in flight the system still reports the old value for a
  // moment. Taking it would drag the key back to where the user just left.
  if (volumeWanted) {
    const settled = reading.level === volumeWanted.level && reading.muted === volumeWanted.muted;
    // Past the deadline the system gets the last word anyway: the write may have
    // failed, or something else may have moved the volume since.
    if (!settled && Date.now() < volumeGuardUntil) return;
    volumeWanted = null;
  }

  if (volumeNow && volumeNow.level === reading.level && volumeNow.muted === reading.muted) return;
  volumeNow = reading;
  renderVolumeAll();
}

function applyVolumeSoon() {
  if (volumeApplyTimer) return;
  volumeApplyTimer = setTimeout(async () => {
    volumeApplyTimer = null;
    const target = volumeWanted;
    if (!target) return;
    try {
      await setVolume(target.level, target.muted);
    } catch (e) {
      log('set volume failed', e?.message);
    }
  }, VOLUME_APPLY_MS);
}

// Draw the new value immediately and tell the system afterwards: a round trip
// through osascript is ~200ms, which is long enough to feel like the key is
// lagging behind the dial.
function adjustVolume(delta) {
  const base = volumeWanted || volumeNow || { level: 0, muted: false };
  const level = clampLevel(base.level + delta);
  // Turning it up on a muted Mac is a request to hear something — the same thing
  // the keyboard keys do.
  volumeWanted = { level, muted: delta > 0 ? false : base.muted && level > 0 };
  volumeGuardUntil = Date.now() + VOLUME_GUARD_MS;
  volumeNow = { ...volumeWanted };
  renderVolumeAll();
  applyVolumeSoon();
}

async function toggleMute() {
  const base = volumeWanted || volumeNow;
  if (!base) return;
  const muted = !base.muted;
  volumeWanted = { level: base.level, muted };
  volumeGuardUntil = Date.now() + VOLUME_GUARD_MS;
  volumeNow = { ...volumeWanted };
  renderVolumeAll();
  try {
    await setMuted(muted);
  } catch (e) {
    log('mute failed', e?.message);
  }
}

function volumeAction(inst, action) {
  const step = Number(settingsOf(inst).step) || 5;
  if (action === 'mute') return toggleMute();
  if (action === 'up') return adjustVolume(step);
  if (action === 'down') return adjustVolume(-step);
}

function anyVolumeKey() {
  for (const inst of INSTANCES.values()) {
    if (inst.active && isVolume(inst)) return true;
  }
  return false;
}

function syncVolume() {
  const wanted = anyVolumeKey();
  if (wanted === volumeWatching) return;
  volumeWatching = wanted;
  if (wanted) {
    log('watching system volume');
    startVolumeWatch(onVolumeReading);
    return;
  }
  stopVolumeWatch();
  volumeNow = null;
  volumeWanted = null;
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
    const action = actionOf(context);
    inst = {
      context,
      action,
      settings: settings && Object.keys(settings).length ? settings : defaultSettings(action),
      active: true,
      lastIcon: null,
    };
    INSTANCES.set(context, inst);
    renderForInstance(inst);
    syncPolling();
    syncVolume();
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

  if (isVolume(inst)) {
    await volumeAction(inst, s.clickAction);
    return;
  }

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

// A dial spins far faster than osascript can be started, so every tick only
// moves the local target and repaints — the write itself is coalesced.
$UD.onDialRotate((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  if (!isVolume(inst)) return;
  const step = Number(settingsOf(inst).step) || 5;
  const left = msg.rotateEvent === 'left' || msg.rotateEvent === 'hold-left';
  // The deck reports how many detents the dial moved when it batches them.
  const ticks = Math.max(1, Math.abs(Number(msg.ticks ?? msg.param?.ticks) || 1));
  adjustVolume((left ? -step : step) * ticks);
});

$UD.onDialDown((msg) => {
  const inst = ensureInstance(msg.context, msg.param || {});
  if (isVolume(inst)) toggleMute();
});

$UD.onSetActive((msg) => {
  const inst = INSTANCES.get(msg.context);
  if (!inst) return;
  inst.active = !!msg.active;
  // A key that comes back needs the current picture, not the one it went away
  // with, so the dedupe has to forget what it last sent.
  inst.lastIcon = null;
  if (inst.active) renderForInstance(inst);
  syncPolling();
  syncVolume();
});

$UD.onClear((msg) => {
  if (!msg.param) return;
  for (const item of msg.param) {
    if (INSTANCES.delete(item.context)) log('clear', item.context);
  }
  syncPolling();
  syncVolume();
});

$UD.onError((err) => log('socket error', err));
$UD.onClose(() => log('socket closed'));
