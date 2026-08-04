import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-wikidata-"));
process.env.PIT_DATA_DIR = dataDir;

const { artistRow, artistStmts, db } = await import("./db.js");
const {
  backfillChannelsFromWikidata,
  buildSparql,
  channelTitleRank,
  lookupChannelByMbid,
  parseWikidataChannels,
  pickChannel,
  wikidataProviderStatus,
} = await import("./wikidataChannels.js");

const MBID_A = "11111111-1111-4111-8111-111111111111";
const MBID_B = "22222222-2222-4222-8222-222222222222";
const MBID_C = "33333333-3333-4333-8333-333333333333";
const channelId = (character) => `UC${character.repeat(22)}`;
const CHANNEL_A = channelId("A");
const CHANNEL_B = channelId("B");
const CHANNEL_C = channelId("C");

const jsonResponse = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[String(name).toLowerCase()] || null },
  json: async () => body,
});

function seedArtist(name, mbid, popularity) {
  artistStmts.upsert.run(artistRow(name, { name, mbid, popularity }, "test"));
}

beforeEach(() => {
  db.prepare("DELETE FROM wikidata_channel_checks").run();
  db.prepare("DELETE FROM artists").run();
});

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("artist aliases have an expression index for the startup MBID join", () => {
  const indexes = db.prepare("PRAGMA index_list('artists')").all().map((row) => row.name);
  assert.ok(indexes.includes("idx_artists_mbid_lower"));
  seedArtist("Alias A", MBID_A, 10);
  seedArtist("Alias B", MBID_A, 9);
  const plan = db.prepare(`EXPLAIN QUERY PLAN
    WITH eligible AS (
      SELECT lower(a.mbid) AS mbid FROM artists a
      WHERE a.mbid IS NOT NULL GROUP BY lower(a.mbid) LIMIT 100
    )
    SELECT a.norm FROM eligible e JOIN artists a ON lower(a.mbid)=e.mbid`).all();
  assert.ok(
    plan.some((row) => /idx_artists_mbid_lower/.test(String(row.detail))),
    `startup join must use the MBID index: ${plan.map((row) => row.detail).join(" | ")}`,
  );
});

test("SPARQL accepts only canonical MBIDs, lowercases and deduplicates them", () => {
  const q = buildSparql([
    MBID_A.toUpperCase(),
    MBID_A,
    'evil"} INJECT',
    "not-a-mbid",
  ]);
  assert.match(q, /wdt:P434/);
  assert.match(q, /wdt:P2397/);
  assert.match(q, new RegExp(`"${MBID_A}"`));
  assert.equal(q.match(new RegExp(MBID_A, "g"))?.length, 1, "one identity appears once in VALUES");
  assert.doesNotMatch(q, /INJECT|not-a-mbid|evil/i);
  assert.match(q, /ORDER BY \?mbid \?yt/);
});

test("Wikidata results become deterministic MBID mappings and malformed identities are dropped", () => {
  const json = { results: { bindings: [
    { mbid: { value: MBID_A }, yt: { value: CHANNEL_B } },
    { mbid: { value: MBID_A.toUpperCase() }, yt: { value: CHANNEL_A } },
    { mbid: { value: MBID_A }, yt: { value: CHANNEL_B } },
    { mbid: { value: MBID_B }, yt: { value: "UCtoo-short" } },
    { mbid: { value: "mb3" }, yt: { value: CHANNEL_C } },
  ] } };
  const map = parseWikidataChannels(json);
  assert.deepEqual(map.get(MBID_A), [CHANNEL_A, CHANNEL_B], "provider order cannot change the fallback");
  assert.equal(map.has(MBID_B), false, "a channel id must be exactly 24 characters");
  assert.equal(map.has("mb3"), false, "noncanonical MusicBrainz ids are ignored");
});

test("channel selection uses validated artist identity, with a deterministic unvalidated fallback", () => {
  assert.equal(channelTitleRank("Calvin Harris", "Calvin Harris - Topic"), 100);
  assert.ok(channelTitleRank("Calvin Harris", "CalvinHarrisVEVO") > channelTitleRank("Calvin Harris", "Calvin Harris"));
  assert.equal(channelTitleRank("Calvin Harris", "Unrelated Karaoke"), 0);

  const ids = [CHANNEL_C, CHANNEL_A, CHANNEL_B];
  assert.equal(pickChannel(ids), CHANNEL_A, "without validation, lexical identity is stable rather than response-order dependent");
  assert.equal(pickChannel(ids, {
    [CHANNEL_A]: "Calvin Harris",
    [CHANNEL_B]: "Calvin Harris - Topic",
    [CHANNEL_C]: "Unrelated Karaoke",
  }, "Calvin Harris"), CHANNEL_B, "a validated Topic channel wins");
  assert.equal(pickChannel(["invalid"]), null);
  assert.equal(pickChannel(null), null);
});

test("concurrent live lookups share one WDQS request and reuse the validated result", async () => {
  let wikidataRequests = 0;
  let youtubeRequests = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith("https://query.wikidata.org/")) {
      wikidataRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return jsonResponse({ results: { bindings: [
        { mbid: { value: MBID_A }, yt: { value: CHANNEL_A } },
      ] } });
    }
    youtubeRequests += 1;
    return jsonResponse({ items: [{ id: CHANNEL_A, snippet: { title: "Singleflight Artist - Topic" } }] });
  };

  const [first, second] = await Promise.all([
    lookupChannelByMbid(MBID_A, { artist: "Singleflight Artist", apiKey: "test-key", fetchImpl }),
    lookupChannelByMbid(MBID_A, { artist: "Singleflight Artist", apiKey: "test-key", fetchImpl }),
  ]);
  assert.deepEqual(first, { channelId: CHANNEL_A, validated: true, titleRank: 100, status: "fresh" });
  assert.deepEqual(second, first);
  assert.equal(wikidataRequests, 1);
  assert.equal(youtubeRequests, 1);
  assert.equal(wikidataProviderStatus().inFlight, 0);

  const cached = await lookupChannelByMbid(MBID_A, {
    artist: "Singleflight Artist",
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("a fresh identity must not hit either provider"); },
  });
  assert.deepEqual(cached, { channelId: CHANNEL_A, validated: true, status: "cached" });
});

test("a live Wikidata miss is negative-cached instead of being retried on every song", async () => {
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return jsonResponse({ results: { bindings: [] } });
  };
  assert.equal(await lookupChannelByMbid(MBID_B, { artist: "Missing Artist", apiKey: "test-key", fetchImpl }), null);
  assert.equal(await lookupChannelByMbid(MBID_B, {
    artist: "Missing Artist",
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("negative cache was bypassed"); },
  }), null);
  assert.equal(requests, 1);
  const check = db.prepare("SELECT channel_id,validated FROM wikidata_channel_checks WHERE mbid=?").get(MBID_B);
  assert.equal(check.channel_id, null);
  assert.equal(check.validated, 0);
});

test("backfill validates one shared MBID and updates every artist alias", async () => {
  seedArtist("Alias Artist", MBID_A, 90);
  seedArtist("Alias Artist Legacy", MBID_A, 80);
  let wikidataRequests = 0;
  let youtubeRequests = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith("https://query.wikidata.org/")) {
      wikidataRequests += 1;
      return jsonResponse({ results: { bindings: [
        { mbid: { value: MBID_A }, yt: { value: CHANNEL_A } },
      ] } });
    }
    youtubeRequests += 1;
    return jsonResponse({ items: [{ id: CHANNEL_A, snippet: { title: "Alias Artist - Topic" } }] });
  };

  const stats = await backfillChannelsFromWikidata({
    limit: 10,
    batchSize: 10,
    apiKey: "test-key",
    fetchImpl,
    sleep: async () => {},
  });
  assert.equal(stats.considered, 2);
  assert.equal(stats.identities, 1);
  assert.equal(stats.matched, 1);
  assert.equal(stats.stored, 2);
  assert.equal(wikidataRequests, 1);
  assert.equal(youtubeRequests, 1);

  const rows = db.prepare("SELECT youtube_channel_id channelId,youtube_channel_source source FROM artists ORDER BY norm").all();
  assert.deepEqual(rows.map((row) => row.channelId), [CHANNEL_A, CHANNEL_A]);
  assert.deepEqual(rows.map((row) => row.source), ["wikidata", "wikidata"]);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM wikidata_channel_checks").get().c, 1);
});

test("SQL eligibility is applied before LIMIT so checked head artists cannot strand the tail", async () => {
  seedArtist("Already Checked", MBID_A, 100);
  seedArtist("Next Eligible", MBID_B, 90);
  seedArtist("Tail Eligible", MBID_C, 80);
  db.prepare("INSERT INTO wikidata_channel_checks (mbid,channel_id,validated,checked_at) VALUES (?,?,?,?)")
    .run(MBID_A, null, 0, Date.now());

  const mappings = new Map([
    [MBID_B, { artist: "Next Eligible", channel: CHANNEL_B }],
    [MBID_C, { artist: "Tail Eligible", channel: CHANNEL_C }],
  ]);
  const queried = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.startsWith("https://query.wikidata.org/")) {
      const query = new URL(value).searchParams.get("query") || "";
      const mbid = [...mappings.keys()].find((id) => query.includes(id));
      assert.ok(mbid, `unexpected query: ${query}`);
      queried.push(mbid);
      return jsonResponse({ results: { bindings: [
        { mbid: { value: mbid }, yt: { value: mappings.get(mbid).channel } },
      ] } });
    }
    const id = new URL(value).searchParams.get("id");
    const match = [...mappings.values()].find((entry) => entry.channel === id);
    return jsonResponse({ items: match ? [{ id, snippet: { title: `${match.artist} - Topic` } }] : [] });
  };

  await backfillChannelsFromWikidata({ limit: 1, batchSize: 1, apiKey: "test-key", fetchImpl, sleep: async () => {} });
  await backfillChannelsFromWikidata({ limit: 1, batchSize: 1, apiKey: "test-key", fetchImpl, sleep: async () => {} });

  assert.deepEqual(queried, [MBID_B, MBID_C]);
  assert.equal(artistStmts.getChannel.get("already checked").channelId, null);
  assert.equal(artistStmts.getChannel.get("next eligible").channelId, CHANNEL_B);
  assert.equal(artistStmts.getChannel.get("tail eligible").channelId, CHANNEL_C);
});

test("WDQS 429 honors Retry-After and short-circuits follow-up traffic", async () => {
  const startedAt = Date.now();
  let requests = 0;
  const result = await lookupChannelByMbid(MBID_A, {
    artist: "Rate Limited Artist",
    apiKey: "test-key",
    fetchImpl: async () => {
      requests += 1;
      return jsonResponse({}, 429, { "retry-after": "2" });
    },
  });
  assert.equal(result, null);
  const status = wikidataProviderStatus();
  assert.equal(status.circuitOpen, true);
  assert.equal(status.circuitCode, "rate_limited");
  assert.ok(status.retryAt >= startedAt + 1_900);
  assert.ok(status.retryAt <= Date.now() + 2_100);

  assert.equal(await lookupChannelByMbid(MBID_B, {
    artist: "Second Rate Limited Artist",
    apiKey: "test-key",
    fetchImpl: async () => {
      requests += 1;
      throw new Error("the open circuit should stop this request");
    },
  }), null);
  assert.equal(requests, 1);
});
