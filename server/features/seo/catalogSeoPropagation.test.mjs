import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-catalog-seo-propagation-"));
process.env.PIT_DATA_DIR = directory;
const { db } = await import("../../db.js");
const { createArtistKnowledgeRefresher } = await import("../../artistKnowledgeRefresh.js");
const { upsertProviderTourDateRows } = await import("../../tourdates.js");
const { createPublicDocumentService } = await import("./publicDocuments.js");
const { artistSitemapEntries, eventSitemapEntries, venueSitemapEntries, urlsetParts } = await import("./sitemapService.js");
const MBID = "11111111-1111-4111-8111-111111111111";
const OTHER_MBID = "22222222-2222-4222-8222-222222222222";
const AT = Date.parse("2026-09-15T12:00:00Z");
const BIO = "Propagation Band formed in Toronto and performs original music. Its source-backed biography describes the musicians and their recorded work.";
const knowledge = {
  version: 1, mbid: MBID, wikidataId: "Q123", wikidataUrl: "https://www.wikidata.org/wiki/Q123",
  bio: BIO, country: "Canada", bioSource: {
    provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Propagation_Band",
    revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123", license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", modified: true,
    mbid: MBID, wikidataId: "Q123", retrievedAt: AT,
  },
};
const documents = createPublicDocumentService({ database: db, origin: "https://www.example.com" });
const candidates = { posts: [], upcomingEvents: [] };
function insertArtist(key, name = key) {
  db.prepare(`INSERT INTO artists(norm,name,public_slug,bio,country,mbid,data,created_at,updated_at,rank_score)
    VALUES(?,?,?,NULL,NULL,?,'{}',?,?,1000000000000)`).run(key, name, key, MBID, AT - 86400000, AT - 86400000);
}
function entry(key) {
  return artistSitemapEntries(db, { now: AT, candidates }).find(row => row.artistKey === key);
}
function clearArtist(key) {
  db.prepare("DELETE FROM artist_profiles WHERE artist_key=?").run(key);
  db.prepare("DELETE FROM artists WHERE norm=?").run(key);
}
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("saved enrichment immediately reaches existing public HTML services and the next sitemap without provider reads", async () => {
  const key = "catalog-seo-propagation";
  insertArtist(key, "Propagation Band");
  let providerCalls = 0;
  try {
    assert.equal(documents.artistDocument({ artistKey: key, at: AT }).artist.bio, "");
    assert.equal(entry(key), undefined);
    const refresher = createArtistKnowledgeRefresher({ database: db, now: () => AT,
      fetchKnowledge: async () => { providerCalls += 1; return knowledge; } });
    await refresher.runBatch({ limit: 1 });
    const document = documents.artistDocument({ artistKey: key, at: AT });
    assert.equal(document.artist.bio, BIO);
    assert.equal(document.artist.country, "Canada");
    assert.equal(document.canonicalUrl, `https://www.example.com/artist/${key}`);
    const html = documents.render(document);
    assert.ok(html.includes(BIO));
    assert.match(html, /Wikipedia contributors/);
    assert.match(html, /oldid=123/);
    assert.match(html, /CC BY-SA 4\.0/);
    assert.equal(document.jsonLd[0].dateModified, new Date(AT).toISOString());
    assert.equal(entry(key).lastmod, AT);
    const xml = urlsetParts([entry(key)], { PUBLIC_ORIGIN: "https://www.example.com" })[0];
    assert.match(xml, /<lastmod>2026-09-15<\/lastmod>/);
    assert.equal(providerCalls, 1, "HTML and sitemap reads use only stored facts");
    await refresher.runBatch({ limit: 1 });
    assert.equal(entry(key).lastmod, AT, "a checked or skipped pass is not a content modification");
    assert.equal(db.prepare("SELECT attempted_at FROM artist_knowledge_checks WHERE artist_key=?").get(key).attempted_at, AT);
  } finally { clearArtist(key); }
});

test("stale or invalid imported biography provenance cannot submit an empty artist page", () => {
  const key = "catalog-seo-stale-source";
  insertArtist(key);
  try {
    db.prepare("UPDATE artists SET bio=?,data=? WHERE norm=?").run(BIO, JSON.stringify({ artistKnowledge: knowledge }), key);
    assert.ok(entry(key));
    db.prepare("UPDATE artists SET mbid=? WHERE norm=?").run(OTHER_MBID, key);
    assert.equal(documents.artistDocument({ artistKey: key, at: AT }).artist.bio, "");
    assert.equal(entry(key), undefined);
    db.prepare("UPDATE artists SET mbid=?,data=? WHERE norm=?").run(MBID,
      JSON.stringify({ artistKnowledge: { ...knowledge, bioSource: { ...knowledge.bioSource, revisionUrl: "https://invalid.test/123" } } }), key);
    assert.equal(entry(key), undefined);
    db.prepare("UPDATE artists SET bio=? WHERE norm=?").run("Independent editorial biography. ".repeat(4), key);
    assert.ok(entry(key), "independent editorial text is not incorrectly suppressed by an older import record");
  } finally { clearArtist(key); }
});

test("deliberate staff clears and short profile replacements match public HTML sitemap eligibility", () => {
  const key = "catalog-seo-profile-clear";
  insertArtist(key);
  try {
    db.prepare("UPDATE artists SET bio=?,data=? WHERE norm=?").run(BIO, JSON.stringify({ artistKnowledge: knowledge }), key);
    db.prepare("INSERT INTO artist_profiles(artist_key,bio,bio_staff_curated,updated_at) VALUES(?,'',1,?)").run(key, AT);
    assert.equal(documents.artistDocument({ artistKey: key, at: AT }).artist.bio, "");
    assert.equal(entry(key), undefined);
    db.prepare("UPDATE artist_profiles SET bio='Short owner introduction',bio_staff_curated=0 WHERE artist_key=?").run(key);
    assert.equal(entry(key), undefined, "a short public replacement must not fall back to the longer hidden catalog bio");
    db.prepare("UPDATE artist_profiles SET bio='',bio_staff_curated=0 WHERE artist_key=?").run(key);
    assert.ok(entry(key), "an uncurated missing value may use the valid catalog bio");
  } finally { clearArtist(key); }
});

test("provider venue and event changes reach public documents and lastmod without falsely freshening unchanged polls", () => {
  const key = "catalog-seo-show-artist";
  insertArtist(key, "Catalog SEO Show Artist");
  const row = { id: "tm_catalog_seo_propagation", artist: "Catalog SEO Show Artist", source: "ticketmaster",
    venue: "Catalog Propagation Hall", place: "Toronto, Ontario, Canada", date: "2026-09-30",
    lat: 43.65, lng: -79.38, provider_event_id: "catalog-seo-event", venue_provider_id: "catalog-seo-hall",
    event_name: "Catalog SEO Show Artist", venue_address_line1: "100 Concert Street", venue_city: "Toronto",
    venue_region: "Ontario", venue_country_code: "CA", venue_country: "Canada",
    start_date_time: "2026-09-30T23:00:00Z", event_status: "onsale",
    music_qualified: 1, music_evidence: "provider-music-attraction", billed_artists: ["Catalog SEO Show Artist"],
    ticket_url: "https://www.ticketmaster.com/event/catalog-seo-event" };
  const eventEntry = () => eventSitemapEntries(db, { now: AT }).find(value => value.path === `/event/${row.id}`);
  const venueEntry = () => venueSitemapEntries(db, { now: AT }).find(value => value.path === "/venue/ticketmaster-catalog-seo-hall");
  try {
    upsertProviderTourDateRows(db, [row], { seenAt: AT });
    assert.equal(eventEntry().lastmod, AT);
    assert.equal(venueEntry().lastmod, AT);
    upsertProviderTourDateRows(db, [row], { seenAt: AT + 86400000 });
    assert.equal(eventEntry().lastmod, AT);
    assert.equal(venueEntry().lastmod, AT);
    upsertProviderTourDateRows(db, [{ ...row, venue_address_line1: "200 Concert Street" }], { seenAt: AT + 172800000 });
    assert.equal(eventEntry().lastmod, AT + 172800000);
    assert.equal(venueEntry().lastmod, AT + 172800000);
    const event = documents.eventDocument({ id: row.id, at: AT });
    assert.match(documents.render(event), /200 Concert Street/);
    assert.equal(event.jsonLd.find(node => node["@type"] === "MusicEvent").location.address.streetAddress, "200 Concert Street");
    const venue = documents.venueDocument({ name: row.venue, source: row.source, providerVenueId: row.venue_provider_id, at: AT });
    assert.match(documents.render(venue), /200 Concert Street/);
  } finally { db.prepare("DELETE FROM tour_dates WHERE id=?").run(row.id); clearArtist(key); }
});
