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

function report(user, body) {
  return routes["POST /api/reports"]({ user, ip: `reports-${user.id}`, body });
}

function expectApiError(run, status, code) {
  assert.throws(run, (error) => error instanceof ApiError && error.status === status && error.code === code);
}

const reporter = addUser("reports_reporter");
const author = addUser("reports_author");
const outsider = addUser("reports_outsider");

db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,removed,created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(
  "reports_post",
  author.id,
  "J. Cole",
  "Scotiabank Arena",
  4.5,
  "A public post",
  JSON.stringify(["https://media.example/one.jpg", "https://media.example/two.jpg"]),
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
  .run("reports_venue_review", "scotiabank arena", author.id, 4, "A venue review", JSON.stringify(["https://media.example/venue.jpg"]), Date.now());
db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,banner,avatar_uri,feed_enabled,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run("j. cole", author.id, "Official artist bio", "https://media.example/artist-banner.jpg", "https://media.example/artist-avatar.jpg", 1, Date.now());
db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
  .run("reports_artist_post", "j. cole", author.id, "An artist-page update", Date.now());

test("all reachable UGC targets report idempotently and exact media is verified without storing its URL", () => {
  const targets = [
    { targetType: "user", targetId: author.id, reason: "Impersonation" },
    { targetType: "post", targetId: "reports_post", reason: "Unsafe image", mediaUri: "https://media.example/two.jpg" },
    { targetType: "comment", targetId: "reports_comment", reason: "Harassment" },
    { targetType: "message", targetId: "reports_dm", reason: "Harassment" },
    { targetType: "fan_message", targetId: "reports_fan_message", reason: "Spam" },
    { targetType: "lounge_message", targetId: "reports_lounge_message", reason: "Threats" },
    { targetType: "venue_review", targetId: "reports_venue_review", reason: "Unsafe image", mediaUri: "https://media.example/venue.jpg" },
    { targetType: "artist_post", targetId: "reports_artist_post", reason: "Harassment" },
    { targetType: "artist_profile", targetId: "j. cole", reason: "Unsafe image", mediaUri: "https://media.example/artist-avatar.jpg" },
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
  assert.equal(db.prepare("SELECT updated_by FROM email_templates WHERE key='reports_delete_template'").get().updated_by, null);
  assert.equal(db.prepare("SELECT created_by FROM email_campaigns WHERE id='reports_delete_campaign'").get().created_by, null);
});
