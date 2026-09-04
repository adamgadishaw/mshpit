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
