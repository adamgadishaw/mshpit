#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readTourDateVenueRows,
  resolveVenuePhotoDatabasePath,
} from "./lib/venue-photo-inventory.mjs";
import {
  buildVenuePhotoProviderBindings,
  serializeVenuePhotoProviderBindings,
} from "./lib/venue-photo-provider-bindings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "src", "seed");
const SOURCE = join(SEED, "catalog.generated.json");
const PHOTOS = join(SEED, "catalog.venue-photos.json");
const OUTPUT = join(SEED, "catalog.venue-photo-bindings.json");

function parseArgs(argv) {
  const options = { check: false, databasePath: null };
  for (const argument of argv) {
    if (argument === "--check") options.check = true;
    else if (argument.startsWith("--database=")) options.databasePath = argument.slice("--database=".length);
    else throw new Error(`Unknown venue-photo binding option: ${argument}`);
  }
  return options;
}

function writeAtomic(path, text) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, text);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const options = parseArgs(process.argv.slice(2));
const source = JSON.parse(readFileSync(SOURCE, "utf8"));
const photos = JSON.parse(readFileSync(PHOTOS, "utf8"));
const databasePath = resolveVenuePhotoDatabasePath(options.databasePath);
const tourDates = readTourDateVenueRows(databasePath);
if (!tourDates.available) {
  throw new Error(`Venue-photo provider bindings require the tour_dates database (${tourDates.reason}).`);
}
const generated = buildVenuePhotoProviderBindings(source.venues || {}, tourDates.rows, photos);
const outputText = serializeVenuePhotoProviderBindings(generated.bindings);

if (options.check) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, "utf8") !== outputText) {
    console.error("venue photo provider bindings are stale. Run: npm run generate:venue-photo-bindings");
    process.exitCode = 1;
  } else {
    console.log("venue photo provider bindings are in sync.");
  }
} else {
  writeAtomic(OUTPUT, outputText);
}

console.log(JSON.stringify({ databasePath, ...generated.stats }));
