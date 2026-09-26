import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  checkArtistReleases,
  ensureArtistUpdatesSchema,
  listArtistUpdates,
  notifyFollowers,
  projectArtistUpdate,
  scanNewTourDates,
  tourDateIdsIn,
} from "./artistUpdatesService.js";
import { releaseAvailability, releaseHeadline, showsHeadline, tourYearsLabel } from "../../../src/domain/artistNews.mjs";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const DAY = 86_400_000;
const SIMPLE_VISIBILITY = "td.date>=@today AND td.release_at<=@at";

function world(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,favorite_artists TEXT NOT NULL DEFAULT '[]',is_banned INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,public_slug TEXT,photo TEXT,popularity INTEGER,data TEXT);
    CREATE TABLE fan_club_members(artist TEXT,user_id TEXT,PRIMARY KEY(artist,user_id));
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,venue TEXT,place TEXT,venue_city TEXT,date TEXT,
      event_name TEXT,owner_id TEXT,music_qualified INTEGER DEFAULT 1,event_kind TEXT DEFAULT 'concert',music_evidence TEXT,
      billed_artists TEXT DEFAULT '[]',event_end_date TEXT,release_at INTEGER DEFAULT 0);`);
  ensureArtistUpdatesSchema(db);
  db.prepare("INSERT INTO users(id) VALUES ('u_ana'),('u_ben'),('u_cat'),('u_dan')").run();
  db.prepare("INSERT INTO artists VALUES ('tame impala','Tame Impala','tame-impala',NULL,90,?),('wet leg','Wet Leg','wet-leg',NULL,60,?)")
    .run(JSON.stringify({ deezerId: 123 }), JSON.stringify({}));
  let next = 0;
  const addDate = (id, artistKey, date, extra = {}) => db.prepare(`INSERT INTO tour_dates(id,artist,artist_key,venue,venue_city,date,event_name,release_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, extra.artist || artistKey, artistKey, extra.venue || "History", extra.city || "Toronto", date, extra.eventName || null, extra.releaseAt || 0);
  return { db, addDate, newId: (prefix) => `${prefix}_${next += 1}` };
}

test("the first pass is a quiet baseline; later dates become one item per artist per day", (t) => {
  const { db, addDate, newId } = world(t);
  addDate("tm_1", "tame impala", "2026-11-01");
  addDate("tm_2", "wet leg", "2026-11-02");
  assert.deepEqual(scanNewTourDates(db, { now: NOW, newId, visibilitySql: SIMPLE_VISIBILITY }), { baseline: 2, created: [] });

  addDate("tm_3", "tame impala", "2026-12-01", { city: "Montreal" });
  addDate("tm_4", "tame impala", "2026-12-03", { eventName: "Tame Impala VIP Package" });
  addDate("tm_old", "tame impala", "2026-01-01");
  const first = scanNewTourDates(db, { now: NOW + 1000, newId, visibilitySql: SIMPLE_VISIBILITY });
  assert.equal(first.created.length, 1);
  assert.equal(first.created[0].title, "New tour date added", "a VIP add-on and a past date are not news");

  addDate("tm_5", "tame impala", "2026-12-05");
  const second = scanNewTourDates(db, { now: NOW + 2000, newId, visibilitySql: SIMPLE_VISIBILITY });
  assert.equal(second.created.length, 0, "the same day's news item grows instead of repeating");
  const row = db.prepare("SELECT * FROM artist_updates").get();
  assert.equal(row.title, "2 new tour dates added");
  assert.deepEqual(JSON.parse(row.payload).dates.map((item) => item.id), ["tm_3", "tm_5"]);
});

test("a whole existing tour for an artist seen for the first time is not announced as news", (t) => {
  const { db, addDate, newId } = world(t);
  scanNewTourDates(db, { now: NOW, newId, visibilitySql: SIMPLE_VISIBILITY });
  for (let index = 0; index < 11; index += 1) addDate(`tm_n${index}`, "wet leg", `2026-11-${String(index + 10).padStart(2, "0")}`);
  assert.equal(scanNewTourDates(db, { now: NOW + 1000, newId, visibilitySql: SIMPLE_VISIBILITY }).created.length, 0);
});

test("releases come only from a matching, established Deezer artist, with a quiet first look", async (t) => {
  const { db, addDate, newId } = world(t);
  addDate("tm_1", "tame impala", "2026-11-01");
  const albums = [
    { id: 1, title: "Currents", record_type: "album", release_date: "2015-07-17", link: "https://www.deezer.com/album/1" },
    { id: 2, title: "Dracula", record_type: "single", release_date: "2026-09-18", link: "https://www.deezer.com/album/2", cover_big: "https://e-cdns-images.dzcdn.net/2.jpg" },
    { id: 3, title: "Live Hits", record_type: "compile", release_date: "2026-09-20" },
  ];
  let name = "Tame Impala";
  const fetchJson = async (url) => (url.endsWith("/albums?limit=100") ? { data: albums } : { name, nb_fan: 5_000_000 });
  const first = await checkArtistReleases(db, { now: NOW, fetchJson, newId });
  assert.deepEqual(first.created.map((row) => row.title), ["New single: Dracula"], "only a recent release counts on the first look");

  albums.push({ id: 4, title: "Deadbeat Remixes", record_type: "ep", release_date: "2026-09-24" });
  assert.equal((await checkArtistReleases(db, { now: NOW + DAY / 2, fetchJson, newId })).checked, 0, "checked at most once a day");
  const second = await checkArtistReleases(db, { now: NOW + DAY, fetchJson, newId });
  assert.deepEqual(second.created.map((row) => row.title), ["New EP: Deadbeat Remixes"]);

  name = "Tame Impala Tribute";
  albums.push({ id: 5, title: "Covers", record_type: "album", release_date: "2026-09-25" });
  const third = await checkArtistReleases(db, { now: NOW + 2 * DAY, fetchJson, newId });
  assert.equal(third.created.length, 0, "a stored id that now points at a different act publishes nothing");
});

test("followers (favourites or fan club) hear about news at most once per artist in 12 hours", (t) => {
  const { db, addDate, newId } = world(t);
  db.prepare("INSERT INTO fan_club_members VALUES ('tame impala','u_ana'),('wet leg','u_ben')").run();
  db.prepare("UPDATE users SET favorite_artists=? WHERE id='u_cat'").run(JSON.stringify(["Tame Impala", "Wet Leg"]));
  db.prepare("UPDATE users SET favorite_artists=?,is_banned=1 WHERE id='u_dan'").run(JSON.stringify(["Tame Impala"]));
  scanNewTourDates(db, { now: NOW, newId, visibilitySql: SIMPLE_VISIBILITY });
  addDate("tm_9", "tame impala", "2026-11-09");
  const [update] = scanNewTourDates(db, { now: NOW + 1, newId, visibilitySql: SIMPLE_VISIBILITY }).created;
  const sent = [];
  assert.equal(notifyFollowers(db, update, { notify: (userId) => sent.push(userId), now: NOW }), 2);
  assert.deepEqual(sent.sort(), ["u_ana", "u_cat"], "a banned account is not notified");
  assert.equal(notifyFollowers(db, update, { notify: (userId) => sent.push(userId), now: NOW + 60_000 }), 0);
  assert.equal(listArtistUpdates(db, { followerId: "u_ben" }).rows.length, 0, "the following view shows followed artists only");
  assert.equal(listArtistUpdates(db, { followerId: "u_ana" }).rows.length, 1);
  assert.equal(listArtistUpdates(db, { followerId: "u_cat" }).rows.length, 1, "favourites count as following");
});

test("a tour date that is no longer public drops out of its news item", (t) => {
  const { db, addDate, newId } = world(t);
  scanNewTourDates(db, { now: NOW, newId, visibilitySql: SIMPLE_VISIBILITY });
  addDate("tm_a", "tame impala", "2026-11-01");
  addDate("tm_b", "tame impala", "2026-11-02");
  scanNewTourDates(db, { now: NOW + 1, newId, visibilitySql: SIMPLE_VISIBILITY });
  const { rows } = listArtistUpdates(db, {});
  assert.deepEqual(tourDateIdsIn(rows), ["tm_a", "tm_b"]);
  const one = projectArtistUpdate(rows[0], { visibleDates: new Map([["tm_b", {}]]), day: "2026-09-25", eventPathFor: (id) => `/event/${id}` });
  assert.equal(one.title, "New tour date added");
  assert.equal(one.shows.dates[0].path, "/event/tm_b");
  assert.equal(projectArtistUpdate(rows[0], { visibleDates: new Map(), day: "2026-09-25" }), null);
});

test("news words read naturally", () => {
  assert.equal(releaseHeadline({ type: "album", title: "Currents" }), "New album: Currents");
  assert.equal(releaseHeadline({ type: "ep", title: "Deadbeat" }), "New EP: Deadbeat");
  assert.equal(showsHeadline(1), "New tour date added");
  assert.equal(showsHeadline(4), "4 new tour dates added");
  assert.equal(releaseAvailability("2026-09-20", "2026-09-25"), "Out now");
  assert.equal(releaseAvailability("2026-10-03", "2026-09-25"), "Out Oct 3");
  assert.equal(tourYearsLabel(["2026-11-01", "2027-02-01", "2026-12-01"]), "2026 & 2027");
  assert.equal(tourYearsLabel(["2026-11-01"]), "2026");
  assert.equal(tourYearsLabel([]), "");
});

test("the public news page lists confirmed stories with their sources, escapes everything, and waits for enough stories", async () => {
  const { projectNewsDocument, renderNewsMain } = await import("./newsDocuments.js");
  const story = (id, headline, extra = {}) => ({
    id, postId: `news_${id}`, headline, summary: "Two outlets report it.", category: "tour", publishedAt: NOW,
    artists: [{ key: "wet leg", name: "Wet <Leg>", publicSlug: "wet-leg" }],
    sources: [{ name: "NME", url: "https://www.nme.com/news/wet-leg" }, { name: "Stereogum", url: "https://www.stereogum.com/wet-leg" }],
    ...extra,
  });
  const stories = [story("a", "Wet Leg announce tour"), story("b", "Second <story>", { sources: [{ name: "Bad", url: "javascript:alert(1)" }] })];
  const document = projectNewsDocument({ stories, at: NOW });
  assert.equal(document.indexable, false, "two stories is not enough for a search result yet");
  assert.equal(projectNewsDocument({ stories: [...stories, story("c", "Third")], at: NOW }).indexable, true);
  const article = document.jsonLd[0].mainEntity.itemListElement[0].item;
  assert.equal(article["@type"], "NewsArticle");
  assert.deepEqual(article.citation, ["https://www.nme.com/news/wet-leg", "https://www.stereogum.com/wet-leg"]);
  const html = renderNewsMain(document);
  assert.match(html, /Wet &lt;Leg&gt;/u);
  assert.match(html, /Second &lt;story&gt;/u);
  assert.match(html, /Confirmed by <a href="https:\/\/www\.nme\.com\/news\/wet-leg" rel="nofollow noopener noreferrer">NME<\/a>/u);
  assert.doesNotMatch(html, /javascript:/u, "unsafe source links are dropped");
});

test("an artist page still lists that artist's new releases and tour dates", async () => {
  const { renderArtistNewsSection } = await import("./newsDocuments.js");
  const items = [
    { id: "au_1", kind: "release", artist: { name: "Tame <Impala>", path: "/artist/tame-impala" }, title: "New single: Dracula",
      release: { title: "Dracula", type: "single", releaseDate: "2026-09-18", cover: "https://e-cdns-images.dzcdn.net/2.jpg", url: "https://www.deezer.com/album/2" } },
    { id: "au_2", kind: "shows", artist: { name: "Wet Leg", path: "/artist/wet-leg" }, title: "2 new tour dates added",
      shows: { count: 2, dates: [{ id: "tm_1", date: "2026-11-01", venue: "History", city: "Toronto", path: "/event/tm_1" }, { id: "tm_2", date: "2026-11-02", venue: "MTELUS", city: "Montreal", path: "//evil.example" }] } },
  ];
  const html = renderArtistNewsSection({ news: items, artist: { name: "Wet Leg" } });
  assert.match(html, /Tame &lt;Impala&gt;/u);
  assert.match(html, /Listen on Deezer/u);
  assert.match(html, /href="\/event\/tm_1"/u);
  assert.doesNotMatch(html, /evil\.example/u, "unsafe paths render as plain text");
  assert.equal(renderArtistNewsSection({ news: [] }), "");
  assert.match(renderArtistNewsSection({ news: items, artist: { name: "Wet Leg" } }), /What's new with Wet Leg/u);
});
