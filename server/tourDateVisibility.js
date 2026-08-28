import { accountIsPublic, activeAccountSql } from "./accountVisibility.js";
import { db } from "./db.js";
import { currentOrUpcomingTourDateSql, effectiveTourDateEndSql } from "./tourDateLifecycle.js";
import { tourDateHasNoPublishedMemorialSql } from "./artistMemorialTourDateVisibility.js";

// Apply release and account-state rules before tour dates reach discovery,
// ranking, counts, or serialization. Keeping this query outside the API layer
// prevents aggregate metadata (for example a venue's next date) from revealing
// an artist's unreleased schedule.
export function visibleTourDateRowsFrom(database, viewer, {
  today = null,
  artist = null,
  limit: rowLimit = 5000,
  at = Date.now(),
} = {}) {
  // Legacy rows predate provider classification evidence and remain qualified.
  // New imports can explicitly fail closed without leaking into discovery.
  const filters = ["COALESCE(td.music_qualified,1)=1"];
  const prefix = [];
  if (today) {
    filters.push(currentOrUpcomingTourDateSql("td"));
    filters.push(tourDateHasNoPublishedMemorialSql("td"));
    prefix.push(today);
  }
  if (artist) {
    filters.push("LOWER(td.artist)=LOWER(?)");
    prefix.push(artist);
  }
  const filterSql = filters.length ? `${filters.join(" AND ")} AND ` : "";
  if (viewer?.role === "admin" && accountIsPublic(viewer, at)) {
    return database.prepare(`SELECT td.* FROM tour_dates td WHERE ${filterSql}1=1 ORDER BY td.date ASC,td.id ASC LIMIT ?`)
      .all(...prefix, rowLimit);
  }
  const publicDate = new Date(Number.isFinite(Number(at)) ? Number(at) : Date.now()).toISOString().slice(0, 10);
  // Provider rows that disappear from a healthy upstream refresh stay in the
  // database as historical evidence, but an inactive event cannot keep
  // advertising itself as upcoming. `provider_active` never gates a member's
  // own authored row.
  const publicProviderSql = "(td.owner_id IS NULL AND (COALESCE(td.provider_active,1)=1 OR "
    + effectiveTourDateEndSql("td") + "<?))";
  if (viewer?.id) {
    return database.prepare(`SELECT td.* FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id WHERE ${filterSql}
      (${publicProviderSql} OR (${activeAccountSql("owner")} AND (td.release_at<=? OR td.owner_id=?)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=td.owner_id) OR
          (b.blocker_id=td.owner_id AND b.blocked_id=?))))
      ORDER BY td.date ASC,td.id ASC LIMIT ?`)
      .all(...prefix, publicDate, at, viewer.id, viewer.id, viewer.id, rowLimit);
  }
  return database.prepare(`SELECT td.* FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id WHERE ${filterSql}
    (${publicProviderSql} OR (${activeAccountSql("owner")} AND td.release_at<=?))
    ORDER BY td.date ASC,td.id ASC LIMIT ?`)
    .all(...prefix, publicDate, at, rowLimit);
}

export function visibleTourDateRows(viewer, options = {}) {
  return visibleTourDateRowsFrom(db, viewer, options);
}
