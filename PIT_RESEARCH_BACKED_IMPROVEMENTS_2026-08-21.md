# PIT research-backed improvements: second-pass implementation map

Date: 2026-08-21

Status: implemented in the shared local working tree; this document is not a deployment or App Store approval record.

## Method

This pass used four evidence layers:

1. Audit the current PIT product and its existing Expo SDK 56, React Native Web, Node, and SQLite contracts.
2. Review primary product/accessibility/privacy research and active open-source music/social projects for reusable product patterns.
3. Translate only the relevant patterns into bounded PIT features; GitHub popularity is a discovery signal, not evidence that a feature will work for PIT.
4. Prove deterministic policy in pure domain tests, then integrate it into the existing screens without copying third-party source code, branding, or data.

“Implemented” below means code and regression coverage exist in this working tree. “Validated” means the stated command passed locally. Neither word means a production deploy, native-device acceptance, or successful store review.

## Research and project signals used

Primary references:

- [Bluesky custom feeds](https://bsky.social/about/blog/7-27-2023-custom-feeds): explicit user choice between discovery modes rather than one opaque ranking surface.
- [Spotify explainable recommendations](https://research.atspotify.com/publications/explore-exploit-explain-personalizing-explainable-recommendations-with-bandits): explanations should be tied to real evidence.
- [Spotify diversity research](https://research.atspotify.com/2021/3/shifting-consumption-towards-diverse-content-via-reinforcement-learning): diversity is a hypothesis to test, not a percentage to invent.
- [Spotify social music discovery](https://research.atspotify.com/publications/Link-Me-Baby-One-More-Time-Social-Music-Discovery-on-Spotify): friends and shared taste can support music discovery when the social signal is explicit.
- [Spotify Private Listening](https://support.spotify.com/us/article/private-listening/): listening privacy must suppress downstream social and recommendation signals, not merely hide one card.
- [W3C guidance for social-media authoring and user control](https://www.w3.org/WAI/standards-guidelines/atag/social-media/): accessible authoring guidance and controls belong in the creation workflow.
- [Apple Human Interface Guidelines: Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy/): request or expose only the data needed for a visible feature.
- [RFC 5545: Internet Calendaring and Scheduling Core Object Specification](https://www.rfc-editor.org/rfc/rfc5545): the interoperable `.ics` format used by PIT calendar export.
- [User-Driven Fairness in Music Recommendations (MuRS 2025)](https://research-portal.uu.nl/en/publications/user-driven-fairness-in-music-recommendations-effects-on-experien/): explicit diversity controls improved participants' perceived control and fairness; PIT therefore describes evidence and offers choices instead of presenting a hidden compatibility score.
- [Let Me Introduce You: Stimulating Taste-Broadening Serendipity Through Song Introductions (2026)](https://arxiv.org/abs/2604.08385): context can help listeners engage with music outside their usual preferences; PIT's Rediscover and playlist context remain factual and user-initiated.
- [Batching smartphone notifications can improve well-being](https://doi.org/10.1016/j.chb.2019.07.016): predictable batching reduced interruption and improved perceived control in a field experiment; PIT's Digest borrows the grouping principle without pretending to schedule operating-system notifications.
- [Alt-Text with Context (ICLR 2024)](https://proceedings.iclr.cc/paper_files/paper/2024/hash/335f1136892829df286e94d479c4b822-Abstract-Conference.html): useful image descriptions depend on the post's context; PIT gives the human author contextual prompts rather than inventing a computer-vision description.
- [Mastodon moderation and keyword filters](https://docs.joinmastodon.org/user/moderating/): user-controlled boundaries should be explicit, scoped, and reversible.
- [ListenBrainz recommendation feedback API](https://listenbrainz.readthedocs.io/en/latest/users/api/recommendation.html): recommendation feedback should be an explicit durable action rather than an inferred dislike.
- [Bluesky thread gates](https://docs.bsky.app/docs/tutorials/thread-gates): conversation participation can be represented as a first-class policy. PIT reviewed this pattern but did not claim a reply-gate feature in this pass.

Representative GitHub projects reviewed:

- [Bluesky Social App](https://github.com/bluesky-social/social-app) and [AT Protocol](https://github.com/bluesky-social/atproto): structured interactions, account-scoped state, composable feeds, and moderation boundaries.
- [Mastodon](https://github.com/mastodon/mastodon) and [Lemmy](https://github.com/LemmyNet/lemmy): chronological/social surfaces, privacy controls, and transparent community actions.
- [Loops Expo](https://github.com/joinloops/loops-expo): an Expo social-video product with distinct social/discovery surfaces.
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server) and [Navidrome](https://github.com/navidrome/navidrome): listening history, rediscovery, playlists, and explicit music metadata.
- [Owncast](https://github.com/owncast/owncast) and [LiveKit](https://github.com/livekit/livekit): live community presence and reconnectable interaction streams.
- [Uppy](https://github.com/transloadit/uppy), [imgproxy](https://github.com/imgproxy/imgproxy), and [FlashList](https://github.com/Shopify/flash-list): explicit media lifecycle state, safe derivatives, and bounded rendering.
- [Misskey](https://github.com/misskey-dev/misskey), [Bonfire](https://github.com/bonfire-networks/bonfire-app), and [NodeBB](https://github.com/NodeBB/NodeBB): current social/community systems with configurable streams, granular boundaries, real-time activity, and digest/notification infrastructure.
- [Immich](https://github.com/immich-app/immich) and [Ente](https://github.com/ente-io/ente): privacy-conscious photo libraries whose resurfacing patterns informed PIT's owner-only Concert Memories selection.
- [Folo](https://github.com/RSSNext/Folo), [FreshRSS](https://github.com/FreshRSS/FreshRSS), and [Miniflux](https://github.com/miniflux/v2): user-selected sources, filters, and bounded reading queues rather than one compulsory ranking surface.
- [Rallly](https://github.com/lukevella/rallly): transparent group scheduling and explicit participant choices. Its planning pattern remains future research; this pass implements portable calendar export, not a fake collaborative poll.
- [PeerTube](https://github.com/Chocobozzz/PeerTube) and [Castopod](https://github.com/ad-aures/castopod): durable media identity, chapters/timestamps, and community interaction around media. PIT did not claim those unimplemented capabilities.
- [Troi / ListenBrainz recommendation playground](https://github.com/metabrainz/troi-recommendation-playground): playlist exchange, duplicate detection, explicit metadata, weekly rediscovery, and recommendation pipelines.
- Emerging music/social prototypes [Aurral](https://github.com/lklynet/aurral), [Jukebox](https://github.com/skeptrunedev/jukebox), and [TuneLog](https://github.com/adiiverma40/tunelog) were inspected for listening-log and social-playlist ideas. Their early-stage status is a reason to validate concepts, not a reason to import architecture or code.

These repositories were used as research references only. Their licenses must be reviewed separately before any code reuse.

## Wave 2B: discovery, social context, and accessibility

### 1. Concert Memories

Implemented behavior:

- The You screen can show at most two memories selected from the signed-in member's own still-visible concert logs.
- Status posts, removed/hidden/deleted entries, foreign users' logs, future dates, malformed dates, and entries without both artist and venue are excluded.
- Nearby anniversaries are prioritized. Remaining space is filled by a deterministic daily rediscovery rotation, so a fixed clock produces a repeatable result.
- A memory card itself does not open or share anything. Separate 44-point **Open memory** and **Share memory** actions require an explicit choice.
- Shared copy contains artist, venue, and date only; it does not silently include the member's review text.

Implementation and proof:

- [`src/domain/concertMemories.mjs`](src/domain/concertMemories.mjs)
- [`src/domain/concertMemories.test.mjs`](src/domain/concertMemories.test.mjs)
- [`src/screens/YouScreen.jsx`](src/screens/YouScreen.jsx)

### 2. Privacy-bounded Taste Match

Implemented behavior:

- A public profile can show exact shared favorite artists and genres chosen by both members.
- Matching is case-insensitive and deduplicated, but the displayed labels come from the viewer's explicit picks.
- PIT does not produce a compatibility percentage or infer taste from plays, posts, follows, concert logs, or location.
- The public-profile cache preserves only the server-approved `genres` and `favoriteArtists` arrays, bounded to the existing server limits of 12 genres and 50 artists. No additional profile fields were exposed.

Implementation and proof:

- [`src/domain/tasteMatch.mjs`](src/domain/tasteMatch.mjs)
- [`src/domain/tasteMatch.test.mjs`](src/domain/tasteMatch.test.mjs)
- [`src/domain/dataPolicy.mjs`](src/domain/dataPolicy.mjs)
- [`src/domain/dataPolicy.test.mjs`](src/domain/dataPolicy.test.mjs)
- [`src/screens/ProfileScreen.jsx`](src/screens/ProfileScreen.jsx)

### 3. Friends Listening freshness

Implemented behavior:

- Plays no older than one hour are labelled **Played … ago** and can support a **Fresh plays from friends** heading.
- Older recent rows are labelled **Last played … ago**. Rows more than seven days old, missing a usable timestamp, or implausibly in the future are suppressed.
- Visible rows are newest-first, limited, and deduplicated per followed member.
- Each playable row announces the track, artist, and relative timestamp. PIT does not call a week-old play “now playing.”

Implementation and proof:

- [`src/domain/listeningRediscovery.mjs`](src/domain/listeningRediscovery.mjs)
- [`src/domain/listeningRediscovery.test.mjs`](src/domain/listeningRediscovery.test.mjs)
- [`src/components/discover/DiscoverCommunity.jsx`](src/components/discover/DiscoverCommunity.jsx)

### 4. Search action tree and announcements

Implemented behavior:

- Primary and secondary actions are sibling controls: profile/follow, play/add, event/venue/tickets, and recent/remove are no longer nested buttons.
- Interactive targets have explicit roles and names; relevant selected, busy, and disabled states are exposed; controls are at least 44 points.
- Typed search has polite loading/result announcements, assertive error announcements, a visible retry, and cancellation protection for superseded requests.
- Artist lookup no longer opens an unverified raw query when resolution fails. Ticket-link failures are announced rather than silently ignored.
- Search analytics continue to receive only a coarse result-count bucket, not the authored search string.

Implementation and proof:

- [`src/domain/searchAccessibility.mjs`](src/domain/searchAccessibility.mjs)
- [`src/domain/searchAccessibility.test.mjs`](src/domain/searchAccessibility.test.mjs)
- [`src/screens/SearchScreen.jsx`](src/screens/SearchScreen.jsx)

### 5. Bounded Rediscover rail

Implemented behavior:

- The You screen can show up to eight tracks whose latest occurrence in the history available to PIT is at least 30 days old.
- Repeated artist/title pairs collapse to their latest available play, and the original playable descriptor fields are preserved.
- The rail says it is based on the listening history available on PIT and explicitly says it is not a lifetime total.
- Private Listening remains upstream of this feature: plays suppressed from history by that mode cannot be selected here.

Implementation and proof:

- [`src/domain/listeningRediscovery.mjs`](src/domain/listeningRediscovery.mjs)
- [`src/domain/listeningRediscovery.test.mjs`](src/domain/listeningRediscovery.test.mjs)
- [`src/screens/YouScreen.jsx`](src/screens/YouScreen.jsx)

## Wave 2C: digest, playlist evidence, and accessible authoring

### 1. Optional Activity Digest

Implemented behavior:

- Activity retains an explicit **Recent** view and adds an optional **Digest** view.
- Digest groups only the notifications currently loaded on the device, using deterministic type-and-target keys and a 24-hour rolling window from each group's newest item.
- Likes/comments for different posts and DMs from different people remain separate. Distinct actors are counted and summarized accessibly.
- The screen states that Digest does not schedule or send push notifications or email. It is a presentation of loaded rows, not a new delivery system.

Implementation and proof:

- [`src/domain/notification-bundles.mjs`](src/domain/notification-bundles.mjs)
- [`src/domain/notification-bundles.test.mjs`](src/domain/notification-bundles.test.mjs)
- [`src/screens/NotificationsScreen.jsx`](src/screens/NotificationsScreen.jsx)

### 2. Factual playlist insights and duplicate prevention

Implemented behavior:

- Before adding a track, PIT checks the strongest available recording evidence in order: YouTube video identity, provider/source identity, URL, then normalized artist/title.
- Equivalent YouTube URL forms resolve to the same identity, preventing a duplicate add before the mutation is sent.
- Playlist summaries show song, artist, or genre counts only when the required metadata is complete for every relevant track.
- “Adds a new artist/genre” notes appear only when existing and candidate metadata prove the claim. There is no diversity score, percentage, or quality judgment.

Implementation and proof:

- [`src/domain/playlist-insights.mjs`](src/domain/playlist-insights.mjs)
- [`src/domain/playlist-insights.test.mjs`](src/domain/playlist-insights.test.mjs)
- [`src/screens/PlaylistPickerScreen.jsx`](src/screens/PlaylistPickerScreen.jsx)

### 3. Human-written media descriptions

Implemented behavior:

- The media editor tracks each current image as `complete`, `missing`, or `optional`; video rows are ignored by the photo-completion calculation.
- Older legacy images and explicitly decorative/optional images do not block the workflow.
- The editor shows per-photo state, completion progress, position, and bounded contextual guidance based on image orientation.
- Guidance asks the member to write the description. PIT does not auto-generate a description or claim that an image contains an inferred person, place, or action.
- Alt text remains editable metadata in the existing stable-media lifecycle and is capped at 1,000 characters in the editor.

Implementation and proof:

- [`src/domain/media-alt-text.mjs`](src/domain/media-alt-text.mjs)
- [`src/domain/media-alt-text.test.mjs`](src/domain/media-alt-text.test.mjs)
- [`src/components/media-editor/MediaEditorWorkspace.jsx`](src/components/media-editor/MediaEditorWorkspace.jsx)
- [`src/components/media-editor/MediaEditorInspector.jsx`](src/components/media-editor/MediaEditorInspector.jsx)
- [`src/components/media-editor/MediaAssetRail.jsx`](src/components/media-editor/MediaAssetRail.jsx)

## Calendar export

Implemented behavior:

- Calendar offers an explicit save action for one selected show and, when available, one action for all shows marked Going.
- The pure exporter produces an RFC 5545 `.ics` document with truthful all-day events, deterministic UIDs, duplicate-performance collapse, next-day exclusive `DTEND`, escaped authored text, CRLF endings, and 75-octet UTF-8-safe line folding.
- Export requires a valid artist and calendar date. Ticket URLs are included only for HTTP(S); unsafe schemes are discarded.
- Web creates a temporary calendar Blob, triggers a named download, and revokes its object URL.
- Native writes the generated file to the Expo cache and opens the system share sheet with `text/calendar` / `public.calendar-event`. It does not request broad calendar permission or silently write to a calendar account.
- Busy/disabled state and success/failure status are exposed to assistive technology.

Implementation and proof:

- [`src/domain/calendarExport.mjs`](src/domain/calendarExport.mjs)
- [`src/domain/calendarExport.test.mjs`](src/domain/calendarExport.test.mjs)
- [`src/lib/calendarExport.web.js`](src/lib/calendarExport.web.js)
- [`src/lib/calendarExport.native.js`](src/lib/calendarExport.native.js)
- [`src/screens/CalendarScreen.jsx`](src/screens/CalendarScreen.jsx)

## Account-safe, recoverable chat delivery

Implemented behavior:

- DM inbox/thread, fan-club, and lounge reads claim account-and-channel-scoped latest-response tickets. Switching accounts increments the chat auth epoch, resets poll keys/cursors, rejects late reads, and purges ephemeral outbox state.
- Failed sends stay visible as bounded memory-only bubbles with explicit **Retry** and **Cancel** actions. Private failed bodies are not written into persisted client storage and are removed on account handoff.
- Retrying reuses the same target, body, and `clientMutationId`. The server scopes that token to the author, returns the existing row for an exact replay, and rejects reuse with different content or a different recipient/room.
- The server's partial unique indexes plus `INSERT OR IGNORE`/reread close duplicate-write races across processes. A replayed DM does not emit a second notification.
- Composers retain the authored draft after failure and clear it only after the matching body is confirmed. A completion from an old account, channel, epoch, or outbox item cannot clear the new draft.
- Failed DM threads remain visible in Inbox as **Not sent** so a failure cannot disappear merely because the individual thread screen closed.

Implementation and proof:

- [`src/domain/chatDelivery.mjs`](src/domain/chatDelivery.mjs)
- [`src/domain/chatDelivery.test.mjs`](src/domain/chatDelivery.test.mjs)
- [`server/chat.idempotency.test.mjs`](server/chat.idempotency.test.mjs)
- [`server/db.js`](server/db.js)
- [`server/api.js`](server/api.js)
- [`src/store.js`](src/store.js)
- [`src/screens/ThreadScreen.jsx`](src/screens/ThreadScreen.jsx)
- [`src/screens/FanClubScreen.jsx`](src/screens/FanClubScreen.jsx)
- [`src/screens/LoungeScreen.jsx`](src/screens/LoungeScreen.jsx)
- [`src/screens/InboxScreen.jsx`](src/screens/InboxScreen.jsx)

## Adversarial screen-scope and accessibility hardening

- Public-profile playlist reads now clear immediately and abort/ignore outside the exact viewer-account plus profile scope.
- Playlist creation/addition busy, success, and delayed-close UI is bound to the account and candidate track that started the action.
- DM, fan-club, and lounge drafts plus asynchronous send/retry/join/enter UI completions are keyed to the active account and channel.
- Artist lookup uses mount, sequence, account, and query guards; a late lookup cannot add a recent search or navigate from a newer search context.
- DM, fan-club, and lounge send controls expose channel-specific names plus busy/disabled state. A failed delivery is announced assertively and retains named Retry/Cancel actions.

Implementation and proof:

- [`src/domain/screenScope.mjs`](src/domain/screenScope.mjs)
- [`src/domain/screenScope.test.mjs`](src/domain/screenScope.test.mjs)
- [`src/screens/ProfileScreen.jsx`](src/screens/ProfileScreen.jsx)
- [`src/screens/SearchScreen.jsx`](src/screens/SearchScreen.jsx)
- [`src/screens/PlaylistPickerScreen.jsx`](src/screens/PlaylistPickerScreen.jsx)
- [`src/screens/ThreadScreen.jsx`](src/screens/ThreadScreen.jsx)
- [`src/screens/FanClubScreen.jsx`](src/screens/FanClubScreen.jsx)
- [`src/screens/LoungeScreen.jsx`](src/screens/LoungeScreen.jsx)

## Authoritative artist tour dates and show attendance

Implemented behavior:

- Active artist and admin accounts can submit 1–50 tour dates to an authoritative server batch. Artist accounts cannot rename the act they own; every venue, place, date, release timestamp, and optional HTTPS ticket URL is bounded and validated before one transaction begins.
- One invalid row rejects the entire batch. The client awaits the canonical response, preserves the form on failure, and offers visible busy/error/retry state; it never displays **POSTED** for a local-only or failed write.
- Artist-submitted and admin-submitted rows retain explicit owner/source attribution. PIT no longer fabricates a Ticketmaster search URL when no verified owner URL was supplied.
- Scheduled dates are visible to their owner/admin but remain absent from public tour and discovery reads until release. Existing provider rows, whose owner is null, remain public.
- Any nonzero release timestamp must be strictly in the future at the server. A past or same-day-midnight timestamp is rejected before a transaction starts instead of being silently converted into a public release.
- The bulk form is locked while publishing and binds completion to the mounted form revision. Editing, closing, switching context, or an old delayed response cannot discard newer fields, show stale success, or close a different overlay.
- Going writes serialize per account and show. A revision plus auth epoch makes only the latest tap authoritative and prevents queued writes from a previous account.
- The attendee API returns a block-aware bounded page plus an authoritative total, cursor, and viewer state. Its page and total share the same active-user predicate, so banned and currently suspended accounts do not remain publicly visible or counted. Show renders the total—not the capped avatar count—and adjusts it only for the current viewer's optimistic latest intent.
- Public user projections expose only city/region-style home labels. Precise home latitude/longitude remains self-only, including in attendee, profile, search, and chat projections.
- Playlist creation also captures the account/auth epoch before its write; an old account's delayed response cannot merge into the next account's playlist state.
- Playlist creation defaults to public only when visibility is omitted. An explicit invalid value is rejected before insertion; a typo can no longer fail open into a guest-visible playlist.

Implementation and proof:

- [`src/domain/accountMutation.mjs`](src/domain/accountMutation.mjs)
- [`src/domain/accountMutation.test.mjs`](src/domain/accountMutation.test.mjs)
- [`src/domain/goingIntent.mjs`](src/domain/goingIntent.mjs)
- [`src/domain/goingIntent.test.mjs`](src/domain/goingIntent.test.mjs)
- [`src/domain/showAttendance.mjs`](src/domain/showAttendance.mjs)
- [`src/domain/showAttendance.test.mjs`](src/domain/showAttendance.test.mjs)
- [`server/db.js`](server/db.js)
- [`server/api.js`](server/api.js)
- [`server/api.integrity.test.mjs`](server/api.integrity.test.mjs)
- [`src/store.js`](src/store.js)
- [`src/screens/BulkTourDatesScreen.jsx`](src/screens/BulkTourDatesScreen.jsx)
- [`src/screens/ShowScreen.jsx`](src/screens/ShowScreen.jsx)

## Privacy and claim guardrails

- Use an exact public-data allowlist. A UI cache is not an authorization boundary, and no private field should be inferred from a public one.
- Do not manufacture compatibility percentages, diversity scores, venue facts, freshness, social proof, notification delivery, or lifetime listening totals.
- Label the evidence scope: loaded notifications, available listening history, explicit shared picks, or still-visible own logs.
- Keep opening, sharing, exporting, following, hiding, and adding as explicit user actions with observable state.
- Preserve Private Listening upstream of history, recommendations, analytics, and Friends Listening.
- Human-written alt text is user-authored content; guidance must not pretend computer vision verified the scene.
- Calendar export is user-initiated and file-based. It is not proof that a calendar provider accepted or synced the event.
- Private chat retry bodies remain memory-only. Delivery idempotency prevents duplicate writes; it is not an excuse to persist authored private text in analytics or diagnostics.
- Treat GPL/AGPL projects as research unless licensing and reuse are separately approved.
- Measure satisfaction, useful plays, saves, follows, replies, diversity, hides, and reports; do not optimize only for time consumed.

## Final local validation

- Wave 2B focused domain batch: **16/16 passing**.
- Tour/Going/API/migration focused batch: **48/48 passing**.
- Integrated automated suite after every writer froze: **880/880 passing**.
- Repository syntax sweep: **135 Node files passing**.
- JSX parser probe for Discover Community, Profile, Search, and You: **4/4 passing**.
- Expo SDK 56 dependency alignment (`expo install --check`): **passing**.
- Fresh production exports: **web passing** (43 chunks), **iOS passing** (6.5 MB Hermes bundle), and **Android passing** (6.5 MB Hermes bundle). Metro's incremental transform count is intentionally omitted because it varies with cache state and is not a bundle-size invariant.
- Calendar export: four pure regressions cover all-day output/escaping, deduplication/year rollover, invalid input/unsafe URL handling, and UTF-8 line folding.
- Chat delivery/idempotency focused tests: **12/12 passing**; existing adjacent chat API integrity regressions: **3/3 passing**.
- Screen-scope and chat accessibility focused tests: **12/12 passing**; all six changed JSX screens parsed successfully.
- Notification bundling, playlist insights, media alt-text policy, Taste Match, Memories, freshness, Rediscover, and Search announcements are included in the passing full suite.
- Complete-tree `git diff --check` passed apart from repository line-ending notices.
- Expo Doctor passed **21/22** checks. Its only failure is the already-documented Hermes V1 memory regression in Expo 56.0.20 / React Native 0.85.3; Expo's published fix line requires an intentional SDK 57 / React Native 0.86.2+ upgrade. This pass did not silently change the pinned native runtime.

These are local gates. Physical-device interaction, Render health, deployment, production smoke checks, and App Store review were not performed by this work.

## Release state

- No Render deployment, EAS build, TestFlight upload, App Store submission, or production mutation was performed by this product pass. Git commit and remote feature-branch state are verified separately by the requested pre-push audit.
- The working tree contains this pass alongside substantial previously requested uncommitted media, release, and product work. It must be intentionally reviewed and committed as a release manifest before any EAS profile with `requireCommit` can build it.
- The known SDK 56 Hermes regression remains a native-release decision. Passing JavaScript exports do not replace signed physical-device memory, accessibility, backgrounding, and interruption acceptance.
- Existing App Store rights, media-scanning/transcoding, provider-approval, storage-deletion operations, support, and counsel gates remain governed by `APP_STORE_READINESS.md`; this product pass does not waive them.
