import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  activeYouTubeVideoRejections,
  withYouTubeVideoRejection,
  youtubeVideoRejectionStorageKey,
  youtubeVideoRejectionSource,
  youtubeRejectedVideoIds,
  youtubeVideoWasRejected,
} from "./youtubeVideoRejections.mjs";

test("terminal video tombstones are exact, account-scoped, bounded, and expiring", () => {
  const at = Date.parse("2026-08-21T12:00:00Z");
  const rejected = withYouTubeVideoRejection([], "One", "U2", "deadpin0001", at);
  assert.equal(youtubeVideoWasRejected(rejected, " one ", "u2", "deadpin0001", at), true);
  assert.equal(youtubeVideoWasRejected(rejected, "One", "U2", "another0001", at), false);
  assert.equal(youtubeVideoWasRejected(rejected, "One Tree Hill", "U2", "deadpin0001", at), false);
  assert.notEqual(youtubeVideoRejectionStorageKey("account-a"), youtubeVideoRejectionStorageKey("account-b"));
  assert.deepEqual(youtubeRejectedVideoIds(rejected, "One", "U2", at), ["deadpin0001"]);
  assert.deepEqual(youtubeRejectedVideoIds(rejected, "One Tree Hill", "U2", at), []);
  assert.deepEqual(activeYouTubeVideoRejections(rejected, at + 31 * 24 * 60 * 60 * 1000), []);

  let many = [];
  for (let index = 0; index < 120; index += 1) {
    const id = `v${String(index).padStart(10, "0")}`;
    many = withYouTubeVideoRejection(many, `Song ${index}`, "Artist", id, at + index);
  }
  assert.equal(many.length, 100);
});

test("terminal tombstones are isolated between same-display provider recordings", () => {
  const at = Date.parse("2026-08-21T12:00:00Z");
  const videoId = "deadpin0001";
  const feature = { provider: " Deezer ", sourceId: "42002" };
  const solo = { provider: "deezer", sourceId: "41001" };
  const rejected = withYouTubeVideoRejection([], "Same Song", "Artist", videoId, feature, at);
  assert.equal(youtubeVideoWasRejected(rejected, "same song", "artist", videoId, feature, at), true);
  assert.equal(youtubeVideoWasRejected(rejected, "Same Song", "Artist", videoId, solo, at), false);
  assert.deepEqual(youtubeRejectedVideoIds(rejected, "Same Song", "Artist", feature, at), [videoId]);
  assert.deepEqual(youtubeRejectedVideoIds(rejected, "Same Song", "Artist", solo, at), []);
  assert.equal(
    youtubeVideoWasRejected(rejected, "Same Song", "Artist", videoId, at),
    false,
    "legacy callers retain their no-source namespace instead of inheriting a provider tombstone",
  );
  assert.deepEqual(youtubeVideoRejectionSource({ provider: "Spotify", sourceId: "AbC123" }), {
    provider: "spotify",
    sourceId: "AbC123",
  });
  assert.equal(youtubeVideoRejectionSource({ provider: "deezer", sourceId: "not-numeric" }), null);
  assert.equal(youtubeVideoRejectionSource({ provider: "youtube", sourceId: videoId }), null);
});

test("client resolver and invalidation callers preserve the provider source scope", async () => {
  const store = await readFile(new URL("../store.js", import.meta.url), "utf8");
  assert.match(store, /youtubeRejectedVideoIds\(currentYouTubeRejections\(\)\.entries, title, artist, source\)/);
  assert.match(store, /youtubeVideoRejected\(title, artist, outcome\.videoId, source\)/);
  assert.match(store, /withYouTubeVideoRejection\(ledger\.entries, title, artist, videoId, source\)/);
  assert.match(store, /const scopedSource = youtubeVideoRejectionSource\(source\)/);
  assert.match(store, /body:\s*\{[\s\S]*videoId,[\s\S]*\.\.\.\(scopedSource \|\| null\)/,
    "the server invalidation request must identify the provider recording");
});
