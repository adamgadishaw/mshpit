import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { fork } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createIsolatedSitemapBuilder, normalizedSitemapProcessInput, sitemapDocumentBytes, SITEMAP_PROCESS_LIMITS } from "./sitemapProcess.js";
import { openSitemapReadDatabase } from "./sitemapReadDatabase.js";

const env = { PUBLIC_ORIGIN: "https://www.example.com", MEDIA_PUBLIC_BASE_URL: "https://media.example/base" };
const now = 1_800_000_000_000, databasePath = join(tmpdir(), "sitemap-process-fixture.db");
function harness() {
  const child = new EventEmitter();
  child.pid = 1234;
  child.kills = [];
  child.kill = signal => { child.kills.push(signal); return true; };
  child.send = (input, callback) => { child.input = input; child.sendCallback = callback; };
  let options, fireTimer, forks = 0;
  const build = createIsolatedSitemapBuilder({ databasePath,
    forkImpl(path, args, nextOptions) {
      assert.match(path, /sitemapWorker\.js$/);
      assert.deepEqual(args, []);
      options = nextOptions;
      forks++;
      return child;
    },
    setTimer(callback, delay) { assert.equal(delay, 60_000); fireTimer = callback; return { unref() {} }; },
    clearTimer() {},
  });
  return { child, build, timeout: () => fireTimer(), get options() { return options; }, get forks() { return forks; } };
}
async function pendingUntilClose(promise) {
  let settled = false;
  void promise.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, "memory admission must remain held until the physical process closes");
}
function finish(child) {
  child.emit("message", { type: "document", path: "/sitemap.xml", xml: "<index/>" });
  child.emit("message", { type: "document", path: "/sitemaps/pages.xml", xml: "<urls/>" });
  child.emit("message", { type: "complete", generatedAt: now, paths: ["/sitemaps/pages.xml"], stats: { totalUrls: 1 } });
}

test("sitemap worker strips secrets and holds its result until process close", async () => {
  const state = harness();
  const result = state.build({ env: { ...env, DATABASE_PASSWORD: "never forward", MEDIA_SECRET_ACCESS_KEY: "private" }, now });
  assert.deepEqual(state.child.input, { databasePath, env, now });
  assert.equal(state.options.env.MEDIA_PUBLIC_BASE_URL, env.MEDIA_PUBLIC_BASE_URL);
  assert.equal(state.options.env.PUBLIC_ORIGIN, env.PUBLIC_ORIGIN);
  assert.deepEqual(state.options.execArgv, ["--max-old-space-size=384", "--max-semi-space-size=8"]);
  assert.equal(state.options.windowsHide, true);
  assert.deepEqual(state.options.stdio, ["ignore", "ignore", "ignore", "ipc"]);
  assert.deepEqual(Object.keys(state.options.env).filter(key => /KEY|TOKEN|PASSWORD|PIT_|NODE_OPTIONS/.test(key)), []);
  finish(state.child);
  assert.deepEqual(state.child.kills, ["SIGKILL"]);
  await pendingUntilClose(result);
  state.child.emit("close", 0);
  const snapshot = await result;
  assert.equal(snapshot.xmlFor("/sitemaps/pages.xml"), "<urls/>");
  assert.equal(snapshot.xmlFor("/not-a-shard"), null);
});

test("sitemap timeout, crash, invalid IPC and send failure retain admission until child closes", async () => {
  for (const kind of ["timeout", "crash", "protocol", "duplicate", "send", "error"]) {
    const state = harness();
    const result = state.build({ env, now });
    if (kind === "timeout") state.timeout();
    if (kind === "protocol") state.child.emit("message", { type: "complete", paths: [], generatedAt: now });
    if (kind === "duplicate") {
      state.child.emit("message", { type: "document", path: "/sitemap.xml", xml: "<index/>" });
      state.child.emit("message", { type: "document", path: "/sitemap.xml", xml: "<index/>" });
    }
    if (kind === "send") state.child.sendCallback(new Error("sensitive database path"));
    if (kind === "error") state.child.emit("error", new Error("sensitive process details"));
    await pendingUntilClose(result);
    state.child.emit("close", 1);
    await assert.rejects(result, error => {
      assert.doesNotMatch(error.message, /sensitive/);
      assert.equal(error.code, kind === "timeout" ? "sitemap_timeout" : ["protocol", "duplicate"].includes(kind) ? "sitemap_protocol" : "sitemap_unavailable");
      return true;
    });
  }
});

test("sitemap preemption cancels a completed-but-unclosed worker without releasing its lease early", async () => {
  const state = harness(), controller = new AbortController();
  const result = state.build({ env, now, signal: controller.signal });
  finish(state.child);
  const reason = new Error("yield to upload");
  controller.abort(reason);
  await pendingUntilClose(result);
  state.child.emit("close", null, "SIGKILL");
  await assert.rejects(result, error => error === reason);
  assert.deepEqual(state.child.kills, ["SIGKILL", "SIGKILL"]);
});

test("pre-aborted and malformed sitemap work never forks, output size is bounded", async () => {
  const state = harness(), controller = new AbortController();
  controller.abort();
  await assert.rejects(state.build({ env, now, signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(state.build({ env: { PUBLIC_ORIGIN: "https://user:password@example.com" }, now }), { code: "sitemap_protocol" });
  assert.throws(() => normalizedSitemapProcessInput({ databasePath: ":memory:", env, now }), { code: "sitemap_protocol" });
  assert.throws(() => sitemapDocumentBytes("/sitemaps/pages.xml", "x".repeat(SITEMAP_PROCESS_LIMITS.documentBytes + 1)),
    { code: "sitemap_resource_limit" });
  assert.equal(state.forks, 0);
});

test("multiple individually valid sitemap documents cannot exceed the cumulative IPC budget", async () => {
  const state = harness();
  const result = state.build({ env, now });
  const xml = "x".repeat(12 * 1024 * 1024);
  for (let index = 0; index < 8; index++) {
    state.child.emit("message", { type: "document", path: `/sitemaps/pages-${index + 1}.xml`, xml });
  }
  assert.deepEqual(state.child.kills, ["SIGKILL"]);
  await pendingUntilClose(result);
  state.child.emit("close", null, "SIGKILL");
  await assert.rejects(result, { code: "sitemap_resource_limit" });
});

test("real read-only sitemap worker preserves exact XML, runtime photo rights, and leaves the event loop available", { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-sitemap-worker-"));
  process.env.PIT_DATA_DIR = directory;
  const { db, q, DATABASE_PATH } = await import("../../db.js");
  const { createSitemapSnapshot } = await import("./sitemapService.js");
  const { ensureVenuePhotoEnrichmentSchema } = await import("../../venuePhotoEnrichment.js");
  const { createRuntimeVenuePhotoReader, runtimeVenuePhotoIdentity } = await import("../../runtimeVenuePhotoReader.js");
  const { registerRuntimeVenuePhotoReader } = await import("../../venuePhotoCatalog.js");
  let unregister;
  try {
    const ownerId = "u_sitemap_worker", postId = "p_sitemap_worker";
    q.insertUser.run(ownerId, "sitemap-worker@example.test", "Worker Member", "sitemapworker", "hash", "fan",
      null, null, null, "WM", "#123456", now);
    db.prepare(`INSERT INTO posts(id,user_id,artist,venue,city,date,overall,review,photos,photos_public,created_at,updated_at,kind)
      VALUES(?,?,'Worker Touring Artist','Worker Concert Hall','Toronto','2099-12-01',4,'','[]',1,?,?,'review')`)
      .run(postId, ownerId, now, now);
    const publicMediaUrls = [];
    for (const [position, kind] of ["image", "video"].entries()) {
      const assetId = "ma_worker_" + kind, extension = kind === "video" ? "mp4" : "jpg";
      const sourceKey = `users/${ownerId}/post/${assetId}-source.${extension}`;
      const renderKey = `users/${ownerId}/post/${assetId}-render.${extension}`;
      const posterKey = `users/${ownerId}/post/${assetId}-poster.jpg`;
      const renderId = "render-" + assetId, posterId = "poster-" + assetId;
      const addObject = (key, scope) => db.prepare(`INSERT INTO media_objects
        (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,associated_at,updated_at)
        VALUES(?,?,?,'post',100,'associated',?,?,?)`).run(key, ownerId, scope, now, now, now);
      addObject(sourceKey, "private"); addObject(renderKey, "public");
      if (kind === "video") addObject(posterKey, "public");
      db.prepare(`INSERT INTO media_assets
        (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
        original_name,mime_type,byte_size,width,height,duration_ms,metadata_status,codec_status,codec_verified_at,
        alt_text,status,edit_recipe,recipe_version,source_verified_at,render_state,render_variant_id,poster_variant_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        assetId, ownerId, "client-" + assetId, "create-" + assetId, "post", kind, sourceKey,
        "https://private.example/" + assetId, "private", assetId + "." + extension,
        kind === "video" ? "video/mp4" : "image/jpeg", 100, 1280, 720, kind === "video" ? 45000 : null,
        "declared", kind === "video" ? "verified" : "not_applicable", kind === "video" ? now : null,
        "A concert memory", "ready", kind === "video" ? '{"coverMs":1000}' : "{}", 1, now,
        "ready", renderId, kind === "video" ? posterId : null, now, now);
      const addVariant = (id, role, key, mime, time, origin) => {
        const url = env.MEDIA_PUBLIC_BASE_URL + "/" + key;
        publicMediaUrls.push(url);
        db.prepare(`INSERT INTO media_variants(id,asset_id,client_variant_id,create_hash,role,object_key,public_url,
          mime_type,byte_size,width,height,time_ms,status,verified_at,verification_origin,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,100,1280,720,?,'verified',?,?,?,?)`).run(
          id, assetId, "client-" + id, "create-" + id, role, key, url, mime, time, now, origin, now, now);
      };
      addVariant(renderId, "render", renderKey, kind === "video" ? "video/mp4" : "image/jpeg", null,
        kind === "video" ? "video_verifier_v1" : "private_derivative_v1");
      if (kind === "video") addVariant(posterId, "poster", posterKey, "image/jpeg", 1000, "private_derivative_v1");
      db.prepare("INSERT INTO post_media(post_id,asset_id,position,created_at) VALUES(?,?,?,?)").run(postId, assetId, position, now);
    }
    db.prepare(`INSERT INTO tour_dates(id,artist,venue,place,date,source,venue_provider_id,ticket_url,
      music_qualified,start_date_time,venue_address_line1,venue_city,venue_country_code,updated_at,release_at)
      VALUES ('worker-event','Worker Touring Artist','Worker Concert Hall','Toronto, Canada','2099-12-01',
      'ticketmaster','worker-venue','https://www.ticketmaster.com/event/worker-event',1,'2099-12-01T20:00:00Z',
      '1 Concert Way','Toronto','CA',?,0)`).run(now);
    ensureVenuePhotoEnrichmentSchema(db, { at: now });
    const digest = "a".repeat(64), objectKey = "venues/licensed/worker-room-12345678/" + digest.slice(0, 48) + ".webp";
    const sourceUri = "https://upload.wikimedia.org/example.jpg";
    const photo = { uri: env.MEDIA_PUBLIC_BASE_URL + "/" + objectKey, mirroredFrom: sourceUri,
      sourcePage: "https://commons.wikimedia.org/wiki/File:Fixture.jpg", creator: "Fixture Photographer",
      license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", source: "commons",
      modificationNotice: "Converted to WebP and resized when needed by MSHpit for delivery.",
      mirror: { objectKey, contentType: "image/webp", byteSize: 1024, sha256: digest, width: 1280, height: 800 } };
    db.prepare(`INSERT INTO venue_photo_enrichment(venue_key,identity,status,attempted_at,next_attempt_at,photo_json)
      VALUES(?,?,'filled',?,?,?)`).run("provider:ticketmaster:worker-venue",
      runtimeVenuePhotoIdentity({ name: "Worker Concert Hall", city: "Toronto", country: "CA" }), now, now + 1000, JSON.stringify(photo));
    unregister = registerRuntimeVenuePhotoReader(createRuntimeVenuePhotoReader(db, { env }));
    const expected = createSitemapSnapshot({ database: db, env, now });
    assert.ok(expected.xmlFor("/sitemaps/venues.xml").includes(photo.uri), "fixture must exercise runtime venue photography");
    for (const url of publicMediaUrls) assert.ok(expected.xmlFor("/sitemaps/posts.xml").includes(url),
      "fixture must exercise ready member image/video and verified video poster URLs");
    assert.ok(!expected.xmlFor("/sitemaps/posts.xml").includes("https://private.example"), "private sources stay private");
    let closed = false, ticks = 0;
    const build = createIsolatedSitemapBuilder({ databasePath: DATABASE_PATH, forkImpl(...args) {
      const child = fork(...args); child.once("close", () => { closed = true; }); return child;
    } });
    const timer = setInterval(() => { ticks++; }, 5);
    let actual;
    try { actual = await build({ env, now }); } finally { clearInterval(timer); }
    assert.equal(closed, true);
    assert.ok(ticks > 0, "parent timers continue while SQLite/JS sitemap work runs elsewhere");
    assert.deepEqual(actual.paths, expected.paths);
    assert.deepEqual(actual.stats, expected.stats);
    for (const path of ["/sitemap.xml", ...expected.paths]) assert.equal(actual.xmlFor(path), expected.xmlFor(path), path);
    const readonly = openSitemapReadDatabase(DATABASE_PATH);
    try { assert.throws(() => readonly.exec("CREATE TABLE forbidden_worker_write(id INTEGER)"), /readonly|read.only/i); }
    finally { readonly.close(); }
    const missing = join(directory, "missing.db");
    assert.throws(() => openSitemapReadDatabase(missing));
    assert.equal(existsSync(missing), false, "missing production database must never become a new empty database");
    db.prepare("UPDATE venue_photo_enrichment SET status='revoked',photo_json=NULL").run();
    const revoked = await build({ env, now });
    assert.ok(!revoked.xmlFor("/sitemaps/venues.xml").includes(photo.uri), "worker honours current photo rights tombstones");
  } finally { unregister?.(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});
