import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_DEATH_WATCH_INTERVAL_MS,
  ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS,
} from "../../../src/domain/artistDeathWatch.mjs";
import { createArtistDeathWatchService } from "./artistDeathWatchService.js";

const AT = Date.parse("2026-08-30T12:00:00.000Z");
const mbid = (index) => `${String(index).padStart(8, "0")}-1111-4111-8111-${String(index).padStart(12, "0")}`;

function fakeRepository(artists = []) {
  let settings = {
    enabled: 1,
    cursor_artist_key: null,
    last_scan_at: null,
    last_success_at: null,
    next_scan_at: null,
    last_error_code: null,
  };
  const candidates = new Map();
  return {
    candidates,
    readSettings: () => ({ ...settings }),
    setEnabled: ({ enabled, at }) => { settings = { ...settings, enabled: enabled ? 1 : 0, updated_at: at }; return { ...settings }; },
    recordScan: (patch) => {
      settings = {
        ...settings,
        cursor_artist_key: patch.cursorArtistKey,
        last_scan_at: patch.lastScanAt,
        last_success_at: patch.lastSuccessAt,
        next_scan_at: patch.nextScanAt,
        last_error_code: patch.lastErrorCode,
        updated_at: patch.at,
      };
      return { ...settings };
    },
    eligibleArtistsAfter: ({ cursorArtistKey = "", limit }) => artists
      .filter((artist) => artist.artist_key > cursorArtistKey).slice(0, limit),
    eligibleArtistCount: () => artists.length,
    catalogArtistForSignal: ({ artistMbid }) => artists.find((artist) => artist.artist_mbid === artistMbid) || null,
    findCandidateByKey: (key) => candidates.get(key) || null,
    saveConfirmedCandidate: (candidate) => {
      const previous = candidates.get(candidate.artistKey);
      const evidenceChanged = previous
        && (previous.wikidata_id !== candidate.wikidataId || previous.death_date !== candidate.deathDate);
      const reopened = previous?.status === "dismissed" && evidenceChanged;
      const row = {
        artist_key: candidate.artistKey,
        artist_name: candidate.artistName,
        artist_mbid: candidate.artistMbid,
        wikidata_id: candidate.wikidataId,
        death_date: candidate.deathDate,
        status: reopened ? "pending" : (previous?.status || "pending"),
        first_detected_at: previous?.first_detected_at || candidate.at,
        last_confirmed_at: candidate.at,
        reviewed_at: reopened ? null : (previous?.reviewed_at || null),
      };
      candidates.set(candidate.artistKey, row);
      return { inserted: !previous, reopened, row };
    },
    listCandidates: ({ status, limit }) => [...candidates.values()].filter((row) => !status || row.status === status).slice(0, limit),
    candidateCounts: () => [...candidates.values()].reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {}),
    reconcilePublishedMemorials: () => 0,
    review: ({ artistKey, status, reviewerId, at }) => {
      const row = candidates.get(artistKey);
      if (!row) return null;
      const next = { ...row, status, reviewed_by: status === "pending" ? null : reviewerId, reviewed_at: status === "pending" ? null : at };
      candidates.set(artistKey, next);
      return next;
    },
    markMemorialized: ({ artistKey, artistMbid, reviewerId, at }) => {
      const row = candidates.get(artistKey);
      if (!row || row.artist_mbid !== artistMbid) return null;
      const next = { ...row, status: "memorialized", reviewed_by: reviewerId, reviewed_at: at };
      candidates.set(artistKey, next);
      return next;
    },
    transaction: (work) => work(),
  };
}

test("an MBID-only catalog artist becomes a pending candidate only after both sources agree", async () => {
  const artist = { artist_key: "alpha", artist_name: "Alpha", artist_mbid: mbid(1) };
  const repository = fakeRepository([artist]);
  let confirmations = 0;
  const service = createArtistDeathWatchService({
    repository,
    recentWikidataReader: async () => [{ artistMbid: artist.artist_mbid, wikidataId: "Q42", deathDate: "2026-08-29" }],
    wikidataReader: async () => new Map(),
    musicBrainzReader: async (signal) => { confirmations += 1; return { artistMbid: signal.artistMbid, deathDate: signal.deathDate, artistType: "Person" }; },
    sleep: async () => {},
  });
  const result = await service.scan({ at: AT, force: true });
  assert.equal(confirmations, 1);
  assert.equal(result.inserted, 1);
  assert.equal(result.settings.nextScanAt, AT + ARTIST_DEATH_WATCH_INTERVAL_MS);
  const [candidate] = service.list();
  assert.equal(candidate.artistKey, "alpha");
  assert.equal(candidate.wikidataId, "Q42");
  assert.equal(candidate.status, "pending", "provider checks never auto-publish a memorial");
});

test("a recent signal with no unique local MBID match fails closed before MusicBrainz", async () => {
  const repository = fakeRepository([]);
  let confirmations = 0;
  const service = createArtistDeathWatchService({
    repository,
    recentWikidataReader: async () => [{ artistMbid: mbid(2), wikidataId: "Q43", deathDate: "2026-08-29" }],
    wikidataReader: async () => new Map(),
    musicBrainzReader: async () => { confirmations += 1; return null; },
    sleep: async () => {},
  });
  const result = await service.scan({ at: AT, force: true });
  assert.equal(confirmations, 0);
  assert.equal(result.inserted, 0);
  assert.deepEqual(service.list(), []);
});

test("one run corroborates at most five exact identities and spaces confirmations", async () => {
  const artists = Array.from({ length: 7 }, (_, index) => ({
    artist_key: `artist-${index}`,
    artist_name: `Artist ${index}`,
    artist_mbid: mbid(index + 10),
  }));
  const repository = fakeRepository(artists);
  const waits = [];
  let confirmations = 0;
  const service = createArtistDeathWatchService({
    repository,
    recentWikidataReader: async () => artists.map((artist, index) => ({ artistMbid: artist.artist_mbid, wikidataId: `Q${index + 100}`, deathDate: "2026-08-29" })),
    wikidataReader: async () => new Map(),
    musicBrainzReader: async (signal) => { confirmations += 1; return { artistMbid: signal.artistMbid, deathDate: signal.deathDate, artistType: "Person" }; },
    sleep: async (milliseconds) => { waits.push(milliseconds); },
  });
  await service.scan({ at: AT, force: true });
  assert.equal(confirmations, ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS);
  assert.deepEqual(waits, Array(ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS - 1).fill(1_100));
  assert.equal(repository.candidates.size, ARTIST_DEATH_WATCH_MAX_CONFIRMATIONS);
});

test("moderator review changes queue state without changing memorial state", async () => {
  const artist = { artist_key: "alpha", artist_name: "Alpha", artist_mbid: mbid(3) };
  const repository = fakeRepository([artist]);
  const service = createArtistDeathWatchService({
    repository,
    recentWikidataReader: async () => [{ artistMbid: artist.artist_mbid, wikidataId: "Q44", deathDate: "2026-08-29" }],
    wikidataReader: async () => new Map(),
    musicBrainzReader: async (signal) => ({ artistMbid: signal.artistMbid, deathDate: signal.deathDate, artistType: "Person" }),
    sleep: async () => {},
  });
  await service.scan({ at: AT, force: true });
  assert.equal(service.review({ artistKey: "alpha", status: "dismissed", reviewerId: "moderator", at: AT + 1 }).candidate.status, "dismissed");
  assert.equal(service.review({ artistKey: "alpha", status: "pending", reviewerId: "moderator", at: AT + 2 }).candidate.status, "pending");
});

test("a dismissed alert stays dismissed for identical evidence and reopens when exact evidence changes", async () => {
  const artist = { artist_key: "alpha", artist_name: "Alpha", artist_mbid: mbid(4) };
  const repository = fakeRepository([artist]);
  let signal = { artistMbid: artist.artist_mbid, wikidataId: "Q45", deathDate: "2026-08-28" };
  const service = createArtistDeathWatchService({
    repository,
    recentWikidataReader: async () => [signal],
    wikidataReader: async () => new Map(),
    musicBrainzReader: async (candidate) => ({
      artistMbid: candidate.artistMbid, deathDate: candidate.deathDate, artistType: "Person",
    }),
    sleep: async () => {},
  });
  await service.scan({ at: AT, force: true });
  service.review({ artistKey: "alpha", status: "dismissed", reviewerId: "moderator", at: AT + 1 });

  const identical = await service.scan({ at: AT + 2, force: true });
  assert.equal(identical.confirmations, 0);
  assert.equal(repository.candidates.get("alpha").status, "dismissed");

  signal = { ...signal, deathDate: "2026-08-29" };
  const changed = await service.scan({ at: AT + 3, force: true });
  assert.equal(changed.reopened, 1);
  assert.equal(repository.candidates.get("alpha").status, "pending");
});
