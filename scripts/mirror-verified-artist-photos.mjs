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
const CREDIT_OUTPUT = resolve(HERE, "..", "src", "seed", "catalog.photo-credits.json");
const MIRRORED_OBJECT_KEY = /^artists\/licensed\/[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?\/([a-f0-9]{48})\.webp$/u;

function jsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value;
}

function normalizedFocalPoint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return Object.freeze({ x, y });
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

function archivedCreditRow(row) {
  const photo = licensedVenuePhoto(row?.photo);
  const title = typeof row?.photo?.title === "string" ? row.photo.title.trim() : "";
  const objectKey = typeof row?.photo?.mirror?.objectKey === "string"
    ? row.photo.mirror.objectKey
    : "";
  const match = MIRRORED_OBJECT_KEY.exec(objectKey);
  if (!photo || !title || !match) return null;
  try {
    const path = decodeURIComponent(new URL(photo.uri).pathname);
    if (!path.endsWith(`/${objectKey}`)) return null;
  } catch {
    return null;
  }
  return {
    id: match[1],
    row: {
      artistKey: row.artistKey,
      ...(row.mbid ? { mbid: row.mbid } : {}),
      photo: row.photo,
    },
  };
}

function appendPhotoCredits(archive, rows) {
  const next = { ...archive };
  for (const row of rows) {
    const credit = archivedCreditRow(row);
    if (credit && !Object.hasOwn(next, credit.id)) next[credit.id] = credit.row;
  }
  return next;
}

export async function runVerifiedArtistPhotoMirror({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  logger = console,
  mirror = mirrorLicensedArtistPhoto,
  outputPath = OUTPUT,
  creditOutputPath = outputPath === OUTPUT ? CREDIT_OUTPUT : null,
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
      const mirroredPhoto = await mirror({
        artistKey: key,
        photo: row.photo,
        env,
        fetchImpl,
      });
      const focalPoint = normalizedFocalPoint(row.photo?.focalPoint);
      const photo = focalPoint ? { ...mirroredPhoto, focalPoint } : mirroredPhoto;
      successful.push({ key, artistKey: row.artistKey, mbid: row.mbid, photo });
    } catch (error) {
      failures.push(key);
      logger.warn(`${key}: ${error?.message || "Artist photo could not be mirrored."}`);
    }
  }

  const next = mergeSuccessfulArtistPhotoMirrors(existing, successful, { authoritativeKeys });
  if (creditOutputPath) {
    const creditArchive = await readJsonObject(creditOutputPath, "Photo-credit archive", { optional: true });
    const nextCreditArchive = appendPhotoCredits(creditArchive, [
      ...Object.values(existing),
      ...Object.values(next),
    ]);
    if (JSON.stringify(nextCreditArchive) !== JSON.stringify(creditArchive)) {
      // Archive first: a later verified-catalog write can fail without losing
      // the attribution record for a photo that was about to be replaced.
      await writeJsonAtomic(creditOutputPath, nextCreditArchive);
    }
  }
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
