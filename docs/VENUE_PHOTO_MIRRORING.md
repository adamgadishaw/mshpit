# Verified venue-photo mirroring

Venue-photo discovery and venue-photo mirroring are deliberately separate steps.
Discovery may submit only records accepted by `licensedVenuePhoto`; mirroring does
not infer rights from an image host, filename, provider credit, or search result.

`scripts/lib/venue-photo-mirror.mjs` is an offline-ingestion helper. It:

- accepts one complete licensed venue-photo record and a stable venue key;
- downloads only HTTPS images from exact reviewed hosts;
- revalidates every redirect, response type, byte limit, and decoded pixel limit;
- removes embedded metadata and writes a bounded WebP derivative;
- uploads to the existing public media bucket with `If-None-Match: *`;
- verifies bytes before treating an existing deterministic object as reusable;
- returns the MSHpit-hosted URI while retaining creator, licence, licence URL,
  source page, provider provenance, and modification notices.

It never runs in an API request or page render. Provider ingestion should call:

```js
const mirrored = await mirrorLicensedVenuePhoto({ venueKey, photo, env: process.env });
```

and store the returned record in the generated venue-photo catalogue.

For an already verified catalogue, use the mirror-only pass so no provider
search is repeated:

```powershell
node --env-file=.env scripts/mirror-verified-venue-photos.mjs --all --dry-run
node --env-file=.env scripts/mirror-verified-venue-photos.mjs --all --checkpoint-every=5
```

The command writes atomic checkpoints and prints a cursor that can resume an
interrupted batch. Existing exact MSHpit mirror records are skipped.

## Environment

The helper reuses the existing public-media configuration:

- `MEDIA_ENDPOINT`
- `MEDIA_BUCKET`
- `MEDIA_REGION`
- `MEDIA_ACCESS_KEY_ID`
- `MEDIA_SECRET_ACCESS_KEY`
- `MEDIA_PUBLIC_BASE_URL`

No database migration or new storage credential is required. By default only
`upload.wikimedia.org` is accepted as an image host. Additional exact hosts can
be added after a security and rights review with the comma-separated
`VENUE_PHOTO_MIRROR_SOURCE_HOSTS` variable. Wildcards are rejected.

Storage CORS is irrelevant to this offline server-side transfer. The credential
must permit `PutObject` and authenticated `GetObject` on `venues/licensed/*`.
The public delivery base must serve that prefix.
