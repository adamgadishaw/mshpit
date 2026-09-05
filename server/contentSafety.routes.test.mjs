import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-content-safety-routes-"));
process.env.PIT_DATA_DIR = dataDir;

const { artistRow, artistStmts, db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan", artistName = null) {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", role, "Toronto", 43.65, -79.38, "TU", "#123456", Date.now());
  // This suite exercises each route's content boundary, not its email gate.
  // Attendance now correctly requires a verified member before authored text is evaluated.
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  if (artistName) db.prepare("UPDATE users SET artist_name=? WHERE id=?").run(artistName, id);
  return q.userById.get(id);
}

const member = addUser("safety_member");
const other = addUser("safety_other");
const artist = addUser("safety_artist", "artist", "Safety Artist");
const safePostId = "safety_existing_post";
const loungeKey = "safety artist|safety room|2026-08-14";

artistStmts.upsert.run(artistRow("safety artist", { name: "Safety Artist" }, "test"));
db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at)
  VALUES (?,?,?,?,?,?,?,?)`).run(safePostId, member.id, "Safety Artist", "Safety Room", 4, "A normal review", "[]", Date.now());
db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("safety artist", member.id);
db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date) VALUES (?,?,?,?,?,?)")
  .run(member.id, loungeKey, "Safety Artist", "Safety Room", "Toronto", "2026-08-14");
db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,feed_enabled,updated_at) VALUES (?,?,?,?)")
  .run("safety artist", artist.id, 1, Date.now());
db.prepare("INSERT INTO playlists (id,user_id,name,tracks,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run("safety_playlist", member.id, "Safe playlist", JSON.stringify([{ title: "Safe track", artist: "Safe artist" }]), "public", Date.now(), Date.now());

function ctx(user, suffix, body = {}, params = {}) {
  return { user, ip: `content-safety-${suffix}`, body, params, query: {} };
}

function rejected(run, label) {
  assert.throws(run, (error) => error instanceof ApiError
    && error.status === 422
    && error.code === "CONTENT_REJECTED"
    && !error.message.toLowerCase().includes("white power"), label);
}

test("every public or social authored write rejects unsafe text before persistence", () => {
  const validTrack = { title: "Safe track", artist: "Safe artist", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
  const unsafeTrack = { ...validTrack, title: "white power" };

  const cases = [
    ["signup profile name", () => routes["POST /api/signup"](ctx(null, "signup", {
      name: "White Power", email: "new-safety@example.com", password: "SafetyPass123", genres: ["Rock"], ageBand: "18_plus", termsVersion: "2026-09-02",
    }))],
    ["profile handle", () => routes["PATCH /api/me"](ctx(member, "profile", { handle: "whitepower" }))],
    ["post body", () => routes["POST /api/posts"](ctx(member, "post-body", {
      kind: "status", review: "Go kill yourself now",
    }))],
    ["post alternate artist field", () => routes["POST /api/posts"](ctx(member, "post-artist", {
      artist: "white power", artistKey: null, venue: "Safety Room", overall: 4, review: "A normal review",
    }))],
    ["post edit array field", () => routes["PATCH /api/posts/:id"](ctx(member, "post-edit", {
      setlist: ["white power"],
    }, { id: safePostId }))],
    ["comment", () => routes["POST /api/posts/:id/comments"](ctx(member, "comment", {
      text: "Go kill yourself now",
    }, { id: safePostId }))],
    ["direct message", () => routes["POST /api/dms/:otherId"](ctx(member, "dm", {
      text: "Go kill yourself now",
    }, { otherId: other.id }))],
    ["fan-club message", () => routes["POST /api/fanclubs/:artist/messages"](ctx(member, "fan", {
      text: "Go kill yourself now",
    }, { artist: "safety%20artist" }))],
    ["lounge message", () => routes["POST /api/lounges/:key/messages"](ctx(member, "lounge", {
      text: "Go kill yourself now",
    }, { key: encodeURIComponent(loungeKey) }))],
    ["venue review", () => routes["POST /api/venues/:key/reviews"](ctx(member, "venue", {
      rating: 4, text: "Go kill yourself now",
    }, { key: "safety%20room" }))],
    ["artist request", () => routes["POST /api/artist-requests"](ctx(member, "artist-request", {
      artistName: "Safe Artist", note: "Go kill yourself now",
    }))],
    ["artist bio", () => routes["PATCH /api/artists/:key/profile"](ctx(artist, "artist-bio", {
      bio: "Go kill yourself now",
    }, { key: "safety%20artist" }))],
    ["artist update", () => routes["POST /api/artists/:key/posts"](ctx(artist, "artist-post", {
      text: "Go kill yourself now",
    }, { key: "safety%20artist" }))],
    ["playlist name", () => routes["POST /api/playlists"](ctx(member, "playlist-name", {
      name: "white power", tracks: [validTrack],
    }))],
    ["playlist track metadata", () => routes["POST /api/playlists"](ctx(member, "playlist-track", {
      name: "Safe playlist", tracks: [unsafeTrack],
    }))],
    ["playlist patch track metadata", () => routes["PATCH /api/playlists/:id"](ctx(member, "playlist-patch", {
      tracks: [unsafeTrack],
    }, { id: "safety_playlist" }))],
    ["friends-listening metadata", () => routes["POST /api/plays"](ctx(member, "play", {
      title: "white power", artist: "Safe Artist",
    }))],
    ["attendance display metadata", () => routes["POST /api/going"](ctx(member, "going", {
      key: "unsafe|room|2026-08-15", going: true, artist: "white power", venue: "Safety Room", city: "Toronto", date: "2026-08-15",
    }))],
  ];

  for (const [label, run] of cases) rejected(run, label);

  assert.equal(db.prepare("SELECT COUNT(*) count FROM users").get().count, 3);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM posts").get().count, 1);
  for (const table of ["comments", "dms", "fan_club_messages", "lounge_messages", "venue_reviews", "artist_requests", "artist_posts", "plays"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0, table);
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM playlists").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM going").get().count, 1);
  assert.equal(q.userById.get(member.id).handle, member.handle);
  assert.equal(db.prepare("SELECT bio FROM artist_profiles WHERE artist_key='safety artist'").get().bio, null);
});
