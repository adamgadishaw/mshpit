# Venue discovery and community pages — isolated candidate

Historical initial-delivery record for `4a17fd2`. Its pre-existing venue-role
requirement and deferred follow/composer paths are superseded by
[the venue completion record](VENUE_COMPLETION_REVIEW_2026-11-11.md).

Base: `2b0151a448e8f29affb5d7e3b0052a3adc3e2cd5` (PR #98 combined database/theme
candidate). Branch: `feature/venue-community-20261111`. This work is not merged,
published, deployed, or installed on a device. The original integration checkout
was only read; this is an independent clone under the current task workspace.

## Existing behavior and scope

The baseline already has dedicated VenueScreen navigation, public canonical
venue snapshots, licensed/fan photo galleries, name-keyed venue notes, moderation,
and a city/map explorer. Discover artists have square image tiles; venue results
were text rows. There was no venue claim or operator linkage. Legacy notes allow
multiple reviews and the client averages only its loaded notes.

The new discovery tiles follow the current artist grid's square artwork,
two-to-four-column sizing, typography, theme colors and spacing. Venue pages keep
their existing header, gallery, sections and navigation. Empty legacy reputation
and note sections are hidden. The community section has actual ratings, one
editable member contribution and a claim form; it does not add placeholder posts
or an inactive posting button. Discover's country now also filters the optional
web catalogue; city/search/page changes use the same rows for map and tiles.

No changes were made to `src/store.js`, concert composers, ShowScreen, artist
performance/setlist scoring, independent overall-show scoring, post/review
permalinks, media upload ordering, long-review retry, or notifications. The
separate review and creator workers own those contracts. Earlier venue notes
remain readable and are not silently reassigned to a provider venue or converted
into artist-performance feedback.

## Media contract

`GET /api/venue-community/covers?paths=<comma-separated encoded canonical paths>`
accepts at most 12 paths and returns `{ covers: [{ path, photo }] }`. Missing or
ineligible images return `photo: null`; the tile uses initials, never synthetic
venue media. Images come from the existing ready-image provenance checks and
in-person concert posts, with public-photo consent, active public author accounts,
current moderation and bidirectional block checks. Discovery excludes venue-note
photos whose name-only association cannot identify the physical venue. Matching
requires a canonical venue path in the post or the venue name/known alias plus an
exact full stored place. City-only legacy logs may therefore have no cover.

The response keeps `postId`, `ownerId`, `origin`, source and author credit. Tiles
display the credit. Reads are bounded and `no-store`, use existing venue indexes,
and refresh on account/venue/privacy scope changes. No media URLs are written to
the catalogue, public metadata, or persistent client state by this feature.

## Standalone venue-rating contract — integration seam

The canonical namespace in existing `venue_reviews.venue_key` is `/venue/<slug>`.
It is deliberately distinct from legacy name-keyed notes. A partial unique index
allows one active rating per member and canonical venue. `PUT` edits the same
review ID, making duplicate clicks and retries safe. Ratings accept numeric
1–5 in half-star steps; note text is optional and capped at 2,000 characters.
These are direct venue ratings, not the separate 32,000-unit concert-review text
or its independently chosen overall/artist/venue dimensions.

`GET /api/venue-community?path=...&after=...` returns:

```
{ path, ownership: "community" | "verified", isOperator,
  claim: { id, status } | null, myReview: { id, rating, text } | null,
  rating: { count, average }, reviews: [{ id, userId, name, rating, text, createdAt }],
  nextCursor }
```

Aggregate count/average covers all currently visible eligible rows, independent
of the 20-row cursor page. Author audience, active status, open reports, removal
and blocks apply before aggregation and paging. The cursor binds to the venue.
Only the authenticated member sees their own claim and rating. `PUT` and `DELETE
/api/venue-community/rating` take `{ path, rating?, text? }` and return a refreshed
snapshot. Author IDs are never taken from request bodies. Legacy review endpoints
reject this namespace so they cannot bypass its checks. Reports reuse
`targetType: "venue_review"` and the existing moderation flow.

The review-package integrator should reconcile this explicit standalone source
with its separate profile-score projection before release. Do not replace an
authoritative venue score with an average of fetched notes, infer artist
performance from historical overall-only reviews, or label overall-show score
as a blend. Preserve the rating eligibility and ownership boundaries even if the
final UI consumes that package's unified summary.

### Comparison with frozen rating candidate c041ca6

Inspected read-only at `task-6/ratings-integration-20261111`, commit
`c041ca6db8bcfd1c3a662c154dbb4eb21be79179`, also based on `2b0151a`:

- Its `loadVenueReviews(name)` returns `{ ok, reviews, stats }`, where `stats`
  contains `reviewCount`, `ratingCount`, and `averageRating`. VenueScreen binds
  that result to name/account/privacy scope and refreshes it on review changes.
- `createPublicVenueReviewService` computes the latest valid 0.5-5 rating per
  member over all name/alias-keyed notes. Text/photo excerpt eligibility is
  separate from numeric rating eligibility. This feature instead stores one
  editable canonical-path rating (1-5 half steps), and its response calls the
  equivalent count/average fields `rating.count` / `rating.average`.
- Do not merely combine the two averages or re-key same-named venues. A combined
  projection needs verified canonical identity, one contribution per member,
  an explicit precedence/migration policy for edited canonical ratings versus
  historical name-keyed notes, and one agreed rating range. Canonical edits keep
  their stable ID and original `created_at`; that timestamp is not an edit time.
- Retain this feature's audience, open-report and block eligibility before any
  combined aggregation. The inspected legacy projection SQL filters active
  accounts/removal/blocks but lacks the audience and open-report predicates used
  here. Those protections must not be lost when adopting its stats shape.
- In VenueScreen, retain the rating candidate's authoritative stats loading and
  VENUE SCORE semantics rather than the baseline `avgRoom` presentation retained
  in this isolated branch. Merge this feature's community controls, lazy import,
  useful empty states and removal of sampled-note averages around that contract.
- Direct shared files are `server/api.js`, `src/screens/VenueScreen.jsx` and
  `STATUS.md`. This feature does not touch its Store, artist projections,
  `profileScoring.mjs`, concert composer, media order or recovery code. Its artist
  performance/setlist and independently selected overall-show rules remain intact.

The rating candidate was not reported as release-cleared; combined score behavior
is a required integration/review step, not a completed acceptance claim here.

## Verified operators and creator integration

The only ownership registry is the creator worker's `creator_entities`, with
`entity_type = 'venue'` and `entity_key = snapshot.path` (canonical `/venue/...`).
Claimable paths must fit the shared 200-character entity-key contract. Venue claim
records in `venue_claims` are review evidence, not a parallel ownership registry.
There is no `venue_operators` table and no separate follow store.

Approval calls the worker's exact `setCreatorEntityOwnership(db, { entityType,
entityKey, name, ownerId, expectedOwnerId, status })` helper inside the SAME
IMMEDIATE transaction as the approved claim and moderation audit. It requires
`expectedOwnerId: null`, a current active account with role `venue`, confirmed email,
canonical provider identity and independently verified operator authority. It
never promotes an ordinary user, artist or event account to venue classification.
A member may submit a claim, but the authoritative venue account classification
must be provisioned through the creator account process before approval.

Revocation uses the same helper with `ownerId: null`, compares the current owner
against the claim's applicant, and preserves the registry's moderation status.
Held/removed pages cannot be reactivated by a new claim approval. Pending claims,
ratings, concert uploads and request-body roles never populate the registry.
Approval/revocation preserve their evidence method/reference in the moderation
audit. The shared compare-and-set guard prevents competing approvals.

`verifiedVenueOperator(db, venuePath, at)` and `ownsVerifiedVenue(db, accountId,
venuePath, at)` in `server/features/venueCommunity/ownership.js` are READ adapters
over the shared registry plus matching approved claim evidence. They additionally
check active status, role `venue`, email verification and registry status `active`.
The posting worker remains responsible for its own server-side creator policy;
the public `isOperator` flag is presentation data, never authorization.

The local branch includes byte-identical copies of these TWO worker dependencies
for standalone validation, in a separate prerequisite commit:

- `server/features/creatorPosts/creatorEntityOwnership.js`
- `server/features/creatorPosts/creatorPostSchema.js`

Source inspected read-only: `task-5/creator-posting` on 2026-11-11. Do not apply the
prerequisite commit over a newer complete creator package. Integrate that package
first, then the venue feature commit. Keep one `ensureCreatorPostSchema(db)` call
before venue feature startup, and one `creatorAccount: exportCreatorRelationships`
entry in account export. The dependency files are not alternative implementations.

Claim/review routes:

| Route | Boundary |
| --- | --- |
| `POST /api/venue-community/claims` | Active, email-verified member; canonical provider venue; HTTPS website and explanation; repeat pending submissions return the same claim |
| `DELETE /api/venue-community/claims/:id` | Applicant can withdraw only their own pending claim |
| `GET /api/admin/venue-claims?status=pending|approved&after=...` | Admin only; 20-row stable cursor queue |
| `POST /api/admin/venue-claims/:id/review` | Admin only; no self-review; role-checked, atomic exclusive approval, rejection or revocation with shared creator registry and moderation audit |

Approval requires an independent official-contact/domain-check method, public
HTTPS reference, substantive review note and explicit authority confirmation.
Staff perform that verification outside this form using a trusted official
channel. The form does not fetch arbitrary URLs or automatically verify ownership.
Replay of a completed decision is idempotent; contradictory/stale decisions conflict.
Claims are accessible in Admin > Requests, including approved operators/revocation.

Account export includes the member's own submitted claims without reviewer/internal
notes. Shared `creatorAccount` export includes owned entities and follow preferences.
Account erasure deletes claim-related moderation records, cascades claim records,
and the shared registry FK clears the owner while preserving the page/follow graph.
The integration must retain the creator package's complete post export, notification,
backup/recovery and deletion coverage, and run its standard migration/privacy gates.

### Profile posting/follow adapter points (creator package integration)

Use `CreatorPostsSection` with `entityType="venue"`, `entityKey={snapshot.path}`,
`accountId={session?.id}` and the existing post/comments opener. The natural insertion
point is after the VenueScreen hero/community controls. Composer dispatch is:

```
{ logging: true, postMode: 'creator',
  prefill: { creatorEntity: { entityType: 'venue', entityKey: snapshot.path,
    name: snapshot.venue.name } } }
```

Expose that action only from the authoritative owned-entity response and the venue
account classification. Server publishing must recheck ownership independently.
Use `GET /api/creators/venue/:encodedKey/follow`, `PUT` on that same route with
`{ following, notifyUpdates }`, and `PUT .../notifications` with `{ notifyUpdates }`.
The creator worker's `creator_follows` stores `account_id`, `entity_type`, `entity_key`,
`following`, `notify_updates`, `updated_at`. Artist follows keep their existing graph.
No follow/post/notification plumbing is duplicated by the venue feature.

The current worker routes return 404 for an entity absent from `creator_entities`.
An unclaimed canonical venue therefore needs trusted catalogue provisioning as an
active row with `owner_id: null` before followers/empty-update reads are enabled.
Do not manufacture that row from a pending claim or arbitrary client key. This is
an explicit integration prerequisite for following community-run venues before a
verified claim. This patch's discovery and rating reads remain side-effect-free.
## UI/copy and shared-file handoff

New UI copy lives in `src/features/venueCommunity/{DiscoverVenues,
VenueCommunityPanel,VenueCommunityControls,VenueClaimsPanel,VenueCover}.jsx`.
Changed existing copy is in VenueScreen and the lazy loading fallbacks in
DiscoverScreen/AdminScreen. The old shared DiscoverVenues component moved into
the venue feature so shared UI does not import feature services or the legacy
store. Source-reference tests track the move. No architecture allowance was
relaxed, and new API calls live behind a feature service.

Likely integration overlaps: `server/api.js` (route registration, legacy namespace
guard, erasure), `server/db.js` (schema initializer), accountPrivacyRoutes (export),
VenueScreen (profile presentation), AdminScreen (claim queue) and DiscoverScreen
(feature import/props). Apply those hunks surgically. The exact manifest and
delivery commit/bundle are recorded in the task's delivery receipt.

## Validation

Final source gates: `npm run test -- --test-concurrency=4` passed 7,400 tests,
with zero failures and one host-file-symlink skip (7,401 total). The 15 direct
venue-community route tests also passed. The syntax sweep passed all 961 Node
files; architecture and staged/unstaged whitespace checks passed with no relaxed
allowances. The npm production dependency audit found zero vulnerabilities after
a restricted-network attempt failed. Web production export/budget and iOS Hermes
export passed. Startup JavaScript was 511.0 KiB against 512 KiB, leaving about
1 KiB; the combined creator/review candidate must recheck that budget.

The required aggregate components were run individually after `npm run check`
stopped at the registry audit request. A later unconstrained full run hit an
existing 100 ms map-catalogue VM timeout; the final four-worker full run passed
without changing that timeout. A serial interim run was stopped when the shared
creator ownership contract arrived, then the final source was revalidated.

Rendered browser results and evidence paths are in the final delivery receipt:
six discovery/map cases (320/375/1280 px) and six community cases (guest/member/admin,
375/1280 px), including read errors/retry, retained failed drafts, repeated rating
edits, pending claims/withdrawal, verification controls, approval and revocation.
Tests use temporary
SQLite databases and synthetic browser fixtures only. Browser screenshots are UI
evidence, not actual venue-photo evidence. Earlier runs exposed a JSX typo, a
fixture-only email-null mismatch, an assertion on generic error copy, a stale map
fixture build, and startup bundle overhead; each was corrected before the final
checks. Physical iOS/Android, real uploaded production media, live staff verification
and the combined creator/review release remain separate acceptance steps.
