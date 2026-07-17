import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-media-reactions-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id.replace(/[^a-z0-9_]/g, "").slice(0, 20), "test-hash", role, "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}

const PHOTO = "https://pub-example.r2.dev/users/u_1/post/abc.jpg";

test("photo likes toggle per URL, count per photo, and read back in batch", () => {
  const alice = addUser("mediaalice");
  const bob = addUser("mediabob");
  const react = routes["POST /api/media/react"];
  const read = routes["POST /api/media/reactions"];

  // Two people like the same photo; a hash fragment normalizes away so it
  // cannot split one photo's likes across two keys.
  assert.deepEqual(react({ user: alice, ip: "mr1", body: { url: PHOTO, postId: "p_1" } }), { liked: true, count: 1 });
  assert.deepEqual(react({ user: bob, ip: "mr2", body: { url: PHOTO + "#frag" } }), { liked: true, count: 2 });

  // Toggling off removes only the caller's like.
  assert.deepEqual(react({ user: alice, ip: "mr1", body: { url: PHOTO } }), { liked: false, count: 1 });

  // Batch read: counts are public, `mine` reflects the signed-in viewer.
  const asBob = read({ user: bob, ip: "mr2", body: { urls: [PHOTO, "https://other.example/x.jpg"] } });
  assert.deepEqual(asBob.reactions[PHOTO], { count: 1, mine: true });
  assert.deepEqual(asBob.reactions["https://other.example/x.jpg"], { count: 0, mine: false });
  const anon = read({ user: null, ip: "anon", body: { urls: [PHOTO] } });
  assert.deepEqual(anon.reactions[PHOTO], { count: 1, mine: false });
});

test("only real https URLs can carry a like", () => {
  const user = addUser("mediastrict");
  const react = routes["POST /api/media/react"];
  for (const bad of ["http://insecure.example/a.jpg", "javascript:alert(1)", "not a url", "https://user:pw@host/x.jpg", ""]) {
    assert.throws(
      () => react({ user, ip: "mr-bad", body: { url: bad } }),
      (error) => error instanceof ApiError && error.status === 400,
      `should reject: ${bad}`
    );
  }
});
