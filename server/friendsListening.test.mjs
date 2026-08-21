import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-friends-listening-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

function followAndRecord(viewerId, followedId, createdAt) {
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(viewerId, followedId);
  db.prepare(`INSERT INTO plays (id,user_id,title,artist,url,art,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    `play_${followedId}`,
    followedId,
    `Track by ${followedId}`,
    "Test Artist",
    `https://example.com/${followedId}`,
    `https://example.com/${followedId}.jpg`,
    createdAt,
  );
}

test("friends listening excludes banned and currently suspended public users", () => {
  const viewer = addUser("friends_viewer");
  const active = addUser("friends_active");
  const expired = addUser("friends_expired");
  const suspended = addUser("friends_suspended");
  const banned = addUser("friends_banned");
  const timestamp = Date.now();

  followAndRecord(viewer.id, active.id, timestamp + 4);
  followAndRecord(viewer.id, expired.id, timestamp + 3);
  followAndRecord(viewer.id, suspended.id, timestamp + 2);
  followAndRecord(viewer.id, banned.id, timestamp + 1);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(timestamp - 1, expired.id);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(timestamp + 60_000, suspended.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);

  const result = routes["GET /api/plays/friends"]({ user: viewer });

  assert.deepEqual(result.listening.map(({ user }) => user.id), [active.id, expired.id]);
  assert.equal(result.listening.some(({ user }) => user.id === suspended.id), false);
  assert.equal(result.listening.some(({ user }) => user.id === banned.id), false);
});
