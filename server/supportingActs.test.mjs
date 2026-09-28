import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-supporting-acts-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPassword } = await import("./auth.js");
const { cleanSupportingActNames, cleanTimesSeen } = await import("./supportingActs.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

let serial = 0;
function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("openers-password"), "fan", "Toronto", 43.65, -79.38, "OP", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function review(user, fields) {
  serial += 1;
  return routes["POST /api/posts"]({ user, ip: `198.51.100.${serial % 250}`, body: {
    clientMutationId: `openers_${serial}`, venue: "History", city: "Toronto", overall: 4, review: "", ...fields,
  } }).post;
}
const post = (user, id) => routes["GET /api/posts/:id"]({ user, params: { id }, ip: "198.51.100.1" }).post;

test("opener names are cleaned: no duplicates, no headliner, at most twelve", () => {
  assert.deepEqual(cleanSupportingActNames([" Phoebe  Bridgers ", "phoebe bridgers", "boygenius", "", "Muna"], { mainArtist: "Boygenius" }), ["Phoebe Bridgers", "Muna"]);
  assert.equal(cleanSupportingActNames("Muna"), null);
  assert.equal(cleanSupportingActNames([1]), null);
  assert.deepEqual(cleanSupportingActNames(undefined), []);
  assert.equal(cleanSupportingActNames(Array.from({ length: 20 }, (_, index) => `Act ${index}`)).length, 12);
  assert.deepEqual([cleanTimesSeen(undefined), cleanTimesSeen(null), cleanTimesSeen(3), cleanTimesSeen(0), cleanTimesSeen(2.5), cleanTimesSeen(1000)],
    [undefined, null, 3, false, false, false]);
});

test("a review lists its openers, and an opener reviewed the same night is linked", () => {
  const fan = addUser("u_openers_fan");
  const main = review(fan, { artist: "boygenius", date: "2024-03-01", supportingActs: ["Muna", "Phoebe Bridgers", "boygenius"] });
  assert.deepEqual(main.supportingActs.map((act) => act.name), ["Muna", "Phoebe Bridgers"], "the headliner is not its own opener");
  const phoebe = review(fan, { artist: "Phoebe Bridgers", date: "2024-03-01" });
  const [muna, linked] = post(fan, main.id).supportingActs;
  assert.equal(muna.reviewPostId, null);
  assert.equal(linked.reviewPostId, phoebe.id, "the same night's review of the opener is linked");
  assert.equal(post(fan, phoebe.id).seen, 1, "seeing Phoebe open that night is the same show, counted once");

  const later = review(fan, { artist: "Phoebe Bridgers", date: "2024-06-01" });
  assert.equal(post(fan, later.id).seen, 2);
  const munaHeadline = review(fan, { artist: "Muna", date: "2025-01-10" });
  assert.equal(post(fan, munaHeadline.id).seen, 2, "opening for boygenius counts as a time seeing Muna");

  assert.throws(() => review(fan, { artist: "Lorde", date: "2024-02-01", supportingActs: "Muna" }), (error) => error.status === 400);
  assert.throws(() => review(fan, { artist: "Lorde", date: "2024-02-01", timesSeen: 0 }), (error) => error.status === 400);
});

test("times seen follows show dates, and a stated number carries forward", async () => {
  const fan = addUser("u_times_seen_fan");
  const recent = review(fan, { artist: "Radiohead", date: "2024-05-01" });
  const older = review(fan, { artist: "Radiohead", date: "2017-07-10" });
  assert.equal(post(fan, older.id).seen, 1, "an older show logged later is the first time");
  assert.equal(post(fan, recent.id).seen, 2);

  const counts = routes["GET /api/me/seen-count"]({ user: fan, query: { artist: "Radiohead", date: "2025-09-01" }, ip: "198.51.100.2", setHeader() {} });
  assert.equal(counts.count, 3, "the form starts at the next time");
  const stated = review(fan, { artist: "Radiohead", date: "2025-09-01", timesSeen: 7 });
  assert.equal(stated.seen, 7, "four earlier shows never logged");
  const next = review(fan, { artist: "Radiohead", date: "2026-02-01" });
  assert.equal(next.seen, 8, "later reviews keep counting from it");
  assert.equal(post(fan, recent.id).seen, 6, "every review counts the earlier unlogged shows");
  assert.equal(routes["GET /api/me/seen-count"]({ user: fan, query: { postId: next.id }, ip: "198.51.100.2", setHeader() {} }).count, 8);
  const exported = await routes["POST /api/me/export"]({ user: fan, ip: "198.51.100.8", body: { password: "openers-password" }, setHeader() {} });
  const data = typeof exported === "string" ? JSON.parse(exported) : exported?.body ? JSON.parse(exported.body) : exported;
  assert.deepEqual(data.seenBeforeLogging.map((row) => [row.artist, row.count]), [["radiohead", 4]], "the export includes the unlogged earlier shows");

  // Editing the number on a review resets the unlogged count to match.
  const edited = routes["PATCH /api/posts/:id"]({ user: fan, params: { id: next.id }, ip: "198.51.100.3", body: { timesSeen: 4 } }).post;
  assert.equal(edited.seen, 4);
  assert.throws(() => routes["PATCH /api/posts/:id"]({ user: fan, params: { id: next.id }, ip: "198.51.100.3", body: { timesSeen: "lots" } }),
    (error) => error.status === 400);
});

test("openers are edited, cleared for online reviews and scrubbed when the review is deleted", async () => {
  const fan = addUser("u_openers_editor");
  const show = review(fan, { artist: "Wet Leg", date: "2025-04-04", supportingActs: ["Honeyglaze"] });
  let edited = routes["PATCH /api/posts/:id"]({ user: fan, params: { id: show.id }, ip: "198.51.100.4", body: { supportingActs: ["Honeyglaze", "Sprints"] } }).post;
  assert.deepEqual(edited.supportingActs.map((act) => act.name), ["Honeyglaze", "Sprints"]);
  assert.throws(() => routes["PATCH /api/posts/:id"]({ user: fan, params: { id: show.id }, ip: "198.51.100.4", body: { supportingActs: [7] } }),
    (error) => error.status === 400);

  const status = routes["POST /api/posts"]({ user: fan, ip: "198.51.100.5", body: { clientMutationId: "openers_status_1", kind: "status", review: "Hello" } }).post;
  assert.throws(() => routes["PATCH /api/posts/:id"]({ user: fan, params: { id: status.id }, ip: "198.51.100.5", body: { supportingActs: ["Muna"] } }),
    (error) => error.status === 400, "openers belong to concert reviews");

  edited = routes["PATCH /api/posts/:id"]({ user: fan, params: { id: show.id }, ip: "198.51.100.4", body: {
    experienceType: "online", youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", venue: "", city: "", date: "" } }).post;
  assert.deepEqual(edited.supportingActs, [], "an online review has no openers");

  const retried = review(fan, { artist: "Fontaines D.C.", date: "2025-05-05", supportingActs: ["Kneecap"] });
  const again = routes["POST /api/posts"]({ user: fan, ip: "198.51.100.6", body: {
    clientMutationId: `openers_${serial}`, venue: "History", city: "Toronto", overall: 4, review: "", artist: "Fontaines D.C.", date: "2025-05-05", supportingActs: ["Kneecap"] } });
  assert.equal(again.post.id, retried.id, "a retry of the same review is the same post");

  await routes["DELETE /api/posts/:id"]({ user: fan, params: { id: retried.id }, ip: "198.51.100.7" });
  assert.equal(db.prepare("SELECT supporting_acts FROM posts WHERE id=?").get(retried.id).supporting_acts, "[]");
});
