# Recovered calendar, messaging and PC fixes — combined source

This is a local integration candidate. No production deployment, remote push,
Mac build, phone operation, uninstall or data reset was performed on this PC.

## Provenance and preservation

The full PC bundle was independently verified at 23,119,604 bytes, SHA256
`759ba38fd08ea5cfba7fc5a853a78a4aa94f6fb17895f68246e323e43d89bcaf`.
The integration repository was initialized and operated under one consistent
owner. Ownership-refused repositories and Git trust settings were left alone.

The final history retains PC `266a25de`, the full recovered Mac iOS ancestry
including combined `7260456`, keyboard `407aa2f`, calendar `c45b153`, exact
restoration checkpoint `4fa645b`, calendar correction `56e98a05`, messaging
`bbae706` and `07ce622`, native harness correction `2a8d5ff`, and iPhone build
preparation `f2fe9e9`. Shared ancestry is `b56c5808`; missing older parents were
restored only in working copies. Both original shallow preservation repositories
and the exact calendar/messaging restorations remain separate.

Calendar restoration was rechecked after implementation: all 2,914 files, five
untracked files, recorded HEAD/index/status and archive manifest still match.
The messaging owner independently verified all 2,845 original files. The archive
SHA256 is `108d1821989c2a1c0705251ce0e4562f5924a6090491e21c694b20b0e305c12d`.

## Integrated behavior

- Existing posts use current badge authority and display choices, including the
  actual iOS card, standalone post and comment paths. Revocations, account
  changes and stale responses cannot restore old badge authority.
- Page titles and active tabs return to top and refresh through the recovered
  native title/header/scroll controls. Retained hidden previews cannot register
  a page action, repeated detail entries have distinct owners, and disabled
  refresh does not expose a UIKit control.
- Activity has one notification history. Opening loads all existing history
  pages and acknowledges scoped captured unread IDs, with confirmed counts,
  visible retry on failure, account/epoch fences and preserved new arrivals.
  The extracted lazy notification architecture remains intact.
- For You, Local and Following retain eligible older pages until server
  exhaustion. Native retained panes, cursor progress/deduplication, explicit
  refresh, expired-snapshot recovery and Local's own endpoint are preserved.
- Find a Show uses the saved home-city show page. Its dismissible bottom prompt
  leads to Discover city selection; visiting another city does not overwrite
  the saved home. Same-name cities in different countries have separate prompts.
- Calendar repairs are detailed in `PC_CALENDAR_RECOVERY_2026-11-11.md`: clock
  ownership, complete loaded agenda paging, labels/localization and consistent
  retirement of stale attendance timing across typed updates and refresh.
- Messaging retains directional consent, exact keyboard layout, earlier history,
  truthful send recovery and queued account/epoch guards. A combined-source
  defect was reproduced and fixed: durable acceptance now contributes to the
  server unread total even without a follow/reply or after the final reply is
  removed. Confirmed acceptance refreshes that summary under the current owner.

## Startup and source verification

The preliminary combined web export measured 533,903 bytes gzip. Optional policy
prose, map/location data and the web venue-photo panel now load with their
features; Feed and native behavior remain eager. The measured correction is
522,801 bytes (510.55 KiB), under the unchanged 524,288-byte budget, with 1,487
bytes headroom. Source maps contain no duplicated modules. Final gate export
measurements supersede this pre-gate measurement if they differ.

The iOS source verifier now requires the recovered `.ios` implementations and
the five-feature/calendar/messaging modules, and rejects older native fallbacks
for the native header, tab rail and swipe rail. It caught an export becoming
stale after the final feed-copy correction; that artifact is retained separately
and is not final-source evidence. Discover uses its shared screen and native
section pager, not a nonexistent `DiscoverScreen.ios.jsx`.

## Validation checkpoint

The first complete integration suite finished **9,642 passed, 46 failed, 2
skipped**. Its failures were triaged rather than hidden: older extracted fixtures
needed merged dependencies, native Calendar needed explicit refresh coverage,
branding expectations needed platform separation, and a profile-focus fixture
incorrectly waited 15 ms for two frames. Deterministic frame advancement retains
repeat-entry/cancellation assertions. The feed empty label was also corrected to
avoid claiming no shows exist when privacy filtering can leave an empty feed.

The affected groups subsequently passed **57/57**, **60/60**, and **48/48**.
The full rerun and fresh final-source exports are pending at this checkpoint.
Independent bounded reviews passed 206 native feed/Activity/refresh checks and
47 messaging/count checks, with no remaining actionable findings. The combined
native harness passed 222 cases and exact Yoga passed 920 geometry cases.

Fresh synthetic large-history checks passed both distributions: single-author
2,505 eligible posts in each section (51 pages each), and mixed-author For You
2,505 / Local 1,600 / Following 1,855. Coverage, exclusions, cursor replay,
ordering, refresh isolation and exhaustion all passed. End-to-end synthetic
run times were 40.13 s and 32.37 s during parallel validation; these are temporary
SQLite measurements, not production performance claims.

Read-only production dependency audit reports zero vulnerabilities. Offline
native-input validation passes on Expo 57.0.29 / RN 0.86.3 / React 19.2.3, with
28 Expo modules, 29 podspec entries, 9 RN iOS modules and zero duplicates. Scene
lifecycle transformation remains valid. Pod resolution/linking, signing/team/
device matching, native rendering, VoiceOver and installation require the Mac
build owner. The recovered config changes photo-permission wording; dependency
versions and the scene plugin were not replaced.

## Build/update boundary

The user authorized an in-place update after availability and signing checks.
The PC owner prepares source and evidence only. The Mac owner must verify the
final transfer checksum, restore the exact commit, install dependencies for
macOS, generate the native project, resolve pods, confirm scene wiring and
team/app/device provisioning, then compile/sign and perform the authorized
in-place update. Never uninstall or reset data as part of this handoff.

The Release preview profile uses production. Development read-only flags do
not sandbox Release. No new account, credential, production or device action is
implied by these source checks. See the iPhone build handoff for commands and
requirements, with this recovered combined source superseding its old base.
