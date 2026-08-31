import assert from "node:assert/strict";
import test from "node:test";
import { archiveShowKey } from "./artistArchiveKeys.js";
import { archiveShowKeyForPost } from "./postArchiveIdentity.js";

test("review projections receive a stable exact-show archive key", () => {
  assert.equal(
    archiveShowKeyForPost({
      kind: "review",
      artist: "Fallback artist",
      artist_key: "artist-key",
      venue: "Fallback venue",
      venue_key: "venue-key",
      date: "2026-08-31",
    }),
    archiveShowKey({ artistIdentity: "artist-key", venueIdentity: "venue-key", date: "2026-08-31" }),
  );
});

test("status and incomplete posts never manufacture exact-show keys", () => {
  assert.equal(archiveShowKeyForPost({ kind: "status", artist: "A", venue: "V", date: "2026-08-31" }), null);
  assert.equal(archiveShowKeyForPost({ kind: "review", artist: "A", venue: "V", date: "soon" }), null);
  assert.equal(archiveShowKeyForPost({ kind: "review", artist: "", venue: "V", date: "2026-08-31" }), null);
});
