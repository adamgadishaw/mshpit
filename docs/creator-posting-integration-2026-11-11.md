# Creator posting integration — 2026-11-11

Base: `2b0151a448e8f29affb5d7e3b0052a3adc3e2cd5` (combined database/themes candidate). Work is local; no production data, remote branch, release, deployment, or real notification was changed.

## Behavior

Artist HQ opens the existing `LogScreen` composer in creator mode. Update, show-date and release fields are attached to ordinary status posts. Existing photo/video upload, durable media identity, cancellation, account-scoped drafts, background recovery and post receipt/retry machinery remain the publication path. An ordinary fan post has no creator attachment and remains unchanged.

The server requires the exact fresh `users.role` (`artist`, `venue`, or `event`), an active account, and ownership of the requested page. The broader entity-account classification is implemented by that allowed role set, not a new generic creator role. A verified badge is not required for an already legitimate artist owner. Fan/admin/other-owner clients cannot spoof the attachment. Artist identity review holds retain the existing restrictions.

A creator attachment is versioned JSON: `{version:1, entityType, entityKey, kind, title, date, location, url}`. Kinds are `update`, `show`, `release`. Title is required; show requires one valid ISO date and location; links are optional HTTPS URLs without credentials. Text and media stay optional. Title/date/release details are immutable after publication; ordinary text/media edits work without redelivery. An announcement does not insert a calendar/tour-date record. The existing Upcoming shows editor remains the scheduling path.

Creator posts follow ordinary account post visibility (`everyone`, `members`, `only_me`), block/mute and moderation rules. The existing artist-profile `feed_enabled` flag still controls earlier `artist_posts` records; it never controlled ordinary main-feed posts. HQ now distinguishes those earlier posts and explains new-post visibility. Earlier records retain read/delete support. The new page section shows the latest 30 accessible creator posts; it has real loading, retry, empty and content states. Its bounded result is not advertised as a total post count.

## UI integration contract

Use the existing app navigation action:

```js
go({
  logging: true,
  postMode: "creator",
  prefill: { creatorEntity: { entityType: "venue", entityKey, name } },
});
```

For artist accounts the composer derives the artist identity from the existing session. Venue/event callers must provide the exact canonical registry key and use the ordinary verified-mutation navigation wrapper. Display name is presentation only: the server resolves authoritative page name and ownership again. Refresh the account session after an approved role change.

Public pages may use `src/features/creatorPosts/CreatorPostsSection.jsx`:

```jsx
<CreatorPostsSection
  entityType="venue"
  entityKey={canonicalKey}
  accountId={session?.id || null}
  onOpenPost={openPost}
  onCompose={canManage ? openCreatorComposer : undefined}
  following={following}
/>
```

`following` refreshes the update preference control after the enclosing page's follow action. `onPostsLoaded` is optional and used by Artist HQ for first-post completion; it is not an authoritative total. Page workers own layout and role-aware entrypoint visibility; the backend always enforces authorization. No venue layout or event-detail file is changed here.

## Registry and claim boundary

`server/features/creatorPosts/creatorPostSchema.js` runs an idempotent immediate transaction during normal schema setup:

- `posts.creator_update TEXT NULL CHECK(...json_valid...)` stores the attachment on the existing post.
- `creator_entities(entity_type, entity_key, name, owner_id, status)`: composite primary key `(entity_type,entity_key)`, types `venue|event`, status `active|held|removed`; `owner_id` references `users(id) ON DELETE SET NULL`. Owner index `(owner_id,entity_type)`.
- `creator_follows(account_id,entity_type,entity_key,following,notify_updates,updated_at)`: composite primary key `(account_id,entity_type,entity_key)`, types `artist|venue|event`, boolean flags; account FK cascades on deletion. Follower lookup index includes entity, following, preference and account.
- Partial unique notification index `(user_id,post_id) WHERE type='creator_update'` prevents duplicate follower notices.
- Partial post entity JSON-expression index supports newest update reads.

Artists continue to use `artist_profiles.owner_id`, matching `users.artist_name`, `removed=0` and clear/approved `identity_review_status`. They must not be inserted in `creator_entities`.

Approved venue/event claims must call `setCreatorEntityOwnership` from `server/features/creatorPosts/creatorEntityOwnership.js` inside the SAME immediate transaction that verifies the current reviewer/claim, applies the trusted matching account-role transition, and records approval/revocation:

```js
setCreatorEntityOwnership(database, {
  entityType: "venue", // or event
  entityKey: canonicalKey,
  name: canonicalName,
  ownerId: approvedAccountId, // null to revoke
  expectedOwnerId: priorOwnerId, // explicit null for unclaimed
  status: "active", // held or removed to restrict
});
```

The helper refuses calls outside a transaction, a changed expected owner, invalid identifiers/status, inactive target accounts, and mismatched roles. It is an INTERNAL integration boundary, not a public grant endpoint. Claim callers remain responsible for genuine reviewed evidence and audit. There is no self-grant route in the posting commit. Registry ownership revocation immediately removes official metadata, creator-page listing eligibility and creator notices; the former owner cannot mutate or replay creator publication.

## Routes and follower behavior

- `GET /api/me/creator-entities`: authoritative pages managed by the signed-in account, private/no-store.
- `GET /api/creators/:type/:key/posts`: newest 30, reuses the existing single-post visibility/projection boundary, private/no-store.
- `GET /api/creators/:type/:key/follow`: own following and update preference, private/no-store.
- `PUT /api/creators/:type/:key/notifications`: `{notifyUpdates:boolean}` desired state. Keeps following intact.
- `PUT /api/creators/:type/:key/follow`: venue/event only, `{following:boolean,notifyUpdates:boolean}` desired state. Artist callers must continue using existing artist Follow/fan-club actions.
- Create/edit/delete remain the existing `/api/posts` routes, including expected-account headers and immutable mutation receipts.

Artist eligibility uses existing favorites and club membership. Club lookup shares `fanClubArtistIdentity` aliases and `pit_artist_identity` normalization with existing membership lookup, including public slugs and historical spellings. The new table is only artist notification preference storage, never a second artist-follow authority. Venue/event following uses its explicit row. Future preference changes affect future notifications; delivered rows are not bulk-rewritten.

`creator_update` is a separate Activity category from likes/comments/messages and automated `artist_update` news. The Updates tab contains creator updates and artist news. Deep links open the exact ordinary post, including missing/inaccessible-post behavior. Likes/comments carry post kind so the screen calls an update an update, a normal post a post, and a review a review. Digest remains local grouping, not scheduled delivery.

Notification insertion is in the SAME transaction as post/receipt/media association. Eligible recipients are active followers with updates enabled, excluding the author, blocked relationships either way, account mutes and only-me authors. Visibility is rechecked on inbox read/count/ack, including removed posts, revoked page authority and account restrictions. Unique indexing and post receipts make replay safe. A synthetic notification insertion failure rolls back the post and receipt.

**Device push/email are not implemented by this change.** Inspection found no push registration/sender/subscription or Expo Notifications dependency in the candidate. These Activity rows have no automatic device-push consumer. No external delivery was attempted. Device push needs its own opt-in transport and delivery/deduplication work before it can be called complete.

Fanout is one synchronous transactional `INSERT ... SELECT`, scanning active users and their applicable favorites/membership/pref checks. Existing `(user_id,artist)` club index is reused. This change has functional tests, not a fresh high-follower performance benchmark. Prior baseline capacity results do not establish this new fanout's latency; evaluate at expected scale before release.

## Retention and privacy

The normal SQLite backup includes both new tables and the post column; the verification source manifest adds minimum-row checks for registry and preference tables. Account export includes only the caller's creator attachment data, owned pages and own follows/preferences. Existing account erasure deletes authored posts/notices; FK deletion removes own follow rows and clears page ownership while retaining the community page identity. Migration tests cover upgrade from a database without this column, repeat execution, preserved ordinary posts and foreign-key integrity. No production migration was run.

## Validation at posting checkpoint

- Creator/backend, draft/retry, account lifecycle, artist navigation and notification-index focused run: **91 passed**.
- Existing concurrency/durability/verification fixtures rerun sequentially: **21 passed**.
- Real exported browser app, isolated APIs/media, 375 and 1280 px: **2 passed**, covering required fields, unsafe URL rejection, cancel keeping draft, close/resume, upload, failure and exact retry identity; one upload and two post attempts, no page errors.
- Artist-account browser suite: **12 passed**, synthetic writes only.
- Final web export and bundle gate: **510.7/512 KiB gzip**. Combined integration has little headroom; recheck after other workers merge.
- Architecture gate passed, no baseline exceptions increased. Node syntax passed. Render blueprint passed. Dependency audit passed with zero vulnerabilities; no dependencies changed.
- Android export passed; no physical-device session or native interaction test was performed. Final copy changes are re-exported before delivery.
- Earlier full aggregate passed **7,397**, one skipped. The later aggregate had **7,395 passed, 3 failed, 1 cancelled, 1 skipped** (7,400 total), with subprocess readiness/coordination timeouts in followAuthorizationConcurrency, persistenceDurability and verificationRecovery during concurrent builds. All 21 tests in those files passed in the bounded sequential rerun. The final alias/copy/nav changes have focused coverage; a clean final full aggregate remains for an integration window. Do not represent the last aggregate as passed.

No independent release, merge, production notification, remote PR publication or deployment was performed.

## Copy review surfaces

New: `src/features/creatorPosts/{CreatorUpdateFields,CreatorPostsSection,CreatorUpdatePreference}.jsx`, `creatorPostsApi.mjs`, `src/domain/creatorUpdate.mjs`, `creatorUpdateDraft.mjs` and server creator routes/service/ownership errors. Changed: `src/screens/{ArtistHubScreen,ArtistScreen,LogScreen,NotificationsScreen}.jsx`, `src/components/TicketStub.jsx`, `src/domain/postDelivery.mjs`. Broad copy audit should preserve the ownership, visibility and inbox-only disclosure above.
