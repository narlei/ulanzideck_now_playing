// Shared by every action's inspector. The fields are whatever the form
// declares, and each field's default is the option marked `selected` in the
// HTML — so a new action only needs its own markup, not its own script.
const els = Object.fromEntries(
  [...document.querySelectorAll('#property-inspector [name]')].map((el) => [el.name, el]),
);
const FIELDS = Object.keys(els);
const DEFAULTS = Object.fromEntries(FIELDS.map((f) => [f, els[f].value]));

let settings = { ...DEFAULTS };
let loaded = false;
// Fingerprint of the last save this PI made, so the deck echoing it back through
// didReceiveSettings doesn't reset the controls the user is still touching.
let lastSent = null;

function fingerprint(obj) {
  return FIELDS.map((f) => obj[f]).join('|');
}

function renderControls() {
  for (const f of FIELDS) {
    els[f].value = settings[f] || DEFAULTS[f];
  }
}

function save() {
  if (!loaded) return;
  settings = { ...settings, ...Object.fromEntries(FIELDS.map((f) => [f, els[f].value])) };
  lastSent = fingerprint(settings);
  $UD.setSettings(settings);
}

$UD.connect();

$UD.onConnected(() => {
  $UD.getSettings();
  // Fallback for a brand-new button the deck has no saved settings for: unblock
  // saving so the first pick still persists.
  setTimeout(() => { loaded = true; }, 600);
  document.querySelector('.udpi-wrapper').classList.remove('hidden');
});

$UD.onDidReceiveSettings((msg) => {
  const p = msg && (msg.param || msg.settings);
  loaded = true;
  if (!p || !FIELDS.some((f) => f in p)) return;

  const incoming = { ...DEFAULTS, ...p };
  if (lastSent !== null && fingerprint(incoming) === lastSent) return;
  settings = incoming;
  renderControls();
});

for (const f of FIELDS) {
  els[f].addEventListener('change', save);
}

renderControls();
