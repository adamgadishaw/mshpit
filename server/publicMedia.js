const readyMediaStatements = new WeakMap();

function readyMediaStatement(database) {
  let statement = readyMediaStatements.get(database);
  if (statement) return statement;
  statement = database.prepare(`SELECT a.id,a.kind FROM media_assets a
    JOIN media_objects source_object
      ON source_object.owner_id=a.owner_id AND source_object.object_key=a.source_key
    LEFT JOIN media_variants render_variant
      ON render_variant.id=a.render_variant_id AND render_variant.asset_id=a.id AND render_variant.role='render'
    LEFT JOIN media_objects render_object
      ON render_object.owner_id=a.owner_id AND render_object.object_key=render_variant.object_key
    WHERE a.owner_id=? AND a.status='ready' AND a.source_verified_at IS NOT NULL
      AND a.metadata_status='declared'
      AND ((a.kind='image' AND a.codec_status='not_applicable') OR
        (a.kind='video' AND a.codec_status='verified'))
      AND (? IS NULL OR a.kind=?)
      AND source_object.status IN ('issued','associated')
      AND ((a.kind='video' AND a.render_state='not_required' AND a.source_url=?) OR
        (a.render_state='ready' AND render_variant.status='verified'
          AND (a.kind!='image' OR render_variant.verification_origin='private_derivative_v1')
          AND render_object.storage_scope='public'
          AND render_object.status IN ('issued','associated') AND render_variant.public_url=?))
    LIMIT 1`);
  readyMediaStatements.set(database, statement);
  return statement;
}

export function verifiedOwnedReadyMedia(database, { ownerId, url, kind = null } = {}) {
  const owner = typeof ownerId === "string" ? ownerId.trim() : "";
  const value = typeof url === "string" ? url.trim() : "";
  const mediaKind = kind === "image" || kind === "video" ? kind : null;
  if (!database?.prepare || !owner || !value) return null;
  return readyMediaStatement(database).get(owner, mediaKind, mediaKind, value, value) || null;
}

export function safeOwnedReadyMediaUrl(database, { ownerId, url, kind = null } = {}) {
  return verifiedOwnedReadyMedia(database, { ownerId, url, kind }) ? url : null;
}

export function quarantineUnsafeLegacyImages(database) {
  if (!database?.prepare) return 0;
  const result = database.prepare(`UPDATE media_assets AS asset
    SET status='render_unavailable',render_state='unavailable'
    WHERE asset.kind='image' AND asset.status='ready'
      AND NOT EXISTS (
        SELECT 1 FROM media_variants render_variant
        JOIN media_objects render_object
          ON render_object.owner_id=asset.owner_id AND render_object.object_key=render_variant.object_key
        WHERE render_variant.id=asset.render_variant_id AND render_variant.asset_id=asset.id
          AND render_variant.role='render' AND render_variant.status='verified'
          AND render_variant.verification_origin='private_derivative_v1'
          AND render_object.storage_scope='public'
          AND render_object.status IN ('issued','associated')
      )`).run();
  return Number(result?.changes || 0);
}
