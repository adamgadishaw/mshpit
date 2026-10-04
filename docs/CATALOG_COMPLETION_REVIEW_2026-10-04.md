# Catalog completion plan and durable batch review

Base: `d82b7ee47e2e524c83fd129c5a31e74e8a390cab`.
Branch: `codex/catalog-completion-review-20261004`.
Reviewed patch for a draft PR; no merge, deployment or production write.

## Behavior

- The existing administrator list/read routes accept `completion=true` for
  artists and venues. Plans inspect at most 150 candidates and return up to ten
  rows per page, in stable catalog-key order with a continuation cursor. This
  is a review batch size, not an hourly cap or a new scheduler.
- Status separates confirmed identity, protected/existing text, missing source,
  missing photo, and a raw photo needing review. Unknown artist identity never
  gains proof from popularity or a name search. Venue identity uses the existing
  exact source/provider ID and location ambiguity checks.
- Suggestions are one or two complete sentences built from matching stored
  provider facts and a named source page. Artist evidence requires the same
  MusicBrainz ID and provider identity; venue evidence requires the same exact
  provider ID, name and address. No excerpts are silently cut. Inadequate
  evidence is left as needs source for an administrator to review manually.
- Accepted photo metadata comes from the existing public photo catalogs and
  runtime venue reader. Profile overrides/raw URLs are not certified as the
  displayed accepted photo. The editor waits for an accepted image preview to
  load before staging a completion draft. This preview does not establish
  current public-page rendering; that remains a separate reviewer check.
- Existing biography, staff text, found/hidden research and intentional clears
  are preserved. A completion hash binds the exact record and current research,
  source and photo evidence through prepare/save. Normal editor/event behavior
  and the existing 2,400-character event limit remain unchanged.
- Browser localStorage and native SQLite KV hold account-specific drafts and
  receipt keys. Strict adapters fail visibly rather than falling back to memory.
  Logout cleanup includes the new namespace. No server schema was added.
- A batch may hold ten entries, with twenty recent receipt records. Entries can
  be edited or removed before dispatch. Reload requires another review; an
  interrupted dispatch instead retains its exact body/key as uncertain.
- Publication persists each dispatch before sending it and proceeds one at a
  time. Conflicts, account changes, storage failures, uncertain responses and
  failed/mismatched public text reads stop that run. An uncertain entry cannot
  be edited or removed; retry uses the same key within the existing seven-day
  receipt window. After that window, audit reconciliation is required.
- Receipt replay proves an earlier commit only. The editor separately checks
  the uncached public-text route and labels the check time. It never presents a
  historical receipt as proof that today's photo/page is complete.

## Changed files

Runtime (12):

- `server/features/catalogEditor/catalogCompletion.js` (new)
- `server/features/catalogEditor/catalogEditorRepository.js`
- `server/features/catalogEditor/catalogEditorRoutes.js`
- `server/features/catalogEditor/catalogEditorService.js`
- `src/domain/accountLocalPrivacy.mjs`
- `src/features/catalogEditor/catalogEditorApi.mjs`
- `src/features/catalogEditor/catalogBatchState.mjs` (new)
- `src/features/catalogEditor/catalogBatchStorage.js` (new)
- `src/features/catalogEditor/catalogBatchStorage.native.js` (new)
- `src/features/catalogEditor/catalogBatchStorage.web.js` (new)
- `src/lib/persist.native.js`
- `src/screens/CatalogEditorScreen.jsx`

Validation (7): catalog editor server unit and HTTP tests; catalog API tests;
new batch-state tests; real screen selection/edit tests; browser runner and its
fixture tests. Documentation (2): this file and `STATUS.md`.

No dependency/lockfile, database migration, image worker, provider quota,
credential, permission grant, public UI, Newsroom, cancellation or venue
hydration change. No PR19 files imported. Claude/console ownership was checked
before this work; no concurrent implementation was authorized in these files.

## Validation and review

- 72 focused tests passed, including the real isolated HTTP server with outbound
  network blocked. Coverage includes existing public metadata/sitemaps, admin
  authorization, ten-row pagination, evidence changes, unknown identity,
  missing photos, account isolation, durable retry after reload, storage failure,
  partial publication, historical receipts, hide intent and the real editor's
  stale-selection protections.
- Full Node syntax gate: 823 files passed. Architecture and whitespace checks
  passed after removing an unused receipt flag that resembled a command result.
- Independent read-only review found and rechecked three fixes: uncertainty
  must survive a rejected retry/post-response identity change; successful saves
  must clear the stale selected revision; editing a hide must retain its intent.
  No remaining blocking code finding was reported. The hide regression was
  added and passed in the final 72-test run.
- No local Chromium, web export or heavy build was run. The parent cloud runner
  verified all 2,143 exported source files, passed the same 72 focused tests and
  architecture check, and completed a single-worker web export at 508.5 KiB gzip
  under the unchanged 512-KiB initial bundle budget. Only these two review/status
  documents were updated after that byte-verified source export.
- Cloud browser runner includes 390px and 1280px cases for `catalog-completion`
  (accepted preview, sourced suggestions, reload, edit, sequential publication),
  `catalog-editor`, `catalog-exact-key`, and `catalog-queue`. All browser APIs use
  synthetic accounts/data and off-origin requests are blocked. These eight
  cases remain unexecuted: the cloud runner's known Chromium restriction was
  not retried. Existing `browser-regressions` CI runs the unfiltered
  `verify:catalog-maintenance-browser` command, covering all eight without any
  workflow change. Actual CI browser results remain a pre-merge gate.

## Limits and follow-up

### PR 29 browser synchronization correction

Run `37217330043`, browser job `111480391801`, passed editor/exact-key/queue at
390px, then failed the completion venue text assertion because the previous
artist's generic photo acknowledgement was still visible while the correct
venue read was pending. No client error or draft corruption was reported.
All four 1280px catalog cases were not reached. Test/build passed separately.

The narrow follow-up changes only the browser readiness helper, its unit test,
the actual editor JSX regression and these review/status documents. It waits
for the requested type/key/revision and named photo before checking the loaded
photo acknowledgement; original text assertions and timeouts remain intact.
A delayed-read regression confirms the old form is disabled during the request,
the exact venue replaces it on success, and the venue's distinct photo hash
requires its own load event even when fixture image bytes are shared. No
production runtime, permission or provider behavior changes in this follow-up.
All 18 targeted editor/browser-fixture tests passed locally and independently;
the syntax, architecture and whitespace checks passed. Independent review found
no blocking issue and confirmed that assertions and timeouts were preserved.
Updated-head browser CI remains required before merge; the failed head was not
blindly rerun.

This phase plans and reviews completion. Existing image workers own acquisition;
no new provider work is activated. Plans are not a traffic-ranked or scheduled
job queue. The editor can only suggest from sufficiently bound stored evidence.
Native storage uses the existing Expo SDK 57 SQLite KV API. The shared editor,
strict native storage adapter and durable logout namespace also affect native
administrators; this is not a web-only UI change. Native-device validation
remains pending before any native rollout, separately from web CI.
Current public-page photo accuracy/rendering needs
human review after publication. No live catalog writes were made for testing.
