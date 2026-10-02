import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { readClipPage, clipCandidateSql, isLegacyVideoUrl } from "./clipIndex.js";

const dir = mkdtempSync(join(tmpdir(), "pit-clip-index-"));
process.env.PIT_DATA_DIR = dir;
const { db, q, DATABASE_PATH, parseJsonArray } = await import("../../db.js");
const { postMediaState } = await import("../../mediaAssets.js");
const { safeOwnedReadyMediaUrl } = await import("../../publicMedia.js");
const { activeAccountSql } = await import("../../accountVisibility.js");
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

q.insertUser.run("u_clip_index", "index@example.com", "Index", "clipindex", "hash", "fan", "", null, null, "CI", "#000000", 1);
q.insertUser.run("u_clip_viewer", "viewer@example.com", "Viewer", "clipviewer", "hash", "fan", "", null, null, "CV", "#000000", 1);
let sequence = 0;
function post(photos = [], at = ++sequence) {
  const id = `p_index_${++sequence}`;
  db.prepare(`INSERT INTO posts(id,user_id,artist,venue,overall,photos,photos_public,created_at)
    VALUES(?,'u_clip_index','Index artist','Index venue',4,?,1,?)`).run(id, typeof photos === "string" ? photos : JSON.stringify(photos), at);
  return id;
}

function asset({ postId, kind = "video", url, rendered = false, position = 0, owner = "u_clip_index" } = {}) {
  const id = `ma_index_${++sequence}`;
  const sourceKey = `${id}/source`;
  const sourceUrl = rendered ? `https://media.example/${id}/source` : (url || `https://media.example/${id}/opaque`);
  db.prepare(`INSERT INTO media_objects(object_key,owner_id,purpose,byte_size,status,created_at,updated_at)
    VALUES(?,?,'post',100,'associated',1,1)`).run(sourceKey, owner);
  db.prepare(`INSERT INTO media_assets(id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,original_name,mime_type,byte_size,
    metadata_status,codec_status,status,source_verified_at,render_state,created_at,updated_at)
    VALUES(?,?,?,'hash','post',?,?,?,'fixture','video/mp4',100,'declared',?,'ready',1,?,1,1)`)
    .run(id, owner, id, kind, sourceKey, sourceUrl, kind === "video" ? "verified" : "not_applicable", rendered ? "ready" : "not_required");
  let variantId = null, renderKey = null;
  if (rendered) {
    variantId = `mv_${id}`;
    renderKey = `${id}/render`;
    db.prepare(`INSERT INTO media_objects(object_key,owner_id,purpose,byte_size,status,storage_scope,created_at,updated_at)
      VALUES(?,?,'post',100,'associated','public',1,1)`).run(renderKey, owner);
    db.prepare(`INSERT INTO media_variants(id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,status,verification_origin,created_at,updated_at)
      VALUES(?,?,?,'hash','render',?,?,'video/mp4',100,'verified','private_derivative_v1',1,1)`)
      .run(variantId, id, variantId, renderKey, url || `https://media.example/${id}/render`);
    db.prepare("UPDATE media_assets SET render_variant_id=? WHERE id=?").run(variantId, id);
  }
  if (postId) db.prepare("INSERT INTO post_media(post_id,asset_id,position,created_at) VALUES(?,?,?,1)").run(postId, id, position);
  return { id, sourceKey, sourceUrl, variantId, renderKey };
}

function select(limit = 30, project = rows => rows, cursor = null) {
  return readClipPage(db, { activeAccount: activeAccountSql("u"), viewer: "u_clip_viewer", limit, cursor }, project);
}

// Independent oracle composes the existing canonical media projector and URL
// authority helper, including descriptor precedence and drifted stored photos.
function canonicalEligible(postId) {
  const p = db.prepare("SELECT * FROM posts WHERE id=?").get(postId);
  const hasVideo = !!db.prepare("SELECT 1 FROM post_media pm JOIN media_assets a ON a.id=pm.asset_id WHERE pm.post_id=? AND a.kind='video'").get(postId);
  const photos = parseJsonArray(p.photos);
  if (!hasVideo && (!/\.(mp4|webm|mov|m4v)/i.test(p.photos) || !photos.some(isLegacyVideoUrl))) return false;
  const stable = postMediaState(db, postId).assets;
  const byUrl = new Map(stable.map(a => [a.url, a]));
  const urls = new Set(photos.filter(url => byUrl.has(url)
    || safeOwnedReadyMediaUrl(db, { ownerId: p.user_id, url })));
  for (const a of stable) urls.add(a.url);
  return [...urls].some(url => (typeof url === "string" && byUrl.get(url)?.kind === "video") || isLegacyVideoUrl(url));
}

test("live selector agrees with canonical linked/fallback eligibility across state transitions", () => {
  db.exec("SAVEPOINT differential");
  try {
    const ids = [];
    const linked = post("{malformed"); ids.push(linked);
    const a = asset({ postId: linked }); // extensionless; no poster; drifted photos
    const fallbackUrl = "https://media.example/fallback.mp4";
    const fallback = post([fallbackUrl, null, {}, 3]); ids.push(fallback);
    const b = asset({ url: fallbackUrl });
    const escaped = post(JSON.stringify([fallbackUrl]).replaceAll(".", "\\u002e")); ids.push(escaped);
    const imageUrl = "https://media.example/image.jpg?format=.mp4";
    const imagePost = post([]); ids.push(imagePost);
    const c = asset({ postId: imagePost, kind: "image", rendered: true, url: imageUrl });
    const renderUrl = "https://media.example/rendered.webm";
    const renderPost = post([renderUrl]); ids.push(renderPost);
    const d = asset({ rendered: true, url: renderUrl });
    ids.push(post([` ${fallbackUrl}`, `${fallbackUrl}\u00a0`, "https://media.example/image.jpg?format=.mp4-bait"]));
    const check = () => {
      const actual = new Set(select().map(r => r.id));
      for (const id of ids) assert.equal(actual.has(id), canonicalEligible(id), id);
    };
    check();
    assert.equal(canonicalEligible(escaped), false, "old raw LIKE rejects escaped extensions even when decoded URL qualifies");
    assert.equal(canonicalEligible(imagePost), false, "old raw/plausible gates exclude image-only drifted photos");
    db.prepare("UPDATE posts SET photos=? WHERE id=?").run(JSON.stringify([imageUrl]), imagePost);
    check();
    for (const [sql, args] of [
      ["UPDATE media_assets SET source_verified_at=NULL,metadata_status='pending' WHERE id IN(?,?)", [a.id, b.id]],
      ["UPDATE media_assets SET codec_status='pending' WHERE id=?", [a.id]],
      ["UPDATE media_assets SET codec_status='verified' WHERE id=?", [a.id]],
      ["UPDATE media_objects SET status='delete_queued' WHERE object_key=?", [a.sourceKey]],
      ["UPDATE media_objects SET status='associated' WHERE object_key=?", [a.sourceKey]],
      ["UPDATE media_variants SET role='poster' WHERE id=?", [d.variantId]],
      ["UPDATE media_variants SET verification_origin='client' WHERE id=?", [c.variantId]],
      ["UPDATE media_objects SET storage_scope='private' WHERE object_key=?", [d.renderKey]],
      ["UPDATE media_assets SET status='render_pending' WHERE id=?", [a.id]],
    ]) { db.prepare(sql).run(...args); check(); }
  } finally { db.exec("ROLLBACK TO differential; RELEASE differential"); }
});

test("last stable descriptor wins cross-table duplicate URLs, including image/video order", () => {
  db.exec("SAVEPOINT collisions");
  try {
    const id = post([]);
    const url = "https://media.example/colliding-opaque";
    asset({ postId: id, url, position: 0 });
    const image = asset({ postId: id, kind: "image", rendered: true, url, position: 1 });
    assert.equal(canonicalEligible(id), false);
    assert.equal(select().some(r => r.id === id), false);
    db.prepare("UPDATE post_media SET position=2 WHERE post_id=? AND position=0").run(id);
    assert.equal(canonicalEligible(id), true);
    assert.equal(select().some(r => r.id === id), true);
    db.prepare("UPDATE media_variants SET status='failed' WHERE id=?").run(image.variantId);
    assert.equal(select().some(r => r.id === id), true);
  } finally { db.exec("ROLLBACK TO collisions; RELEASE collisions"); }
});

test("visibility remains live and candidate order needs no global DISTINCT or sort", () => {
  db.exec("SAVEPOINT visibility");
  try {
    const id = post([], 9000); asset({ postId: id });
    assert.equal(select()[0].id, id);
    db.prepare("UPDATE posts SET photos_public=0 WHERE id=?").run(id);
    assert.equal(select().length, 0);
    db.prepare("UPDATE posts SET photos_public=1 WHERE id=?").run(id);
    db.prepare("UPDATE users SET suspended_until=? WHERE id='u_clip_index'").run(Date.now() + 60_000);
    assert.equal(select().length, 0);
    db.exec("UPDATE users SET suspended_until=1 WHERE id='u_clip_index'");
    assert.equal(select()[0].id, id);
    db.exec("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES('u_clip_index','u_clip_viewer',1)");
    assert.equal(select().length, 0);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${clipCandidateSql({ activeAccount: activeAccountSql("u") })}`)
      .all("[]", "u_clip_viewer", "u_clip_viewer", 31).map(r => r.detail).join("\n");
    assert.match(plan, /idx_clip_candidates_cursor/);
    assert.doesNotMatch(plan, /TEMP B-TREE|MATERIALIZE live_linked/);
  } finally { db.exec("ROLLBACK TO visibility; RELEASE visibility"); }
});

test("selection and hydration share a WAL snapshot despite another writer revoking media", () => {
  const id = post([], 10000); const a = asset({ postId: id });
  const writer = new DatabaseSync(DATABASE_PATH);
  try {
    const projected = select(1, rows => {
      assert.equal(rows[0].id, id);
      writer.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(a.sourceKey);
      assert.equal(canonicalEligible(id), true, "hydration still sees selected authority snapshot");
      return rows;
    });
    assert.equal(projected.length, 1);
    assert.equal(select().some(r => r.id === id), false, "next request sees revocation immediately");
  } finally { writer.close(); db.prepare("DELETE FROM posts WHERE id=?").run(id); }
});

test("thousands of rejected references never enter the bounded hydration callback", () => {
  db.exec("SAVEPOINT sparse");
  try {
    const real = post([], 1); asset({ postId: real });
    for (let i = 0; i < 1200; i++) post([`https://untrusted.example/${i}.mp4`], i + 2);
    let projected = 0;
    const result = select(30, rows => { projected += rows.length; return rows; });
    assert.deepEqual(result.map(r => r.id), [real]);
    assert.equal(projected, 1);
  } finally { db.exec("ROLLBACK TO sparse; RELEASE sparse"); }
});

test("maximum page projects only31 ordered posts and projection failure releases its snapshot", () => {
  db.exec("SAVEPOINT maximum_page");
  try {
    const ids = [];
    for (let i = 0; i < 40; i++) { const id = post([], 90000); ids.push(id); asset({ postId: id }); }
    const rows = select(30);
    assert.equal(rows.length, 31);
    assert.deepEqual(rows.map(r => r.id), ids.sort().reverse().slice(0, 31));
    assert.throws(() => select(30, () => { throw new Error("projection failure"); }), /projection failure/);
    assert.equal(select(1).length, 2, "failed page did not strand its savepoint");
    assert.throws(() => select(1.5), RangeError);
  } finally { db.exec("ROLLBACK TO maximum_page; RELEASE maximum_page"); }
  assert.equal(db.isTransaction, false);
});

test("cursor pages seek the composite range and preserve tied timestamp ordering", () => {
  db.exec("SAVEPOINT cursor_range");
  try {
    const ids = [];
    for (const at of [101, 101, 101, 101, 100, 100, 99]) {
      const id = post([], at); ids.push(id); asset({ postId: id });
    }
    const expected = db.prepare(`SELECT id,created_at FROM posts WHERE id IN (${ids.map(() => "?").join(",")})
      ORDER BY created_at DESC,id DESC`).all(...ids);
    const received = [];
    let cursor = null;
    while (true) {
      const found = select(2, rows => rows, cursor);
      const page = found.slice(0, 2);
      received.push(...page);
      if (found.length <= 2) break;
      cursor = { createdAt: page.at(-1).created_at, id: page.at(-1).id };
    }
    assert.deepEqual(received, expected);
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${clipCandidateSql({ activeAccount: activeAccountSql("u"), cursor: true })}`)
      .all("[]", 101, expected[1].id, "u_clip_viewer", "u_clip_viewer", 3).map(row => row.detail).join("\n");
    assert.match(plan, /SEARCH candidate USING INDEX idx_clip_candidates_cursor/);
    assert.match(plan, /\(created_at,post_id\)<\(\?,\?\)/);
    assert.doesNotMatch(plan, /SCAN candidate|TEMP B-TREE/);
  } finally { db.exec("ROLLBACK TO cursor_range; RELEASE cursor_range"); }
});
