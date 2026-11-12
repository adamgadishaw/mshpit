// Pending posts are private durable references, just like a saved publication.
// Standalone media fixtures/older stores may not have the calendar migration.
export function scheduledCalendarMediaReference(db, { ownerId, assetId = null, url = null }) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='creator_calendar_publications'").get()) return false;
  return !!db.prepare(`SELECT 1 FROM creator_calendar_publications cp WHERE cp.account_id=? AND cp.state='scheduled'
    AND (EXISTS(SELECT 1 FROM json_each(cp.payload,'$.mediaAssetIds') a WHERE a.value=?)
      OR EXISTS(SELECT 1 FROM json_each(cp.payload,'$.photos') p WHERE p.value=?)) LIMIT 1`).get(ownerId, assetId, url);
}
