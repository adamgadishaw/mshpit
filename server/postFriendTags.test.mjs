import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-post-friend-tags-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id.slice(0, 20), "test-hash", "fan", "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}

function makeMutual(leftId, rightId) {
  db.prepare("INSERT OR IGNORE INTO follows (follower_id,followee_id) VALUES (?,?)").run(leftId, rightId);
  db.prepare("INSERT OR IGNORE INTO follows (follower_id,followee_id) VALUES (?,?)").run(rightId, leftId);
}

test("structured post tags project public people and notify only newly added recipients once", () => {
  const owner = addUser("tag_owner");
  const friend = addUser("tag_friend");
  const later = addUser("tag_later");
  makeMutual(owner.id, friend.id);
  makeMutual(owner.id, later.id);
  const create = routes["POST /api/posts"];
  const edit = routes["PATCH /api/posts/:id"];
  const body = {
    clientMutationId: "friend_tag_create_retry_001",
    kind: "status",
    review: "front row together",
    taggedUserIds: [friend.id, friend.id],
  };

  const made = create({ user: owner, ip: "tag-create", body });
  assert.deepEqual(made.post.taggedPeople.map((person) => person.id), [friend.id]);
  assert.deepEqual(
    db.prepare("SELECT user_id,author_id,position FROM post_user_tags WHERE post_id=? ORDER BY position")
      .all(made.id).map((row) => ({ ...row })),
    [{ user_id: friend.id, author_id: owner.id, position: 0 }],
    "the indexed relation is synchronized with the compatibility JSON column",
  );
  assert.deepEqual(Object.keys(made.post.taggedPeople[0]).sort(), [
    "avatarColor", "avatarUri", "handle", "id", "initials", "name", "role", "verified",
  ]);
  assert.deepEqual(
    db.prepare("SELECT user_id,type FROM notifications WHERE post_id=? ORDER BY user_id").all(made.id).map((row) => ({ ...row })),
    [{ user_id: friend.id, type: "post_tag" }],
  );

  const retry = create({ user: owner, ip: "tag-create-retry", body });
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE post_id=? AND type='post_tag'").get(made.id).count, 1);

  const copyEdit = edit({
    user: owner,
    ip: "tag-copy-edit",
    params: { id: made.id },
    body: { review: "same friends, better wording", taggedUserIds: [friend.id], version: made.post.version },
  });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE post_id=? AND type='post_tag'").get(made.id).count, 1);

  const added = edit({
    user: owner,
    ip: "tag-add-edit",
    params: { id: made.id },
    body: { taggedUserIds: [friend.id, later.id], version: copyEdit.post.version },
  });
  assert.deepEqual(added.post.taggedPeople.map((person) => person.id), [friend.id, later.id]);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE post_id=? AND type='post_tag'").get(made.id).count, 2);

  const removed = edit({
    user: owner,
    ip: "tag-remove-edit",
    params: { id: made.id },
    body: { taggedUserIds: [later.id], version: added.post.version },
  });
  const readded = edit({
    user: owner,
    ip: "tag-readd-edit",
    params: { id: made.id },
    body: { taggedUserIds: [later.id, friend.id], version: removed.post.version },
  });
  assert.deepEqual(readded.post.taggedPeople.map((person) => person.id), [later.id, friend.id]);
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM notifications WHERE post_id=? AND user_id=? AND type='post_tag'").get(made.id, friend.id).count,
    1,
    "remove/re-add must not generate duplicate tag activity",
  );
});

test("recipients can durably remove themselves while unrelated accounts cannot mutate guessed posts", () => {
  const owner = addUser("untag_owner");
  const friend = addUser("untag_friend");
  const stranger = addUser("untag_stranger");
  makeMutual(owner.id, friend.id);
  const made = routes["POST /api/posts"]({
    user: owner,
    ip: "untag-create",
    body: { kind: "status", review: "shared night", taggedUserIds: [friend.id] },
  });
  const removeSelf = routes["DELETE /api/posts/:id/tags/me"];

  assert.throws(
    () => removeSelf({ user: stranger, ip: "untag-stranger", params: { id: made.id } }),
    (error) => error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND",
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM post_tag_rejections WHERE post_id=? AND user_id=?").get(made.id, stranger.id).count, 0);

  const removed = removeSelf({ user: friend, ip: "untag-friend", params: { id: made.id } });
  assert.equal(Object.prototype.hasOwnProperty.call(removed, "taggedUserIds"), false);
  assert.equal(db.prepare("SELECT tagged_user_ids FROM posts WHERE id=?").get(made.id).tagged_user_ids, "[]");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM post_user_tags WHERE post_id=?").get(made.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM post_tag_rejections WHERE post_id=? AND user_id=?").get(made.id, friend.id).count, 1);
  assert.deepEqual(removeSelf({ user: friend, ip: "untag-retry", params: { id: made.id } }), removed);

  const ownerSearch = routes["GET /api/people"]({
    user: owner,
    ip: "untag-owner-search",
    query: { q: friend.handle, scope: "post_tag", postId: made.id },
  });
  assert.deepEqual(ownerSearch.users, [], "a durable self-removal disappears from this post's edit picker");
  assert.equal(ownerSearch.total, 0);
  assert.throws(
    () => routes["GET /api/people"]({
      user: stranger,
      ip: "untag-foreign-search",
      query: { q: "", scope: "post_tag", postId: made.id },
    }),
    (error) => error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND",
    "a post id cannot be used to probe another author's rejection list",
  );

  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user: owner,
      ip: "untag-author-readd",
      params: { id: made.id },
      body: { taggedUserIds: [friend.id], version: removed.version },
    }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
    "an author's next edit must respect the recipient's durable refusal",
  );
});

test("self-removal never exposes co-tag ids hidden from the viewer", () => {
  const owner = addUser("private_tag_owner");
  const left = addUser("private_tag_left");
  const right = addUser("private_tag_right");
  makeMutual(owner.id, left.id);
  makeMutual(owner.id, right.id);
  const made = routes["POST /api/posts"]({
    user: owner,
    ip: "private-tag-create",
    body: { kind: "status", review: "shared night", taggedUserIds: [left.id, right.id] },
  });

  // Neither blocked account authored the post, so the stored co-tag remains;
  // viewer projection must still conceal it from the other recipient.
  routes["POST /api/users/:id/block"]({
    user: left,
    ip: "private-tag-block",
    params: { id: right.id },
    body: { blocked: true },
  });
  const projected = routes["GET /api/posts/:id"]({ user: left, params: { id: made.id } });
  assert.deepEqual(projected.post.taggedPeople.map((person) => person.id), [left.id]);

  const removed = routes["DELETE /api/posts/:id/tags/me"]({
    user: left,
    ip: "private-tag-remove",
    params: { id: made.id },
  });
  assert.deepEqual(Object.keys(removed).sort(), ["id", "ok", "version"]);
  assert.deepEqual(JSON.parse(db.prepare("SELECT tagged_user_ids FROM posts WHERE id=?").get(made.id).tagged_user_ids), [right.id]);
  assert.deepEqual(
    db.prepare("SELECT user_id FROM post_user_tags WHERE post_id=? ORDER BY position").all(made.id).map((row) => row.user_id),
    [right.id],
  );
});

test("new tags require active, unblocked accounts and projections fail closed after a later block", () => {
  const owner = addUser("guard_owner");
  const visible = addUser("guard_visible");
  const blocked = addUser("guard_blocked");
  const inactive = addUser("guard_inactive");
  makeMutual(owner.id, visible.id);
  makeMutual(owner.id, blocked.id);
  makeMutual(owner.id, inactive.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(inactive.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(owner.id, blocked.id, Date.now());
  const create = routes["POST /api/posts"];
  const reject = (taggedUserIds, ip) => assert.throws(
    () => create({ user: owner, ip, body: { kind: "status", review: "guarded", taggedUserIds } }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );

  reject([owner.id], "guard-self");
  reject([blocked.id], "guard-blocked");
  reject([inactive.id], "guard-inactive");
  reject(Array.from({ length: 9 }, (_, index) => `too-many-${index}`), "guard-max");

  const made = create({ user: owner, ip: "guard-visible", body: { kind: "status", review: "visible", taggedUserIds: [visible.id] } });
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(visible.id, owner.id, Date.now());
  const read = routes["GET /api/posts/:id"]({ user: owner, params: { id: made.id } });
  assert.deepEqual(read.post.taggedPeople, []);
});

test("new tags require a mutual follow while exact committed create retries survive a later unfollow", () => {
  const owner = addUser("consent_owner");
  const mutual = addUser("consent_mutual");
  const oneWay = addUser("consent_oneway");
  const disconnected = addUser("consent_none");
  makeMutual(owner.id, mutual.id);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(owner.id, oneWay.id);
  const create = routes["POST /api/posts"];
  const reject = (recipient, ip) => assert.throws(
    () => create({ user: owner, ip, body: { kind: "status", review: "consent boundary", taggedUserIds: [recipient.id] } }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );

  reject(oneWay, "consent-one-way");
  reject(disconnected, "consent-disconnected");
  const body = {
    clientMutationId: "consent_retry_001",
    kind: "status",
    review: "mutual friends",
    taggedUserIds: [mutual.id],
  };
  const made = create({ user: owner, ip: "consent-create", body });
  db.prepare("DELETE FROM follows WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)")
    .run(owner.id, mutual.id, mutual.id, owner.id);
  const retry = create({ user: owner, ip: "consent-retry", body });
  assert.equal(retry.id, made.id);
  assert.equal(retry.duplicate, true);
  reject(mutual, "consent-new-after-unfollow");
});

test("post-tag composer scope returns only active mutual-follow friends", () => {
  const owner = addUser("friend_search_owner");
  const mutual = addUser("friend_search_mutual");
  const oneWay = addUser("friend_search_oneway");
  const reverseOnly = addUser("friend_search_reverse");
  makeMutual(owner.id, mutual.id);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(owner.id, oneWay.id);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(reverseOnly.id, owner.id);

  const scoped = routes["GET /api/people"]({ user: owner, query: { q: "mutual", scope: "post_tag" } });
  assert.deepEqual(scoped.users.map((user) => user.id), [mutual.id]);
  assert.equal(scoped.total, 1);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(mutual.id, owner.id, Date.now());
  const blockedScoped = routes["GET /api/people"]({ user: owner, query: { q: "mutual", scope: "post_tag" } });
  assert.deepEqual(blockedScoped.users, []);
  assert.equal(blockedScoped.total, 0, "the eligible count must not leak a blocked mutual friend");
  const general = routes["GET /api/people"]({ user: owner, query: { q: "oneway" } });
  assert.ok(general.users.some((user) => user.id === oneWay.id));
  const reverse = routes["GET /api/people"]({ user: owner, query: { q: "reverse" } });
  assert.ok(reverse.users.some((user) => user.id === reverseOnly.id));
});

test("one actor cannot tag the same recipient in more than three distinct posts per 24 hours", () => {
  const owner = addUser("budget_owner");
  const friend = addUser("budget_friend");
  makeMutual(owner.id, friend.id);
  const create = routes["POST /api/posts"];
  for (let index = 0; index < 3; index += 1) {
    create({
      user: owner,
      ip: `budget-create-${index}`,
      body: { kind: "status", review: `shared night ${index}`, taggedUserIds: [friend.id] },
    });
  }
  assert.throws(
    () => create({ user: owner, ip: "budget-create-4", body: { kind: "status", review: "too many", taggedUserIds: [friend.id] } }),
    (error) => error instanceof ApiError && error.status === 429 && error.code === "RATE_LIMITED",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM notifications WHERE actor_id=? AND user_id=? AND type='post_tag'").get(owner.id, friend.id).count,
    3,
  );
});

test("create and patch revalidate new tag consent while holding the immediate write transaction", () => {
  const source = readFileSync(new URL("./api.js", import.meta.url), "utf8");
  const createStart = source.indexOf('"POST /api/posts":');
  const patchStart = source.indexOf('"PATCH /api/posts/:id":');
  const patchEnd = source.indexOf('"POST /api/posts/:id/like":');
  const createSlice = source.slice(createStart, patchStart);
  const patchSlice = source.slice(patchStart, patchEnd);
  assert.match(createSlice, /atomicWrite\(\(\) => \{[\s\S]*validatedPostTaggedUserIds[\s\S]*postRow\.run/);
  assert.match(patchSlice, /atomicWrite\(\(\) => \{[\s\S]*SELECT tagged_user_ids,COALESCE\(updated_at,created_at\) AS version[\s\S]*validatedPostTaggedUserIds[\s\S]*UPDATE posts SET/);
  assert.match(patchSlice, /const transactionRequestedIds = has\("taggedUserIds"\) \? nextTaggedUserIds : transactionCommittedIds/);
});

test("blocking scrubs existing structured associations in both authorship directions", () => {
  const left = addUser("block_tag_left");
  const right = addUser("block_tag_right");
  const unrelatedOwner = addUser("untargeted_owner_tag");
  const unrelatedFriend = addUser("untargeted_friend_tag");
  makeMutual(left.id, right.id);
  makeMutual(unrelatedOwner.id, unrelatedFriend.id);
  const create = routes["POST /api/posts"];
  const leftPost = create({ user: left, ip: "block-tag-left-post", body: { kind: "status", review: "left", taggedUserIds: [right.id] } });
  const rightPost = create({ user: right, ip: "block-tag-right-post", body: { kind: "status", review: "right", taggedUserIds: [left.id] } });
  const unrelatedPost = create({
    user: unrelatedOwner,
    ip: "block-tag-unrelated-post",
    body: { kind: "status", review: "unrelated", taggedUserIds: [unrelatedFriend.id] },
  });

  const result = routes["POST /api/users/:id/block"]({
    user: left,
    ip: "block-tag-route",
    params: { id: right.id },
    body: { blocked: true },
  });
  assert.equal(result.blocked, true);
  assert.equal(db.prepare("SELECT tagged_user_ids FROM posts WHERE id=?").get(leftPost.id).tagged_user_ids, "[]");
  assert.equal(db.prepare("SELECT tagged_user_ids FROM posts WHERE id=?").get(rightPost.id).tagged_user_ids, "[]");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM post_user_tags WHERE post_id IN (?,?)").get(leftPost.id, rightPost.id).count, 0);
  assert.deepEqual(
    db.prepare("SELECT user_id FROM post_user_tags WHERE post_id=?").all(unrelatedPost.id).map((row) => row.user_id),
    [unrelatedFriend.id],
    "targeted cleanup must not rewrite unrelated tagged posts",
  );
});

test("feed and profile pages batch project normalized friend tags", () => {
  const owner = addUser("batch_tag_owner");
  const friends = Array.from({ length: 8 }, (_, index) => addUser(`batch_tag_friend_${index}`));
  for (const friend of friends) makeMutual(owner.id, friend.id);
  const create = routes["POST /api/posts"];
  const postIds = [];
  for (let index = 0; index < 3; index += 1) {
    postIds.push(create({
      user: owner,
      ip: `batch-tag-create-${index}`,
      body: { kind: "status", review: `batch ${index}`, taggedUserIds: friends.map((friend) => friend.id) },
    }).id);
  }

  const feed = routes["GET /api/feed"]({ user: owner, query: { limit: "100" } });
  const feedPosts = feed.posts.filter((post) => postIds.includes(post.id));
  assert.equal(feedPosts.length, postIds.length);
  assert.ok(feedPosts.every((post) => post.taggedPeople.length === friends.length));

  const profile = routes["GET /api/users/:id/posts"]({
    user: owner,
    params: { id: owner.id },
    query: { limit: "50" },
  });
  assert.equal(profile.posts.length, postIds.length);
  assert.ok(profile.posts.every((post) => post.taggedPeople.length === friends.length));

  const source = readFileSync(new URL("./api.js", import.meta.url), "utf8");
  const projector = source.slice(source.indexOf("function withTaggedPeople"), source.indexOf("function requestedPostMediaSelection"));
  assert.match(projector, /FROM post_user_tags t JOIN users u/);
  assert.doesNotMatch(projector, /for \(const id of/,
    "page projection must not issue one user/block query per tagged account");
  assert.match(source.slice(source.indexOf('"GET \/api\/feed"'), source.indexOf('"GET \/api\/feed\/for-you"')), /withTaggedPeople/);
  assert.match(source.slice(source.indexOf('"GET \/api\/users\/:id\/posts"'), source.indexOf('"POST \/api\/posts"')), /withTaggedPeople/);
});
