import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createPublicDocumentRepository } from "./publicDocumentRepository.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-directory-availability-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("../../db.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
let directorySql;
const repository = createPublicDocumentRepository({
  function: db.function.bind(db),
  prepare(sql) {
    if (sql.startsWith("SELECT a.norm,a.name,a.public_slug,a.genre,a.data,a.bio,a.updated_at,")
        && sql.includes("directory_total")) directorySql = sql;
    return db.prepare(sql);
  },
});
const at = Date.parse("2026-10-02T12:00:00Z");
const args = [at, "2026-10-02", 13, 0];

test("the actual artist directory probes canonical and legacy evidence by identity", () => {
  assert.ok(directorySql);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${directorySql}`).all(...args).map(row => row.detail).join("\n");
  assert.match(plan, /SEARCH p USING INDEX idx_posts_public_artist_evidence \(artist_key=\?\)/);
  assert.match(plan, /SEARCH p USING INDEX idx_posts_public_artist_name_evidence/);
  assert.doesNotMatch(plan, /SEARCH p USING INDEX idx_posts_recommendation_candidates|SCAN p\b/);
});

test("directory evidence keeps canonical, NULL legacy, ambiguity, visibility, totals and order semantics", () => {
  for (const id of ["availability_active", "availability_banned", "availability_dormant"]) {
    q.insertUser.run(id, `${id}@example.test`, id, id, "unused", "fan", "", 0, 0, "AV", "#123456", at);
  }
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run("availability_banned");
  db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(at, "availability_dormant");
  const addArtist = (key, name = key, bio = "") => db.prepare(`INSERT INTO artists
    (norm,name,public_slug,bio,rank_score,source,created_at,updated_at) VALUES (?,?,?,?,999999,'musicbrainz',?,?)`)
    .run(key, name, key, bio, at, at);
  const addPost = (id, key, name, { user = "availability_active", removed = 0, experience = "in_person", review = "An excellent concert with a substantive review of the performance." } = {}) =>
    db.prepare(`INSERT INTO posts (id,user_id,artist,artist_key,venue,overall,review,removed,experience_type,created_at)
      VALUES (?,?,?,?, 'Synthetic Hall',4,?,?,?,?)`).run(id, user, name, key, review, removed, experience, at);
  addArtist("availability_canonical", "A Canonical");
  addPost("av_canonical", "availability_canonical", "Old spelling");
  addArtist("availability_legacy", "B Legacy");
  addPost("av_legacy", null, "b LEGACY");
  addArtist("availability_bio", "C Biography", "A substantive biography. ".repeat(5));
  addArtist("availability_ambiguous_1", "Ambiguous"); addArtist("availability_ambiguous_2", "AMBIGUOUS");
  addPost("av_ambiguous", null, "Ambiguous");
  for (const [suffix, options] of [["banned", { user: "availability_banned" }], ["dormant", { user: "availability_dormant" }],
    ["removed", { removed: 1 }], ["online", { experience: "online" }], ["short", { review: "Too short" }]]) {
    const key = `availability_${suffix}`; addArtist(key); addPost(`av_${suffix}`, key, key, options);
  }
  addArtist("availability_wrong_key", "Wrong Key");
  addPost("av_wrong_key", "availability_canonical", "Wrong Key");
  const rows = db.prepare(directorySql).all(at, "2026-10-02", 10000, 0);
  const eligible = rows.filter(row => row.norm.startsWith("availability_"));
  assert.deepEqual(eligible.map(row => row.norm), ["availability_canonical", "availability_legacy", "availability_bio"]);
  const first = repository.readDirectory({ kind: "artists", limit: 2, page: 1, at });
  assert.deepEqual(first.artists.map(row => row.norm), eligible.slice(0, 2).map(row => row.norm));
  assert.equal(first.total, rows.length); assert.equal(first.hasNext, true);
  const second = repository.readDirectory({ kind: "artists", limit: 2, page: 2, at });
  assert.equal(second.artists[0].norm, "availability_bio"); assert.equal(second.total, first.total);
  const empty = repository.readDirectory({ kind: "artists", page: 1000, at });
  assert.deepEqual(empty.artists, []); assert.equal(empty.hasNext, false);
});
