# Moderation, Discover, and desktop media audit — 2026-08-13

This document records the implementation and verification of the moderation
console and Discover revamp on
`codex/moderation-discover-revamp-20260813`. It is a feature-branch handoff, not
a production-deployment claim. Production remains on `c9d86eb` until this batch
is reviewed and deliberately released.

## Outcome

The moderation console is now a focused staff workspace instead of a collection
of unrelated raw lists. Reports arrive with bounded, privacy-safe server context;
staff actions use one transactional API; member controls are searchable and
progressively rendered; and loading, empty, conflict, confirmation, and failure
states are explicit.

Discover now gets its first paint from one coherent overview request, keeps
genre drill-down independent, survives request cancellation and account changes,
and remains usable at narrow phone widths. Its server service applies the same
genre-provenance policy as public artist records, so internal crawl buckets can
no longer appear as facts such as “Eminem — Hardcore” or “Rihanna — House.”

The work also found and fixed staff-data persistence and stale-response races
that were not obvious from the old interface.

## Deepening pass

The follow-up pass removed four limits that remained after the first redesign:

- Discover is now a guarded lazy screen rather than part of every visitor's
  initial JavaScript entry. The tab gesture preloads its chunk and both phone and
  desktop shells render the established safe suspense state while it arrives.
- Successful Discover overview and genre responses use small session-only LRU
  caches aligned with the server's short public cache policy. Normal re-entry is
  instant while pull-to-refresh and explicit Retry force a network read; aborted,
  failed, and superseded requests are never cached.
- Friends-listening reads now have an account/epoch/ticket boundary and a strict,
  cancellable loader. A network failure can no longer masquerade as an empty
  friend circle or let an old account's response repopulate the next session.
- Moderation reports and the member directory now use opaque descending keyset
  cursors. Older work and accounts beyond the initial page remain reachable;
  member search is server-backed by name, handle, or ID only and never searches
  email.

The genre follow-up also made an explicitly empty `genreClaims` list
authoritative, centralized provider-claim writes, retained crawler buckets only
as `tag_hint` evidence, and added an immediately invalidated 60-second in-process
projection cache. This prevents withdrawn staff claims from reappearing as fake
provider evidence and removes repeated full-catalogue JSON parsing.

## Render failure and current release state

The observed Render failure was deterministic, not a transient platform event.
Render's build command intentionally grants a temporary build database
`PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true`. The test subprocess previously inherited
that deployment-only value, so the health-policy test saw bootstrap enabled and
failed. Staging also supplies `PIT_ENV=staging`, which caused six campaign tests
to suppress their mocked recipients.

Commit `2ec2679` fixed the boundary in `scripts/run-tests.mjs`: only the child
test process is forced to `NODE_ENV=test`, `PIT_ENV=production`, and
`PIT_ALLOW_EMPTY_DB_BOOTSTRAP=false`. The later production commit is `c9d86eb`.

A fresh read-only Render-origin probe on 2026-08-13 reported:

- HTTP success with `ok: true` and commit `c9d86eb9b8b2`;
- database ready, configured database file present, and bootstrap disabled;
- backups enabled, although off-host backup is still not configured;
- media, mail, tour-provider, and YouTube configuration present.

The declared staging health URL is still not a release gate. A fresh probe
returned HTTP 502 with `x-render-routing: no-deploy`. Do not describe this batch
as staging-tested until a real staging deploy is provisioned and exercised.

## Moderation architecture

### HTTP boundary

| Method and path | Purpose | Cache policy |
|---|---|---|
| `GET /api/admin/moderation` | Bounded queue summary, normalized open reports, privacy-safe target/reporter/author context, and recent actions | `no-store` |
| `POST /api/admin/moderation/actions` | One action union for report dismissal, report-target removal, direct removal, or restoration | write response |
| `GET /api/admin/members` | Bounded staff member directory and aggregate counts | `no-store` |
| Legacy moderation routes | Compatibility wrappers over the same service behavior | legacy report reads now also use `no-store` |

The server derives a report's target and author from the stored report. The
client cannot substitute a different target ID. Message reports expose metadata,
not direct-message body or recipient data; staff projections omit email, media
URLs, and internal audit payloads. `emailVerified` is returned only to admins,
not moderators.

Moderation mutations run under `BEGIN IMMEDIATE`. The target change, report
resolution, and audit row either commit together or roll back together.
Repeating an already-reached desired state succeeds without adding a second
audit record; an incompatible action against a closed report returns a stale
conflict instead of silently rewriting history. Existing endpoints remain as
wrappers so older clients are not broken.

### Client boundary

`AdminScreen` retains legacy analytics, songs, catalogue, email, badge, and
request tools, while the new moderation workspace lives in
`src/components/moderation/ModerationConsole.jsx`. Report and member projection,
filtering, and status rules live in `src/domain/moderationConsole.mjs` rather than
inside the screen.

The workspace provides:

- overview cards for content reports, song reports, and restricted members;
- report search, type filtering, server-projected context, confirmation, retry,
  and truthful success/failure feedback;
- a searchable member directory with status and role filters, restricted users
  first, and an expandable master/detail action surface;
- incremental rendering (30 reports and 40 members initially) instead of
  mounting every action for every record;
- 44-pixel interaction targets, accessible tab/expanded state, and responsive
  wrapping on phone and desktop;
- locked role/ban/suspension controls for the current admin to prevent accidental
  self-lockout.

The staff member directory uses bounded 50-row server pages with opaque keyset
cursors. Search and supported role/status filters are evaluated by the server,
so accounts outside the first page remain reachable. Global totals are labelled
separately from the current query and loaded rows rather than implying a page is
the whole user base.

### Hidden defects corrected

1. **Staff-data persistence:** the old strict member load merged staff-only rows
   into global `users`, which is persisted to web storage and survived logout.
   The directory now uses ephemeral, account-scoped `adminMembers`; legacy
   staff-only fields are scrubbed from persisted public users and reset on
   logout, account change, or role loss.
2. **Authority inversion:** stale cached public users could overwrite the fresh
   server-projected report author role or restriction state. Embedded moderation
   context is now authoritative; only an explicit completed member mutation may
   advance it locally.
3. **Late-read resurrection:** a slow queue/member GET could resolve after a
   successful moderation action and restore old state. Staff reads now carry
   account, role, dataset, and sequence tickets; mutations and auth changes
   invalidate older reads.
4. **Private response caching:** all current and legacy staff queue/member reads
   now opt out of caching.

## Discover architecture

### HTTP and service boundary

`server/discoverService.js` owns the database projections. The HTTP layer is
thin:

- `GET /api/discover/overview?by=popularity|plays&country=...` returns chart
  rows, chart source/label/live state, genre distribution/totals, catalogue and
  non-banned member totals, countries, and `generatedAt` in one payload.
- All four public Discover reads use bounded public caching:
  `max-age=60, stale-while-revalidate=300`.
- The existing chart endpoint remains the selected-genre detail source. The
  strict Store action accepts an abort signal and rejects failures instead of
  converting them into a misleading empty list.

The service canonicalizes conservative aliases, but it does not trust a genre
because a string exists in the `artists.genre` column. Display, aggregation, and
filter membership all follow:

```text
stored claims -> authority resolution -> display threshold -> canonical label
```

Crawl/tag hints remain internal and are not counted, shown, or filterable.
Provider consensus, direct provider evidence, and staff decisions remain
eligible according to the shared authority policy.

### Client behavior

The screen is split into small Discover primitives, chart, genres, and community
components. It now has:

- one cancellable overview request with a latest-response sequence guard;
- independent, cancellable selected-genre loading and retry;
- honest initial-load, refresh-error, chart-empty, catalogue-empty, and
  search-empty states;
- partial-content preservation when only the “On Pit” plays chart is empty;
- local chart search and clear/play controls;
- Worldwide and home-country entry points with case-insensitive deduplication;
- account-scoped friends-listening results that clear immediately on account
  change and reject late results from the previous account;
- narrow-layout adaptations and 44-pixel source, region, retry, close, clear,
  and play targets.

Effect teardown aborts the *current* request reference, not only the controller
captured when the effect first mounted. That closes the case where a manual retry
replaced the controller and then outlived an unmount.

## Desktop video incident

The supplied desktop screenshot was reproduced against the exact public post and
third gallery item. The object is a 67,061,900-byte QuickTime MOV containing H.264
High Profile video and AAC audio. Storage was healthy: the full request returned
200, byte ranges returned 206, CORS matched the production origin, the movie index
was at the head, and Chromium decoded it with `readyState=4` and no media error.

The incident was a web layout failure. The source is encoded landscape with a
rotation matrix that displays it as 1080×1920 portrait. Expo's web video element
honoured that intrinsic aspect ratio inside an unconstrained flex item, producing
a 1280×2275.55 element in a 551-pixel-high modal. The clip's controls and most of
the concert frame were therefore roughly 1,555 pixels below the desktop viewport;
the pale sky visible in the screenshot was a decoded first frame, not a failed
upload.

The viewer now:

- gives the stage and clipping wrapper zero minimum dimensions and hidden
  overflow, then absolute-fills the web `VideoView` with explicit 100% bounds;
- enables native controls and inline playback, reports loading/first-frame/error
  state, and provides Retry and Open video recovery actions;
- keeps video-focused Left/Right keys with the native player instead of changing
  gallery items, while Escape continues to close the viewer;
- uses media-specific, 44-pixel controls and accessible labels; and
- requests the SDK 56 iOS H.264 1080p export preset for future post videos, which
  writes a real MP4 rather than preserving an incompatible camera MOV. Web and
  Android picker behavior is unchanged.

Final acceptance used the same production object in an isolated local post. At
1280×720 the rebuilt video and its stage both measured 1280×551; at 390×844 both
measured 390×675. The video decoded with controls and no error, playback advanced,
and pressing Left while the video was focused kept the gallery at item 3 of 3.
No production content or account state was changed.

## Verification

Checkpoint evidence when the moderation, Discover, and desktop-media slice was
completed is retained below. Later whole-tree work added the journey menu,
venue/event experience, analytics, and recommendations; the current aggregate
verification lives in `PERSONALIZATION_ANALYTICS_2026-08-13.md` and supersedes
these checkpoint counts.

- `npm test`: **435/435 passed**;
- `npm run check:syntax`: **104 files passed**;
- `npx expo install --check`: dependencies are aligned with SDK 56;
- fresh Expo SDK 56 web export: passed, 506 modules and 42 JavaScript bundles;
- web entry: **2,249,907 bytes raw**, **616,459 gzip**, and **505,926 Brotli**;
  moderation remains a lazy **124,815-byte** `AdminScreen` chunk, Discover is
  **47,196 bytes**, and the media viewer is **7,957 bytes**;
- Android export on the same final client tree: passed, 904 modules and an
  approximately 4.3 MB Hermes bundle;
- focused Discover, moderation, privacy, race, authorization, legacy-contract,
  and provenance regressions are included in the full result;
- `git diff --check`: clean apart from line-ending notices.

Authenticated local browser QA covered 390×844 and 1280×720 layouts. There was
no horizontal overflow. Overview, empty report queue, member filtering/detail,
and self-action locking were exercised. Discover was checked at narrow and
desktop widths, including an empty plays chart that keeps the valid genre
overview visible. The QA account and database were isolated from production;
no production moderation or content writes were made.

## Remaining risk and release checklist

1. Provision a real staging deploy. Its declared endpoint currently reports
   `no-deploy`, so it cannot validate this release.
2. Run real Android and iOS acceptance for slow-network retry, scrolling,
   screen-reader focus, and destructive-action confirmation. Metro exports and
   responsive browser QA do not prove OS interaction behavior.
3. Rehearse one report removal/dismissal and one member restriction in staging,
   including duplicate retry and stale-conflict behavior, then confirm the audit
   trail.
4. Verify poor-cellular Discover refresh and account switching on a physical
   phone.
5. The wider web entry remains about 2.3 MB. This revamp keeps moderation lazy,
   but startup profiling and Store-provider splitting remain broader performance
   work.
6. Genre projection currently parses the catalogue data blob during aggregation
   and filtering. It measured about 17 ms for roughly 2,658 artists; add a
   short-lived evidence-aware index if catalogue growth makes that material.
7. Production backups are enabled but still same-disk only. Configure and verify
   an off-host snapshot before treating backups as disaster recovery.
8. Four of the five currently exposed production clips are genuine QuickTime
   MOV files. The viewer now fails honestly and future iOS picks produce MP4,
   but existing MOV objects still need a verified stream-copy/remux migration to
   real MP4 before QuickTime can be rejected at ingest. Renaming extensions is
   not sufficient, and URL-keyed reactions must be preserved during migration.
9. Production media is served from Cloudflare's managed `pub-*.r2.dev`
   development hostname, which is variably rate-limited and not cached. Attach a
   direct custom bucket domain such as `media.mshpit.com`, update R2 CORS and
   immutable object metadata, set `MEDIA_PUBLIC_BASE_URL`, and project or rewrite
   existing same-bucket URLs. This requires Cloudflare configuration and was not
   attempted from the feature branch.

No commit, push, merge, Render deploy, or production data mutation is part of
this feature-branch audit.
