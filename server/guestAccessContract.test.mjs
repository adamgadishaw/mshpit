import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-guest-access-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

const ownerId = "u_guest_contract_owner";
const postId = "p_guest_contract_review";
const commentId = "c_guest_contract_comment";
const playlistId = "pl_guest_contract_playlist";
const artistKey = "guest contract artist";
const artistName = "Guest Contract Artist";
const showKey = `${artistKey}|guest venue|2099-01-01`;
const at = Date.now();
q.insertUser.run(ownerId, "guest-contract@example.test", "Public Artist", "guest_contract_owner",
  "test-hash", "artist", "Toronto", 43.65, -79.38, "PA", "#123456", at);
db.prepare("INSERT INTO artists (norm,name,created_at,updated_at) VALUES (?,?,?,?)")
  .run(artistKey, artistName, at, at);
db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,feed_enabled,updated_at) VALUES (?,?,?,?,?)")
  .run(artistKey, ownerId, "Public artist biography", 1, at);
db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
  .run("ap_guest_contract_update", artistKey, ownerId, "Public artist update", at);
db.prepare("INSERT INTO posts (id,user_id,artist,artist_key,venue,overall,review,kind,date,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .run(postId, ownerId, artistName, artistKey, "Guest Venue", 4, "Public concert review", "review", "2026-01-01", at);
db.prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
  .run(commentId, postId, ownerId, "Public review comment", at);
db.prepare("INSERT INTO playlists (id,user_id,name,created_at) VALUES (?,?,?,?)")
  .run(playlistId, ownerId, "Public playlist", at);

let providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { providerCalls++; throw new Error("Guest contract must not call external services"); };
after(() => { globalThis.fetch = originalFetch; });

function context(overrides = {}) {
  return {
    user: null,
    params: { id: postId, postId, otherId: ownerId, artist: artistKey, key: artistKey, variantId: "mv_guest_contract" },
    query: {}, body: {}, ip: "127.0.0.1", setHeader() {},
    ...overrides,
  };
}

// Real registered handlers: guests must be rejected before input validation,
// database writes or any null-session access, including async media handlers.
const memberRoutes = [
  "POST /api/posts/:id/like", "POST /api/posts/:id/comments", "DELETE /api/posts/:postId/comments/:id",
  "POST /api/posts", "PATCH /api/posts/:id", "DELETE /api/posts/:id",
  "POST /api/users/:id/follow", "POST /api/users/:id/block", "POST /api/users/:id/mute",
  "POST /api/ratings", "POST /api/venues/:key/reviews", "POST /api/going",
  "POST /api/dms/:otherId", "GET /api/dms/:otherId", "GET /api/me/threads",
  "POST /api/fanclubs/:artist/join", "POST /api/fanclubs/:artist/messages", "GET /api/fanclubs/:artist/messages",
  "POST /api/lounges/:key/messages", "GET /api/lounges/:key/messages",
  "POST /api/media/assets", "POST /api/media/assets/:id/finalize", "GET /api/media/assets/:id",
  "PATCH /api/media/assets/:id", "POST /api/media/assets/:id/variants",
  "POST /api/media/assets/:id/variants/:variantId/finalize", "POST /api/media/react",
  "POST /api/reports", "POST /api/tracks/report", "POST /api/share-cards/render",
  "POST /api/playlists", "PATCH /api/playlists/:id", "DELETE /api/playlists/:id", "POST /api/plays",
  "POST /api/feed/preferences/:postId", "DELETE /api/feed/preferences/:postId", "GET /api/feed/preferences",
  "POST /api/feed/impressions", "POST /api/me/notifications/read", "GET /api/me/notifications",
  "GET /api/me/going", "GET /api/me/following", "GET /api/me/blocked", "GET /api/me/muted",
  "GET /api/me/fanclubs", "GET /api/me/plays", "GET /api/plays/friends", "GET /api/artists/seen",
  "GET /api/people/suggestions", "GET /api/me/artist-recommendations",
  "POST /api/artist-requests", "POST /api/artists/resolve", "POST /api/artists/discography/selection",
  "PATCH /api/artists/:key/profile", "POST /api/artists/:key/posts", "DELETE /api/artists/:key/posts/:id",
  "POST /api/tourdates", "PATCH /api/me", "DELETE /api/me", "POST /api/me/password",
  "POST /api/me/email-preferences", "POST /api/me/export", "POST /api/me/onboarding/complete",
  "POST /api/me/analytics-consent",
];

for (const route of memberRoutes) {
  test(`guest contract: ${route} rejects with 401 without database writes`, async () => {
    assert.equal(typeof routes[route], "function", "the protected route must actually exist");
    for (const user of [null, undefined]) {
      const before = db.prepare("SELECT total_changes() AS count").get().count;
      const beforeProviderCalls = providerCalls;
      await assert.rejects(async () => routes[route](context({ user })), (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 401);
        assert.equal(error.code, "AUTH_REQUIRED");
        return true;
      });
      assert.equal(db.prepare("SELECT total_changes() AS count").get().count, before);
      assert.equal(providerCalls, beforeProviderCalls, "guest rejection must not start provider work");
    }
  });
}

const publicReads = [
  ["GET /api/me", {}, (result) => assert.equal(result.user, null)],
  ["GET /api/feed", {}, (result) => assert.ok(result.posts.some((post) => post.id === postId))],
  ["GET /api/feed/for-you", {}, (result) => assert.ok(result.posts.some((post) => post.id === postId))],
  ["GET /api/posts/:id", {}, (result) => assert.equal(result.post.id, postId)],
  ["GET /api/posts/:id/comments", {}, (result) => assert.equal(result.comments[0].text, "Public review comment")],
  ["POST /api/feed/revalidate", { body: { postIds: [postId] } }, (result) => assert.deepEqual(result.invalidPostIds, [])],
  ["POST /api/media/reactions", { body: { urls: [] } }, (result) => assert.deepEqual(result.reactions, {})],
  ["GET /api/artists", { query: { q: artistName } }, (result) => assert.ok(result.artists.some((artist) => artist.name === artistName))],
  ["GET /api/artists/:key/profile", {}, (result) => {
    assert.equal(result.profile.bio, "Public artist biography");
    assert.equal(result.posts[0].text, "Public artist update");
  }],
  ["GET /api/artists/:key/memorial", {}, (result) => assert.equal(result.memorial, null)],
  ["GET /api/artists/:key/live-summary", {}],
  ["GET /api/artists/archive", { query: { artistKey, name: artistName } }, (result) => assert.equal(result.archive.shows.length, 1)],
  ["GET /api/artists/reviews", { query: { artistKey, name: artistName } }, (result) => assert.ok(result.reviews.some((post) => post.id === postId))],
  ["GET /api/ratings", { query: { ref: `${artistKey}|album`, kind: "album" } }, (result) => assert.equal(result.mine, 0)],
  ["GET /api/venues/:key/reviews", { params: { key: "guest venue" } }, (result) => assert.deepEqual(result.reviews, [])],
  ["GET /api/users/:id", { params: { id: ownerId } }, (result) => assert.equal(result.user.id, ownerId)],
  ["GET /api/users/:id/followers", { params: { id: ownerId } }],
  ["GET /api/users/:id/following", { params: { id: ownerId } }],
  ["GET /api/users/:id/badges", { params: { id: ownerId } }],
  ["GET /api/users/:id/posts", { params: { id: ownerId } }, (result) => assert.ok(result.posts.some((post) => post.id === postId))],
  ["GET /api/users/:id/playlists", { params: { id: ownerId } }, (result) => assert.equal(result.playlists[0].id, playlistId)],
  ["GET /api/playlists/:id", { params: { id: playlistId } }, (result) => assert.equal(result.playlist.id, playlistId)],
  ["GET /api/fanclubs/:artist/meta", {}, (result) => assert.equal(result.members, 0)],
  ["GET /api/lounges/:key/meta", { params: { key: showKey } }, (result) => assert.equal(result.attendeeCount, 0)],
  ["GET /api/going/:key/attendees", { params: { key: showKey } }, (result) => {
    assert.deepEqual(result.attendees, []);
    assert.equal(result.viewerAttendance, null);
    assert.equal(result.liveStateRedacted, true);
  }],
  ["GET /api/tourdates", {}, (result) => assert.ok(Array.isArray(result.tourDates))],
  ["GET /api/landing/media", {}, (result) => assert.ok(Array.isArray(result.media))],
  ["GET /api/discovery/sidebar", {}],
];

for (const [route, input, verify] of publicReads) {
  test(`guest contract: ${route} remains readable without a session`, async () => {
    assert.equal(typeof routes[route], "function");
    for (const user of [null, undefined]) {
      const result = await routes[route](context({ ...input, user }));
      assert.equal(typeof result, "object");
      assert.ok(result);
      verify?.(result);
    }
  });
}

test("guest Like and Comment submissions reject valid payloads and preserve the public post", async () => {
  const before = db.prepare("SELECT total_changes() AS count").get().count;
  for (const [route, body] of [
    ["POST /api/posts/:id/like", { liked: true }],
    ["POST /api/posts/:id/comments", { text: "A guest must not publish this" }],
  ]) {
    await assert.rejects(async () => routes[route](context({ body })), {
      status: 401, code: "AUTH_REQUIRED",
    });
  }
  assert.equal(db.prepare("SELECT total_changes() AS count").get().count, before);
  assert.equal(routes["GET /api/posts/:id"](context()).post.id, postId);
  assert.equal(routes["GET /api/posts/:id/comments"](context()).comments.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM likes WHERE post_id=?").get(postId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM artist_tourdate_refresh_queue WHERE artist_key=?").get(artistKey).count, 0,
    "guest artist reads must not enqueue provider refreshes");
  assert.equal(providerCalls, 0);
});
