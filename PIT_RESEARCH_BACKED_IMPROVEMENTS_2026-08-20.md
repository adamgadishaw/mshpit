# PIT research-backed product improvements

Date: 2026-08-20

## Method

This release combines a source audit of PIT with primary-source product research and a review of active open-source music/social projects. GitHub stars and activity are discovery signals, not proof that a feature will work for PIT. Concepts were adapted to PIT's existing Expo 56, React Native Web, Node, and SQLite architecture; no third-party source code or branding was copied.

Representative active projects reviewed:

- [Bluesky Social App](https://github.com/bluesky-social/social-app) and [AT Protocol](https://github.com/bluesky-social/atproto): selectable feeds, structured interactions, account-scoped state, and composable moderation.
- [Mastodon](https://github.com/mastodon/mastodon) and [Lemmy](https://github.com/LemmyNet/lemmy): chronological feeds, explicit privacy, transparent ranking, and healthy community controls.
- [Loops](https://github.com/joinloops/loops-expo): an active Expo social-video client with media safety and For You/Following surfaces.
- [ListenBrainz](https://github.com/metabrainz/listenbrainz-server) and [Navidrome](https://github.com/navidrome/navidrome): explicit music feedback, listening history, rediscovery, playlists, and similarity-based discovery.
- [Owncast](https://github.com/owncast/owncast), [LiveKit](https://github.com/livekit/livekit), and [Ampache Democratic Play](https://ampache.org/docs/configuration/democratic/): live community presence, shared rooms, and server-authoritative social queues.
- [Uppy](https://github.com/transloadit/uppy), [imgproxy](https://github.com/imgproxy/imgproxy), and [FlashList](https://github.com/Shopify/flash-list): resilient media state, safe derivatives, and bounded media-feed rendering.

Primary product/research references:

- [Bluesky custom feeds](https://bsky.social/about/blog/7-27-2023-custom-feeds)
- [Spotify explainable recommendations](https://research.atspotify.com/publications/explore-exploit-explain-personalizing-explainable-recommendations-with-bandits)
- [Spotify diversity research](https://research.atspotify.com/2021/3/shifting-consumption-towards-diverse-content-via-reinforcement-learning)
- [Spotify private listening](https://support.spotify.com/us/article/private-listening/)
- [Spotify social music discovery](https://research.atspotify.com/publications/Link-Me-Baby-One-More-Time-Social-Music-Discovery-on-Spotify)
- [W3C guidance for social-media authoring and user control](https://www.w3.org/WAI/standards-guidelines/atag/social-media/)
- [Apple privacy guidance](https://developer.apple.com/design/human-interface-guidelines/privacy/)

## Implemented improvements

1. **Truthful afterparty discovery.** Removed invented businesses, hours, distances, and ride destinations. PIT now offers explicit live category searches around verified venue coordinates and says when a verified location is unavailable.
2. **Reliable unified Search.** Song-only results count as results, loading is visible, stale result groups are cleared, and people/artists/songs share one abortable request lifecycle.
3. **Playlist privacy at creation.** The composer exposes Public, Unlisted, and Private before saving instead of silently making every playlist public.
4. **Live fan-club membership directory.** Joining or leaving immediately changes the current directory rather than remaining frozen to the mount-time snapshot.
5. **Working Friends Listening playback.** Social listening cards now hand the player a normalized track descriptor instead of an invalid person/card object.
6. **Descriptor-aware Discover media.** Discover uses stable posters, edited renditions, alt text, and honest unavailable states instead of treating every media URL as a photo.
7. **Descriptor-aware public profile media.** Public profiles receive the same resilient photo/clip rendering contract as the owner profile.
8. **Authoritative show attendees.** Show pages load the server attendee list rather than relying only on whatever attendance happened to be cached on this device.
9. **Authoritative lounge activity.** Show pages load lounge metadata so the activity count is meaningful before someone opens the lounge.
10. **Recoverable activity deep links.** Post notifications can fetch an unloaded target and open it; removed or inaccessible targets produce an honest unavailable state instead of routing to the wrong profile.
11. **Persistent feed choice.** Following, Local, and Discover are explicit surfaces, and PIT remembers the signed-in account's last choice without silently switching algorithms.
12. **Healthy feed stopping points.** Automatic endless loading is replaced by deliberate Show more/Load older actions and a clear caught-up checkpoint.
13. **Explainable recommendations.** Every ranked recommendation surfaces its deterministic reason and an expandable plain-language explanation based only on stored signals.
14. **Undo for recommendation feedback.** “Not for me” has an immediate, accessible Undo path backed by the existing authoritative delete-preference route.
15. **Six-hour Private Listening.** A visible account-scoped mode suppresses local history, social activity, server play history, and recommendation/product-analytics play signals, then expires automatically.
16. **Auditable recommendation context.** Feed projections and privacy-bounded analytics now carry algorithm version and categorical reason code so PIT can measure satisfaction, diversity, and hides without storing authored text.

## Final adversarial fixes

- Open feeds notice newly published posts instead of only revalidating already-cached IDs.
- Recommended status posts expose the same explanation and feedback controls as reviews.
- “Not for me” and Undo are serialized per account and post, so a late hide cannot overwrite a newer restore.
- Friends Listening excludes banned and actively suspended members.
- PhotoViewer attributes cross-post clip analytics, reactions, and reports to the item currently on screen.
- Fan Club membership and message counts come from an authoritative, account-safe server snapshot while retaining optimistic join/leave feedback.
- Search rejects stale cross-account people results and removes newly blocked members immediately.
- Notification deep links distinguish removed/private content from a retryable network failure.

## Verification

- Full automated suite: 833/833 passing.
- Syntax sweep: 134 Node files passing.
- Expo SDK 56 dependency alignment: passing.
- Production exports: web (43 chunks), iOS Hermes, and Android Hermes all passing.
- `git diff --check`: clean apart from repository line-ending notices.

## Product guardrails

- Optimize for saves, meaningful plays, follows, replies, diversity, and low hide/report rates—not minutes consumed.
- Keep Following chronological; keep Discover explainable and user-selectable.
- Never manufacture venue facts, social proof, provider rights, or recommendation explanations.
- Treat GPL/AGPL repositories as research unless licensing is separately approved.
- Keep blocks, permissions, and moderation authoritative on the server; cache filters are not authorization.
- Retain the existing Expo SDK 56 media stack until an intentional, tested SDK upgrade. Do not swap player libraries based on popularity alone.
- Test these hypotheses with satisfaction, privacy, accessibility, and creator-exposure guardrails before optimizing their weights.
