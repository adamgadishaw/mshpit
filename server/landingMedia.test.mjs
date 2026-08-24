import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import sharp from "sharp";

const dataDir = mkdtempSync(join(tmpdir(), "pit-landing-media-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.MEDIA_PUBLIC_BASE_URL = "https://media.example.com/assets";
process.env.MEDIA_ENDPOINT = "https://storage.example.com";
process.env.MEDIA_BUCKET = "pit-media";
process.env.MEDIA_SOURCE_BUCKET = "pit-media-private";
process.env.MEDIA_REGION = "auto";
process.env.MEDIA_ACCESS_KEY_ID = "test-access";
process.env.MEDIA_SECRET_ACCESS_KEY = "test-secret";

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const { routes } = await import("./api.js");
const { hasTrustedLandingImage, projectLandingMedia, trustedLandingImageUrl } = await import("./landingMedia.js");
const { createMediaAsset, createMediaVariant, finalizeMediaAsset, finalizeMediaVariant } = await import("./mediaAssets.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, { verified = true } = {}) {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  if (verified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

function image(authorId, name = "show.jpg") {
  return `https://media.example.com/assets/users/${authorId}/post/${name}`;
}

function insertPost(id, authorId, overrides = {}) {
  const row = {
    artist: "J. Cole",
    venue: "Scotiabank Arena",
    photos: JSON.stringify([image(authorId, `${id}.jpg`)]),
    photosPublic: 1,
    landingShowcase: 1,
    kind: "review",
    removed: 0,
    createdAt: Date.now(),
    ...overrides,
  };
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,photos,photos_public,landing_showcase,kind,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, authorId, row.artist, row.venue, 4.5, row.photos,
    row.photosPublic, row.landingShowcase, row.kind, row.removed, row.createdAt,
  );
}

let stableImageSequence = 0;
function verifiedImageStorage(sourceBytes, contentType) {
  const sourceEtag = `"source-${sourceBytes.length}"`;
  const deliveryEtag = `"delivery-${sourceBytes.length}"`;
  let delivery = null;
  return async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const publicDelivery = new URL(url).pathname.includes("/pit-media/users/");
    if (method === "PUT") {
      if (!publicDelivery) return { status: 405, headers: new Headers() };
      if (delivery) return { status: 412, headers: new Headers() };
      delivery = Buffer.from(options.body || []);
      return { status: 200, headers: new Headers({ etag: deliveryEtag }) };
    }
    const selected = publicDelivery ? delivery : sourceBytes;
    if (!selected) return { status: 404, headers: new Headers() };
    const etag = publicDelivery ? deliveryEtag : sourceEtag;
    const headers = new Headers({
      "content-length": String(selected.length),
      "content-type": contentType,
      etag,
    });
    if (method === "HEAD") return { status: 200, headers };
    if (method !== "GET") return { status: 405, headers: new Headers() };
    if (new Headers(options.headers || {}).get("if-match") !== etag) {
      return { status: 412, headers: new Headers() };
    }
    return new Response(selected, { status: 200, headers });
  };
}

async function stablePostImage(owner) {
  const sequence = String(++stableImageSequence).padStart(4, "0");
  const sourceBytes = await sharp({
    create: { width: 120, height: 150, channels: 3, background: "#901040" },
  }).jpeg().toBuffer();
  const renderBytes = await sharp({
    create: { width: 108, height: 135, channels: 3, background: "#c02070" },
  }).webp().toBuffer();
  const source = createMediaAsset(db, {
    ownerId: owner.id,
    body: {
      clientAssetId: `landing-source-${sequence}`,
      purpose: "post",
      contentType: "image/jpeg",
      fileSize: sourceBytes.length,
      name: `landing-${sequence}.jpg`,
    },
    assetId: `ma_landingasset${sequence}xxxxxxxx`,
  });
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: source.asset.id,
    body: { width: 120, height: 150, editRecipe: {} },
    fetchImpl: verifiedImageStorage(sourceBytes, "image/jpeg"),
  });
  const render = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: source.asset.id,
    body: {
      clientVariantId: `landing-render-${sequence}`,
      role: "render",
      contentType: "image/webp",
      fileSize: renderBytes.length,
      name: `landing-${sequence}.webp`,
    },
    variantId: `mv_landingrender${sequence}xxxxxx`,
  });
  const finalized = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: source.asset.id,
    variantId: render.variant.id,
    body: { width: 108, height: 135 },
    fetchImpl: verifiedImageStorage(renderBytes, "image/webp"),
  });
  return { assetId: source.asset.id, url: finalized.variant.url };
}

test("landing image URLs are HTTPS, browser-compatible, PIT-owned author media", () => {
  const options = { authorId: "u_one", mediaBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL };
  assert.equal(trustedLandingImageUrl(image("u_one", "night.webp?width=1600"), options), image("u_one", "night.webp?width=1600"));
  assert.equal(trustedLandingImageUrl("https://tracker.example/night.jpg", options), null);
  assert.equal(trustedLandingImageUrl(image("u_other", "night.jpg"), options), null);
  assert.equal(trustedLandingImageUrl("http://media.example.com/assets/users/u_one/post/night.jpg", options), null);
  assert.equal(trustedLandingImageUrl(image("u_one", "night.mp4"), options), null);
  assert.equal(trustedLandingImageUrl(image("u_one", "night.heic"), options), null);
  assert.equal(trustedLandingImageUrl(image("u_one", "night.gif"), options), null);
  assert.equal(trustedLandingImageUrl(image("u_one", "extensionless"), options), null);
  assert.equal(hasTrustedLandingImage([image("u_one", "night.mp4"), image("u_one", "night.png")], options), true);
  assert.equal(hasTrustedLandingImage(["https://tracker.example/night.jpg", image("u_one", "night.heic")], options), false);
});

test("landing projection is bounded, one-frame-per-post, and author-diverse", () => {
  const rows = [
    { id: "a1", user_id: "u_a", u_handle: "alpha", photos: JSON.stringify([image("u_a", "a1.jpg"), image("u_a", "a1b.jpg")]) },
    { id: "a2", user_id: "u_a", u_handle: "alpha", photos: JSON.stringify([image("u_a", "a2.png")]) },
    { id: "a3", user_id: "u_a", u_handle: "alpha", photos: JSON.stringify([image("u_a", "a3.webp")]) },
    { id: "b1", user_id: "u_b", u_name: "Beta Fan", photos: JSON.stringify([image("u_b", "b1.jpg")]) },
  ];
  const media = projectLandingMedia(rows, { limit: 12, mediaBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL });
  assert.deepEqual(media.map((item) => item.postId), ["a1", "b1"]);
  assert.equal(media[0].credit, "Shared by @alpha");
  assert.equal(media[1].credit, "Shared by Beta Fan");
  assert.ok(media.every((item) => !Object.hasOwn(item, "userId") && !Object.hasOwn(item, "review") && !Object.hasOwn(item, "city")));
});

test("landing route excludes private, removed, status, restricted, and blocked media", () => {
  const viewer = addUser("u_viewer");
  const visible = addUser("u_visible");
  const blockedByViewer = addUser("u_blocked_out");
  const blocksViewer = addUser("u_blocked_in");
  const banned = addUser("u_banned");
  const suspended = addUser("u_suspended");
  const unverified = addUser("u_unverified", { verified: false });

  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, suspended.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(viewer.id, blockedByViewer.id, Date.now());
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(blocksViewer.id, viewer.id, Date.now());

  insertPost("landing_visible", visible.id);
  insertPost("landing_private", visible.id, { photosPublic: 0 });
  insertPost("landing_no_showcase", visible.id, { landingShowcase: 0 });
  insertPost("landing_removed", visible.id, { removed: 1 });
  insertPost("landing_status", visible.id, { kind: "status" });
  insertPost("landing_video", visible.id, { photos: JSON.stringify([image(visible.id, "clip.mp4")]) });
  insertPost("landing_untrusted", visible.id, { photos: JSON.stringify(["https://tracker.example/hero.jpg"]) });
  insertPost("landing_blocked_out", blockedByViewer.id);
  insertPost("landing_blocked_in", blocksViewer.id);
  insertPost("landing_banned", banned.id);
  insertPost("landing_suspended", suspended.id);
  insertPost("landing_unverified", unverified.id);
  insertPost("landing_reported", visible.id, { createdAt: Date.now() + 1 });
  db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,status,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("report_landing", "post", "landing_reported", "unsafe", viewer.id, "open", Date.now());

  const headers = new Map();
  const result = routes["GET /api/landing/media"]({
    user: viewer,
    query: { limit: "99" },
    setHeader: (name, value) => headers.set(name, value),
  });

  assert.deepEqual(result.media.map((item) => item.postId), ["landing_visible"]);
  assert.equal(result.source, "community");
  assert.equal(typeof result.totals.artists, "number");
  assert.equal(Object.hasOwn(result.totals, "members"), false);
  assert.equal(headers.get("Cache-Control"), "private, max-age=60");
  assert.ok(result.media.length <= 12);
  assert.deepEqual(Object.keys(result.media[0]).sort(), ["artist", "credit", "id", "postId", "uri", "venue"]);
});

test("per-author candidate ranking prevents a 96-post flood from hiding other authors", () => {
  const flood = addUser("u_landing_flood");
  const other = addUser("u_landing_other");
  const base = Date.now() + 1_000_000;
  for (let index = 0; index < 105; index += 1) {
    insertPost(`landing_flood_${index}`, flood.id, { createdAt: base + index });
  }
  insertPost("landing_other_author", other.id, { createdAt: base - 1 });

  const result = routes["GET /api/landing/media"]({
    user: null,
    query: { limit: "12" },
    setHeader: () => {},
  });
  const postIds = result.media.map((item) => item.postId);
  assert.equal(postIds.filter((id) => id.startsWith("landing_flood_")).length, 1);
  assert.ok(postIds.includes("landing_other_author"));
});

test("homepage consent is default-off, owner-only, idempotent, and privacy-normalized on edit", async () => {
  const owner = addUser("u_consent_owner");
  const viewer = addUser("u_consent_viewer");
  const firstMedia = await stablePostImage(owner);
  const replacementMedia = await stablePostImage(owner);
  const body = {
    clientMutationId: "landing-consent-retry-001",
    artist: "J. Cole",
    artistKey: null,
    venue: "Scotiabank Arena",
    city: "Toronto",
    date: "2026-08-13",
    overall: 5,
    mediaAssetIds: [firstMedia.assetId],
    photosPublic: true,
    landingShowcase: true,
  };
  const create = routes["POST /api/posts"];
  const first = create({ user: owner, ip: "landing-consent", body });
  assert.equal(first.post.photosPublic, true);
  assert.equal(first.post.landingShowcase, true);
  assert.equal(db.prepare("SELECT landing_showcase FROM posts WHERE id=?").get(first.id).landing_showcase, 1);

  assert.deepEqual(first.post.photos, [firstMedia.url]);
  assert.throws(
    () => create({
      user: owner,
      ip: "landing-consent-untrusted",
      body: {
        clientMutationId: "landing-consent-untrusted-001",
        artist: body.artist,
        venue: body.venue,
        overall: body.overall,
        photos: ["https://tracker.example/forged.jpg"],
        photosPublic: true,
        landingShowcase: true,
      },
    }),
    (error) => error?.status === 400,
  );

  const duplicate = create({ user: owner, ip: "landing-consent", body });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.duplicate, true);
  assert.throws(
    () => create({ user: owner, ip: "landing-consent", body: { ...body, landingShowcase: false } }),
    (error) => error?.code === "POST_MUTATION_CONFLICT",
  );

  const publicRead = routes["GET /api/posts/:id"]({ user: viewer, params: { id: first.id } });
  assert.equal(Object.hasOwn(publicRead.post, "landingShowcase"), false);

  const edit = routes["PATCH /api/posts/:id"];
  const privateEdit = edit({
    user: owner,
    ip: "landing-consent-edit",
    params: { id: first.id },
    body: { photosPublic: false, version: first.post.version },
  });
  assert.equal(privateEdit.post.photosPublic, false);
  assert.equal(privateEdit.post.landingShowcase, false);

  const featureEdit = edit({
    user: owner,
    ip: "landing-consent-edit",
    params: { id: first.id },
    body: { landingShowcase: true, version: privateEdit.post.version },
  });
  assert.equal(featureEdit.post.photosPublic, true);
  assert.equal(featureEdit.post.landingShowcase, true);

  assert.throws(
    () => edit({
      user: owner,
      ip: "landing-consent-edit",
      params: { id: first.id },
      body: {
        photos: ["https://tracker.example/forged-edit.jpg"],
        landingShowcase: true,
        version: featureEdit.post.version,
      },
    }),
    (error) => error?.status === 400,
  );

  const restoredEdit = edit({
    user: owner,
    ip: "landing-consent-edit",
    params: { id: first.id },
    body: {
      mediaAssetIds: [replacementMedia.assetId],
      landingShowcase: true,
      version: featureEdit.post.version,
    },
  });
  assert.equal(restoredEdit.post.photosPublic, true);
  assert.equal(restoredEdit.post.landingShowcase, true);

  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword("landing-export-password1"), owner.id);
  const exported = routes["POST /api/me/export"]({ user: q.userById.get(owner.id), ip: "landing-consent-export", body: { password: "landing-export-password1" } });
  const exportedPost = exported.posts.find((post) => post.id === first.id);
  assert.equal(exportedPost.photosPublic, true);
  assert.equal(exportedPost.landingShowcase, true);
});
