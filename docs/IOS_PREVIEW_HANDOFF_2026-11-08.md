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

- Runtime source: `2f24923fe41a04cf6ea238643fb8b6e1061570c2`.
- Artifact: `.tmp/ios-phone-checkpoints/flagship-2f24923/MshpitDev.app`.
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
`a6d3de7b749258ad0ad7f5355c1fcb468183cd7d5874be71fedf8e2a459bb148`
and executable SHA-256
`8dd4da5c1f2c521c3ecbe0e9bfda167e1c9bbd7961fcdbe419b5f7af5bba9d05`.

## Verified now, and what that evidence means

The compiled runtime passed 8,324 tests, syntax/architecture checks, all three
platform exports and signed Release compilation. Independent source review and
actual-React fixtures cover failure recovery, account/presentation boundaries,
queued gestures, speech ownership and unsent-work preservation. A combined
seven-owner test checks shared accessibility subscriptions and independent
retirement in normal and StrictMode lifecycles. Deliberately broken variants are
detected, not merely green happy paths.

Android and web export maps exclude application `.ios` implementations and the
three confined iOS draft/Feed-return/Search-announcement domains. Reviewed inert
defaults are verified where retained. Web initial JavaScript is 521,916 gzip bytes,
2,372 bytes below the existing 512 KiB budget. Source maps and budget checks are
not proof of native behavior, smoothness, or complete platform equivalence.

The offline export checker is tooling only; see
[the gate usage](IOS_EXPORT_ISOLATION_GATE.md). The current checkpoint includes
the reviewed iOS Feed Undo/Retry minimum target correction from 36 to 44 points,
with unchanged callbacks and default-platform dimensions. All 8,324 tests, syntax
on 923 Node files, architecture, exports and signed build pass. Its Android
Hermes bundle is byte-identical to b907ea8, and web initial-script budget entries
are unchanged. The export gate passes with zero issues: one Android map / 2,198
sources and 81 web maps / 1,169 sources. Native hit testing is still unverified.

The first 14 preserved flagship checkpoints passed a read-only file-integrity and
signature audit. No artifact was overwritten. The oldest 0fcb4fd receipt hashes
sorted compact manifest JSON; later receipts hash the physical manifest file.
Both conventions were verified rather than rewriting historical receipts.
The dated audit is `.tmp/ios-phone-checkpoints/checkpoint-integrity-review.json`.
The later 2f24923 artifact was independently preserved and verified against all
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
controls, correct back/close behavior and current Feed position. Final physical
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
