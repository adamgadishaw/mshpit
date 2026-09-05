#!/usr/bin/env node
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";
import {
  commonsVenuePhotoLookupUrl, isRelevantCommonsVenuePhoto, parseVenuePhotoBackfillArgs,
  selectVenuePhotoBackfillBatch,
} from "./lib/venue-photo-backfill.mjs";
import {
  mirrorLicensedVenuePhoto,
  venuePhotoMirrorConfigured,
} from "./lib/venue-photo-mirror.mjs";
import {
  buildVenuePhotoInventory,
  readTourDateVenueRows,
  resolveVenuePhotoDatabasePath,
  venuePhotoCoverageReport,
} from "./lib/venue-photo-inventory.mjs";
import {
  readVenuePhotoBackfillState,
  resolveVenuePhotoBackfillStatePath,
  writeVenuePhotoBackfillState,
} from "./lib/venue-photo-backfill-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "src", "seed", "catalog.generated.json");
const OUTPUT = join(HERE, "..", "src", "seed", "catalog.venue-photos.verified.json");
const UA = "MshpitVenuePhotoAudit/1.0 (https://mshpit.com; founder@mshpit.com)";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LICENSE_IDS = Object.freeze({
  "CC BY 2.0": "CC-BY-2.0", "CC BY-SA 2.0": "CC-BY-SA-2.0",
  "CC BY 3.0": "CC-BY-3.0", "CC BY-SA 3.0": "CC-BY-SA-3.0",
  "CC BY 4.0": "CC-BY-4.0", "CC BY-SA 4.0": "CC-BY-SA-4.0",
  "CC0 1.0": "CC0-1.0", "PUBLIC DOMAIN MARK 1.0": "PDM-1.0",
});
const text = (value) => String(value || "").replace(/<[^>]*>/gu, " ")
  .replace(/&quot;/gu, '"').replace(/&#0?39;|&apos;/gu, "'").replace(/&amp;/gu, "&")
  .replace(/\s+/gu, " ").trim();

function project(page) {
  const info = page.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const licensed = licensedVenuePhoto({
    uri: info?.thumburl || info?.url,
    sourcePage: info?.descriptionurl,
    creator: text(meta.Artist?.value || meta.Credit?.value),
    license: LICENSE_IDS[text(meta.LicenseShortName?.value).toUpperCase()],
    licenseUrl: meta.LicenseUrl?.value,
    source: "commons",
  });
  return licensed ? { ...licensed, providerTitle: text(page.title) } : null;
}

async function lookup(venue) {
  const url = commonsVenuePhotoLookupUrl(venue);
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Commons ${response.status}`);
  return Object.values((await response.json()).query?.pages || {})
    .filter((page) => isRelevantCommonsVenuePhoto(page, venue))
    .map(project).filter(Boolean).slice(0, 3);
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2));
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

async function mirrorPool(key, photos) {
  if (!venuePhotoMirrorConfigured(process.env)) {
    throw new Error("Public media storage is required before verified venue photos can be published.");
  }
  const mirrored = [];
  for (const photo of photos) {
    // Replacement is all-or-nothing. A failed provider download or storage
    // upload leaves the previous verified row untouched and will retry later.
    mirrored.push(await mirrorLicensedVenuePhoto({ venueKey: key, photo, env: process.env }));
  }
  return mirrored;
}

async function main() {
  const options = parseVenuePhotoBackfillArgs(process.argv.slice(2));
  if (!options.dryRun && !venuePhotoMirrorConfigured(process.env)) {
    throw new Error("Public media storage is not configured; refusing to publish external venue-photo URLs.");
  }
  const source = JSON.parse(await readFile(SOURCE, "utf8"));
  // --replace means re-query selected venues; it deliberately does not erase
  // other verified rows before a replacement succeeds.
  const existing = JSON.parse(await readFile(OUTPUT, "utf8").catch(() => "{}"));
  const databasePath = resolveVenuePhotoDatabasePath(options.databasePath);
  const tourDates = options.catalogOnly
    ? { available: false, reason: "catalog-only", rows: [] }
    : readTourDateVenueRows(databasePath, { limit: options.inventoryLimit });
  if (!options.catalogOnly && process.env.PIT_DATA_DIR && !tourDates.available) {
    throw new Error(`Production tour-date venue inventory is unavailable (${tourDates.reason}).`);
  }
  const inventory = buildVenuePhotoInventory(source.venues || {}, tourDates.rows);
  const coverageBefore = venuePhotoCoverageReport(inventory, existing);
  const useProgressState = !options.dryRun
    && options.useProgressState
    && !options.all
    && !options.replace
    && options.offset === 0;
  const progressStatePath = useProgressState
    ? resolveVenuePhotoBackfillStatePath(databasePath, options.statePath)
    : null;
  const savedProgress = progressStatePath && !options.cursor
    ? await readVenuePhotoBackfillState(progressStatePath)
    : null;
  const progressCursor = options.cursor || savedProgress?.cursor || null;
  const batch = selectVenuePhotoBackfillBatch(
    inventory.entries,
    existing,
    {
      ...options,
      cursor: progressCursor,
      wrap: useProgressState,
      allowStaleCursor: useProgressState && !options.cursor,
    },
  );

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      coverageOnly: options.coverageOnly,
      tourDateDatabase: tourDates.available ? "available" : tourDates.reason,
      inventory: inventory.stats,
      coverage: coverageBefore,
      selected: options.coverageOnly ? [] : batch.selected.map(([key, venue]) => ({
        key,
        name: venue.name,
        sources: venue._inventoryOrigins || [],
      })),
      totalEligible: batch.totalEligible,
      nextCursor: batch.nextCursor,
      hasMore: batch.hasMore,
    }, null, 2));
    return;
  }

  let processed = 0;
  let filled = 0;
  let dirty = false;
  for (const [key, venue] of batch.selected) {
    try {
      const galleryPool = await mirrorPool(key, await lookup(venue));
      if (galleryPool.length) {
        existing[key] = {
          galleryPool,
          photos: galleryPool.map((photo) => photo.uri),
        };
        filled += 1;
        dirty = true;
      }
    } catch (error) {
      console.warn(`${venue.name}: ${error.message}`);
    }
    processed += 1;
    // Advance only after an attempt finishes. If the process dies mid-request,
    // the same venue is retried; ordinary provider misses cannot starve the
    // rest of the inventory across recurring runs.
    if (progressStatePath) {
      // Persist a successful catalogue addition before advancing its cursor.
      // This ordering avoids skipping newly mirrored media after a crash.
      if (dirty) {
        await writeJsonAtomic(OUTPUT, existing);
        dirty = false;
      }
      await writeVenuePhotoBackfillState(progressStatePath, key);
    }
    if (processed % options.checkpointEvery === 0) {
      if (dirty) {
        await writeJsonAtomic(OUTPUT, existing);
        dirty = false;
      }
      console.log(JSON.stringify({
        checkpoint: processed,
        cursor: key,
        filled,
      }));
    }
    if (options.delayMs) await sleep(options.delayMs);
  }
  if (dirty) await writeJsonAtomic(OUTPUT, existing);

  console.log(JSON.stringify({
    processed,
    filled,
    venuesWithPhotos: Object.keys(existing).length,
    photos: Object.values(existing)
      .reduce((sum, entry) => sum + (entry.galleryPool?.length || 0), 0),
    inventory: inventory.stats,
    coverageBefore,
    coverageAfter: venuePhotoCoverageReport(inventory, existing),
    nextCursor: batch.hasMore ? batch.nextCursor : null,
    hasMore: batch.hasMore,
    resumeWith: batch.hasMore ? `--cursor=${batch.nextCursor}` : null,
    progressCursor: progressStatePath ? batch.nextCursor : null,
  }));
}

await main();
