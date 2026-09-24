import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  collectProviderProfileStatus,
  ensureProviderProfileSchema,
  nextAttractionForProfile,
  nextVenueForProfile,
  readArtistProviderProfile,
  readVenueProviderProfile,
  runProviderProfilePass,
} from "./providerProfileService.js";
import { parseTicketmasterAttraction, parseTicketmasterVenue, ticketmasterGenreLabel, ticketmasterProfileUrl } from "./ticketmasterProfiles.js";
import { comparableName, createWikidataIdentityBridge, wikipediaTitleFromUrl } from "./wikidataIdentityBridge.js";

const MBID = "0c751690-c784-4a4f-b1e4-c1de27d47581";
const OTHER_MBID = "11111111-2222-3333-4444-555555555555";

function attraction(overrides = {}) {
  return {
    id: "K8vZ9171",
    name: "Wet Leg",
    url: "https://www.ticketmaster.com/wet-leg-tickets/artist/2837613",
    classifications: [{ primary: true, segment: { name: "Music" }, genre: { name: "Rock" }, subGenre: { name: "Alternative Rock" } }],
    externalLinks: {
      homepage: [{ url: "https://wetleg.com/" }],
      instagram: [{ url: "https://www.instagram.com/wetlegband/" }],
      youtube: [{ url: "https://evil.example/not-youtube" }],
      wiki: [{ url: "https://en.wikipedia.org/wiki/Wet_Leg" }],
      musicbrainz: [{ id: MBID }],
    },
    ...overrides,
  };
}

test("a Ticketmaster performer record keeps only official links on their own sites, one ID and a usable genre", () => {
  const parsed = parseTicketmasterAttraction(attraction(), { id: "K8vZ9171" });
  assert.deepEqual(parsed.links, {
    homepage: "https://wetleg.com/",
    instagram: "https://www.instagram.com/wetlegband/",
    wiki: "https://en.wikipedia.org/wiki/Wet_Leg",
  }, "a YouTube link pointing somewhere else is dropped");
  assert.equal(parsed.mbid, MBID);
  assert.equal(parsed.genre, "Rock");
  assert.equal(parsed.pageUrl, "https://www.ticketmaster.com/wet-leg-tickets/artist/2837613");
  assert.equal(parseTicketmasterAttraction(attraction({ externalLinks: { musicbrainz: [{ id: MBID }, { id: OTHER_MBID }] } }), { id: "K8vZ9171" }).mbid,
    null, "two different IDs means Ticketmaster is unsure");
  assert.equal(parseTicketmasterAttraction(attraction({ classifications: [{ primary: true, segment: { name: "Sports" } }] }), { id: "K8vZ9171" }),
    null, "not a music performer");
  assert.equal(parseTicketmasterAttraction(attraction(), { id: "someone-else" }), null);
  assert.equal(ticketmasterGenreLabel("Hip-Hop/Rap"), "Hip-Hop");
  assert.equal(ticketmasterGenreLabel("Undefined"), null);
  assert.match(ticketmasterProfileUrl("venues", "KovZ917", "key"), /^https:\/\/app\.ticketmaster\.com\/discovery\/v2\/venues\/KovZ917\.json\?/);
  assert.throws(() => ticketmasterProfileUrl("events", "x", "key"));
});

test("a Ticketmaster venue record becomes plain visitor details", () => {
  const venue = parseTicketmasterVenue({
    id: "KovZ917",
    name: "Brooklyn Steel",
    url: "https://www.ticketmaster.com/brooklyn-steel-tickets/venue/1",
    address: { line1: "319 Frost St" },
    boxOfficeInfo: { openHoursDetail: "Box office opens <b>one hour</b> before doors — cash only.", phoneNumberDetail: " " },
    parkingDetail: "Street parking only.",
    accessibleSeatingDetail: "Accessible viewing on the main floor.",
    generalInfo: { generalRule: "No outside food &amp; drink.", childRule: "All ages." },
  }, { id: "KovZ917" });
  assert.deepEqual(venue.details, {
    boxOfficeHours: "Box office opens one hour before doors, cash only.",
    parking: "Street parking only.",
    accessibility: "Accessible viewing on the main floor.",
    rules: "No outside food & drink.",
    children: "All ages.",
  }, "markup, entities and em dashes are removed; empty fields are left out");
  assert.equal(venue.address, "319 Frost St");
  assert.equal(parseTicketmasterVenue({ id: "other" }, { id: "KovZ917" }), null);
});

function wikidataFetch(entities, { searchHits = 1, qid = "Q100", pageQid = "Q100" } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed.hostname + " " + (parsed.searchParams.get("action") || "") + " " + (parsed.searchParams.get("list") || parsed.searchParams.get("prop") || ""));
    let body;
    if (parsed.searchParams.get("list") === "search") {
      body = { query: { searchinfo: { totalhits: searchHits }, search: searchHits ? [{ title: qid }] : [] } };
    } else if (parsed.searchParams.get("action") === "wbgetentities") {
      body = { entities: entities };
    } else {
      body = { query: { pages: [{ title: "Wet Leg", pageprops: { wikibase_item: pageQid } }] } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function item(id, { label = "Wet Leg", aliases = [], mbids = [MBID] } = {}) {
  return { [id]: { id, type: "item", labels: { en: { value: label } }, aliases: { en: aliases.map((value) => ({ value })) },
    claims: { P434: mbids.map((value) => ({ rank: "normal", mainsnak: { datavalue: { value } } })) } } };
}

test("Wikidata must confirm a MusicBrainz ID belongs to an artist with the same name", async () => {
  const noWait = { clock: () => 0, wait: async () => {} };
  const confirmed = await createWikidataIdentityBridge({ ...noWait, fetchImpl: wikidataFetch(item("Q100")) })({ name: "Wet Leg", mbid: MBID });
  assert.deepEqual(confirmed, { mbid: MBID, wikidataId: "Q100", via: "ticketmaster_musicbrainz" });

  assert.equal(await createWikidataIdentityBridge({ ...noWait, fetchImpl: wikidataFetch(item("Q100", { label: "Another Band" })) })
    ({ name: "Wet Leg", mbid: MBID }), null, "a different name is a different artist");
  assert.deepEqual(await createWikidataIdentityBridge({ ...noWait, fetchImpl: wikidataFetch(item("Q100", { label: "Wet Leg (band)", aliases: ["The Wet Leg"] })) })
    ({ name: "Wet Leg", mbid: MBID }), { mbid: MBID, wikidataId: "Q100", via: "ticketmaster_musicbrainz" }, "an alias counts, ignoring a leading The");

  const viaWiki = await createWikidataIdentityBridge({ ...noWait, fetchImpl: wikidataFetch(item("Q200"), { searchHits: 0, pageQid: "Q200" }) })
    ({ name: "Wet Leg", wikipediaUrl: "https://en.wikipedia.org/wiki/Wet_Leg" });
  assert.deepEqual(viaWiki, { mbid: MBID, wikidataId: "Q200", via: "ticketmaster_wikipedia" });

  assert.equal(await createWikidataIdentityBridge({ ...noWait, fetchImpl: wikidataFetch(item("Q200", { mbids: [MBID, OTHER_MBID] }), { searchHits: 0, pageQid: "Q200" }) })
    ({ name: "Wet Leg", wikipediaUrl: "https://en.wikipedia.org/wiki/Wet_Leg" }), null, "an item with two IDs is ambiguous");
  assert.equal(comparableName("The Beaches"), comparableName("Beaches"));
  assert.equal(wikipediaTitleFromUrl("https://fr.wikipedia.org/wiki/Wet_Leg"), null);
});

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT NOT NULL,mbid TEXT,genre TEXT,bio TEXT,data TEXT,updated_at INTEGER);
    CREATE TABLE provider_artist_identities(provider TEXT,provider_id TEXT,artist_key TEXT,provider_name TEXT,created_at INTEGER,last_seen_at INTEGER);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,venue TEXT,source TEXT,venue_provider_id TEXT,venue_city TEXT);
    INSERT INTO artists(norm,name,mbid,genre,bio,data) VALUES
      ('wet leg','Wet Leg',NULL,'Metal',NULL,'{"name":"Wet Leg"}'),
      ('known','Known Act','${OTHER_MBID}',NULL,'Has a bio.','{}'),
      ('twin','Twin Act',NULL,NULL,NULL,'{}');
    INSERT INTO provider_artist_identities VALUES
      ('ticketmaster','TM_WETLEG','wet leg','Wet Leg',1,300),
      ('ticketmaster','TM_KNOWN','known','Known Act',1,200),
      ('ticketmaster','TM_TWIN','twin','Twin Act',1,100);
    INSERT INTO tour_dates VALUES ('1','Wet Leg','Brooklyn Steel','ticketmaster','V_STEEL','Brooklyn'),('2','Known Act','Brooklyn Steel','ticketmaster','V_STEEL','Brooklyn'),
      ('3','Twin Act','The Fillmore','ticketmaster','V_FILL','San Francisco');`);
  ensureProviderProfileSchema(db);
  return db;
}

test("a pass fills performers and venues, adds only confirmed IDs, and never overwrites", async (t) => {
  const db = database(t);
  assert.equal(nextAttractionForProfile(db, { at: 10 }).id, "TM_WETLEG", "empty pages seen most recently go first");
  assert.equal(nextVenueForProfile(db, { at: 10 }).id, "V_STEEL", "the venue with the most shows goes first");

  const profiles = {
    "attractions:TM_WETLEG": parseTicketmasterAttraction(attraction({ id: "TM_WETLEG" }), { id: "TM_WETLEG" }),
    "attractions:TM_KNOWN": parseTicketmasterAttraction(attraction({ id: "TM_KNOWN", name: "Known Act", externalLinks: { musicbrainz: [{ id: MBID }] } }), { id: "TM_KNOWN" }),
    "attractions:TM_TWIN": parseTicketmasterAttraction(attraction({ id: "TM_TWIN", name: "Twin Act", externalLinks: { musicbrainz: [{ id: OTHER_MBID }] } }), { id: "TM_TWIN" }),
    "venues:V_STEEL": parseTicketmasterVenue({ id: "V_STEEL", name: "Brooklyn Steel", parkingDetail: "Street parking only." }, { id: "V_STEEL" }),
  };
  const fetched = [];
  const confirmIdentity = async ({ name, mbid }) => ({ mbid, wikidataId: "Q1", via: "ticketmaster_musicbrainz", name });
  const run = (env, extra = {}) => runProviderProfilePass({
    database: db, env, now: () => 1_000, wait: async () => {}, confirmIdentity, maxItems: 10,
    fetchProfile: async (kind, id) => { fetched.push(`${kind}:${id}`); return profiles[`${kind}:${id}`] ?? null; },
    ...extra,
  });
  assert.equal((await run({})).stopped, "not_configured");

  const pass = await run({ TICKETMASTER_KEY: "key" });
  assert.equal(pass.stopped, "nothing_due");
  assert.deepEqual(fetched, ["attractions:TM_WETLEG", "venues:V_STEEL", "attractions:TM_TWIN", "venues:V_FILL", "attractions:TM_KNOWN"],
    "empty pages before ones that already have a biography");

  const wetLeg = db.prepare("SELECT mbid,genre,data FROM artists WHERE norm='wet leg'").get();
  assert.equal(wetLeg.mbid, MBID, "a confirmed ID unlocks the Wikipedia biography worker");
  assert.equal(wetLeg.genre, "Rock", "Ticketmaster's genre outranks a crawl guess");
  const data = JSON.parse(wetLeg.data);
  assert.equal(data.name, "Wet Leg", "other stored fields are kept");
  assert.equal(data.mbidEvidence.via, "ticketmaster_musicbrainz");
  assert.ok(data.genreClaims.some((claim) => claim.source === "ticketmaster" && claim.value === "Rock"));

  assert.equal(db.prepare("SELECT mbid FROM artists WHERE norm='known'").get().mbid, OTHER_MBID, "an existing ID is never replaced");
  assert.equal(db.prepare("SELECT mbid FROM artists WHERE norm='twin'").get().mbid, null,
    "an ID another artist already has is not copied onto a second page");
  assert.equal(db.prepare("SELECT identity_status FROM provider_profiles WHERE provider_id='TM_TWIN'").get().identity_status, "conflict");

  const links = readArtistProviderProfile(db, "wet leg");
  assert.deepEqual(links.links.map((link) => link.label), ["Official site", "Instagram", "Wikipedia"]);
  assert.equal(links.genre, "Rock");
  assert.equal(links.source.name, "Ticketmaster");
  assert.deepEqual(readVenueProviderProfile(db, { venueKey: "Brooklyn Steel", providerVenueId: "V_STEEL" }).details, { parking: "Street parking only." });
  assert.equal(readVenueProviderProfile(db, { venueKey: "The Fillmore", providerVenueId: "V_STEEL" }), null,
    "a venue page cannot show another room's record");
  assert.deepEqual(readVenueProviderProfile(db, { venueKey: "Brooklyn Steel" })?.details, { parking: "Street parking only." },
    "a page opened from its link finds the one Ticketmaster venue with that name");
  db.prepare("INSERT INTO tour_dates VALUES ('9','Other','Brooklyn Steel','ticketmaster','V_OTHER_STEEL','Sheffield')").run();
  assert.equal(readVenueProviderProfile(db, { venueKey: "Brooklyn Steel" }), null,
    "two rooms with one name and no city to tell them apart show nothing");
  assert.deepEqual(readVenueProviderProfile(db, { venueKey: "Brooklyn Steel", city: "Brooklyn" })?.details, { parking: "Street parking only." },
    "the city picks the right room");
  assert.equal(db.prepare("SELECT status FROM provider_profiles WHERE provider_id='V_FILL'").get().status, "missing");

  const status = collectProviderProfileStatus(db, { env: { TICKETMASTER_KEY: "key" }, at: 1_000 });
  assert.deepEqual(status.today, { requests: 5, artists: 3, venues: 1, idsAdded: 1, genresAdded: 3 });
  assert.equal(status.artists.idsAdded, 1);
});

test("the daily allowance and a refused key stop a pass", async (t) => {
  const db = database(t);
  const fetchProfile = async () => null;
  const capped = await runProviderProfilePass({ database: db, env: { TICKETMASTER_KEY: "key", TICKETMASTER_PROFILE_DAILY_REQUESTS: "2" },
    now: () => 5, wait: async () => {}, fetchProfile, maxItems: 10 });
  assert.equal(capped.stopped, "daily_budget");
  assert.equal(collectProviderProfileStatus(db, { env: {}, at: 5 }).today.requests, 2);

  const refused = await runProviderProfilePass({ database: db, env: { TICKETMASTER_KEY: "key" }, now: () => 90 * 24 * 60 * 60 * 1000,
    wait: async () => {}, maxItems: 10,
    fetchProfile: async () => { throw Object.assign(new Error("no"), { code: "auth" }); } });
  assert.equal(refused.stopped, "auth", "a refused key is not retried page after page");
});
