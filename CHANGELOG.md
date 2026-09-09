# Changelog

All notable changes to this plugin. Versions follow the `Version` field in
`com.narlei.nowplaying.ulanziPlugin/manifest.json`, and the release workflow
publishes the section matching that version as the GitHub Release body.

## [1.2.0] - 2026-09-09

### Added

- **Progress** action: the current track's progress drawn as a ring, with the
  elapsed time in the middle and the track length underneath. Green while
  playing, grey while paused, and `h:mm:ss` once a track runs past an hour.
- **Seek from a dial** (`Encoder`): turning it jumps forward or back through the
  track. The ring and the clock move with your hand and the player catches up —
  a burst of detents is coalesced into one `set player position`, and the `+30s`
  badge counts the whole burst rather than the last detent.
- Settings for the position key: player, seek step (5 / 10 / 15 / 30s / 1min),
  click and dial-press action (including **Back to the start**), and whether the
  album cover sits dimmed behind the ring.
- Pressing a dial now runs whatever the key's click action is, on every action
  that has one. (The volume dial still mutes on press, as it always has.)

### Changed

- The volume action is now called **Volume** rather than **System Volume**. The
  key's caption in Ulanzi Studio is the action's name, and it had ten characters
  of room — "System Volume" arrived as "System Vol". Nothing a plugin can set:
  the caption lives in the profile as a per-key `Name` with `LinkedTitle`, and
  the SDK has no title event at all.
- Every position on screen — the ring, the progress bar and the elapsed/duration
  row — is now advanced from its reading's own timestamp instead of being shown
  raw. A poll that took most of a second to come back was describing a track
  that had already moved on, and during a marquee the same reading was redrawn a
  dozen times at the same stale position.

### Notes

- **Upgrading:** a Volume key you already placed keeps the caption it was given
  when you placed it. Remove and re-add the key to pick up the shorter name.
- Seeking is a write to the same `player position` both Spotify and Apple Music
  expose for reading, in whole seconds — Spotify takes a real happily, but
  Music's property is an integer in some versions.

## [1.1.0] - 2026-08-26

### Added

- **System Volume** action: a second button that shows the Mac's output volume.
  The whole key fills up as the volume rises — green, amber above 75%, red above
  95%, and greyed out with a crossed speaker when muted.
- The volume key follows the system rather than only its own clicks: the
  keyboard volume keys, another app, anything at all shows up on the key within
  about a tenth of a second. macOS ramps volume changes, so the fill slides
  rather than snapping.
- Settings for the volume key: click action (mute / up / down / nothing), step
  size (2 / 5 / 10 / 15%), and whether to show the percentage.
- Dial support (`Encoder`) on the volume action: turn to adjust, press to mute.

### Changed

- The Property Inspector script is now shared by both actions. Fields and their
  defaults are read from the form itself — a `selected` option is the default —
  so a new action needs markup, not a script of its own.
- SVG primitives and text measuring moved to `plugin/svg.js`, shared by the
  track and volume renderers.

### Notes

A cold `osascript` costs about 180ms to start, so polling it fast enough to
watch the level move would spend more time forking than reading. Instead one
`osascript` is started once and loops inside AppleScript, printing each reading
with `log` — which writes to stderr immediately, unlike `return`, which only
fires when a script ends. One process, ten readings a second, 0.3% CPU. Frames
are only sent when the reading actually changes.

Dial ticks arrive far faster than `set volume` can run, so the key is drawn at
the new level immediately and the write is coalesced. Without that the bar would
jump backwards between ticks, each late write reporting the level it had been
asked for a moment earlier.

## [1.0.2] - 2026-07-23

### Fixed

- The release zip shipped without `ws`. The workflow zipped the bare checkout,
  where `node_modules/` is gitignored, and the plugin host runs `node app.js`
  with no install step — so the process died on its first import and never
  connected. Production deps are now installed before zipping, and the build
  fails if `ws` is missing so a broken package can't ship silently again.

## [1.0.1] - 2026-07-23

### Fixed

- The scrolling title sat still and then jumped several seconds' worth at a time
  instead of scrolling, from four separate causes:
  - **No backpressure**, the main one. A track frame is tens of KB of base64 and
    the deck has to decode, rasterize and push it to the key over USB before it
    can take the next; `ws` queues whatever it is handed, so offering frames
    faster than the socket drained built an unbounded backlog. Frames are now
    skipped while the previous one is still unflushed, and the offset comes from
    the wall clock rather than a frame counter, so the marquee settles at
    whatever rate the deck can actually sustain.
  - The vendored lib logged every `send()` payload — the whole base64 icon — to
    stdout, a synchronous ~30KB pipe write per frame that stalled the event
    loop. It now logs the command, not the bytes.
  - The scroll cycle spent more time parked than moving. Replaced with a one-way
    scroll that wraps, drawing a second copy of the text a gap behind the first
    so the wrap is invisible.
  - A paused track was still drawn from the clock but sampled on the 3s idle
    tick — dead still, then a 3s jump. Paused is now pinned to the start of the
    cycle.

### Changed

- Cover JPEG quality 70 → 45 at unchanged resolution, halving the frame, and
  only the keys that are actually scrolling get repainted.

## [1.0.0] - 2026-07-22

### Added

- First release. Shows the currently playing Spotify / Apple Music track on a
  deck key: album cover, title, artist and a live progress bar. Click to
  play/pause or skip.
- AppleScript reads both players without ever launching them.
- Artwork fetched from Spotify's URL or extracted from Apple Music's raw track
  bytes, downscaled with `sips` and cached per track.
- Polling is shared across keys watching the same player.
- Store art generated from the real button renderer.

[1.1.0]: https://github.com/narlei/ulanzideck_now_playing/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/narlei/ulanzideck_now_playing/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/narlei/ulanzideck_now_playing/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/narlei/ulanzideck_now_playing/releases/tag/v1.0.0
