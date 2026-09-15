# Automatic artist knowledge enrichment

This is a missing-field worker for existing catalog rows, not a whole-database
mirror or a provider request in the artist-page HTTP path. It fills biographies
and country information from Wikimedia. It does not add artists, infer names,
copy photographs, modify genres, verify accounts, or change memorial policy.

## Identity and publishing

- A valid existing MusicBrainz ID must resolve to exactly one Wikidata item.
  The item must independently contain the same, non-deprecated P434 identity.
- Its English Wikipedia article must identify the same Wikidata item, be in
  the main namespace, and not be a disambiguation page.
- Store at most 1,200 codepoints of plaintext introduction with the page URL,
  revision URL, retrieval time, exact MBID/QID, and CC BY-SA 4.0 attribution.
  App and server-rendered biographies link to contributors, source revision,
  license, and identify the edited excerpt. Do not remove this attribution.
- Country is filled only from an unambiguous P495/P27 relationship with an
  English label. Missing/ambiguous information stays missing.
- Existing bios/countries and profile edits win. Biography importing skips any
  artist with a managed profile row, including an intentionally empty one.
  Recheck the current row after every download. Changed identities and lost
  claims cannot receive results fetched for the previous artist.
- Imported fields invalidated by an identity correction are hidden until a
  verified replacement is available; unrelated editorial text stays intact.

## Runtime and controls

`ARTIST_KNOWLEDGE_ENABLED=true` enables the worker on Render. The Blueprint
sets it explicitly; other deployments must set it separately. Set `false` to
pause. This does not enable `CACHE_WARM_ENABLED` or paid provider access.
`ARTIST_KNOWLEDGE_BATCH` accepts 1–10; default 10.

The first pass waits three minutes after startup, then runs every 15 minutes.
Each pass uses the shared background memory-admission coordinator, at most ten
artists, one serial Wikimedia request per 1.1 seconds, eight-second request
deadlines, 512 KiB JSON limits and a 45-second total pass deadline. It stops on
provider failure and durably backs off, honoring Retry-After. No immediate retry
storm. Shutdown aborts work and waits before closing SQLite.

Before any network work, require at least 256 MiB free disk space and twice the
combined SQLite/WAL size for snapshot headroom. Unknown metrics pause enrichment.
This is a conservative guard, not a replacement for monitoring disk/WAL/backups.

`artist_knowledge_checks` stores one foreign-keyed checkpoint per artist.
Ten-minute claims recover interrupted processes; completed and unmatched
records cool down for 30 days. Filled rows are not downloaded again unless
fields become missing or the identity changes. A provider outage is recorded
as failure, never as evidence that an artist does not exist.

Logs contain aggregate counts only (`[pit] artist knowledge`). `app_meta` key
`artist-knowledge:v1:last-pass` contains the latest completed batch counts/time;
`artist-knowledge:v1:cooldown` is the provider-wide not-before epoch in ms.
The ledger and attribution are part of normal SQLite backups. On identity
correction, only proven stale imported display fields are cleared; one previous
source record remains private for review while missing fields become refillable.
No staff or owner text is cleared by that reconciliation. Do not bulk erase
checkpoints to accelerate a pass during an outage. No production backfill was
executed manually as part of implementation; runtime advances gradually.

## Coverage limits and verification

Artists without reliable MBIDs or linked English articles remain unchanged.
This does not fix unresolved new-artist MusicBrainz lookups or other providers'
outages. Future country/bio refresh policies must retain provenance and staff
authority. There is no paid API key or hosting-plan upgrade in this change.

Run `node scripts/run-tests.mjs server/artistKnowledge*.test.mjs` with a shell
that expands the pattern, or `npm test` for all hermetic regressions. Fixtures
cover invalid identities, ambiguity, redirects, provider errors, maxlag, body
bounds, cancellation, concurrent edits, restart/lease recovery, sparse catalog
upserts, explicit biography clears and app/SSR attribution.

Sources: [Wikidata data access](https://www.wikidata.org/wiki/Wikidata:Data_access),
[MediaWiki API etiquette](https://www.mediawiki.org/wiki/API:Etiquette),
[Wikimedia reuse terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use).
