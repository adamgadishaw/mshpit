#!/usr/bin/env node
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";
import {
  mergeSuccessfulArtistPhotoMirrors,
  parseArtistPhotoMirrorArgs,
  selectArtistPhotoMirrorRows,
} from "./lib/artist-photo-mirror-batch.mjs";
import {
  mirrorLicensedArtistPhoto,
  venuePhotoMirrorConfigured,
} from "./lib/venue-photo-mirror.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "..", "src", "seed", "catalog.artist-photos.source.json");
const OUTPUT = resolve(HERE, "..", "src", "seed", "catalog.artist-photos.verified.json");

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value;
}

async function readJsonObject(path, label, { optional = false } = {}) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return {};
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON; refusing to replace it.`, { cause: error });
  }
  return jsonObject(parsed, label);
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function runVerifiedArtistPhotoMirror({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  mirror = mirrorLicensedArtistPhoto,
  outputPath = OUTPUT,
  sourcePath = SOURCE,
} = {}) {
  const options = parseArtistPhotoMirrorArgs(argv);
  const source = await readJsonObject(sourcePath, "Artist-photo source catalog");
  const existing = await readJsonObject(outputPath, "Verified artist-photo catalog", { optional: true });
  const selected = selectArtistPhotoMirrorRows(source, options);
  const authoritativeKeys = selectArtistPhotoMirrorRows(source).map(({ key }) => key);

  if (options.dryRun) {
    const summary = {
      dryRun: true,
      selected: selected.map(({ key, row }) => ({
        key,
        mbid: row.mbid,
        provenanceValid: !!licensedVenuePhoto(row.photo),
        alreadyVerified: Object.hasOwn(existing, key),
      })),
      verifiedEntries: Object.keys(existing).length,
    };
    logger.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  if (!venuePhotoMirrorConfigured(env)) {
    throw new Error("Public media storage is not configured; refusing to publish external artist-photo URLs.");
  }
  if (typeof mirror !== "function" || typeof fetchImpl !== "function") {
    throw new Error("Artist-photo mirroring requires an available mirror and fetch implementation.");
  }

  const successful = [];
  const failures = [];
  for (const { key, row } of selected) {
    try {
      const photo = await mirror({
        artistKey: key,
        photo: row.photo,
        env,
        fetchImpl,
      });
      successful.push({ key, artistKey: row.artistKey, mbid: row.mbid, photo });
    } catch (error) {
      failures.push(key);
      logger.warn(`${key}: ${error?.message || "Artist photo could not be mirrored."}`);
    }
  }

  const next = mergeSuccessfulArtistPhotoMirrors(existing, successful, { authoritativeKeys });
  if (successful.length || JSON.stringify(next) !== JSON.stringify(existing)) {
    await writeJsonAtomic(outputPath, next);
  }

  const summary = {
    dryRun: false,
    selected: selected.length,
    mirrored: successful.length,
    failed: failures.length,
    failedKeys: failures,
    verifiedEntries: Object.keys(next).length,
  };
  logger.log(JSON.stringify(summary));
  return summary;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runVerifiedArtistPhotoMirror();
  if (result.failed) process.exitCode = 1;
}
