# MSHPIT: test locally before releasing

This is the next-stage workflow, not a claim that staging or TestFlight is set
up. No service, signing, account, permission or production change is performed.
The current signed preview and installation hold are described in
[the preview handoff](IOS_PREVIEW_HANDOFF_2026-11-08.md).

## Current environments are different tools

- **Synthetic local development:** existing loopback backend plus Metro and an
  appropriately configured simulator development app. Invented data only.
- **Owner's standalone preview:** 2f24923, Mshpit Dev/com.mshpit.app.dev,
  development-signed Release, version 1.0.0/build 1. It uses live MSHPIT data.
- **EAS preview:** internal distribution configuration, not automatically a
  separate app identity, staging backend, TestFlight build or read-only mode.
- **Production:** a separately approved release. Shared core/API code still
  serves multiple platforms; iOS-specific views do not isolate a backend outage.

## 1. Test synthetic journeys locally

For an authorized development session using Node 24, the existing commands are
`npm run mobile:backend` for disposable data or
`npm run mobile:backend:persistent` for retained synthetic test accounts, then
`npm run mobile:start` for Metro. These commands do not build/install an iOS
client by themselves. Stop an identified existing backend before starting
another on port 3000; do not kill an unknown process.

The preload strips inherited service credentials, blocks outbound connections,
rejects redirected storage and binds only to 127.0.0.1:3000. Use invented
accounts, passwords, posts and media, never copied private production data.

Cover loading, confirmed empty, delayed/failed reads, explicit retry, repeated
taps, account changes, detail/Back, keyboard and authored drafts. Use disposable
records for Send, Report, Block, attendance, read markers and deletion checks.
Run the applicable suite, syntax/architecture gates and all three platform
exports. Run [offline export isolation](IOS_EXPORT_ISOLATION_GATE.md) against
final Android/web artifacts from the same runtime source, preserving the web
budget. These are source/build checks, not native-device certification.

## 2. Implement an isolated native test variant before physical mutation QA

This is the meaningful remaining environment gap. A physical iPhone's localhost
is the phone, not the Mac. Do not expose the loopback server on the LAN or weaken
production API pinning as a shortcut.

A standalone test variant needs:
- A distinct app identity and unmistakable test-environment indicator.
- A deliberately selected reachable test backend with isolated accounts,
  database, media and sessions. External integrations must be disabled or isolated.
- Approved infrastructure/access/signing setup and any resulting service cost.
- Fail-closed routing: an invalid or unavailable test origin must not silently
  become the production origin. Production credentials must not enter testing.
- Regression proof that ordinary production Release still pins the canonical
  first-party API and Android/web behavior is unchanged.

`EXPO_PUBLIC_API_URL`, a development name or an EAS profile label is not sufficient.
Backend provisioning, credentials/persistent access, signing and costs require
separate approvals where applicable. This workflow document does not implement that setup.

Once an authorized isolated build exists, use it for physical VoiceOver, largest
text, keyboard, gesture, Photos/share cancellation, offline and mutation checks.
Measure Release startup, scrolling, memory and energy under recorded conditions.

## 3. Keep the live owner preview separate

Wait for explicit phone reconnection and verify the exact artifact before the
previously authorized installation/launch. Preserve the existing container; do
not uninstall as a shortcut. For an owner-driven or explicitly approved genuine
session, collect feedback on the redesigned screens and unsent drafts.

This preview is not mutation-blocked: consented analytics may write live events,
and Activity/message threads may change read state. Synthetic sends, reports,
follows, attendance, deletion and external saves belong in the isolated fixture,
not in a production QA tour. Native Release deliberately uses the live first-
party origin even if a public environment variable names a different host.

## 4. Identify each delivered build and its recovery path

Record runtime commit separately from later tooling/docs; actual bundle ID,
environment, version/build; JS/executable hashes; signature/profile expiry;
manifest; tests and completed native checks. Inspect the finished artifact.
The current local Info.plist embeds build 1, so a directory called build2 or a
command-line version setting is not evidence of a changed number. EAS production
remote autoIncrement does not establish local Xcode preview numbering.

The current signed Expo.plist has EXUpdatesEnabled=false: there is no OTA update
or OTA rollback mechanism in this artifact. Preserve older signed artifacts,
but do not promise installation after profile expiry, compatibility after a
local-data migration, or reversal of server writes. A client rollback cannot
undo a backend migration, published message or attendance change.

## 5. Approve distribution independently

After isolated acceptance and owner review, approve the exact TestFlight build,
upload and tester audience. Verify current Apple upload requirements, distribution
signing, app record, unique build identity, privacy answers, export compliance,
reviewer access and unresolved release blockers. Test the actual uploaded build
against its explicitly chosen environment. TestFlight alone does not isolate data.
Approve the exact production version and release timing separately.

The packaged required-reason manifests are not an App Store data-collection label.
Their empty collected-data arrays do not establish that the app's accounts,
content and consented analytics collect no information. Review actual first-party
and SDK behavior before submitting privacy disclosures.

Recheck current Apple requirements at submission time. No fresh Apple account
or membership verification, agreement acceptance or release submission is claimed.

References: app.config.js, eas.json, src/domain/apiOrigin.mjs,
scripts/mobile-dev.mjs, scripts/mobile-smoke-preload.mjs,
[local connectivity](LOCAL_MOBILE_CONNECTIVITY.md),
[quality gates](IOS_RELEASE_QUALITY_GATES_2026-11-08.md),
[Expo variants](https://docs.expo.dev/build-reference/variants/),
[Apple upcoming requirements](https://developer.apple.com/news/upcoming-requirements/),
and [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).
