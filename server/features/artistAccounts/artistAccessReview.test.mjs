import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-access-review-"));
process.env.PIT_DATA_DIR = directory;
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Artist access review must not call an external provider"); };
const { db, q } = await import("../../db.js");
const { routes } = await import("../../api.js");
const { createPublicDocumentRepository } = await import("../seo/publicDocumentRepository.js");
const { createPublicDocumentService } = await import("../seo/publicDocuments.js");
const { unreferencedOwnedMediaUrls, enqueueOwnedMediaKeys, runMediaDeletionBatch, enqueueExpiredMediaTickets } = await import("../../mediaDeletion.js");
const { cancelMediaAsset, deleteMediaAssets } = await import("../../mediaAssets.js");
const { applyModerationAction } = await import("../../moderation.js");
after(() => { globalThis.fetch = realFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
function account(role = "artist", name = null) {
  const id = `access_review_${++sequence}`, at = Date.now();
  q.insertUser.run(id, `${id}@example.test`, `Review ${role}`, id, "synthetic-hash", role, "Toronto", null, null, "AR", "#123456", at);
  db.prepare("UPDATE users SET artist_name=?,verified=1,email_verified_at=? WHERE id=?").run(name, at, id);
  return q.userById.get(id);
}
function page(name, owner = null) {
  const key = name.toLowerCase(), at = Date.now();
  db.prepare("INSERT INTO artists(norm,name,public_slug,source,created_at,updated_at) VALUES (?,?,?,'musicbrainz',?,?)")
    .run(key, name, key.replaceAll(" ", "-"), at, at);
  if (owner) db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,bio,feed_enabled,updated_at) VALUES (?,?,?,1,?)").run(key, owner.id, "Owner biography", at);
  return key;
}
const context = (user, body = {}, extra = {}) => ({ user, body, params: {}, query: {}, ip: user?.id || "guest", ...extra });
const search = (admin, query) => routes["GET /api/admin/artist-access"](context(admin, {}, { query: { q: query } }));
const assignment = key => db.prepare("SELECT owner_id,updated_at FROM artist_profiles WHERE artist_key=?").get(key);
const command = (admin, key, body, extra = {}) => routes["POST /api/admin/artists/:key/revoke-access"](context(admin, body, { params: { key: encodeURIComponent(key) }, ...extra }));
const reviewed = key => { const row = assignment(key); const admin = db.prepare("SELECT * FROM users WHERE role='admin' LIMIT 1").get();
  const preview = routes["GET /api/admin/artists/:key/access-preview"](context(admin, {}, { params: { key: encodeURIComponent(key) } }));
  return { confirmed: true, expectedOwnerId: row.owner_id, expectedUpdatedAt: row.updated_at, expectedContentHash: preview.contentHash, disposition: "hide", reason: "Reviewed this mistaken artist page assignment." }; };
const fails = (run, status) => assert.throws(run, error => error.status === status);

test("admin review distinguishes assigned, unassigned and role-mismatched pages without private credentials", () => {
  const admin = account("admin"), owner = account("artist", "Review Assigned");
  const assigned = page("Review Assigned", owner), unassigned = page("Review Unassigned"), staff = page("Review Staff", admin);
  const headers = {};
  const result = routes["GET /api/admin/artist-access"](context(admin, {}, { query: { q: "Review " }, setHeader: (name, value) => { headers[name] = value; } }));
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(result.artists.find(row => row.key === assigned).owner.matchesArtist, true);
  assert.equal(result.artists.find(row => row.key === unassigned).ownerId, null);
  assert.equal(result.artists.find(row => row.key === staff).owner.matchesArtist, false);
  for (const row of result.artists) assert.ok(!JSON.stringify(row).includes("@example.test") && !JSON.stringify(row).includes("synthetic-hash"));
  fails(() => search(null, "Review"), 401);
  for (const role of ["fan", "artist", "moderator", "editor"]) fails(() => search(account(role), "Review"), 403);
  for (const query of ["", "x", "x".repeat(81), {}]) fails(() => search(admin, query), 400);
  assert.equal(search(admin, "Nothing matches this fixture").artists.length, 0);
});

test("confirmation and current owner/revision are required; changed assignments remain untouched", () => {
  const admin = account("admin"), owner = account("artist", "Guarded Access"), key = page("Guarded Access", owner);
  const body = reviewed(key);
  for (const invalid of [{ ...body, confirmed: false }, { ...body, expectedOwnerId: null }, { ...body, expectedUpdatedAt: undefined }, { ...body, reason: "short" }]) fails(() => command(admin, key, invalid), 400);
  for (const role of ["fan", "artist", "moderator", "editor"]) fails(() => command(account(role), key, body), 403);
  db.prepare("UPDATE artist_profiles SET updated_at=updated_at+1 WHERE artist_key=?").run(key);
  fails(() => command(admin, key, body), 409);
  const newer = reviewed(key), replacement = account("artist", "Guarded Access");
  db.prepare("UPDATE artist_profiles SET owner_id=? WHERE artist_key=?").run(replacement.id, key);
  fails(() => command(admin, key, newer), 409);
  assert.equal(assignment(key).owner_id, replacement.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE target_id=?").get(key).n, 0);
});

test("revoke access audits the reason and blocks subsequent owner edits, posts and legacy reclaim", () => {
  const admin = account("admin"), owner = account("artist", "Access Withdrawn"), key = page("Access Withdrawn", owner), at = Date.now();
  const other = account("artist", "Other Access"), otherKey = page("Other Access", other);
  q.insertSession.run("access-owner-session", owner.id, at, at + 60_000, "", "");
  q.insertSession.run("access-other-session", other.id, at, at + 60_000, "", "");
  for (const status of ["pending", "approved"]) db.prepare("INSERT INTO artist_requests(id,user_id,artist_name,status,created_at) VALUES (?,?,?,?,?)").run(`access-${status}`, owner.id, "Access Withdrawn", status, at);
  db.prepare(`INSERT INTO artist_verification_challenges(id,user_id,artist_key,artist_name,instagram_handle,code,created_at,expires_at,status)
    VALUES ('access-proof',?,?,'Access Withdrawn','fixture','FIXTURE',?,?,'submitted')`).run(owner.id, key, at, at + 60_000);
  const body = reviewed(key);
  assert.equal(command(admin, key, body).ok, true);
  assert.equal(assignment(key).owner_id, null);
  assert.equal(q.userById.get(owner.id).role, "fan");
  assert.equal(q.userById.get(owner.id).verified, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(owner.id).n, 1, "ordinary signed-in membership remains valid");
  assert.equal(db.prepare("SELECT status FROM artist_requests WHERE id='access-pending'").get().status, "rejected");
  assert.equal(db.prepare("SELECT status FROM artist_requests WHERE id='access-approved'").get().status, "approved", "past approval remains historical evidence, not current permission");
  assert.equal(db.prepare("SELECT status FROM artist_verification_challenges WHERE id='access-proof'").get().status, "revoked");
  // Stale pre-revocation actor objects cannot restore ownership either.
  const edit = (actor, target) => routes["PATCH /api/artists/:key/profile"](context(actor, { bio: "Fresh edited biography." }, { params: { key: target } }));
  fails(() => edit(owner, key), 403);
  fails(() => edit(q.userById.get(owner.id), key), 403);
  fails(() => routes["POST /api/artists/:key/posts"](context(owner, { text: "Attempted artist update" }, { params: { key } })), 403);
  assert.equal(routes["GET /api/artist-account"](context(owner)).profile, null);
  const audit = db.prepare("SELECT actor_id,reason,prior_state,next_state FROM moderation_actions WHERE action='artist_access_revoked' AND target_id=?").get(key);
  assert.equal(audit.actor_id, admin.id); assert.equal(audit.reason, body.reason);
  assert.equal(JSON.parse(audit.prior_state).ownerId, owner.id); assert.equal(JSON.parse(audit.next_state).ownerId, null);
  assert.equal(q.userById.get(other.id).role, "artist"); assert.equal(assignment(otherKey).owner_id, other.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(other.id).n, 1);
  edit(other, otherKey);
  assert.equal(db.prepare("SELECT bio FROM artist_profiles WHERE artist_key=?").get(otherKey).bio, "Fresh edited biography.");
});

test("staff roles and a different artist binding retain their existing permission model", () => {
  const admin = account("admin"), staffKey = page("Staff Assignment", admin);
  command(admin, staffKey, reviewed(staffKey)); assert.equal(q.userById.get(admin.id).role, "admin");
  const owner = account("artist", "Legitimate Access"), ownKey = page("Legitimate Access", owner), mistakenKey = page("Mismatched Access", owner);
  command(admin, mistakenKey, reviewed(mistakenKey));
  assert.equal(q.userById.get(owner.id).role, "artist"); assert.equal(q.userById.get(owner.id).artist_name, "Legitimate Access");
  assert.equal(assignment(ownKey).owner_id, owner.id);
  routes["PATCH /api/artists/:key/profile"](context(owner, { bio: "The legitimate page still works." }, { params: { key: ownKey } }));
});

test("revocation and its audit roll back together; a lost admin role cannot revoke", () => {
  const admin = account("admin"), owner = account("artist", "Review Rollback"), key = page("Review Rollback", owner), body = reviewed(key);
  db.exec("CREATE TRIGGER access_audit_failure BEFORE INSERT ON moderation_actions WHEN NEW.action='artist_access_revoked' BEGIN SELECT RAISE(ABORT,'synthetic access audit failure'); END");
  try { assert.throws(() => command(admin, key, body), /synthetic access audit failure/); }
  finally { db.exec("DROP TRIGGER access_audit_failure"); }
  assert.equal(assignment(key).owner_id, owner.id); assert.equal(q.userById.get(owner.id).role, "artist");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_access_revocations WHERE artist_key=?").get(key).n, 0);
  let checks = 0;
  fails(() => command(admin, key, body, { assertCurrentSession() {
    checks++; if (checks >= 2) db.prepare("UPDATE users SET role='fan' WHERE id=?").run(admin.id);
    return q.userById.get(admin.id);
  } }), 403);
  assert.equal(assignment(key).owner_id, owner.id);
});

test("attributed content survives while public API, feed, detail and SSR withhold only former-manager contributions", () => {
  const admin = account("admin"), owner = account("artist", "Retained Access"), another = account("fan"), key = page("Retained Access", owner), at = Date.now();
  const providerBio = "A saved provider biography describing the band's history, recording work and many international live concert tours for this public catalogue fixture.";
  db.prepare("UPDATE artists SET bio=?,photo='https://provider.example.test/photo.jpg',popularity=90 WHERE norm=?").run(providerBio, key);
  db.prepare("UPDATE artist_profiles SET avatar_uri='https://owned.example.test/private-avatar.jpg',avatar_owner_id=?,banner='https://staff.example.test/banner.jpg',banner_owner_id=? WHERE artist_key=?").run(owner.id, admin.id, key);
  for (const [id, author, text] of [["retained-artist-post", owner.id, "WITHHELD_ARTIST_UPDATE"], ["other-artist-post", another.id, "Other contributor's update remains."]]) {
    db.prepare("INSERT INTO artist_posts(id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, key, author, text, at);
  }
  const insertPost = (id, author, kind, text) => db.prepare("INSERT INTO posts(id,user_id,artist,artist_key,venue,overall,review,kind,photos,photos_public,created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?)")
    .run(id, author, "Retained Access", key, kind === "review" ? "Fixture Hall" : "", kind === "review" ? 4 : 0, text, kind, '["https://owned.example.test/retained-post.jpg"]', at);
  insertPost("retained-status", owner.id, "status", "WITHHELD_STATUS_BODY");
  insertPost("other-review", another.id, "review", "Another fan's long original concert review should remain visible on the public page.");
  insertPost("own-review", owner.id, "review", "The former manager's personal concert review is not an artist-management update.");
  const originalReview = reviewed(key), result = command(admin, key, originalReview);
  assert.equal(result.retainedContent, 2);
  assert.equal(db.prepare("SELECT text,user_id FROM artist_posts WHERE id='retained-artist-post'").get().text, "WITHHELD_ARTIST_UPDATE");
  assert.equal(db.prepare("SELECT review,photos FROM posts WHERE id='retained-status'").get().review, "WITHHELD_STATUS_BODY");
  assert.equal(db.prepare("SELECT banner FROM artist_profiles WHERE artist_key=?").get(key).banner, "https://staff.example.test/banner.jpg");
  assert.equal(db.prepare("SELECT removed FROM artist_posts WHERE id='other-artist-post'").get().removed, 0);
  for (const id of ["other-review", "own-review"]) assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get(id).removed, 0);
  const profile = routes["GET /api/artists/:key/profile"](context(null, {}, { params: { key } }));
  assert.equal(profile.profile.ownerId, null); assert.equal(profile.profile.bio, null); assert.equal(profile.profile.avatarUri, null);
  const viewer = account("fan"), feed = routes["GET /api/feed"](context(viewer, {}, { query: { limit: "100" } }));
  assert.ok(!JSON.stringify(feed).includes("WITHHELD_STATUS_BODY"));
  fails(() => routes["GET /api/posts/:id"](context(viewer, {}, { params: { id: "retained-status" } })), 404);
  const documents = createPublicDocumentRepository(db);
  assert.equal(documents.readPost({ id: "retained-status" }), null);
  const artist = documents.readArtist({ artistKey: key });
  assert.equal(artist.artist.bio, providerBio); assert.ok(artist.updates.some(row => row.id === "other-artist-post"));
  const service = createPublicDocumentService({ database: db, origin: "https://fixture.example.test" });
  const html = service.render(service.artistDocument({ artistKey: key, at }));
  assert.ok(!html.includes("WITHHELD_ARTIST_UPDATE") && !html.includes("WITHHELD_STATUS_BODY") && !html.includes("private-avatar.jpg"));
  assert.ok(html.includes("saved provider biography"));
  const headers = {};
  const retained = routes["GET /api/admin/artists/:key/retained-content"](context(admin, {}, { params: { key }, setHeader(name, value) { headers[name] = value; } }));
  assert.equal(headers["Cache-Control"], "private, no-store"); assert.equal(retained.snapshot.ownerId, owner.id);
  assert.equal(retained.snapshot.profile.bio, "Owner biography"); assert.equal(retained.snapshot.profile.avatarUri, "https://owned.example.test/private-avatar.jpg");
  assert.ok(retained.content.every(row => row.userId === owner.id));
  for (const role of ["fan", "artist", "moderator", "editor"]) fails(() => routes["GET /api/admin/artists/:key/retained-content"](context(account(role), {}, { params: { key } })), 403);
  fails(() => command(admin, key, originalReview), 409);
  const replacement = account("artist", "Retained Access");
  db.prepare("UPDATE artist_profiles SET owner_id=?,feed_enabled=1 WHERE artist_key=?").run(replacement.id, key);
  assert.ok(!JSON.stringify(routes["GET /api/artists/:key/profile"](context(viewer, {}, { params: { key } }))).includes("WITHHELD_ARTIST_UPDATE"));
  assert.throws(() => db.prepare("UPDATE posts SET removed=0 WHERE id='retained-status'").run(), /requires retained-content review/);
  assert.throws(() => db.prepare("UPDATE artist_posts SET removed=0 WHERE id='retained-artist-post'").run(), /requires retained-content review/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_access_revocations WHERE artist_key=?").get(key).n, 1);
});

test("artist-submitted dates remain withheld after reassignment; provider dates remain public facts", async () => {
  const admin = account("admin"), owner = account("artist", "Retained Dates"), key = page("Retained Dates", owner), at = Date.now();
  const date = new Date(at + 7 * 86400000).toISOString().slice(0, 10);
  for (const source of ["artist-submitted", "ticketmaster"]) db.prepare("INSERT INTO tour_dates(id,artist,artist_key,venue,place,date,source,owner_id,music_qualified,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?)")
    .run(`retained-date-${source}`, "Retained Dates", key, `Fixture Hall ${source}`, "Toronto, Canada", date, source, owner.id, at);
  command(admin, key, reviewed(key));
  const { artistAuthoredTourDateVisibleSql } = await import("../../artistAuthoredTourDateVisibility.js");
  const visible = () => db.prepare(`SELECT id FROM tour_dates td WHERE td.artist_key=? AND ${artistAuthoredTourDateVisibleSql("td")}`).all(key).map(row => row.id);
  assert.deepEqual(visible(), ["retained-date-ticketmaster"]);
  db.prepare("UPDATE users SET role='artist',artist_name='Retained Dates' WHERE id=?").run(owner.id);
  db.prepare("UPDATE artist_profiles SET owner_id=? WHERE artist_key=?").run(owner.id, key);
  assert.deepEqual(visible(), ["retained-date-ticketmaster"]);
  assert.equal(db.prepare("SELECT source FROM tour_dates WHERE id='retained-date-artist-submitted'").get().source, "artist-submitted");
});

test("retained artwork is protected from reference cleanup, orphan cleanup and deletion workers", async () => {
  const admin = account("admin"), owner = account("artist", "Retained Media"), key = page("Retained Media", owner), at = Date.now();
  const objectKey = `users/${owner.id}/avatar/retained.jpg`, url = `https://media.example.test/cdn/${objectKey}`;
  const env = { NODE_ENV: "test", MEDIA_ENDPOINT: "https://objects.example.test", MEDIA_BUCKET: "test-public", MEDIA_SOURCE_BUCKET: "test-private", MEDIA_REGION: "auto", MEDIA_ACCESS_KEY_ID: "fixture", MEDIA_SECRET_ACCESS_KEY: "fixture", MEDIA_PUBLIC_BASE_URL: "https://media.example.test/cdn" };
  const priorBase = process.env.MEDIA_PUBLIC_BASE_URL;process.env.MEDIA_PUBLIC_BASE_URL = env.MEDIA_PUBLIC_BASE_URL;
  try {
    db.prepare("UPDATE artist_profiles SET avatar_uri=?,avatar_owner_id=? WHERE artist_key=?").run(url, owner.id, key);
    db.prepare("INSERT INTO media_objects(object_key,owner_id,purpose,status,created_at,updated_at) VALUES (?,?,'avatar','issued',?,?)").run(objectKey, owner.id, at - 10 * 86400000, at - 10 * 86400000);
    command(admin, key, reviewed(key));
    assert.deepEqual(unreferencedOwnedMediaUrls(db, { ownerId: owner.id, urls: [url], env }), []);
    enqueueExpiredMediaTickets(db, { env, at });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM media_deletion_queue WHERE object_key=?").get(objectKey).n, 0);
    enqueueOwnedMediaKeys(db, { ownerId: owner.id, keys: [objectKey], at });
    let calls = 0;
    const result = await runMediaDeletionBatch({ database: db, env, clock: () => at, fetchImpl: async () => { calls++; throw new Error("Retained media must not reach storage deletion"); } });
    assert.equal(calls, 0); assert.equal(result.deleted, 0);
    assert.ok(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(objectKey));
    assert.equal(db.prepare("SELECT last_error_code FROM media_deletion_queue WHERE object_key=?").get(objectKey).last_error_code, "artist_review_retained");
  } finally { if (priorBase === undefined) delete process.env.MEDIA_PUBLIC_BASE_URL; else process.env.MEDIA_PUBLIC_BASE_URL = priorBase; }
});

test("retained asset descriptors resist owner cancellation and cleanup; account erasure cascades private retention", () => {
  const admin = account("admin"), owner = account("artist", "Retained Descriptor"), key = page("Retained Descriptor", owner), at = Date.now();
  const objectKey = `users/${owner.id}/post/retained-source.jpg`, url = `https://media.example.test/${objectKey}`, id = `ma_retained_${sequence}`;
  db.prepare("INSERT INTO media_objects(object_key,owner_id,purpose,status,created_at,updated_at) VALUES (?,?,'post','associated',?,?)").run(objectKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_assets(id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,original_name,mime_type,byte_size,created_at,updated_at)
    VALUES (?,?,?,'fixture','post','image',?,?,'retained.jpg','image/jpeg',100,?,?)`).run(id, owner.id, id, objectKey, url, at, at);
  db.prepare("UPDATE artist_profiles SET avatar_uri=?,avatar_owner_id=? WHERE artist_key=?").run(url, owner.id, key);
  command(admin, key, reviewed(key));
  fails(() => cancelMediaAsset(db, { ownerId: owner.id, assetId: id, at }), 409);
  assert.equal(deleteMediaAssets(db, [id]), 0);
  assert.ok(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(id));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media_deletion_queue WHERE object_key=?").get(objectKey).n, 0);
  db.prepare("DELETE FROM users WHERE id=?").run(owner.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_access_revocations WHERE artist_key=?").get(key).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_access_retained_media WHERE owner_id=?").get(owner.id).n, 0);
});

const retainedReview = (admin, key, id = "") => routes["GET /api/admin/artists/:key/retained-content"](context(admin, {}, { params: { key: encodeURIComponent(key) }, query: { revocationId: id } }));
const publicationBody = (review, items) => ({ confirmed: true, revocationId: review.snapshot.id,
  expectedCurrentOwnerId: review.currentOwnerId, expectedProfileUpdatedAt: review.profileUpdatedAt, items,
  reason: "Reviewed original contributions and confirmed their publication disposition." });
const publication = (admin, key, body) => routes["POST /api/admin/artists/:key/retained-content/publication"](context(admin, body, { params: { key: encodeURIComponent(key) } }));
function updatePost(key, owner, id, text, removed = 0) {
  db.prepare("INSERT INTO artist_posts(id,artist_key,user_id,text,removed,created_at) VALUES (?,?,?,?,?,?)").run(id, key, owner.id, text, removed, Date.now());
}

test("keep previously public content ends privileges while private content stays hidden and original authorship remains truthful", () => {
  const admin = account("admin"), owner = account("artist", "Kept Contributions"), key = page("Kept Contributions", owner);
  const biography = "A previously public biography contributed by the former manager, with enough context for this local artist page's public catalogue representation.";
  db.prepare("UPDATE artists SET source='artist-created' WHERE norm=?").run(key);
  db.prepare("UPDATE artist_profiles SET bio=? WHERE artist_key=?").run(biography, key);
  updatePost(key, owner, "kept-update", "Previously public original artist-page update.");
  updatePost(key, owner, "private-update", "Previously moderated private update.", 1);
  const body = { ...reviewed(key), disposition: "keep" };command(admin, key, body);
  assert.equal(q.userById.get(owner.id).role, "fan");assert.equal(assignment(key).owner_id, null);
  assert.equal(db.prepare("SELECT removed FROM artist_posts WHERE id='kept-update'").get().removed, 0);
  assert.equal(db.prepare("SELECT removed FROM artist_posts WHERE id='private-update'").get().removed, 1);
  const viewer = account("fan"), publicPage = routes["GET /api/artists/:key/profile"](context(viewer, {}, { params: { key } }));
  assert.equal(publicPage.profile.verified, false);assert.equal(publicPage.profile.bio, biography);
  assert.equal(publicPage.profile.bioContributor.id, owner.id);assert.equal(publicPage.posts[0].contributor.id, owner.id);
  const documents = createPublicDocumentService({ database: db, origin: "https://fixture.example.test" });
  const html = documents.render(documents.artistDocument({ artistKey: key }));
  assert.ok(html.includes(`Biography contributed by @${owner.handle}`));assert.ok(html.includes(`Contributed by @${owner.handle}`));
  assert.ok(html.includes("Contributor updates") && html.includes("Updates about Kept Contributions"));
  assert.ok(!html.includes("Official notes") && !html.includes("From Kept Contributions"));
  assert.ok(!html.includes("Previously moderated private update"));
  const review = retainedReview(admin, key), hidden = review.content.find(row => row.id === "private-update");
  fails(() => publication(admin, key, publicationBody(review, [{ type: hidden.type, id: hidden.id, revision: hidden.revision, publication: "public" }])), 409);
});

test("selected initial disposition and later confirmed changes preserve data without restoring management", () => {
  const admin = account("admin"), owner = account("artist", "Selective Contributions"), key = page("Selective Contributions", owner);
  updatePost(key, owner, "selected-a", "Keep this original update.");updatePost(key, owner, "selected-b", "Retain this other update privately.");
  command(admin, key, { ...reviewed(key), disposition: "selected", visibleItems: ["profile:bio", "artist_post:selected-a"] });
  assert.equal(db.prepare("SELECT removed FROM artist_posts WHERE id='selected-a'").get().removed, 0);
  assert.equal(db.prepare("SELECT removed FROM artist_posts WHERE id='selected-b'").get().removed, 1);
  let review = retainedReview(admin, key), item = review.content.find(row => row.id === "selected-b");
  const body = publicationBody(review, [{ type: item.type, id: item.id, revision: item.revision, publication: "public" }]);
  assert.equal(publication(admin, key, body).changed, 1);fails(() => publication(admin, key, body), 409);
  assert.equal(db.prepare("SELECT removed FROM artist_posts WHERE id='selected-b'").get().removed, 0);
  review = retainedReview(admin, key);item = review.content.find(row => row.id === "selected-a");
  publication(admin, key, publicationBody(review, [{ type: item.type, id: item.id, revision: item.revision, publication: "hidden" }]));
  assert.equal(db.prepare("SELECT text FROM artist_posts WHERE id='selected-a'").get().text, "Keep this original update.");
  assert.equal(q.userById.get(owner.id).role, "fan");assert.equal(assignment(key).owner_id, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_actions WHERE action='artist_access_publication' AND target_id=?").get(key).n, 2);
});

test("preview hashes fence content races and selected private content cannot be published by initial revocation", () => {
  const admin = account("admin"), owner = account("artist", "Preview Race"), key = page("Preview Race", owner);
  updatePost(key, owner, "race-item", "Original preview text.");const body = reviewed(key);
  db.prepare("UPDATE artist_posts SET text='Text changed after preview' WHERE id='race-item'").run();
  fails(() => command(admin, key, body), 409);assert.equal(assignment(key).owner_id, owner.id);
  updatePost(key, owner, "race-private", "Private content before any revocation.", 1);
  fails(() => command(admin, key, { ...reviewed(key), disposition: "selected", visibleItems: ["artist_post:race-private"] }), 409);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_access_revocations WHERE artist_key=?").get(key).n, 0);
});

test("publication batch failures and failed audit roll back revisions, fields and visibility together", () => {
  const admin = account("admin"), owner = account("artist", "Publication Rollback"), key = page("Publication Rollback", owner);
  updatePost(key, owner, "rollback-private", "Private before revocation.", 1);command(admin, key, reviewed(key));
  const review = retainedReview(admin, key), bio = review.profileItems[0], blocked = review.content[0];
  fails(() => publication(admin, key, publicationBody(review, [{ type: "profile", id: bio.id, revision: bio.revision, publication: "public" },
    { type: blocked.type, id: blocked.id, revision: blocked.revision, publication: "public" }])), 409);
  assert.equal(db.prepare("SELECT bio FROM artist_profiles WHERE artist_key=?").get(key).bio, null);
  assert.equal(db.prepare("SELECT revision FROM artist_access_profile_items WHERE revocation_id=? AND slot='bio'").get(review.snapshot.id).revision, 1);
  db.exec("CREATE TRIGGER publication_audit_failure BEFORE INSERT ON moderation_actions WHEN NEW.action='artist_access_publication' BEGIN SELECT RAISE(ABORT,'publication audit failure'); END");
  try { assert.throws(() => publication(admin, key, publicationBody(review, [{ type: "profile", id: bio.id, revision: bio.revision, publication: "public" }])), /publication audit failure/); }
  finally { db.exec("DROP TRIGGER publication_audit_failure"); }
  assert.equal(db.prepare("SELECT bio FROM artist_profiles WHERE artist_key=?").get(key).bio, null);
});

test("retained review cannot override independent moderation, privacy or another manager's contribution", () => {
  const admin = account("admin"), owner = account("artist", "Independent Holds"), key = page("Independent Holds", owner);
  updatePost(key, owner, "independent-post", "Content requiring independent moderation.");command(admin, key, reviewed(key));
  let review = retainedReview(admin, key), item = review.content[0];
  applyModerationAction(context(admin), { action: "remove", targetType: "artist_post", targetId: item.id, reason: "Independent content policy removal." });
  fails(() => publication(admin, key, publicationBody(review, [{ type: item.type, id: item.id, revision: item.revision, publication: "public" }])), 409);
  const bio = review.profileItems[0];db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  fails(() => publication(admin, key, publicationBody(review, [{ type: "profile", id: bio.id, revision: bio.revision, publication: "public" }])), 409);
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(owner.id);
  const newOwner = account("artist", "Independent Holds");db.prepare("UPDATE artist_profiles SET owner_id=?,bio='New manager biography',bio_author_id=?,updated_at=updated_at+1 WHERE artist_key=?").run(newOwner.id, newOwner.id, key);
  fails(() => publication(admin, key, publicationBody(review, [{ type: "profile", id: bio.id, revision: bio.revision, publication: "public" }])), 409);
  review = retainedReview(admin, key);
  fails(() => publication(admin, key, publicationBody(review, [{ type: "profile", id: bio.id, revision: bio.revision, publication: "public" }])), 409);
  assert.equal(db.prepare("SELECT bio FROM artist_profiles WHERE artist_key=?").get(key).bio, "New manager biography");
  for (const role of ["fan", "artist", "moderator", "editor"]) fails(() => publication(account(role), key, publicationBody(review, [{ type: "profile", id: bio.id, revision: bio.revision, publication: "hidden" }])), 403);
});

test("kept updates and dates remain public on a member-created page without an active manager", async () => {
  const admin = account("admin"), owner = account("artist", "Updates Only"), key = page("Updates Only", owner), at = Date.now();
  db.prepare("UPDATE artists SET source='artist-created' WHERE norm=?").run(key);db.prepare("UPDATE artist_profiles SET bio=NULL WHERE artist_key=?").run(key);
  updatePost(key, owner, "updates-only-public", "A public original update without a page biography.");
  db.prepare("INSERT INTO tour_dates(id,artist,artist_key,venue,place,date,source,owner_id,music_qualified,updated_at) VALUES ('kept-user-date','Updates Only',?,'Hall','Toronto, Canada','2027-05-01','artist-submitted',?,1,?)").run(key, owner.id, at);
  command(admin, key, { ...reviewed(key), disposition: "keep" });
  const viewer = account("fan"), result = routes["GET /api/artists/:key/profile"](context(viewer, {}, { params: { key } }));
  assert.equal(result.profile.ownerId, null);assert.ok(result.posts.some(row => row.id === "updates-only-public"));
  const { artistAuthoredTourDateVisibleSql } = await import("../../artistAuthoredTourDateVisibility.js");
  assert.ok(db.prepare(`SELECT 1 FROM tour_dates td WHERE td.id='kept-user-date' AND ${artistAuthoredTourDateVisibleSql('td')}`).get());
  assert.equal(q.userById.get(owner.id).role, "fan");
  fails(() => routes["POST /api/artists/:key/posts"](context(q.userById.get(owner.id), { text: "No writing access" }, { params: { key } })), 403);
});
