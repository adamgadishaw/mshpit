import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-clips-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id.replace(/[^a-z0-9_]/g, "").slice(0, 20), "test-hash", role, "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}
let legacyPostSequence = 0;
function post(user, { photos, photosPublic = 1, artist = "Turnstile" }) {
  // URL-only media is a historical read fixture now; every new API post uses
  // stable media assets. Seed grandfathered rows directly so this suite tests
  // reel compatibility rather than the upload boundary.
  const id = `p_legacy_clip_${++legacyPostSequence}`;
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,city,date,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, user.id, artist, "History", "Toronto", "2026-07-12", 4.5, "", JSON.stringify(photos), photosPublic ? 1 : 0, Date.now(),
  );
  return { id };
}

test("clips reel returns only public posts that carry a real video, with just the clip urls", () => {
  const u = addUser("clipper");
  const V = "https://cdn.example/users/clipper/post/a.webm";
  const V2 = "https://cdn.example/users/clipper/post/b.mp4";
  const IMG = "https://cdn.example/users/clipper/post/c.jpg";

  post(u, { photos: [IMG] });                 // photo-only: excluded
  post(u, { photos: [V, IMG] });              // mixed: included, only the video surfaces
  post(u, { photos: [V2], photosPublic: 0 }); // private video: excluded

  const { clips } = routes["GET /api/clips"]({ user: u, query: {} });
  assert.equal(clips.length, 1, "only the public post with a video is a clip");
  assert.deepEqual(clips[0].clips, [V], "clips array is just the video urls, images stripped");
  assert.equal(clips[0].artist, "Turnstile");
});

test("clips reel paginates newest-first with a stable cursor", () => {
  const u = addUser("clipper2");
  for (let i = 0; i < 3; i++) {
    const p = post(u, { photos: [`https://cdn.example/users/clipper2/post/${i}.mp4`], artist: `Band ${i}` });
    // The route stamps created_at = now(), which ties across this fast loop and
    // left "newest first" resolving on the random uid tie-break. Give each post a
    // distinct, increasing timestamp (and newer than any earlier test's post) so
    // the ordering assertion is deterministic.
    db.prepare("UPDATE posts SET created_at=? WHERE id=?").run(2_000_000_000_000 + i, p.id);
  }

  const first = routes["GET /api/clips"]({ user: u, query: { limit: "2" } });
  assert.equal(first.clips.length, 2);
  assert.ok(first.nextCursor, "a full page returns a cursor");
  // Newest first.
  assert.equal(first.clips[0].artist, "Band 2");

  const second = routes["GET /api/clips"]({ user: u, query: { limit: "2", before: first.nextCursor } });
  const ids = new Set(first.clips.map((c) => c.id));
  assert.ok(second.clips.every((c) => !ids.has(c.id)), "the next page never repeats the first");
});

test("stable extensionless clips keep their durable poster in the reel", () => {
  const user = addUser("clipper_stable");
  const now = 2_100_000_000_000;
  const postId = "p_stable_extensionless_clip";
  const assetId = "ma_stable_extensionless_clip";
  const variantId = "mv_stable_extensionless_clip";
  const clipUrl = "https://media.example/delivery/opaque-clip-token";
  const posterUrl = "https://media.example/delivery/opaque-poster-token";
  const sourceKey = "users/clipper_stable/post/source.mp4";
  const posterKey = "users/clipper_stable/post/poster.jpg";

  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,city,date,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    postId, user.id, "Opaque CDN", "History", "Toronto", "2026-08-21", 5, "Extensionless delivery", JSON.stringify([clipUrl]), 1, now,
  );
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?,?,?,'associated',?,?,?)`).run(sourceKey, user.id, "post", 1_000_000, now, now, now);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?,?,?,'associated',?,?,?)`).run(posterKey, user.id, "post", 50_000, now, now, now);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,original_name,mime_type,byte_size,
     width,height,duration_ms,metadata_status,codec_status,codec_verified_at,status,edit_recipe,finalize_hash,source_verified_at,
     render_state,poster_variant_id,poster_key,poster_url,poster_time_ms,created_at,updated_at)
    VALUES (?,?,?,?,?,'video',?,?,?,?,?,?,?,?,'declared','verified',?,'ready','{}',?,?,
      'not_required',?,?,?,?,?,?)`).run(
    assetId, user.id, "client-stable-extensionless", "hash", "post", sourceKey, clipUrl, "clip.mp4", "video/mp4", 1_000_000,
    1080, 1920, 15_000, now, "finalize-hash", now, variantId, posterKey, posterUrl, 2_400, now, now,
  );
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,time_ms,status,finalize_hash,verified_at,created_at,updated_at)
    VALUES (?,?,?,?,'poster',?,?,?,?,?,?,?,'verified',?,?,?,?)`).run(
    variantId, assetId, "client-stable-poster", "poster-hash", posterKey, posterUrl, "image/jpeg", 50_000, 720, 1280, 2_400,
    "poster-finalize-hash", now, now, now,
  );
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)").run(postId, assetId, now);

  const result = routes["GET /api/clips"]({ user, query: { limit: "30" } });
  const clip = result.clips.find((entry) => entry.id === postId);
  assert.ok(clip, "descriptor kind includes a stable video even when its delivery URL has no extension");
  assert.deepEqual(clip.clips, [clipUrl]);
  assert.equal(clip.media[0].kind, "video");
  assert.equal(clip.media[0].posterUrl, posterUrl);
  assert.equal(clip.media[0].posterTimeMs, 2_400);
});

test("false-positive photo URLs cannot consume a clips page before a real video", () => {
  const user = addUser("clipper_page_filter");
  const base = 2_200_000_000_000;
  const real = post(user, {
    photos: ["https://cdn.example/users/clipper_page_filter/post/real.mp4"],
    artist: "Real clip below bait",
  });
  db.prepare("UPDATE posts SET created_at=? WHERE id=?").run(base, real.id);

  for (let i = 1; i <= 13; i++) {
    const bait = post(user, {
      photos: [`https://cdn.example/users/clipper_page_filter/post/photo.jpg?campaign=.mp4-bait-${i}`],
      artist: `Photo bait ${i}`,
    });
    db.prepare("UPDATE posts SET created_at=? WHERE id=?").run(base + i, bait.id);
  }

  const result = routes["GET /api/clips"]({ user, query: { limit: "12" } });
  assert.ok(result.clips.length > 0, "the endpoint scans past a full raw page of false positives");
  assert.equal(result.clips[0].id, real.id, "the first authoritative clip is not hidden below bait rows");
  assert.ok(result.clips.every((clip) => !clip.artist.startsWith("Photo bait")), "photo bait never enters the reel");
});
