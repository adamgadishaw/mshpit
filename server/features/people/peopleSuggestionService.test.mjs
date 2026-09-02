import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createPeopleSuggestionService } from "./peopleSuggestionService.js";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,name TEXT,handle TEXT,initials TEXT,avatar_uri TEXT,avatar_color TEXT,
      verified INTEGER DEFAULT 0,role TEXT DEFAULT 'fan',home_city TEXT,home_lat REAL,home_lng REAL,
      genres TEXT DEFAULT '[]',favorite_artists TEXT DEFAULT '[]',is_banned INTEGER DEFAULT 0,
      suspended_until INTEGER,profile_updated_at INTEGER DEFAULT 0,profile_audience TEXT DEFAULT 'everyone'
    );
    CREATE TABLE follows (follower_id TEXT,followee_id TEXT,PRIMARY KEY(follower_id,followee_id));
    CREATE TABLE blocks (blocker_id TEXT,blocked_id TEXT,PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE account_mutes (muter_id TEXT,muted_id TEXT,PRIMARY KEY(muter_id,muted_id));
    CREATE TABLE posts (id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,artist TEXT,venue TEXT,date TEXT,
      removed INTEGER DEFAULT 0,experience_type TEXT NOT NULL DEFAULT 'in_person');
  `);
  const insert = database.prepare(`INSERT INTO users
    (id,name,handle,initials,avatar_uri,home_city,home_lat,home_lng,genres,favorite_artists,is_banned,suspended_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("me", "Me", "me", "ME", null, "Toronto", 43.65, -79.38, '["R&B"]', '["Bryson Tiller"]', 0, null);
  insert.run("match", "Taste Match", "match", "TM", "https://media.test/match.jpg", "Mississauga", 43.59, -79.64, '["R&B"]', '["Bryson Tiller"]', 0, null);
  insert.run("followed", "Followed", "followed", "FO", null, "Toronto", 43.66, -79.39, "[]", "[]", 0, null);
  insert.run("blocked", "Blocked", "blocked", "BL", null, "Toronto", 43.66, -79.39, "[]", "[]", 0, null);
  insert.run("mineblocked", "Mine Blocked", "mineblocked", "MB", null, "Toronto", 43.66, -79.39, "[]", "[]", 0, null);
  insert.run("banned", "Banned", "banned", "BA", null, "Toronto", 43.66, -79.39, "[]", "[]", 1, null);
  insert.run("far", "Far Fan", "far", "FF", null, "Lisbon", 38.72, -9.14, "[]", "[]", 0, null);
  database.prepare("INSERT INTO follows VALUES (?,?)").run("me", "followed");
  database.prepare("INSERT INTO blocks VALUES (?,?)").run("blocked", "me");
  database.prepare("INSERT INTO blocks VALUES (?,?)").run("me", "mineblocked");
  const insertPost = database.prepare(`INSERT INTO posts
    (id,user_id,kind,artist,venue,date,removed,experience_type) VALUES (?,?,?,?,?,?,0,?)`);
  insertPost.run("post-1", "match", "review", "Bryson Tiller", "Arena", "2026-09-16", "in_person");
  insertPost.run("post-2", "match", "review", "Bryson Tiller", "Arena", "2026-09-16", "in_person");
  insertPost.run("post-online", "match", "review", "Bryson Tiller", "", "", "online");
  const projectUser = (row) => ({
    id: row.id, name: row.name, handle: row.handle, initials: row.initials,
    avatarUri: row.avatar_uri, avatarColor: row.avatar_color, verified: !!row.verified,
    role: row.role, home: row.home_city ? { city: row.home_city } : null,
    profileUpdatedAt: Number(row.profile_updated_at) || 0,
  });
  return { database, service: createPeopleSuggestionService(database, { projectUser }) };
}

test("people suggestion service excludes follows, blocks, inactive accounts, and private location", () => {
  const { database, service } = fixture();
  try {
    const viewer = database.prepare("SELECT * FROM users WHERE id='me'").get();
    const result = service.list(viewer, { limit: 5 });
    assert.deepEqual(result.map((entry) => entry.user.id), ["match", "far"]);
    assert.equal(result[0].user.avatarUri, "https://media.test/match.jpg");
    assert.equal(result[0].showCount, 1, "online reviews do not increase concert counts");
    assert.equal("home_lat" in result[0].user, false);
    assert.equal("lat" in (result[0].user.home || {}), false);
    assert.equal("distanceKm" in result[0], false);
    assert.equal(JSON.stringify(result).includes("favorite_artists"), false);
  } finally {
    database.close();
  }
});

test("people suggestion service is authenticated by construction and capped at five", () => {
  const { database, service } = fixture();
  try {
    assert.deepEqual(service.list(null), []);
    const viewer = database.prepare("SELECT * FROM users WHERE id='me'").get();
    assert.ok(service.list(viewer, { limit: 999 }).length <= 5);
  } finally {
    database.close();
  }
});

test("people suggestions honor the viewer's private one-way mute list", () => {
  const { database, service } = fixture();
  try {
    database.prepare("INSERT INTO account_mutes VALUES (?,?)").run("me", "match");
    const viewer = database.prepare("SELECT * FROM users WHERE id='me'").get();
    const result = service.list(viewer, { limit: 5 });
    assert.equal(result.some((entry) => entry.user.id === "match"), false);
    assert.equal(result.some((entry) => entry.user.id === "far"), true);
  } finally {
    database.close();
  }
});
