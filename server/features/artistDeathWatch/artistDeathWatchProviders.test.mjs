import assert from "node:assert/strict";
import test from "node:test";
import { createMusicBrainzRequestThrottle } from "../../musicBrainzRequestThrottle.js";

import {
  buildRecentWikidataDeathsQuery,
  buildWikidataDeathSignalsQuery,
  confirmMusicBrainzDeathSignal,
  parseMusicBrainzDeathSignal,
  parseRecentWikidataDeaths,
  parseWikidataDeathSignalRows,
  readRecentWikidataDeaths,
  readWikidataDeathSignals,
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

test("MusicBrainz service-unavailable replies carry Retry-After and dispose the failed body",async()=>{
  let cancelled=0;
  await assert.rejects(confirmMusicBrainzDeathSignal({artistMbid:MBID,deathDate:"2026-08-29"},{at:AT,now:()=>AT,requestGate:(work)=>work(),
    fetchImpl:async()=>({ok:false,status:503,headers:new Headers({"Retry-After":"7200"}),body:{cancel:async()=>{cancelled++;}}})}),
    error=>error.code==="musicbrainz_unavailable" && error.status===503 && error.retryAt===AT+7_200_000);
  assert.equal(cancelled,1);
});

test("MusicBrainz cooldowns use response receipt and retain bounded provider deadlines", async (t) => {
  const receivedAt = AT + 75_000;
  const cases = [
    { label: "relative two hours", header: "7200", delay: 7_200_000 },
    { label: "HTTP date", header: new Date(receivedAt + 7_200_000).toUTCString(), delay: 7_200_000 },
    { label: "relative 24 hours", header: "86400", delay: 86_400_000 },
    { label: "huge seconds", header: "999999999999999999999999", delay: 86_400_000 },
    { label: "huge date", header: new Date(receivedAt + 7 * 86_400_000).toUTCString(), delay: 86_400_000 },
    { label: "past date", header: new Date(receivedAt - 60_000).toUTCString(), delay: 0 },
    { label: "explicit zero", header: "0", delay: 0 },
    { label: "invalid", header: "invalid", delay: 60_000 },
    { label: "missing", header: null, delay: 60_000 },
  ];
  for (const status of [429, 503]) {
    for (const { label, header, delay } of cases) {
      await t.test(`${status}: ${label}`, async () => {
        let clock = AT;
        let disposed = 0;
        await assert.rejects(confirmMusicBrainzDeathSignal({ artistMbid: MBID, deathDate: "2026-08-29" }, {
          at: AT,
          now: () => clock,
          requestGate: (work) => work(),
          fetchImpl: async () => {
            clock = receivedAt;
            return {
              ok: false, status,
              headers: new Headers(header == null ? {} : { "Retry-After": header }),
              body: { cancel: async () => { disposed += 1; clock += 5_000; } },
            };
          },
        }), (error) => error.status === status && error.retryAt === receivedAt + delay);
        assert.equal(disposed, 1);
      });
    }
  }
});

test("Wikidata readers also separate Retry-After receipt from scan evidence time", async () => {
  const now = () => AT + 75_000;
  const fetchImpl = async () => ({ ok: false, status: 429, headers: new Headers({ "Retry-After": "7200" }) });
  const expected = (error) => error.code === "wikidata_rate_limited" && error.retryAt === now() + 7_200_000;
  await assert.rejects(readWikidataDeathSignals([{ artistMbid: MBID }], { at: AT, now, fetchImpl }), expected);
  await assert.rejects(readRecentWikidataDeaths({ since: "2026-08-01", at: AT, now, fetchImpl }), expected);
});

test("caller cancellation during fetch or body decoding does not poison the MusicBrainz circuit", async (t) => {
  for (const stage of ["fetch", "body"]) {
    for (const reason of [new DOMException("Stopped", "AbortError"), new Error("Caller stopped")]) {
      await t.test(`${stage}: ${reason.name}`, async () => {
        let clock = AT;
        const requestGate = createMusicBrainzRequestThrottle({
          clock: () => clock,
          wait: async (delay) => { clock += delay; },
          breakerFailureThreshold: 1,
        });
        const controller = new AbortController();
        const cancel = () => { controller.abort(reason); throw reason; };
        await assert.rejects(confirmMusicBrainzDeathSignal({ artistMbid: MBID, deathDate: "2026-08-29" }, {
          at: AT, now: () => clock, signal: controller.signal, requestGate,
          fetchImpl: async () => stage === "fetch" ? cancel() : { ok: true, status: 200, json: async () => cancel() },
        }), (error) => error === reason);
        assert.equal(requestGate.status().consecutiveFailures, 0);
        assert.equal(requestGate.status().circuitOpen, false);
        assert.equal(await requestGate(async () => "another caller succeeded"), "another caller succeeded");
      });
    }
  }
});

test("cancellation before dispatch never reaches MusicBrainz or changes its circuit", async () => {
  const requestGate = createMusicBrainzRequestThrottle({ breakerFailureThreshold: 1 });
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  await assert.rejects(confirmMusicBrainzDeathSignal({ artistMbid: MBID, deathDate: "2026-08-29" }, {
    at: AT, signal: controller.signal, requestGate,
    fetchImpl: async () => { requests += 1; throw new Error("must not dispatch"); },
  }), (error) => error === controller.signal.reason);
  assert.equal(requests, 0);
  assert.equal(requestGate.status().consecutiveFailures, 0);
  assert.equal(requestGate.status().circuitOpen, false);
});

test("a received refusal retains its cooldown when caller cancellation races response or disposal", async (t) => {
  for (const status of [429, 503, 401, 403]) {
    for (const stage of ["response", "disposal"]) {
      await t.test(`${status}: ${stage}`, async () => {
        let clock = AT;
        let disposed = 0;
        const requestGate = createMusicBrainzRequestThrottle({
          clock: () => clock, wait: async (delay) => { clock += delay; },
        });
        const controller = new AbortController();
        const reason = new DOMException("Caller stopped", "AbortError");
        await assert.rejects(confirmMusicBrainzDeathSignal({ artistMbid: MBID, deathDate: "2026-08-29" }, {
          at: AT, now: () => clock, signal: controller.signal, requestGate,
          fetchImpl: async () => {
            if (stage === "response") controller.abort(reason);
            return {
              ok: false, status, headers: new Headers({ "Retry-After": "7200" }),
              body: { cancel: async () => {
                disposed += 1;
                clock += 5_000;
                if (stage === "disposal") controller.abort(reason);
              } },
            };
          },
        }), (error) => error === reason);
        assert.equal(disposed, 1);
        assert.equal(requestGate.status().retryAt, AT + 7_200_000);
        assert.equal(requestGate.status().consecutiveFailures, 1);
        let otherCallerRequests = 0;
        await assert.rejects(requestGate(async () => { otherCallerRequests += 1; }), { code: "circuit_open" });
        assert.equal(otherCallerRequests, 0);
      });
    }
  }
});

test("a deleted MusicBrainz identity supplies no death evidence and does not halt later artists",async()=>{
  const result=await confirmMusicBrainzDeathSignal({artistMbid:MBID,deathDate:"2026-08-29"},{at:AT,requestGate:(work)=>work(),
    fetchImpl:async()=>({ok:false,status:404,headers:new Headers()})});
  assert.equal(result,null);
});

test("MusicBrainz bodies are bounded before decoding and body timeouts retain a useful error code",async()=>{
  await assert.rejects(confirmMusicBrainzDeathSignal({artistMbid:MBID,deathDate:"2026-08-29"},{at:AT,requestGate:(work)=>work(),
    fetchImpl:async()=>({ok:true,status:200,headers:new Headers({"Content-Length":"99999999"}),json:async()=>{throw new Error("must not parse");}})}),
    error=>error.code==="musicbrainz_response");
  await assert.rejects(confirmMusicBrainzDeathSignal({artistMbid:MBID,deathDate:"2026-08-29"},{at:AT,requestGate:(work)=>work(),
    fetchImpl:async()=>({ok:true,status:200,json:async()=>{throw new DOMException("Timed out","TimeoutError");}})}),
    error=>error.code==="musicbrainz_timeout");
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
