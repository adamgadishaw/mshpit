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
const { editionDays, expectedEdition, festivalActs, groupFestivalEditions, matchFestival } = await import("./festivalEditions.js");
const { createFestivalReader, createFestivalStore } = await import("./festivalStore.js");
const { festivalListingsFromTicketmaster, festivalScanEnabled, runFestivalScan } = await import("./festivalScan.js");
const { parseFestivalWikidata, parseFestivalWikipedia } = await import("./festivalKnowledge.js");
const { projectFestivalDocument, projectFestivalsHubDocument, renderFestivalMain } = await import("./festivalDocument.js");
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
  assert.equal(lolla.name, "Lollapalooza 2026 4-Day");
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
  assert.deepEqual([afterwards.upcoming.length, afterwards.past.length, afterwards.expected?.label], [0, 1, "Expected late July 2028"]);
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

  const hub = projectFestivalsHubDocument({ upcoming: createFestivalReader(db).upcoming() });
  assert.equal(hub.canonicalPath, "/festivals");
  assert.equal(hub.indexable, false, "the hub waits until it lists a few festivals");
  assert.match(renderFestivalMain(hub), /href="\/festival\/lollapalooza"/u);
});
