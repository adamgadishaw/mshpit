import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-unified-search-routes-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, artistRow, artistStmts } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
function addUser({ name, handle }) {
  sequence += 1;
  const id = `search_user_${sequence}`;
  q.insertUser.run(
    id,
    `${id}@example.com`,
    name,
    handle,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    "SU",
    "#123456",
    Date.now() + sequence,
  );
  return q.userById.get(id);
}

test("people search applies self and two-way block privacy before its result limit", () => {
  const viewer = addUser({ name: "Slot Privacy Viewer", handle: "slotprivacyviewer" });
  const target = addUser({ name: "Slot Privacy Zulu", handle: "slotprivacytarget" });
  const insertBlock = db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)");

  for (let index = 0; index < 36; index += 1) {
    const blocked = addUser({
      name: `Slot Privacy ${String(index).padStart(2, "0")}`,
      handle: `slotblocked${index}`,
    });
    if (index % 2 === 0) insertBlock.run(viewer.id, blocked.id, Date.now() + index);
    else insertBlock.run(blocked.id, viewer.id, Date.now() + index);
  }

  const result = routes["GET /api/people"]({
    user: viewer,
    ip: "people-prelimit-privacy",
    query: { q: "slot privacy" },
  });
  assert.deepEqual(result.users.map((user) => user.id), [target.id]);
});

test("people search treats handle punctuation literally instead of as SQL wildcards", () => {
  const viewer = addUser({ name: "Handle Search Viewer", handle: "handlesearchviewer" });
  const underscored = addUser({ name: "Unrelated Display Name", handle: "adam_g" });

  const exact = routes["GET /api/people"]({
    user: viewer,
    ip: "people-literal-underscore",
    query: { q: "adam_g" },
  });
  assert.equal(exact.users[0]?.id, underscored.id);

  const wildcard = routes["GET /api/people"]({
    user: viewer,
    ip: "people-literal-percent",
    query: { q: "%" },
  });
  assert.deepEqual(wildcard.users, []);
});

test("paused-player artist type-ahead returns a bounded summary while resolve keeps full metadata", async () => {
  const name = "Search Payload Contract Artist";
  artistStmts.upsert.run(artistRow(name, {
    name,
    photo: "https://images.example/artist.jpg",
    bio: "A real profile biography.",
    galleryPool: [{ uri: "https://images.example/gallery.jpg", source: "catalog" }],
    albums: Array.from({ length: 12 }, (_, index) => ({
      title: `Release ${index + 1}`,
      tracks: Array.from({ length: 10 }, (__, track) => ({ title: `Track ${track + 1}` })),
    })),
    topTracks: Array.from({ length: 8 }, (_, index) => ({ title: `Popular Track ${index + 1}` })),
    popularity: 90,
  }, "test"));

  const search = routes["GET /api/artists"]({ query: { q: name, limit: 5 } });
  const summary = search.artists.find((artist) => artist.name === name);
  assert.ok(summary);
  assert.equal(summary.searchSummary, true);
  assert.equal(Object.hasOwn(summary, "albums"), false);
  assert.deepEqual(summary.topTracks?.map((track) => track.title), ["Popular Track 1"]);
  assert.equal(summary.bio, "A real profile biography.");
  assert.equal(summary.galleryPool?.[0]?.uri, "https://images.example/gallery.jpg");

  const resolved = await routes["GET /api/artists/resolve"]({
    query: { name },
    signal: new AbortController().signal,
  });
  assert.equal(resolved.artist.albums.length, 12);
  assert.equal(resolved.artist.topTracks.length, 8);
  assert.equal(resolved.artist.searchSummary, undefined);
});

test("cancelled direct song search propagates cancellation instead of returning stale fallback rows", async () => {
  const controller = new AbortController();
  const reason = new DOMException("newer search replaced this request", "AbortError");
  controller.abort(reason);
  await assert.rejects(
    routes["GET /api/songs/search"]({
      query: { q: "cancellation route proof" },
      ip: "song-search-cancellation-route",
      signal: controller.signal,
    }),
    (error) => error === reason,
  );
});
