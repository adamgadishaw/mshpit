import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-profile-audience-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");
const { profileSitemapEntries } = await import("./features/seo/sitemapService.js");
const { resolveEntity } = await import("./seo.js");
const { profilePath } = await import("../src/domain/urls.mjs");

after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
function user(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, "hash", "fan", "Toronto", 43.6, -79.3, id.slice(0, 2), "#123456", Date.now());
  return q.userById.get(id);
}
const owner = user("audience_owner");
const member = user("audience_member");
db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,kind,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
  .run("p_audience_public", owner.id, "Artist", "Venue", 5, "A public post that remains independently readable while the profile itself is private.", "[]", "review", Date.now());

const missing = (fn) => assert.throws(fn, (error) => error instanceof ApiError && error.status === 404);
const profile = (viewer) => routes["GET /api/users/:id"]({ user: viewer, params: { id: owner.id } });
const history = (viewer) => routes["GET /api/users/:id/posts"]({ user: viewer, params: { id: owner.id }, query: {} });

test("everyone, members, and only-me audiences distinguish guest/member/self", () => {
  assert.equal(profile(null).user.id, owner.id);
  db.prepare("UPDATE users SET profile_audience='members' WHERE id=?").run(owner.id);
  missing(() => profile(null));
  assert.equal(profile(member).user.id, owner.id);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  missing(() => profile(member));
  missing(() => history(member));
  missing(() => routes["GET /api/users/:id/followers"]({ user: member, params: { id: owner.id } }));
  missing(() => routes["GET /api/users/:id/following"]({ user: member, params: { id: owner.id } }));
  missing(() => routes["GET /api/users/:id/badges"]({ user: member, params: { id: owner.id } }));
  missing(() => routes["GET /api/users/:id/rewards"]({ user: member, params: { id: owner.id } }));
  missing(() => routes["GET /api/users/:id/playlists"]({ user: member, params: { id: owner.id } }));
  assert.equal(profile(q.userById.get(owner.id)).user.id, owner.id);
  assert.equal(history(q.userById.get(owner.id)).posts.length, 1);
});

test("a public post remains readable without exposing private profile history", () => {
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  assert.equal(routes["GET /api/posts/:id"]({ user: member, params: { id: "p_audience_public" } }).post.id, "p_audience_public");
  missing(() => history(member));
});

test("non-everyone profiles stay out of public SEO resolution and profile sitemaps", () => {
  db.prepare("UPDATE users SET profile_audience='members',bio=? WHERE id=?").run("A substantive biography long enough to otherwise qualify for the public member profile sitemap.", owner.id);
  assert.equal(profileSitemapEntries(db).some((entry) => entry.path.includes(owner.handle)), false);
  assert.equal(resolveEntity(profilePath(owner.handle)), null);
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(owner.id);
  assert.ok(resolveEntity(profilePath(owner.handle)));
});

test("blocking remains stricter than an everyone audience", () => {
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(owner.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(owner.id, member.id, Date.now());
  missing(() => profile(member));
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(owner.id, member.id);
});

test("only-me accounts do not appear in people search", () => {
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  const found = routes["GET /api/people"]({ user: member, ip: "audience-search", query: { q: owner.handle } });
  assert.equal(found.users.some((entry) => entry.id === owner.id), false);
});
