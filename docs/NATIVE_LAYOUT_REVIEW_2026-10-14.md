# Native layout review — 2026-10-14

Implemented on the isolated `D:\Development\Apps\mshpit` branch after `28fdc40`. Ready for owner review; further speed work is paused until the owner reviews and directs us to proceed.

## Review changes

- Reused the existing two-ring mshpit community mark; added a compact wordmark/sign-in header.
- Native theme uses clean white/neutral surfaces, dark system typography, restrained lime selected indicators and the posting action. The same existing theme entry has a native implementation; web theme source is unchanged.
- Native Discover starts on Artists, preserving explicit directory destinations and the existing remembered section/Back behavior. Real artists appear as compact separated rows, with actual photos when available and neutral initials when missing.
- Removed native metric tiles, rank badges, nested artist cards, ornamental hero styling, live/current badges and duplicate empty genre content. Native section navigation is a horizontal text tab strip with a selected underline and 48-point touch height.
- Shared native bottom navigation is aligned, with a 44-point posting target above the Android system bar. Guest actions retain their login boundary.
- Shows remains available with its honest empty event state and working Browse artists recovery. Quick actions become simple rows; empty lounge panels are suppressed on native.
- Search shares the native palette and app header. Authenticated feed content and broader detail-page layout were not redesigned or fabricated.

## Verification

158 affected discovery, accessibility, guest-access and navigation tests passed. A final focused rerun passed 14 tests. Android production Hermes JavaScript export and web export both succeeded (`.tmp/validation/layout-export.log`, `layout-web-export.log`). No new native dependency or APK rebuild.

Actual emulator checks: default public Artists; real Drake/Coldplay catalog rows; artist no-results and Clear search recovery; real Drake detail and Android Back restoring Artists; Search and repeated Discover navigation; Shows empty state and Browse artists; header sign-in and guest posting gate rendering the login form; Back from login restoring Artists; scrolling. No credentials were entered and no post was created. Evidence XML files are `.tmp/validation/layout-*.xml`.

A Windows Metro persistent-cache read hit `EMFILE` during lazy screen loading, followed by a development LogBox failure. The local Windows session now skips the persistent transform cache only when `MSHPIT_LOCAL_DEV=1`; its in-memory running graph still reuses modules. Native app was restarted and posting/login/Back checked successfully afterward. Cold development compilation remains slow (observed tens of seconds); this is recorded for the speed phase, not presented as a layout performance gain. The baseline Expo SafeAreaView deprecation is still present.

Native screenshots inspected: `.tmp/deliverables/mshpit-layout-before.png`, `mshpit-layout-after.png`, `mshpit-layout-shows.png`. Before Library image can reuse `libfile_8b3098bd8a4481918f2af9289006160c`; revised Artists image is `libfile_640ab186a7648191ad80cc661cb65f85`. The Expo Tools overlay was hidden through its existing local development-menu toggle so it no longer covers Sign in.

## Handoff

Emulator qemu PID16676 and safe localhost backend PID23296 preserved. Metro restarted to resolve the development cache failures: current Node PID15108, wrapper19832; localhost8081, log `.tmp/validation/metro-review-final.log`. Backend remains localhost3000; log `.tmp/validation/backend-detached.log`. No push, deployment, paid service, account creation, credentials or security-setting changes.

Keep the running app for review. The existing launch commands are unchanged: dot-source `D:\Development\Tools\Use-Android.ps1`, use the app directory, `npm run mobile:backend` and `npm run mobile:start -- --port 8081 --max-workers 2` in separate terminals when services are stopped; retain adb reverse for localhost ports3000 and8081.

Remaining limits: authenticated feed/posts, iPhone/iOS, large text and screen-reader sessions were not exercised. Detail pages retain their existing structure with the coherent native palette. Local provider ingestion remains blocked, so empty upcoming events describe this isolated dataset. Changes to native theme/account-theme selection and broader visual treatment can be reviewed in a subsequent pass. Do not start the requested speed phase before owner review.
