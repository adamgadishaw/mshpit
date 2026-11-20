import { reviewedFestivalBillingRow } from "./reviewedFestivalEventCorrections.js";

const FIELDS = [
  "artist", "artist_key", "artist_identity_status", "provider_artist_id", "billed_artists",
];
const MAX_REVIEWED_ROWS = 100;
const FIXTURE_DATES = ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29"];

// Explicit one-time reconciliation for a reviewed database snapshot. No startup
// invocation or access to a live database; the caller supplies the connection.
// Billing only until a separate identity review; dry run by default. Never delete, merge, replace IDs, change ticket bindings,
// or touch user plans. Savepoint and a narrow scope guard fail closed.
export function reconcileReviewedFestivalEvents(database, { apply = false, at = Date.now() } = {}) {
  if (!Number.isSafeInteger(at) || at < 0) throw new TypeError("Invalid reconciliation time");
  if (apply !== true && apply !== false) throw new TypeError("Invalid apply value");
  const select = database.prepare(`SELECT * FROM tour_dates
    WHERE owner_id IS NULL AND source='ticketmaster'
      AND date IN (${FIXTURE_DATES.map(() => "?").join(",")})
      AND (LOWER(event_name) LIKE '%corona capital%' OR LOWER(event_name) LIKE '%coca%cola%flow fest%')
    ORDER BY date,id LIMIT ?`);
  if (apply) database.exec("SAVEPOINT reviewed_festival_events");
  try {
    const rows = select.all(...FIXTURE_DATES, MAX_REVIEWED_ROWS + 1);
    if (rows.length > MAX_REVIEWED_ROWS) throw new Error("Festival reconciliation exceeded reviewed scope");
    const changes = [];
    for (const row of rows) {
      const projected = reviewedFestivalBillingRow(row);
      const fields = FIELDS.filter((field) => (row[field] ?? null) !== (projected[field] ?? null));
      if (!fields.length) continue;
      if (apply) {
        const update = database.prepare(`UPDATE tour_dates
          SET ${fields.map((field) => `${field}=?`).join(",")},updated_at=MAX(?,updated_at+1)
          WHERE id=? AND source=? AND date=? AND owner_id IS NULL`);
        if (update.run(...fields.map((field) => projected[field] ?? null), at, row.id, row.source, row.date).changes !== 1) {
          throw new Error("Festival reconciliation lost its exact source row");
        }
      }
      changes.push({ id: row.id, fields });
    }
    if (apply) database.exec("RELEASE reviewed_festival_events");
    return changes;
  } catch (error) {
    if (apply) database.exec("ROLLBACK TO reviewed_festival_events; RELEASE reviewed_festival_events");
    throw error;
  }
}
