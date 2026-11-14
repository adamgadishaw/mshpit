# iOS menu and Feed continuity candidate

Based on the clean installed-source lineage `83ed455` / `cc04472`. This work does not include the held notification reliability rollout.

## Changes

- Side menu uses Community, Explore, Account, Settings in that order. Fan clubs is grouped with messages/activity; discovery routes and clips are under Explore; profile management, personal calendar, authorized staff tools and sign-out are under Account; settings, feedback and help are under Settings. Existing route callbacks and role permissions are reused. Missing callbacks and empty groups are not rendered.
- Messages and Notifications are visible in the fixed Feed header above the content. Both use existing navigation callbacks and counts. Counts are sanitized, badges cap visually at 99+, and accessibility labels retain the actual supplied value. These controls neither fetch notification summaries nor mark notifications read.
- Already visited Feed filters remain mounted within the existing Feed owner, bounded to Following, Local, For You and News. A return swipe/tap preserves the exact list instance and its expanded history/pagination. Unvisited filters still mount only on selection or deliberate swipe intent. Canceled, never-visited previews are removed.
- Parked panes retain native layout but are invisible, noninteractive and hidden from accessibility. Only the selected pane or intended swipe preview may read. Existing per-pane presentation and privacy gates stop hidden media, callbacks, timers and reads; account/auth owner replacement discards retained panes. Privacy-scope changes revoke hidden News data before reuse.

## Verification

The final focused matrix passed **259/259 tests** with zero failures, skips or cancellations using Node 24 and the repository's hermetic test runner, serially across these ten files:

- `src/domain/iosMenuSections.test.mjs`
- `src/domain/menuJourney.test.mjs`
- `src/components/iosDrawerFocus.test.mjs`
- `src/components/iosShell.test.mjs`
- `src/screens/feedIOSAccessibility.test.mjs`
- `src/screens/retainedFeedLifecycleIOS.test.mjs`
- `src/components/NativeSwipeRail.ios.test.mjs`
- `src/domain/primaryTabLazyLoading.test.mjs`
- `src/screens/feedReturnIOS.test.mjs`
- `src/components/retainedDetailStackIOS.test.mjs`

Coverage includes real React Feed/pager composition, role-filtered menu destinations, dismissal/focus ownership, count labels, large-text style behavior, current and stale header controls, inherited previews, cover/Back, Suspense, background/account changes, returning swipes, cancellation/reversal/resize, bounded filter retention, Following/News pagination and hidden privacy invalidation. Whitespace checks pass. The test renderer now handles host-child moves without duplicating nodes.

Menu `bd6c49d` and header `4857bc0` were independently reviewed and their focused tests rerun by the integration worker. The retention delta awaits its separate independent review and combined final gates.

## Limits and unchanged surfaces

All runtime entry points changed are iOS variants; the new menu model is imported only by the iOS drawer. Shared App, shared menu model, Android/web components, server/API, dependencies, native projects and provisioning are unchanged. No push, backend deployment, install or phone interaction was performed.

These tests establish logical continuity and retained native-host identity, not physical-device scroll fidelity, frame rate, VoiceOver behavior or actual large-text layout. Full suite, syntax/architecture, platform exports, byte isolation and native build are owned by the combined integration task. Existing legacy notification count/read limitations remain; this is not a notification backend repair.
