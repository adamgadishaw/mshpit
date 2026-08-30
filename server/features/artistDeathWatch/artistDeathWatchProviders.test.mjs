import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecentWikidataDeathsQuery,
  buildWikidataDeathSignalsQuery,
  confirmMusicBrainzDeathSignal,
  parseMusicBrainzDeathSignal,
  parseRecentWikidataDeaths,
  parseWikidataDeathSignalRows,
} from "./artistDeathWatchProviders.js";

const AT = Date.parse("2026-08-30T12:00:00.000Z");
const MBID = "11111111-1111-4111-8111-111111111111";
const OTHER_MBID = "22222222-2222-4222-8222-222222222222";
const binding = (mbid, qid, date, precision = 11) => ({
  item: { value: `https://www.wikidata.org/entity/${qid}` },
  mbid: { value: mbid },
  death: { value: `${date}T00:00:00Z` },
  precision: { value: String(precision) },
});

test("bounded historical Wikidata lookup uses exact MusicBrainz IDs and Person semantics", () => {
  const query = buildWikidataDeathSignalsQuery([{ artistMbid: MBID }]);
  assert.match(query, /VALUES \?mbid \{ "11111111-1111-4111-8111-111111111111" \}/);
  assert.match(query, /wdt:P31 wd:Q5/);
  assert.match(query, /p:P570 \?deathStatement/);
  assert.match(query, /\?deathStatement a wikibase:BestRank/);
  assert.match(query, /ps:P570 \?death/);
  assert.match(query, /wikibase:timePrecision \?precision/);
  assert.match(query, /FILTER\(\?precision = 11/);
  assert.match(query, /LIMIT 4$/);
  assert.throws(() => buildWikidataDeathSignalsQuery([{ artistMbid: "bad" }]));
});

test("Wikidata rows discover a QID for an MBID-only catalog artist and reject ambiguity", () => {
  const artists = [{ artistKey: "alpha", artistName: "Alpha", artistMbid: MBID }];
  const payload = { results: { bindings: [binding(MBID, "Q42", "2026-08-29")] } };
  assert.deepEqual(parseWikidataDeathSignalRows(payload, artists, { at: AT }).get("alpha"), {
    artistKey: "alpha",
    artistName: "Alpha",
    artistMbid: MBID,
    wikidataId: "Q42",
    deathDate: "2026-08-29",
  });
  const conflicting = { results: { bindings: [
    binding(MBID, "Q42", "2026-08-29"),
    binding(MBID, "Q43", "2026-08-29"),
    binding(MBID, "Q42", "2026-08-29"),
  ] } };
  assert.deepEqual(parseRecentWikidataDeaths(conflicting, { at: AT }), []);
  assert.equal(parseWikidataDeathSignalRows(conflicting, artists, { at: AT }).size, 0);
});

test("recent query is bounded and rejects future start dates", () => {
  const query = buildRecentWikidataDeathsQuery({ since: "2026-08-01", limit: 999, at: AT });
  assert.match(query, /wdt:P434/);
  assert.match(query, /\?deathStatement a wikibase:BestRank/);
  assert.match(query, /wikibase:timePrecision \?precision/);
  assert.match(query, /\?precision = 11/);
  assert.match(query, /LIMIT 100$/);
  assert.throws(() => buildRecentWikidataDeathsQuery({ since: "2026-09-01", at: AT }));
});

test("Wikidata row parsing rejects year-only and month-only death claims", () => {
  const payload = { results: { bindings: [
    binding(MBID, "Q42", "2026-01-01", 9),
    binding(OTHER_MBID, "Q43", "2026-08-01", 10),
  ] } };
  assert.deepEqual(parseRecentWikidataDeaths(payload, { at: AT }), []);
  assert.equal(parseWikidataDeathSignalRows(payload, [
    { artistKey: "year-only", artistName: "Year Only", artistMbid: MBID },
    { artistKey: "month-only", artistName: "Month Only", artistMbid: OTHER_MBID },
  ], { at: AT }).size, 0);
});

test("MusicBrainz corroboration accepts only the exact Person identity and death date", async () => {
  const expected = { artistMbid: MBID, deathDate: "2026-08-29" };
  const person = { id: MBID, type: "Person", "life-span": { ended: true, end: "2026-08-29" } };
  assert.deepEqual(parseMusicBrainzDeathSignal(person, expected, { at: AT }), {
    artistMbid: MBID,
    deathDate: "2026-08-29",
    artistType: "Person",
  });
  assert.equal(parseMusicBrainzDeathSignal({ ...person, type: "Group" }, expected, { at: AT }), null);
  assert.equal(parseMusicBrainzDeathSignal({ ...person, id: OTHER_MBID }, expected, { at: AT }), null);
  assert.equal(parseMusicBrainzDeathSignal({ ...person, "life-span": { ended: true, end: "2026-08-28" } }, expected, { at: AT }), null);

  let gated = 0;
  const result = await confirmMusicBrainzDeathSignal(expected, {
    at: AT,
    requestGate: async (request) => { gated += 1; return request(); },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => person }),
  });
  assert.equal(gated, 1, "all memorial MusicBrainz calls use the shared request gate");
  assert.equal(result.artistType, "Person");
});
