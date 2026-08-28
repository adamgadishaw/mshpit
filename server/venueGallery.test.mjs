import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createApiResponseHeaderSetter } from "./responseHeaders.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-venue-gallery-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
function addUser(prefix) {
  sequence += 1;
  const id = `${prefix}_${sequence}`;
  const handle = id.replace(/[^a-z0-9_]/giu, "").toLowerCase().slice(0, 20);
  q.insertUser.run(
    id,
    `${id}@example.com`,
    `${prefix} ${sequence}`,
    handle,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    "VG",
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

function readyImage(owner, suffix, purpose = "post") {
  sequence += 1;
  const token = `${suffix}-${sequence}`.replace(/[^a-z0-9-]/giu, "").toLowerCase();
  const id = `ma_${token}`;
  const sourceKey = `users/${owner.id}/${purpose}/${token}.jpg`;
  const sourceUrl = `pit-private:${sourceKey}`;
  const variantId = `mv_${token}`;
  const renderKey = `users/${owner.id}/${purpose}/${token}-render.webp`;
  const url = `https://pit-media.example/${renderKey}`;
  const at = Date.now() + sequence;
  const insertObject = db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?,?,?,2048,'associated',?,?,?)`);
  insertObject.run(sourceKey, owner.id, "private", purpose, at, at, at);
  insertObject.run(renderKey, owner.id, "public", purpose, at, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,source_verified_at,
      render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,?,'image',?,?,'private','photo.jpg','image/jpeg',2048,100,100,
      'declared','not_applicable','ready',?,'ready',?,?,?)`)
    .run(id, owner.id, `client-${token}`, "a".repeat(64), purpose, sourceKey, sourceUrl, at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',1024,100,100,'verified',?,?,
      'private_derivative_v1',?,?)`)
    .run(variantId, id, `variant-${token}`, "b".repeat(64), renderKey, url, "c".repeat(64), at, at, at);
  return { id, url, at };
}

function addPost(owner, {
  id,
  image,
  venue = "History",
  venueKey = "history",
  photosPublic = 1,
  removed = 0,
  createdAt = Date.now(),
} = {}) {
  db.prepare(`INSERT INTO posts
    (id,user_id,kind,artist,venue,venue_key,overall,photos,photos_public,removed,created_at)
    VALUES (?,?,'review','Venue Gallery Artist',?,?,4,?,?,?,?)`)
    .run(id, owner.id, venue, venueKey, JSON.stringify(image ? [image.url] : []), photosPublic, removed, createdAt);
  if (image) {
    db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)")
      .run(id, image.id, createdAt);
  }
}

const getPhotos = routes["GET /api/venues/:key/photos"];

test("renamed venues share the canonical licensed gallery without shared caching", () => {
  const headers = {};
  const renamed = getPhotos({
    params: { key: encodeURIComponent("RBC Amphitheatre") },
    setHeader: createApiResponseHeaderSetter(headers),
  });
  const canonical = getPhotos({ params: { key: encodeURIComponent("Budweiser Stage") } });
  assert.equal(renamed.key, "budweiser stage");
  assert.ok(renamed.photos.length > 0);
  assert.deepEqual(renamed.photos, canonical.photos);
  assert.deepEqual(renamed.fanPhotos, []);
  assert.equal(headers["Cache-Control"], "private, no-store");
});

test("venue gallery adds only public, ready, unreported, unmoderated and block-visible fan images", () => {
  const viewer = addUser("gallery-viewer");
  const visible = addUser("gallery-visible");
  const alias = addUser("gallery-alias");
  const blocked = addUser("gallery-blocked");
  const hidden = addUser("gallery-hidden");
  const removed = addUser("gallery-removed");
  const reported = addUser("gallery-reported");
  const banned = addUser("gallery-banned");
  const reviewer = addUser("gallery-reviewer");
  const privateReviewer = addUser("gallery-private-reviewer");

  const visibleImage = readyImage(visible, "visible");
  const aliasImage = readyImage(alias, "alias");
  const blockedImage = readyImage(blocked, "blocked");
  const hiddenImage = readyImage(hidden, "hidden");
  const removedImage = readyImage(removed, "removed");
  const reportedImage = readyImage(reported, "reported");
  const bannedImage = readyImage(banned, "banned");
  const reviewImage = readyImage(reviewer, "review", "venue");
  const privateReviewImage = readyImage(privateReviewer, "private-review", "venue");
  const base = Date.now();
  addPost(visible, { id: "vg_visible", image: visibleImage, createdAt: base + 1 });
  addPost(alias, { id: "vg_alias", image: aliasImage, venue: "History Toronto", venueKey: "history toronto", createdAt: base + 2 });
  addPost(blocked, { id: "vg_blocked", image: blockedImage, createdAt: base + 3 });
  addPost(hidden, { id: "vg_hidden", image: hiddenImage, photosPublic: 0, createdAt: base + 4 });
  addPost(removed, { id: "vg_removed", image: removedImage, removed: 1, createdAt: base + 5 });
  addPost(reported, { id: "vg_reported", image: reportedImage, createdAt: base + 6 });
  addPost(banned, { id: "vg_banned", image: bannedImage, createdAt: base + 7 });
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);
  db.prepare(`INSERT INTO reports (id,target_type,target_id,reason,reporter_id,status,created_at)
    VALUES ('vg_report','post','vg_reported','media report',?,'open',?)`).run(viewer.id, base + 8);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(viewer.id, blocked.id, base + 9);
  db.prepare(`INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,photos_public,created_at)
    VALUES ('vg_review','history',?,4,'room review',?,1,?)`)
    .run(reviewer.id, JSON.stringify([reviewImage.url]), base + 10);
  db.prepare(`INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,photos_public,created_at)
    VALUES ('vg_private_review','history',?,4,'private room photo',?,0,?)`)
    .run(privateReviewer.id, JSON.stringify([privateReviewImage.url]), base + 11);

  const guest = getPhotos({ params: { key: "history" } });
  const guestUris = new Set(guest.fanPhotos.map((photo) => photo.uri));
  assert.equal(guestUris.has(visibleImage.url), true);
  assert.equal(guestUris.has(aliasImage.url), true);
  assert.equal(guestUris.has(blockedImage.url), true);
  assert.equal(guestUris.has(reviewImage.url), true);
  for (const excluded of [hiddenImage, removedImage, reportedImage, bannedImage]) {
    assert.equal(guestUris.has(excluded.url), false);
  }

  const signedIn = getPhotos({ user: viewer, params: { key: "history" } });
  const signedUris = new Set(signedIn.fanPhotos.map((photo) => photo.uri));
  assert.equal(signedUris.has(blockedImage.url), false);
  assert.equal(signedUris.has(visibleImage.url), true);
  assert.equal(signedUris.has(reviewImage.url), true);
  assert.ok(signedIn.fanPhotos.length <= 12);
  assert.ok(signedIn.fanPhotos.every((photo) => photo.source === "fan"));
  assert.ok(signedIn.fanPhotos.some((photo) => photo.origin === "post" && photo.postId === "vg_visible"));
  assert.ok(signedIn.fanPhotos.some((photo) => photo.origin === "venue-review" && photo.venueReviewId === "vg_review"));
  assert.equal(signedIn.fanPhotos.some((photo) => photo.uri === privateReviewImage.url), false);
  assert.equal(signedIn.fanPhotos.find((photo) => photo.venueReviewId === "vg_review")?.ownerId, reviewer.id);
});

test("venue review routes read aliases and persist new reviews under the canonical key", () => {
  const author = addUser("canonical-reviewer");
  db.prepare(`INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at)
    VALUES ('vg_legacy_alias_review','history toronto',?,4,'legacy alias','[]',?)`)
    .run(author.id, Date.now());
  const read = routes["GET /api/venues/:key/reviews"]({ params: { key: "History" }, query: {} });
  assert.ok(read.reviews.some((review) => review.id === "vg_legacy_alias_review"));

  const created = routes["POST /api/venues/:key/reviews"]({
    user: author,
    ip: "venue-canonical-review",
    params: { key: encodeURIComponent("RBC Amphitheatre") },
    body: { rating: 4, text: "Canonical room", photos: [], photosPublic: true },
  });
  const stored = db.prepare("SELECT venue_key,photos_public FROM venue_reviews WHERE id=?").get(created.id);
  assert.equal(stored.venue_key, "budweiser stage");
  assert.equal(stored.photos_public, 0);
});

test("canonical non-Latin venue keys keep verified fan media without an ASCII slug fallback", () => {
  const author = addUser("nonlatin-venue");
  const image = readyImage(author, "nonlatin");
  addPost(author, {
    id: "vg_nonlatin",
    image,
    venue: "東京ドーム",
    venueKey: "東京ドーム",
    createdAt: Date.now(),
  });
  const result = getPhotos({ params: { key: encodeURIComponent("東京ドーム") } });
  assert.equal(result.key, "東京ドーム");
  assert.equal(result.fanPhotos.some((photo) => photo.uri === image.url), true);
});

test("fan-gallery post lookups stay on the bounded venue indexes", () => {
  const currentPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM posts p INDEXED BY idx_posts_venue_visibility
    WHERE p.removed=0 AND p.venue_key IS NOT NULL AND p.venue_key IN (?)
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).all("history", 24);
  assert.match(currentPlan.map((row) => row.detail).join("\n"), /idx_posts_venue_visibility/u);

  const legacyPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT p.id FROM posts p INDEXED BY idx_posts_venue_public_slug
    WHERE p.removed=0 AND p.venue_key IS NULL AND trim(COALESCE(p.venue,''))<>''
      AND pit_public_slug(p.venue) IN (?) ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).all("history", 24);
  assert.match(legacyPlan.map((row) => row.detail).join("\n"), /idx_posts_venue_public_slug/u);
});
