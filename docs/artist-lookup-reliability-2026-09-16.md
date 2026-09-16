# Artist lookup recovery — September 16, 2026

## Incident boundary

The September 16 01:01:56 UTC alert belongs to request
`ccc61acb-7ba6-4f15-a012-c8abd4cdb9aa` on release `a5727ba`.
Render also recorded a new `/api/artists/resolve` upstream failure at
16:38:55 UTC. These are failed HTTP lookups, not evidence identifying a
particular member or proving that the entire process crashed. Query text and
member identities are intentionally absent from these diagnostic records.

## Repairs

- Composer typeahead searches the saved catalogue. Remote resolution requires
  an explicit action, so pauses while typing a partial name do not spend
  external provider capacity.
- Search and composer directory requests are abortable, duplicate-click
  guarded, account-scoped, and respect bounded manual retry cooldowns. Failed
  refreshes retain same-query results; a failure is not presented as no match.
- Search results retain their canonical identity and transient-preview flag.
- Unique exact Deezer fallback successes are cached separately from artist
  records. The cache stores only a name and numeric provider ID, has a hard
  24-hour expiry, and is capped at 5,000 rows using an indexed, atomic write.
  It downloads no images and is never authority to attach or edit an artist.
- The lookup order is saved catalogue/reviewed aliases, remembered exact
  MusicBrainz identity, unexpired fallback cache, then bounded provider work.
- Newly ambiguous MusicBrainz previews are not persisted as the lasting answer
  for a name. Existing read-only preview behavior is unchanged.
- Recoverable optional-cache write failures (busy, locked, read-only, full)
  do not discard an otherwise successful provider response. Schema errors and
  corruption still surface, and storage-health monitoring remains enabled.

## Deliberate limits

An artist never seen before still needs a working provider to establish a
trustworthy identity. If providers fail, the client preserves the search/post
draft and offers a deliberate retry; the API does not invent a success or a
not-found result. Provider failures remain in operational logs and alerts.
Authoritative artist creation and attachment still require their existing
authenticated validation. No service plan or billing settings are changed.

## Release verification

Unit and integration checks must cover provider-disabled cache reads, restart,
expiry, bounded disk growth, ambiguous identities, cancellation, rapid clicks,
account transitions, and storage pressure. Browser checks should exercise
failed lookup, disabled premature retry, and successful explicit retry.

Local test success is not proof of production recovery: verify the deployed
commit, expected Russ identity, saved Discover links, and media-worker revision
after publication. The previous three commits were still local when this
incident was investigated; production publication remains a separate step.
