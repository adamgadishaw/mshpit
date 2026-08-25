import assert from "node:assert/strict";
import test from "node:test";

import { db } from "../../db.js";
import { routes } from "../../api.js";
import { createArtistMemorialRepository } from "./artistMemorialRepository.js";

const VALID_MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function analyticsSnapshot() {
  return {
    events: db.prepare("SELECT COUNT(*) count,COALESCE(SUM(created_at),0) checksum FROM events").get(),
    guestSearch: db.prepare("SELECT COUNT(*) count,COALESCE(SUM(count),0) checksum FROM guest_search_daily").get(),
  };
}

function searchableArtist() {
  return db.prepare(`SELECT norm,name,mbid FROM artists
    WHERE mbid IS NOT NULL AND length(norm) BETWEEN 1 AND 80 AND length(name) BETWEEN 2 AND 60
    ORDER BY rank_score DESC,name ASC LIMIT 200`).all()
    .find((row) => VALID_MBID.test(String(row.mbid || "")));
}

function search(name) {
  return routes["GET /api/artists"]({ query: { q: name, limit: "40" } });
}

test("artist search adds one identity-bound compact memorial without changing analytics or result counts", () => {
  const artist = searchableArtist();
  assert.ok(artist, "the seeded catalog needs one exact MusicBrainz artist");
  const repository = createArtistMemorialRepository(db);
  const at = Date.parse("2026-08-25T12:00:00.000Z");
  const beforeAnalytics = analyticsSnapshot();

  db.exec("SAVEPOINT artist_memorial_search_integration");
  try {
    db.prepare("DELETE FROM artist_memorials WHERE artist_key=?").run(artist.norm);
    const baseline = search(artist.name);
    const baselineArtist = baseline.artists.find((row) => row.key === artist.norm);
    assert.ok(baselineArtist, "the exact catalog artist should remain in its search results");
    assert.equal(baselineArtist.memorial, null);

    repository.upsert({
      artistKey: artist.norm,
      artistName: artist.name,
      artistMbid: artist.mbid.toLowerCase(),
      status: "published",
      deathDate: "2024-05-17",
      summary: "A singular performer whose songs and live shows changed generations.",
      thankYou: "Thank you for leaving the music with us.",
      accomplishments: ["An enduring live legacy"],
      sourceUrl: "https://news.example.org/artist/confirmed",
      sourceTitle: "Official announcement",
      publishedAt: at,
      spotlightStartedAt: at,
      createdAt: at,
      updatedAt: at,
    });

    const withMemorial = search(artist.name);
    assert.equal(withMemorial.total, baseline.total, "a memorial cannot change catalog search counts");
    assert.equal(withMemorial.artists.length, baseline.artists.length, "a memorial cannot add a search row");
    const remembered = withMemorial.artists.find((row) => row.key === artist.norm);
    assert.deepEqual(Object.keys(remembered.memorial).sort(), ["deathDate", "deceased", "spotlight"]);
    assert.equal(remembered.memorial.deceased, true);
    assert.equal(Object.hasOwn(remembered.memorial, "summary"), false);
    assert.equal(Object.hasOwn(remembered.memorial, "citation"), false);

    const mismatchedMbid = artist.mbid.toLowerCase() === "00000000-0000-4000-8000-000000000000"
      ? "11111111-1111-4111-8111-111111111111"
      : "00000000-0000-4000-8000-000000000000";
    db.prepare("UPDATE artist_memorials SET artist_mbid=? WHERE artist_key=?")
      .run(mismatchedMbid, artist.norm);
    const mismatched = search(artist.name).artists.find((row) => row.key === artist.norm);
    assert.equal(mismatched.memorial, null, "a catalog identity mismatch must fail closed");
  } finally {
    db.exec("ROLLBACK TO artist_memorial_search_integration");
    db.exec("RELEASE artist_memorial_search_integration");
  }

  assert.deepEqual(analyticsSnapshot(), beforeAnalytics, "memorial search presentation must not write analytics");
});
