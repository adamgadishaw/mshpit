import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ApiError } from "../../errors.js";
import { publicCatalogResearch, validateCatalogResearchFindings } from "./catalogResearchFindings.js";
import { catalogResearchCostMicroUsd, catalogResearchModel, researchCatalogSubject } from "./catalogResearchProvider.js";
import { catalogResearchRoutes } from "./catalogResearchRoutes.js";
import {
  collectCatalogResearchStatus,
  ensureCatalogResearchSchema,
  nextArtistResearchSubject,
  nextVenueResearchSubject,
  readCatalogResearch,
  runCatalogResearchPass,
  venueResearchKey,
} from "./catalogResearchService.js";

const WIKI = "https://en.wikipedia.org/wiki/Wet_Leg";
const SITE = "https://www.wetleg.com/";

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT NOT NULL,genre TEXT,bio TEXT,mbid TEXT,country TEXT,rank_score INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,bio TEXT,owner_id TEXT,removed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT NOT NULL,artist_key TEXT,venue TEXT,date TEXT,owner_id TEXT,
      venue_city TEXT,venue_region TEXT,venue_country_code TEXT,venue_address_line1 TEXT);
    CREATE TABLE moderation_actions(id TEXT,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,
      reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);`);
  ensureCatalogResearchSchema(db);
  return db;
}

function goodFindings(overrides = {}) {
  return {
    match: "confident",
    summary: "Wet Leg are an indie rock band from the Isle of Wight, known for dry, funny guitar songs and a Grammy-winning debut album.",
    summarySources: [WIKI],
    facts: [
      { field: "origin", value: "Isle of Wight, England", source: WIKI },
      { field: "active_since", value: "Formed in 2019", source: WIKI },
      { field: "website", value: SITE, source: SITE },
      { field: "capacity", value: "500", source: WIKI },
    ],
    images: ["https://commons.wikimedia.org/wiki/File:Wet_Leg_2022.jpg", "https://example.com/photo.jpg"],
    ...overrides,
  };
}

test("only confident, sourced findings about the right subject can be published", () => {
  const searchedUrls = [WIKI, SITE];
  const ok = validateCatalogResearchFindings(goodFindings(), { type: "artist", name: "Wet Leg", searchedUrls });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.record.facts.map((fact) => [fact.field, fact.value]),
    [["origin", "Isle of Wight, England"], ["active_since", "2019"], ["website", SITE]],
    "years are reduced to the year and fields the type does not have are dropped");
  assert.deepEqual(ok.record.images, ["https://commons.wikimedia.org/wiki/File:Wet_Leg_2022.jpg"], "only Commons file pages");

  const reasons = [
    [goodFindings({ match: "unsure" }), "unsure"],
    [goodFindings({ match: "not_found" }), "not_found"],
    [goodFindings({ summarySources: ["https://made-up.example/page"] }), "summary_uncited"],
    [goodFindings({ summary: "A band from somewhere that plays guitar music and tours small rooms across Europe." }), "summary_missing_name"],
    [goodFindings({ summary: "Wet Leg: see https://wetleg.com for the full story of this indie band from England." }), "summary_has_links"],
    [goodFindings({ summary: "Wet Leg." }), "summary_too_short"],
  ];
  for (const [findings, reason] of reasons) {
    assert.equal(validateCatalogResearchFindings(findings, { type: "artist", name: "Wet Leg", searchedUrls }).reason, reason);
  }

  const invented = validateCatalogResearchFindings(goodFindings({
    facts: [{ field: "origin", value: "London", source: "https://not-searched.example/wet-leg" }],
  }), { type: "artist", name: "Wet Leg", searchedUrls });
  assert.deepEqual(invented.record.facts, [], "a fact citing a page the agent never opened is dropped");

  const dashed = validateCatalogResearchFindings(goodFindings({
    summary: "Wet Leg — an indie rock band from the Isle of Wight — make dry, funny guitar songs.",
  }), { type: "artist", name: "Wet Leg", searchedUrls });
  assert.equal(dashed.record.summary.includes("—"), false, "house style: no em dashes");

  const venue = validateCatalogResearchFindings({
    match: "confident",
    summary: "The Fillmore is a historic music venue in San Francisco that has hosted rock shows since the 1960s.",
    summarySources: [WIKI],
    facts: [{ field: "capacity", value: "1,315", source: WIKI }, { field: "capacity", value: "9", source: WIKI },
      { field: "opened", value: "1912", source: WIKI }],
  }, { type: "venue", name: "The Fillmore", searchedUrls });
  assert.deepEqual(venue.record.facts.map((fact) => fact.value), ["1,315", "1912"]);
});

test("the public shape lists each source once and never exposes the model or raw input", () => {
  const record = validateCatalogResearchFindings(goodFindings(), { type: "artist", name: "Wet Leg", searchedUrls: [WIKI, SITE] }).record;
  const view = publicCatalogResearch("artist", record, { researchedAt: 42 });
  assert.deepEqual(view.sources, [{ url: WIKI, site: "en.wikipedia.org" }, { url: SITE, site: "wetleg.com" }]);
  assert.equal(view.facts[0].label, "From");
  assert.equal(view.researchedAt, 42);
  assert.equal(Object.hasOwn(view, "images"), false, "image candidates wait for the licence check");
});

test("a research run sends the brief and tools, follows a paused turn, and prices it", async () => {
  const requests = [];
  const replies = [
    { stop_reason: "pause_turn", usage: { input_tokens: 1_000, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
      content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Wet Leg band" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: WIKI, title: "Wet Leg" }] }] },
    { stop_reason: "tool_use", usage: { input_tokens: 2_000, output_tokens: 300, server_tool_use: { web_search_requests: 1 } },
      content: [{ type: "web_search_tool_result", tool_use_id: "s2", content: [{ type: "web_search_result", url: SITE, title: "Official" }] },
        { type: "tool_use", id: "t1", name: "record_findings", input: goodFindings() }] },
  ];
  const fetchImpl = async (url, request) => {
    requests.push({ url, request: { ...request, body: JSON.parse(request.body) } });
    return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await researchCatalogSubject({ type: "artist", name: "Wet Leg", mbid: null, shows: ["Brooklyn Steel, New York, US"] },
    { apiKey: "test-key", model: "claude-sonnet-5", fetchImpl });
  assert.equal(requests.length, 2, "a paused turn is sent back to continue");
  assert.equal(requests[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(requests[0].request.headers["x-api-key"], "test-key");
  assert.equal(requests[0].request.body.model, "claude-sonnet-5");
  assert.deepEqual(requests[0].request.body.tools.map((tool) => tool.name), ["web_search", "record_findings"]);
  assert.match(requests[0].request.body.messages[0].content, /Artist: Wet Leg[\s\S]*Brooklyn Steel/);
  assert.equal(requests[1].request.body.messages.at(-1).role, "assistant");
  assert.deepEqual(result.searchedUrls.sort(), [SITE, WIKI].sort());
  assert.equal(result.findings.match, "confident");
  // 3,000 input x $2 + 400 output x $10 per million, plus two $0.01 searches.
  assert.equal(result.costMicroUsd, 6_000 + 4_000 + 20_000);
  assert.equal(catalogResearchCostMicroUsd("claude-haiku-4-5", { input_tokens: 1_000_000 }), 1_000_000);
  assert.equal(catalogResearchModel({ CATALOG_RESEARCH_MODEL: "gpt-whatever" }), "claude-sonnet-5");
  assert.equal(catalogResearchModel({ CATALOG_RESEARCH_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");

  await assert.rejects(researchCatalogSubject({ type: "artist", name: "Wet Leg" }, {
    apiKey: "bad", fetchImpl: async () => new Response(JSON.stringify({ error: { type: "authentication_error" } }), { status: 401 }),
  }), (error) => error.code === "research_auth");
});

test("the agent works through empty pages with shows first and never touches filled or claimed ones", (t) => {
  const db = database(t);
  db.exec(`INSERT INTO artists(norm,name,bio,rank_score) VALUES
    ('wet leg','Wet Leg',NULL,10),('big star','Big Star','A written biography.',99),
    ('claimed','Claimed Act',NULL,50),('quiet','Quiet Act','',5),('popular','Popular Act',NULL,80);
    INSERT INTO artist_profiles(artist_key,owner_id) VALUES ('claimed','u1');
    INSERT INTO tour_dates(id,artist,artist_key,venue,date,venue_city,venue_country_code) VALUES
      ('1','Wet Leg','wet leg','Brooklyn Steel','2026-10-01','Brooklyn','US'),
      ('2','Wet Leg','wet leg','The Fillmore','2026-10-03','San Francisco','US'),
      ('3','Big Star','big star','The Fillmore','2026-10-05','San Francisco','US'),
      ('4','Claimed Act','claimed','The Fillmore','2026-10-06','San Francisco','US'),
      ('5','Quiet Act','quiet','The Fillmore','2026-10-07','Philadelphia','US');`);
  const first = nextArtistResearchSubject(db, { at: 1_000 });
  assert.equal(first.key, "wet leg", "the empty page with the most shows goes first");
  assert.deepEqual(first.shows, ["Brooklyn Steel, Brooklyn, US", "The Fillmore, San Francisco, US"]);
  db.prepare(`INSERT INTO catalog_research(entity_type,entity_key,identity,status,next_attempt_at) VALUES ('artist','wet leg','{}','found',99999)`).run();
  assert.equal(nextArtistResearchSubject(db, { at: 1_000 }).key, "quiet");
  db.prepare(`INSERT INTO catalog_research(entity_type,entity_key,identity,status,next_attempt_at) VALUES ('artist','quiet','{}','hidden',0)`).run();
  assert.equal(nextArtistResearchSubject(db, { at: 1_000 }).key, "popular", "then everyone else by popularity; never the claimed page");

  const venue = nextVenueResearchSubject(db, { at: 1_000 });
  assert.equal(venue.name, "The Fillmore");
  assert.equal(venue.city, "San Francisco", "the busiest room with that name, in its own city");
  assert.equal(venue.key, venueResearchKey("The Fillmore", "San Francisco", "US"));
});

test("a pass stays inside the daily budget, stores sourced results and serves them per page", async (t) => {
  const db = database(t);
  db.exec(`INSERT INTO artists(norm,name,bio,rank_score) VALUES ('wet leg','Wet Leg',NULL,10);
    INSERT INTO tour_dates(id,artist,artist_key,venue,date,venue_city,venue_country_code) VALUES
      ('1','Wet Leg','wet leg','The Fillmore','2026-10-03','San Francisco','US'),
      ('2','Other','other','The Fillmore','2026-10-04','Philadelphia','US');`);
  const researched = [];
  const research = async (subject) => {
    researched.push(`${subject.type}:${subject.name}:${subject.city || ""}`);
    if (subject.type === "artist") return { findings: goodFindings(), searchedUrls: [WIKI, SITE], costMicroUsd: 90_000, model: "claude-sonnet-5" };
    return { findings: { match: subject.city === "San Francisco" ? "confident" : "unsure",
      summary: "The Fillmore is a historic concert hall in San Francisco that has hosted rock shows since the 1960s.",
      summarySources: [WIKI], facts: [{ field: "capacity", value: "1315", source: WIKI }] },
    searchedUrls: [WIKI], costMicroUsd: 90_000, model: "claude-sonnet-5" };
  };
  const tight = { ANTHROPIC_API_KEY: "key", CATALOG_RESEARCH_DAILY_USD: "0.35" };
  const env = { ANTHROPIC_API_KEY: "key", CATALOG_RESEARCH_DAILY_USD: "0.5" };
  let clock = Date.parse("2026-09-24T12:00:00Z");
  const now = () => clock;
  assert.deepEqual(await runCatalogResearchPass({ database: db, env: {}, now, research }), { researched: 0, published: 0, stopped: "not_configured" });
  const capped = await runCatalogResearchPass({ database: db, env: tight, now, research, maxItems: 10 });
  assert.deepEqual(capped, { researched: 2, published: 1, stopped: "daily_budget" },
    "$0.35 a day stops before a third $0.09 run would eat into the per-run reserve");
  const pass = await runCatalogResearchPass({ database: db, env, now, research, maxItems: 10 });
  assert.deepEqual(pass, { researched: 1, published: 1, stopped: "nothing_due" }, "a higher cap the same day picks up where it left off");
  assert.deepEqual(researched, ["artist:Wet Leg:", "venue:The Fillmore:Philadelphia", "venue:The Fillmore:San Francisco"]);

  const status = collectCatalogResearchStatus(db, { env, at: now() });
  assert.deepEqual(status.today, { spentUsd: 0.27, runs: 3, published: 2 });
  assert.deepEqual(status.venues, { found: 1, notFound: 0, unsure: 1, failed: 0, hidden: 0 });

  assert.equal(readCatalogResearch(db, { type: "artist", key: "wet leg" }).facts[0].value, "Isle of Wight, England");
  assert.equal(readCatalogResearch(db, { type: "venue", key: "The Fillmore", city: "San Francisco" }).facts[0].value, "1,315");
  assert.equal(readCatalogResearch(db, { type: "venue", key: "The Fillmore", city: "Philadelphia" }), null,
    "the Philadelphia room never shows San Francisco's research");

  clock += 200 * 24 * 60 * 60 * 1000;
  const failing = async () => { throw Object.assign(new Error("overloaded"), { code: "research_overloaded" }); };
  const stopped = await runCatalogResearchPass({ database: db, env, now, research: failing, maxItems: 5 });
  assert.equal(stopped.stopped, "research_overloaded", "an overloaded API ends the pass instead of burning through pages");
  assert.equal(collectCatalogResearchStatus(db, { env, at: now() }).lastError.code, "research_overloaded");
  assert.equal(readCatalogResearch(db, { type: "artist", key: "wet leg" }).summary.startsWith("Wet Leg"), true,
    "a failed refresh keeps the last good result on the page");
});

test("pages read research through the routes and staff can hide a wrong result", (t) => {
  const db = database(t);
  db.prepare(`INSERT INTO catalog_research(entity_type,entity_key,identity,status,next_attempt_at,findings,researched_at)
    VALUES ('artist','wet leg','{}','found',0,?,5)`).run(JSON.stringify(
    validateCatalogResearchFindings(goodFindings(), { type: "artist", name: "Wet Leg", searchedUrls: [WIKI, SITE] }).record));
  const routes = catalogResearchRoutes({
    database: db, ApiError, rateLimit() {}, now: () => 7,
    decodedPathParam: (ctx, name) => ctx.params[name],
    canonicalVenueKey: (value) => String(value || "").toLowerCase() || null,
    resolveArtist: (key) => (key === "wet leg" ? { norm: "wet leg" } : null),
    requireAdmin: (ctx) => {
      if (ctx.user?.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN");
      return ctx.user;
    },
  });
  const read = (key) => routes["GET /api/artists/:key/research"]({ params: { key }, query: {}, setHeader() {} });
  assert.match(read("wet leg").research.summary, /^Wet Leg are an indie rock band/);
  assert.throws(() => read("nobody"), (error) => error.status === 404);
  assert.throws(() => routes["POST /api/moderation/catalog-research/hide"]({ user: { id: "u", role: "fan" }, body: { type: "artist", key: "wet leg" }, setHeader() {} }),
    (error) => error.status === 403);
  routes["POST /api/moderation/catalog-research/hide"]({ user: { id: "a", role: "admin" }, body: { type: "artist", key: "wet leg" }, setHeader() {} });
  assert.equal(read("wet leg").research, null, "hidden research leaves the page at once");
  assert.equal(db.prepare("SELECT action FROM moderation_actions").get().action, "catalog_research_hide");
});
