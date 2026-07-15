import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-post-edit-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id.replace(/[^a-z0-9_]/g, "").slice(0, 20), "test-hash", role, "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}

test("post creation returns the canonical post and persists detailed ratings", () => {
  const user = addUser("postcreator");
  const create = routes["POST /api/posts"];
  const result = create({
    user,
    ip: "post-create",
    body: {
      artist: "Artist",
      venue: "Venue",
      city: "Toronto",
      date: "2026 · 07 · 15",
      overall: 4.5,
      band: 5,
      room: 4,
      dims: { performance: 5, setlist: 4.5, sound: 4, venue: 4, crowd: 5, experience: 4.5 },
      review: "A real night",
      photos: [],
      photosPublic: false,
      setlist: ["Opener"],
    },
  });
  assert.equal(result.id, result.post.id);
  assert.equal(result.post.userId, user.id);
  assert.equal(result.post.dims.crowd, 5);
  assert.deepEqual(result.post.setlist, ["Opener"]);
  assert.equal(result.post.photosPublic, false);
  assert.equal(result.post.version, result.post.createdAt);
  assert.throws(
    () => create({ user, ip: "post-create-invalid", body: { artist: "Artist", venue: "Venue", overall: 4, photosPublic: "false" } }),
    (error) => error instanceof ApiError && error.status === 400
  );
});

test("post edits enforce ownership, revisions, validation, and canonical fields", () => {
  const owner = addUser("postowner");
  const stranger = addUser("poststranger");
  addUser("postadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id='postadmin'").run();
  const admin = q.userById.get("postadmin");
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,city,date,overall,band,room,dims,review,photos,photos_public,setlist,tour,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("post_edit", owner.id, "Artist", "Venue", "Toronto", "2026 · 07 · 15", 4, 4.5, 3.5,
      JSON.stringify({ performance: 4.5, setlist: 4, sound: 3.5, venue: 3, crowd: 5, experience: 4.5 }),
      "Original", "[]", 0, "[]", "Summer Tour", 100);

  const edit = routes["PATCH /api/posts/:id"];
  assert.throws(
    () => edit({ user: stranger, ip: "post-edit-stranger", params: { id: "post_edit" }, body: { review: "Nope", version: 100 } }),
    (error) => error instanceof ApiError && error.status === 403
  );

  const first = edit({
    user: owner,
    ip: "post-edit-owner",
    params: { id: "post_edit" },
    body: {
      review: "Updated\u0000 review",
      photos: ["https://cdn.example/photo.jpg"],
      photosPublic: true,
      dims: { performance: 5, setlist: 4.5, sound: 4, venue: 3.5, crowd: 5, experience: 5, privileged: 5 },
      version: 100,
      userId: stranger.id,
      removed: true,
      createdAt: 999,
    },
  });
  assert.equal(first.post.review, "Updated review");
  assert.deepEqual(first.post.photos, ["https://cdn.example/photo.jpg"]);
  assert.equal(first.post.photosPublic, true);
  assert.equal(first.post.dims.performance, 5);
  assert.equal(first.post.dims.privileged, undefined);
  assert.equal(first.post.userId, owner.id);
  assert.equal(first.post.createdAt, 100);
  assert.ok(first.post.editedAt > 100);
  assert.equal(first.post.version, first.post.editedAt);

  assert.throws(
    () => edit({ user: owner, ip: "post-edit-stale", params: { id: "post_edit" }, body: { review: "Stale", version: 100 } }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT"
  );
  assert.throws(
    () => edit({ user: owner, ip: "post-edit-invalid", params: { id: "post_edit" }, body: { photosPublic: "false", version: first.post.version } }),
    (error) => error instanceof ApiError && error.status === 400
  );
  assert.throws(
    () => edit({ user: owner, ip: "post-edit-empty-artist", params: { id: "post_edit" }, body: { artist: "", version: first.post.version } }),
    (error) => error instanceof ApiError && error.status === 400
  );

  const cleared = edit({
    user: owner,
    ip: "post-edit-clear",
    params: { id: "post_edit" },
    body: { city: "", date: "", review: "", band: null, room: null, photos: [], setlist: [], tour: null, version: first.post.version },
  });
  assert.equal(cleared.post.city, "");
  assert.equal(cleared.post.review, "");
  assert.equal(cleared.post.band, null);
  assert.deepEqual(cleared.post.photos, []);
  assert.equal(cleared.post.tour, null);

  const adminEdit = edit({
    user: admin,
    ip: "post-edit-admin",
    requestId: "post-edit-admin-request",
    params: { id: "post_edit" },
    body: { venue: "New Venue", version: cleared.post.version },
  });
  assert.equal(adminEdit.post.venue, "New Venue");
  const audit = db.prepare("SELECT * FROM moderation_actions WHERE target_type='post' AND target_id='post_edit' AND action='edit'").get();
  assert.equal(audit.actor_id, admin.id);
  assert.equal(audit.request_id, "post-edit-admin-request");
});

test("post edit keeps account restrictions and missing-post behavior", () => {
  const owner = addUser("postrestricted");
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run("post_restricted", owner.id, "Artist", "Venue", 4, 200);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, owner.id);
  const suspended = q.userById.get(owner.id);
  const edit = routes["PATCH /api/posts/:id"];
  assert.throws(
    () => edit({ user: suspended, ip: "post-edit-suspended", params: { id: "post_restricted" }, body: { review: "Nope", version: 200 } }),
    (error) => error instanceof ApiError && error.status === 403
  );
  assert.throws(
    () => edit({ user: addUser("postmissing"), ip: "post-edit-missing", params: { id: "missing" }, body: { review: "Nope" } }),
    (error) => error instanceof ApiError && error.status === 404
  );
});
