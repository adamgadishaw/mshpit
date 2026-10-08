import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-festivals-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("../../db.js");
const { routes } = await import("../../api.js");
const { hashPassword } = await import("../../auth.js");
const { FESTIVAL_CATALOG } = await import("./festivalCatalog.js");
const { editionDays, expectedEdition, festivalActs, festivalEditionName, groupFestivalEditions, matchFestival } = await import("./festivalEditions.js");
const { createFestivalReader, createFestivalStore } = await import("./festivalStore.js");
const { festivalListingsFromTicketmaster, festivalScanEnabled, runFestivalScan } = await import("./festivalScan.js");
const { parseFestivalWikidata, parseFestivalWikipedia } = await import("./festivalKnowledge.js");
const { festivalYears, projectFestivalDocument, projectFestivalsHubDocument, renderFestivalMain } = await import("./festivalDocument.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

const entry = (slug) => FESTIVAL_CATALOG.find((item) => item.slug === slug);
const listing = (overrides) => ({ festivalSlug: "lollapalooza", providerEventId: `tm:${Math.random()}`, name: "Lollapalooza 2026", startDate: "2026-07-30",
  endDate: "2026-07-30", venue: "Grant Park", venueId: "v1", city: "Chicago", region: "IL", countryCode: "US", acts: [], ...overrides });
function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("festival-password"), "fan", "Chicago", 41.88, -87.63, "FE", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

test("ticket listings are matched to festivals and grouped into editions with a lineup by day", () => {
  assert.equal(matchFestival(FESTIVAL_CATALOG, "Rolling Loud Miami 2026 - 3 Day GA")?.slug, "rolling-loud");
  assert.equal(matchFestival(FESTIVAL_CATALOG, "Official Rolling Loud After Party"), null, "after-parties are not the festival");
  assert.equal(matchFestival(FESTIVAL_CATALOG, "A Night of Jazz"), null);
  assert.deepEqual(festivalActs(entry("lollapalooza"), [{ name: "Lollapalooza" }, { name: "Sabrina Carpenter" }, { name: "VIP Upgrade" }, { name: "sabrina carpenter" }, { name: "Tyler, The Creator" }]),
    ["Sabrina Carpenter", "Tyler, The Creator"], "the festival itself, pass products and repeats are not acts");

  const editions = groupFestivalEditions([
    listing({ providerEventId: "pass", name: "Lollapalooza 2026 4-Day", startDate: "2026-07-30", endDate: "2026-08-02", acts: ["Sabrina Carpenter", "Tyler, The Creator", "Muna"] }),
    listing({ providerEventId: "thu", name: "Lollapalooza Thursday", startDate: "2026-07-30", acts: ["Sabrina Carpenter", "Muna"] }),
    listing({ providerEventId: "sun", name: "Lollapalooza Sunday", startDate: "2026-08-02", acts: ["Tyler, The Creator"] }),
    listing({ festivalSlug: "coachella", providerEventId: "w1", name: "Coachella Weekend 1", startDate: "2026-04-10", endDate: "2026-04-12", venue: "Empire Polo Club", venueId: "v2", city: "Indio", acts: ["Lady Gaga"] }),
    listing({ festivalSlug: "coachella", providerEventId: "w2", name: "Coachella Weekend 2", startDate: "2026-04-17", endDate: "2026-04-19", venue: "Empire Polo Club", venueId: "v2", city: "Indio", acts: ["Lady Gaga"] }),
  ]);
  assert.deepEqual(editions.map((edition) => [edition.festivalSlug, edition.startDate, edition.endDate]), [
    ["coachella", "2026-04-10", "2026-04-12"], ["coachella", "2026-04-17", "2026-04-19"], ["lollapalooza", "2026-07-30", "2026-08-02"],
  ], "a festival's two weekends stay separate editions");
  const lolla = editions[2];
  assert.equal(lolla.name, "Lollapalooza 2026", "the public name drops the ticket product");
  assert.deepEqual(lolla.lineup, [
    { name: "Sabrina Carpenter", days: ["2026-07-30"] }, { name: "Tyler, The Creator", days: ["2026-08-02"] }, { name: "Muna", days: ["2026-07-30"] },
  ]);
  assert.deepEqual(editionDays("2026-07-30", "2026-08-02"), ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
  assert.deepEqual(expectedEdition([{ startDate: "2025-07-31", endDate: "2025-08-03", city: "Chicago" }], { today: "2026-09-01" }),
    { year: 2027, month: 7, label: "Expected late July 2027", basis: { startDate: "2025-07-31", endDate: "2025-08-03", city: "Chicago" } },
    "an estimate always lands in the future");
  assert.equal(expectedEdition([], { today: "2026-09-01" }), null);
});

test("Ticketmaster events become listings; the scan only runs with a key", () => {
  const data = { _embedded: { events: [
    { id: "E1", name: "Lollapalooza 2026 - Friday", url: "https://www.ticketmaster.com/event/E1", dates: { start: { localDate: "2026-07-31" } },
      _embedded: { venues: [{ id: "V", name: "Grant Park", city: { name: "Chicago" }, state: { stateCode: "IL" }, country: { countryCode: "US" }, location: { latitude: "41.87", longitude: "-87.62" } }],
        attractions: [{ name: "Lollapalooza" }, { name: "Olivia Rodrigo" }] } },
    { id: "E2", name: "Lollapalooza Aftershow: Muna", dates: { start: { localDate: "2026-07-31" } } },
    { id: "E3", name: "Lollapalooza 2026 Parking", dates: { start: {} } },
  ] } };
  const listings = festivalListingsFromTicketmaster(entry("lollapalooza"), data);
  assert.equal(listings.length, 1);
  assert.deepEqual({ ...listings[0], ticketUrl: Boolean(listings[0].ticketUrl) }, {
    festivalSlug: "lollapalooza", providerEventId: "tm:E1", name: "Lollapalooza 2026 - Friday", startDate: "2026-07-31", endDate: "2026-07-31",
    venue: "Grant Park", venueId: "V", city: "Chicago", region: "IL", countryCode: "US", lat: 41.87, lng: -87.62, imageUrl: null, imageAttribution: null,
    ticketUrl: true, acts: ["Olivia Rodrigo"],
  });
  assert.equal(festivalScanEnabled({}), false);
  assert.equal(festivalScanEnabled({ TICKETMASTER_KEY: "k" }), true);
  assert.equal(festivalScanEnabled({ TICKETMASTER_KEY: "k", FESTIVAL_SCAN_ENABLED: "false" }), false);
});

test("Wikipedia history is kept only for a real festival article", () => {
  const page = (overrides) => ({ query: { pages: [{ ns: 0, title: "Lollapalooza", lastrevid: 42, pageprops: { wikibase_item: "Q1" },
    extract: "Lollapalooza is an annual American four-day music festival held in Grant Park in Chicago.", ...overrides }] } });
  const parsed = parseFestivalWikipedia(page(), { retrievedAt: 1 });
  assert.equal(parsed.wikidataId, "Q1");
  assert.equal(parsed.source.url, "https://en.wikipedia.org/wiki/Lollapalooza");
  assert.equal(parseFestivalWikipedia(page({ extract: "Lollapalooza may refer to a kind of lollipop." }), { retrievedAt: 1 }), null, "not about a festival");
  assert.equal(parseFestivalWikipedia(page({ missing: true }), { retrievedAt: 1 }), null);
  assert.equal(parseFestivalWikipedia(page({ pageprops: { disambiguation: "" } }), { retrievedAt: 1 }), null);
  assert.deepEqual(parseFestivalWikidata({ entities: { Q1: { claims: {
    P571: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { time: "+1991-00-00T00:00:00Z" } } } }],
    P856: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: "http://insecure.example" } } },
      { rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: "https://www.lollapalooza.com/" } } }],
  } } } }, "Q1"), { foundedYear: 1991, website: "https://www.lollapalooza.com/" });
});

test("a scan builds editions, the pages read them, and members plan their days", async () => {
  let clock = Date.now();
  const now = () => clock;
  const store = createFestivalStore(db, { now });
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(new URL(url).hostname);
    const host = new URL(url).hostname;
    if (host === "app.ticketmaster.com") {
      const keyword = new URL(url).searchParams.get("keyword");
      const events = keyword === "Lollapalooza" ? [
        { id: "L1", name: "Lollapalooza 2027 - Thursday", dates: { start: { localDate: "2027-07-29" } },
          _embedded: { venues: [{ id: "GP", name: "Grant Park", city: { name: "Chicago" }, country: { countryCode: "US" } }], attractions: [{ name: "Sabrina Carpenter" }, { name: "Muna" }] } },
        { id: "L2", name: "Lollapalooza 2027 - Friday", dates: { start: { localDate: "2027-07-30" } },
          _embedded: { venues: [{ id: "GP", name: "Grant Park", city: { name: "Chicago" }, country: { countryCode: "US" } }], attractions: [{ name: "Tyler, The Creator" }] } },
      ] : [];
      return new Response(JSON.stringify({ _embedded: { events } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ query: { pages: [{ missing: true, ns: 0, title: "x" }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const catalog = [entry("lollapalooza"), entry("coachella")];
  const summary = await runFestivalScan({ database: db, store, env: { TICKETMASTER_KEY: "test" }, fetchImpl, now, catalog,
    knowledge: async () => ({ about: "Lollapalooza is an annual music festival.", source: { provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Lollapalooza", license: "CC BY-SA 4.0" }, foundedYear: 1991, website: "https://www.lollapalooza.com/" }) });
  assert.equal(summary.scanned, 2);
  assert.equal(summary.listings, 2);
  assert.ok(requests.every((host) => host === "app.ticketmaster.com"), "histories came from the injected source");

  const list = routes["GET /api/festivals"]({ query: {}, ip: "203.0.113.20", setHeader() {} });
  const lolla = list.upcoming.find((edition) => edition.festivalSlug === "lollapalooza");
  assert.deepEqual([lolla.startDate, lolla.endDate, lolla.lineupCount, lolla.going], ["2027-07-29", "2027-07-30", 3, 0]);
  assert.equal(lolla.lineupChangedAt, null, "lineups found in the first cycle are not 'just announced'");
  assert.equal(routes["GET /api/festivals"]({ query: { country: "GB" }, ip: "203.0.113.20", setHeader() {} }).upcoming.length, 0);

  const fan = addUser("u_festival_fan");
  const saved = routes["PUT /api/festivals/:slug/plan"]({ user: fan, params: { slug: "lollapalooza" }, ip: "203.0.113.21",
    body: { editionId: lolla.id, days: ["2027-07-30", "2027-07-30", "2027-01-01"], mustSee: ["tyler, the creator", "Not On The Bill"] } });
  assert.deepEqual([saved.plan.days, saved.plan.mustSee], [["2027-07-30"], ["Tyler, The Creator"]], "only the edition's days and billed acts are kept");
  assert.throws(() => routes["PUT /api/festivals/:slug/plan"]({ user: fan, params: { slug: "lollapalooza" }, ip: "203.0.113.21",
    body: { editionId: lolla.id, days: ["2027-01-01"] } }), (error) => error.status === 400);
  assert.throws(() => routes["PUT /api/festivals/:slug/plan"]({ user: fan, params: { slug: "coachella" }, ip: "203.0.113.21",
    body: { editionId: lolla.id, days: ["2027-07-30"] } }), (error) => error.status === 404, "an edition belongs to its festival");

  const page = routes["GET /api/festivals/:slug"]({ user: fan, params: { slug: "lollapalooza" }, ip: "203.0.113.22", setHeader() {} });
  assert.equal(page.festival.about, "Lollapalooza is an annual music festival.");
  assert.equal(page.festival.foundedYear, 1991);
  const edition = page.upcoming[0];
  assert.deepEqual(edition.lineup.map((act) => [act.name, act.days]), [["Sabrina Carpenter", ["2027-07-29"]], ["Muna", ["2027-07-29"]], ["Tyler, The Creator", ["2027-07-30"]]]);
  assert.deepEqual([edition.going, edition.goingByDay, edition.mustSee, edition.plan.days], [1, { "2027-07-30": 1 }, [{ name: "Tyler, The Creator", fans: 1 }], ["2027-07-30"]]);
  assert.equal(Object.hasOwn(routes["GET /api/festivals/:slug"]({ params: { slug: "lollapalooza" }, ip: "203.0.113.22", setHeader() {} }).upcoming[0], "plan"), false,
    "a guest's page has no plan field");
  assert.throws(() => routes["GET /api/festivals/:slug"]({ params: { slug: "not-a-festival" }, ip: "203.0.113.22", setHeader() {} }), (error) => error.status === 404);

  // A later lineup change is news; the first cycle's were not.
  clock = Date.now() + 2 * 86_400_000;
  store.saveListings([{ festivalSlug: "lollapalooza", providerEventId: "tm:L3", name: "Lollapalooza 2027 - Friday", startDate: "2027-07-30", endDate: "2027-07-30",
    venue: "Grant Park", venueId: "GP", city: "Chicago", countryCode: "US", acts: ["Tyler, The Creator", "Doechii"] }]);
  store.rebuildEditions("lollapalooza");
  const refreshed = routes["GET /api/festivals"]({ query: {}, ip: "203.0.113.20", setHeader() {} }).upcoming.find((item) => item.festivalSlug === "lollapalooza");
  assert.equal(refreshed.id, lolla.id, "the edition keeps its id, and members' plans with it");
  assert.equal(refreshed.lineupCount, 4);
  assert.equal(refreshed.lineupChangedAt, clock);

  routes["DELETE /api/festivals/:slug/plan"]({ user: fan, params: { slug: "lollapalooza" }, query: { editionId: lolla.id }, ip: "203.0.113.23" });
  assert.equal(routes["GET /api/festivals/:slug"]({ user: fan, params: { slug: "lollapalooza" }, ip: "203.0.113.22", setHeader() {} }).upcoming[0].plan, null);

  // Once it has passed, the next edition is estimated, not announced.
  const afterwards = createFestivalReader(db, { now: () => Date.parse("2027-09-15T12:00:00Z") }).festival("lollapalooza");
  assert.deepEqual([afterwards.upcoming.length, afterwards.past.length, afterwards.expected?.label], [0, 1, undefined]);
});

test("festival reviews on a festival's page", () => {
  const reviewer = addUser("u_festival_reviewer");
  routes["POST /api/posts"]({ user: reviewer, ip: "203.0.113.30", body: {
    clientMutationId: "festival_review_1", artist: "Lollapalooza 2025", showFormat: "festival", date: "2025-07-31", endDate: "2025-08-03",
    venue: "Grant Park", city: "Chicago", overall: 4.5, review: "Four days of sun.", lineup: [{ name: "Muna", day: "2025-08-01", rating: 5 }],
  } });
  const page = routes["GET /api/festivals/:slug"]({ params: { slug: "lollapalooza" }, ip: "203.0.113.31", setHeader() {} });
  assert.equal(page.reviewStats.reviews, 1);
  assert.equal(page.reviewStats.average, 4.5);
  assert.equal(page.reviews[0].review, "Four days of sun.");
  assert.equal(page.reviews[0].user.handle, "u_festival_reviewer");
});

test("search engines get the lineup, dates and Festival structured data", () => {
  const page = createFestivalReader(db).festival("lollapalooza");
  const document = projectFestivalDocument({ origin: "https://www.mshpit.com", page });
  assert.equal(document.heading, "Lollapalooza 2027 Lineup, Dates & Tickets");
  assert.equal(document.canonicalPath, "/festival/lollapalooza");
  assert.equal(document.indexable, true);
  assert.match(document.description, /^Lollapalooza runs Jul 29 to 30, 2027 at Grant Park, Chicago, 2 days\. Lineup includes Sabrina Carpenter/u);
  const festival = document.jsonLd.find((item) => item["@type"] === "Festival");
  assert.deepEqual([festival.startDate, festival.endDate, festival.location.address.addressLocality, festival.performer.length],
    ["2027-07-29", "2027-07-30", "Chicago", 4]);
  const html = renderFestivalMain(document);
  assert.match(html, /<h1>Lollapalooza 2027 Lineup, Dates &amp; Tickets<\/h1>/u);
  assert.match(html, /<h3>Thursday, Jul 29<\/h3><p class="festival-lineup">Sabrina Carpenter · Muna<\/p>/u, "the lineup by day is in the HTML");
  assert.match(html, /Source: <a href="https:\/\/en\.wikipedia\.org\/wiki\/Lollapalooza"/u);
  assert.match(html, /<h2 id="festival-facts">Lollapalooza 2027 at a glance<\/h2>/u, "a day ticket's name is not the festival's name");
  assert.match(html, /<dt>Dates<\/dt><dd>Jul 29 to 30, 2027<\/dd>/u);
  assert.equal(festival.offers?.availability, undefined, "no claim that tickets are in stock");

  const hub = projectFestivalsHubDocument({ upcoming: createFestivalReader(db).upcoming() });
  assert.equal(hub.canonicalPath, "/festivals");
  assert.equal(hub.indexable, false, "the hub waits until it lists a few festivals");
  assert.match(renderFestivalMain(hub), /href="\/festival\/lollapalooza"/u);
  assert.match(renderFestivalMain(hub), /<h2 id="festivals-2027-07">July 2027<\/h2>/u, "the hub lists festivals under month headings");
  assert.equal(hub.heading, "Music Festivals 2027: Dates, Lineups & Tickets");
  assert.equal(festivalYears([{ startDate: "2027-01-02" }, { startDate: "2026-12-30" }, { startDate: "2028-06-01" }]), "2026 and 2027");
  assert.equal(festivalYears([]), "");
});

test("edition names drop the ticket product and carry the year", () => {
  const name = (raw) => festivalEditionName(raw, { year: "2027", fallback: "festival" });
  assert.equal(name("Lollapalooza 2027 - Thursday"), "Lollapalooza 2027");
  assert.equal(name("Rolling Loud Miami | 3 Day GA"), "Rolling Loud Miami 2027");
  assert.equal(name("Outside Lands (3-Day Pass)"), "Outside Lands 2027");
  assert.equal(name("Governors Ball Music Festival: Friday"), "Governors Ball Music Festival 2027");
  assert.equal(name("Rolling Loud Miami 2027 3-Day GA"), "Rolling Loud Miami 2027");
  assert.equal(name("Lollapalooza Thursday"), "Lollapalooza 2027");
  assert.equal(name("Coachella Valley Music and Arts Festival - Weekend 1"), "Coachella Valley Music and Arts Festival 2027 - Weekend 1");
  assert.equal(name("Coachella - Weekend 2 - 3 Day GA Pass"), "Coachella 2027 - Weekend 2");
  assert.equal(name("Day N Vegas 2027 - Saturday"), "Day N Vegas 2027", "a festival named Day keeps its name");
  assert.equal(name("Lovers & Friends: The Reunion"), "Lovers & Friends: The Reunion 2027", "a subtitle that is not a ticket stays");
  assert.equal(name(""), "festival 2027");
  assert.equal(festivalEditionName("Primavera Sound 2026", { year: "2026" }), "Primavera Sound 2026");
});

const { reconcileBootsAndHearts } = await import("./festivalIdentityReconciliation.js");
const { withFestivalAnnouncements } = await import("./festivalAnnouncements.js");
const { readFileSync } = await import("node:fs");

test("Ontario and West matching is explicit, location-aware and independent of catalog ordering", () => {
  const ontario = entry("boots-and-hearts");
  const west = entry("boots-and-hearts-west");
  for (const catalog of [FESTIVAL_CATALOG, [west, ontario], [ontario], [west]]) {
    for (const [name, location, target] of [
      ["Boots and Hearts West 2026", {}, west.slug],
      ["Boots & Hearts West - 2 Day GA", { city: "Edmonton", region: "AB", countryCode: "CA" }, west.slug],
      ["Boots and Hearts 2026", { city: "Edmonton" }, west.slug],
      ["Boots & Hearts 2027", { venue: "Burl's Creek", region: "ON" }, ontario.slug],
      ["Boots and Hearts 2027", { city: "Oro-Medonte" }, ontario.slug],
      ["Boots and Hearts", {}, null],
      ["Boots and Hearts", { city: "Toronto" }, null],
      ["Boots and Hearts West", { region: "ON" }, null],
      ["Boots and Hearts", { city: "Edmonton", region: "ON" }, null],
      ["Boots and Hearts", { region: "ON", countryCode: "US" }, null],
      ["Boots and Hearts West After Party", { city: "Edmonton" }, null],
    ]) assert.equal(matchFestival(catalog, name, location)?.slug || null, catalog.some((item) => item.slug === target) ? target : null);
  }
  assert.equal(matchFestival(FESTIVAL_CATALOG, "Rolling Loud Miami", { city: "Vienna" })?.slug, "rolling-loud", "no global city gate");
  const events = [
    { id: "BW", name: "Boots and Hearts West", dates: { start: { localDate: "2026-08-28" }, end: { localDate: "2026-08-29" } }, _embedded: { venues: [{ name: "Fan Park", city: { name: "Edmonton" }, country: { countryCode: "CA" } }] } },
    { id: "BO", name: "Boots & Hearts 2027", dates: { start: { localDate: "2027-08-06" } }, _embedded: { venues: [{ name: "Burl's Creek", city: { name: "Oro-Medonte" } }] } },
    { id: "BA", name: "Boots and Hearts", dates: { start: { localDate: "2027-08-01" } } },
  ];
  assert.deepEqual(festivalListingsFromTicketmaster(ontario, { _embedded: { events } }).map((item) => item.providerEventId), ["tm:BO"]);
  assert.deepEqual(festivalListingsFromTicketmaster(west, { _embedded: { events } }).map((item) => item.providerEventId), ["tm:BW"]);
});

test("tour-date ingestion uses the same family disambiguation", async () => {
  const artist = db.prepare("SELECT norm FROM artists LIMIT 1").get();
  const insert = db.prepare(`INSERT INTO tour_dates (id,artist,updated_at,artist_key,date,venue,venue_city,venue_region,venue_country_code,source,provider_event_id,event_name,event_kind) VALUES (?, 'Festival Act', 1,?,?,?,?,?,?,'ticketmaster',?,?,'festival')`);
  for (const [id, name, city, region] of [["family-west", "Boots & Hearts West", "Edmonton", "AB"], ["family-ontario", "Boots and Hearts", "Oro-Medonte", "ON"], ["family-unknown", "Boots and Hearts", "", ""]])
    insert.run(id, artist.norm, "2026-10-08", id, city, region, "CA", id, name);
  const store = createFestivalStore(db, { now: () => Date.parse("2026-10-08T12:00:00Z") });
  const found = store.tourDateListings((name, location) => matchFestival(FESTIVAL_CATALOG, name, location)).filter((item) => item.providerEventId.includes("family-"));
  assert.deepEqual(found.map((item) => [item.providerEventId, item.festivalSlug]), [["tm:family-ontario", "boots-and-hearts"], ["tm:family-west", "boots-and-hearts-west"]]);
});

test("guarded reconciliation preserves IDs, plans, tickets and user posts across repeats and rebuilds", () => {
  const now = () => Date.parse("2026-10-08T12:00:00Z");
  const store = createFestivalStore(db, { now });
  const row = listing({ festivalSlug: "boots-and-hearts", providerEventId: "tm:legacy-west", name: "Boots and Hearts West 2026", startDate: "2026-08-28", endDate: "2026-08-29", venue: "Fan Park", venueId: "fanpark", city: "Edmonton", region: "AB", countryCode: "CA", ticketUrl: "https://www.ticketmaster.ca/event/legacy-west", acts: ["Midland"] });
  store.saveListings([row]);
  // Model the pre-fix saved edition, independently of today's corrected rebuild.
  db.prepare(`INSERT INTO festival_editions (id,festival_slug,name,start_date,end_date,venue,city,region,country_code,ticket_url,lineup,lineup_count,first_seen_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("legacy-west-id", row.festivalSlug, row.name, row.startDate, row.endDate, row.venue, row.city, row.region, row.countryCode, row.ticketUrl, JSON.stringify([{ name: "Midland", days: [] }]), 1, 1, 1);
  db.prepare(`INSERT INTO festival_editions (id,festival_slug,name,start_date,end_date,first_seen_at,updated_at) VALUES ('ambiguous-family','boots-and-hearts','Boots and Hearts','2025-08-01','2025-08-02',1,1)`).run();
  const fan = addUser("u_family_plan");
  db.prepare("INSERT INTO festival_plans (user_id,edition_id,days,must_see,created_at,updated_at) VALUES (?,?,'[\"2026-08-28\"]','[\"Midland\"]',1,1)").run(fan.id, "legacy-west-id");
  const beforePlans = db.prepare("SELECT * FROM festival_plans ORDER BY user_id,edition_id").all();
  const beforePosts = db.prepare("SELECT * FROM posts ORDER BY id").all();
  const beforeEdition = db.prepare("SELECT * FROM festival_editions WHERE id='legacy-west-id'").get();
  const dry = reconcileBootsAndHearts(db);
  assert.deepEqual(dry.editions, [{ id: "legacy-west-id", from: "boots-and-hearts", to: "boots-and-hearts-west" }]);
  assert.ok(dry.skipped.some((item) => item.id === "ambiguous-family"));
  assert.deepEqual(db.prepare("SELECT * FROM festival_editions WHERE id='legacy-west-id'").get(), beforeEdition, "dry run does not mutate");
  const reader = createFestivalReader(db, { now });
  assert.equal(reader.festival("boots-and-hearts").past.length, 0, "no Edmonton history or forecast on Ontario");
  assert.equal(reader.festival("boots-and-hearts-west").past[0].id, "legacy-west-id", "read projection preserves history before explicit repair");
  store.saveListings([{ ...row, festivalSlug: "boots-and-hearts-west" }]);
  store.rebuildEditions("boots-and-hearts-west");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM festival_editions WHERE city='Edmonton'").get().n, 1, "fresh ingest cannot create a duplicate before repair");
  reconcileBootsAndHearts(db, { apply: true });
  assert.deepEqual({ ...db.prepare("SELECT * FROM festival_editions WHERE id='legacy-west-id'").get() }, { ...beforeEdition, festival_slug: "boots-and-hearts-west" });
  assert.deepEqual(reconcileBootsAndHearts(db, { apply: true }).editions, []);
  store.rebuildEditions("boots-and-hearts-west");
  store.rebuildEditions("boots-and-hearts");
  store.rebuildEditions("boots-and-hearts-west");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM festival_editions WHERE city='Edmonton'").get().n, 1);
  assert.equal(reader.edition("legacy-west-id").ticketUrl, row.ticketUrl);
  assert.deepEqual(db.prepare("SELECT * FROM festival_plans ORDER BY user_id,edition_id").all(), beforePlans);
  assert.deepEqual(db.prepare("SELECT * FROM posts ORDER BY id").all(), beforePosts);
  assert.equal(reader.festival("boots-and-hearts-west").expected, null);
});

test("review association distinguishes West, Ontario and ambiguous posts without changing posts", () => {
  const fan = addUser("u_family_review");
  for (const [id, artist, city, venue] of [["family-review-on", "Boots & Hearts 2026", "Oro-Medonte, ON", "Burl's Creek"], ["family-review-west", "Boots and Hearts West 2026", "Edmonton", "Fan Park"], ["family-review-ambiguous", "Boots and Hearts", "Toronto", ""]])
    routes["POST /api/posts"]({ user: fan, ip: "203.0.113.81", body: { clientMutationId: id, artist, city, venue, showFormat: "festival", date: "2026-08-28", overall: 4, review: id } });
  const before = db.prepare("SELECT * FROM posts ORDER BY id").all();
  const reader = createFestivalReader(db);
  assert.deepEqual(reader.festival("boots-and-hearts").reviews.map((item) => item.review), ["family-review-on"]);
  assert.deepEqual(reader.festival("boots-and-hearts-west").reviews.map((item) => item.review), ["family-review-west"]);
  assert.equal(reader.festival("boots-and-hearts").reviewStats.reviews, 1);
  assert.equal(reader.festival("boots-and-hearts-west").reviewStats.reviews, 1);
  assert.deepEqual(db.prepare("SELECT * FROM posts ORDER BY id").all(), before);
});

test("confirmed date-only editions and unannounced dates render consistently without invented schema", () => {
  const reader = createFestivalReader(db, { now: () => Date.parse("2026-10-08T12:00:00Z") });
  const page = reader.festival("boots-and-hearts");
  const announced = page.upcoming[0];
  assert.deepEqual([announced.startDate, announced.endDate, announced.lineup, announced.ticketUrl, page.expected], ["2027-08-06", "2027-08-08", [], null, null]);
  assert.equal(announced.dateSource.url, "https://bootsandhearts.com/");
  assert.equal(reader.upcoming().find((item) => item.festivalSlug === "boots-and-hearts").startDate, announced.startDate);
  assert.equal(reader.upcoming({ country: "GB" }).some((item) => item.festivalSlug === "boots-and-hearts"), false);
  const document = projectFestivalDocument({ page });
  const schema = document.jsonLd.find((item) => item["@type"] === "Festival");
  assert.deepEqual([schema.startDate, schema.endDate, schema.performer, schema.offers], ["2027-08-06", "2027-08-08", undefined, undefined]);
  assert.equal(document.canonicalPath, "/festival/boots-and-hearts");
  assert.match(document.title, /Boots and Hearts 2027/u);
  assert.match(document.description, /Aug 6 to 8, 2027/u);
  assert.match(renderFestivalMain(document), /Aug 6 to 8, 2027/u);
  const overwritten = withFestivalAnnouncements([{ festivalSlug: "boots-and-hearts", id: "wrong-provider-date", startDate: "2027-08-28", endDate: "2027-08-29", lineup: [{ name: "Old Act" }], ticketUrl: "https://www.ticketmaster.ca/event/old" }], { today: "2026-10-08" });
  assert.equal(overwritten.length, 1);
  assert.equal(overwritten[0].startDate, "2027-08-06");
  assert.equal(overwritten[0].ticketUrl, null);
  const lost = reader.festival("lost-lands");
  lost.expected = expectedEdition([{ startDate: "2026-09-18" }], { today: "2026-10-08" }); // old API payload still cannot lead with a guess
  const unannounced = projectFestivalDocument({ page: lost });
  assert.match(unannounced.title, /Dates Not Announced Yet/u);
  assert.match(unannounced.description, /dates have not been announced yet/u);
  assert.doesNotMatch(unannounced.description, /expected|2027/iu);
  assert.equal(unannounced.jsonLd.some((item) => item["@type"] === "Festival"), false);
  assert.match(renderFestivalMain(unannounced), /Dates have not been announced yet/u);
  const app = readFileSync(new URL("../../../src/features/festivals/FestivalScreen.jsx", import.meta.url), "utf8");
  assert.match(app, /Dates have not been announced yet/u);
  assert.doesNotMatch(app, /page.expected/u);
  assert.match(app, /festivalDateRange\(edition.startDate, edition.endDate\)/u);
});

test("confirmed dates preserve saved edition and plan identity through all readers", () => {
  const now = () => Date.parse("2026-10-08T12:00:00Z");
  const store = createFestivalStore(db, { now });
  store.saveListings([listing({ festivalSlug: "boots-and-hearts", providerEventId: "tm:future-ontario", name: "Boots and Hearts 2027", startDate: "2027-08-27", endDate: "2027-08-29", city: "Oro-Medonte", region: "ON", countryCode: "CA", venue: "Burl's Creek", venueId: "burls", acts: ["Unverified Act"], ticketUrl: "https://www.ticketmaster.ca/event/unverified" })]);
  store.rebuildEditions("boots-and-hearts");
  const saved = db.prepare("SELECT * FROM festival_editions WHERE festival_slug='boots-and-hearts' AND start_date='2027-08-27'").get();
  const fan = addUser("u_ontario_saved_plan");
  db.prepare("INSERT INTO festival_plans (user_id,edition_id,days,must_see,created_at,updated_at) VALUES (?,?,'[\"2027-08-27\"]','[]',1,1)").run(fan.id, saved.id);
  const beforePlans = db.prepare("SELECT * FROM festival_plans WHERE edition_id=?").all(saved.id);
  const reader = createFestivalReader(db, { now });
  for (const edition of [reader.festival("boots-and-hearts", { viewerId: fan.id }).upcoming[0], reader.upcoming().find((item) => item.festivalSlug === "boots-and-hearts"), reader.edition(saved.id)]) {
    assert.equal(edition.id, saved.id);
    assert.equal(edition.startDate, "2027-08-06");
    assert.equal(edition.ticketUrl, null);
    assert.equal(edition.lineupCount, 0);
  }
  assert.deepEqual(reader.festival("boots-and-hearts", { viewerId: fan.id }).upcoming[0].plan.days, ["2027-08-27"], "stored plans are preserved for member correction");
  assert.deepEqual(db.prepare("SELECT * FROM festival_plans WHERE edition_id=?").all(saved.id), beforePlans);
  assert.equal(db.prepare("SELECT start_date FROM festival_editions WHERE id=?").get(saved.id).start_date, "2027-08-27", "announcement projection is read-only");
  const history = createFestivalReader(db, { now: () => Date.parse("2028-01-01T00:00:00Z") }).festival("boots-and-hearts");
  assert.equal(history.past.find((item) => item.id === saved.id).startDate, "2027-08-06");
});

test("rebuild never reuses ambiguous saved Boots identities or colliding IDs", () => {
  const store = createFestivalStore(db);
  const id = "boots-and-hearts:2028-08-04:burl-s-creek";
  db.prepare(`INSERT INTO festival_editions (id,festival_slug,name,start_date,end_date,first_seen_at,updated_at) VALUES (?,'boots-and-hearts','Boots and Hearts','2028-08-04','2028-08-06',1,1)`).run(id);
  const before = db.prepare("SELECT * FROM festival_editions WHERE id=?").get(id);
  store.saveListings([listing({ festivalSlug: "boots-and-hearts", providerEventId: "tm:ambiguous-collision", name: "Boots and Hearts 2028", startDate: "2028-08-04", endDate: "2028-08-06", city: null, venue: "Burl's Creek", region: "ON", countryCode: "CA" })]);
  store.rebuildEditions("boots-and-hearts");
  store.rebuildEditions("boots-and-hearts");
  assert.deepEqual(db.prepare("SELECT * FROM festival_editions WHERE id=?").get(id), before);
  assert.equal(matchFestival(FESTIVAL_CATALOG, "Boots and Hearts West", { city: "Toronto" }), null);
});

test("official dates determine upcoming versus past even when provider dates disagree", () => {
  const saved = db.prepare("SELECT id FROM festival_editions WHERE festival_slug='boots-and-hearts' AND start_date='2027-08-27'").get();
  const after = createFestivalReader(db, { now: () => Date.parse("2027-08-10T00:00:00Z") });
  const page = after.festival("boots-and-hearts");
  assert.equal(page.upcoming.length, 0);
  assert.deepEqual(page.past.filter((item) => item.startDate.slice(0, 4) === "2027").map((item) => [item.id, item.startDate]), [[saved.id, "2027-08-06"]]);
  assert.equal(after.upcoming().some((item) => item.festivalSlug === "boots-and-hearts"), false);
  assert.equal(projectFestivalDocument({ page }).jsonLd.some((item) => item["@type"] === "Festival"), false);
  db.prepare("UPDATE festival_editions SET start_date='2027-07-28',end_date='2027-07-30' WHERE id=?").run(saved.id);
  const before = createFestivalReader(db, { now: () => Date.parse("2027-08-01T00:00:00Z") });
  assert.equal(before.festival("boots-and-hearts").upcoming[0].id, saved.id);
  assert.equal(before.festival("boots-and-hearts").past.some((item) => item.id === saved.id), false);
  assert.equal(before.upcoming().find((item) => item.festivalSlug === "boots-and-hearts").id, saved.id);
});


test("hub preserves independently identified Ontario IDs stored under the sibling slug", () => {
  const saved = db.prepare("SELECT id FROM festival_editions WHERE festival_slug='boots-and-hearts' AND start_date='2027-07-28'").get();
  db.prepare("UPDATE festival_editions SET festival_slug='boots-and-hearts-west' WHERE id=?").run(saved.id);
  const reader = createFestivalReader(db, { now: () => Date.parse("2027-08-01T00:00:00Z") });
  assert.equal(reader.festival("boots-and-hearts").upcoming[0].id, saved.id);
  assert.equal(reader.upcoming().find((item) => item.festivalSlug === "boots-and-hearts").id, saved.id);
});
