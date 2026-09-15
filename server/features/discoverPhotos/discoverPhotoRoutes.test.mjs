import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { ApiError } from "../../errors.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-discover-photos-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q, DATABASE_PATH } = await import("../../db.js");
assert.equal(DATABASE_PATH, join(dataDir, "pit.db"), "Only the isolated fixture database may be modified.");
const { discoverPhotoRoutes } = await import("./discoverPhotoRoutes.js");
const route = discoverPhotoRoutes({ database: db, ApiError, rateLimit() {} })["GET /api/discover/photos"];
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

function user(id, overrides = {}) {
  q.insertUser.run(id, `${id}@example.test`, id, id, "test-hash", "fan", "Private home", 1, 2, "PH", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  for (const [column, value] of Object.entries(overrides)) {
    if (!["profile_audience", "is_banned", "dormant_at", "suspended_until", "email_verified_at"].includes(column)) throw new Error("Bad test column");
    db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(value, id);
  }
  return q.userById.get(id);
}

function photo(id, owner, { city = "Toronto, Ontario", publicPhoto = 1, removed = 0, ready = true, createdAt = Date.now(), kind = "review", experienceType = "in_person" } = {}) {
  const assetId = `ma_${id}`, variantId = `mv_${id}`;
  const sourceKey = `users/${owner.id}/post/${id}-source.jpg`, renderKey = `users/${owner.id}/post/${id}-safe.webp`;
  const renderUrl = `https://media.example.test/${renderKey}`;
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,review,photos,photos_public,removed,created_at,kind,experience_type)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, owner.id, "The Sheepdogs", "Concert venue", city, "2026-09-01", 5, "Private full post text", JSON.stringify([renderUrl]), publicPhoto, removed, createdAt, kind, experienceType);
  db.prepare(`INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,?,'post',4096,'associated',?,?)`).run(sourceKey, owner.id, "private", createdAt, createdAt);
  db.prepare(`INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,?,'post',2048,'associated',?,?)`).run(renderKey, owner.id, "public", createdAt, createdAt);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,
      edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,?,'image',?,?,?,'fixture.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable',?,'{}',1,?,?,'ready',?,?,?)`)
    .run(assetId, owner.id, `client_${id}`, "a".repeat(64), "post", sourceKey, `pit-private:${sourceKey}`, "private",
      ready ? "ready" : "render_unavailable", "b".repeat(64), createdAt, variantId, createdAt, createdAt);
  db.prepare(`INSERT INTO media_variants (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
    status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',2048,1200,1500,'verified',?,?,'private_derivative_v1',?,?)`)
    .run(variantId, assetId, `client_${variantId}`, "c".repeat(64), renderKey, renderUrl, "d".repeat(64), createdAt, createdAt, createdAt);
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)").run(id, assetId, createdAt);
  return { id, assetId, variantId, sourceKey, renderKey, renderUrl };
}

function read(query = {}, viewer = null) {
  const headers = {};
  const result = route({ query, user: viewer, setHeader(name, value) { headers[name] = value; } });
  assert.equal(headers["Cache-Control"], "private, no-store");
  return result.photos;
}

test("guest Worldwide photos include a Toronto concert without a feed, home, or login", () => {
  const author = user("photo_public_author");
  const media = photo("photo_public_toronto", author);
  const global = read();
  assert.ok(global.some((row) => row.postId === media.id));
  assert.ok(read({ country: "Worldwide" }).some((row) => row.postId === media.id));
  assert.ok(read({ country: "CA", city: "Toronto" }).some((row) => row.postId === media.id));
  assert.equal(read({ country: "US", city: "Toronto" }).length, 0);
  assert.equal(global.find((row) => row.postId === media.id).country, "canada");
  assert.doesNotMatch(JSON.stringify(global), /pit-private:|Private home|Private full post text|@example\.test|sourceKey|sourceUrl/);
});

test("guest gallery respects photo consent, account audience, restrictions, reports, and current readiness", () => {
  const viewer = user("photo_policy_viewer");
  const author = user("photo_policy_author");
  const cases = [
    ["photo_private", author, { publicPhoto: 0 }],
    ["photo_removed", author, { removed: 1 }],
    ["photo_unready", author, { ready: false }],
    ["photo_status", author, { kind: "status" }],
    ["photo_online", author, { experienceType: "online" }],
    ["photo_members", user("photo_members_author", { profile_audience: "members" }), {}],
    ["photo_only_me", user("photo_only_me_author", { profile_audience: "only_me" }), {}],
    ["photo_banned", user("photo_banned_author", { is_banned: 1 }), {}],
    ["photo_dormant", user("photo_dormant_author", { dormant_at: Date.now() }), {}],
    ["photo_suspended", user("photo_suspended_author", { suspended_until: Date.now() + 60_000 }), {}],
    ["photo_unverified", user("photo_unverified_author", { email_verified_at: 0 }), {}],
  ];
  for (const [id, owner, options] of cases) photo(id, owner, { ...options, city: "Ottawa, Ontario" });
  const reported = photo("photo_reported", author, { city: "Ottawa, Ontario" });
  db.prepare("INSERT INTO reports (id,target_type,target_id,reporter_id,status,created_at) VALUES (?,'post',?,?,'open',?)")
    .run("photo_report", reported.id, viewer.id, Date.now());
  assert.deepEqual(read({ country: "Canada", city: "Ottawa" }), []);
  assert.deepEqual(read({ city: "Ottawa" }, viewer).map((row) => row.postId), ["photo_members"]);
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id='photo_members_author'").run();
  assert.ok(read({ city: "Ottawa" }).some((row) => row.postId === "photo_members"));
  db.prepare("UPDATE media_variants SET status='failed' WHERE asset_id='ma_photo_members'").run();
  assert.deepEqual(read({ city: "Ottawa" }), [], "a revoked rendition cannot fall back to denormalized photo URLs");
});

test("member gallery enforces both block directions and mutes on every request", () => {
  const viewer = user("photo_block_viewer"), outgoing = user("photo_block_out"), incoming = user("photo_block_in"), muted = user("photo_muted");
  for (const author of [outgoing, incoming, muted]) photo(`post_${author.id}`, author, { city: "Montreal" });
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(viewer.id, outgoing.id, Date.now());
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(incoming.id, viewer.id, Date.now());
  db.prepare("INSERT INTO account_mutes (muter_id,muted_id,created_at) VALUES (?,?,?)").run(viewer.id, muted.id, Date.now());
  assert.equal(read({ city: "Montreal" }).length, 3);
  assert.deepEqual(read({ city: "Montreal" }, viewer), []);
});

test("country and city are applied before the bounded public-photo candidate window", () => {
  const author = user("photo_scope_author");
  photo("photo_scope_old_canada", author, { city: "Hamilton, Ontario, Canada", createdAt: 1_000 });
  for (let index = 0; index < 110; index++) photo(`photo_scope_us_${index}`, author, { city: "New York City, United States", createdAt: 2_000 + index });
  assert.equal(read({ country: "United States", limit: 999 }).length, 30);
  assert.deepEqual(read({ country: "Canada", city: "Hamilton", limit: 1 }).map((row) => row.postId), ["photo_scope_old_canada"]);
  assert.throws(() => read({ limit: "invalid" }), (error) => error.status === 400);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM posts INDEXED BY idx_posts_discover_photos WHERE removed=0 AND photos_public=1 ORDER BY created_at DESC,id DESC LIMIT 100").all();
  assert.match(JSON.stringify(plan), /idx_posts_discover_photos/);
});

test("a linked asset must belong to the post author and cannot expose arbitrary legacy URLs", () => {
  const owner = user("photo_ownership_owner"), other = user("photo_ownership_other");
  const media = photo("photo_ownership_good", owner, { city: "Guelph" });
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,city,overall,photos,photos_public,created_at) VALUES (?,?,?,'Venue','Guelph',4,?,1,?)")
    .run("photo_ownership_stolen", other.id, "Artist", JSON.stringify([media.renderUrl, "https://tracking.example.test/pixel.jpg"]), Date.now());
  assert.deepEqual(read({ city: "Guelph" }).map((row) => row.postId), [media.id]);
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(media.sourceKey);
  assert.deepEqual(read({ city: "Guelph" }), []);
});

test("a safe sibling image cannot publish a private original video source", () => {
  const owner = user("photo_mixed_owner");
  const good = photo("photo_mixed_public", owner, { city: "Kingston" });
  const privateSource = photo("photo_mixed_private_source", owner, { city: "Kingston" });
  db.prepare(`UPDATE media_assets SET kind='video',codec_status='verified',render_state='not_required',
    source_url='https://private-storage.example.test/original.mp4' WHERE id=?`).run(privateSource.assetId);
  db.prepare("UPDATE post_media SET post_id=?,position=1 WHERE asset_id=?").run(good.id, privateSource.assetId);
  const result = read({ city: "Kingston" });
  assert.deepEqual(result.map((row) => row.uri), [good.renderUrl]);
  assert.doesNotMatch(JSON.stringify(result), /private-storage/);
});
