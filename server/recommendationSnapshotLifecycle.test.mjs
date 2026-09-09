import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { parse } from "@babel/parser";
import { ApiError } from "./errors.js";
import * as ranking from "./recommendationRanking.js";
import * as visibility from "./accountVisibility.js";
import * as genre from "../src/domain/genre.mjs";
import * as genreProjection from "./artistGenreProjection.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-recommendation-snapshot-"));
process.env.PIT_DATA_DIR = dataDir;
const database = await import("./db.js");
const impressions = await import("./feedImpressions.js");
const { db, q } = database;
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

// Run the actual module declarations against the fixture database. Inspect its
// private cache maps only through this test seam, without adding runtime exports.
const source = readFileSync(new URL("./recommendationService.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const code = ast.program.body.flatMap((node) => {
  if (node.type === "ImportDeclaration") return [];
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  return declaration ? [source.slice(declaration.start, declaration.end)] : [];
}).join("\n");
const modules = { "node:crypto": { randomUUID }, "./db.js": database, "./errors.js": { ApiError },
  "./recommendationRanking.js": ranking, "./accountVisibility.js": visibility,
  "../src/domain/genre.mjs": genre, "./artistGenreProjection.js": genreProjection,
  "./feedImpressions.js": impressions };
const bindings = Object.fromEntries(ast.program.body.filter((node) => node.type === "ImportDeclaration")
  .flatMap((node) => node.specifiers.map((specifier) =>
    [specifier.local.name, modules[node.source.value][specifier.imported.name]])));
const service = new Function(...Object.keys(bindings), `${code}
  return { recommendedFeedPage, candidateRows, invalidateRecommendationSnapshotForViewer, clearRecommendationSnapshotsForTests,
    ttl: SNAPSHOT_TTL_MS, maximum: SNAPSHOT_LIMIT,
    state: () => ({ snapshots: snapshots.size, viewers: activeSnapshotByViewer.size,
      active: new Map(activeSnapshotByViewer) }) };`)(...Object.values(bindings));
beforeEach(() => {
  service.clearRecommendationSnapshotsForTests();
  db.prepare("UPDATE users SET is_banned=0,suspended_until=NULL,dormant_at=NULL WHERE id=?").run("snapshot_author");
  db.prepare("DELETE FROM blocks WHERE blocker_id=? OR blocked_id=?").run("snapshot_block_viewer", "snapshot_block_viewer");
});

const START = Date.UTC(2026, 8, 9);
q.insertUser.run("snapshot_author", "snapshot@example.test", "Author", "snapshot_author", "hash", "fan",
  "Toronto", null, null, "SA", "#123456", START - 100);
q.insertUser.run("snapshot_block_viewer", "snapshot-viewer@example.test", "Viewer", "snapshot_block_viewer", "hash", "fan",
  "Toronto", null, null, "SV", "#123456", START - 100);
for (let index = 0; index < 3; index += 1) {
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run(`snapshot_post_${index}`, "snapshot_author", "Artist", "Venue", 4, START - index - 1);
}
const viewer = (id) => ({ id, favorite_artists: "[]", genres: "[]" });
const page = (actor, at = START, cursor = null) => service.recommendedFeedPage({ viewer: actor, at, cursor, limit: 1 });
const expired = (run) => assert.throws(run, (error) => error.code === "RECOMMENDATION_CURSOR_EXPIRED");
const snapshotId = (cursor) => JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).snapshotId;

for (const actor of [null, viewer("snapshot_member")]) {
  test(`expired ${actor ? "member" : "guest"} cursors retire both snapshot and active-viewer index`, () => {
    const first = page(actor);
    assert.ok(first.nextCursor);
    assert.deepEqual([service.state().snapshots, service.state().viewers], [1, 1]);
    expired(() => page(actor, START + service.ttl, first.nextCursor));
    assert.deepEqual([service.state().snapshots, service.state().viewers], [0, 0]);
    const fresh = page(actor, START + service.ttl);
    assert.notEqual(snapshotId(fresh.nextCursor), snapshotId(first.nextCursor));
  });
}

test("repeated expired-cursor visits cannot retain viewer keys beyond the snapshot cap", () => {
  for (let index = 0; index < service.maximum + 5; index += 1) {
    const actor = viewer(`snapshot_expired_${index}`);
    const at = START + index * (service.ttl + 1);
    const first = page(actor, at);
    expired(() => page(actor, at + service.ttl, first.nextCursor));
  }
  assert.deepEqual([service.state().snapshots, service.state().viewers], [0, 0]);
});

test("expiring an old cursor preserves its viewer's newer active snapshot", () => {
  const actor = viewer("snapshot_newer");
  const older = page(actor);
  service.invalidateRecommendationSnapshotForViewer(actor.id);
  const newer = page(actor, START + 1);
  const newerId = snapshotId(newer.nextCursor);
  assert.notEqual(newerId, snapshotId(older.nextCursor));
  expired(() => page(actor, START + service.ttl, older.nextCursor));
  assert.equal(service.state().active.get(actor.id), newerId);
  assert.equal(snapshotId(page(actor, START + service.ttl).nextCursor), newerId);
  assert.deepEqual([service.state().snapshots, service.state().viewers], [1, 1]);
});

test("a foreign viewer cannot consume or evict another viewer's live cursor", () => {
  const actor = viewer("snapshot_owner");
  const first = page(actor);
  const before = service.state();
  expired(() => page(viewer("snapshot_foreign"), START, first.nextCursor));
  assert.deepEqual(service.state(), before);
  const second = page(actor, START, first.nextCursor);
  assert.notEqual(second.rows[0].id, first.rows[0].id);
  const third = page(actor, START, second.nextCursor);
  assert.equal(third.nextCursor, null);
  assert.equal(new Set([...first.rows, ...second.rows, ...third.rows].map((row) => row.id)).size, 3);
});

test("capacity eviction bounds snapshots and viewer indexes without changing the fixed limit", () => {
  assert.equal(service.maximum, 250);
  const first = page(viewer("snapshot_capacity_first"));
  for (let index = 0; index < service.maximum; index += 1) page(viewer(`snapshot_capacity_${index}`));
  assert.deepEqual([service.state().snapshots, service.state().viewers], [service.maximum, service.maximum]);
  expired(() => page(viewer("snapshot_capacity_first"), START, first.nextCursor));
  assert.equal(service.state().viewers, service.maximum);
});

function restrictAuthor(restriction) {
  const column = { dormant: "dormant_at", banned: "is_banned", suspended: "suspended_until" }[restriction];
  db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(restriction === "banned" ? 1 : START + 60_000, "snapshot_author");
}

for (const restriction of ["dormant", "banned", "suspended"]) {
  test(`fresh recommendation candidates and pages exclude ${restriction} authors`, () => {
    restrictAuthor(restriction);
    for (const actor of [null, viewer("snapshot_restricted_viewer")]) {
      assert.deepEqual(service.candidateRows(actor, START), [], "hidden authors cannot occupy the ranking candidate budget");
      assert.deepEqual(page(actor).rows, []);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM posts WHERE user_id=? AND removed=0").get("snapshot_author").n, 3);
  });

  test(`issued recommendation cursors recheck newly ${restriction} authors`, () => {
    for (const actor of [null, viewer("snapshot_restricted_cursor")]) {
      db.prepare("UPDATE users SET is_banned=0,suspended_until=NULL,dormant_at=NULL WHERE id=?").run("snapshot_author");
      const first = page(actor);
      assert.ok(first.nextCursor);
      restrictAuthor(restriction);
      const following = page(actor, START, first.nextCursor);
      assert.deepEqual(following.rows, [], "a previously ranked author must not bypass current restrictions");
      assert.equal(following.nextCursor, null);
    }
  });
}

for (const direction of ["viewer", "author"]) {
  test(`recommendation candidates and issued cursors honor blocks by the ${direction}`, () => {
    const actor = viewer("snapshot_block_viewer");
    const first = page(actor);
    const pair = direction === "viewer" ? [actor.id, "snapshot_author"] : ["snapshot_author", actor.id];
    db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(...pair, START);
    assert.deepEqual(service.candidateRows(actor, START), []);
    assert.deepEqual(page(actor, START, first.nextCursor).rows, []);
  });
}
