import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-moderation-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.MEDIA_PUBLIC_BASE_URL = "https://media.example/assets";

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", role, "Toronto", 43.65, -79.38, "TU", "#123456", Date.now());
  db.prepare("UPDATE users SET age_band='18_plus' WHERE id=?").run(id);
  return q.userById.get(id);
}

const admin = addUser("moderation_admin", "admin");
const moderator = addUser("moderation_mod", "moderator");
const fan = addUser("moderation_fan", "fan");
const author = addUser("moderation_author", "fan");
const mediaSeeder = addUser("moderation_media_seeder", "admin");

function insertPost(id, review = "reported review", removed = 0) {
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, author.id, "J. Cole", "Scotiabank Arena", 4.5, review, '["https://media.example/photo.jpg"]', removed, Date.now());
}

function insertReport(id, targetType, targetId, reason = "spam", reporterId = fan.id, status = "open", createdAt = Date.now()) {
  db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,status,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, targetType, targetId, reason, reporterId, status, createdAt);
}

const staffCtx = (user, extra = {}) => ({
  user,
  requestId: `request-${user.id}`,
  params: {},
  body: {},
  query: {},
  ...extra,
});

test("staff overview returns bounded summaries, camelCase queue rows, and privacy-safe content context", () => {
  insertPost("moderation_overview_post", "A public excerpt for the queue");
  insertReport("moderation_overview_report", "post", "moderation_overview_post", "harassment");
  db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("moderation_private_dm", author.id, fan.id, "private message must never leave the server", Date.now());
  db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("moderation_unreported_dm", author.id, admin.id, "UNRELATED_PRIVATE_DM_MUST_NOT_LEAK", Date.now());
  insertReport("moderation_private_report", "message", "moderation_private_dm", "abuse");
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("moderation_artist_post", "j. cole", author.id, "An exact artist update", Date.now());
  insertReport("moderation_artist_report", "artist_post", "moderation_artist_post", "harassment");

  const responseHeaders = {};
  const result = routes["GET /api/admin/moderation"](staffCtx(moderator, {
    setHeader: (name, value) => { responseHeaders[name] = value; },
  }));
  assert.equal(responseHeaders["Cache-Control"], "no-store");
  assert.equal(result.summary.open >= 2, true);
  assert.equal(result.summary.byType.post >= 1, true);
  assert.equal(result.summary.byType.message >= 1, true);
  assert.equal(result.summary.totalRecent >= 2, true);
  assert.equal(result.reports.length <= 50, true);
  const post = result.reports.find((report) => report.id === "moderation_overview_report");
  assert.deepEqual({
    targetType: post.targetType,
    targetId: post.targetId,
    reporterId: post.reporterId,
    status: post.status,
  }, {
    targetType: "post",
    targetId: "moderation_overview_post",
    reporterId: fan.id,
    status: "open",
  });
  assert.equal(post.target_type, undefined);
  assert.equal(post.content.excerpt, "A public excerpt for the queue");
  assert.equal(post.content.mediaCount, 1);
  assert.equal(post.content.author.handle, author.handle);
  assert.deepEqual({
    role: post.content.author.role,
    isBanned: post.content.author.isBanned,
    suspendedUntil: post.content.author.suspendedUntil,
  }, { role: "fan", isBanned: false, suspendedUntil: null });
  assert.equal(post.reporter.role, "fan");
  const message = result.reports.find((report) => report.id === "moderation_private_report");
  assert.equal(message.content.private, true);
  assert.equal(message.content.excerpt, "private message must never leave the server");
  assert.equal(message.content.author.id, author.id);
  assert.equal(message.content.recipient.id, fan.id);
  assert.equal(JSON.stringify(result).includes("UNRELATED_PRIVATE_DM_MUST_NOT_LEAK"), false, "unreported messages never enter the moderation snapshot");
  const artistPost = result.reports.find((report) => report.id === "moderation_artist_report");
  assert.equal(artistPost.content.type, "artist_post");
  assert.equal(artistPost.content.excerpt, "An exact artist update");
  assert.equal(artistPost.content.author.id, author.id);
  assert.equal(JSON.stringify(result).includes(`${author.id}@example.com`), false, "staff queue must not expose account emails");
});

test("reported media keeps a stable identity and only projects the exact canonical owned object", () => {
  const one = `https://media.example/assets/users/${author.id}/post/one.jpg`;
  const two = `https://media.example/assets/users/${author.id}/post/two.jpg`;
  const replacement = `https://media.example/assets/users/${author.id}/post/replacement.jpg`;
  const fingerprint = createHash("sha256").update(two, "utf8").digest("hex");
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    "moderation_exact_media_post", author.id, "J. Cole", "Scotiabank Arena", 4.5,
    "Exact attachment report", JSON.stringify([one, two]), Date.now(),
  );
  db.prepare(`INSERT INTO reports
    (id,target_type,target_id,reason,reporter_id,status,media_index,media_fingerprint,created_at)
    VALUES (?,?,?,?,?,'open',?,?,?)`).run(
    "moderation_exact_media_report", "post", "moderation_exact_media_post", "Unsafe image",
    fan.id, 2, fingerprint, Date.now(),
  );

  db.prepare("UPDATE posts SET photos=? WHERE id=?").run(JSON.stringify([two, one]), "moderation_exact_media_post");
  let report = routes["GET /api/admin/moderation"](staffCtx(moderator)).reports
    .find((row) => row.id === "moderation_exact_media_report");
  assert.equal(report.content.reportedMedia, two, "reordering cannot change the reported attachment identity");
  assert.equal(report.content.reportedMediaTrusted, true);
  assert.equal(JSON.stringify(report).includes(one), false, "unrelated attachments are never projected");

  db.prepare("UPDATE posts SET photos=? WHERE id=?").run(JSON.stringify([replacement]), "moderation_exact_media_post");
  report = routes["GET /api/admin/moderation"](staffCtx(moderator)).reports
    .find((row) => row.id === "moderation_exact_media_report");
  assert.equal(report.content.reportedMedia, undefined);
  assert.equal(report.content.reportedMediaUnavailable, true);
  assert.equal(JSON.stringify(report).includes(replacement), false, "replacement media at the old position is not substituted");
});

test("moderation never projects an attacker-controlled external reported-media URL", () => {
  const hostile = "https://attacker.example/moderator-tracker.gif";
  db.prepare("UPDATE users SET avatar_uri=? WHERE id IN (?,?,?)")
    .run(hostile, author.id, fan.id, moderator.id);
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    "moderation_external_media_post", author.id, "J. Cole", "Scotiabank Arena", 4,
    "External attachment", JSON.stringify([hostile]), Date.now(),
  );
  db.prepare(`INSERT INTO reports
    (id,target_type,target_id,reason,reporter_id,status,media_index,media_fingerprint,created_at)
    VALUES (?,?,?,?,?,'open',?,?,?)`).run(
    "moderation_external_media_report", "post", "moderation_external_media_post", "Unsafe image",
    fan.id, 1, createHash("sha256").update(hostile, "utf8").digest("hex"), Date.now(),
  );

  const report = routes["GET /api/admin/moderation"](staffCtx(moderator)).reports
    .find((row) => row.id === "moderation_external_media_report");
  assert.equal(report.content.reportedMedia, undefined);
  assert.equal(report.content.reportedMediaTrusted, undefined);
  assert.equal(report.content.reportedMediaUnavailable, true);
  assert.equal(JSON.stringify(report).includes("attacker.example"), false);
  assert.equal(report.content.author.avatarUri, null);
  assert.equal(report.reporter.avatarUri, null);

  routes["POST /api/admin/moderation/actions"](staffCtx(moderator, {
    body: { action: "dismiss", reportId: report.id, reason: "Regression coverage" },
  }));
  const refreshed = routes["GET /api/admin/moderation"](staffCtx(moderator));
  assert.equal(refreshed.recentActions[0].actor.avatarUri, null);
  assert.equal(JSON.stringify(refreshed.recentActions[0]).includes("attacker.example"), false);
});

test("artist profiles are actionable report targets with exact private-by-default media context", () => {
  const artistKey = "moderation artist";
  const banner = `https://media.example/assets/users/${author.id}/banner/artist-banner.jpg`;
  const avatar = `https://media.example/assets/users/${mediaSeeder.id}/avatar/artist-avatar.jpg`;
  db.prepare(`INSERT INTO artist_profiles
    (artist_key,owner_id,bio,banner,banner_owner_id,avatar_uri,avatar_owner_id,feed_enabled,removed,updated_at)
    VALUES (?,?,?,?,?,?,?,?,0,?)`).run(
    artistKey, author.id, "Official artist biography", banner, author.id, avatar, mediaSeeder.id, 1, Date.now(),
  );
  db.prepare(`INSERT INTO reports
    (id,target_type,target_id,reason,reporter_id,status,media_index,media_fingerprint,created_at)
    VALUES (?,?,?,?,?,'open',?,?,?)`).run(
    "moderation_artist_profile_report", "artist_profile", artistKey, "Unsafe profile image", fan.id,
    2, createHash("sha256").update(avatar, "utf8").digest("hex"), Date.now(),
  );

  const report = routes["GET /api/admin/moderation"](staffCtx(moderator)).reports
    .find((row) => row.id === "moderation_artist_profile_report");
  assert.equal(report.content.type, "artist_profile");
  assert.equal(report.content.author.id, author.id);
  assert.equal(report.content.excerpt, "Official artist biography");
  assert.equal(report.content.reportedMedia, avatar);
  assert.equal(report.content.reportedMediaTrusted, true);
  assert.equal(JSON.stringify(report).includes(banner), false, "the other profile attachment remains private from this report");

  const action = routes["POST /api/admin/moderation/actions"];
  const removed = action(staffCtx(moderator, { body: { action: "remove", reportId: report.id } }));
  assert.equal(removed.removed, true);
  assert.ok(db.prepare("SELECT 1 FROM media_deletion_queue WHERE owner_id=? AND object_key=?")
    .get(mediaSeeder.id, `users/${mediaSeeder.id}/avatar/artist-avatar.jpg`),
  "reported artist media is queued under its slot uploader, not the page claimant");
  assert.equal(routes["GET /api/artists/:key/profile"]({ params: { key: artistKey } }).profile, null);
  const restored = action(staffCtx(moderator, { body: {
    action: "restore", targetType: "artist_profile", targetId: artistKey, reason: "Appeal accepted",
  } }));
  assert.equal(restored.removed, false);
  assert.equal(routes["GET /api/artists/:key/profile"]({ params: { key: artistKey } }).profile.ownerId, author.id);
});

test("moderator removal permanently detaches media while retries stay idempotent and restore returns text only", () => {
  const urls = {
    post: `https://media.example/assets/users/${author.id}/post/moderation-irreversible-post.jpg`,
    venue: `https://media.example/assets/users/${author.id}/review/moderation-irreversible-venue.jpg`,
    banner: `https://media.example/assets/users/${author.id}/banner/moderation-irreversible-banner.jpg`,
    avatar: `https://media.example/assets/users/${mediaSeeder.id}/avatar/moderation-irreversible-avatar.jpg`,
    reattached: `https://media.example/assets/users/${author.id}/post/moderation-irreversible-reattached.jpg`,
    external: "https://attacker.example/not-owned.jpg",
  };
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,review,photos,photos_public,landing_showcase,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    "moderation_irreversible_post", author.id, "J. Cole", "Scotiabank Arena", 4,
    "Post text survives restore", JSON.stringify([urls.post, urls.external]), 1, 1, Date.now(),
  );
  db.prepare(`INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    "moderation_irreversible_venue", "scotiabank arena", author.id, 4,
    "Venue text survives restore", JSON.stringify([urls.venue]), Date.now(),
  );
  db.prepare(`INSERT INTO artist_profiles
    (artist_key,owner_id,bio,banner,banner_owner_id,avatar_uri,avatar_owner_id,feed_enabled,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "moderation irreversible artist", author.id, "Artist bio survives restore",
    urls.banner, author.id, urls.avatar, mediaSeeder.id, 1, Date.now(),
  );
  const insertReaction = db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)");
  for (const mediaUrl of Object.values(urls)) insertReaction.run(mediaUrl, fan.id, null, Date.now());
  const action = routes["POST /api/admin/moderation/actions"];
  const targets = [
    ["post", "moderation_irreversible_post"],
    ["venue_review", "moderation_irreversible_venue"],
    ["artist_profile", "moderation irreversible artist"],
  ];

  for (const [targetType, targetId] of targets) {
    const remove = action(staffCtx(moderator, { body: { action: "remove", targetType, targetId, reason: "unsafe attachment" } }));
    assert.equal(remove.removed, true);
    assert.equal(remove.changed, true);
    const queueCount = db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE owner_id=?").get(author.id).count;
    const removeAuditCount = db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_type=? AND target_id=? AND action='remove'")
      .get(targetType, targetId).count;

    const retry = action(staffCtx(moderator, { body: { action: "remove", targetType, targetId, reason: "lost response retry" } }));
    assert.equal(retry.duplicate, true);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE owner_id=?").get(author.id).count, queueCount);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_type=? AND target_id=? AND action='remove'")
      .get(targetType, targetId).count, removeAuditCount);

    if (targetType === "post") {
      // Even a legacy/raced attachment added while hidden cannot ride a text
      // restoration back into public view.
      db.prepare("UPDATE posts SET photos=?,photos_public=1,landing_showcase=1 WHERE id=?")
        .run(JSON.stringify([urls.reattached]), targetId);
    }

    const restore = action(staffCtx(moderator, { body: { action: "restore", targetType, targetId, reason: "text appeal accepted" } }));
    assert.equal(restore.removed, false);
    assert.equal(restore.changed, true);
  }

  assert.deepEqual(
    { ...db.prepare("SELECT removed,review,photos,photos_public,landing_showcase FROM posts WHERE id=?").get("moderation_irreversible_post") },
    { removed: 0, review: "Post text survives restore", photos: "[]", photos_public: 0, landing_showcase: 0 },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT removed,text,photos FROM venue_reviews WHERE id=?").get("moderation_irreversible_venue") },
    { removed: 0, text: "Venue text survives restore", photos: "[]" },
  );
  assert.deepEqual(
    { ...db.prepare("SELECT removed,bio,banner,avatar_uri FROM artist_profiles WHERE artist_key=?").get("moderation irreversible artist") },
    { removed: 0, bio: "Artist bio survives restore", banner: null, avatar_uri: null },
  );

  const queuedKeys = new Set(db.prepare("SELECT object_key FROM media_deletion_queue WHERE owner_id=?").all(author.id).map((row) => row.object_key));
  for (const key of [
    `users/${author.id}/post/moderation-irreversible-post.jpg`,
    `users/${author.id}/review/moderation-irreversible-venue.jpg`,
    `users/${author.id}/banner/moderation-irreversible-banner.jpg`,
    `users/${author.id}/post/moderation-irreversible-reattached.jpg`,
  ]) assert.equal(queuedKeys.has(key), true, `${key} was not durably queued`);
  const seededQueuedKeys = new Set(db.prepare("SELECT object_key FROM media_deletion_queue WHERE owner_id=?")
    .all(mediaSeeder.id).map((row) => row.object_key));
  assert.equal(seededQueuedKeys.has(
    `users/${mediaSeeder.id}/avatar/moderation-irreversible-avatar.jpg`,
  ), true, "mixed-owner artist avatar was not queued under its actual uploader");
  assert.equal(JSON.stringify([...queuedKeys]).includes("attacker.example"), false, "foreign media never becomes deletion work");
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE user_id=? AND media_url IN (?,?,?,?,?,?)")
      .get(fan.id, urls.post, urls.venue, urls.banner, urls.avatar, urls.reattached, urls.external).count,
    0,
    "detached media URLs are also erased from the reaction index",
  );

  const auditStates = db.prepare(`SELECT prior_state,next_state FROM moderation_actions
    WHERE target_id IN ('moderation_irreversible_post','moderation_irreversible_venue','moderation irreversible artist')`).all();
  assert.equal(auditStates.length, 6);
  assert.equal(JSON.stringify(auditStates).includes("media.example"), false, "moderation audit state never retains media URLs");
  assert.equal(JSON.stringify(auditStates).includes("attacker.example"), false);
});

test("media queue failure rolls moderation visibility, URL scrubbing, ledger, and audit back together", () => {
  const media = `https://media.example/assets/users/${author.id}/post/moderation-atomic-failure.jpg`;
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "moderation_atomic_media_post", author.id, "J. Cole", "Scotiabank Arena", 4,
    "Must remain if durable queueing fails", JSON.stringify([media]), 1, Date.now(),
  );
  db.exec(`CREATE TEMP TRIGGER fail_moderation_media_queue
    BEFORE INSERT ON media_deletion_queue
    WHEN NEW.object_key LIKE '%moderation-atomic-failure%'
    BEGIN SELECT RAISE(ABORT, 'forced moderation media queue failure'); END`);
  try {
    assert.throws(
      () => routes["POST /api/admin/moderation/actions"](staffCtx(moderator, { body: {
        action: "remove", targetType: "post", targetId: "moderation_atomic_media_post", reason: "unsafe attachment",
      } })),
      /forced moderation media queue failure/,
    );
  } finally {
    db.exec("DROP TRIGGER fail_moderation_media_queue");
  }

  const row = db.prepare("SELECT removed,photos,photos_public FROM posts WHERE id=?").get("moderation_atomic_media_post");
  assert.deepEqual({ ...row }, { removed: 0, photos: JSON.stringify([media]), photos_public: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_objects WHERE object_key LIKE '%moderation-atomic-failure%'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE object_key LIKE '%moderation-atomic-failure%'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id='moderation_atomic_media_post'").get().count, 0);
});

test("the normalized queue keyset reaches older reports and rejects malformed cursors", () => {
  const prefix = `moderation_page_${Date.now()}`;
  for (let index = 0; index < 105; index += 1) {
    insertReport(`${prefix}_${String(index).padStart(3, "0")}`, "track", `track_${index}`, JSON.stringify({ title: `Track ${index}` }), fan.id, "open", 10_000 + index);
  }

  const seen = [];
  let before = null;
  do {
    const page = routes["GET /api/admin/moderation"](staffCtx(moderator, {
      query: { limit: "40", ...(before ? { before } : {}) },
    }));
    assert.equal(page.reports.length <= 40, true);
    seen.push(...page.reports.filter((report) => report.id.startsWith(prefix)).map((report) => report.id));
    before = page.nextCursor;
  } while (before);
  assert.equal(new Set(seen).size, 105, "every older open report remains reachable exactly once");

  assert.throws(
    () => routes["GET /api/admin/moderation"](staffCtx(moderator, { query: { before: "not-a-cursor" } })),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
});

test("dismiss and report removal are atomic, desired-state idempotent, and reject stale opposite actions", () => {
  insertPost("moderation_action_post");
  insertReport("moderation_action_report", "post", "moderation_action_post", "remove me");
  insertPost("moderation_dismiss_post");
  insertReport("moderation_dismiss_report", "post", "moderation_dismiss_post", "false alarm");
  const action = routes["POST /api/admin/moderation/actions"];

  const removed = action(staffCtx(moderator, { body: { action: "remove", reportId: "moderation_action_report" } }));
  assert.equal(removed.removed, true);
  assert.equal(removed.duplicate, false);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get("moderation_action_post").removed, 1);
  assert.equal(db.prepare("SELECT status FROM reports WHERE id=?").get("moderation_action_report").status, "actioned");
  const firstAuditCount = db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=?").get("moderation_action_post").count;
  const retry = action(staffCtx(moderator, { body: { action: "remove", reportId: "moderation_action_report" } }));
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=?").get("moderation_action_post").count, firstAuditCount);
  assert.throws(
    () => action(staffCtx(moderator, { body: { action: "dismiss", reportId: "moderation_action_report" } })),
    (error) => error instanceof ApiError && error.status === 409,
  );

  const dismissed = action(staffCtx(moderator, { body: { action: "dismiss", reportId: "moderation_dismiss_report" } }));
  assert.equal(dismissed.status, "dismissed");
  assert.equal(action(staffCtx(moderator, { body: { action: "dismiss", reportId: "moderation_dismiss_report" } })).duplicate, true);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get("moderation_dismiss_post").removed, 0);
  assert.throws(
    () => action(staffCtx(moderator, { body: { action: "remove", reportId: "moderation_dismiss_report" } })),
    (error) => error instanceof ApiError && error.status === 409,
  );
});

test("direct remove and restore stay atomic and record only real state changes", () => {
  insertPost("moderation_restore_post");
  const action = routes["POST /api/admin/moderation/actions"];
  const remove = action(staffCtx(admin, { body: {
    action: "remove", targetType: "post", targetId: "moderation_restore_post", reason: "policy violation",
  } }));
  assert.deepEqual({ removed: remove.removed, changed: remove.changed, duplicate: remove.duplicate }, { removed: true, changed: true, duplicate: false });
  const duplicateRemove = action(staffCtx(admin, { body: {
    action: "remove", targetType: "post", targetId: "moderation_restore_post", reason: "retry",
  } }));
  assert.equal(duplicateRemove.duplicate, true);
  const restore = action(staffCtx(moderator, { body: {
    action: "restore", targetType: "post", targetId: "moderation_restore_post", reason: "appeal accepted",
  } }));
  assert.equal(restore.removed, false);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get("moderation_restore_post").removed, 0);
  const audits = db.prepare("SELECT action,reason FROM moderation_actions WHERE target_id=?").all("moderation_restore_post");
  assert.equal(audits.length, 2, "the duplicate desired-state call must not append a third audit row");
  assert.deepEqual(Object.fromEntries(audits.map((row) => [row.action, row.reason])), {
    remove: "policy violation",
    restore: "appeal accepted",
  });
});

test("reported direct messages are tombstoned exactly, evicted from participant reads, and restore without re-alerting", () => {
  const sender = addUser("moderation_dm_sender");
  const recipient = addUser("moderation_dm_recipient");
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?), (?,?)")
    .run(sender.id, recipient.id, recipient.id, sender.id);
  const send = routes["POST /api/dms/:otherId"];
  const target = send({
    user: sender, ip: "moderation-dm-sender", params: { otherId: recipient.id },
    body: { text: "Exact reported private message" },
  });
  const neighbor = send({
    user: sender, ip: "moderation-dm-sender", params: { otherId: recipient.id },
    body: { text: "Unrelated message in the same conversation" },
  });
  insertReport("moderation_dm_report", "message", target.id, "targeted harassment", recipient.id);

  const context = routes["GET /api/admin/moderation"](staffCtx(moderator)).reports
    .find((report) => report.id === "moderation_dm_report");
  assert.equal(context.content.excerpt, "Exact reported private message");
  assert.equal(context.content.removed, false);
  assert.equal(JSON.stringify(context).includes("Unrelated message in the same conversation"), false);

  const action = routes["POST /api/admin/moderation/actions"];
  const removed = action(staffCtx(moderator, { body: { action: "remove", reportId: context.id } }));
  assert.deepEqual(
    { removed: removed.removed, changed: removed.changed, duplicate: removed.duplicate },
    { removed: true, changed: true, duplicate: false },
  );
  assert.deepEqual({ ...db.prepare("SELECT text,removed FROM dms WHERE id=?").get(target.id) }, {
    text: "Exact reported private message", removed: 1,
  }, "the restricted body remains available as evidence while participants lose access");
  assert.equal(db.prepare("SELECT removed FROM dms WHERE id=?").get(neighbor.id).removed, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE type='dm' AND post_id=?").get(target.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE type='dm' AND post_id=?").get(neighbor.id).count, 1);

  for (const [viewer, otherId] of [[sender, recipient.id], [recipient, sender.id]]) {
    const thread = routes["GET /api/dms/:otherId"]({ user: viewer, params: { otherId }, query: {} });
    assert.deepEqual(thread.messages.map((message) => message.id), [neighbor.id]);
    assert.ok(thread.removedIds.includes(target.id));
    const inbox = routes["GET /api/me/threads"]({ user: viewer, query: {} });
    assert.equal(JSON.stringify(inbox).includes("Exact reported private message"), false);
    assert.ok(inbox.removedIds.includes(target.id));
  }

  const retriedRemove = action(staffCtx(moderator, { body: { action: "remove", reportId: context.id } }));
  assert.equal(retriedRemove.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_type='message' AND target_id=?").get(target.id).count, 1);

  const restored = action(staffCtx(moderator, { body: {
    action: "restore", targetType: "message", targetId: target.id, reason: "Appeal accepted",
  } }));
  assert.deepEqual(
    { removed: restored.removed, changed: restored.changed, duplicate: restored.duplicate },
    { removed: false, changed: true, duplicate: false },
  );
  assert.deepEqual(
    routes["GET /api/dms/:otherId"]({ user: recipient, params: { otherId: sender.id }, query: {} }).messages.map((message) => message.id),
    [target.id, neighbor.id],
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE type='dm' AND post_id=?").get(target.id).count, 0,
    "restore must not send or recreate a private-message notification");
  const duplicateRestore = action(staffCtx(moderator, { body: {
    action: "restore", targetType: "message", targetId: target.id, reason: "retry",
  } }));
  assert.equal(duplicateRestore.duplicate, true);
  assert.deepEqual(
    db.prepare("SELECT action FROM moderation_actions WHERE target_type='message' AND target_id=? ORDER BY created_at,id").all(target.id).map((row) => row.action),
    ["remove", "restore"],
  );
});

test("direct-message tombstone and notification scrub roll back if its audit cannot commit", () => {
  const sender = addUser("moderation_dm_atomic_sender");
  const recipient = addUser("moderation_dm_atomic_recipient");
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?), (?,?)")
    .run(sender.id, recipient.id, recipient.id, sender.id);
  const target = routes["POST /api/dms/:otherId"]({
    user: sender, ip: "moderation-dm-atomic", params: { otherId: recipient.id },
    body: { text: "Atomic moderation evidence" },
  });
  db.exec(`CREATE TEMP TRIGGER fail_dm_moderation_audit
    BEFORE INSERT ON moderation_actions
    WHEN NEW.target_type='message' AND NEW.target_id='${target.id}'
    BEGIN SELECT RAISE(ABORT, 'forced DM moderation audit failure'); END`);
  try {
    assert.throws(
      () => routes["POST /api/admin/moderation/actions"](staffCtx(moderator, { body: {
        action: "remove", targetType: "message", targetId: target.id,
      } })),
      /forced DM moderation audit failure/,
    );
  } finally {
    db.exec("DROP TRIGGER fail_dm_moderation_audit");
  }
  assert.equal(db.prepare("SELECT removed FROM dms WHERE id=?").get(target.id).removed, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE type='dm' AND post_id=?").get(target.id).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_type='message' AND target_id=?").get(target.id).count, 0);
});

test("recent actions are bounded and omit internal audit state", () => {
  insertPost("moderation_recent_post");
  const action = routes["POST /api/admin/moderation/actions"];
  action(staffCtx(moderator, { body: { action: "remove", targetType: "post", targetId: "moderation_recent_post", reason: "recent reason" } }));
  const overview = routes["GET /api/admin/moderation"](staffCtx(admin));
  assert.equal(overview.recentActions.length <= 20, true);
  const recent = overview.recentActions.find((row) => row.targetId === "moderation_recent_post");
  assert.equal(recent.actor.handle, moderator.handle);
  assert.equal(recent.actor.role, "moderator");
  assert.equal(recent.reason, "recent reason");
  assert.equal(recent.requestId, undefined);
  assert.equal(recent.priorState, undefined);
  assert.equal(recent.nextState, undefined);
});

test("moderators and admins can moderate while fans and restricted staff cannot", () => {
  assert.doesNotThrow(() => routes["GET /api/admin/moderation"](staffCtx(moderator)));
  assert.doesNotThrow(() => routes["GET /api/admin/moderation"](staffCtx(admin)));
  assert.throws(
    () => routes["GET /api/admin/moderation"](staffCtx(fan)),
    (error) => error instanceof ApiError && error.status === 403,
  );
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, moderator.id);
  const suspended = q.userById.get(moderator.id);
  assert.throws(
    () => routes["GET /api/admin/moderation"](staffCtx(suspended)),
    (error) => error instanceof ApiError && error.status === 403,
  );
  db.prepare("UPDATE users SET suspended_until=NULL WHERE id=?").run(moderator.id);
  assert.throws(
    () => routes["POST /api/admin/users/:id/ban"](staffCtx(q.userById.get(moderator.id), { params: { id: fan.id } })),
    (error) => error instanceof ApiError && error.status === 403,
    "the moderation refactor must not widen admin-only member powers",
  );
});

test("member directory is no-store and withholds private email state from moderators", () => {
  const moderatorHeaders = {};
  const moderatorResult = routes["GET /api/admin/members"](staffCtx(moderator, {
    setHeader: (name, value) => { moderatorHeaders[name] = value; },
  }));
  assert.equal(moderatorHeaders["Cache-Control"], "no-store");
  assert.equal(moderatorResult.users.length > 0, true);
  assert.equal(moderatorResult.users.every((user) => !Object.hasOwn(user, "emailVerified")), true);

  const adminResult = routes["GET /api/admin/members"](staffCtx(admin));
  assert.equal(adminResult.users.every((user) => typeof user.emailVerified === "boolean"), true);
});

test("member search and keyset pagination reach older accounts without exposing email", () => {
  const prefix = "directorymember";
  for (let index = 0; index < 105; index += 1) {
    const id = `${prefix}${String(index).padStart(3, "0")}`;
    addUser(id, index === 3 ? "artist" : "fan");
    db.prepare("UPDATE users SET created_at=? WHERE id=?").run(20_000, id);
  }
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(`${prefix}001`);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, `${prefix}002`);
  q.insertUser.run("email_private_id", "only-secret-address@example.com", "safehandle", "Safe Name", "test-hash", "fan", "Toronto", 43.65, -79.38, "SN", "#123456", 19_000);

  const seen = [];
  let before = null;
  do {
    const page = routes["GET /api/admin/members"](staffCtx(moderator, {
      query: { limit: "40", ...(before ? { before } : {}) },
    }));
    assert.equal(page.users.length <= 40, true);
    assert.equal(page.total >= 105, true, "total remains the global directory total");
    assert.equal(page.matchingTotal, page.total);
    seen.push(...page.users.filter((user) => user.id.startsWith(prefix)).map((user) => user.id));
    before = page.nextCursor;
  } while (before);
  assert.equal(new Set(seen).size, 105, "all older members remain reachable exactly once across equal timestamps");

  const search = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: `${prefix}003` } }));
  assert.deepEqual(search.users.map((user) => user.id), [`${prefix}003`]);
  assert.equal(search.matchingTotal, 1);
  assert.equal(search.users[0].role, "artist");
  assert.equal(routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: "only-secret-address@example.com" } })).matchingTotal, 0,
    "staff directory search must never search private addresses");

  const bannedPage = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: prefix, status: "banned" } }));
  assert.deepEqual(bannedPage.users.map((user) => user.id), [`${prefix}001`]);
  const suspendedPage = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: prefix, status: "suspended" } }));
  assert.deepEqual(suspendedPage.users.map((user) => user.id), [`${prefix}002`]);
  const activeArtistPage = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: prefix, role: "artist", status: "active" } }));
  assert.deepEqual(activeArtistPage.users.map((user) => user.id), [`${prefix}003`]);

  assert.throws(
    () => routes["GET /api/admin/members"](staffCtx(moderator, { query: { before: "bad-cursor" } })),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
});

test("member desired-state actions are safe to retry after a lost response", async () => {
  const target = addUser("member_action_retry", "fan");
  const roleTarget = addUser("member_role_retry", "fan");
  const adminTarget = addUser("member_admin_retry", "fan");
  const call = (route, user, id, body = {}) => routes[route](staffCtx(user, { params: { id }, body }));
  const auditCount = (id, action) => db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action=?").get(id, action).count;

  const firstSuspend = call("POST /api/admin/users/:id/suspend", moderator, target.id, { days: 1, reason: "retry-safe timeout" });
  const retriedSuspend = call("POST /api/admin/users/:id/suspend", moderator, target.id, { days: 1, reason: "retry-safe timeout" });
  assert.equal(retriedSuspend.suspendedUntil, firstSuspend.suspendedUntil, "retry must not extend the timeout deadline");
  assert.equal(auditCount(target.id, "suspend"), 1);
  assert.deepEqual(call("POST /api/admin/users/:id/unsuspend", moderator, target.id), { ok: true });
  assert.deepEqual(call("POST /api/admin/users/:id/unsuspend", moderator, target.id), { ok: true });
  assert.equal(auditCount(target.id, "lift_suspension"), 1);

  assert.deepEqual(call("POST /api/admin/users/:id/ban", admin, target.id), { ok: true });
  assert.deepEqual(call("POST /api/admin/users/:id/ban", admin, target.id), { ok: true });
  assert.equal(auditCount(target.id, "ban"), 1);
  assert.deepEqual(call("POST /api/admin/users/:id/unban", admin, target.id), { ok: true });
  assert.deepEqual(call("POST /api/admin/users/:id/unban", admin, target.id), { ok: true });
  assert.equal(auditCount(target.id, "unban"), 1);

  assert.deepEqual(call("POST /api/admin/users/:id/verified", admin, target.id, { verified: true }), { ok: true, verified: true });
  assert.deepEqual(call("POST /api/admin/users/:id/verified", admin, target.id, { verified: true }), { ok: true, verified: true });
  assert.equal(auditCount(target.id, "grant_verification"), 1);
  assert.deepEqual(call("POST /api/admin/users/:id/sponsor", admin, target.id, { sponsor: true }), { ok: true, sponsor: true });
  assert.deepEqual(call("POST /api/admin/users/:id/sponsor", admin, target.id, { sponsor: true }), { ok: true, sponsor: true });
  assert.equal(auditCount(target.id, "grant_sponsor"), 1);

  const firstEmail = call("POST /api/admin/users/:id/verify-email", admin, target.id);
  const retriedEmail = call("POST /api/admin/users/:id/verify-email", admin, target.id);
  assert.equal(firstEmail.emailVerified, true);
  assert.equal(retriedEmail.emailVerified, true);
  assert.equal(auditCount(target.id, "verify-email"), 1);

  assert.deepEqual(call("POST /api/admin/users/:id/role", admin, roleTarget.id, { role: "artist" }), { ok: true, role: "artist", handle: roleTarget.handle });
  assert.deepEqual(call("POST /api/admin/users/:id/role", admin, roleTarget.id, { role: "artist" }), { ok: true, role: "artist", handle: roleTarget.handle });
  assert.equal(auditCount(roleTarget.id, "change_role"), 1);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), adminTarget.id);
  const firstAdminRequest = await call("POST /api/admin/users/:id/role", admin, adminTarget.id, { role: "admin", handle: "member_admin_retry" });
  const retriedAdminRequest = await call("POST /api/admin/users/:id/role", admin, adminTarget.id, { role: "admin", handle: "member_admin_retry" });
  assert.equal(firstAdminRequest.pending, true);
  assert.equal(retriedAdminRequest.approvalId, firstAdminRequest.approvalId,
    "an identical retry must rotate the secret while retaining one pending decision");
  assert.equal(q.userById.get(adminTarget.id).role, "fan");
  assert.equal(auditCount(adminTarget.id, "change_role"), 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM owner_approval_requests WHERE target_user_id=? AND status='pending'").get(adminTarget.id).count, 1);
});

test("staff role requests reserve globally unique tagged handles without applying authority", async () => {
  const moderatorTarget = addUser("tagtarget", "fan");
  const hiddenModeratorCollision = addUser("tagtarget_mod", "fan");
  const adminTarget = addUser("tagtargettwo", "fan");
  const hiddenAdminCollision = addUser("tagtargettwo_admin", "fan");
  const call = (id, role, handle) => routes["POST /api/admin/users/:id/role"](staffCtx(admin, {
    params: { id }, body: { role, handle, reason: "server allocation regression" },
  }));
  const auditCount = (id) => db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='change_role'").get(id).count;
  db.prepare("UPDATE users SET email_verified_at=? WHERE id IN (?,?)").run(Date.now(), moderatorTarget.id, adminTarget.id);

  const firstModerator = await call(moderatorTarget.id, "moderator", hiddenModeratorCollision.handle);
  const retriedModerator = await call(moderatorTarget.id, "moderator", hiddenModeratorCollision.handle);
  assert.equal(firstModerator.pending, true);
  assert.equal(retriedModerator.approvalId, firstModerator.approvalId);
  const moderatorPayload = JSON.parse(db.prepare("SELECT payload FROM owner_approval_requests WHERE id=?").get(firstModerator.approvalId).payload);
  assert.equal(moderatorPayload.requestedHandle, "tagtarget_mod1");
  assert.equal(q.userById.get(moderatorTarget.id).handle, moderatorTarget.handle);
  assert.equal(q.userById.get(hiddenModeratorCollision.id).handle, hiddenModeratorCollision.handle);
  assert.equal(auditCount(moderatorTarget.id), 0);

  const firstAdmin = await call(adminTarget.id, "admin", hiddenAdminCollision.handle);
  const retriedAdmin = await call(adminTarget.id, "admin", hiddenAdminCollision.handle);
  assert.equal(firstAdmin.pending, true);
  assert.equal(retriedAdmin.approvalId, firstAdmin.approvalId);
  const adminPayload = JSON.parse(db.prepare("SELECT payload FROM owner_approval_requests WHERE id=?").get(firstAdmin.approvalId).payload);
  assert.equal(adminPayload.requestedHandle, "tagtargettwo_admin1");
  assert.equal(q.userById.get(adminTarget.id).handle, adminTarget.handle);
  assert.equal(q.userById.get(hiddenAdminCollision.id).handle, hiddenAdminCollision.handle);
  assert.equal(auditCount(adminTarget.id), 0);
});

test("email verification and its moderation audit commit atomically", () => {
  const target = addUser("verify_email_atomic", "fan");
  db.exec(`CREATE TEMP TRIGGER fail_verify_email_audit
    BEFORE INSERT ON moderation_actions
    WHEN NEW.action='verify-email'
    BEGIN SELECT RAISE(ABORT, 'forced verify-email audit failure'); END`);
  try {
    assert.throws(
      () => routes["POST /api/admin/users/:id/verify-email"](staffCtx(admin, { params: { id: target.id } })),
      /forced verify-email audit failure/,
    );
  } finally {
    db.exec("DROP TRIGGER fail_verify_email_audit");
  }

  const rolledBack = q.userById.get(target.id);
  assert.equal(rolledBack.email_verified_at, 0, "audit failure must roll verification back");
  assert.equal(rolledBack.welcome_sent_at, 0, "welcome delivery must not start before commit");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='verify-email'").get(target.id).count, 0);

  const completed = routes["POST /api/admin/users/:id/verify-email"](staffCtx(admin, { params: { id: target.id } }));
  assert.equal(completed.emailVerified, true);
  assert.ok(q.userById.get(target.id).welcome_sent_at > 0, "a successful commit releases the guarded welcome");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='verify-email'").get(target.id).count, 1);
});

test("badge membership actions audit only real desired-state changes", () => {
  const target = addUser("member_badge_retry", "fan");
  const create = routes["POST /api/admin/badges"](staffCtx(admin, { body: {
    slug: "retry-badge", label: "Retry Badge", description: "Idempotency regression", kind: "event", color: "cool", glyph: "check",
  } }));
  const call = (revoke) => routes["POST /api/admin/users/:id/badges"](staffCtx(admin, {
    params: { id: target.id }, body: { slug: create.badge.slug, revoke },
  }));
  assert.equal(call(false).badges.some((badge) => badge.slug === "retry-badge"), true);
  assert.equal(call(false).badges.some((badge) => badge.slug === "retry-badge"), true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='badge-grant'").get(target.id).count, 1);
  assert.equal(call(true).badges.some((badge) => badge.slug === "retry-badge"), false);
  assert.equal(call(true).badges.some((badge) => badge.slug === "retry-badge"), false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='badge-revoke'").get(target.id).count, 1);
});

test("legacy moderation routes preserve their exact response shapes", () => {
  insertPost("moderation_legacy_action_post");
  insertReport("moderation_legacy_action_report", "post", "moderation_legacy_action_post");
  assert.deepEqual(
    routes["POST /api/admin/reports/:id/action"](staffCtx(moderator, { params: { id: "moderation_legacy_action_report" } })),
    { ok: true, targetType: "post", targetId: "moderation_legacy_action_post" },
  );
  insertPost("moderation_legacy_dismiss_post");
  insertReport("moderation_legacy_dismiss_report", "post", "moderation_legacy_dismiss_post");
  assert.deepEqual(
    routes["POST /api/admin/reports/:id/dismiss"](staffCtx(moderator, { params: { id: "moderation_legacy_dismiss_report" } })),
    { ok: true },
  );
  insertPost("moderation_legacy_content_post");
  assert.deepEqual(
    routes["POST /api/admin/content/:type/:id"](staffCtx(moderator, {
      params: { type: "post", id: "moderation_legacy_content_post" }, body: { removed: true },
    })),
    { ok: true, removed: true },
  );
  const responseHeaders = {};
  const reports = routes["GET /api/admin/reports"](staffCtx(moderator, {
    setHeader: (name, value) => { responseHeaders[name] = value; },
  })).reports;
  assert.equal(responseHeaders["Cache-Control"], "no-store");
  assert.equal(reports.every((report) => report.status === "open"), true);
  assert.equal(reports.length <= 200, true);
  assert.ok(Object.hasOwn(reports[0], "target_type"), "legacy report rows remain snake_case");
});
