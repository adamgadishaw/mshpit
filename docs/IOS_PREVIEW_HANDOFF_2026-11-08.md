# MSHPIT iOS preview handoff, November 8, 2026

## What is ready

The iOS redesign and reliability work is compiled into a preserved local phone
preview. It has **not** been installed on the phone, pushed, deployed to the
website, or submitted to TestFlight/the App Store. Installation remains held
until Adam explicitly reconnects the phone.

The visible redesign covers Discover, Feed and its closable side menu, public
profiles and the personal You area. Discover uses image-led browsing and useful
show/artist sections; Feed gives posts priority over recommendations. Profiles
keep the member's identity while making actions and personal content clearer.
The iOS-specific navigation includes gesture shortcuts with explicit accessible
buttons, not a competing full-screen gesture over every carousel or video.

The follow-through is more than a visual reskin:
- Search, Discover and cached For You/Local Feed preserve bounded navigation
  context through detail excursions. Feed restoration uses current measured
  anchors and stops when the user starts a new gesture or the context changes.
- Comment and chat drafts have bounded in-memory navigation continuity, with
  single-flight admission and the existing delivery/retry identities preserved.
  This is not recovery after app termination or a new persistent message archive.
- Editors and reports protect unsent work and reject stale or duplicate controls.
- Reviewed failed-read paths now have useful retry states instead of falsely
  claiming a collection is empty. Known cancelled/postponed show restrictions survive transient refresh
  failures without inventing a ticket or attendance option.
- Larger text, readable ratings, keyboard access and named controls were improved.
  New action announcements are tied to the current user action and accessibility
  preferences.
- Platform-resolved entries and regression checks keep this redesign scoped to
  iOS. Android/web retain their existing presentation paths. Shared domain and
  backend code still exists; these are not three wholly independent systems.

## Exact preview to use

- Runtime source: `b73d54a0dc9a79398958eb69b9f778a7da6e54e5`.
- Artifact: `.tmp/ios-phone-checkpoints/flagship-b73d54a/MshpitDev.app`.
- Receipt and per-file manifest are beside the app. All 52 files/links were
  checked against that manifest, with valid signature and matching receipts.
- Development-signed **Release configuration**, using the existing identity and
  provisioning profile. This is not an App Store distribution archive.
- Bundle: `com.mshpit.app.dev`, version 1.0.0, build 1, arm64, iOS 16.4 or newer.
- Supported device/orientations: iPhone; portrait and upside-down. No claim of
  iPad or landscape support is made from this artifact.
- Provisioning expires November 14, 2026 at 23:50:01 UTC (18:50 Toronto).
  No account, certificate, profile or security setting was changed or renewed.
- Backend: `https://www.mshpit.com`. The separate preview identifier is **not**
  a separate staging backend.
- Photos purpose text accurately names MSHPIT and photo/video selection. No
  camera/microphone permission, background mode or broader access was added.

The receipt records JS SHA-256
`8fb2772d63b21975992e33dda909d4e0976bac1b63c92a92c8244e7b304fcbca`
and executable SHA-256
`ed27406b087bc50774b9706d30123588aecd9c230514c4960ab2e9dd7d9429a2`.

## Verified now, and what that evidence means

The compiled runtime passed 8,356 tests, syntax/architecture checks, all three
platform exports and signed Release compilation. Independent source review and
actual-React fixtures cover failure recovery, account/presentation boundaries,
queued gestures, speech ownership and unsent-work preservation. A combined
seven-owner test checks shared accessibility subscriptions and independent
retirement in normal and StrictMode lifecycles. Deliberately broken variants are
detected, not merely green happy paths.

Android and web export maps exclude application `.ios` implementations and the
four confined iOS draft/Feed-return/Search-announcement/session-status domains. Reviewed inert
defaults are verified where retained. Web initial JavaScript is 522,193 gzip bytes,
2,095 bytes below the existing 512 KiB budget. Source maps and budget checks are
not proof of native behavior, smoothness, or complete platform equivalence.

The offline export checker is tooling only; see
[the gate usage](IOS_EXPORT_ISOLATION_GATE.md). This checkpoint adds iOS session
validation status and explicit recovery to the existing identity owner. Cold or
strict validation failures explain that sign-in could not be confirmed instead
of remaining a generic spinner. Retry is single-flight, may replace client
backoff, and does not bypass a server Retry-After deadline or reveal private
screens before identity is authoritative. Confirmed-session transient refreshes
stay quiet. The earlier Feed Undo/Retry 44-point correction is retained.

All 8,356 tests, syntax on 923 Node files, architecture, exports and signed build
pass. Twenty-four synthetic automatic-validation traces match the prior owner
across iOS/Android/web. The default platforms retain the original loading
presentation; the export gate passes with zero issues: one Android map / 2,200
sources and 81 web maps / 1,171 sources. Bundles are not claimed byte-identical:
the new default wrappers and instrumentation are included, with their inert
contracts verified in the maps. Native fitting and hit testing remain unverified.

The first 14 preserved flagship checkpoints passed a read-only file-integrity and
signature audit. No artifact was overwritten. The oldest 0fcb4fd receipt hashes
sorted compact manifest JSON; later receipts hash the physical manifest file.
Both conventions were verified rather than rewriting historical receipts.
The dated audit is `.tmp/ios-phone-checkpoints/checkpoint-integrity-review.json`.
The later b73d54a artifact was preserved and verified against all
52 manifest entries, valid signature and matching JS/executable receipts.

## Next phone session

After explicit reconnection, first verify the selected phone and this exact
artifact/profile, then install over the existing preview without deleting its
container. Verify installation and actual launch separately. A successful build
or install receipt does not establish that every screen works on the phone.
If a required permission or authentication prompt appears, handle that exact
prompt under the existing approval policy; do not change signing identities or
request broader access as a shortcut.

For an owner-driven or explicitly approved genuine-use session, prioritize
Discover, Feed, drawer, public Profile and You, followed by unsent draft/keyboard
navigation, largest Dynamic Type,
VoiceOver focus and Reduce Motion. Preserve input selection and cursor, reachable
controls, correct back/close behavior and current Feed position. Test failed
session validation and Retry only in an authorized isolated fixture. Final physical
checks have not been completed while the Mac session is locked.

This live-linked build is **not mutation-blocked**. Ordinary use may send consented
analytics; opening Activity or a message Thread may persist read state. Do not
use it for synthetic comments, messages, reviews, reports, follows, attendance,
account deletion, or exports to another app merely to test a feature. Those
repeatable acceptance cases need an authorized isolated fixture, or separately
approved genuine user actions. Do not change consent to force testing.

## Remaining release gates

1. Physical VoiceOver, live Dynamic Type, keyboard layout, native gesture
   arbitration, scroll positioning and native image/video recovery. Synthetic
   React/native mocks do not replace these checks.
2. Controlled Release-device startup, frame/hitch, memory and energy comparisons
   using Instruments and recorded conditions. No measured speed or flagship
   smoothness claim is made. Keep iOS Developer Mode/security settings unchanged.
3. An explicitly designed isolated backend/app variant before destructive or
   publication QA. The current local preview and EAS internal profile do not
   create staging by themselves.
4. App Store/TestFlight signing, privacy declarations, moderation/account deletion
   acceptance and current submission requirements in a separate approved release.
5. The native decoder dependency advisory remains open at the package level.
   The reviewed path-specific mitigation is not a blanket security clearance;
   do not replace a Pod or change its ABI without a separately verified plan.

Feed restoration is bounded to cached eligible rows (up to 64), not a promise of
restoring unavailable Following/News deep pages. It adds no explicit restore query
or automatic pagination, but existing row/media/analytics effects can still run.
Queued speech cannot be recalled after native handoff. Calendar share completion
is not proof that another app imported an event. These limits are intentional and
remain in the detailed [quality gates](IOS_RELEASE_QUALITY_GATES_2026-11-08.md)
and [hardening record](IOS_FLAGSHIP_HARDENING_2026-11-08.md).

The concrete [test-before-release workflow](IOS_TEST_BEFORE_RELEASE_2026-11-08.md)
separates today's local fixtures/live preview from the isolated native testing
variant and distribution work that still needs implementation and approval.
