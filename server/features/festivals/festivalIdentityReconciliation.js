import { FESTIVAL_CATALOG } from "./festivalCatalog.js";
import { matchFestival } from "./festivalEditions.js";
export const BOOTS_SLUGS = ["boots-and-hearts", "boots-and-hearts-west"];
export function savedFestivalIdentity(row) {
  if (!BOOTS_SLUGS.includes(row.festival_slug)) return row.festival_slug;
  return matchFestival(FESTIVAL_CATALOG, row.name, { city: row.city, region: row.region, venue: row.venue, countryCode: row.country_code })?.slug || null;
}
// Explicit operator action only. Never called by schema setup, reads or scans.
// Requires independently agreeing saved edition and listing evidence. Unknown,
// conflicting and mixed-place records are retained and reported, never guessed.
export function reconcileBootsAndHearts(database, { apply = false } = {}) {
  const report = { editions: [], listings: [], skipped: [] };
  database.exec("BEGIN IMMEDIATE");
  try {
    const rows = database.prepare("SELECT * FROM festival_editions WHERE festival_slug IN (?,?)").all(...BOOTS_SLUGS);
    const listings = database.prepare("SELECT * FROM festival_listings WHERE festival_slug IN (?,?)").all(...BOOTS_SLUGS);
    for (const row of rows) {
      const target = savedFestivalIdentity(row);
      if (target === row.festival_slug) continue;
      const evidence = listings.filter((item) => item.start_date >= row.start_date && item.start_date <= row.end_date
        && (item.city || "").toLowerCase() === (row.city || "").toLowerCase()
        && (item.venue || "").toLowerCase() === (row.venue || "").toLowerCase());
      if (!target || !evidence.length || evidence.some((item) => savedFestivalIdentity(item) !== target)) {
        report.skipped.push({ id: row.id, reason: "Independent edition and listing identity evidence required" });
        continue;
      }
      report.editions.push({ id: row.id, from: row.festival_slug, to: target });
      if (apply) database.prepare("UPDATE festival_editions SET festival_slug=? WHERE id=? AND festival_slug=?").run(target, row.id, row.festival_slug);
    }
    for (const row of listings) {
      const target = savedFestivalIdentity(row);
      if (!target || target === row.festival_slug) continue;
      // Move only listings supporting a safely reconciled edition (or one already correct).
      const supported = rows.some((edition) => savedFestivalIdentity(edition) === target
        && (edition.festival_slug === target || report.editions.some((move) => move.id === edition.id))
        && row.start_date >= edition.start_date && row.start_date <= edition.end_date
        && (row.city || "").toLowerCase() === (edition.city || "").toLowerCase()
        && (row.venue || "").toLowerCase() === (edition.venue || "").toLowerCase());
      if (!supported) { report.skipped.push({ id: row.provider_event_id, reason: "No independently identified edition" }); continue; }
      report.listings.push({ id: row.provider_event_id, from: row.festival_slug, to: target });
      if (apply) database.prepare("UPDATE festival_listings SET festival_slug=? WHERE provider_event_id=? AND festival_slug=?").run(target, row.provider_event_id, row.festival_slug);
    }
    database.exec(apply ? "COMMIT" : "ROLLBACK");
    return report;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}
