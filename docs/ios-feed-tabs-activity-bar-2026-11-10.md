# Feed tabs in the disappearing activity bar

Following, Local, For You, and News are restored on iOS inside the existing animated activity bar, below its compact Messages/Notifications controls. Both rows share one measured wrapper and one animation. They hide together on deliberate downward scrolling and return on meaningful upward scrolling. Existing hysteresis, primary-scroll ownership, stable list inset, VoiceOver visibility, and Reduce Motion behavior are unchanged.

The tabs use the same account-scoped selection as the side menu and retained Feed panes. Switching filters keeps each visited list and its pagination state. Tab presses are guarded against hidden chrome, covered routes, and retired account callbacks. Large text wraps tabs into two columns; all targets remain at least 44 points. Main navigation and post/detail gestures remain unchanged.

Only App.js and NativeAppHeader.ios.jsx change runtime behavior. Earlier upload, profile, badge, notification, and session fixes remain intact. The backend rollout is separate.

## Verification

- Read the exact Expo SDK 57 reference before editing.
- First focused selection, retained Feed, shell, chrome, and hysteresis run: 71/71 passed.
- Additional swipe, retained Back, Feed accessibility, and endless pagination run: 166/166 passed.
- Independent review reran the final chrome tests plus root Feed return fixture: 47/47 passed, including the corrected nonselected stale-account test. Eleven tests overlap the first run; 273 distinct tests across these three runs.
- Independent reviewer additionally checked 80 selection/retention/accessibility/pagination/hysteresis tests, all passing.
- Production iOS Hermes export passed. Source-map and final signed artifact receipts are stored under `.tmp/native-feed-tabs/evidence`.

The React/native lifecycle fixtures use synthetic geometry and scheduling. No phone, simulator, or actual UIKit gesture verification occurred for this change. A JavaScript-only QA repack reuses the unchanged native runtime; it is not a fresh native compile. Preparing this candidate does not install it.
