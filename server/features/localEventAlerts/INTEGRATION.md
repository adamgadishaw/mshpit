# Tour announcements and local ticket sales: isolated implementation

Status: **not mounted; not launch complete**. These new modules and their synthetic
tests are based on installed Build 12 commit
`f37660aeba440b8112dc4c70a39a70ef80120bba`. Existing application files have not been
changed. No production data, live device token, push delivery, credentials,
deployment, phone installation, or remote Git publication was used.

Shared-file edits were held because coordination with integration task
`01a192c2-1da6-7237-8909-ab10556a40d5` was required before making them. The tool's
automatic approval review rejected that message: explicit human authorization
to message the separate task was missing. The message did not execute. A specific
permission question is pending; no alternate channel was used to bypass it.

## Implemented independently

- An additive seven-table schema, authenticated route factory, canonical-policy
  audience adapter, durable account/event fan-out cursors, inbox delivery and
  push outbox. None starts work on import.
- Tour-date alerts for a current followed/favourited artist are global: a remote,
  unknown or missing home city does not mute them. Home-city filtering applies
  to ticket-sale alerts only, preserving Adam's clarified distinction. Existing
  artist-wide creator and generic tour announcements remain unchanged. Initial
  catalogue scans are quiet. Copy says “New show date listed” because provider
  first-seen time is not an announcement timestamp.
- Ticketmaster public-sale evidence, explicit offsets and valid dates, no
  presale/doors/status-derived times. Unknown/TBD, changed, removed, stale or
  expired evidence stops delivery. Source/event association is rechecked.
- Account changes queue a bounded scan of future sales without replaying old
  date announcements. Follow/home-city hooks still require mounting.
- Separate global tour-date/local ticket-sale inbox and push preferences. Inbox defaults on; device push
  defaults off. Existing artist-level opt-out, favourites/fan clubs, blocks,
  mutes and account visibility are evaluated through canonical identity.
- Existing creator-calendar inbox notices are reused by exact post/event
  association. No second Activity system is introduced.
- Push installation proof, unique token, session FK, compare-and-set generation,
  account transfer and revocation. Logout/session deletion cascades device
  registrations and queued deliveries. Secrets/tokens are not exported.
- A default-disabled, bounded Expo dispatcher, explicit receipt polling,
  single-flight shutdown, database send leases, bounded rate-limit retries and
  no blind resend after an ambiguous timeout/crash. Two worker instances cannot
  claim the same ready record.
- A native controller and secure-storage adapter with explicit OS permission
  request, Android channel setup, synchronous account/auth-epoch reset, retry,
  cancellation, registration confirmation and account-bound canonical event taps.
  These take native SDK dependencies by injection; no new native package was
  installed through the shared node_modules junction.

## Exact server composition contract

1. `server/db.js`: call `ensureLocalAlertSchema(db)` in the migration transaction
   before constructing the service or route factory. Include every entry of
   `LOCAL_ALERT_TABLES` in the existing schema/backup/restore coverage checks.
   The tables are `local_alert_preferences`, `local_alert_account_scans`,
   `local_event_sales`, `local_event_observations`, `local_event_alerts`,
   `local_push_installations`, and `local_push_outbox`. Foreign keys must be on.
2. `server/api.js` composition only: construct `createLocalAlertAudience` with
   the existing `fanClubArtistIdentity` function. Its actual `artist` field is
   a string. The event's public slug disambiguates durable artist keys before
   resolving legacy favourite/fan-club strings.
3. Construct `createLocalAlertService` with:
   `readPublicEvent: (id,at) => publicDocumentRepository.readEvent({id,at})?.event || null`,
   the audience function, and `findRelatedNotice: (accountId,event) =>
   creatorCalendarNoticeFor(db,accountId,event)`. Do not use an unrestricted
   `tour_dates` read or a cached public event snapshot in production.
4. Mount `localAlertRoutes`. Commands require `ctx.assertCurrentSession` from
   the existing authorized-request boundary. `sessionHashForRequest(ctx)` must
   resolve the current **server-side full-session hash**; never accept it from
   a request body or expose it in a response. Newsroom-scoped sessions do not
   authorize device registration. All GET routes are read-only and no-store.
5. Trusted Ticketmaster ingestion in `server/tourdates.js`: retain the raw
   event's `sales.public` evidence. After the existing canonical provider row
   write, call `recordTicketmasterSale(canonicalId,providerEvent,observedAt)`
   inside that transaction, followed by `reconcileEvent`. Never create a public
   client sale-time writer. Existing imported rows are baseline observations;
   genuinely new canonical rows can create date alerts. Missing public-sale
   evidence is a tombstone, not permission to retain an old sale time. Older
   observedAt responses cannot replace newer evidence.
6. Creator publication: call `reconcileEvent` only after real publication inside
   the existing calendar/post transaction. Scheduled records remain invisible.
   Edits/cancellation also reconcile; never grant event/venue owners permission
   to overwrite provider dates. The prior calendar package remains unchanged.
7. Home-city, favourite, fan-club and per-artist notification preference commands:
   call `requestAccountScan(accountId)` in their existing transaction. The service's
   own notification preference write already queues this scan.
8. Existing bounded background scheduler: drain unfinished event observations via
   `planEventPage`, then `local_alert_account_scans` via `planAccountSalesPage`,
   then `deliverDue`. Bound the outer event/account list as well as each page.
   Persist rollout-baseline and periodic catalogue cursors using the existing
   scheduler contract. Reconcile authoritative event removals/visibility changes.
   This scheduler adapter is **not yet implemented**.
9. Only after device capability, credentials and environment are verified,
   explicitly construct `createLocalPushDelivery` with `enabled:true` and
   `createExpoPushTransport({fetchImpl,...})`. Invoke bounded `run()` ticks and
   await `stop()` before database shutdown. It is disabled by default.
10. Export/delete: call `exportLocalAlerts` and `eraseLocalAlerts` in the existing
    privacy transactions. Account deletion also cascades through FKs. Backup is
    server-private: it necessarily contains delivery tokens/session hashes and
    must retain the baseline's access/encryption controls. Restoration must keep
    push disabled until environment/device eligibility has been reviewed.

## Inbox and generic-news integration still required

`deliverDue` writes existing `notifications` rows with type `artist_tour_date` or
`local_ticket_sale`; reused creator notices retain their existing type. Join the
owning `local_event_alerts` row to add alert/event target metadata. Extend
`server/features/notifications/notificationRoutes.js` so current public event,
follow and author visibility (plus home city for sales only) apply to rows, unread counts and scoped
acknowledgements **before LIMIT**. Do not filter only the displayed page after
pagination; that would leak counts and create empty pages. The current isolated
`readAlertTarget` provides a fresh tap-time guard but is not a replacement for
this inbox query policy. This shared SQL/read integration is not implemented.

The old global artist-update scanner can also emit a generic `artist_update`
for imported shows. Preserve these global announcements. It needs an exact
event-aware recipient exclusion/association
in `server/features/artistUpdates/artistUpdatesService.js`. Do not mount both paths
unchanged and claim all generic/new date duplicates are solved. Never suppress
an artist-wide tour announcement merely because some dates are outside home city.
Creator-publication
deduplication is implemented; generic-news suppression is not yet wired.

## Native and UI composition still required

- Keep new UI lazy. The frozen combined application had very little startup
  budget; new unused modules do not measure the eventual wired bundle cost.
- Add settings controls, using mshpit's existing layout/components: tour dates
  (all locations) and ticket sales (home city), each with inbox and device channels. OS permission is a
  separate explicit “Enable device notifications” action. Ambiguous/missing
  home city should point to the existing location picker for ticket-sale alerts,
  without blocking global tour announcements or guessing.
- Add `artist_tour_date`/`local_ticket_sale` to Activity's updates filter and display
  their concrete artist/show data. Extend the existing deep-link/navigation
  contract to a canonical tour-date ID. No archive key, arbitrary push URL,
  attendance, or ticket-purchase claim may be substituted.
- Add the SDK 57-compatible `expo-notifications` and secure native storage
  dependencies, config plugin, real EAS project ID and native entitlements in
  the integration branch. Do not install through this checkout's node_modules
  junction. Supply a CSPRNG identity generator and SecureStore implementation
  to `createSecureInstallationStorage`. No insecure persistence fallback exists.
- Mount one `createLocalPushController` at the account lifecycle boundary. Feed
  account ID + auth epoch synchronously. Its enable command is single-flight;
  disable supersedes an interrupted enable. Handle command results in existing
  app feedback. Register response listeners and cold-start last response through
  `openResponse` after account recovery; use the canonical event navigation.
- Refresh an already enabled device on foreground/token rotation using
  `enableDevice({requestPermission:false})`. Do not automatically opt a new
  account into push or prompt at startup. Unregister before an explicit device
  opt-out; logout also removes its server session. Surface offline revocation
  failures and rely on server logout/session revocation, not a falsely confirmed
  local-only opt-out.

These UI/native composition, listener, startup and settings changes are **not
implemented or visually/device tested** in this package.

## Capability and delivery limits

- Tracked Build 12 has no expo-notifications dependency/plugin or EAS project ID.
  A new native binary is required; JavaScript alone cannot add that capability.
  Remote APNs/FCM credentials and project configuration were not inspected or
  changed, so their readiness is unknown. App config declares supportsTablet
  false; tablet support needs an explicit product/native-build review. This does
  not mean iPad compatibility-mode notification delivery is inherently impossible.
- No real push, receipt, permission dialog, phone/tablet installation or remote
  credential call was made. All delivery tests use explicit mock transports.
- Expo send tickets and receipt success are provider acceptance evidence, not
  proof the person saw the alert. Accepted pushes cannot be recalled when an
  event changes. The outbox stops pending work and the tap guard rejects stale
  targets; lock-screen text intentionally contains no home-city/follow/account
  detail. Ambiguous delivery is terminal unknown, avoiding automatic duplicates
  at the cost of a potentially missed push. Inbox delivery remains transactional.
- Ticketmaster is the only retained sale-evidence source. Artist uploads and
  other providers cannot invent sale times. Evidence must have been refreshed
  within 24 hours when a sale is delivered, with a two-hour delivery window.
  A missing refresh can therefore suppress a reminder rather than assert a stale
  sale. Date announcements have a 24-hour delivery window.
- Sale city matching is exact to the existing curated city identity. Ambiguous bare
  names and unknown free text are ineligible for sale alerts; this is not metropolitan-radius
  matching. Canonical/provider duplicate event merging remains the catalogue's
  responsibility; delivery deduplication keys use its stable event ID.
- Fan-out is bounded per page but has not been load-tested against production
  account volumes. The audience resolver intentionally rechecks identity and
  permissions; no performance claim is inherited from earlier baseline tests.

## Primary references inspected

- https://docs.expo.dev/versions/v57.0.0/
- https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
- https://docs.expo.dev/push-notifications/sending-notifications/
- https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
