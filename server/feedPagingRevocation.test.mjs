import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-feed-page-revocation-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

let serial = 0;
function fixture(section) {
  const key = `page_revoke_${++serial}`;
  const at = Date.now() - 1000;
  function addUser(suffix) {
    const id = `${key}_${suffix}`;
    q.insertUser.run(id, `${id}@example.test`, id, id, "hash", "fan", key, null, null, "PR", "#123456", at);
    return q.userById.get(id);
  }
  const viewer = addUser("viewer"), author = addUser("author");
  db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(viewer.id, author.id);
  const postIds = [];
  for (let index = 0; index < 25; index++) {
    const id = `${key}_post_${index}`;
    db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,created_at) VALUES(?,?,?,'Venue',4,?)")
      .run(id, author.id, "Artist", at - index);
    postIds.push(id);
  }
  // For You is global: isolate this viewer from prior fixtures so the ranked
  // head and chronological tail positions are deliberate and reproducible.
  db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) SELECT ?,id,? FROM users WHERE id<>? AND id<>?")
    .run(viewer.id, at, viewer.id, author.id);
  const forYou = section.startsWith("for-you");
  const read = (cursor = null) => routes[forYou ? "GET /api/feed/for-you" : "GET /api/feed"]({
    user: q.userById.get(viewer.id), ip: key,
    query: { mode: section, limit: section === "for-you-tail" ? "12" : "1",
      ...(cursor ? { [forYou ? "cursor" : "before"]: cursor } : {}) },
  });
  return { viewer, author, read, postIds };
}

for (const section of ["for-you", "for-you-tail", "local", "following"]) {
  for (const restriction of ["block-by-viewer", "block-by-author", "mute", "banned", "suspended", "dormant", "removed"]) {
    test(`${section} rechecks ${restriction} between issued pages`, () => {
      const { viewer, author, read } = fixture(section);
      const first = read();
      assert.ok(first.posts.length);
      assert.ok(first.nextCursor);
      if (restriction.startsWith("block")) {
        const pair = restriction === "block-by-viewer" ? [viewer.id, author.id] : [author.id, viewer.id];
        db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(...pair, Date.now());
      } else if (restriction === "mute") {
        db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) VALUES(?,?,?)").run(viewer.id, author.id, Date.now());
      } else if (restriction === "removed") {
        db.prepare("UPDATE posts SET removed=1 WHERE user_id=?").run(author.id);
      } else {
        const column = { banned: "is_banned", suspended: "suspended_until", dormant: "dormant_at" }[restriction];
        db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(restriction === "banned" ? 1 : Date.now() + 60_000, author.id);
      }
      const next = read(first.nextCursor);
      assert.deepEqual(next.posts, []);
      assert.equal(next.nextCursor, null);
    });
  }

  test(`${section} reprojects badge revocation and hidden profile preferences on subsequent pages`, () => {
    const { author, read } = fixture(section);
    db.prepare("UPDATE users SET verified=1,sponsor=1,role='moderator',extras=? WHERE id=?")
      .run(JSON.stringify({ profileBadges: ["verified"] }), author.id);
    const first = read();
    assert.equal(first.posts[0].user.verified, true);
    db.prepare("UPDATE users SET verified=0,sponsor=0,role='fan',extras=? WHERE id=?")
      .run(JSON.stringify({ profileBadges: [] }), author.id);
    const second = read(first.nextCursor);
    assert.ok(second.posts.length);
    for (const post of second.posts) {
      assert.equal(post.user.verified, false);
      assert.equal(post.user.sponsor, false);
      assert.equal(post.user.role, "fan");
      assert.deepEqual(post.user.profileBadges, []);
    }
    assert.ok(second.nextCursor);
    db.prepare("UPDATE users SET verified=1,sponsor=1,role='moderator',profile_audience='only_me',extras=? WHERE id=?")
      .run(JSON.stringify({ profileBadges: ["verified"] }), author.id);
    const third = read(second.nextCursor);
    assert.ok(third.posts.length, "public posts remain available when profile audience changes");
    for (const post of third.posts) {
      assert.equal(post.user.verified, false);
      assert.equal(post.user.sponsor, false);
      assert.equal(post.user.role, "fan");
      assert.deepEqual(post.user.profileBadges, []);
    }
  });
}

test("Following rechecks an unfollow between issued pages", () => {
  const { viewer, author, read } = fixture("following");
  const first = read();
  assert.ok(first.nextCursor);
  db.prepare("DELETE FROM follows WHERE follower_id=? AND followee_id=?").run(viewer.id, author.id);
  const next = read(first.nextCursor);
  assert.deepEqual(next.posts, []);
  assert.equal(next.nextCursor, null);
});
