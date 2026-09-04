import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-reports-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, passwordHash = "test-hash") {
  q.insertUser.run(id, `${id}@example.com`, id, id, passwordHash, "fan", "Toronto", 43.65, -79.38, "TU", "#123456", Date.now());
  return q.userById.get(id);
}

let mediaSequence = 0;
function readyImage(owner, label) {
  const token = `${label}${++mediaSequence}`.replace(/[^A-Za-z0-9_-]/g, "").padEnd(12, "x");
  const assetId = `ma_${token}`;
  const variantId = `mv_${token}`;
  const sourceKey = `users/${owner.id}/post/${token}.jpg`;
  const renderKey = `users/${owner.id}/post/${token}.webp`;
  const sourceUrl = `pit-private:${sourceKey}`;
  const publicUrl = `https://pit-media.example/${renderKey}`;
  const at = Date.now();
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'private','post',2048,'issued',?,?)`).run(sourceKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'public','post',1024,'issued',?,?)`).run(renderKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,source_verified_at,
      render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?,'private','photo.jpg','image/jpeg',2048,100,100,
      'declared','not_applicable','ready',?,'ready',?,?,?)`)
    .run(assetId, owner.id, `client-${token}`, "a".repeat(64), sourceKey, sourceUrl, at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',1024,100,100,'verified',?,?,'private_derivative_v1',?,?)`)
    .run(variantId, assetId, `variant-${token}`, "b".repeat(64), renderKey, publicUrl, "c".repeat(64), at, at, at);
  return publicUrl;
}

function finalizedArtistImage(owner, label, purpose) {
  const publicUrl = readyImage(owner, label);
  const objectKey = new URL(publicUrl).pathname.replace(/^\//u, "");
  const token = `${label}artist${++mediaSequence}`.replace(/[^A-Za-z0-9_-]/g, "").padEnd(12, "x");
  const at = Date.now();
  db.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,expires_at,
      consumed_at,finalized_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'image/jpeg',2048,'image/webp',?,?,1024,100,100,'finalized',?,?,?,?,?)`)
    .run(`lm_${token}`, owner.id, "d".repeat(64), purpose,
      `users/${owner.id}/${purpose}/${token}-staging.jpg`, objectKey, publicUrl,
      at + 60_000, null, at, at, at);
  return publicUrl;
}

function report(user, body) {
  return routes["POST /api/reports"]({ user, ip: `reports-${user.id}`, body });
}

function addReportableSurfaces(prefix, owner, viewer) {
  const createdAt = Date.now();
  const postId = `${prefix}_post`;
  const commentId = `${prefix}_comment`;
  const fanArtist = `${prefix} artist`;
  const fanMessageId = `${prefix}_fan_message`;
  const loungeId = `${prefix}|venue|2026-09-01`;
  const loungeMessageId = `${prefix}_lounge_message`;
  const venueReviewId = `${prefix}_venue_review`;
  const artistKey = `${prefix} official`;
  const artistPostId = `${prefix}_artist_post`;

  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(postId, owner.id, fanArtist, "Venue", 4, "post", "[]", createdAt);
  db.prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run(commentId, postId, owner.id, "comment", createdAt);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(fanArtist, viewer.id);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run(fanMessageId, fanArtist, owner.id, "fan message", createdAt);
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date) VALUES (?,?,?,?,?,?)")
    .run(viewer.id, loungeId, fanArtist, "Venue", "Toronto", "2026-09-01");
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run(loungeMessageId, loungeId, owner.id, "lounge message", createdAt);
  db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(venueReviewId, `${prefix} venue`, owner.id, 4, "venue review", "[]", createdAt);
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,feed_enabled,updated_at) VALUES (?,?,?,?,?)")
    .run(artistKey, owner.id, "artist profile", 1, createdAt);
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run(artistPostId, artistKey, owner.id, "artist post", createdAt);

  return [
    { targetType: "user", targetId: owner.id },
    { targetType: "post", targetId: postId },
    { targetType: "comment", targetId: commentId },
    { targetType: "fan_message", targetId: fanMessageId },
    { targetType: "lounge_message", targetId: loungeMessageId },
    { targetType: "venue_review", targetId: venueReviewId },
    { targetType: "artist_post", targetId: artistPostId },
    { targetType: "artist_profile", targetId: artistKey },
  ];
}

function expectApiError(run, status, code) {
  assert.throws(run, (error) => error instanceof ApiError && error.status === status && error.code === code);
}

const reporter = addUser("reports_reporter");
const author = addUser("reports_author");
const outsider = addUser("reports_outsider");
const postPhotoOne = readyImage(author, "reportpostone");
const postPhotoTwo = readyImage(author, "reportposttwo");
const venuePhoto = readyImage(author, "reportvenue");
const artistBanner = finalizedArtistImage(author, "reportbanner", "banner");
const artistAvatar = finalizedArtistImage(author, "reportavatar", "avatar");

db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,removed,created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(
  "reports_post",
  author.id,
  "J. Cole",
  "Scotiabank Arena",
  4.5,
  "A public post",
  JSON.stringify([postPhotoOne, postPhotoTwo]),
  0,
  Date.now(),
);
db.prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
  .run("reports_comment", "reports_post", author.id, "A reportable comment", Date.now());
db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)")
  .run("reports_dm", author.id, reporter.id, "A private incoming message", Date.now());
db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("j. cole", reporter.id);
db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
  .run("reports_fan_message", "j. cole", author.id, "A fan-club message", Date.now());
db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date) VALUES (?,?,?,?,?,?)")
  .run(reporter.id, "j. cole|scotiabank|2026-08-13", "J. Cole", "Scotiabank", "Toronto", "2026-08-13");
db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
  .run("reports_lounge_message", "j. cole|scotiabank|2026-08-13", author.id, "A lounge message", Date.now());
db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
  .run("reports_venue_review", "scotiabank arena", author.id, 4, "A venue review", JSON.stringify([venuePhoto]), Date.now());
db.prepare(`INSERT INTO artist_profiles
  (artist_key,owner_id,bio,banner,banner_owner_id,avatar_uri,avatar_owner_id,feed_enabled,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)`)
  .run("j. cole", author.id, "Official artist bio", artistBanner, author.id,
    artistAvatar, author.id, 1, Date.now());
db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
  .run("reports_artist_post", "j. cole", author.id, "An artist-page update", Date.now());

test("all reachable UGC targets report idempotently and exact media is verified without storing its URL", () => {
  const targets = [
    { targetType: "user", targetId: author.id, reason: "Impersonation" },
    { targetType: "post", targetId: "reports_post", reason: "Unsafe image", mediaUri: postPhotoTwo },
    { targetType: "comment", targetId: "reports_comment", reason: "Harassment" },
    { targetType: "message", targetId: "reports_dm", reason: "Harassment" },
    { targetType: "fan_message", targetId: "reports_fan_message", reason: "Spam" },
    { targetType: "lounge_message", targetId: "reports_lounge_message", reason: "Threats" },
    { targetType: "venue_review", targetId: "reports_venue_review", reason: "Unsafe image", mediaUri: venuePhoto },
    { targetType: "artist_post", targetId: "reports_artist_post", reason: "Harassment" },
    { targetType: "artist_profile", targetId: "j. cole", reason: "Unsafe image", mediaUri: artistAvatar },
  ];

  for (const target of targets) {
    const first = report(reporter, target);
    const retry = report(reporter, target);
    assert.equal(first.duplicate, false);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.id, first.id);
  }

  assert.equal(db.prepare("SELECT COUNT(*) count FROM reports WHERE reporter_id=?").get(reporter.id).count, targets.length);
  const postReason = db.prepare("SELECT reason FROM reports WHERE reporter_id=? AND target_type='post'").get(reporter.id).reason;
  assert.match(postReason, /^Specific attached media 2 of 2\. Unsafe image$/);
  assert.equal(postReason.includes("media.example"), false, "staff report rows do not persist attachment URLs");
  const venueReason = db.prepare("SELECT reason FROM reports WHERE reporter_id=? AND target_type='venue_review'").get(reporter.id).reason;
  assert.match(venueReason, /^Specific attached media 1 of 1\. Unsafe image$/);
  const artistProfileReport = db.prepare("SELECT reason,media_index,media_fingerprint FROM reports WHERE reporter_id=? AND target_type='artist_profile'").get(reporter.id);
  assert.match(artistProfileReport.reason, /^Specific attached media 2 of 2\. Unsafe image$/);
  assert.equal(artistProfileReport.media_index, 2);
  assert.match(artistProfileReport.media_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(artistProfileReport).includes("media.example"), false);
});

test("public unclaimed staff-seeded artist photos are reportable without exposing the uploader", () => {
  const staff = addUser("reports_unclaimed_staff");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(staff.id);
  const viewer = addUser("reports_unclaimed_viewer");
  const avatar = finalizedArtistImage(staff, "reportunclaimedavatar", "avatar");
  const artistKey = "reports unclaimed artist";
  db.prepare(`INSERT INTO artist_profiles
    (artist_key,owner_id,bio,avatar_uri,avatar_owner_id,feed_enabled,updated_at)
    VALUES (?,NULL,?,?,?,?,?)`)
    .run(artistKey, "Staff-seeded public catalog page", avatar, staff.id, 1, Date.now());

  const result = report(viewer, {
    targetType: "artist_profile",
    targetId: artistKey,
    reason: "Unsafe image",
    mediaUri: avatar,
  });
  assert.equal(result.duplicate, false);
  assert.equal(JSON.stringify(result).includes(staff.id), false, "the report response does not reveal slot provenance");
  const stored = db.prepare(`SELECT target_id,reason,media_index,media_fingerprint
    FROM reports WHERE id=?`).get(result.id);
  assert.equal(stored.target_id, artistKey);
  assert.match(stored.reason, /^Specific attached media 1 of 1\. Unsafe image$/u);
  assert.equal(stored.media_index, 1);
  assert.match(stored.media_fingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(stored).includes(staff.id), false);
  assert.equal(JSON.stringify(stored).includes(avatar), false);

  expectApiError(() => report(q.userById.get(staff.id), {
    targetType: "artist_profile",
    targetId: artistKey,
    reason: "self report",
    mediaUri: avatar,
  }), 400, "VALIDATION_FAILED");
});

test("private and gated targets cannot be probed or self-reported", () => {
  expectApiError(
    () => report(outsider, { targetType: "message", targetId: "reports_dm", reason: "probe" }),
    404,
    "NOT_FOUND",
  );
  expectApiError(
    () => report(outsider, { targetType: "fan_message", targetId: "reports_fan_message", reason: "probe" }),
    404,
    "NOT_FOUND",
  );
  expectApiError(
    () => report(outsider, { targetType: "lounge_message", targetId: "reports_lounge_message", reason: "probe" }),
    404,
    "NOT_FOUND",
  );
  expectApiError(
    () => report(reporter, { targetType: "post", targetId: "reports_post", reason: "spoof", mediaUri: "https://media.example/not-attached.jpg" }),
    404,
    "NOT_FOUND",
  );
  expectApiError(
    () => report(author, { targetType: "post", targetId: "reports_post", reason: "self" }),
    400,
    "VALIDATION_FAILED",
  );
  expectApiError(
    () => report(author, { targetType: "user", targetId: author.id, reason: "self" }),
    400,
    "VALIDATION_FAILED",
  );
  expectApiError(
    () => report(reporter, { targetType: "message", targetId: "reports_dm", reason: "bad metadata", mediaUri: "https://media.example/one.jpg" }),
    400,
    "VALIDATION_FAILED",
  );
});

test("blocks make every public and artist-owned report target indistinguishable from missing", () => {
  const viewer = addUser("reports_block_viewer");
  const target = addUser("reports_block_target");
  const targets = addReportableSurfaces("reports_block", target, viewer);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(target.id, viewer.id, Date.now());

  for (const body of targets) {
    expectApiError(() => report(viewer, { ...body, reason: "probe" }), 404, "NOT_FOUND");
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM reports WHERE reporter_id=?").get(viewer.id).count, 0);
});

test("restricted authors cannot be confirmed through public or artist-owned report targets", () => {
  const viewer = addUser("reports_restricted_viewer");
  const target = addUser("reports_restricted_target");
  const targets = addReportableSurfaces("reports_restricted", target, viewer);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 86_400_000, target.id);

  for (const body of targets) {
    expectApiError(() => report(viewer, { ...body, reason: "probe" }), 404, "NOT_FOUND");
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM reports WHERE reporter_id=?").get(viewer.id).count, 0);
});

test("artist-post reports honor a distinct profile owner's visibility boundary", () => {
  const viewer = addUser("reports_split_viewer");
  const owner = addUser("reports_split_owner");
  const staffAuthor = addUser("reports_split_staff");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(staffAuthor.id);
  const artistKey = "reports split official";
  const postId = "reports_split_artist_post";
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,feed_enabled,updated_at) VALUES (?,?,?,?,?)")
    .run(artistKey, owner.id, "owner profile", 1, Date.now());
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run(postId, artistKey, staffAuthor.id, "staff-authored update", Date.now());

  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(owner.id, viewer.id, Date.now());
  expectApiError(
    () => report(viewer, { targetType: "artist_post", targetId: postId, reason: "blocked probe" }),
    404,
    "NOT_FOUND",
  );
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(owner.id, viewer.id);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 86_400_000, owner.id);
  expectApiError(
    () => report(viewer, { targetType: "artist_post", targetId: postId, reason: "restricted probe" }),
    404,
    "NOT_FOUND",
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM reports WHERE reporter_id=?").get(viewer.id).count, 0);
});

test("account deletion removes reports aimed at every newly reportable authored surface", () => {
  const password = "DeleteMe123";
  const deleting = addUser("reports_delete_target", hashPassword(password));
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("reports_delete_fan", "delete artist", deleting.id, "fan", Date.now());
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("reports_delete_lounge", "delete|room|2026-08-14", deleting.id, "lounge", Date.now());
  db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("reports_delete_venue", "delete room", deleting.id, 3, "venue", "[]", Date.now());
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("reports_delete_artist_post", "delete artist", deleting.id, "artist update", Date.now());
  const ownedMedia = "https://media.example/users/reports_delete_target/post/attached.jpg";
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run("reports_delete_post", deleting.id, "Delete Artist", "Delete Room", 3, "post", JSON.stringify([ownedMedia]), Date.now());
  const insert = db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)");
  insert.run("reports_delete_fan_report", "fan_message", "reports_delete_fan", "reason", outsider.id, Date.now());
  insert.run("reports_delete_lounge_report", "lounge_message", "reports_delete_lounge", "reason", outsider.id, Date.now());
  insert.run("reports_delete_venue_report", "venue_review", "reports_delete_venue", "reason", outsider.id, Date.now());
  insert.run("reports_delete_artist_report", "artist_post", "reports_delete_artist_post", "reason", outsider.id, Date.now());

  db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)")
    .run(ownedMedia, outsider.id, "reports_delete_post", Date.now());
  db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)")
    .run("https://media.example/users/reports_delete_target/avatar/orphan.jpg", outsider.id, null, Date.now());
  db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)")
    .run("https://media.example/users/reports_author/post/keep.jpg", outsider.id, "reports_post", Date.now());

  const insertAction = db.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  insertAction.run("reports_delete_action_report", outsider.id, "dismiss", "report", "reports_delete_fan_report", deleting.handle, "{}", JSON.stringify({ by: deleting.id }), Date.now());
  insertAction.run("reports_delete_action_user", outsider.id, "suspend", "user", deleting.id, deleting.handle, JSON.stringify({ handle: deleting.handle }), "{}", Date.now());
  insertAction.run("reports_delete_action_actor", deleting.id, "badge-create", "badge", "unrelated_badge", deleting.handle, "{}", "{}", Date.now());
  insertAction.run("reports_keep_action", outsider.id, "restore", "post", "reports_post", "unrelated", "{}", "{}", Date.now());

  db.prepare(`INSERT INTO email_campaigns
    (id,name,subject,body,audience,status,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,'draft',?,?,?)`).run("reports_delete_campaign", "Campaign", "Subject", "Body", "all", deleting.id, Date.now(), Date.now());
  db.prepare("INSERT INTO email_queue (campaign_id,user_id,to_email,status,created_at) VALUES (?,?,?,?,?)")
    .run("reports_delete_campaign", deleting.id, "alias@example.com", "pending", Date.now());
  db.prepare("INSERT INTO email_queue (campaign_id,user_id,to_email,status,created_at) VALUES (?,?,?,?,?)")
    .run("reports_delete_campaign", null, deleting.email.toUpperCase(), "pending", Date.now());
  db.prepare("INSERT INTO email_queue (campaign_id,user_id,to_email,status,created_at) VALUES (?,?,?,?,?)")
    .run("reports_delete_campaign", outsider.id, outsider.email, "pending", Date.now());
  const insertEmailLog = db.prepare(`INSERT INTO email_log
    (created_at,kind,user_id,to_email,subject,status,reason) VALUES (?,?,?,?,?,?,?)`);
  insertEmailLog.run(Date.now(), "transactional", deleting.id, "alias@example.com", "Delete", "sent", null);
  insertEmailLog.run(Date.now(), "transactional", null, deleting.email.toUpperCase(), "Delete", "failed", "old failure");
  insertEmailLog.run(Date.now(), "transactional", outsider.id, outsider.email, "Keep", "sent", null);

  db.prepare(`INSERT INTO custom_badges
    (id,slug,label,description,kind,color,glyph,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run("reports_delete_badge", "delete-badge", "Badge", "Description", "event", "cool", "check", deleting.id, Date.now(), Date.now());
  db.prepare("INSERT INTO user_badges (user_id,badge_id,granted_by,granted_at,note) VALUES (?,?,?,?,?)")
    .run(outsider.id, "reports_delete_badge", deleting.id, Date.now(), `granted by ${deleting.handle}`);
  db.prepare("INSERT INTO track_overrides (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,?,?)")
    .run("reports_delete_track", "Track", "Artist", null, deleting.id, Date.now());
  db.prepare("INSERT INTO track_source_overrides (provider,source_id,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("spotify", "reports_delete_source", "Source track", "Artist", null, deleting.id, Date.now());
  db.prepare("INSERT INTO email_templates (key,subject,body,updated_at,updated_by) VALUES (?,?,?,?,?)")
    .run("reports_delete_template", "Template", "Body", Date.now(), deleting.id);

  routes["DELETE /api/me"]({
    user: deleting,
    ip: "reports-delete",
    body: { password },
    clearSession() {},
  });

  assert.equal(db.prepare("SELECT COUNT(*) count FROM reports WHERE id LIKE 'reports_delete_%_report'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE media_url LIKE '%reports_delete_target%'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE media_url LIKE '%reports_author%'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE id LIKE 'reports_delete_action_%'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE id='reports_keep_action'").get().count, 1);
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM moderation_actions").all()).includes(deleting.id), false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM email_queue WHERE user_id=? OR lower(to_email)=lower(?)").get(deleting.id, deleting.email).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM email_log WHERE user_id=? OR lower(to_email)=lower(?)").get(deleting.id, deleting.email).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM email_queue WHERE user_id=?").get(outsider.id).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM email_log WHERE user_id=?").get(outsider.id).count, 1);
  assert.equal(db.prepare("SELECT created_by FROM custom_badges WHERE id='reports_delete_badge'").get().created_by, null);
  const retainedGrant = db.prepare("SELECT granted_by,note FROM user_badges WHERE user_id=? AND badge_id='reports_delete_badge'").get(outsider.id);
  assert.equal(retainedGrant.granted_by, null);
  assert.equal(retainedGrant.note, "");
  assert.equal(db.prepare("SELECT set_by FROM track_overrides WHERE key='reports_delete_track'").get().set_by, null);
  assert.equal(db.prepare("SELECT set_by FROM track_source_overrides WHERE provider='spotify' AND source_id='reports_delete_source'").get().set_by, null);
  assert.equal(db.prepare("SELECT updated_by FROM email_templates WHERE key='reports_delete_template'").get().updated_by, null);
  assert.equal(db.prepare("SELECT created_by FROM email_campaigns WHERE id='reports_delete_campaign'").get().created_by, null);
});
