import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-lineup-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPassword } = await import("./auth.js");
const { adaptLineupToFormat, canonicalLineupFields, cleanEndDate, cleanLineup, cleanShowFormat, ensureLineupSchema, mergeLegacyLineup } = await import("./supportingActs.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

let serial = 0;
function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("lineup-password"), "fan", "Toronto", 43.65, -79.38, "LU", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const create = (user, fields, mutationId = `lineup_${++serial}`) => routes["POST /api/posts"]({ user, ip: `203.0.113.${serial % 250}`, body: {
  clientMutationId: mutationId, venue: "Budweiser Stage", city: "Toronto", overall: 4, review: "", ...fields,
} });
const read = (user, id) => routes["GET /api/posts/:id"]({ user, params: { id }, ip: "203.0.113.1" }).post;
const edit = (user, id, body) => routes["PATCH /api/posts/:id"]({ user, params: { id }, ip: "203.0.113.2", body });
const indexRows = (postId) => db.prepare("SELECT position,artist_ref,name,role,rating FROM post_lineup_acts WHERE post_id=? ORDER BY position").all(postId)
  .map((row) => ({ ...row }));

test("lineups are checked against the show format", () => {
  assert.deepEqual([cleanShowFormat(undefined), cleanShowFormat("festival"), cleanShowFormat("rave")], ["headline", "festival", false]);
  const headline = cleanLineup([{ name: " Omar  Apollo ", rating: 4.3, review: "  Stole\r\n\r\n\r\nthe show " }, { name: "omar apollo" }, { name: "SZA" }],
    { mainArtist: "SZA" });
  assert.deepEqual(headline.acts, [{ name: "Omar Apollo", role: "opener", rating: 4.5, review: "Stole\n\nthe show", day: null, stage: null }],
    "duplicates and the headliner drop out; ratings snap to half stars");
  assert.match(cleanLineup([{ name: "Usher", role: "co_headliner" }], { mainArtist: "Chris Brown" }).error, /co-headliner or an opener/u);
  assert.match(cleanLineup([{ name: "Muna", rating: 7 }]).error, /half a star to 5 stars/u);
  assert.match(cleanLineup([{ name: "Muna", review: "x".repeat(601) }]).error, /under 600/u);
  assert.match(cleanLineup([{ name: "Muna" }], { showFormat: "co_headline", mainArtist: "Chris Brown" }).error, /other headliner/u);
  assert.deepEqual(cleanLineup([{ name: "Usher", role: "co_headliner", rating: 5 }, { name: "Summer Walker" }],
    { showFormat: "co_headline", mainArtist: "Chris Brown" }).acts.map((act) => act.role), ["co_headliner", "opener"]);
  assert.match(cleanLineup(Array.from({ length: 13 }, (_, index) => ({ name: `Opener ${index}` }))).error, /up to 12 openers/u);
  assert.match(cleanLineup("Muna").error, /list of acts/u);
  assert.match(cleanLineup(undefined, { legacyNames: "Muna" }).error, /list of artist names/u);

  const days = { showFormat: "festival", mainArtist: "Rolling Loud Miami", date: "2026-07-24", endDate: "2026-07-26" };
  assert.deepEqual(cleanLineup([{ name: "Travis Scott", day: "2026-07-26", stage: " Main   Stage ", rating: 5 }], days).acts,
    [{ name: "Travis Scott", role: "festival_set", rating: 5, review: "", day: "2026-07-26", stage: "Main Stage" }]);
  assert.match(cleanLineup([{ name: "Travis Scott", day: "2026-07-27" }], days).error, /between the first and last day/u);
  assert.deepEqual(cleanLineup([{ name: "Muna", day: "2026-07-24", stage: "Tent" }], { mainArtist: "boygenius" }).acts[0],
    { name: "Muna", role: "opener", rating: null, review: "", day: null, stage: null }, "days and stages are festival-only");

  assert.equal(cleanEndDate("2026-07-26", { showFormat: "festival", date: "2026-07-24" }), "2026-07-26");
  assert.equal(cleanEndDate("2026-07-24", { showFormat: "festival", date: "2026-07-24" }), "", "a one-day festival stores no last day");
  assert.equal(cleanEndDate("2026-07-23", { showFormat: "festival", date: "2026-07-24" }), false);
  assert.equal(cleanEndDate("2026-08-10", { showFormat: "festival", date: "2026-07-24" }), false);
  assert.equal(cleanEndDate("2026-07-26", { showFormat: "festival", date: "" }), false);
  assert.equal(cleanEndDate("2026-07-26", { showFormat: "headline", date: "2026-07-24" }), "");
});

test("unrated opener lists keep the older retry fingerprint", () => {
  const openers = [{ name: "Muna", role: "opener", rating: null, review: "", day: null, stage: null }];
  assert.deepEqual(canonicalLineupFields({ acts: openers }), { supportingActs: ["Muna"] });
  assert.deepEqual(canonicalLineupFields({ acts: [] }), {});
  assert.deepEqual(canonicalLineupFields({ acts: [{ ...openers[0], rating: 4 }] }),
    { lineup: [{ name: "Muna", role: "opener", rating: 4, review: "", day: null, stage: null }] });
  assert.deepEqual(canonicalLineupFields({ showFormat: "festival", endDate: "2026-07-26", acts: [] }), { lineup: [], showFormat: "festival", endDate: "2026-07-26" });
});

test("a co-headline show saves each set's rating, indexes it, and replays safely", () => {
  const fan = addUser("u_lineup_coheadline");
  const body = {
    artist: "Chris Brown", date: "2025-03-14", showFormat: "co_headline",
    lineup: [
      { name: "Fixture Coheadliner", role: "co_headliner", rating: 5, review: "Ran through the whole catalog." },
      { name: "Fixture Opener", role: "opener", rating: 3.5 },
    ],
  };
  const first = create(fan, body, "lineup_replay");
  assert.equal(first.post.showFormat, "co_headline");
  assert.deepEqual(first.post.lineup.map(({ name, role, rating, review }) => ({ name, role, rating, review })), [
    { name: "Fixture Coheadliner", role: "co_headliner", rating: 5, review: "Ran through the whole catalog." },
    { name: "Fixture Opener", role: "opener", rating: 3.5, review: "" },
  ]);
  assert.deepEqual(first.post.supportingActs.map((act) => act.name), ["Fixture Coheadliner", "Fixture Opener"], "older app versions still see the names");
  assert.deepEqual(indexRows(first.id), [
    { position: 0, artist_ref: "name:fixture coheadliner", name: "Fixture Coheadliner", role: "co_headliner", rating: 5 },
    { position: 1, artist_ref: "name:fixture opener", name: "Fixture Opener", role: "opener", rating: 3.5 },
  ]);
  const replay = create(fan, body, "lineup_replay");
  assert.equal(replay.id, first.id, "retrying the same request returns the saved review instead of a conflict");
  assert.throws(() => create(fan, { ...body, lineup: [{ ...body.lineup[0], rating: 4 }] }, "lineup_replay"), (error) => error.status === 409,
    "a changed rating under the same retry token is a different request");
});

test("a festival review is not bound to an artist and keeps each set's day", () => {
  const fan = addUser("u_lineup_festival");
  db.prepare("INSERT OR IGNORE INTO artists (norm,name) VALUES (?,?)").run("lollapalooza", "Lollapalooza");
  db.prepare("INSERT OR IGNORE INTO artists (norm,name) VALUES (?,?)").run("chappell roan", "Chappell Roan");
  const festival = create(fan, {
    artist: "Lollapalooza", artistKey: "lollapalooza", date: "2025-08-01", endDate: "2025-08-03", showFormat: "festival", venue: "Grant Park", city: "Chicago",
    lineup: [{ name: "Chappell Roan", day: "2025-08-02", stage: "T-Mobile", rating: 5 }, { name: "Unsigned Fixture Act", day: "2025-08-03" }],
  });
  assert.equal(festival.post.artistKey ?? null, null, "a festival name never binds to a same-named catalog artist");
  assert.equal(festival.post.endDate, "2025-08-03");
  assert.deepEqual(festival.post.lineup.map(({ name, role, day, stage, artistKey }) => ({ name, role, day, stage, artistKey })), [
    { name: "Chappell Roan", role: "festival_set", day: "2025-08-02", stage: "T-Mobile", artistKey: "chappell roan" },
    { name: "Unsigned Fixture Act", role: "festival_set", day: "2025-08-03", stage: null, artistKey: null },
  ]);
  assert.equal(indexRows(festival.id)[0].artist_ref, "chappell roan", "a catalog act is indexed by its key");
  assert.throws(() => create(fan, { artist: "Lollapalooza", date: "2025-08-01", endDate: "2025-07-30", showFormat: "festival" }), (error) => error.status === 400);
  assert.throws(() => create(fan, { artist: "Lollapalooza", date: "2025-08-01", showFormat: "rave" }), (error) => error.status === 400);
});

test("edits keep saved ratings for older apps, adapt to a new format, and deletion clears the index", async () => {
  const fan = addUser("u_lineup_edit");
  const created = create(fan, { artist: "SZA", date: "2025-02-01", lineup: [{ name: "Omar Apollo", rating: 4, review: "Smooth" }, { name: "Kaytranada" }] });
  const legacy = edit(fan, created.id, { supportingActs: ["Omar Apollo", "Kaytranada", "Lizzo"] });
  assert.deepEqual(legacy.post.lineup.map(({ name, rating, review }) => ({ name, rating, review })), [
    { name: "Omar Apollo", rating: 4, review: "Smooth" },
    { name: "Kaytranada", rating: null, review: "" },
    { name: "Lizzo", rating: null, review: "" },
  ], "a names-only edit from an older app keeps the ratings already saved");

  const asFestival = edit(fan, created.id, { showFormat: "festival", artist: "Wireless", endDate: "2025-02-03" });
  assert.equal(asFestival.post.showFormat, "festival");
  assert.deepEqual(asFestival.post.lineup.map((act) => act.role), ["festival_set", "festival_set", "festival_set"]);
  assert.equal(asFestival.post.artistKey ?? null, null);

  const coHeadline = edit(fan, created.id, { showFormat: "co_headline", artist: "SZA" });
  assert.deepEqual(coHeadline.post.lineup.map((act) => [act.name, act.role, act.day]), [
    ["Omar Apollo", "co_headliner", null], ["Kaytranada", "opener", null], ["Lizzo", "opener", null],
  ]);
  assert.equal(coHeadline.post.endDate, "", "only a festival keeps a last day");

  assert.throws(() => edit(fan, created.id, { lineup: [{ name: "Muna", rating: 9 }] }), (error) => error.status === 400);
  await routes["DELETE /api/posts/:id"]({ user: fan, params: { id: created.id }, ip: "203.0.113.3" });
  assert.deepEqual(indexRows(created.id), [], "a deleted review leaves nothing on artist pages");
  const scrubbed = db.prepare("SELECT show_format,end_date,supporting_acts FROM posts WHERE id=?").get(created.id);
  assert.deepEqual({ ...scrubbed }, { show_format: "headline", end_date: "", supporting_acts: "[]" });
});

test("switching formats and merging legacy lists are pure", () => {
  const acts = [{ name: "A", role: "festival_set", rating: 4, review: "", day: "2025-08-01", stage: "Tent" }, { name: "B", role: "festival_set", rating: null, review: "", day: null, stage: null }];
  assert.deepEqual(adaptLineupToFormat(acts, "headline").map((act) => [act.role, act.day, act.stage]), [["opener", null, null], ["opener", null, null]]);
  assert.deepEqual(adaptLineupToFormat(acts, "festival"), acts);
  assert.deepEqual(mergeLegacyLineup([{ name: "a", role: "festival_set", rating: null, review: "", day: null, stage: null }], acts)[0].rating, 4);
});

test("the first start indexes lineups saved before the index existed", () => {
  const fan = addUser("u_lineup_backfill");
  const created = create(fan, { artist: "Phoebe Bridgers", date: "2024-10-01", supportingActs: ["Muna"] });
  db.exec("DELETE FROM post_lineup_acts");
  db.prepare("DELETE FROM app_meta WHERE key='schema:post-lineup-acts:v1'").run();
  db.prepare(`UPDATE posts SET supporting_acts='[{"name":"Muna","artistKey":null}]' WHERE id=?`).run(created.id);
  db.exec("DELETE FROM post_lineup_acts");
  ensureLineupSchema(db);
  assert.deepEqual(indexRows(created.id), [{ position: 0, artist_ref: "name:muna", name: "Muna", role: "opener", rating: null }]);
});

test("artist pages list sets from other bills, and the composer suggests the run's openers", () => {
  const fan = addUser("u_lineup_sets_fan");
  const other = addUser("u_lineup_sets_other");
  const viewer = addUser("u_lineup_sets_viewer");
  create(fan, { artist: "Fixture Headliner", date: "2025-05-01", lineup: [{ name: "Fixture Support", rating: 4.5, review: "Tight set" }] });
  create(other, { artist: "Fixture Headliner", date: "2025-05-20", lineup: [{ name: "Fixture Support", rating: 3.5 }, { name: "Fixture Local" }] });
  create(fan, { artist: "Fixture Fest", date: "2025-07-01", endDate: "2025-07-02", showFormat: "festival", venue: "Fixture Park",
    lineup: [{ name: "Fixture Support", day: "2025-07-02", stage: "Tent", rating: 5 }] });
  const sets = routes["GET /api/artists/sets"]({ query: { name: "Fixture Support" }, ip: "203.0.113.9" });
  assert.deepEqual(sets.summary.opener, { sets: 2, rated: 2, average: 4 });
  assert.deepEqual(sets.summary.festival_set, { sets: 1, rated: 1, average: 5 });
  assert.deepEqual(sets.openedFor.map((row) => [row.name, row.shows]), [["Fixture Headliner", 2]]);
  assert.deepEqual(sets.festivals.map((row) => row.name), ["Fixture Fest"]);
  assert.deepEqual(sets.sets.map((set) => [set.role, set.date, set.day, set.stage]), [
    ["festival_set", "2025-07-01", "2025-07-02", "Tent"], ["opener", "2025-05-20", null, null], ["opener", "2025-05-01", null, null],
  ], "newest show first, each with its festival day");
  assert.equal(sets.sets[2].review, "Tight set");
  assert.equal(sets.sets[2].user.id, fan.id);
  assert.equal(sets.sets[2].headliner.name, "Fixture Headliner");

  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(viewer.id, fan.id, Date.now());
  const blocked = routes["GET /api/artists/sets"]({ user: viewer, query: { name: "Fixture Support" }, ip: "203.0.113.9" });
  assert.deepEqual(blocked.sets.map((set) => set.user.id), [other.id], "a blocked author's sets are hidden from the viewer");
  assert.throws(() => routes["GET /api/artists/sets"]({ query: {}, ip: "203.0.113.9" }), (error) => error.status === 400);

  db.prepare(`INSERT INTO tour_dates (id,artist,venue,date,updated_at,billed_artists,event_kind,event_name)
    VALUES (?,?,?,?,?,?,?,?)`).run("td_lineup_billed", "Fixture Headliner", "Fixture Hall", "2025-06-01", Date.now(),
    JSON.stringify(["Fixture Headliner", "Fixture Billed"]), "concert", "Fixture Headliner");
  const suggested = routes["GET /api/lineup/suggestions"]({ user: fan, query: { artist: "Fixture Headliner", date: "2025-06-01", venue: "Fixture Hall" }, ip: "203.0.113.9" });
  assert.deepEqual(suggested.suggestions.map((row) => [row.name, row.source, row.fans ?? null]), [
    ["Fixture Billed", "billed", null], ["Fixture Support", "fans", 2], ["Fixture Local", "fans", 1],
  ], "the billing for that night first, then the openers fans listed on the same run");

  db.prepare(`INSERT INTO tour_dates (id,artist,venue,date,updated_at,billed_artists,event_kind,event_name)
    VALUES (?,?,?,?,?,?,?,?)`).run("td_lineup_fest", "Fixture Festival Act", "Fixture Park", "2025-07-02", Date.now(),
    JSON.stringify(["Fixture Festival Act", "Fixture Other Act"]), "festival", "Fixture Fest 2025");
  const festival = routes["GET /api/lineup/suggestions"]({ user: fan, query: { artist: "Fixture Fest", date: "2025-07-01", showFormat: "festival" }, ip: "203.0.113.9" });
  assert.deepEqual(festival.suggestions.map((row) => [row.name, row.day]), [["Fixture Festival Act", "2025-07-02"], ["Fixture Other Act", "2025-07-02"]]);
  assert.throws(() => routes["GET /api/lineup/suggestions"]({ user: fan, query: { artist: "X", showFormat: "rave" }, ip: "203.0.113.9" }), (error) => error.status === 400);
});
