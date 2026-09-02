import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-recommendation-indexes-"));
process.env.PIT_DATA_DIR = dataDir;

const { artistRow, artistStmts, db, q } = await import("./db.js");
const {
  RECOMMENDATION_CANDIDATE_SELECT,
  RECOMMENDATION_SIGNAL_SQL,
  projectedRecommendationGenre,
} = await import("./recommendationService.js");
const {
  ARTIST_GENRE_SQL_COLUMNS, projectArtistGenreColumns,
} = await import("./artistGenreProjection.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function indexColumns(indexName) {
  return db.prepare(`PRAGMA index_info('${indexName}')`).all().map((row) => row.name);
}

function queryPlan(sql, ...params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail));
}

test("recommendation signal indexes keep the viewer id as their leading key", () => {
  assert.deepEqual(indexColumns("idx_likes_user_post"), ["user_id", "post_id"]);
  assert.deepEqual(indexColumns("idx_comments_user_recent"), ["user_id", "removed", "created_at", "post_id"]);
  assert.deepEqual(indexColumns("idx_comments_post_distinct_users"), ["post_id", "removed", "user_id"]);
  assert.deepEqual(indexColumns("idx_fan_club_members_user_artist"), ["user_id", "artist"]);
  assert.deepEqual(indexColumns("idx_post_impressions_user_recent"), ["user_id", "last_seen_at", "post_id"]);
  assert.deepEqual(indexColumns("idx_post_impression_receipts_expiry"), ["created_at", "user_id", "event_id"]);
});

test("production recommendation signal queries use viewer-first index paths", () => {
  const cases = [
    ["fan clubs", RECOMMENDATION_SIGNAL_SQL.fanClubs, "idx_fan_club_members_user_artist"],
    ["show attendance", RECOMMENDATION_SIGNAL_SQL.attendance, "idx_show_attendance_user_updated"],
    ["likes", RECOMMENDATION_SIGNAL_SQL.likes, "idx_likes_user_post"],
    ["comments", RECOMMENDATION_SIGNAL_SQL.comments, "idx_comments_user_recent"],
  ];

  for (const [label, sql, indexName] of cases) {
    const plan = queryPlan(sql, "viewer-query-plan");
    assert.ok(
      plan.some((detail) => detail.includes(indexName) && /user_id=\?/.test(detail)),
      `${label} must seek by viewer through ${indexName}: ${plan.join(" | ")}`,
    );
  }
});

test("viewer impression reads seek by the viewer/post primary key", () => {
  const sql = `SELECT post_id,seen_count,first_seen_at,last_seen_at FROM post_impressions
    WHERE user_id=? AND post_id IN (?,?)`;
  const plan = queryPlan(sql, "viewer-query-plan", "p_one", "p_two");
  assert.ok(plan.some((detail) => /post_impressions.*user_id=\?.*post_id=\?/i.test(detail)), plan.join(" | "));
});

test("candidate momentum counts distinct non-author commenters, not author volume", () => {
  q.insertUser.run("u_candidate_author", "author@example.test", "Author", "candidateauthor", "hash", "fan", "Toronto", null, null, "AU", "#111111", 1);
  q.insertUser.run("u_candidate_fan", "fan@example.test", "Fan", "candidatefan", "hash", "fan", "Toronto", null, null, "FA", "#222222", 1);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("post_candidate_comments", "u_candidate_author", "Test Artist", "Test Venue", 4, "review", 100);

  const insertComment = db.prepare("INSERT INTO comments (id,post_id,user_id,text,removed,created_at) VALUES (?,?,?,?,?,?)");
  for (let index = 0; index < 12; index++) {
    insertComment.run(`comment_author_${index}`, "post_candidate_comments", "u_candidate_author", "author reply", 0, 101 + index);
  }
  insertComment.run("comment_fan_first", "post_candidate_comments", "u_candidate_fan", "fan reply", 0, 200);
  insertComment.run("comment_fan_repeat", "post_candidate_comments", "u_candidate_fan", "fan reply again", 0, 201);
  insertComment.run("comment_fan_removed", "post_candidate_comments", "u_candidate_fan", "removed reply", 1, 202);

  const row = db.prepare(`${RECOMMENDATION_CANDIDATE_SELECT} WHERE p.id=?`).get("post_candidate_comments");
  assert.equal(row.comment_count, 1);
  const plan = queryPlan(`${RECOMMENDATION_CANDIDATE_SELECT} WHERE p.id=?`, "post_candidate_comments");
  assert.ok(plan.some((detail) => detail.includes("idx_comments_post_distinct_users")), plan.join(" | "));
  assert.equal(plan.some((detail) => /TEMP B-TREE.*count\(DISTINCT\)/i.test(detail)), false, plan.join(" | "));
});

test("recommendation ranking ignores unsupported legacy artist genres", () => {
  assert.equal(projectedRecommendationGenre("Alternative", "{}"), null);
  assert.equal(projectedRecommendationGenre("Pop", JSON.stringify({
    deezerId: 7,
    genreClaims: [{ value: "Pop", source: "provider", at: 1 }],
  })), null);
  assert.equal(projectedRecommendationGenre("Classical", JSON.stringify({
    genreClaims: [{ value: "Classical", source: "staff", at: 1 }],
  })), "Classical");
});

test("candidate scans defer compact genre reads until after filtering", () => {
  assert.doesNotMatch(RECOMMENDATION_CANDIDATE_SELECT, /\bJOIN\s+artists\b|\ba\.data\b|artist_data/i);
  assert.match(ARTIST_GENRE_SQL_COLUMNS, /substr\(/i);

  artistStmts.upsert.run(artistRow("compact legacy genre", {
    name: "Compact Legacy Genre",
    genre: "Alternative",
  }, "legacy"));
  artistStmts.upsert.run(artistRow("compact verified genre", {
    name: "Compact Verified Genre",
    genre: "Classical",
    genreClaims: [{ value: "Classical", source: "staff", at: 1 }],
  }, "staff"));
  const musicBrainzArtistMbid = "11111111-1111-4111-8111-111111111111";
  const musicBrainzGenreId = "22222222-2222-4222-8222-222222222222";
  artistStmts.upsert.run(artistRow("compact musicbrainz genre", {
    name: "Compact MusicBrainz Genre",
    genre: "Hip Hop",
    mbid: musicBrainzArtistMbid,
    genreClaims: [{ value: "Hip Hop", source: "musicbrainz_genre", at: 1 }],
    musicBrainzGenreEvidence: {
      genre: "Hip Hop",
      genreId: musicBrainzGenreId,
      provider: "musicbrainz",
      basis: "artist-genres-v1",
      artistMbid: musicBrainzArtistMbid,
      supportingCount: 3,
      counts: [{ genre: "Hip Hop", id: musicBrainzGenreId, count: 3 }],
      checkedAt: 1,
    },
  }, "musicbrainz"));

  const select = db.prepare(`SELECT ${ARTIST_GENRE_SQL_COLUMNS} FROM artists a WHERE a.norm=?`);
  assert.equal(projectArtistGenreColumns(select.get("compact legacy genre")), null);
  assert.equal(projectArtistGenreColumns(select.get("compact verified genre")), "Classical");
  assert.equal(projectArtistGenreColumns(select.get("compact musicbrainz genre")), "Hip Hop");
});
