import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-profile-customization-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
function addUser() {
  sequence += 1;
  const id = `profile_custom_${sequence}`;
  q.insertUser.run(id, `${id}@example.test`, `Profile Custom ${sequence}`, id, "test-hash", "fan", "Toronto", 43.65, -79.38, "PC", "#123456", Date.now());
  db.prepare("UPDATE users SET age_band='18_plus',email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function addPost(user, { id, kind = "review", removed = 0, artist = "Fixture Artist" }) {
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,review,photos,kind,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, user.id, artist, "Fixture Hall", "Toronto", "2026-05-01", 4.5, "Loved it.",
    JSON.stringify(["https://media.example.test/show.jpg"]), kind, removed, Date.now());
}
const patch = (user, extras, ip = `profile-${Math.random()}`) => routes["PATCH /api/me"]({ user: q.userById.get(user.id), ip, body: { extras } });
const rejects = (run, message) => assert.throws(run, (error) => error instanceof ApiError && error.status === 400 && (!message || message.test(error.message)));

test("a member picks an accent, pronouns and up to four favorite shows, shown on their profile", () => {
  const member = addUser();
  const other = addUser();
  for (const id of ["fav_a", "fav_b", "fav_c", "fav_d", "fav_e"]) addPost(member, { id });
  addPost(member, { id: "fav_status", kind: "status" });
  addPost(member, { id: "fav_removed", removed: 1 });
  addPost(other, { id: "fav_theirs" });

  const saved = patch(member, { accent: "violet", pronouns: "they/them", favoriteShows: ["fav_c", "fav_a"] });
  assert.equal(saved.user.accent, "violet");
  assert.equal(saved.user.pronouns, "they/them");
  assert.deepEqual(saved.user.favoriteShows, ["fav_c", "fav_a"]);

  const profile = routes["GET /api/users/:id"]({ user: q.userById.get(other.id), params: { id: member.id }, ip: "profile-view", setHeader() {} });
  assert.equal(profile.user.accent, "violet", "visitors see the accent");
  assert.equal(profile.user.pronouns, "they/them");
  assert.deepEqual(profile.favoriteShows.map((card) => card.id), ["fav_c", "fav_a"], "in the member's chosen order");
  assert.deepEqual(Object.keys(profile.favoriteShows[0]).sort(), ["artist", "city", "date", "endDate", "id", "online", "onlineTitle", "overall", "photo", "showFormat", "venue"]);
  assert.equal(profile.favoriteShows[0].photo, "https://media.example.test/show.jpg");

  rejects(() => patch(member, { favoriteShows: ["fav_a", "fav_b", "fav_c", "fav_d", "fav_e"] }), /no larger|extras/u);
  rejects(() => patch(member, { favoriteShows: ["fav_theirs"] }), /your own show reviews/u);
  rejects(() => patch(member, { favoriteShows: ["fav_status"] }), /your own show reviews/u);
  rejects(() => patch(member, { favoriteShows: ["fav_removed"] }), /your own show reviews/u);
  rejects(() => patch(member, { accent: "chartreuse" }));
  assert.deepEqual(q.userById.get(member.id) && patch(member, {}).user.favoriteShows, ["fav_c", "fav_a"], "a rejected change leaves the pins alone");

  // A pin whose review is later removed simply drops out of the cards.
  db.prepare("UPDATE posts SET removed=1 WHERE id='fav_c'").run();
  const later = routes["GET /api/users/:id"]({ user: q.userById.get(other.id), params: { id: member.id }, ip: "profile-view-2", setHeader() {} });
  assert.deepEqual(later.favoriteShows.map((card) => card.id), ["fav_a"]);

  // null and an empty list clear, and nothing else in extras is touched.
  const cleared = patch(member, { accent: null, pronouns: "", favoriteShows: [] });
  assert.equal(cleared.user.accent, undefined);
  assert.equal(cleared.user.pronouns, undefined);
  assert.equal(cleared.user.favoriteShows, undefined);
});
