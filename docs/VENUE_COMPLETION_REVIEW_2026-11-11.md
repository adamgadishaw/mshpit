# Venue account, follow and posting completion

This extends the initial `4a17fd2a1fcbd324edd2d0ebdb162cf24946faa8` delivery in
the isolated `feature/venue-completion-20261111` checkout. The original branch,
patch and receipt remain available. Nothing was published, deployed, installed
on a phone, or merged into another checkout.

## What changed after the initial delivery

The initial implementation required an existing venue role, but the baseline
provided no usable reviewed way to acquire it. It also left unclaimed-page
following and the creator composer as integration seams. Those paths are now
implemented and exercised together here:

- A confirmed, active personal account can request conversion to a dedicated
  venue account. The application explicitly discloses the conversion and sign-out
  and requires acknowledgement. Pending requests confer no privileges.
- Staff independently check official evidence and the claimant's authority,
  explicitly confirm conversion, and record their decision. Approval atomically
  converts the eligible account, assigns shared registry ownership, invalidates
  sessions and writes the audit. No artist, event or staff account is silently
  converted. Conflicting retained ownership/artist identity is also rejected.
- Genuine unclaimed catalogue venues can be followed. The shared creator route
  provisions only a trusted canonical, owner-null registry row. Public GETs stay
  read-only; no public arbitrary entity creation or ownership grant is exposed.
- Venue pages use the shared follow preferences and creator updates section.
  Approved venue operators open the existing creator composer with the canonical
  entity prefilled. Updates open the ordinary post/comments screen. Ordinary
  concert-photo contribution remains separate.
- All claim states are reachable with bounded pagination in both the staff queue
  and the applicant's request history. Revocation removes only that page's owner,
  preserves its held/removed status and unrelated owned pages, and signs out the
  former operator. Role demotion occurs only when no owned identity remains.

The existing venue header, gallery, section navigation, theme tokens and Discover
artist-style tiles remain the basis of the layout. New controls use the current
forms/buttons. Empty states describe actual missing content. No fabricated venue
information or generated venue imagery was added.

## Exact dependencies and local assembly

Base remains PR #98 candidate `2b0151a448e8f29affb5d7e3b0052a3adc3e2cd5`.
Local history before this extension:

1. `c0616155a4fc8ad104ee898cba5a58aabdb5a333`: exact initial shared creator schema
   and ownership helper dependency.
2. `4a17fd2a1fcbd324edd2d0ebdb162cf24946faa8`: initial venue feature.
3. `58ebf95`: remaining stable creator posting package, assembled from the exact
   `5f5fcbdbf240484108ac75dc67ebbc6cdaef27a7` worker commit. Duplicate schema/export
   registration was reconciled and an EOF blank line trimmed. This assembly is a
   separate dependency commit, not a competing creator implementation.
4. The venue completion feature commit, identified in the delivery receipt.

The final event/festival provisioning package was inspected read-only at
`de773dfc64589f03aa7613ce48acf3b20c72e87a` in `task-5/creator-posting`. It leaves
`creatorEntityOwnership.js`, `creatorPostSchema.js` and `creatorPostRoutes.js`
unchanged from `5f5fcbd`. Its event routes use the same helper and matching role
model. Event provisioning was not copied or independently rewritten here.

Do not apply the dependency assembly over an already integrated creator package.
Use the exact manifests/patches in the delivery directory to combine the venue
commits with the authoritative creator worker commits. Keep a single creator
schema initialization, route registration and account export property.

## Ownership and conversion contract

The only authority is `creator_entities(entity_type, entity_key, name, owner_id,
status)`, primary key `(entity_type, entity_key)`. Venue keys are exact canonical
`/venue/...` paths, at most 200 characters. Claim evidence is stored separately
in `venue_claims`; it is never a second ownership registry.

`POST /api/venue-community/claims` accepts `{path, website, note,
accountConversionAcknowledged: true}`. The current account must be active,
email-confirmed, role `fan` or `venue`, with no conflicting artist name, owned
artist profile or other creator identity. A fan with retained creator ownership
cannot use conversion to reactivate it. New claims store `conversion_consent =
'venue-account-v1'`, `conversion_consent_at`, and `account_role_at_request`.
These columns migrate idempotently. Old pending rows acquire no inferred consent;
the applicant must acknowledge and resubmit the existing request.

`POST /api/admin/venue-claims/:id/review` accepts `decision`, substantive `note`,
and for approval: `method` (`official_contact` or `domain_challenge`), independent
public HTTPS `reference`, `officialEvidenceConfirmed: true`,
`authorityConfirmed: true`, `conversionConfirmed: true`, `expectedOwnerId: null`.
The existing manual identity evidence validator checks the evidence URL and
confirmations. Current DB staff authority is checked again inside the immediate
transaction. Self-review, changed/claimed ownership and held/removed pages fail.

Within that transaction, approval sets `users.role='venue', verified=1`, invokes
`setCreatorEntityOwnership(db, {entityType:'venue', entityKey:path, name,
ownerId:applicantId, expectedOwnerId:null, status:'active'})`, deletes all user
sessions and newsroom browser sessions, updates the claim and records the audit.
A failed audit rolls back every change. The UI's `isOperator` and session role
are presentation controls; shared post commands independently enforce ownership.

Revocation requires `revocationConfirmed:true` and
`expectedOwnerId:claim.user_id`. It uses the same ownership helper with
`ownerId:null` and the registry's **current** `status`, including on the held or
removed target itself. Any other owned page, regardless of status, or artist
profile prevents venue-to-fan demotion. Sessions are always invalidated. Replaying
an old approval cannot regain revoked or reassigned authority.

Both `GET /api/admin/venue-claims` and `GET /api/me/venue-claims` accept
`status=pending|approved|rejected|revoked|cancelled|all` and `after`. They return
`{claims,nextCursor}`, with 20 rows per page ordered by `(created_at,id)` and a
cursor bound to account/admin scope and filter. There is no first-100 cutoff.
The applicant projection omits staff notes and reviewer identifiers. Existing
withdrawal is own-pending-only. Claim data participates in own export, backup
row-floor verification, account erasure and existing audit cleanup.

## Shared following and publishing contract

`canonicalVenueCreatorTarget(publicVenueSnapshotForPath,key)` accepts only an
exact server-resolved canonical path with provider identity and a valid catalogue
name. It returns `{entityType:'venue',entityKey:key,name}` or null. Body-supplied
names, roles and owner IDs do not provision pages.

`creatorPostRoutes` now accepts optional `resolveUnclaimedEntity(type,key)`.
The API injects the venue resolver; other types return null. An existing held or
removed registry entry cannot fall back to this resolver. GET follow/posts can
resolve an unregistered genuine venue without writing. In the shared follow or
preference transaction, a missing trusted target may be inserted as owner-null,
active, using `ON CONFLICT DO NOTHING`; existing ownership/status is preserved.

No parallel follows are introduced. The shared route
`PUT /api/creators/venue/:encodedCanonicalPath/follow` accepts `{following}` or
the existing `{following,notifyUpdates}`. Omitting `notifyUpdates` now preserves
the current DB preference atomically. This prevents an unfollow/refollow from
overwriting an alert toggle saved by the shared updates component. Explicit
non-boolean preferences remain invalid. The existing notifications route and
artist follow authority remain unchanged.

`GET /api/venue-community` additionally returns `creatorEntity` for a genuine,
available target. `VenueCreatorSection` renders shared following and receives the
shared updates component through the screen adapter. There are no cross-feature
UI imports. `src/screens/CreatorPostsSection.jsx` lazily loads the existing
creator component for venue and artist screens. The venue feature entry module
also shares a lazy boundary, retaining the initial bundle budget.

The authorized composer navigation is exactly:

```js
{ logging: true, postMode: 'creator',
  prefill: { creatorEntity: { entityType: 'venue', entityKey: path, name } } }
```

The shared `/api/me/creator-entities` confirms the entity again; publishing uses
ordinary `/api/posts`, expected-account headers, mutation receipts, media and
follower notification transaction. The real DB integration test runs unclaimed
follow -> pending claim -> reviewed conversion -> shared post -> one follower
inbox item -> revoked publishing denial. Browser tests exercise failed save,
unchanged retry identity and opening that update in post/comments navigation.
Creator notifications here are **Activity inbox items**. Device push/email are
not implemented by the shared package and are not claimed as completed.

## Final verification

Final source: 7,425 aggregate tests passed, zero failed/cancelled, one existing
Windows file-link skip (7,426 total). All 16 browser cases passed. Syntax passed
for 968 Node files; architecture, Render blueprint and dependency audit passed
(zero vulnerabilities). Web export passed at 511.2/512 KiB initial gzip and iOS
export passed. The indexed repository-privacy check also passed all three tests.
Artifact hashes and commands are recorded in the delivery receipt. Coverage:

- Focused venue/creator API tests: 35 passing, including consent migration,
  own export/deletion, audit rollback, both session stores, conflicting roles,
  held/removed target revocation, 125 approved claims and older revocation,
  owner-null canonical provisioning and actual shared publication/notices.
- Full hermetic aggregate uses `npm run test -- --test-concurrency=4`; no policy
  or bundle allowances were increased. The first restricted npm audit could not
  reach the advisory endpoint; the authorized read-only retry passed.
- Exported web acceptance: venue community 6 cases, venue completion 2 cases,
  creator composer regression 2 cases, Discover venues 6 cases. Mobile widths
  include 320/375 and desktop 1280. Cover empty/error/retry states, country/city
  changes, repeated navigation/actions, consent, admin approval/revocation,
  pagination, fan/venue/artist/guest states, alert opt-out, and composer retry.
- Screenshots of the actual exported app were inspected: venue operator page,
  pending/request-history view, mobile staff queue and desktop composer error.
  Tests use isolated synthetic accounts/responses/media; none is claimed as a
  real venue upload. No real provider API, account, message or push was used.

No physical iPhone/native interaction test was performed. The iOS export is a
build check, not device acceptance. No production schema migration was run.

## Integration boundaries and copy surfaces

The rating package `c041ca6db8bcfd1c3a662c154dbb4eb21be79179` remains a separate
candidate. Its authoritative profile statistics, independent overall-show score
and canonical/name-key reconciliation still require the parent integration step
documented in the initial venue review. This extension does not change scoring
formulas, media recovery, Store or ShowScreen. Do not average a fetched review
page or lose the initial venue audience/report/block protections when combining
the score projections. No after-show recommendation contract was changed.

Feature overlaps with creator/event integration: `App.js`, `server/api.js`,
`server/features/creatorPosts/creatorPostRoutes.js`, account export, backup row
floors, `AdminScreen.jsx`, `ArtistScreen.jsx`, `ArtistHubScreen.jsx`, and the new
shared lazy screen wrapper. Keep both event and venue schema/routes/exports/backup
tables; add event review UI alongside venue review UI. The shared event key
contract and ShowScreen need no venue-side edits.

New/changed venue UI copy lives in `src/features/venueCommunity/`:
`VenueCommunityPanel.jsx`, `VenueClaimsPanel.jsx`, `VenueClaimHistory.jsx`,
`VenueCreatorSection.jsx`, `VenueCommunityControls.jsx`, and the lazy wrapper
`src/screens/CreatorPostsSection.jsx`. API copy changes are in venue
`accountPolicy.js` and `routes.js`, plus shared `creatorPostRoutes.js`. The
creator dependency's wider copy file list is in its own integration document.
The delivery manifests list every touched file separately for dependency assembly
and venue completion, so the copy audit can preserve feature behavior.
