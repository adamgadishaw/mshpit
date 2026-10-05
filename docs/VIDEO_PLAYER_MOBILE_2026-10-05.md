# Mobile video controls and rotation — 2026-10-05

Review branch: `codex/video-player-mobile-20261005`.
Base: released `a056e64d13ab6185f4b91965060fc492fb110326`.
This patch is independent of PR33 (event identity) and PR34 (conversion queue
bound). It changes no server code, upload/conversion limits, permissions, audio
configuration, credentials or production data. No migration is needed.

## Report and cause

The owner's portrait/landscape Safari screenshots, inspected by the parent
task, show native playback controls overlapping the MSHPIT PLAYER brand and
custom speed button. In landscape, a portrait clip occupies a small central
area while the gallery header/footer take scarce vertical room.

Code confirms that the old viewer sized the entire video element to the clip's
aspect ratio. That squeezed Safari's native control surface as well as the
picture. The custom brand and speed control remained over that same surface.
Global CSS also hid native center controls regardless of whether native
controls owned playback. RN Web Modal additionally closes on document Escape
keyup, which can arrive after fullscreen has exited.

## Change

- `MshpitVideoPlayer.jsx`: one explicit Play video launcher before playback;
  native controls own playback after it starts. Remove the overlaid brand/speed
  toolbar. Playback speed is now available only where the platform provides it.
  Preserve inline playback, fullscreen, poster/first-frame readiness, rejected
  play recovery, error retry, background pause and measurement cleanup.
- `PhotoViewer.jsx`: keep the element bounded by the stage with `contain`,
  independently of clip dimensions. Remove obsolete dimension synchronization.
  Use side rails for video in viewports at least 600px wide, wider than tall,
  and at most 600px tall. Other galleries retain header/footer rows. The modal
  portal owns `100dvh` and all four safe-area insets. Rotation retains the player
  key. Native/fullscreen Escape and Tab retain their input ownership; consume
  the same Escape keyup before RN Web can dismiss the gallery.
- `mediaViewer.mjs`: bounded viewport decision and standard/Safari fullscreen
  detection replace element sizing by decoded dimensions.
- `webInputFix.js`: hide native start overlays only on videos without native
  controls. The existing custom Clips screen still uses `nativeControls=false`.
- Domain/component/guest-action tests cover control handoff, rejected start,
  pause/error/retry, rotation without changing clip identity, safe-area styles,
  close/back callbacks, photo attribution, fullscreen Escape keyup and cleanup.
- `verify-player-browser.mjs`: four prepared isolated fixture cases (portrait
  and landscape encoded clips, mobile and desktop). Mobile cases rotate out and
  back; all cases check inline/fullscreen return, control ownership, retry,
  background pause, shutdown and no external requests.

Portrait footage necessarily has empty space on its sides in landscape. The
picture remains uncropped; the patch recovers height previously used by gallery
rows and avoids squeezing the native controls into the portrait picture width.

## Validation and remaining gate

- Exact Expo SDK 57 and expo-video documentation read before editing; installed
  Expo VideoView and RN Web Modal implementations inspected.
- 62 focused tests passed across mediaViewer, MshpitVideoPlayer,
  videoPlayerLifecycle, startVideoPlayback, guestPostMediaActions,
  postMediaDisplay, venuePhotoWidgetUi and webInputFocus.
- Architecture check, syntax check (823 Node files), and `git diff --check`
  passed.
- No local Chromium, heavy build, production upload or load test was run.
- The four updated browser cases have been prepared, **not executed**. Cloud
  full checks/export/browser execution must pass on the final branch head.
- Physical iOS Safari still needs portrait/landscape rotation with browser
  chrome expanded/collapsed, notch/home-indicator clearance, tall/short clips,
  first play/pause/seek, inline/fullscreen return, Close and browser Back checks.
  The unit tests validate wiring and layout rules, not actual Safari rendering.
- No merge or deployment has occurred.
