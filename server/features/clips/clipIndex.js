// References, not cached publication authority: every read checks current media
// and viewer policy. No function used by these persistent triggers is a JS UDF.
import { withImmediateWrite } from "../../databaseTransaction.js";

export const CLIP_INDEX_VERSION = 1;
export const CLIP_PHOTOS_MAX_BYTES = 512 * 1024;

export function isLegacyVideoUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  try {
    new URL(value);
    return /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value);
  } catch { return false; }
}

const jsonArray = (expression) => `CASE WHEN json_valid(${expression}) THEN
  CASE WHEN json_type(${expression})='array' THEN ${expression} ELSE '[]' END ELSE '[]' END`;

function refreshReferences(id) {
  return `DELETE FROM clip_photo_refs WHERE post_id=${id};
    INSERT INTO clip_photo_refs(post_id,position,raw_url)
      SELECT p.id,j.key,j.value FROM posts p,json_each(${jsonArray("p.photos")}) j
      WHERE p.id=${id} AND j.type='text';`;
}

function refreshCandidate(id) {
  return `DELETE FROM clip_post_candidates WHERE post_id=${id};
    INSERT INTO clip_post_candidates(post_id,created_at,legacy_hint)
      SELECT p.id,p.created_at,(p.photos LIKE '%.mp4%' OR p.photos LIKE '%.webm%'
        OR p.photos LIKE '%.mov%' OR p.photos LIKE '%.m4v%') FROM posts p WHERE p.id=${id} AND (
        EXISTS(SELECT 1 FROM clip_photo_refs r WHERE r.post_id=p.id)
        OR EXISTS(SELECT 1 FROM post_media pm WHERE pm.post_id=p.id));`;
}

export function ensureClipIndexSchema(database) {
  withImmediateWrite(database, () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS clip_photo_refs(
        post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,raw_url TEXT NOT NULL,
        PRIMARY KEY(post_id,position)
      );
      CREATE TABLE IF NOT EXISTS clip_post_candidates(
        post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,legacy_hint INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_clip_candidates_cursor
        ON clip_post_candidates(created_at DESC,post_id DESC);
      CREATE TABLE IF NOT EXISTS clip_index_preparation(
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL,
        upper_post_id TEXT,last_post_id TEXT,ready INTEGER NOT NULL CHECK(ready IN(0,1))
      );
      INSERT OR IGNORE INTO clip_index_preparation
        SELECT 1,${CLIP_INDEX_VERSION},MAX(id),NULL,CASE WHEN MAX(id) IS NULL THEN 1 ELSE 0 END FROM posts;
      CREATE TRIGGER IF NOT EXISTS trg_clip_post_insert AFTER INSERT ON posts BEGIN
        ${refreshReferences("NEW.id")}${refreshCandidate("NEW.id")}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_clip_post_update AFTER UPDATE OF id,photos,created_at ON posts BEGIN
        DELETE FROM clip_photo_refs WHERE post_id=OLD.id;
        DELETE FROM clip_post_candidates WHERE post_id=OLD.id;
        ${refreshReferences("NEW.id")}${refreshCandidate("NEW.id")}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_clip_post_delete AFTER DELETE ON posts BEGIN
        DELETE FROM clip_photo_refs WHERE post_id=OLD.id;
        DELETE FROM clip_post_candidates WHERE post_id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_clip_attachment_insert AFTER INSERT ON post_media BEGIN
        ${refreshCandidate("NEW.post_id")}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_clip_attachment_update AFTER UPDATE OF post_id,asset_id,position ON post_media BEGIN
        ${refreshCandidate("OLD.post_id")}${refreshCandidate("NEW.post_id")}
      END;
      CREATE TRIGGER IF NOT EXISTS trg_clip_attachment_delete AFTER DELETE ON post_media BEGIN
        ${refreshCandidate("OLD.post_id")}
      END;
    `);
  });
}

export function clipIndexState(database) {
  return database.prepare("SELECT * FROM clip_index_preparation WHERE singleton=1").get();
}

export function assertClipIndexReady(database) {
  const state = clipIndexState(database);
  if (!state || state.version !== CLIP_INDEX_VERSION || state.ready !== 1) {
    throw new Error("Clips index preparation is incomplete; run scripts/prepare-clips-index.mjs before starting this release.");
  }
}

// Called only within the preparer's bounded write transaction, after its size
// preflight. Live application writes use the equivalent native triggers above.
export function refreshClipIndexPost(database, postId) {
  database.prepare("DELETE FROM clip_photo_refs WHERE post_id=?").run(postId);
  database.prepare(`INSERT INTO clip_photo_refs(post_id,position,raw_url)
    SELECT p.id,j.key,j.value FROM posts p,json_each(${jsonArray("p.photos")}) j
    WHERE p.id=? AND j.type='text'`).run(postId);
  database.prepare("DELETE FROM clip_post_candidates WHERE post_id=?").run(postId);
  database.prepare(`INSERT INTO clip_post_candidates(post_id,created_at,legacy_hint)
    SELECT p.id,p.created_at,(p.photos LIKE '%.mp4%' OR p.photos LIKE '%.webm%'
      OR p.photos LIKE '%.mov%' OR p.photos LIKE '%.m4v%') FROM posts p WHERE p.id=? AND (
      EXISTS(SELECT 1 FROM clip_photo_refs r WHERE r.post_id=p.id)
      OR EXISTS(SELECT 1 FROM post_media pm WHERE pm.post_id=p.id))`).run(postId);
}

const registered = new WeakSet();
function registerReadFunctions(database) {
  if (registered.has(database)) return;
  database.function("pit_clip_video_url", { deterministic: true }, (value) => Number(isLegacyVideoUrl(value)));
  database.function("pit_clip_trim", { deterministic: true }, (value) => typeof value === "string" ? value.trim() : "");
  registered.add(database);
}

// Mirrors mediaAssets.publishUrl, deliberately distinct from the stricter
// URL-only fallback below. Poster availability does not gate this existing read.
const linked = `SELECT pm.post_id,pm.position,a.kind,
  CASE WHEN a.status='ready' AND source.status IN('issued','associated')
    AND (a.kind!='video' OR a.codec_status='verified') THEN
      CASE WHEN a.render_state='ready' AND rv.status='verified'
        AND (a.kind!='image' OR rv.verification_origin='private_derivative_v1')
        AND rendered.storage_scope='public' AND rendered.status IN('issued','associated') THEN rv.public_url
      WHEN a.kind='video' AND a.render_state='not_required' THEN a.source_url END
  END AS url
  FROM post_media pm JOIN media_assets a ON a.id=pm.asset_id
  LEFT JOIN media_objects source ON source.object_key=a.source_key AND source.owner_id=a.owner_id
  LEFT JOIN media_variants rv ON rv.id=a.render_variant_id AND rv.asset_id=a.id
  LEFT JOIN media_objects rendered ON rendered.object_key=rv.object_key AND rendered.owner_id=a.owner_id`;

const fallbackAuthority = `pit_clip_trim(p.user_id)!='' AND a.owner_id=pit_clip_trim(p.user_id) AND a.status='ready'
  AND a.source_verified_at IS NOT NULL AND a.metadata_status='declared'
  AND ((a.kind='image' AND a.codec_status='not_applicable') OR (a.kind='video' AND a.codec_status='verified'))
  AND EXISTS(SELECT 1 FROM media_objects source WHERE source.object_key=a.source_key
    AND source.owner_id=a.owner_id AND source.status IN('issued','associated'))`;

export function clipCandidateSql({ activeAccount, cursor = false }) {
  return `WITH live_linked AS NOT MATERIALIZED (${linked}),
    allowed_legacy AS (SELECT json_extract(value,'$[0]') post_id,json_extract(value,'$[1]') url FROM json_each(?))
    SELECT p.id,p.created_at FROM clip_post_candidates candidate INDEXED BY idx_clip_candidates_cursor
    CROSS JOIN posts p ON p.id=candidate.post_id JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND p.photos_public=1 AND (${activeAccount})
      ${cursor ? "AND (candidate.created_at,candidate.post_id) < (?,?)" : ""}
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      -- Preserve both the former raw JSON prefilter and its JS plausible gate.
      -- Canonical projection alone would add previously excluded image links.
      AND (EXISTS(SELECT 1 FROM post_media pm JOIN media_assets a ON a.id=pm.asset_id
        WHERE pm.post_id=p.id AND a.kind='video') OR (candidate.legacy_hint=1 AND EXISTS(
          SELECT 1 FROM clip_photo_refs plausible WHERE plausible.post_id=p.id AND pit_clip_video_url(plausible.raw_url)=1)))
      AND (
        EXISTS(SELECT 1 FROM live_linked l WHERE l.post_id=p.id AND l.url IS NOT NULL AND l.url!=''
          AND (pit_clip_video_url(l.url)=1 OR (l.kind='video' AND NOT EXISTS(
            SELECT 1 FROM live_linked later WHERE later.post_id=l.post_id AND later.url=l.url
              AND later.position>l.position AND later.kind!='video'))))
        OR EXISTS(SELECT 1 FROM clip_photo_refs r
          JOIN legacy_video_posters legacy ON legacy.post_id=r.post_id AND legacy.media_url=r.raw_url
          JOIN media_objects poster ON poster.object_key=legacy.poster_key AND poster.owner_id=legacy.owner_id
          WHERE r.post_id=p.id AND legacy.status='verified' AND poster.status IN('issued','associated')
            AND EXISTS(SELECT 1 FROM allowed_legacy trusted WHERE trusted.post_id=p.id AND trusted.url=r.raw_url)
            AND NOT EXISTS(SELECT 1 FROM live_linked l WHERE l.post_id=p.id AND l.url=r.raw_url))
        OR EXISTS(SELECT 1 FROM clip_photo_refs r WHERE r.post_id=p.id AND pit_clip_video_url(r.raw_url)=1 AND (
          EXISTS(SELECT 1 FROM media_assets a WHERE a.source_url=pit_clip_trim(r.raw_url)
            AND a.kind='video' AND a.render_state='not_required' AND ${fallbackAuthority})
          OR EXISTS(SELECT 1 FROM media_variants rv JOIN media_assets a ON a.id=rv.asset_id AND a.render_variant_id=rv.id
            JOIN media_objects rendered ON rendered.object_key=rv.object_key AND rendered.owner_id=a.owner_id
            WHERE rv.public_url=pit_clip_trim(r.raw_url) AND rv.role='render' AND rv.status='verified'
              AND a.render_state='ready' AND (a.kind!='image' OR rv.verification_origin='private_derivative_v1')
              AND rendered.storage_scope='public' AND rendered.status IN('issued','associated') AND ${fallbackAuthority})
        ))
      ) ORDER BY candidate.created_at DESC,candidate.post_id DESC LIMIT ?`;
}

// Keep selection AND all canonical post hydration in the same SQLite snapshot.
// A second writer may commit between calls even though this handler never awaits.
export function readClipPage(database, { activeAccount, cursor, viewer, limit, legacySources = [] }, project) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new RangeError("Invalid clips page limit");
  registerReadFunctions(database);
  database.exec("SAVEPOINT clip_page_snapshot");
  try {
    assertClipIndexReady(database); // first read pins the snapshot
    const args = [JSON.stringify(legacySources)];
    if (cursor) args.push(cursor.createdAt, cursor.id);
    args.push(viewer, viewer, limit + 1);
    const rows = database.prepare(clipCandidateSql({ activeAccount, cursor: !!cursor })).all(...args);
    const result = project(rows);
    database.exec("RELEASE clip_page_snapshot");
    return result;
  } catch (error) {
    database.exec("ROLLBACK TO clip_page_snapshot; RELEASE clip_page_snapshot");
    throw error;
  }
}
