import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_DEATH_WATCH_BATCH_SIZE,
  ARTIST_DEATH_WATCH_BATCHES_PER_RUN,
  ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS,
  artistDeathEvidenceUrls,
  canonicalArtistMbid,
  canonicalDeathDate,
  canonicalWikidataId,
  parseDeathCandidateReview,
  projectArtistDeathCandidate,
  projectArtistDeathWatchSettings,
} from "./artistDeathWatch.mjs";

const AT = Date.parse("2026-08-30T12:00:00.000Z");
const MBID = "11111111-1111-4111-8111-111111111111";

test("death-watch identifiers and exact dates fail closed", () => {
  assert.equal(canonicalArtistMbid(` ${MBID.toUpperCase()} `), MBID);
  assert.equal(canonicalArtistMbid("not-an-mbid"), null);
  assert.equal(canonicalWikidataId(" q42 "), "Q42");
  assert.equal(canonicalWikidataId("Q0"), null);
  assert.equal(canonicalDeathDate("2026-08-29", { at: AT }), "2026-08-29");
  assert.equal(canonicalDeathDate("2026-08-31", { at: AT }), null);
  assert.equal(canonicalDeathDate("2026-02-30", { at: AT }), null);
  assert.equal(parseDeathCandidateReview("dismissed"), "dismissed");
  assert.equal(parseDeathCandidateReview("memorialized"), null);
  assert.ok(ARTIST_DEATH_WATCH_BATCH_SIZE <= 50);
  assert.ok(ARTIST_DEATH_WATCH_BATCHES_PER_RUN <= 5);
  assert.ok(ARTIST_DEATH_WATCH_BATCH_SIZE * ARTIST_DEATH_WATCH_BATCHES_PER_RUN <= 200);
  assert.ok(ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS <= 5);
});

test("candidate projection exposes source evidence but no reviewer identity", () => {
  const candidate = projectArtistDeathCandidate({
    artist_key: "alpha",
    artist_name: "Alpha",
    artist_mbid: MBID,
    wikidata_id: "Q42",
    death_date: "2026-08-29",
    status: "pending",
    first_detected_at: AT,
    last_confirmed_at: AT,
    reviewed_by: "private-reviewer",
  });
  assert.equal(candidate.artistKey, "alpha");
  assert.equal(candidate.reviewedBy, undefined);
  assert.deepEqual(candidate.evidence, artistDeathEvidenceUrls({ artistMbid: MBID, wikidataId: "Q42" }));
  const futureDate = new Date(Date.now() + (2 * 86_400_000)).toISOString().slice(0, 10);
  assert.equal(projectArtistDeathCandidate({ ...candidate, deathDate: futureDate }), null);
});

test("settings projection keeps operational state bounded and public-safe", () => {
  assert.deepEqual(projectArtistDeathWatchSettings({
    enabled: 1,
    last_scan_at: AT,
    last_success_at: null,
    next_scan_at: AT + 1000,
    last_error_code: "wikidata_timeout",
    cursor_artist_key: "private-cursor",
  }), {
    enabled: true,
    lastScanAt: AT,
    lastSuccessAt: null,
    nextScanAt: AT + 1000,
    lastErrorCode: "wikidata_timeout",
  });
});
