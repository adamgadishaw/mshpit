import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runVerifiedArtistPhotoMirror } from "./mirror-verified-artist-photos.mjs";

test("a real mirror run removes revoked rows but preserves a present row whose refresh fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pit-artist-photo-"));
  const sourcePath = join(directory, "source.json");
  const outputPath = join(directory, "verified.json");
  const present = {
    artistKey: "bryson tiller",
    mbid: "d8fd8d9b-473b-4f06-83c8-869b1bb9de89",
    photo: { uri: "https://upload.wikimedia.org/bryson.png" },
  };
  const old = { ...present, photo: { uri: "https://media.example/old.webp" } };
  try {
    await writeFile(sourcePath, JSON.stringify({ "bryson tiller": present }));
    await writeFile(outputPath, JSON.stringify({
      "bryson tiller": old,
      "revoked artist": { artistKey: "revoked artist", mbid: null, photo: { uri: "old" } },
    }));
    const result = await runVerifiedArtistPhotoMirror({
      argv: [], sourcePath, outputPath,
      env: {
        MEDIA_ENDPOINT: "https://objects.example",
        MEDIA_BUCKET: "bucket",
        MEDIA_REGION: "auto",
        MEDIA_ACCESS_KEY_ID: "id",
        MEDIA_SECRET_ACCESS_KEY: "secret",
        MEDIA_PUBLIC_BASE_URL: "https://media.example",
      },
      fetchImpl: async () => { throw new Error("unused"); },
      mirror: async () => { throw new Error("refresh failed"); },
      logger: { log() {}, warn() {} },
    });
    assert.equal(result.failed, 1);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), { "bryson tiller": old });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a real mirror run preserves valid artist focal metadata on the verified record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pit-artist-photo-focal-"));
  const sourcePath = join(directory, "source.json");
  const outputPath = join(directory, "verified.json");
  const photo = {
    uri: "https://upload.wikimedia.org/bryson.png",
    focalPoint: { x: 0.43, y: 0.2 },
  };
  try {
    await writeFile(sourcePath, JSON.stringify({
      "bryson tiller": {
        artistKey: "bryson tiller",
        mbid: "d8fd8d9b-473b-4f06-83c8-869b1bb9de89",
        photo,
      },
    }));
    await writeFile(outputPath, "{}");
    const result = await runVerifiedArtistPhotoMirror({
      argv: ["--artist=bryson tiller"], sourcePath, outputPath,
      env: {
        MEDIA_ENDPOINT: "https://objects.example",
        MEDIA_BUCKET: "bucket",
        MEDIA_REGION: "auto",
        MEDIA_ACCESS_KEY_ID: "id",
        MEDIA_SECRET_ACCESS_KEY: "secret",
        MEDIA_PUBLIC_BASE_URL: "https://media.example",
      },
      fetchImpl: async () => { throw new Error("unused"); },
      mirror: async () => ({ uri: "https://media.example/new.webp" }),
      logger: { log() {}, warn() {} },
    });
    assert.equal(result.mirrored, 1);
    const verified = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(verified["bryson tiller"].photo.focalPoint, { x: 0.43, y: 0.2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a mirror replacement archives both old and new immutable photo credits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pit-artist-photo-credit-"));
  const sourcePath = join(directory, "source.json");
  const outputPath = join(directory, "verified.json");
  const creditOutputPath = join(directory, "credits.json");
  const oldId = "1".repeat(48);
  const newId = "2".repeat(48);
  const record = (id, title) => ({
    uri: `https://media.example/artists/licensed/example/${id}.webp`,
    source: "licensed",
    provenanceSource: "commons",
    title,
    creator: "Example Photographer",
    license: "CC-BY-3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourcePage: `https://commons.wikimedia.org/wiki/File:${title}`,
    modificationNotice: "Resized and converted to WebP.",
    mirror: { objectKey: `artists/licensed/example/${id}.webp` },
  });
  const existing = {
    artistKey: "example artist",
    mbid: null,
    photo: record(oldId, "Old.jpg"),
  };
  try {
    await writeFile(sourcePath, JSON.stringify({
      "example artist": {
        artistKey: "example artist",
        mbid: null,
        photo: { ...record(newId, "New.jpg"), uri: "https://upload.wikimedia.org/new.jpg" },
      },
    }));
    await writeFile(outputPath, JSON.stringify({ "example artist": existing }));
    await writeFile(creditOutputPath, "{}");
    await runVerifiedArtistPhotoMirror({
      argv: [], sourcePath, outputPath, creditOutputPath,
      env: {
        MEDIA_ENDPOINT: "https://objects.example",
        MEDIA_BUCKET: "bucket",
        MEDIA_REGION: "auto",
        MEDIA_ACCESS_KEY_ID: "id",
        MEDIA_SECRET_ACCESS_KEY: "secret",
        MEDIA_PUBLIC_BASE_URL: "https://media.example",
      },
      fetchImpl: async () => { throw new Error("unused"); },
      mirror: async () => record(newId, "New.jpg"),
      logger: { log() {}, warn() {} },
    });
    const archive = JSON.parse(await readFile(creditOutputPath, "utf8"));
    assert.equal(archive[oldId].photo.title, "Old.jpg");
    assert.equal(archive[newId].photo.title, "New.jpg");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
