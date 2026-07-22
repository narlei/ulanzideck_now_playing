import UlanziApi from './plugin-common-node/index.js';
import { readNowPlaying, sendCommand, SOURCES } from './players.js';
import { getArtwork } from './artwork.js';
import { renderTrack, renderIdle, renderNotRunning, renderError } from './renderer.js';

const PLUGIN_UUID = 'com.narlei.nowplaying.plugin';
const TICK_PLAYING_MS = 1000;
const TICK_IDLE_MS = 3000;

const $UD = new UlanziApi();
const INSTANCES = new Map();
// One poll per *source setting* per tick, not one per button: three buttons all
// watching Spotify would otherwise fire three osascript calls a second.
const SNAPSHOTS = new Map();

let tickTimer = null;
let tickMs = 0;
let polling = false;

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

function renderForInstance(inst) {
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
  }));
}

function renderAll() {
  for (const inst of INSTANCES.values()) {
    if (inst.active) renderForInstance(inst);
  }
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
