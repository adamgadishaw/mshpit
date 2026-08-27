# MSHpit Product Expansion Plan

Status: implementation plan; Phase 0 plus the canonical Show read and typed attendance portion of Phase 1 are delivered, while ingestion/reconciliation and later phases stay staged
Baseline: `master` at `dcd7410`
Regression baseline: 1,996 passing tests; current delivered foundation: 2,048 passing tests
Scope: Product Expansion & Fine-Tuning Specification sections 1–38

## 1. North star

MSHpit is the social layer around live music: people discover a show, attend it, record what happened, interact with the people and music connected to that night, and discover what to experience next.

The core loop is:

> Discover show → Attend show → Check in/log attendance → Rate/review → Post media or a memory → Interact with other attendees → Follow people, artists, venues, or tours → Discover another show

The product should optimize for healthy completion and repetition of that loop, not raw screen time. A useful north-star measure is the number of members who complete a meaningful show loop in a rolling period: they connect to a real show, contribute or interact, and return to another show-related action.

### Product principles

1. **The exact show is the center of the graph.** A specific performance at a venue on a date is where people, artists, tours, venues, posts, ratings, attendance, media, setlists, and discussions meet.
2. **The social network is the product.** Diary, archive, ticket, rating, event, venue, and artist features support social relationships around live music.
3. **Contribution should be quick by default and deep by choice.** A useful log should take seconds; a full review remains available.
4. **Visible numbers must be explainable.** Ratings, confidence labels, recommendations, compatibility, and verification signals require public rules.
5. **Privacy is part of the model.** Attendance and live-show features must never infer permission from account creation, a follow, or a historical log.
6. **Real data only.** Do not fabricate events, attendance, ratings, biographies, setlists, reviews, locations, or SEO content.
7. **Preserve mature systems.** Existing messaging, fan clubs, media, moderation, public pages, and URLs are foundations to refine, not rewrite without cause.

## 2. Non-goals

MSHpit is not primarily:

- a private concert diary;
- a ticket seller, escrow service, or payment processor;
- a professional review publication;
- an artist encyclopedia or Wikipedia replacement;
- a generic event calendar or venue directory;
- a livestreaming service;
- an engagement-bait feed;
- an SEO article farm;
- a clone of LiveRate, Concert Archives, YouTube, Facebook, or Myspace.

The expansion must not redesign the whole application, remove working functionality, expose exact real-time location, require GPS for historical logs, secretly alter public scores, or disable ordinary photo/video posting.

## 3. Baseline assessment

MSHpit already has a broad, working product. The main risk is not a lack of features; it is that related features currently identify the same concert in different ways.

### Strong foundations to keep

- A real Expo/React Native iOS, Android, and web application.
- Feed, universal search, discovery, profiles, reviews, photos/video, comments, follows, notifications, venues, artists, artist archives, tour archives, fan clubs, direct messages, reports, blocking, moderation, and public SEO pages.
- A useful separation between **You** as the private dashboard and **Public Profile** as the member identity other people see.
- Durable direct messages with inbox/request handling, idempotent delivery, account scoping, blocking, and moderation.
- Artist fan clubs with durable membership and chat. These should remain distinct from lightweight artist following.
- Block-aware attendee reads, guest-safe aggregate counts, and minimal member projections.
- Public event/concert/artist/venue documents with canonical metadata and real structured data.
- Rating aggregation that counts the latest eligible rating from a person for an exact derived night rather than blindly counting every post.
- A strong badge ledger based largely on real behavior and concert history.

### Baseline gaps that drive this plan

- There is no first-class canonical Show row.
- Upcoming events, review posts, archive concerts, Going rows, and lounges use different identities.
- Following currently filters a ranked For You pool rather than behaving as a reliably chronological following feed.
- Ordinary status posts cannot attach to an exact show; only review posts carry concert context.
- The one large composer is not a true Quick Log / Full Review choice.
- Attendance is a boolean Going row with no visibility, check-in, Here, Went, or verification semantics.
- Public Profile and You are conceptually sound but do not yet present one immediate, coherent musical identity.
- Taste match is transparent but does not yet use ratings or canonical shared shows.
- “Crossed paths” language can imply physical contact when the system only knows two people logged the same show.
- Following supports people; artist fan clubs are separate; there is no unified follow model for artists, venues, and tours.
- Notifications are durable for core social activity but lack a concert/social/community taxonomy, granular preferences, and push delivery.
- Recaps and designed share cards are missing; current memory sharing is plain text.
- Attendance, upcoming-show, historical-show, and per-concert visibility controls are missing.
- Moderation is strong for users/posts/comments/media/chat, but mute, inaccurate-event reporting, and setlist-specific reporting are missing.

### Current Show identity drift

One real concert currently has multiple identities:

1. a provider or artist-created event row and `/event/:id`;
2. a fan review post and `/post/:id`;
3. a completed archive aggregate derived from artist, venue, and date and `/concert/:archiveKey`;
4. a normalized `artist|venue|date` key used by Going and lounges.

The current Show screen adapts these shapes at runtime rather than loading one authoritative Show document. This is the blocker behind reliable Crowd, check-in, verified attendance, tours, collaborative setlists, live state, and show-linked ordinary posts.

### Foundation delivered with this plan

- Additive `shows`, namespaced aliases, performers, attendance, and verification schema with no synchronous data backfill.
- Privacy-aware Interested/Going/Here/Went server contract, desired-state idempotency, verified-account writes, bilateral block filtering, and Everyone/Following/Friends Crowd scopes.
- Member-authored show labels remain private attendance snapshots; they cannot create public-eligible Show facts or overwrite trusted provider facts.
- Here fails closed without trusted provider timing/timezone data and defaults private on a fresh live transition.
- Logged-out visitors receive no attendee identities and no distinct live Here count.
- Old endpoints and old clients retain a narrow Going-only projection; Here, Went, Interested, and narrower visibility never leak into the visibility-blind legacy table.
- The existing Show screen now presents a bounded, account-scoped Crowd with safe filters and a separate verified-attendance signal.
- A bounded, non-allocating canonical Show read resolves stable IDs and unambiguous aliases, fails closed on identity collisions, and exposes only provider-backed public Shows or the viewer's own private attendance record.
- Trusted Show lifecycles now drive Interested, Going, Here, and Went controls. Mutations use the stable Show ID, fresh Here starts private, historical Went requires no GPS, and Members/Followers/Only me remains editable even when a Show is cancelled or postponed.
- Product copy now describes a shared live-music identity/history without implying that people physically met merely because they logged the same show.
- Public sitemap concert URLs with opaque dotted identities now reach the SEO/application router instead of being mistaken for missing static files.

This is still not the completed Phase 1 rollout. Trusted provider Show ingestion, reconciliation/backfill, per-member attendance defaults, review `show_id` writes, and provider-alias lounge unification remain gated work.

## 4. Architectural decision: one canonical Show graph

### Decision

Introduce a stable canonical Show entity and make every show-related feature resolve to it.

The first schema should support:

```text
shows
  id                  stable opaque identifier
  venue identity      canonical key plus display/location snapshot
  starts_at           trusted instant when available
  local_date          calendar identity at the venue
  timezone            IANA timezone when known
  lifecycle_status    upcoming | happening | completed | cancelled | postponed
  provider_status     source status without conflating it with lifecycle
  source / timestamps

show_performers
  show_id
  artist_key
  billing_role        headliner | support | festival | guest
  billing_order

show_aliases
  show_id
  alias_type          provider event, tour-date row, legacy concert key,
                      archive key, or other durable legacy identity
  alias_value
  UNIQUE(alias_type, alias_value)

show_attendance
  show_id
  user_id
  state               interested | going | here | went
  visibility
  legacy display snapshot (private relationship data; never shared Show authority)
  created_at / updated_at / checked_in_at
  PRIMARY KEY(show_id, user_id)

posts.show_id           nullable during migration
lounge_messages.show_id nullable during migration
```

Later tables can safely add tours, follows, verified-attendance evidence, discussions, setlists, revisions, and moment/song links because they will share one Show foreign key.

### Compatibility is mandatory

- Keep `/event/:id`, `/concert/:archiveKey`, `/post/:id`, and accepted legacy `/show` links working.
- Resolve old URLs through `show_aliases`; redirect only after mappings are validated.
- Keep `GET /api/me/going`, `POST /api/going`, and `GET /api/going/:key/attendees` as compatibility adapters while old clients remain active.
- Continue accepting old review posts without `show_id`; resolve them lazily or in controlled batches.
- Never turn an ambiguous legacy artist/venue/date match into a confident merge.
- Never create an indexable public Show solely from an attendance key.
- Treat member-authored artist, venue, city, date, tour, and relation keys as private attendance snapshots. Only a trusted provider or audited staff workflow may make shared Show metadata public-eligible.
- Keep only canonical `going` in the legacy Going projection. Never flatten Here or Went into a destructive old-client toggle.

### No synchronous production backfill

The canonical-show backfill must not scan or rewrite the production catalogue during server startup.

Required rollout:

1. Deploy additive schema and indexes only.
2. Dual-read and dual-write behind a release flag.
3. Seed provider-backed events first using an idempotent cursor-batched job.
4. Resolve valid review/archive identities separately.
5. Resolve legacy attendance and lounge aliases without making them public entities.
6. Quarantine ambiguous identities and produce a reconciliation report.
7. Compare old/new counts and sampled relationships.
8. Switch reads only after the new graph is proven.

The job must resume after interruption, bound each transaction, avoid network work while holding a database lock, and record durable progress. Startup may create schema; it may not perform a full data-dependent backfill.

## 5. Attendance, Crowd, and privacy contract

Attendance is a relationship between a member and an exact Show. It is not proof of identity, ticket ownership, or physical proximity.

### Attendance states

| State | Meaning | Normal availability |
|---|---|---|
| `interested` | The member may attend or wants updates. | Before the show. |
| `going` | The member intends to attend. | Before and near show time. |
| `here` | The member intentionally checked in during a trusted event window. | Only when start/timezone data supports the window; GPS is optional and never required. |
| `went` | The member records historical attendance. | During conversion from Here or for a past show; historical logs do not require GPS. |

State changes are desired-state, idempotent writes. A member can remove the relationship. `Here` should convert to `Went` after the event window without retaining a public exact check-in timestamp. A review may suggest `Went` to the member, but it must not silently publish attendance visibility.

### Visibility

Every attendance row has a per-show visibility value and inherits a member default only when the member has not chosen an override.

| Visibility | Identity shown to |
|---|---|
| `private` | Only the member and authorized staff. Excluded from public Crowd identity and public counts. |
| `followers` | Signed-in followers of that member, subject to blocks and account restrictions. |
| `members` | Eligible verified signed-in members, subject to blocks and account restrictions. Logged-out visitors receive no identities. |

Logged-out visitors may receive a safe aggregate only; they never receive attendee identities. Real-time `Here` aggregates should require a minimum crowd threshold so a small count cannot reveal a person’s live location. Raw GPS coordinates should not be stored as attendance history; a future verifier may store only the verification outcome and coarse method.

A fresh transition to `Here` defaults to `private` unless the member explicitly chooses a broader audience. An earlier Going audience is not consent to disclose live presence.

Crowd filters mean:

- **Friends**: mutual follows only, clearly described as mutuals until MSHpit has an explicit accepted-friend relationship.
- **Following**: attendees the viewer follows.
- **Everyone**: every attendee whose visibility permits that viewer.

Filtering never overrides the attendee’s visibility. Blocking, bans, suspensions, hidden individual concerts, and private profiles take precedence. Copy must say people **attended the same show**, never that they met or physically encountered one another.

### Verified attendance is separate

Reviewing remains open to verified and unverified attendees.

Future verification belongs in a separate evidence/status model, not in `show_attendance` and not in a hidden scoring weight. Possible methods include a live optional check-in, ticket-provider import, Wallet integration, or privacy-reviewed ticket evidence.

Public display may say:

```text
4.6 ★
184 fan ratings
126 verified attendees
```

It must not silently boost verified ratings. If MSHpit later displays a verified-attendee rating, show it as a separate explicitly labelled aggregate beside the all-fan rating. Sensitive source documents must be short-lived, access controlled, excluded from ordinary media, and deleted after verification according to a written retention policy.

## 6. Ratings and public confidence rules

### Rating levels

- **Show Rating:** exact Show, one latest eligible rating per member.
- **Tour Rating:** all eligible individual ratings across Shows assigned to that Tour.
- **Artist Live Rating:** all eligible individual ratings across the Artist’s Shows.

Do not average averages. Aggregate eligible individual ratings so each person’s rating has one vote at each Show. Display raw fan averages; confidence labels communicate sample depth without secretly modifying the score.

### Confidence thresholds

The public label is the highest tier for which both rating count and, for Tour/Artist, distinct-show minimum are satisfied.

| Label | Distinct eligible ratings | Show minimum | Tour minimum | Artist minimum |
|---|---:|---:|---:|---:|
| New | 1–4 | 1 | 1 | 1 |
| Early Signal | 5–24 | 1 | 2 | 2 |
| Established | 25–99 | 1 | 3 | 5 |
| Crowd Proven | 100+ | 1 | 5 | 10 |

Examples:

- A Show with 3 ratings is **New**.
- A Tour with 40 ratings from only 2 Shows remains **Early Signal** until a third Show is represented.
- An Artist with 150 ratings across 7 Shows is **Established** until 10 Shows are represented.

Zero valid ratings must render **No live rating yet**, never `0.0/5`. Thresholds and eligibility rules must be available from rating UI and public help/legal documentation.

### Rating integrity and recent form

- Keep five stars as the primary rating.
- Ask “Would you see them again?” separately as Yes / Maybe / No.
- Keep secondary Performance, Energy, Vocals/Musicianship, Production, and Crowd Interaction optional.
- Show all-time, trailing 12 months, and current-tour form only after the relevant confidence minimum is met.
- Keep suspicious contributions pending or ineligible through documented rules and an audit trail; do not rewrite the public score by hand.
- Ranking formulas may use confidence for ordering, but must identify the method. The currently derived Top Nights confidence/depth ranking should be documented before it is expanded.

## 7. Keep / refine / build matrix

| # | Specification area | Decision | Planned treatment |
|---:|---|---|---|
| 1 | Core vision | **Keep** | Make every release demonstrate which part of the live-show social loop it strengthens. |
| 2 | People, Shows, Music | **Refine** | Keep People/Music systems; make canonical Shows the typed bridge between them. |
| 3 | Show page as primary page | **Build on existing** | Preserve current ticket, rating, Crowd preview, lounge, reviews, media, artist/venue links, and setlist display; replace polymorphic input with one bounded Show document and phased before/during/after actions. |
| 4 | The Crowd | **Build** | Add privacy-aware states, filters, pagination, and safe attendee discovery on canonical Shows. |
| 5 | Check-in | **Build** | Add Interested/Going/Here/Went with optional live confidence and no GPS requirement for history. |
| 6 | Verified attendance | **Defer until foundation, then build separately** | Add explicit verification status/evidence after privacy and retention review; never gate reviews or hide score weighting. |
| 7 | Simple improved ratings | **Refine** | Lead with one five-star live rating and See Again; progressively disclose optional factors. |
| 8 | Rating confidence | **Build** | Publish the thresholds in this plan and calculate from distinct eligible raters/shows. |
| 9 | Three rating levels | **Refine/build** | Keep current derived Show/Tour/Artist aggregates, migrate them to Show/Tour identities, and test one-vote-per-member rules. |
| 10 | Recent form | **Build later** | Add all-time, 12-month, and current-tour views only at confidence minimums. |
| 11 | Tour pages | **Refine** | Preserve Tour Archive UX; introduce persistent Tours, show membership, upcoming/completed dates, attendees, media, cities, and setlist trends. |
| 12 | Venue social pages | **Refine** | Preserve venue scores, reviews, photos, upcoming/history, and pagination; add following, attendance, structured dimensions, and practical tips. |
| 13 | Social feed | **Refine** | Make Following genuinely chronological, retain For You, and introduce Shows after canonical relationships exist. Do not rank primarily for engagement. |
| 14 | Concert-aware posts | **Build on reviews** | Add nullable show/tour/venue/artist attachments to ordinary posts; one post can then project into feed, profile, Show, Artist, Venue, and Tour surfaces. |
| 15 | Concert memories | **Refine** | Convert the existing anniversary/rediscovery data into an optional social memory composer and designed share format. |
| 16 | Quick Log / Full Review | **Build** | Provide a 10–20 second Quick Log and an optional expanded review, both using one validated underlying contract. |
| 17 | Musical-identity profiles | **Refine** | Preserve private You vs Public Profile; make public identity immediately show volunteered taste, concert stats, posts, reviews, media, and upcoming visibility according to privacy. |
| 18 | Musical compatibility | **Refine** | Keep transparent taste match; add canonical shared shows, rating similarity, and followed entities with plain-language factors, not scientific precision. |
| 19 | Concert-friend discovery | **Refine** | Use shared canonical Shows, artists, venues, mutuals, and taste. Say “attended the same show,” not “crossed paths” or “met.” |
| 20 | Follow more than people | **Build unified typed follows** | Preserve people follows and fan-club membership; add artist, venue, and tour follows without forcing them into fan clubs. |
| 21 | Notifications | **Refine/build** | Preserve durable social notifications; add Social/Concert/Community categories, per-category controls, dedupe/digests, and push only after preference enforcement. |
| 22 | Concert discussions | **Refine** | Preserve lounge and post comments; bind discussion to Show, add before/after prompts, and stop equating lounge membership with boolean Going. |
| 23 | Setlists | **Build after Show identity** | Replace per-post arrays with canonical setlist, entries, submissions, confirmations, revisions, conflicts, edit history, and reports while retaining legacy display. |
| 24 | Concert moments | **Build after Show/setlist** | Link a post/media item to Show plus optional song/moment; enforce upload/copyright/reporting rules without encouraging full-show recordings. |
| 25 | Live concert experience | **Build cautiously** | Use trusted timezones, optional Here, bounded live updates, current setlist, and quick posting. No livestreaming and no exact-location exposure. |
| 26 | Trending | **Refine** | Separate Shows, live Artists, Tours, Near You, and Friends Are Seeing; require recency, sample confidence, and regional privacy. |
| 27 | Discovery | **Refine** | Combine canonical attendance, follows, ratings, proximity, and social relationships with transparent reasons. |
| 28 | Worth Seeing Live | **Build after confidence** | Rank only when sample minimums are met and show confidence beside every result. |
| 29 | Yearly recap | **Build in growth phase** | Generate from canonical attendance and ratings with member-controlled inclusion and designed external share cards. |
| 30 | Shareable cards | **Build in growth phase** | Create accessible branded cards for attendance, reviews, stats, recaps, ratings, tours, and compatibility with privacy checks. |
| 31 | Badges | **Refine** | Preserve the strong event ledger, narrow the visible catalogue to meaningful concert achievements, and document qualification rules. |
| 32 | Artist pages | **Refine** | Prioritize live rating, See Again, confidence, current tour, nearby shows, fan consensus, recent Shows, fan feed, and live history; keep generic biography lower. |
| 33 | Artist fan communities | **Keep/refine** | Preserve mature fan clubs. Surface followers, discussion, Shows, posts, and memories on Artist pages without inventing another group system. |
| 34 | Venue community | **Build on Venue pages** | Add venue follows/favourite, announcements, high-rated Shows, fan tips, and activity while preserving existing guide/review surfaces. |
| 35 | Social graph privacy | **Build before expansion** | Add profile and attendance defaults plus per-concert overrides; hide individual Shows; never infer live location from following. |
| 36 | Direct messaging | **Keep and freeze expansion** | DMs are already mature. Preserve them, add only necessary permissions/safety controls, and do not let new DM features delay the Show graph. |
| 37 | Blocking and moderation | **Refine** | Preserve block/report/queue/audit systems; add mute, inaccurate-event, setlist, and Show-data report types with target-specific actions. |
| 38 | Review integrity | **Refine/build** | Preserve validation, rate limits, idempotency, moderation, and distinct-rater aggregation; add eligibility flags, spike/duplicate/coordinated-abuse signals, and auditable exclusions. |

## 8. Dependency phases 0–7

Each phase has an exit gate. Later phases may be designed in parallel, but production activation follows this dependency order.

### Phase 0 — Contract, copy, and freeze

- Freeze broad new feature work while the graph is stabilized.
- Establish canonical vocabulary: MSHpit, Show, Tour, Crowd, Interested, Going, Here, Went, mutuals.
- Make Following genuinely chronological or clearly label its actual behavior.
- Replace physical-encounter implications such as “crossed paths.”
- Publish attendance visibility and rating eligibility rules.
- Inventory and flag all legacy Show identities and all consumers.
- Preserve/freeze mature DMs and fan clubs; do not merge or replace them.

### Phase 1 — Canonical Show and private attendance foundation

- Add Shows, performers, aliases, attendance, and nullable post/lounge links.
- Deploy bounded Show read and desired-state attendance APIs.
- Dual-write, batch backfill, reconcile collisions, and keep old APIs/URLs.
- Move ShowScreen to the canonical document behind a release flag.
- Add privacy defaults/overrides and a block-aware Crowd.
- Attach new reviews to `show_id` without breaking legacy posts.

### Phase 2 — Stable Tour and rating intelligence

- Add persistent Tours and Show membership.
- Move Show/Tour/Artist aggregation to canonical IDs.
- Add See Again, confidence labels, documented eligibility, and recent-form gates.
- Strengthen Tour and Artist live-history surfaces.

### Phase 3 — Low-friction contribution and Show community

- Ship Quick Log and optional Full Review.
- Allow ordinary posts to attach to Show/Artist/Tour/Venue.
- Turn memory prompts into optional social posts.
- Bind discussions to Shows and add pre/post prompts.
- Add collaborative setlist model, revisions, confirmation, and reports.
- Add optional song/moment links to media.

### Phase 4 — Social discovery and notifications

- Add typed follows for artists, venues, and tours.
- Add Shows feed and social discovery reasons.
- Split trending into Show/Artist/Tour/Near You/Friends Are Seeing.
- Add notification taxonomy, granular preferences, dedupe, digests, and then push.
- Add Worth Seeing Live only after confidence rules are enforced.

### Phase 5 — Musical identity and communities

- Unify the public profile’s musical identity while preserving the private You dashboard.
- Expand transparent taste match and same-show discovery.
- Surface lightweight Artist/Venue communities without duplicating fan clubs.
- Refine meaningful badges and favourite venue/artist presentation.

### Phase 6 — Growth loops

- Ship privacy-aware yearly recaps.
- Generate accessible share cards for attendance, ratings, reviews, stats, Tours, and compatibility.
- Measure return-to-show behavior and external acquisition without ranking for outrage or empty engagement.

### Phase 7 — Live and trust expansion

- Activate Here and live Show state only where start/timezone data is trustworthy.
- Add optional attendance verification after evidence-retention/security review.
- Add lightweight live setlist/crowd updates, not livestreaming.
- Harden review-integrity signals and operational moderation.
- Complete staged device, load, privacy, abuse, and rollback validation before broad release.

## 9. Phase 1 completion criteria

Phase 1 is complete only when all of the following are true:

### Data and compatibility

- Every newly ingested legitimate event receives one stable Show ID.
- Provider event, legacy event, archive concert, review, Going, and lounge identities can resolve through tested aliases where unambiguous.
- Ambiguous matches are quarantined and reported; none are silently merged.
- New reviews write `show_id`; old reviews remain readable and linkable.
- Existing `/event`, `/concert`, `/post`, accepted legacy `/show`, and Going APIs continue to work.
- No public page becomes a 404 or duplicate solely because its display artist, venue, or date formatting changes.

### Migration safety

- Startup performs no full catalogue/attendance/lounge backfill.
- The backfill is cursor-bounded, idempotent, resumable, observable, and safe to stop.
- No external request occurs while a database write lock is held.
- Before enabling canonical reads, old/new aggregate counts and representative mappings are reconciled and reviewed.
- A rollback can disable new reads while preserving dual-written data.

### Product behavior

- ShowScreen reads one bounded canonical Show document for provider and historical Shows.
- Upcoming/Happening/Completed uses trusted start and timezone information and fails conservatively when either is unavailable.
- Interested, Going, Here, and Went transitions are idempotent and phase-aware.
- Here is unavailable outside a trustworthy event window and never requires GPS.
- Members can choose an attendance default and override/hide an individual Show.
- Crowd identities obey private/followers/members visibility, verification, blocking, restrictions, and viewer filters.
- Logged-out users receive no attendee identities.
- Existing lounge and review-comment behavior remains available through canonical Show resolution.

### Quality

- All 1,996 baseline tests pass unchanged unless a reviewed contract change requires a stronger replacement assertion.
- New migration, alias, collision, state-transition, visibility, block, pagination, account-switch, timezone, legacy-compatibility, and rollback tests pass.
- Production build, syntax, architecture, accessibility, and public-document checks pass.
- Show queries are indexed and bounded; no N+1 attendee/post query or unbounded response is introduced.
- Initial app load and feed performance show no material regression.
- Photo, GIF, Live Photo, screenshot, and video upload/publishing flows remain enabled and pass regression checks.
- Error details remain staff-only; members receive actionable safe messages rather than diagnostics.
- A staged rollout demonstrates no sustained error, latency, privacy, or data-integrity regression before full activation.

## 10. Full quality and release gates

Every phase must satisfy the gates relevant to its scope.

### Data integrity

- Additive, idempotent migrations with a tested pre-migration snapshot/restore path.
- Unique constraints for durable provider aliases and member/entity relationships.
- Collision tests for same artist/date, same-named venues, festivals, corrected names, timezone boundaries, cancelled/postponed events, and duplicate provider imports.
- No user-generated key alone may create a trusted provider identity or indexable entity.
- Deleted, private, moderated, banned, suspended, and blocked data stays excluded from public projections and recommendations.

### API and security

- Authorization tests for every read/write state and every role.
- Desired-state idempotency and retry tests for mobile network interruption.
- Strict request schemas, bounded pagination, rate limits, content-safety checks, and audit records.
- No IDOR through sequential IDs, alternate aliases, media IDs, attendance, evidence, or moderation targets.
- Verification evidence is never returned through ordinary post/media/profile APIs.
- Diagnostic histories and internal request details remain staff-only.

### Privacy and safety

- Visibility matrix tests for guest, public, follower, mutual, owner, blocked, banned, suspended, moderator, and administrator.
- No precise real-time location in social discovery or notifications.
- Per-concert hiding removes the Show from public profile, Crowd identity, discovery, cards, and recaps.
- Mute and block semantics apply consistently across feed, Crowd, discussion, search, recommendations, notifications, fan clubs, and DMs.
- Reporting supports user, post, review, comment, media, lounge, Show/event data, and setlist targets.

### Rating integrity

- One latest eligible rating per member per Show.
- Raw average and rating count are reproducible from eligible rows.
- Show/Tour/Artist confidence labels follow the published thresholds exactly.
- No `0.0/5`, zero-review AggregateRating, or fabricated consensus.
- Verification totals are separate from rating totals and never silently weight the score.
- Suspicious/excluded contributions retain an auditable reason and moderation history.

### Performance and reliability

- No enormous synchronous startup scan, synchronous sitemap/catalogue generation, or full-table per-request aggregation.
- Bounded indexed reads, cursor pagination, cache invalidation tests, and query-plan review for new high-traffic surfaces.
- Stale-response/account-switch protection for Show, Crowd, comments, notifications, and profile reads.
- Load tests cover popular Shows, large tours, high-attendance Crowd pages, active discussions, and recap generation.
- Release flags, health metrics, structured error codes, and a tested rollback path are required.

### Client and accessibility

- Physical iPhone and Android acceptance for check-in, upload, composer recovery, app backgrounding, deep links, slow/offline networks, and large media.
- Keyboard, screen-reader, reduced-motion, large-text, focus, touch-target, and contrast checks.
- Desktop media remains bounded and does not dominate the page.
- Quick actions remain usable without encouraging members to stare at the app during a show.

### Public web and discoverability

- Canonical URLs remain stable and old URLs redirect only after verified alias resolution.
- Server-readable Show/Artist/Tour/Venue pages display only visible real data.
- JSON-LD matches visible content and omits invalid ratings/reviews.
- Sitemaps contain only canonical, public, meaningful 200-status pages.
- No private attendance, private media, verification evidence, or precise live location reaches HTML, metadata, structured data, cards, or sitemaps.

### Release governance

- Protected `master` with required Quality checks.
- Full suite and production build pass on the exact release commit.
- Migration/backfill dry run against a production-shaped copy.
- Staff moderation and rollback runbook reviewed before activating social/live features.
- Staged percentage rollout with error, latency, data, privacy, and abuse monitoring.
- Post-release reconciliation verifies counts, aliases, visibility, and notification volume.

## 11. Intentionally deferred or rejected ideas

| Idea | Decision | Reason |
|---|---|---|
| Expanding DMs now | **Deferred** | DMs are already mature; new messaging capability adds moderation and safety work without fixing the core Show loop. Preserve and permission them. |
| Replacing fan clubs with a new group system | **Rejected** | It duplicates a working community feature. Artist pages should surface fan clubs and lightweight followers instead. |
| Mandatory GPS check-in | **Rejected** | It excludes historical logs, creates sensitive location data, and confuses attendance with proof. Optional verification may use a coarse outcome later. |
| Public exact real-time location | **Rejected** | Following or attendance never authorizes surveillance. Live presence remains voluntary, visibility-controlled, and aggregate-first. |
| Hidden weighting of verified ratings | **Rejected** | It makes the public score irreproducible. Verification is a separate trust signal. |
| Secret “quality” score manipulation | **Rejected** | Confidence can order results only under a documented rule; displayed ratings remain raw eligible averages. |
| Ranking a 2-review artist above a 200-review artist without context | **Rejected** | Every ranking must enforce sample minimums and display confidence. |
| Full concert livestreams or encouraging full recordings | **Rejected** | It distracts from the physical show and creates copyright, moderation, storage, and rights risk. Short fan moments are sufficient. |
| Ticket sales/escrow/payments inside MSHpit | **Deferred outside this plan** | Financial, fraud, consumer-protection, and regulatory obligations would distract from the social loop. External reputable ticket links can remain. |
| Ticket/Wallet verification in Phase 1 | **Deferred** | Evidence security, retention, provider contracts, and abuse handling require a dedicated design after canonical attendance exists. |
| A new explicit friendship system immediately | **Deferred** | The app has directional follows. Use clearly labelled mutuals until there is a justified accepted-friend model. |
| Scientific-sounding compatibility precision | **Rejected** | Compatibility is a discovery hint. Show contributing signals and use friendly ranges or an approximate percentage. |
| Engagement-bait feed ranking | **Rejected** | Relevance to music taste, Shows, people, artists, venues, and tours is the objective—not outrage or time spent. |
| AI-generated biographies, reviews, setlists, or SEO pages | **Rejected** | The product’s value is genuine fan and event data. AI filler harms trust and index quality. |
| Unbounded live polling or giant Show responses | **Rejected** | Media-heavy social pages require bounded, cached, paginated reads and lifecycle-aware polling. |
| Building every requested feature in one release | **Rejected** | It would deepen architectural drift and make privacy, migration, moderation, and rollback unverifiable. |

## 12. Expected product outcome

After these phases, a Show is not merely an event listing or a review card. It is the stable social community for one night:

- before: discovery, interest, plans, friends/mutuals, discussion, and venue knowledge;
- during: optional quick check-in, short posts/media, crowd updates, and community setlist;
- after: quick rating, See Again, review, memory, media, setlist confirmation, and conversation;
- permanently: an explainable fan rating, attendee-controlled Crowd, Tour/Artist/Venue context, and a trustworthy public archive.

People, Shows, and Music then become one coherent graph rather than a collection of adjacent features. That is the product expansion worth shipping.
