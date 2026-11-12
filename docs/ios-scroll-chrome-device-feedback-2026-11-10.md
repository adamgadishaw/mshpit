# iOS scrolling chrome after device feedback

Large page title animation has been removed. The existing title compatibility component now renders ordinary content, and Feed, Discover, and the You tab place their page headings inside their primary scrolling content. Compact detail headers keep their existing behavior.

The main topbar now includes separate Messages and Notifications symbols with unread badges. Each target is at least 44 points. Accessibility labels announce the complete unread count; visible labels cap at 99+. At large text sizes a badge dot preserves the compact layout while the accessible count remains complete.

The whole topbar overlays the page and slides out after deliberate downward movement: at least 64 points of travel and an offset of at least 80 points. It returns after 36 points of upward travel or near the top (8 points). Small direction changes do not toggle it. The content keeps a stable measured top inset, so hiding chrome does not resize the scroll viewport or induce bottom-of-list clamping. Non-scroll loading/error surfaces reserve header space and keep the header visible.

Only the current primary vertical scroll controls chrome. Preview pages, nested/horizontal/area-picker scrolling, inactive routes, background work, and retired callbacks/worklets cannot control the current header. Native offset observation preserves existing screen scroll callbacks and refs. Programmatic restoration and seeks establish direction baselines rather than pretending to be gestures. Geometry changes rebase the detector. VoiceOver keeps controls visible; Reduce Motion skips the sliding transition. Hidden controls reject queued presses and are excluded from accessibility/hit testing.

App wiring shares the account-scoped Feed selection with the drawer. Selecting a Feed filter while already on the root Feed preserves its navigation frame, native pane instances, and scroll offsets. The default platform hook is inert, and the new scroll chrome implementation is iOS-specific.

## Verification

Read the exact Expo SDK 57 reference before changes. Ran:

```sh
node --test src/components/NativeSwipeRail.ios.test.mjs \
  src/components/nativeScrollChromeIOS.test.mjs \
  src/domain/iosScrollChrome.test.mjs \
  src/components/iosShell.test.mjs \
  src/screens/feedIOSAccessibility.test.mjs
```

160 tests passed. These include the installed Expo 57 worklet compiler, native platform resolution, actual React component lifecycle fixtures, Discover preview/promotion/cancellation, retained Feed menu panes, momentum, overscroll, restoration, route retirement, foreground changes, refs/callbacks, measured insets, hidden controls, VoiceOver, and Reduce Motion. Full output: `/tmp/chrome-focused-final.log`.

These tests use synthetic native geometry and scheduling. They do not establish actual UIKit gesture or visual quality on an iPhone. No phone interaction or install was performed in this change.
