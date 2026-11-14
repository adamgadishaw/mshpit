# Windows iOS source and export review

## Source and scope

Isolated branch `codex/ios-source-reliability` starts exactly at
`ac6a8374165e27c527c3f3cb23e8ea85bb2dc49e`, a descendant of the five-feature
candidate `20975b1ead3fc1f447522dfe433d24a9fb945829` and remote reference
`6a51cb7a79605625602beb91dd7e55e26d3b1455`. The clone is
`C:\Users\Adam Gadishaw\Documents\Codex\2026-11-10\task-2\mshpit-ios`.
The original task checkout and unrelated dirty D: checkout were not edited.

The source uses Expo 57.0.29, React Native 0.86.3, React 19.2.3, custom navigation
in `App.js`, and no committed native projects or `.ios` overrides. iOS selects
shared screens and `.native` implementations. Dependencies were copied into this
isolated clone; the source and clone lockfiles have SHA256
`9c943d67602361abae77189c26888e342131fd344344f97bc26b476175fd2bc9`.
Node is 24.16.0 on Windows. The repository-required
[Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) was consulted.

Mac combined `7260456`, keyboard `407aa2f`, messaging `bbae706`, calendar
`c45b153`, and uncommitted Mac calendar work are absent. None was reconstructed
or validated. No Mac, phone, production account/service, push, merge, deployment,
OS-tool installation, or security-setting change was performed.

## Reproduced defects and fixes

1. **Native Find a Show crashed on its missing export.** Metro redirects the
   explicit `cityIdentity.js` import in App to `cityIdentity.native.js`. Only the
   shared file had the new `findShowFrame` export. The original iOS export and
   53 existing focused tests passed, but executing the selected native entry
   produced `TypeError: findShowFrame is not a function`. The native entry now
   supplies the same saved-home/directory contract. Regression checks exercise
   the actual Metro resolver for iOS and Android, compare export parity and
   ambiguous/missing/explicit homes, and remove `Intl.DisplayNames` to exercise
   the native bootstrap.
2. **City prompt dismissal leaked between same-name cities across countries.**
   Dismissal reset depended on city slug and account, omitting country. The
   executed screen fixture reproduced Canada/London -> GB/London retaining a
   dismissed prompt. `CityScreen.jsx` now includes country in the reset scope.
   The JSX checks also exercise dismiss/choose actions, loading/failure states,
   ordinary-city exclusion, the directory fallback, the bottom sibling position,
   wrapping actions and the 44-point dismiss target. These are source contracts,
   not measured UIKit layout.
3. **Disabled native refresh still advertised refresh.** The native boundary
   registered every title as refresh-capable and always installed RefreshControl.
   The installed React Native iOS implementation strips `enabled` (the public
   [RefreshControl documentation](https://reactnative.dev/docs/refreshcontrol#enabled-android)
   also labels it Android-only). Disabled/missing callbacks now omit the native
   control and register scroll-only capability. Enable changes preserve the
   pending request latch; a route change/unmount clears it. Existing rapid-tap,
   rejection/retry, scroll-ref preservation and interrupted-page checks pass.

Runtime changes are limited to `src/cityIdentity.native.js`,
`src/components/VinylRefreshBoundary.jsx`, and `src/screens/CityScreen.jsx`.
The first two affect the native path (Android shares it); the city reset also
affects web. **Integration overlap:** CityScreen is a shared screen and the
refresh boundary is shared native navigation infrastructure. `App.js`,
`src/store.js`, backend files, packages and lockfiles are unchanged.

## Windows-supported verification

Export commands used process-local `EXPO_NO_TELEMETRY=1`, `EXPO_OFFLINE=1`, and
`EXPO_PUBLIC_API_URL=http://127.0.0.1:3999`. No API server was contacted. The
export is an intentionally loopback-configured validation artifact, not a
production release artifact.

```text
node node_modules/expo/bin/cli export --platform ios --source-maps --dump-assetmap --max-workers 2 --output-dir ../evidence/ios-final
node scripts/check-ios-export.mjs ../evidence/ios-final ../evidence/ios-export-source-verification.json
node node_modules/expo/bin/cli config --type introspect --json
node node_modules/expo/bin/cli install --check
```

- Baseline and final iOS Metro/Hermes exports passed: 2,227 modules each.
  Final bytecode is 8,074,560 bytes, SHA256
  `d00e6f77a6b05d11a232c656148395f462fb0649e413a1c26df893cddfe16156`.
  The final map is 15,174,388 bytes, SHA256
  `5356f528d562fe047271e605302bcc30479e18e58c81b1346cde3d2c2df2a8d7`.
- Retained `scripts/check-ios-export.mjs` verified all 697 bundled project
  sources against this checkout (newline-normalized), including 25 `.native`
  modules. Required feed, notification, city, navigation, badge reconciliation
  and pagination sources are present; no project `.web`/`.android` module is
  selected. This does not check native linking or execute the app on iOS.
- Focused final tests: **72 passed, zero failed/skipped**. Included actual native
  refresh JSX, city JSX, selected city bootstrap, page-return controller,
  gesture/retained-feed policies, badge reconciliation, notification-ID/history
  helpers, and existing 2,505-card Local/Following hook fixtures. Backend
  large-history benchmarks were not duplicated.
- Config introspection passed, including iOS scene manifest, entitlements,
  splash and Podfile-property mods. This is not an Xcode project build.
- Offline Expo dependency comparison passed with its explicit warning that
  validation is unreliable offline. It compares the installed SDK metadata;
  it is not a fresh online Expo Doctor or latest-version assessment.
- `npm run check` completed catalog splitting and **7,137 passing tests, zero
  failed, one skipped (7,138 total)**. It stopped at npm audit because the
  restricted process could not reach the advisory endpoint. A separate
  approved read-only network audit passed with **zero production dependency
  vulnerabilities**. The original failed-command log is retained.
- Remaining gates passed separately: syntax (927 Node files), architecture,
  web export and initial bundle budget (509.7 / 512 KiB gzip), and
  `git diff --check`. Documentation checks passed 3/3 after this audit was added.
  Thus every stage of `npm run check` passed, with the failed restricted audit
  attempt explicitly retained; the original combined command did not exit zero.
  No web result is counted as native acceptance.

Evidence is outside Git under sibling `../evidence/`: baseline/final export
logs and artifacts; `native-city-before-fix.log` (2 expected failures) and
`native-city-after-fix.log` (2 passing); `city-prompt-before-fix.log` (2 passing,
1 expected failure) and `city-prompt-after-fix.log` (3 passing);
`native-refresh-before-fix.log` (5 passing, 2 expected failures) and
`native-refresh-after-fix.log` (7 passing); `ios-final-focused.log`,
`full-check.log`, `dependency-audit.log`, `syntax.log`, `architecture.log`,
`web-build.log`, `ios-config-introspect.json`, and
`ios-export-source-verification.json`. Generated bundles and config are not
committed.

## Five-feature review and remaining acceptance

| Feature | Supported evidence here | Later native acceptance |
| --- | --- | --- |
| Current badges on existing posts | iOS selects the shared Store/card/projection path; reconciliation and loaded-section badge tests pass | Observe already-visible cards after a confirmed badge change |
| Title/active-tab top-and-refresh | App active-tab scope and committed activation inspected; native boundary/controller tests cover momentum stop, one pending refresh, failures and hidden-page isolation | Tap titles/tabs during momentum, rapid taps and overlay/back transitions; verify VoiceOver labels and refresh feedback |
| One notification history and confirmed unread IDs | Shared Activity has one ScrollView/history; cursor/history and confirmed-ID tests pass | Open a long history, refresh offline, retry and inspect unread indicators on device |
| Complete For You/Local/Following traversal | iOS selects the shared FlatList and paging hooks; pagination/error and expanded 2,505-card hook checks pass | Traverse all sections with real native virtualization/media and measure scroll/memory behavior |
| Saved home and dismissible city prompt | Native selected export fixed; home/directory parity and actual JSX action/state tests pass | Open home, choose another city into Discover Cities, dismiss, revisit; inspect long names and largest Dynamic Type |

No iOS runtime claim is made. Mac/Xcode compilation, CocoaPods/native linking,
signing, launch, UIKit/Fabric rendering, touch recognition, VoiceOver, Dynamic
Type, safe areas, rotation, keyboard, lifecycle/background behavior and physical
device performance remain unrun. The existing root safe-area implementation
was inspected only; screen fixture width is not a layout engine or screenshot.
The missing Mac changes require separate recovery/integration before their
behavior can be assessed.

## Integration

Preserve this branch/patch independently. Apply its commit to a separate
integration branch based on `ac6a837`, or cherry-pick onto the completed parallel
hardening descendant after reviewing shared CityScreen/refresh-boundary hunks.
Do not copy the whole checkout over either parallel work or recovered Mac work.
Rerun the full gate, iOS export/source verification, and the device matrix after
integration. No migration or package installation is required by this patch.
Publication and native release remain separate actions.
