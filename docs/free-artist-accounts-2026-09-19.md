# Free artist accounts

Implemented September 19, 2026. Deployment status is reported separately; local
browser fixtures are not evidence of production account creation.

## One account, one artist identity

- Signup offers Music fan / Artist or band. Artist intent is a private draft,
  not a role, page ownership, or verification grant. A successful signup opens
  page setup without relying on a React session render completing first.
- After email confirmation, the same member can create one new artist page.
  Existing members use **You > Create or claim artist page**. The name must be
  unique across catalog identities, slugs, normalized search, and reviewed
  aliases. Existing names go through a reviewed ownership claim.
- Creation is an atomic database operation. The catalog identity, owned profile,
  and account role commit together; retries return the existing owned page.
  It makes no synchronous MusicBrainz or other provider call.
- Artist HQ includes page photo/banner/bio editing, ordinary live photos and
  videos, featured promotions, upcoming concerts/ticket links, and a separate
  request for the artist check. No second login or subscription is created.

## Verification and moderation

Creating a page does not grant a check. Email confirmation and the public artist
check are different. The owner reviews evidence in Moderation's artist request
queue; requests are labeled as page claims or checks for an already owned page.
Approval grants the check and, for a claim, page management. Rejection preserves
the existing page. Decisions are audited; replay cannot restore a revoked check.
Members cannot set role, owner, or check flags in signup or page-creation data.
The existing Members moderation controls can revoke verification.

The one-time schema upgrade preserves checks only for previously approved,
owned identities with no recorded verification revocation. Role alone is not
evidence. No production database reset, data import, or manual backfill is used.

## Media, privacy, storage, and catalog integrity

- Ordinary media posts use the existing upload pipeline and normal limits;
  they do not spend the two-featured-promotions-per-day allowance. Gallery
  sharing has an explicit, default-off photo/video checkbox. Ownership is
  derived by the server, not a client-supplied artist identifier.
- Existing byte/count limits, private sources, video verification, media
  ownership checks, cleanup, and moderation remain enabled. Free publishing
  does not imply unlimited storage. No Render plan, disk size, or paid service
  was changed for this feature.
- Authored artist pages and their authored shows respect current account
  privacy, blocking, active status, ownership and profile removal. Independently
  imported provider events remain public facts. Personalized Discover responses
  are private/no-store rather than shared-cacheable.
- Automated name-only enrichment skips self-created artists so a namesake's
  provider photos or music cannot populate the wrong page. Exact-ID workflows
  remain separate, and upserts preserve the artist-created provenance marker.
- Public pages use the existing SEO quality policy: a blank account does not
  automatically become an indexable catalog page. Substantive, visible profiles
  can qualify for directories/sitemaps; no Google indexing guarantee is made.

## Acceptance and limits

The exported app has eight isolated browser journeys at 375 and 1280 pixels:
creation with load/save failure and retry, duplicate-to-claim recovery, real
signup through email confirmation into setup, and pending-check Artist HQ.
The media journey uploads a synthetic image and checks the actual post payload
for explicit gallery permission without featured promotion or forged identity.
The existing 60 auth journeys, two media-upload journeys and two quick-log
journeys also pass. Fixtures never create production accounts or send email.

The added browser suite is in CI (`npm run verify:artist-account-browser`).
The full release gate passed: 5,243 unit/integration tests, zero production
dependency vulnerabilities, syntax, architecture and production export.
Initial web JavaScript is about 504 KiB gzip,
under the unchanged 512 KiB budget. No native-device or real-person upload is
claimed from desktop browser tests.

Current scope is one owned artist page per account, not a multi-manager label
dashboard or an audio-distribution service. Existing reviewed artist ownership
and protected legacy/memorial policies remain in force.
