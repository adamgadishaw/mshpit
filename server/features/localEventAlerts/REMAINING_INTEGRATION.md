# Remaining notification integration

This is a concrete integration checklist, not a claim that the app is wired or
device push has shipped. It targets the isolated Build 12 source and must be
rebased against the integration owner's latest app changes. No shared app file,
dependency lockfile, credential, deployment, phone or tablet was changed here.

## Authentication and lifecycle

- Mount one controller at the existing account/auth-epoch boundary. Keep
  `setAccount` synchronous. Before replacing a signed-in identity through login
  or switch, await `prepareAccountChange()` while the API still authorizes the
  outgoing account. If preparation fails, do not issue the credential-changing
  request; expose retry/cancel through the current feedback components. After a
  failed/abandoned auth transition, call `cancelAccountChange()`; this allows a
  later explicit enable without silently restoring push.
- Relevant caller: `src/store.js` `performAuthentication`/`switchLinkedAccount` and
  login paths, composed through the existing `authTransitions`. Do not add a
  second auth queue or bypass `expectedAccountId`. Scope the preflight to a real
  outgoing signed-in account; guest startup must not call an authenticated revoke.
- Logout must keep its immediate local privacy reset and the existing durable
  `authTransitions.signOut()/reconcile()` retry behavior. Actual server session
  deletion fences late registration via fresh session authorization and removes
  the active registration through FK cascade. Offline logout remains pending
  remotely; neither a local setter nor aborting HTTP proves remote revocation.
- Deploy schema, controller and generation-aware revoke protocol together. The
  retained installation security receipt and its anonymization must be included
  in backup/restore, schema inventory, erasure and privacy-journal coverage.

## Existing inbox

- Change `server/features/notifications/notificationRoutes.js`, whose `VISIBLE_SQL`
  governs list rows, unread counts and scoped acknowledgements. Add the local
  notice policy to all three before pagination/LIMIT. Filtering only returned
  rows is insufficient.
- A local owned notice is associated through
  `local_event_alerts.notification_id=n.id AND owns_notice=1`. Require the matching
  account and committed state plus fresh canonical event/artist/follow/visibility
  policy. Sales additionally require the current canonical home city. Global tour
  announcements must work with a remote, missing or ambiguous home city.
- A reused creator notice has `owns_notice=0`. Preserve its existing independent
  creator-notice visibility/lifecycle; cancellation of a local reminder must not
  erase or improperly hide that creator notice.
- Return `alertId`, canonical `eventId` and kind from the associated local alert.
  Add `artist_tour_date` and `local_ticket_sale` to the existing Updates filter in
  `src/screens/NotificationsScreen.jsx`. Taps must call the authenticated target
  API and use the existing canonical event navigation, including unavailable state.
- Associate/exclude exact imported-event announcements in
  `server/features/artistUpdates/artistUpdatesService.js` before mounting both
  scanners. The creator-calendar association exists; generic artist-news dedup
  remains open. Do not suppress all artist-wide announcements by home city.
- Verify mixed pages with hidden notices before and after the cursor, unread
  counts, scoped read retries, creator-notice reuse, follow/mute/hold changes,
  missing/deleted events, and account switching. The isolated tests do not cover
  this currently unmounted notification query.

## Settings and native account lifecycle

- Add a lazy section to the actual `src/screens/SettingsScreen.jsx` components.
  Suggested labels: "Tour dates" / "New shows from artists you follow" and
  "Tickets on sale" / "In your home city". Give each inbox and device channels.
  Defaults remain datesInbox=true, salesInbox=true, datesPush=false, salesPush=false.
- Use `createLocalAlertApi` for reading/writing the complete four-boolean preference
  object. Bind reads and commands to current account identity, cancel stale work,
  and display errors through the existing LoadState/command-result conventions.
- Device preference and OS permission are separate. Use an explicit "Enable device
  notifications" action. Do not prompt at construction/startup or auto-opt a new
  account into push. Report missing native configuration and denied permission
  honestly. Missing home city should lead to the existing location picker only
  for ticket-sale alerts; it must not disable global tour announcements.
- Forward notification response listeners and cold-start responses to
  `openResponse` after account recovery. Validate installation/account/generation;
  use a canonical tour-date ID, never a raw provider URL or concert archive key.
- Foreground/token refresh may call `enableDevice({requestPermission:false})`
  only for an explicitly enabled current account. Gate refresh while auth is
  transitioning. Call preparation before switching and keep failed revocation
  visible; no optimistic "disabled" confirmation on network failure.

## Trusted ingestion and scheduler

- Compose the schema, route factories and policy injections in `server/db.js` and
  `server/api.js` as described in INTEGRATION.md. The public event reader must be
  `publicDocumentRepository.readEvent({id,at})?.event`, not raw tour_dates.
- In trusted Ticketmaster ingestion (`server/tourdates.js`), persist canonical
  `sales.public` evidence using `recordTicketmasterSale` inside the row-write
  transaction. Missing evidence is a tombstone. Use provider identity and explicit
  public start/end timestamps; never infer a sale time from presales or doors.
- Reconcile creator calendar events after actual publication and on edits/removal,
  within the publication transaction. Scheduled rows remain private. Do not grant
  claimed venue/event accounts authority to overwrite provider calendar records.
- Follow, favourite, fan-club, home-city and artist-level opt-out commands must
  queue `requestAccountScan(accountId)` within their mutations.
- Add an opt-in runtime through `server/index.js` `startBackgroundRuntime` and the
  existing `additionalSchedulers`/shutdown ownership. Use
  `server/backgroundJobCoordinator.js`; no independent overlapping timer.
- Each tick must bound the outer event/account selections as well as inner work:
  (1) observations with reconcile_complete=0 -> reconcileEvent with a page limit;
  (2) reconcile_complete=1 and scan_complete=0 -> planEventPage;
  (3) local_alert_account_scans -> planAccountSalesPage;
  (4) cancelPendingPushPage; (5) deliverDue; (6) explicitly enabled push worker.
  A page returning more=true remains pending for a later bounded tick. Persist a
  fair outer cursor so one large event cannot starve all other events/accounts.
- Initial rollout catalogue observations use baseline=true, so existing shows
  do not generate a historical announcement flood. Persist baseline/catalogue
  progress. Sale planning may still schedule reliable future sales.
- Keep cancellation cleanup running even when actual push transport is disabled.
  Stop scheduling before shutdown, await the current tick and worker.stop(), then
  close the database. Record bounded counts/failures without device tokens or
  installation secrets. Add restart, fairness, shutdown and disabled-runtime tests.

## Native capability and launch evidence

- This checkout's tracked package/config has no expo-notifications plugin/package
  or EAS project ID. Add SDK 57-compatible dependencies through Expo's installer
  in an owned integration dependency tree, not this checkout's shared node_modules
  junction. Supply SecureStore and a native CSPRNG to the existing adapters.
- Configure the real project ID, native plugin/entitlements and Android channel;
  build a new native binary. APNs/FCM/project readiness was not inspected. Do not
  enable production transport until those capabilities and delivery authorization
  are verified. The server worker remains disabled by default.
- app.json declares supportsTablet=false. Review intended tablet support and
  native layout/capability; this does not prove compatibility-mode delivery is
  impossible. No phone/tablet installation or OS prompt was exercised here.
- Verify foreground/background/cold-start taps, denied/revoked OS permission,
  token rotation, A -> B -> guest, offline sign-out recovery, real ticket and
  receipt behavior using dedicated authorized test accounts/devices. Provider
  acceptance is not proof that the person saw a notification.
- Run final combined aggregate, syntax/architecture, privacy/backup and browser
  gates, plus native tests and a fresh web startup bundle measurement after
  wiring. The earlier tiny startup headroom is not a budget result for a newly
  mounted feature; keep settings and native dependencies out of web startup.

Reference documentation already inspected: Expo SDK 57 notifications and secure
native composition, Expo push sending/receipts, and Ticketmaster Discovery v2
public-sale fields. No live push, credential edit or production deployment is
part of this handoff.
