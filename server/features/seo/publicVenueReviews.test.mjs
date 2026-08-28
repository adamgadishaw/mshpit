import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-public-venue-reviews-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("../../db.js");
const { createPublicVenueReviewService } = await import("./publicVenueReviews.js");

const service = createPublicVenueReviewService(db);

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, handle, {
  name = handle,
  banned = false,
  suspended = false,
} = {}) {
  q.insertUser.run(
    id,
    `${handle}@private.example.test`,
    name,
    handle,
    "hash",
    "fan",
    null,
    null,
    null,
    "SE",
    "#111111",
    1_700_000_000_000,
  );
  db.prepare("UPDATE users SET is_banned=?,suspended_until=? WHERE id=?")
    .run(banned ? 1 : 0, suspended ? Date.now() + 60_000 : null, id);
  return q.userById.get(id);
}

function addReview({
  id,
  venueKey,
  userId,
  rating = 4,
  text = "A detailed venue review covering the sound, sightlines, room, crowd flow, and atmosphere.",
  photos = [],
  photosPublic = false,
  removed = false,
  createdAt = 1,
}) {
  db.prepare(`INSERT INTO venue_reviews
    (id,venue_key,user_id,rating,text,photos,photos_public,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id,
    venueKey,
    userId,
    rating,
    text,
    JSON.stringify(photos),
    photosPublic ? 1 : 0,
    removed ? 1 : 0,
    createdAt,
  );
}

function addVerifiedReadyImage({ id, ownerId }) {
  const at = 1_725_000_000_000;
  const sourceKey = `users/${ownerId}/venue/${id}-source.jpg`;
  const renderKey = `users/${ownerId}/venue/${id}-render.jpg`;
  const sourceUrl = `https://private.example.test/${id}.jpg`;
  const publicUrl = `https://media.example.test/${id}.jpg`;
  const variantId = `variant-${id}`;
  const addObject = db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?,?,?,?,'associated',?,?,?)`);
  addObject.run(sourceKey, ownerId, "private", "venue-review", 100, at, at, at);
  addObject.run(renderKey, ownerId, "public", "venue-review", 90, at, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,edit_recipe,
      source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,?,'image',?,?,?,'venue.jpg','image/jpeg',100,1200,800,'declared',
      'not_applicable','ready','{}',?,'ready',?,?,?)`).run(
    id,
    ownerId,
    `client-${id}`,
    `create-${id}`,
    "venue",
    sourceKey,
    sourceUrl,
    "private",
    at,
    variantId,
    at,
    at,
  );
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,
      width,height,status,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?, 'render',?,?, 'image/jpeg',90,1200,800,'verified',?,
      'private_derivative_v1',?,?)`).run(
    variantId,
    id,
    `client-${variantId}`,
    `create-${variantId}`,
    renderKey,
    publicUrl,
    at,
    at,
    at,
  );
  return publicUrl;
}

test("public venue reviews exclude hidden accounts and require substantive text or verified owned photos", () => {
  const textAuthor = addUser("u_vr_text", "vrtext", { name: "Text Reviewer" });
  const photoAuthor = addUser("u_vr_photo", "vrphoto", { name: "Photo Reviewer" });
  const unverifiedAuthor = addUser("u_vr_unverified", "vrunverified");
  const privatePhotoAuthor = addUser("u_vr_private_photo", "vrprivatephoto");
  const banned = addUser("u_vr_banned", "vrbanned", { banned: true });
  const suspended = addUser("u_vr_suspended", "vrsuspended", { suspended: true });
  const removed = addUser("u_vr_removed", "vrremoved");
  const short = addUser("u_vr_short", "vrshort");
  const otherVenue = addUser("u_vr_other", "vrother");

  const verified = Array.from({ length: 4 }, (_, index) => addVerifiedReadyImage({
    id: `vr-photo-${index}`,
    ownerId: photoAuthor.id,
  }));
  const unverifiedUrl = "https://media.example.test/not-verified.jpg";
  const privateVerified = addVerifiedReadyImage({ id: "vr-photo-private", ownerId: privatePhotoAuthor.id });
  addReview({ id: "vr_text", venueKey: "seo venue", userId: textAuthor.id, rating: 4, createdAt: 100 });
  addReview({
    id: "vr_photo",
    venueKey: "seo venue",
    userId: photoAuthor.id,
    rating: 5,
    text: "photo",
    photos: [...verified, unverifiedUrl],
    photosPublic: true,
    createdAt: 110,
  });
  addReview({
    id: "vr_private_photo",
    venueKey: "seo venue",
    userId: privatePhotoAuthor.id,
    rating: 5,
    text: "photo",
    photos: [privateVerified],
    photosPublic: false,
    createdAt: 115,
  });
  addReview({
    id: "vr_unverified",
    venueKey: "seo venue",
    userId: unverifiedAuthor.id,
    rating: 5,
    text: "short",
    photos: [unverifiedUrl],
    createdAt: 120,
  });
  addReview({ id: "vr_banned", venueKey: "seo venue", userId: banned.id, rating: 1, createdAt: 130 });
  addReview({ id: "vr_suspended", venueKey: "seo venue", userId: suspended.id, rating: 1, createdAt: 140 });
  addReview({ id: "vr_removed", venueKey: "seo venue", userId: removed.id, rating: 1, removed: true, createdAt: 150 });
  addReview({ id: "vr_short", venueKey: "seo venue", userId: short.id, rating: 1, text: "too short", createdAt: 160 });
  addReview({ id: "vr_other", venueKey: "seo venue extra", userId: otherVenue.id, rating: 1, createdAt: 170 });

  const result = service.read({ venueKey: "  SEO VENUE  " });
  assert.deepEqual(result.reviews.map((review) => review.id), ["vr_photo", "vr_text"]);
  assert.deepEqual(result.reviews[0].photos, verified.slice(0, 3));
  assert.equal(result.reviews.some((review) => review.photos.includes(unverifiedUrl)), false);
  assert.equal(result.reviews.some((review) => review.photos.includes(privateVerified)), false);
  assert.deepEqual(result.stats, { reviewCount: 2, ratingCount: 2, averageRating: 4.5 });
  assert.equal(JSON.stringify(result).includes("userId"), false);
  assert.equal(JSON.stringify(result).includes("@private.example.test"), false);
});

test("aggregate ratings use one latest valid eligible score per person", () => {
  const repeated = addUser("u_vr_repeated", "vrrepeated");
  const second = addUser("u_vr_second", "vrsecond");
  const invalid = addUser("u_vr_invalid", "vrinvalid");

  addReview({ id: "vr_repeat_old", venueKey: "duplicate venue", userId: repeated.id, rating: 1, createdAt: 100 });
  addReview({ id: "vr_repeat_valid", venueKey: "duplicate venue", userId: repeated.id, rating: 5, createdAt: 200 });
  addReview({ id: "vr_repeat_zero", venueKey: "duplicate venue", userId: repeated.id, rating: 0, createdAt: 300 });
  addReview({ id: "vr_second", venueKey: "duplicate venue", userId: second.id, rating: 3, createdAt: 250 });
  addReview({ id: "vr_invalid", venueKey: "duplicate venue", userId: invalid.id, rating: 6, createdAt: 350 });

  const result = service.read({ venueKey: "duplicate venue" });
  assert.deepEqual(result.reviews.map((review) => review.id), [
    "vr_invalid",
    "vr_repeat_zero",
    "vr_second",
  ]);
  assert.equal(result.reviews.find((review) => review.id === "vr_repeat_zero").rating, null);
  assert.deepEqual(result.stats, { reviewCount: 3, ratingCount: 2, averageRating: 4 },
    "rating 5 is the repeated member's latest eligible valid score; 0 and 6 never enter the aggregate");

  const zeroOnly = addUser("u_vr_zero_only", "vrzeroonly");
  addReview({ id: "vr_zero_only", venueKey: "zero venue", userId: zeroOnly.id, rating: 0, createdAt: 1 });
  assert.deepEqual(service.read({ venueKey: "zero venue" }).stats, {
    reviewCount: 1,
    ratingCount: 0,
    averageRating: null,
  });
  assert.deepEqual(service.read({ venueKey: "empty venue" }), {
    reviews: [],
    stats: { reviewCount: 0, ratingCount: 0, averageRating: null },
  });
});

test("review projection is deterministic, sanitized, bounded, and keeps authored markup as inert data", () => {
  const ids = [];
  for (let index = 0; index < 10; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const user = addUser(`u_vr_bound_${suffix}`, `vrbound${suffix}`);
    ids.push(`vr_bound_${suffix}`);
    addReview({
      id: `vr_bound_${suffix}`,
      venueKey: "bounded venue",
      userId: user.id,
      rating: 4,
      text: `Review ${suffix} describes the room, sound, crowd, sightlines, and atmosphere in sufficient detail.`,
      createdAt: 1_000 + index,
    });
  }
  const malicious = addUser("u_vr_markup", "vrmarkup", {
    name: "Markup\u0000   Reviewer",
  });
  db.prepare("UPDATE users SET handle=? WHERE id=?").run("@markup\nhandle", malicious.id);
  addReview({
    id: "vr_markup",
    venueKey: "bounded venue",
    userId: malicious.id,
    rating: 4,
    text: "<script>alert('data')</script>\u0000 This authored review still describes the sound, room, crowd, and stage clearly.",
    createdAt: 2_000,
  });

  const result = service.read({ venueKey: "bounded venue", limit: 999 });
  assert.equal(result.reviews.length, 8);
  assert.equal(result.reviews[0].id, "vr_markup");
  assert.equal(result.reviews[0].author.name, "Markup Reviewer");
  assert.equal(result.reviews[0].author.handle, "markup handle");
  assert.match(result.reviews[0].text, /^<script>alert\('data'\)<\/script> This authored review/);
  assert.equal(result.reviews[1].id, ids.at(-1));
  assert.deepEqual(
    service.read({ venueKey: "bounded venue", limit: 2 }).reviews.map((review) => review.id),
    ["vr_markup", ids.at(-1)],
  );
  const statsOnly = service.read({ venueKey: "bounded venue", limit: 0 });
  assert.deepEqual(statsOnly.reviews, []);
  assert.deepEqual(statsOnly.stats, { reviewCount: 11, ratingCount: 11, averageRating: 4 });
  assert.deepEqual(service.read({ venueKey: "" }), null);
  assert.deepEqual(service.read({ venueKey: null }), null);
});
