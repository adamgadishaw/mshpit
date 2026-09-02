import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-post-idempotency-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id.replace(/[^a-z0-9_]/g, "").slice(0, 20),
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

test("create retries compare the validated canonical post, not raw JSON representation", () => {
  const user = addUser("canonicalretry");
  const create = routes["POST /api/posts"];
  const clientMutationId = "canonical_retry_001";
  const first = create({
    user,
    ip: "canonical-retry-first",
    body: {
      clientMutationId,
      artist: "  J. Cole  ",
      artistKey: null,
      venue: "Scotiabank Arena",
      city: "Toronto",
      date: "2026/07/28",
      overall: "4.5",
      band: "5",
      dims: { sound: "4", performance: 5 },
      review: "  Worth the wait  ",
      photos: [],
      photosPublic: false,
      setlist: ["  opener  "],
      tags: ["  hip-hop  "],
    },
  });

  const retry = create({
    user,
    ip: "canonical-retry-equivalent",
    body: {
      clientMutationId,
      kind: "review",
      artist: "J. Cole",
      artistKey: null,
      venue: "Scotiabank Arena",
      city: "Toronto",
      date: "2026-07-28",
      overall: 4.5,
      band: 5,
      dims: { performance: 5, sound: 4 },
      review: "Worth the wait",
      photos: [],
      photosPublic: 0,
      setlist: ["opener"],
      tags: ["hip-hop"],
    },
  });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.id, first.id);
  assert.match(first.id, /^p_[a-f0-9]{32}$/, "post ids keep 128 bits of random entropy");
  assert.deepEqual({ ...db.prepare(`SELECT post_id,state,client_mutation_hash FROM post_create_receipts
    WHERE user_id=? AND client_mutation_id=?`).get(user.id, clientMutationId) }, {
    post_id: first.id,
    state: "active",
    client_mutation_hash: db.prepare("SELECT client_mutation_hash hash FROM posts WHERE id=?").get(first.id).hash,
  });
  assert.deepEqual(first.post.tags, []);
  assert.equal(db.prepare("SELECT tags FROM posts WHERE id=?").get(first.id).tags, "[]");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM posts WHERE user_id=? AND client_mutation_id=?").get(user.id, clientMutationId).count,
    1,
  );

  assert.throws(
    () => create({
      user,
      ip: "canonical-retry-changed",
      body: {
        clientMutationId,
        artist: "J. Cole",
        artistKey: null,
        venue: "Scotiabank Arena",
        city: "Toronto",
        date: "2026-07-28",
        overall: 4.5,
        review: "This is genuinely different",
      },
    }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "POST_MUTATION_CONFLICT",
  );
});

test("legacy retry rows without hashes are compared safely and healed", () => {
  const user = addUser("legacyretry");
  const create = routes["POST /api/posts"];
  const clientMutationId = "legacy_retry_001";
  const body = {
    clientMutationId,
    kind: "status",
    review: "J. Cole was incredible",
    photos: ["https://cdn.example/jcole.jpg"],
    photosPublic: true,
  };
  const legacyPostId = "p_legacy_retry_without_hash";
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,review,photos,photos_public,kind,client_mutation_id,client_mutation_hash,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?)`).run(
    legacyPostId, user.id, "", "", 0, body.review, JSON.stringify(body.photos), 1, "status", clientMutationId, 1_000,
  );

  const retry = create({
    user,
    ip: "legacy-retry-equivalent",
    body: { ...body, photosPublic: 1 },
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.id, legacyPostId);
  assert.match(db.prepare("SELECT client_mutation_hash AS hash FROM posts WHERE id=?").get(legacyPostId).hash, /^[a-f0-9]{64}$/);

  db.prepare("UPDATE posts SET client_mutation_hash=NULL WHERE id=?").run(legacyPostId);
  assert.throws(
    () => create({
      user,
      ip: "legacy-retry-changed",
      body: { ...body, review: "A changed legacy retry must not be discarded" },
    }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "POST_MUTATION_CONFLICT",
  );
});

test("a playlist post retry remains recoverable after its source playlist is deleted", () => {
  const user = addUser("playlistretry");
  db.prepare("INSERT INTO playlists (id,user_id,name,tracks,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("playlist_retry_source", user.id, "Night set", JSON.stringify([{ title: "Track", videoId: "dQw4w9WgXcQ" }]), "public", 10, 10);
  const body = {
    clientMutationId: "playlist_retry_001",
    kind: "status",
    review: "set from the show",
    playlistId: "playlist_retry_source",
  };
  const first = routes["POST /api/posts"]({ user, ip: "playlist-retry-first", body });
  db.prepare("DELETE FROM playlists WHERE id=?").run("playlist_retry_source");

  const retry = routes["POST /api/posts"]({ user, ip: "playlist-retry-after-delete", body });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.id, first.id);
  assert.equal(retry.post.playlist.id, "playlist_retry_source");
});

test("catalog enrichment changes do not invalidate an identical post retry", () => {
  const user = addUser("catalogdriftretry");
  const body = {
    clientMutationId: "catalog_drift_retry_001",
    artist: "Turnstile",
    artistKey: "turnstile",
    venue: "History",
    city: "Toronto",
    date: "2026-08-01",
    overall: 5,
    review: "Same authored review",
  };
  const first = routes["POST /api/posts"]({ user, ip: "catalog-drift-first", body });
  const before = db.prepare("SELECT artist_key,artist_mbid FROM posts WHERE id=?").get(first.id);
  assert.equal(before.artist_key, "turnstile");
  assert.ok(before.artist_mbid, "the create stores the current enrichment metadata");

  db.prepare("UPDATE artists SET mbid=? WHERE norm=?")
    .run("00000000-0000-0000-0000-000000000000", "turnstile");
  const retry = routes["POST /api/posts"]({ user, ip: "catalog-drift-retry", body });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.id, first.id);
  assert.equal(
    db.prepare("SELECT artist_mbid FROM posts WHERE id=?").get(first.id).artist_mbid,
    before.artist_mbid,
    "a duplicate retry never rewrites the immutable stored post",
  );
});

test("author deletion retains only the opaque mutation tombstone and cannot be resurrected by retry", () => {
  const user = addUser("deletedretry");
  const body = {
    clientMutationId: "deleted_retry_tombstone_001",
    kind: "status",
    review: "Delete this post permanently",
  };
  const created = routes["POST /api/posts"]({ user, ip: "deleted-retry-create", body });
  assert.match(db.prepare("SELECT client_mutation_hash hash FROM posts WHERE id=?").get(created.id).hash, /^[a-f0-9]{64}$/);

  routes["DELETE /api/posts/:id"]({ user, ip: "deleted-retry-delete", params: { id: created.id } });
  const tombstone = db.prepare(`SELECT removed,review,client_mutation_id,client_mutation_hash
    FROM posts WHERE id=?`).get(created.id);
  assert.deepEqual({ ...tombstone }, {
    removed: 1,
    review: "",
    client_mutation_id: body.clientMutationId,
    client_mutation_hash: null,
  });
  assert.throws(
    () => routes["POST /api/posts"]({ user, ip: "deleted-retry-replay", body }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "POST_REMOVED",
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM posts WHERE user_id=? AND client_mutation_id=?")
    .get(user.id, body.clientMutationId).count, 1);
  assert.equal(db.prepare("SELECT state FROM post_create_receipts WHERE user_id=? AND client_mutation_id=?")
    .get(user.id, body.clientMutationId).state, "removed");
});

test("moderation removal tombstones the receipt and a replay cannot recreate the post", () => {
  const user = addUser("moderatedretry");
  const body = { clientMutationId: "moderated_retry_tombstone_001", kind: "status", review: "Moderate this" };
  const created = routes["POST /api/posts"]({ user, ip: "moderated-create", body });
  db.prepare("UPDATE posts SET removed=1,updated_at=? WHERE id=?").run(Date.now(), created.id);

  assert.equal(db.prepare("SELECT state FROM post_create_receipts WHERE user_id=? AND client_mutation_id=?")
    .get(user.id, body.clientMutationId).state, "removed");
  assert.throws(
    () => routes["POST /api/posts"]({ user, ip: "moderated-replay", body }),
    (error) => error instanceof ApiError && error.code === "POST_REMOVED",
  );
});

test("a receipt committed by a competing creator resolves as duplicate or payload conflict", () => {
  const user = addUser("racereceipt");
  const create = routes["POST /api/posts"];
  const body = { clientMutationId: "race_receipt_001", kind: "status", review: "Winning payload" };
  const winner = create({ user, ip: "race-winner", body });
  const duplicate = create({ user, ip: "race-loser-same", body });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, winner.id);
  assert.throws(
    () => create({ user, ip: "race-loser-conflict", body: { ...body, review: "Losing payload" } }),
    (error) => error instanceof ApiError && error.code === "POST_MUTATION_CONFLICT",
  );
});
