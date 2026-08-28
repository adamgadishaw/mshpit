#!/usr/bin/env node
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INVENTORY = join(HERE, "..", "src", "seed", "catalog.venue-photos.verified.json");

// Exact, manually verified false matches from the 2026-08 venue-photo audit.
// The general relevance gate prevents these classes of mismatch in new runs;
// this list safely removes already-mirrored inventory without blocking a future
// legitimate photo for the same venue.
export const QUARANTINED_SOURCE_PAGES = new Set([
  "https://commons.wikimedia.org/wiki/File:Brig_Beaver_and_Boston_Tea_Party_Museum_(8615909759).jpg",
  "https://commons.wikimedia.org/wiki/File:Brig_Beaver_and_Boston_Tea_Party_Museum_(8615909643).jpg",
  "https://commons.wikimedia.org/wiki/File:Boston_Tea_Party_Museum,_with_Brig_Beaver_(8637746368).jpg",
  "https://commons.wikimedia.org/wiki/File:Bayou_4th_Washington_Crosses_the_Bayou.JPG",
  "https://commons.wikimedia.org/wiki/File:The_well_trimmed_beech_tree_avenue_leading_to_Temple_Newsam_house_-_geograph.org.uk_-_4962930.jpg",
]);

export function quarantineInvalidVenuePhotos(inventory) {
  const next = structuredClone(inventory || {});
  let removedPhotos = 0;
  let removedVenues = 0;
  for (const [key, row] of Object.entries(next)) {
    const before = Array.isArray(row?.galleryPool) ? row.galleryPool : [];
    const galleryPool = before.filter((photo) => !QUARANTINED_SOURCE_PAGES.has(photo?.sourcePage));
    removedPhotos += before.length - galleryPool.length;
    if (!galleryPool.length) {
      if (before.length) {
        delete next[key];
        removedVenues += 1;
      }
      continue;
    }
    if (galleryPool.length !== before.length) {
      next[key] = { ...row, galleryPool, photos: galleryPool.map((photo) => photo.uri) };
    }
  }
  return { inventory: next, removedPhotos, removedVenues };
}

async function main() {
  const source = JSON.parse(await readFile(INVENTORY, "utf8"));
  const result = quarantineInvalidVenuePhotos(source);
  if (!result.removedPhotos) {
    console.log(JSON.stringify({ removedPhotos: 0, removedVenues: 0 }));
    return;
  }
  const temporary = `${INVENTORY}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(result.inventory, null, 2));
    await rename(temporary, INVENTORY);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  console.log(JSON.stringify({
    removedPhotos: result.removedPhotos,
    removedVenues: result.removedVenues,
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
