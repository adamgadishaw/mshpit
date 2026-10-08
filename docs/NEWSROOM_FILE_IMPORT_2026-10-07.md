# Newsroom file import and optional video — 2026-10-07

Review branch: `codex/newsroom-file-import-20261007`, based on
`b0e6021baa1882670f85e34d00c1d06518e71a19`. No database migration or access
expansion. This document describes candidate code, not a production release.

## Behavior and ownership boundaries

The existing Newsroom composer accepts drop/choose files, displays a local
preview, and requires **Use this article/media**. Replacing unsaved work requires
confirmation. The user then reviews normal editor fields, saves a draft, and
uses the existing manual publication action. Import itself never saves,
publishes, generates reporting or follows document instructions/URLs.

Supported desktop and mobile web inputs: one article ZIP on its own; or one
plain DOCX, best-effort text PDF or UTF-8 TXT with up to one JPG/PNG/WebP cover
and one MOV/MP4 video. Media alone can be added to current writing. Native apps
retain their existing writing and media picker and direct file import to web.
Scanned/encrypted PDFs need a text export; no OCR, purchase or provider call.
DOCX external relationships (including hyperlink relationships), macros,
embedded objects and active content are rejected. Rich formatting and embedded
document images are not imported as article content or cover selections.

The original media upload/finalize/polling/normalization flow is reused with
the expected account on every request. Ready video requires a verified public
render and poster. A queued selection is retained before any transfer begins;
local continuity stores only pending markers or remote asset IDs and credits,
never file bytes, object URLs, private source URLs or credentials. Pause, retry,
reload, navigation and account handoff preserve the existing ownership rules.
After reload, a pending selection with no remote identity explicitly requests
the original file again. Existing remote IDs resume verification without a new
source upload. Import replacement does not remove existing server drafts.

The editor and public full article show optional video without autoplay; feed
cards retain the cover. Server draft and publication paths verify exact media
kind, editor ownership, readiness, live object ledger and poster. Publication
attaches the cover and optional video in the existing transaction; invalid
video rolls back the whole operation. Existing session roles, Media API
permissions and draft idempotency remain unchanged. Photo and video provenance
never count toward article confirmation, excerpt evidence or JSON-LD citations.

## Package version 1

ZIP root contains `manifest.json` plus only its referenced local media. A
multi-story package has 1–10 entries; the editor imports one selected story at
a time. All values below are synthetic examples.

```json
{
  "format": "mshpit-newsroom",
  "version": 1,
  "articles": [{
    "id": "synthetic-tour",
    "headline": "Fixture band announces a tour",
    "summary": "A synthetic summary for testing.",
    "body": "Synthetic reporting. Never publish this fixture.",
    "category": "tour",
    "sources": [{"kind": "article", "name": "Fixture Band", "url": "https://example.com/announcement"}],
    "photo": {"file": "media/cover.png", "name": "Fixture Photographer", "url": "https://example.com/photo-rights", "credit": "Synthetic"},
    "video": {"file": "media/clip.mp4", "name": "Fixture Filmmaker", "url": "https://example.com/video-rights", "credit": "Synthetic"}
  }]
}
```

Cover is required in a package; omit `video` if none. Categories: `release`,
`tour`, `festival`, `lineup`, `awards`, `charts`, `legal`, `death`. Sources must
contain 1–10 HTTPS article citations; media names and HTTPS rights URLs live in
the separate media fields. Unknown fields, duplicate IDs and unlisted files
are rejected. No automatic rights or fact verification is claimed.

Limits: document 10 MiB, ZIP 25 MiB, expanded archive 40 MiB, 256 entries,
100:1 compression ratio, extracted body 60,000 characters, PDF 100 pages,
worker timeout 20 seconds, separate image 20 MiB and video 512 MiB. Package
headline/summary limits are 180/700 characters. Documents may be any nonempty
length within the cap; there is no minimum word count. ZIP packages naturally
cannot carry videos larger than the archive limits; select larger clips
separately. Extension/MIME and byte signatures are checked before parsing.

ZIP processing rejects traversal, absolute/backslash paths, case aliases,
duplicate entries, symlinks/nonregular files, unsupported/encrypted/ZIP64 or
multi-disk archives, local/central disagreement, overlap, false sizes and bad
CRC. Streaming inflation caps actual output before oversized allocation.
Extraction is memory-only. XML declarations/entities/external references are
rejected before DOCX parsing. Plain extracted text is rendered as escaped text.

## Packaging and dependencies

Pinned parsers: fflate 0.8.3, Mammoth 1.13.0, PDF.js 6.4.299. The preparation
script copies maintained browser distributions and licenses into ignored
`public/newsroom-import/`; `build:web` prepares them before Expo export.
`npm start` prepares them through `prestart`; after direct `npm run web` or
other direct Expo invocation, run `npm run prepare:newsroom-import` first.
The main UI loads parsers only when files need them, in a module worker.
Same-origin `.mjs` assets use JavaScript MIME and revalidation (`no-cache`) to
keep worker and parser versions aligned. Document content supplies no network
destinations. Cancellation/timeout terminates the worker. PDF.js startup
messages cannot settle the import; only explicit preview/error messages can.

`npm audit --omit=dev --audit-level=high`: **0 vulnerabilities**. No existing
locked package versions changed; 35 packages were added. Full dev audit:
26 findings (3 moderate, 22 high, 1 critical), including pre-existing build
dependencies. The new moderate `sprintf-js` GHSA-hp3w-g68c-fv3c chain is
Mammoth → argparse → sprintf-js, used by `node_modules/mammoth/bin/mammoth`.
Neither argparse nor sprintf-js appears in the copied Mammoth browser bundle;
the CLI is never executed by this feature. Do not downgrade Mammoth or run a
broad audit fix as part of this work. Continue tracking the dev dependency
findings separately; a clean production audit is not a clean full audit.

## Validation and release boundary

- Final broader local run: **347/347**, including all News Desk and Media API tests,
  news domain/editor tests, media ownership/finalization/cancellation/recovery,
  public news documents, canonical SEO and social sharing, static cache and worker fixtures.
- After review corrections: **16/16** affected worker, client protocol,
  retention, media and canonical SEO tests passed.
- Independent initial review found three defects (PDF.js startup protocol,
  queued-video loss before upload, canonical video-credit citation). Corrections
  and regression coverage are included. Independent re-review passed **12/12**
  affected tests and actual PDF extraction under browser-like worker globals,
  with document network requests blocked; no new blocking findings. Its minor
  no-op pending retry observation was also fixed by requiring an original or
  remote ID before offering Retry.
- Full Node syntax: **830 files passed**; changed JSX syntax: **6 files passed**.
  Architecture and `git diff --check` passed.
- Cloud workflow adds real-worker desktop/mobile import cases, actual text PDF
  extraction and scan rejection, invalid ZIP preservation, replacement
  confirmation, double clicks, pause/reload before video transfer, verification
  resumption, manual save and account isolation; existing composer publish
  browser coverage also runs. Cloud build/browser results are pending.
- No local Chromium or heavy Expo export; the large catalog bundle test is
  reserved for cloud. No real article data or licensed media is committed.
- Actual Library TXT/ZIP fixture downloads returned HTTP 403 via the official
  transfer flow. This was not retried through another route; synthetic fixtures
  provide current parser coverage. Compatibility with those exact files remains
  unverified. This feature does not repair the separate cloud-browser outage.

No production write, provider use, credential creation, grant, API activation,
merge or deployment is part of this review branch. Final exact-commit cloud
gates and owner review are required before release.

## October 8 cloud follow-up

Owner opened draft PR 36 at `5acdb0e`. Run `37708734047` exported the web app,
then failed the unchanged startup budget: 518.5 KiB versus 512 KiB, with player
UI found in startup code. The new direct async entry for the gallery's internal
video player caused Metro to promote shared playback dependencies. Article
video now loads the existing `PhotoViewer` chunk's named player export instead.
Playback behavior and the budget/label gates are unchanged; browser and complete
cloud checks must pass on the follow-up head before readiness is claimed.

Run `37709039148` on `f624858` removed the startup player labels and reduced
initial JavaScript to 516.3 KiB. The remaining duplication was the original
media uploader: Newsroom imported it dynamically while LogScreen imported it
statically. LogScreen now loads that identical uploader at the upload action,
preserving its account, abort, original-source and recovery options. Metro's
shared-chunk extraction can retain the uploader behind one async entry. No
budget increase or assertion removal is used.

Run `37709285187` on `c755d26` reached 512.7 KiB. The uploader and existing
availability service both use bounded request recovery. A small
`mediaPublishingEntry` now exports both behind the same dynamic import, so
Metro does not lift their shared retry implementation into the common startup
chunk. Their implementations, options, cancellation and cache rules are intact.

Run 515 reached 512.5 KiB. A lightweight dependency-graph comparison identified
the full `mediaEdit` module as newly shared between LogScreen and the uploader.
Its original recipe, kind, adjustments and size helpers are moved unchanged to
`mediaOriginal` and re-exported by `mediaEdit`, preserving all existing imports
and behavior. The uploader imports the small module directly, so it no longer
promotes unrelated crop, filter and transform implementations into startup.
No cross-feature or screen dependency was introduced.

## Separate read-only Media API access assessment

Inspection only: `server/features/mediaApi/{mediaApiPolicy,mediaApiService,
mediaApiRoutes}.js`, `server/api.js`, `server/index.js` and client source.
No secret values or live environment configuration were read or changed.

| Action | Existing prerequisite / scope | Important limit |
| --- | --- | --- |
| Enable API routes | `PIT_MEDIA_API_ENABLED` truthy | Defaults off; current live setting unverified. Activation is a separate decision. |
| Issue pairing | Authenticated locked canonical Owner; POST `/api/media/v1/grants/pairing` | Ordinary admin/editor cannot issue grants. Actor type `assistant` or `human`, safe label and explicit scope array required. No owner-facing grant UI exists. |
| Exchange pairing | POST `/api/media/v1/grants/exchange` with single-use pairing code | Returns access token once. Pairing lasts up to 10 minutes; grant lasts a fixed 7 days. |
| Upload and finalize image | `media:write`; POST `/api/media/v1/media/assets` then signed private PUT and POST `.../:id/finalize` | Images only, ownership and existing storage/verification required. |
| Upload/finalize MOV/MP4 | Unsupported by this API | `photosOnly` enforcement rejects video; no video scope exists. General session uploads are separate. |
| Create self-written draft | `news:write`; POST `/api/media/v1/news/drafts` | Scope also authorizes publication; no draft-only grant. |
| Read known draft | `news:write`; GET `/api/media/v1/news/drafts/:id` | Exact owner AND same grant, unpublished self-written only; no list or update endpoint. |
| Publish draft | `news:write`; POST `/api/media/v1/news/drafts/:id/publish` | Expected revision + idempotency key and same owner required. Another grant's draft is rejected; legacy/session drafts with null grant remain eligible. |
| Revoke grant | Locked Owner session; DELETE `/api/media/v1/grants/:id` | Must retain grant ID; no grant-list route/UI. Revokes the owner's pending pairings too. |

Pairing `expiresInSeconds` (60–600) controls pairing lifetime only, not the
7-day bearer grant. There is no refresh/renew endpoint. Pairing is single-use,
hashed at rest and attempt-limited. Revocation clears the token hash. Every
operation rechecks account role, verification and banned/suspended status;
mutation commit paths recheck grant validity. News drafts expire after 24 hours.

Audit rows record actor type/label, owner/grant/request IDs, action/target,
payload hash and outcome; database triggers prevent audit update/delete.
Raw credentials/content are not audit payloads. Idempotency receipts are scoped
to grant+operation+key and payload hash, expire after 72 hours, and use a 15-minute
lease. Changed payload under the same key conflicts. Route limits: reads 60/min;
draft/create/publish and media/create/finalize 20/hour each; pairing/exchange
5/15min; revoke 20/hour.

There is **no supported owner grant-management screen** in the current client
and **no installed Mshpit API connector or secure token-exchange/storage/binding
tool** in this environment. Approving activation and a grant alone therefore
does not provide a usable secure browser-independent workflow. Do not paste
tokens into chat/files or extract session credentials. A supported secure
integration and an owner issue/revoke surface need separate implementation and
approval. A draft-first grant followed by a publication grant also needs a
scope split and explicit draft ownership/handoff design; existing same-grant
recovery prevents assuming two grants can freely share drafts. Video API access
would require a separate API change. None of these access changes is included.
