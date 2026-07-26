# Pit data sources, provenance, and provider rules

Last reconciled: **2026-07-26**. This is an engineering inventory, not legal
advice. Before a broad launch, review every provider contract and the public
attribution/privacy copy with qualified counsel.

The working rule is more precise than “facts are free”: individual facts are
generally not protected like creative works, but database rights, API terms,
rate limits, branding rules, privacy law, and access controls can still govern
how Pit obtains and republishes them. Photos, editorial text, recordings, and
video are copyrighted unless a license or provider contract says otherwise.

## Active sources

| Data | Source | Provenance / operating rule | Credential |
| --- | --- | --- | --- |
| Artist identity and MusicBrainz ID | MusicBrainz | Core artist data is CC0. Send a descriptive User-Agent and respect the service rate. | none |
| MusicBrainz tags/ratings | MusicBrainz supplementary data | Supplementary data is CC BY-NC-SA 3.0, not core CC0. Pit's tag crawl uses buckets only to discover names and must not publish them as authoritative genres. Review commercial use/licensing before relying on this path at scale. | none |
| Artist channel identity | Wikidata P434 -> P2397 | Wikidata structured data is CC0. Store the MBID, channel ID, check time, and validation state. A keyless mapping is `wikidata_unverified` until YouTube title/existence evidence validates it. | none |
| YouTube channel/video metadata | YouTube Data API v3 | Server-side key only. Keep source and refresh timestamps. Non-authorized API data must be refreshed or deleted within 30 calendar days. Never shard projects to evade quota. | `YOUTUBE_API_KEY` |
| Full YouTube playback | YouTube IFrame Player | Embed the visible official player; do not download, restream, hide the video for audio-only playback, suppress required controls/ads, or claim the media as hosted by Pit. | no client secret |
| Artist releases, tracks, images, fan counts, and short previews | Deezer API | Provider-backed enrichment. Cache bounded metadata; resolve signed previews at play time and never self-host provider previews. Store Deezer IDs so same-name selection and recording identity survive. | none today |
| Tour dates and ticket links | Ticketmaster Discovery API | Official API data and ticket URL. Retain provider/source IDs and observe contract/cache/branding requirements. | `TICKETMASTER_KEY` |
| Setlists | Setlist.fm API | CC-BY-SA/API terms; preserve attribution and source URL. | `SETLISTFM_KEY` |
| Artist/venue images | Wikimedia Commons via Wikidata P18 | Use only the file's actual license. Store creator, license, source page, and any share-alike requirement; show attribution. | none |
| Licensed gallery backfill | Openverse | Filter for a license compatible with the intended commercial/modification use, then store creator/license/source. Openverse is a search index: verify the source record when practical. | none |
| User media | User upload -> Cloudflare R2 | User grants the rights described by Pit's terms. Preserve owner/object identity and moderation state; do not treat an upload as proof that the uploader owns it. | server-side `MEDIA_*` |

Official references:

- [YouTube quota overview](https://developers.google.com/youtube/v3/getting-started#quota)
- [`search.list` quota](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube Developer Policies](https://developers.google.com/youtube/terms/developer-policies)
- [Wikidata data access and licensing](https://www.wikidata.org/wiki/Wikidata:Data_access)
- [MusicBrainz data licensing](https://musicbrainz.org/doc/About/Data_License)

## June 2026 YouTube quota model

Do not restore the old “search costs 100 of the 10,000 daily units” arithmetic.
Since June 2026:

- `search.list` uses its own default **100-call/day Search Queries bucket** and
  one request costs one call from that bucket;
- `channels.list`, `playlistItems.list`, and `videos.list` draw from the separate
  default **10,000-unit/day general bucket**;
- Pit defaults to 90 search calls/day to keep ten in reserve. That is an
  application policy, not a second provider limit;
- IFrame playback itself does not spend Data API search calls.

## YouTube channel provenance and refresh

Artist rows carry:

- `youtube_channel_id`
- `youtube_channel_at`
- `youtube_channel_source` (`youtube`, `youtube_unverified`, `wikidata`, or
  `wikidata_unverified`; legacy values are refreshed over time)

`wikidata_channel_checks` stores per-MBID channel, validation, and checked time.
Wikidata identity can remain as CC0 source data, but API-derived titles,
existence checks, matches, and metadata are refreshed or deleted within 30
calendar days. Expired cache rows are pruned; API-derived channels are
revalidated. Never describe a YouTube API result as permanently cacheable.

Run the zero-search catalogue backfill with:

```bash
node scripts/backfill-channels.mjs
```

Keep its before/after coverage and validated/unverified/failed/deferred counts.
A local 2026-07-25 run found 1,146 mappings among 2,618 artists, but that does not
prove the production disk was backfilled. At scale, use a durable offline worker
or approved bulk source rather than placing public WDQS on the listener path.

## Images and attribution

Gallery preference is:

1. fan uploads that pass moderation and Pit's user-content terms;
2. Wikimedia Commons with visible attribution;
3. Openverse results whose underlying license/source has been recorded and is
   compatible with the use;
4. a drawn/no-photo fallback.

Google Images is **not a license source**. Any legacy `source:"google"` objects
are unverified, takedown-prone inventory and must not be expanded or described as
“safe.” Remove them, replace them with licensed media, or obtain permission
before broad marketing. A reactive takedown path is operationally useful but
does not create permission.

For CC-BY/BY-SA media, retain and surface at minimum creator, license/version,
source URL, and modification notice when required. Do not copy editorial bios
verbatim; use original copy, link out, or a compatible attributed extract.

## Pipeline rules

- Use official APIs or licensed/open bulk data, not HTML scraping around access
  controls.
- Keep source IDs and provenance beside normalized display data.
- Provider failure must preserve the last known good bounded cache, never erase
  an artist or rewrite a fact as “not found.”
- Separate discovery hints from assertions. MusicBrainz tag crawl buckets remain
  `tag_hint`; staff/provider evidence outranks them.
- Do not bundle full 10k+ discographies or image pools into startup JavaScript.
  Store roster/core identity in the DB and page/enrich heavy fields on demand.
- Long jobs belong in durable workers with persisted outcomes, retries, and
  operator visibility. An in-process scheduler is only the Alpha bridge.

Current commands include:

```bash
# Grow the DB roster through the resumable MusicBrainz path.
node scripts/seed-db-artists.mjs --add 10000

# Backfill evidence-backed genres in bounded runs.
node scripts/backfill-genres.mjs 500

# Discover channel identities without YouTube search.list.
node scripts/backfill-channels.mjs

# Warm fresh known-channel song matches without spending the search bucket.
npm run warm:youtube
```

Run production jobs against the persistent production data directory and record
their exact outcome in `HANDOFF.md`; a local file or UI target is not proof that
the production catalogue changed.
