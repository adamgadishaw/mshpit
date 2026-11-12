import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-creator-posts-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("../../db.js");
const { routes } = await import("../../api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
function account(role = "fan", name = "") {
  const id = `creator_test_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "hash", role, "Toronto", 0, 0, "CT", "#123456", Date.now());
  db.prepare("UPDATE users SET artist_name=?,email_verified_at=? WHERE id=?").run(name || null, Date.now(), id);
  return q.userById.get(id);
}
function owner(type = "artist") {
  const name = `Fixture Page ${sequence + 1}`;
  const actor = account(type, type === "artist" ? name : "");
  const key = type === "event" ? `festival:fixture-event-${sequence}` : name.toLowerCase();
  if (type === "event") db.prepare("INSERT INTO festivals(slug,name,updated_at) VALUES (?,?,?)").run(key.slice(9), name, Date.now());
  if (type === "artist") db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,feed_enabled,updated_at) VALUES (?,?,1,?)").run(key, actor.id, Date.now());
  else db.prepare("INSERT INTO creator_entities(entity_type,entity_key,name,owner_id) VALUES (?,?,?,?)").run(type, key, name, actor.id);
  return { actor, update: { version: 1, entityType: type, entityKey: key, kind: "update", title: "A new chapter", date: "", location: "", url: "" } };
}
function context(actor, body = {}, params = {}) { return { user: actor, body, params, query: {}, ip: actor.id }; }
function publish(fixture, extra = {}) {
  return routes["POST /api/posts"](context(fixture.actor, { clientMutationId: `creator_${fixture.actor.id}`, kind: "status", review: "", creatorUpdate: fixture.update, ...extra }));
}
function follow(actor, update, following = true, notifyUpdates = true) {
  if (update.entityType === "artist") {
    db.prepare("UPDATE users SET favorite_artists=? WHERE id=?").run(JSON.stringify(following ? [update.entityKey] : []), actor.id);
    return routes["PUT /api/creators/:type/:key/notifications"](context(actor, { notifyUpdates }, { type: "artist", key: encodeURIComponent(update.entityKey) }));
  }
  return routes["PUT /api/creators/:type/:key/follow"](context(actor, { following, notifyUpdates }, { type: update.entityType, key: encodeURIComponent(update.entityKey) }));
}
const notices = postId => db.prepare("SELECT * FROM notifications WHERE post_id=? AND type='creator_update'").all(postId);
const throwsStatus = (run, status) => assert.throws(run, error => error.status === status);

test("artist, venue and event owners publish through ordinary posts and replay without duplicate notices", () => {
  for (const type of ["artist", "venue", "event"]) {
    const f = owner(type), fan = account();
    follow(fan, f.update);
    const first = publish(f);
    assert.equal(first.post.kind, "status");
    assert.equal(first.post.creatorUpdate.entityKey, f.update.entityKey);
    assert.equal(first.post.creatorUpdate.title, f.update.title);
    assert.equal(publish(f).id, first.id);
    assert.equal(notices(first.id).length, 1);
    assert.equal(notices(first.id)[0].user_id, fan.id);
    const inbox = routes["GET /api/me/notifications"](context(fan)).notifications.find(row => row.postId === first.id);
    assert.equal(inbox.postKind, "status");
    assert.equal(inbox.creatorUpdate, true);
    assert.equal(routes["GET /api/creators/:type/:key/posts"](context(fan, {}, { type, key: encodeURIComponent(f.update.entityKey) })).posts[0].id, first.id);
    throwsStatus(() => publish(f, { creatorUpdate: { ...f.update, title: "Changed replay" } }), 409);
  }
});

test("fan, admin, spoofed context role, unrelated owner and held page cannot author entity updates", () => {
  const f = owner();
  for (const actor of [account(), account("admin"), owner().actor]) throwsStatus(() => publish({ ...f, actor }), 403);
  const fan = account();
  throwsStatus(() => publish({ ...f, actor: { ...fan, role: "artist", artist_name: f.update.entityKey } }), 403);
  db.prepare("UPDATE artist_profiles SET identity_review_status='pending' WHERE artist_key=?").run(f.update.entityKey);
  throwsStatus(() => publish(f), 409);
  const venue = owner("venue");
  db.prepare("UPDATE creator_entities SET status='held' WHERE owner_id=?").run(venue.actor.id);
  throwsStatus(() => publish(venue), 403);
});

test("notification eligibility respects existing artist follow, opt-out, blocks, mutes and active accounts", () => {
  const f = owner(), eligible = account(), muted = account(), blocked = account(), optedOut = account(), dormant = account(), banned = account(), suspended = account(), notFollowing = account();
  for (const person of [eligible, muted, blocked, optedOut, dormant, banned, suspended, f.actor]) {
    db.prepare("UPDATE users SET favorite_artists=? WHERE id=?").run(JSON.stringify([f.actor.artist_name]), person.id);
  }
  follow(optedOut, f.update, true, false);
  follow(notFollowing, f.update, false, true);
  db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) VALUES (?,?,?)").run(muted.id, f.actor.id, Date.now());
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(f.actor.id, blocked.id, Date.now());
  db.prepare("UPDATE users SET dormant_at=1 WHERE id=?").run(dormant.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, suspended.id);
  const result = publish(f);
  assert.deepEqual(notices(result.id).map(row => row.user_id), [eligible.id]);
  const inbox = routes["GET /api/me/notifications"](context(eligible));
  assert.ok(inbox.notifications.some(row => row.postId === result.id));
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(result.id);
  const hidden = routes["GET /api/me/notifications"](context(eligible));
  assert.ok(!hidden.notifications.some(row => row.postId === result.id));
  assert.equal(hidden.unread, 0);
  throwsStatus(() => publish(f), 409);
});

test("revoked authority disappears from managed entities, presentation and inbox", () => {
  const f = owner("event"), fan = account(); follow(fan, f.update);
  const result = publish(f);
  db.prepare("UPDATE creator_entities SET owner_id=NULL WHERE entity_key=?").run(f.update.entityKey);
  assert.deepEqual(routes["GET /api/me/creator-entities"](context(f.actor)).entities, []);
  assert.equal(routes["GET /api/posts/:id"](context(fan, {}, { id: result.id })).post.creatorUpdate, null);
  assert.equal(routes["GET /api/me/notifications"](context(fan)).notifications.filter(row => row.postId === result.id).length, 0);
  throwsStatus(() => publish(f), 403);
  throwsStatus(() => routes["PATCH /api/posts/:id"](context(f.actor, { review: "Changed" }, { id: result.id })), 403);
});

test("club-only followers use the existing public-slug and historical normalized identity aliases", () => {
  const f = owner(), at = Date.now(), slug = `fixture-public-${sequence}`;
  db.prepare("INSERT INTO artists(norm,name,public_slug,source,created_at,updated_at) VALUES (?,?,?,'musicbrainz',?,?)")
    .run(f.update.entityKey, f.actor.artist_name, slug, at, at);
  const fans = [account(), account(), account()];
  const aliases = [f.update.entityKey, slug, `  ${f.actor.artist_name.toUpperCase().replaceAll(" ", "   ")}  `];
  fans.forEach((fan, i) => {
    db.prepare("INSERT INTO fan_club_members(artist,user_id) VALUES (?,?)").run(aliases[i], fan.id);
    const pref = routes["GET /api/creators/:type/:key/follow"](context(fan, {}, { type: "artist", key: encodeURIComponent(f.update.entityKey) }));
    assert.deepEqual(pref, { following: true, notifyUpdates: true });
  });
  const result = publish(f);
  assert.deepEqual(notices(result.id).map(row => row.user_id).sort(), fans.map(fan => fan.id).sort());
  assert.equal(publish(f).id, result.id);
  assert.equal(notices(result.id).length, fans.length);
});

test("editing optional text preserves a title-only update and does not redeliver notices", () => {
  const f = owner(), fan = account(); follow(fan, f.update);
  const first = publish(f, { review: "Optional details" });
  const edited = routes["PATCH /api/posts/:id"](context(f.actor, { review: "" }, { id: first.id }));
  assert.equal(edited.post.review, "");
  assert.equal(edited.post.creatorUpdate.title, f.update.title);
  assert.equal(notices(first.id).length, 1);
  throwsStatus(() => routes["PATCH /api/posts/:id"](context(f.actor, { creatorUpdate: { ...f.update, title: "A different update" } }, { id: first.id })), 400);
});

test("invalid input and foreign media fail before durable posts or notices; ordinary fan uploads remain ordinary", () => {
  const f = owner();
  for (const change of [{ title: "" }, { date: "2026-02-30" }, { kind: "show" }, { url: "javascript:alert(1)" }, { url: "https://name:password@example.test" }, { title: "x".repeat(161) }]) {
    throwsStatus(() => publish(f, { creatorUpdate: { ...f.update, ...change } }), 400);
  }
  assert.throws(() => publish(f, { mediaAssetIds: ["ma_not_owned_1234"] }));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM posts WHERE user_id=?").get(f.actor.id).c, 0);
  const fan = account();
  const plain = routes["POST /api/posts"](context(fan, { kind: "status", review: "A good night", clientMutationId: "plain_creator_control" }));
  assert.equal(plain.post.creatorUpdate, null);
  assert.equal(notices(plain.id).length, 0);
});

test("failure during durable notice creation rolls back post, receipt and media association", () => {
  const f = owner(), fan = account(); follow(fan, f.update);
  db.exec("CREATE TRIGGER fail_creator_notice BEFORE INSERT ON notifications WHEN NEW.type='creator_update' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  assert.throws(() => publish(f), /synthetic failure/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM posts WHERE user_id=?").get(f.actor.id).c, 0);
  db.exec("DROP TRIGGER fail_creator_notice");
  const result = publish(f);
  assert.equal(notices(result.id).length, 1);
  assert.equal(publish(f).id, result.id);
});


test("claim registry compare-and-set requires the claim transaction and matching classification", async () => {
  const { setCreatorEntityOwnership } = await import("./creatorEntityOwnership.js");
  const { withImmediateWrite } = await import("../../databaseTransaction.js");
  const actor = account("venue"), fan = account();
  const input = { entityType: "venue", entityKey: "claim-fixture", name: "Claim Fixture", ownerId: actor.id, expectedOwnerId: null };
  assert.throws(() => setCreatorEntityOwnership(db, input), /claim transaction/);
  withImmediateWrite(db, () => setCreatorEntityOwnership(db, input));
  throwsStatus(() => withImmediateWrite(db, () => setCreatorEntityOwnership(db, input)), 409);
  throwsStatus(() => withImmediateWrite(db, () => setCreatorEntityOwnership(db, { ...input, expectedOwnerId: actor.id, ownerId: fan.id })), 403);
  withImmediateWrite(db, () => setCreatorEntityOwnership(db, { ...input, expectedOwnerId: actor.id, ownerId: null, status: "held" }));
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_key='claim-fixture'").get().owner_id, null);
});

test("migration is repeatable and backup manifests preserve registry, preferences and attachment column", async () => {
  const { ensureCreatorPostSchema } = await import("./creatorPostSchema.js");
  const { backupSourceManifest } = await import("../../../scripts/backup-db-verification.mjs");
  ensureCreatorPostSchema(db); ensureCreatorPostSchema(db);
  const manifest = backupSourceManifest(db);
  assert.ok(manifest.posts.columns.includes("creator_update"));
  assert.equal(manifest.creator_entities.minimumRows, db.prepare("SELECT COUNT(*) c FROM creator_entities").get().c);
  assert.equal(manifest.creator_follows.minimumRows, db.prepare("SELECT COUNT(*) c FROM creator_follows").get().c);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("migration upgrades an existing database without changing ordinary posts", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { ensureCreatorPostSchema } = await import("./creatorPostSchema.js");
  const legacy = new DatabaseSync(":memory:");
  try {
    legacy.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,created_at INTEGER,removed INTEGER DEFAULT 0);
      CREATE TABLE notifications(user_id TEXT,post_id TEXT,type TEXT);
      INSERT INTO posts(id,user_id,created_at) VALUES ('old-post','old-user',123);`);
    ensureCreatorPostSchema(legacy); ensureCreatorPostSchema(legacy);
    assert.deepEqual({ ...legacy.prepare("SELECT * FROM posts").get() }, { id: "old-post", user_id: "old-user", created_at: 123, removed: 0, creator_update: null });
    assert.equal(legacy.prepare("SELECT COUNT(*) count FROM creator_entities").get().count, 0);
  } finally { legacy.close(); }
});

test("account export includes only owned creator data; deletion erases posts, preferences and notices", async () => {
  const { hashPassword } = await import("../../auth.js");
  const f = owner("venue"), fan = account(), other = owner("event");
  follow(f.actor, other.update); follow(fan, f.update);
  const post = publish(f), password = "creator-fixture-password1";
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(password), f.actor.id);
  const actor = q.userById.get(f.actor.id);
  const exported = await routes["POST /api/me/export"](context(actor, { password }));
  assert.equal(exported.creatorAccount.pages.length, 1);
  assert.equal(exported.creatorAccount.pages[0].entityKey, f.update.entityKey);
  assert.equal(exported.creatorAccount.follows.length, 1);
  assert.deepEqual(exported.posts.find(row => row.id === post.id).creatorUpdate, f.update);
  await routes["DELETE /api/me"](context(actor, { password }));
  assert.equal(db.prepare("SELECT 1 FROM posts WHERE id=?").get(post.id), undefined);
  assert.equal(notices(post.id).length, 0);
  assert.equal(db.prepare("SELECT 1 FROM creator_follows WHERE account_id=?").get(actor.id), undefined);
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_key=?").get(f.update.entityKey).owner_id, null);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
