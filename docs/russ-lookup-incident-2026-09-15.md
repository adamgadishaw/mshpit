# Russ lookup failure — 2026-09-15

## Evidence

- Render recorded `GET /api/artists/resolve` failures at 2026-09-16 01:01:44 UTC and 01:01:56 UTC (September 15, 9:01 p.m. Toronto). Both were `PROVIDER_UNAVAILABLE` caused by `ArtistLookupTimeoutError/provider_timeout`; the first took 6,344 ms and the second 1 ms.
- The user identified the attempted artist as Russ. Logs intentionally do not retain search text, so this association comes from the user, not a captured query.
- A subsequent public, local-only search for `Russ` returned Russkaja, Russ Yallop, Russell Allen and Russell B., but no exact Russ. `/api/resolve?path=%2Fartist%2Fruss` returned `entity: null`. Both checked-in catalogues also lacked an exact Russ entry.
- The resolver checks saved identities before contacting providers. For absent identities, the bounded lookup has a six-second deadline and a thirty-second failure cooldown. The second response is consistent with that cooldown; it is not evidence of a second full lookup or a whole-server crash.

## Repair

Register the US rapper Russ through the existing insert-only reviewed-identity mechanism. [MusicBrainz](https://musicbrainz.org/artist/9ddf4b19-dd14-45d9-b056-49541b16dc80) identifies him as the US rapper with releases including *There's Really a Wolf*, *ZOO* and *SANTIAGO*. [Wikidata](https://www.wikidata.org/wiki/Q26706877) independently links the same MusicBrainz ID. Russ Millions is a separate identity and must not be merged.

The startup repair adds only the reviewed name, ID and citation. It preserves existing rows, claimed profiles and metadata, skips conflicting identities, and reuses an existing identical provider ID under another key. It creates no records during public GET requests and downloads no media or catalogue archive.

Once deployed and successfully seeded, local search, resolution and the public artist route can use the saved identity without waiting for MusicBrainz. Existing bounded enrichment can fill eligible missing details separately. This does not guarantee biography or show-date coverage, or eliminate provider failures for other uncatalogued artists.

The wider Discover repair in commit `1c44668` passes saved keys and public slugs through chart links and returns saved metadata with profile reads, removing unnecessary provider-dependent navigation for artists already in the catalogue.

## Release verification

Verification passed: the complete isolated suite reports **4,991/4,991 tests**, with syntax checks for 624 Node files and architecture checks also passing. The provider-disabled, read-only Russ regression covers search/resolution, the public route, profile and live summary. Registry tests cover repeat seeding, preservation of conflicting rows and owner content, reuse of an existing identical provider ID under another key, and separation from Russ Millions.

After deployment, verify the public search returns the expected ID and `/api/resolve?path=%2Fartist%2Fruss` returns the registered artist. A successful local test or commit alone does not establish production recovery.

At investigation time, the live web release was `a5727ba`; `1c44668` and this additional repair had not been pushed. Publication was paused pending explicit approval for `origin/master` after the push safety check blocked that operation.
