// Split the scraped catalogue into a small core the app needs at startup and a
// heavy tail it only needs on an artist page.
//
//   node scripts/split-catalog.mjs [--check]
//
// `catalog.generated.json` is the scraper's output and stays exactly as it is
// (an automated job rewrites it, so its shape is not ours to change). This
// derives two files from it:
//
//   catalog.core.json    name/genre/photo/topTracks/popularity/country/mbid …
//                        everything the store touches to boot: search, the
//                        recommendation pool, Discover's stats, venue lookup.
//   catalog.venue-photos.json  venue photo pools, required on demand by the
//                        venue screen, so they ship but are not allocated at
//                        launch. There is no server source for these.
//
// Artist discographies (3.9 MB) are simply DROPPED: the artist page already
// prefers the live server discography, so a second stale copy in every bundle
// bought nothing. That is what took the web bundle from 8.28 MB to 4.8 MB, and
// the startup catalogue from 9.65 MB to 1.24 MB. They remain in
// catalog.generated.json if anything ever needs them again.
//
// `--check` verifies the derived files are in sync instead of writing them, so
// a stale split fails the build rather than silently shipping old data.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "src", "seed");
const SOURCE = join(SEED, "catalog.generated.json");
const CORE = join(SEED, "catalog.core.json");
const VENUE_PHOTOS = join(SEED, "catalog.venue-photos.json");

// Fields no screen needs until it is opened. Artist discographies are dropped
// from the bundle entirely (the server serves them); venue photo pools have no
// server equivalent, so they are split into a file the venue screen requires on
// demand — bundled, but not allocated during startup.
const DEFERRED = ["albums", "galleryPool", "photos"];

function build() {
  const source = JSON.parse(readFileSync(SOURCE, "utf8"));
  const core = { ...source, artists: {} };
  const deferred = {};

  const split = (collection, into) => {
    const slimmed = {};
    for (const [key, entry] of Object.entries(collection || {})) {
      const slim = {};
      const heavy = {};
      for (const [field, value] of Object.entries(entry || {})) {
        if (DEFERRED.includes(field)) heavy[field] = value;
        else slim[field] = value;
      }
      slimmed[key] = slim;
      if (Object.keys(heavy).length) into[key] = heavy;
    }
    return slimmed;
  };

  const venuePhotos = {};
  core.artists = split(source.artists, deferred);
  core.venues = split(source.venues, venuePhotos);
  return { core, deferred, venuePhotos };
}

const { core, deferred, venuePhotos } = build();
const coreText = JSON.stringify(core);
const venuePhotosText = JSON.stringify(venuePhotos);

if (process.argv.includes("--check")) {
  const stale = (path, expected) => !existsSync(path) || readFileSync(path, "utf8") !== expected;
  if (stale(CORE, coreText) || stale(VENUE_PHOTOS, venuePhotosText)) {
    console.error("catalog split is stale. Run: node scripts/split-catalog.mjs");
    process.exit(1);
  }
  console.log("catalog split is in sync.");
  process.exit(0);
}

writeFileSync(CORE, coreText);
writeFileSync(VENUE_PHOTOS, venuePhotosText);

const mb = (s) => (Buffer.byteLength(s) / 1048576).toFixed(2);
console.log(`source              ${mb(readFileSync(SOURCE, "utf8"))} MB`);
console.log(`discographies dropped from the bundle`);
console.log(`core (startup)      ${mb(coreText)} MB`);
console.log(`venue photos (lazy) ${mb(venuePhotosText)} MB`);
