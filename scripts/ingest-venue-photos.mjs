#!/usr/bin/env node
// Compatibility entry point. Venue images are no longer accepted merely for
// being geographically near a venue; the verified backfill requires the
// Commons file title to name the venue and city/GPS evidence to locate it.
await import("./backfill-verified-venue-photos.mjs");
