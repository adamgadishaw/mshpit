import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-search-"));
process.env.PIT_DATA_DIR = dataDir;

const { artistRow, artistStmts, db } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("artist search rejects noninteger and invalid limits before every SQLite search branch", () => {
  for (const q of ["", "earl", "no-match-for-this-synthetic-query"]) {
    for (const limit of ["1.5", "NaN", "Infinity", "-Infinity", "-1", "0", "9007199254740992"]) {
      assert.throws(() => routes["GET /api/artists"]({ query: { q, limit }, ip: "127.0.0.1" }),
        error => error.status === 400 && error.code === "VALIDATION_FAILED", `${q}: ${limit}`);
    }
    for (const limit of [undefined, "", "1", "40", "41"]) {
      const result = routes["GET /api/artists"]({ query: { q, limit }, ip: "127.0.0.1" });
      assert.ok(Array.isArray(result.artists));
      assert.ok(result.artists.length <= (limit === "1" ? 1 : 40));
    }
  }
});

test("artist type-ahead uses indexed canonical and punctuation-folded prefixes", () => {
  artistStmts.upsert.run(artistRow("earl sweatshirt", {
    name: "Earl Sweatshirt",
    mbid: "b9f4edcf-7f05-4f37-a565-cc4c1f6cfb78",
    rank_score: 80,
  }, "musicbrainz"));

  const rows = artistStmts.searchPrefix.all(
    "earl",
    "earl\uffff",
    "earl",
    "earl\uffff",
    "earl",
    "earl",
    8,
  );
  assert.ok(rows.some((row) => row.name === "Earl Sweatshirt"));

  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT norm FROM artists
    WHERE (norm >= ? AND norm < ?) OR (search_key >= ? AND search_key < ?)`)
    .all("earl", "earl\uffff", "earl", "earl\uffff")
    .map((row) => row.detail)
    .join("\n");
  assert.match(plan, /MULTI-INDEX OR/i);
  assert.match(plan, /sqlite_autoindex_artists_1|idx_artists_search_key/i);
  assert.doesNotMatch(plan, /^SCAN artists$/im);
});

