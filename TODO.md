# Pit product backlog

This is the authoritative execution list for the 18 owner requests recovered on
2026-07-21. `CLAUDE_SESSION_RECOVERY_2026-07-21.md` preserves the original
wording; `HANDOFF.md` preserves implementation history. When another note
conflicts with this file, use this file and the current code/tests.

The owner has authorized clean structural and creative changes. That authority
does not remove the verification gates below or make the current single-server
deployment "millions ready."

## Status key and acceptance gate

- **IMPLEMENTED / VERIFY:** code exists in the current recovery batch, but it is
  not accepted until focused tests, `npm run check`, desktop and narrow-web smoke
  tests, and any provider/device-specific production checks pass.
- **PARTIAL:** a useful vertical slice exists, but a named dependency or
  end-to-end behavior remains.
- **CONFIGURATION:** the application work exists; a private dashboard, DNS, or
  production action remains.
- **FOUNDATION COMPLETE:** the recovered request is implemented and has prior
  automated/browser evidence, though normal production regression monitoring
  still applies.
- **OPEN:** investigation or implementation is still required.

Do not mark an item **ACCEPTED** because a component renders or an endpoint
exists. Record the test/device/production evidence in `HANDOFF.md` first.

## Current execution list

### 1. Sustainable YouTube lookup at large-user scale

**Status: PARTIAL; capacity controls implemented, production capacity work remains.**

Current batch adds a persistent Pacific-day budget for `search.list` (90 calls by
default, configurable), single-flight collapse for concurrent identical song
lookups, a provider circuit breaker, health/capacity reporting, and a configurable
artist-upload scan of up to 600 videos by default. Cached/pinned matches still
avoid a new search.

Acceptance criteria:

- Concurrent cold requests for the same recording produce one provider lookup,
  and restarts cannot reset the daily search allowance.
- The search cap produces an explicit, retryable capacity state; it never quietly
  substitutes an unrelated video. Alerts show usage, circuit state, cache hit
  rate, fallback rate, and correct-video report rate.
- Load tests model cold artists, hot songs, and a provider outage. A documented
  stale-cache/pinned-result path continues to play known-good tracks.
- Before a large launch, move catalogue warming/refresh into durable workers,
  maintain a first-class artist/channel identity mapping, and obtain/plan provider
  quota or licensed-catalogue capacity. Do not shard API keys to evade limits.

Important correction: YouTube's current documentation gives `search.list` a
separate default allocation of 100 calls per day, with one search allocation per
call. This is distinct from the normal 10,000-unit Data API quota. IFrame player
playback does not consume Data API search capacity. Older handoff math saying a
search costs 100 quota units and permits about 99 songs/day is obsolete.

### 2. Trustworthy artist genre authority

**Status: OPEN / design decision required; Spotify must not be the sole authority.**

Spotify artist genre data is deprecated or may be empty in current API responses,
so the recovered request cannot safely be implemented as "always use Spotify."
The current client now prefers a live/provider genre over bundled fallback data,
but no durable multi-provider authority model exists.

Acceptance criteria:

- Add provider identities and a provenance/confidence record for every genre
  assignment. Use a documented hierarchy (staff override, reliable provider
  evidence, consensus/fallback) rather than a display-name join.
- Empty/deprecated Spotify fields never erase a valid classification. Conflicts
  are observable and staff-correctable; changes are auditable.
- Fixture and production checks cover mainstream, multi-genre, same-name, and
  sparse artists, including the historically incorrect examples.

### 3. Account-scoped theme persistence

**Status: IMPLEMENTED / VERIFY.**

Theme storage is now tagged with its owning account, synchronized from the signed-
in profile, and cleared on logout so one account's choice does not become another
account's anonymous/device default.

Acceptance criteria:

- On one browser: choose a theme as account A, log out, sign in as account B, and
  verify no flash or leak from A; B's server-backed choice then hydrates.
- Logout, expired sessions, account deletion, and anonymous launch return to the
  intended default without interrupting playback during an in-session switch.

### 4. Resend password-reset email

**Status: CONFIGURATION; code/runbook ready, production delivery unverified.**

`RESEND_SETUP.md` is the authoritative setup and acceptance runbook. The mailer
now supplies an idempotency key and a descriptive user agent. Reset tokens, reset
URLs, and recipient addresses are never logged as a fallback.

Acceptance criteria:

- Rotate the previously exposed key, verify `mail.mshpit.com` (or deliberately
  choose the root domain), and set matching `RESEND_API_KEY`, `MAIL_FROM`, and
  `PUBLIC_ORIGIN` values on Render.
- `/api/health` reports `mailConfigured: true`, then an end-to-end reset reaches
  two inbox providers, expires after one hour, is single-use, and revokes old
  sessions. Resend/server logs must contain no reset secret.

### 5. Start a conversation from Messages

**Status: IMPLEMENTED / VERIFY; realtime remains polling plus cursor catch-up.**

Inbox now has a New message flow with member search and thread creation/opening.
Thread summaries fetch only the newest message and refresh periodically; summary
ordering uses latest message time rather than message count. Open DMs and group
chats retain cursor-based catch-up.

Acceptance criteria:

- Start a first conversation and reopen an existing one from Messages on desktop
  and phone; blocked/private/deleted members cannot be bypassed.
- New messages update inbox order/preview and the open one-to-one or group thread
  without a manual page refresh. Reconnect fills any gap exactly once.
- Before high scale, replace short polling with managed realtime fan-out while
  retaining cursors as the recovery source of truth.

### 6. Less repetitive autoplay

**Status: IMPLEMENTED / VERIFY; server-scale recommendations remain future work.**

Autoplay now mixes taste-matched and discovery artists, defers recently played
tracks/artists, round-robins artists before taking a second song, and rotates the
candidate start between sessions. Exact history identity no longer uses a play-
event ID as the track ID.

Acceptance criteria:

- Repeated sessions over representative accounts do not begin with the same
  short sequence, recently played tracks are deferred, and one prolific artist
  cannot dominate the queue.
- Exact recordings/video IDs survive history replay. Empty/sparse accounts get a
  useful, truthful fallback.
- Move candidate generation to a paged/server recommendation service before the
  catalogue and user graph are too large to hydrate on the client.

### 7. Reduce preview-only playback

**Status: PARTIAL; lookup amplification reduced, production sampling required.**

The larger official-channel catalogue scan, persistent search budget, shared
cold lookups, preserved exact history IDs, and explicit capacity diagnostics
reduce avoidable preview fallbacks. Deezer preview remains the honest fallback
when no acceptable YouTube recording is available.

Acceptance criteria:

- On a documented sample of deep catalogues, record official-video, preview,
  missing, and rejected-wrong-version rates before/after deployment.
- Quota/provider failures show a useful themed diagnostic and never masquerade
  as "song missing." Known pinned/cache results remain usable during an outage.
- A preview is labeled as such and must never auto-upgrade to a low-confidence
  lyric, karaoke, reaction, live, or wrong-artist video.

### 8. Replies to comments

**Status: IMPLEMENTED / VERIFY.**

Post detail and Afterparty comments now support replies. Server reads preserve a
bounded ancestor chain, enforce post/block visibility, and return deleted-parent
tombstones so valid child replies do not become orphaned.

Acceptance criteria:

- Reply, refresh, and render a three-level thread on both surfaces; indentation is
  bounded on a narrow phone.
- Deleted ancestors remain a neutral tombstone only while children exist.
  Blocked/private/removed content cannot leak through ancestor hydration.

### 9. Hide Clips while retaining its framework

**Status: IMPLEMENTED / VERIFY.**

Clips navigation and persisted deep-route restoration are gated off through
`ENABLE_CLIPS=false`; implementation files remain available for a future launch.

Acceptance criteria:

- Clips has no visible entry point on desktop or phone, and a saved/reloaded
  `nav.clips` state safely returns to the base route.
- Re-enabling the flag restores the feature without a data migration or rebuild
  of the underlying framework.

### 10. Venue and artist preselection

**Status: PARTIAL.**

Concert logging now searches venue entities, fills the canonical venue/city, and
requires an artist, venue, and rating instead of saving fake unknown placeholders.
Artist selection still relies too heavily on a name rather than a stable provider
identity.

Acceptance criteria:

- Artist and venue suggestions display disambiguating evidence and store stable
  Pit/provider IDs; free text cannot silently bind to the wrong entity.
- Editing/restoring a draft preserves the chosen entity. Missing venues support
  an explicit, moderated suggestion flow rather than a fabricated placeholder.
- Same-name artist and same-name venue fixtures round-trip through create/edit/
  feed/detail with the correct canonical entity.

### 11. General YouTube attachments in posts

**Status: IMPLEMENTED / VERIFY.**

The composer and feed language now treat the existing backward-compatible `song`
payload as a general YouTube music attachment: song, review, breakdown, lesson,
or performance. Server-owned thumbnails are derived from the validated video ID,
not an arbitrary client URL.

Acceptance criteria:

- Supported watch, short, and Shorts links preview and publish on regular and
  concert posts; invalid hosts/IDs are rejected with themed errors.
- Clicking the card uses the exact validated video ID in the one visible Pit
  player, with compliant sizing/controls and no competing hidden audio engine.
- Create, edit, replace, remove, deleted/unavailable video, and mobile rendering
  have regression coverage. A future schema migration may rename `song` only
  with backward-compatible reads.

### 12. Playback/wrong-song reports and admin correction

**Status: IMPLEMENTED / VERIFY.**

Reports now distinguish wrong video, will not play, preview only, missing, and
other; a user may suggest a YouTube replacement. Admin triage can search candidate
videos and pin the validated link through the existing override path.

Acceptance criteria:

- Duplicate reports are bounded, invalid categories/links fail safely, and
  ordinary users cannot pin or overwrite a resolution.
- Admin correction is audited, immediately invalidates the bad cache, and all
  subsequent clients receive the exact approved ID. Rejection/undo is possible.
- Reporting works from every player surface and includes enough non-sensitive
  context to reproduce the failure.

### 13. Mobile player controls and navigation

**Status: IMPLEMENTED / VERIFY on physical devices.**

The compact bar now exposes large play/menu targets and opens a mobile sheet with
artwork, scrubber, transport, save/video/stop actions, queue controls, and recent
history. Desktop keeps its existing column layout.

Acceptance criteria:

- Test narrow web plus real iOS/Android: targets are at least 44 points, safe
  areas/keyboard/orientation do not cover controls, and opening/closing the sheet
  does not stop or duplicate playback.
- Scrub, previous/next, queue removal, replay history, video toggle, minimize, and
  stop all preserve correct state and accessibility labels.

### 14. Delete one's own comments

**Status: IMPLEMENTED / VERIFY.**

An author-only, idempotent delete endpoint is wired to post and Afterparty UI.
Leaf comments disappear; parents with replies become tombstones.

Acceptance criteria:

- The owner can delete on both surfaces; a second user and signed-out request get
  no existence/authorization bypass. Repeat delete is harmless.
- Counts, pagination, notifications, replies, and reload reconcile to server
  state without exposing removed text.

### 15. Privacy-safe site analytics and per-user admin inspection

**Status: PARTIAL / IMPLEMENTED FOR REVIEW.**

The current batch adds a dedicated admin Analytics area, growth/activity/product
aggregates, k-thresholded search/post keyword trends, and admin-only member
inspection. Collection is restricted to allow-listed events/properties for
consenting signed-in accounts; raw analytics IPs are purged/not stored, search
values that look like emails, handles, or URLs are discarded, and default event
retention is 180 days. An account opt-out and historical-event deletion path is
being completed in this batch.

Acceptance criteria:

- Consent/opt-out behavior is explicit and tested; opt-out deletes the account's
  product-event rows and prevents new collection. Guests are not silently
  profiled. Rate-limit/security processing remains separate from analytics.
- Only admins can inspect a user. Search terms are never shown in per-user event
  history, and trend values appear only above the documented anonymity threshold.
- Retention pruning, export/deletion behavior, role tests, audit logs, and a legal
  review of policy copy pass before broad collection. Move high-volume analytics
  to a dedicated pipeline/warehouse; do not run unbounded scans on the primary DB.

### 16. Add four themes and repair theme consistency

**Status: IMPLEMENTED / VERIFY.**

With the owner's creative authorization, four new semantic-token themes are in
the batch: Backstage, Vinyl, Sunset, and Lavender. Existing theme persistence and
system status-bar classification were updated with them.

Acceptance criteria:

- Audit all 12 themes across core desktop/phone surfaces and every normal,
  pressed, disabled, focus, error, chart, modal, and media-overlay state.
- Automated contrast/screenshot checks cover representative light/dark themes.
  There are no hard-coded colors that make a control unreadable or invisible.
- Confirm the four creative replacements with the owner after deployment; rename
  or retune them without changing the theme storage contract if requested.

### 17. Desktop progress bar

**Status: IMPLEMENTED / VERIFY.**

The column scrubber now explicitly stretches to full available width rather than
collapsing around its thumb.

Acceptance criteria:

- At supported desktop breakpoints the full track is visible, elapsed/remaining
  labels align, clicking/dragging seeks accurately, and resize/minimize/restore
  does not collapse it back to a dot.
- Keyboard and pointer seeking remain accessible for YouTube and preview sources.

### 18. Publish playlists as feed posts

**Status: FOUNDATION COMPLETE; keep in regression suite.**

Regular posts can attach a public/unlisted owned playlist as an immutable
snapshot. The feed card shows the playlist and starts the exact stored queue; API
tests and a prior browser walkthrough cover ownership/privacy/preserve/clear
behavior.

Acceptance criteria:

- Re-run create/edit/delete/private/empty and cross-account checks after this
  batch. The tapped row starts first and exact recording/video IDs survive.
- Finish general playlist management (rename, remove, reorder, deep links, mixed
  unavailable tracks) under the wider playlist backlog; that is separate from
  this recovered sharing request.

## Cross-cutting work before "millions ready"

These are platform dependencies, not optional polish:

1. managed Postgres with pooling, online migrations, tested backups/restores, and
   read/connection capacity planning;
2. shared Redis-compatible cache/rate limits/session coordination and realtime
   pub/sub, so horizontally scaled API processes agree;
3. durable queues/workers with idempotency, retries, dead-letter handling, and
   dashboards for mail, provider ingestion, media, notifications, fan-out,
   exports, and deletion;
4. verified media finalization, derivatives/posters/transcoding, moderation, CDN
   delivery, lifecycle cleanup, and signed access where appropriate;
5. realtime DM/group/activity delivery with cursor catch-up and push notification
   fan-out;
6. dedicated search/recommendation indexes and an aggregate analytics pipeline,
   rather than large scans or catalogues in the client/API process;
7. centralized privacy-safe logs, metrics, traces, SLOs/alerts, load/soak tests,
   disaster recovery, abuse controls, and staffed incident/moderation operations;
8. documented provider contracts, quotas, cache-policy compliance, outage modes,
   and cost/capacity forecasts for YouTube, Deezer, Ticketmaster, Resend, and R2.

See `SCALING.md` for the staged technical path and `SECURITY.md` for launch gates.
