#!/usr/bin/env node
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";
import { parseVenuePhotoBackfillArgs } from "./lib/venue-photo-backfill.mjs";
import {
  isMirroredVenuePhoto,
  pendingVenueMirrorCount,
  selectVenuePhotoMirrorBatch,
} from "./lib/venue-photo-mirror-batch.mjs";
import {
  mirrorLicensedVenuePhoto,
  venuePhotoMirrorConfigured,
} from "./lib/venue-photo-mirror.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, "..", "src", "seed", "catalog.venue-photos.verified.json");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TRANSIENT_RETRY_MS = Object.freeze([5_000, 15_000, 30_000]);

function retryableMirrorFailure(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return ["SOURCE_FETCH_FAILED", "SOURCE_TIMEOUT", "STORAGE_TIMEOUT", "STORAGE_UPLOAD_FAILED"]
    .includes(code)
    || ((code === "SOURCE_HTTP_ERROR" || code === "STORAGE_HTTP_ERROR")
      && /HTTP (?:429|5\d\d)\b/u.test(message));
}

async function mirrorWithBackoff({ venueKey, photo, delayMs }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const mirrored = await mirrorLicensedVenuePhoto({
        venueKey,
        photo,
        env: process.env,
      });
      if (delayMs) await sleep(delayMs);
      return mirrored;
    } catch (error) {
      const retryMs = TRANSIENT_RETRY_MS[attempt];
      if (retryMs == null || !retryableMirrorFailure(error)) throw error;
      console.warn(`${venueKey}: ${error?.code || "mirror failed"} (${error?.message}); retrying in ${retryMs}ms`);
      await sleep(retryMs);
    }
  }
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

async function main() {
  if (!venuePhotoMirrorConfigured(process.env)) {
    throw new Error("Public media storage is not configured. Load the existing MEDIA_* environment before mirroring.");
  }
  const options = parseVenuePhotoBackfillArgs(process.argv.slice(2));
  const existing = JSON.parse(await readFile(OUTPUT, "utf8"));
  const batch = selectVenuePhotoMirrorBatch(Object.entries(existing), options);
  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      venues: batch.selected.length,
      photos: batch.selected.reduce((sum, [, row]) =>
        sum + pendingVenueMirrorCount(row, process.env), 0),
      totalEligible: batch.totalEligible,
      nextCursor: batch.nextCursor,
      hasMore: batch.hasMore,
    }, null, 2));
    return;
  }

  let processed = 0;
  let mirrored = 0;
  let reused = 0;
  let failed = 0;
  let dirty = false;
  for (const [key, row] of batch.selected) {
    const pool = (Array.isArray(row?.galleryPool) ? row.galleryPool : [])
      .filter(licensedVenuePhoto);
    const nextPool = [];
    for (const raw of pool) {
      if (isMirroredVenuePhoto(raw, process.env)) {
        nextPool.push(raw);
        continue;
      }
      try {
        const stored = await mirrorWithBackoff({
          venueKey: key,
          photo: raw,
          delayMs: options.delayMs,
        });
        mirrored += 1;
        if (stored.mirror?.reused) reused += 1;
        dirty = true;
        nextPool.push(stored);
      } catch (error) {
        failed += 1;
        console.warn(`${key}: ${error?.code || "mirror failed"} (${error?.message || "no detail"})`);
        nextPool.push(raw);
      }
    }
    existing[key] = {
      ...row,
      galleryPool: nextPool,
      photos: nextPool.map((photo) => photo.uri),
    };
    processed += 1;
    if (processed % options.checkpointEvery === 0) {
      if (dirty) {
        await writeJsonAtomic(OUTPUT, existing);
        dirty = false;
      }
      console.log(JSON.stringify({ checkpoint: processed, cursor: key, mirrored, reused, failed }));
    }
  }
  if (dirty) await writeJsonAtomic(OUTPUT, existing);
  console.log(JSON.stringify({
    processed,
    mirrored,
    reused,
    failed,
    nextCursor: batch.hasMore ? batch.nextCursor : null,
    hasMore: batch.hasMore,
    resumeWith: batch.hasMore ? `--cursor=${batch.nextCursor}` : null,
  }));
}

await main();
