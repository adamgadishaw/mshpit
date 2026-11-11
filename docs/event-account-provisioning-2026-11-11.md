# Reviewed event and festival accounts — 2026-11-11

Incremental change after creator-posting commit `5f5fcbdbf240484108ac75dc67ebbc6cdaef27a7`. No production changes or real notifications were made. This implements event/festival access requests, reviewed provisioning, revocation, and the festival-page posting entrypoint. The event-detail worker consumes the same controls without a competing layout.

## Existing identity and account lifecycle

- Festival brands use the existing `festivals.slug`: registry key `festival:<slug>`.
- Individual event pages use the existing public `tour_dates.id`: registry key `event:<id>`. The target reader calls `createPublicDocumentRepository(...).readEvent`, retaining its published/music/account/provider visibility policy. The analytics `events` table is unrelated and is not used. Event IDs retain the existing public-snapshot bound of 180 characters; festival slugs retain the public route’s 80-character lowercase slug format.
- Both have `creator_entities.entity_type='event'` and require `users.role='event'` for posting. No new catalog or generic creator role is created.
- An active, email-confirmed **fan or event account** can request access. A request grants nothing and never changes role/ownership.
- Approval is a deliberate fan-to-event account conversion, or another page assignment to an existing event account. Existing artist, venue, editor, moderator and admin accounts cannot request or be converted by approval. The target's role is checked again at approval, including changes made while a request waited.
- The form explicitly says to use a dedicated event/festival account and explains that approval changes its classification and signs it out. Sign in again after approval to get a fresh session. There is no separate event login or public self-grant.
- Approval records `role='event'`, `verified=1`, registry ownership and claim/audit state in one immediate transaction, then invalidates that account's sessions. Fresh posting authorization remains server-owned.
- Revocation clears only that page's ownership and invalidates the affected account's sessions. It retains `event` classification while any other event registry page is owned, including held pages. When none remain it returns an event account to `fan` and clears its verified flag. It does not alter unrelated artist/venue/staff roles.
- Revocation preserves the page's prior `active|held|removed` moderation status. It cannot reopen a held or removed page for a new claim. Lifting moderation restrictions is a separate trusted operation.

## Trusted review boundary

The implementation reuses `requireAdmin`, `manualIdentityReviewEvidence`, `verificationReviewReason`, `recordModerationAction` and the shared immediate-transaction helper. Only a current active administrator can approve, reject or revoke. A moderator is insufficient. Reviewer and applicant state are reread after acquiring the writer lock; session checks are repeated inside it. Self-review is rejected.

Manual approval requires a public HTTPS evidence link, a reason, `officialAccountConfirmed:true` and `ownershipConfirmed:true`. These attest to the administrator directly checking the established official organization and claimant's authority. A supplied URL/name is not automatic proof; no external URL is fetched and no new automated verification method is invented.

Approval requires `expectedOwnerId:null` and an unclaimed, unrestricted registry target. It calls `setCreatorEntityOwnership` only after the approved matching role transition, in the same transaction. Two competing approvals cannot overwrite each other. Lost-response replay of a still-current approved request returns its existing result without another audit or grant; a revoked/reassigned request cannot restore authority.

Revocation requires `confirmed:true`, the current `expectedOwnerId`, and a reason. Replaying a completed revocation cannot clear a later owner's assignment. Audit failures roll back role, registry, claim and session changes together.

The venue coordinator can reuse this lifecycle pattern for its separate venue review route: keep evidence review, fresh applicant/reviewer checks, matching role transition, expected-owner helper call, session invalidation and audit in one transaction. Do not copy or replace the creator registry/helper with older prerequisite snapshots. Venue canonical keys remain that worker's `snapshot.path`; this change does not alter venue provisioning or layout.

## Control integration

Public composition wrapper: `src/screens/EventAccountPanel.jsx`.

```jsx
<EventAccountPanel
  targetKind="event" // or festival
  targetId={publicEvent.id} // festivals use festival.slug, never an edition ID
  accountId={session?.id || null}
  onRequireAuth={openSignIn}
  onOpenPost={openPost}
  onCompose={entity => requireVerifiedMutation("post", () => go({
    logging: true,
    postMode: "creator",
    prefill: { creatorEntity: entity },
  }))}
/>
```

`onOpenPost` receives an ordinary post object. `onCompose` receives the authoritative `{entityType:'event',entityKey,name,targetKind,targetId}` returned by the server. Load this wrapper lazily with the existing `lazyWithRetry` helper. It composes separate feature slices; do not import creator-post internals from another feature slice.

The wrapper displays the access request, own pending/reviewed status, and for a claimed page the existing creator-post section, follow/unfollow, update preference and owner posting controls. Following preserves the saved notification preference. Unclaimed event/festival pages cannot yet be followed through the creator registry; the control offers access requests until a genuine owner is approved. Existing festival going plans are untouched and are not treated as ownership or update subscriptions.

`FestivalScreen` has one optional `renderEventAccount(props)` composition slot, wired in `App.js`. `ShowScreen.jsx` is untouched; the event-detail owner adds the wrapper using the validated public event ID. Do not derive the ID from the show-review aggregation key or an artist name. Archive aggregates are not automatically claimable: `publicEventCandidateId(log)` rejects `archiveShowKey` records and review posts. Use a fresh `readablePublicEventSnapshot(...).id`, not an archive/concert key or an assumed provider ID. `renderUpdates` is internal to the wrapper, not a caller requirement. The admin screen lazily mounts `EventClaimReviewPanel` inside its Requests tab for administrators.

## Routes and pagination

All viewer/staff reads are private/no-store. Writes use the standard expected-account request boundary.

- `GET /api/event-accounts/target?kind=event|festival&id=...`: canonical entity, claimed/canManage/canRequest booleans, own follow preference and own latest claim only. Guests receive no claim evidence.
- `POST /api/event-accounts/claims`: `{kind,id,note}`. Note includes role and official verification contact; an existing pending request for this account/page is reused on retry.
- `GET /api/admin/event-claims?status=pending|approved&limit=50&before=<cursor>`: default pending, maximum 100 rows, existing opaque cursor contract and `nextCursor`. Status filtering occurs before the page limit. The UI exposes separate Pending requests / Approved pages tabs and next/previous controls so older owners remain reachable.
- `POST /api/admin/event-claims/:id/approve`: `{reason,reviewedUrl,officialAccountConfirmed:true,ownershipConfirmed:true,expectedOwnerId:null}`.
- `POST /api/admin/event-claims/:id/reject`: `{reason}`.
- `POST /api/admin/event-claims/:id/revoke`: `{reason,confirmed:true,expectedOwnerId:<accountId>}`.

A route for manual claims does not itself verify ownership. Staff must perform the existing documented evidence checks before using approval.

## Persistence, privacy and rollout

`event_account_claims` stores ID, claimant FK, existing target kind/ID, registry key, note, status, creation/review timestamps, reviewer FK, review reason and reviewed URL. Claimant deletion cascades; reviewer deletion nulls attribution. A partial unique `(account_id,entity_key)` index prevents duplicate pending claims. Status/time/ID and account/time/ID indexes support bounded review and own history. Schema installation is repeatable and uses an immediate transaction.

Backup source manifests include the table's minimum row count. The authenticated account export adds only the caller's claims under `creatorAccount.eventClaims`. Authenticated erasure removes those claims through the account FK; existing registry deletion behavior clears ownership. Private proof is not added to public profiles or creator posts. No schema changes were run against production.

## Validation and remaining integration work

- Scoped regression run: **119 passed**. The final canonical-ID-bound adjustment additionally passed **24 focused tests** and its Node syntax check. It includes event/creator routes, existing API integrity, festival readers/navigation and native festival-layout tests.
- Coverage includes no authority while pending, role conflicts at request and approval, genuine evidence requirements, fresh/revoked reviewers, actual independent SQLite approval contention, exactly one owner, retry safety, audit rollback, multiple owned pages, held/removed current-page revocation, and paginating to/revoking the oldest owner beyond 100 approvals.
- Account export/erasure tests call the actual password-confirmed routes with synthetic accounts. Schema repeatability, backup manifests and foreign-key integrity pass.
- Browser acceptance uses the real exported app with isolated fixtures, at 375 and 1280 px: claim/cancel/failure/retry, approved event-owner composer/publication, and administrator evidence gating/failure/retry/approved-page controls. Six scenarios pass. No live approval, post or notification occurs.
- Web export/budget: **511.3/512 KiB gzip**. Architecture passes without new baseline exceptions. Full Node syntax (966 files) and Android export pass on the final pagination source. No physical phone interaction was run.
- The final full aggregate is still pending an integration window. Earlier aggregate pass and later contention timeout results are recorded in the posting handoff; the scoped regressions do not turn that last full aggregate into a pass.
- Device push remains unimplemented; Activity inbox delivery is the creator-post contract. This provisioning change sends no approval email/push.
- Individual event-detail placement and venue provisioning belong to the parallel workers. The standalone bundle has less than 1 KiB headroom; the combined branch must recheck and, if necessary, reduce startup code before release. No capacity benchmark for creator fanout or large claim review workloads is claimed.

New UI copy lives in `src/features/eventAccounts/{EventAccountPanel,EventClaimReviewPanel}.jsx` and `eventAccountApi.mjs`; server validation copy is in `server/features/eventAccounts`. Existing festival and admin layouts receive only their composition slots.
