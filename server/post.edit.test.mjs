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

test("status posts carry text/photos with no artist, venue, or rating", () => {
  const user = addUser("statusposter");
  const create = routes["POST /api/posts"];
  const status = create({
    user,
    ip: "status-create",
    body: { kind: "status", review: "just left the best show of my life", photos: ["https://cdn.example/night.jpg"] },
  });
  assert.equal(status.post.kind, "status");
  assert.equal(status.post.artist, "");
  assert.equal(status.post.venue, "");
  assert.equal(status.post.overall, 0);
  assert.equal(status.post.review, "just left the best show of my life");
  assert.deepEqual(status.post.photos, ["https://cdn.example/night.jpg"]);

  const songOnly = create({
    user,
    ip: "status-song",
    body: { kind: "status", song: { url: "https://youtu.be/dQw4w9WgXcQ", title: "Shared song", artist: "Artist" } },
  });
  assert.equal(songOnly.post.song.videoId, "dQw4w9WgXcQ");
  assert.equal(songOnly.post.song.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

  // A photo-only status is fine; a status with neither text nor a photo is not.
  const photoOnly = create({ user, ip: "status-photo", body: { kind: "status", photos: ["https://cdn.example/a.jpg"] } });
  assert.equal(photoOnly.post.kind, "status");
  assert.throws(
    () => create({ user, ip: "status-empty", body: { kind: "status", review: "   " } }),
    (error) => error instanceof ApiError && error.status === 400,
  );
  assert.throws(
    () => create({ user, ip: "status-bad-song", body: { kind: "status", review: "still invalid", song: { url: "https://example.com/video" } } }),
    (error) => error instanceof ApiError && error.status === 400,
  );

  const edit = routes["PATCH /api/posts/:id"];
  assert.throws(
    () => edit({ user, ip: "status-clear", params: { id: status.id }, body: { review: "", photos: [], song: null, version: status.post.version } }),
    (error) => error instanceof ApiError && error.status === 400,
  );

  // A regular review is still a review, and never becomes a status by accident.
  const review = create({ user, ip: "status-review", body: { artist: "Artist", venue: "Venue", overall: 4 } });
  assert.equal(review.post.kind, "review");
});

test("status posts can share an owned playlist as an immutable snapshot", () => {
  const user = addUser("plsharer");
  db.prepare("INSERT INTO playlists (id,user_id,name,tracks,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("pl_share", user.id, "Barricade Anthems",
      JSON.stringify([{ title: "BLACKOUT", artist: "Turnstile", videoId: "dQw4w9WgXcQ" }, { title: "MYSTERY", artist: "Turnstile" }]),
      "public", 100, 100);
  db.prepare("INSERT INTO playlists (id,user_id,name,tracks,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("pl_private", user.id, "Secret", JSON.stringify([{ title: "X" }]), "private", 100, 100);

  const create = routes["POST /api/posts"];
  const shared = create({ user, ip: "pl-share", body: { kind: "status", review: "on repeat", playlistId: "pl_share" } });
  assert.equal(shared.post.kind, "status");
  assert.equal(shared.post.playlist.name, "Barricade Anthems");
  assert.equal(shared.post.playlist.tracks.length, 2);
  assert.equal(shared.post.playlist.tracks[0].videoId, "dQw4w9WgXcQ");

  // A private playlist cannot be shared, and a playlist you don't own is rejected.
  assert.throws(
    () => create({ user, ip: "pl-private", body: { kind: "status", playlistId: "pl_private" } }),
    (error) => error instanceof ApiError && error.status === 400,
  );
  const stranger = addUser("plstranger");
  assert.throws(
    () => create({ user: stranger, ip: "pl-stranger", body: { kind: "status", playlistId: "pl_share" } }),
    (error) => error instanceof ApiError && error.status === 404,
  );

  // Editing the post's text keeps the playlist snapshot (PATCH only touches it
  // when playlistId is sent).
  const edit = routes["PATCH /api/posts/:id"];
  const edited = edit({ user, ip: "pl-edit", params: { id: shared.post.id }, body: { review: "still on repeat", version: shared.post.version } });
  assert.equal(edited.post.playlist.name, "Barricade Anthems");
  // Sending playlistId: null clears it.
  const cleared = edit({ user, ip: "pl-clear", params: { id: shared.post.id }, body: { playlistId: null, review: "text stays", version: edited.post.version } });
  assert.equal(cleared.post.playlist, null);
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
      song: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Post song", artist: "Artist" },
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
  assert.equal(first.post.song.videoId, "dQw4w9WgXcQ");
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
    body: { city: "", date: "", review: "", band: null, room: null, photos: [], setlist: [], tour: null, song: null, version: first.post.version },
  });
  assert.equal(cleared.post.city, "");
  assert.equal(cleared.post.review, "");
  assert.equal(cleared.post.band, null);
  assert.deepEqual(cleared.post.photos, []);
  assert.equal(cleared.post.tour, null);
  assert.equal(cleared.post.song, null);

  // A review is the author's own words: even admins may not rewrite it. They
  // moderate by removing content or muting/banning people, never by editing.
  assert.throws(
    () => edit({
      user: admin,
      ip: "post-edit-admin",
      requestId: "post-edit-admin-request",
      params: { id: "post_edit" },
      body: { venue: "New Venue", version: cleared.post.version },
    }),
    (error) => error.status === 403,
  );
  const audit = db.prepare("SELECT * FROM moderation_actions WHERE target_type='post' AND target_id='post_edit' AND action='edit'").get();
  assert.equal(audit, undefined);
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
// A performance is artist + venue + date and `concertKey` embeds the date, so
// two spellings of one night used to become two performances. A real row
// reached the database as "2026 <U+FFFD> 06 <U+FFFD> 21" and split The Fillmore
// in two. Dates are now stored canonically, so every spelling of a night
// converges on one identity and only a non-date is refused.
test("post dates are stored canonically, so one night is always one performance", () => {
  const user = addUser("postdates");
  const create = routes["POST /api/posts"];
  const base = { artist: "Artist", venue: "Venue", city: "Toronto", overall: 4 };

  for (const date of ["2026 · 06 · 21", "2026-06-21", "2026 � 06 � 21", "2026/06/21"]) {
    const made = create({ user, ip: "post-date-ok", body: { ...base, date } });
    assert.equal(made.post.date, "2026-06-21", `expected ${JSON.stringify(date)} to canonicalize`);
  }

  for (const date of ["2026-02-31", "2026-13-01", "tomorrow night", "0219-06-21"]) {
    assert.throws(
      () => create({ user, ip: "post-date-bad", body: { ...base, date } }),
      (error) => error instanceof ApiError && error.status === 400,
      `expected ${JSON.stringify(date)} to be refused`,
    );
  }
});

test("editing a post repairs a legacy date instead of rejecting its owner", () => {
  const owner = addUser("postdateedit");
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,date,overall,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("post_legacy_date", owner.id, "Artist", "Venue", "2026 � 06 � 21", 4, 300);
  const edit = routes["PATCH /api/posts/:id"];

  // The composer resubmits whatever it loaded, so an ordinary edit is what
  // quietly heals the row onto the performance it always belonged to.
  const healed = edit({
    user: owner, ip: "post-date-legacy", params: { id: "post_legacy_date" },
    body: { artist: "Artist", venue: "Venue", date: "2026 � 06 � 21", overall: 4, review: "Fixing my review", version: 300 },
  });
  assert.equal(healed.post.review, "Fixing my review");
  assert.equal(healed.post.date, "2026-06-21");

  assert.throws(
    () => edit({
      user: owner, ip: "post-date-worse", params: { id: "post_legacy_date" },
      body: { artist: "Artist", venue: "Venue", date: "whenever", overall: 4, version: healed.post.version },
    }),
    (error) => error instanceof ApiError && error.status === 400,
  );
});
