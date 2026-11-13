import { ticketmasterPublicSale, SALE_FRESHNESS_MS } from "./localAlertPolicy.js";

// Only the trusted provider row writer imports this adapter. The projected
// provider response is transient; neither raw responses nor presales are stored.
export function persistLocalAlertSale(db, row, at) {
  if (row.source !== "ticketmaster" || !Object.hasOwn(row, "public_sale_evidence")) return;
  // Small standalone importer fixtures and earlier schema versions have no
  // mounted alert runtime. Production mounts the schema before ingestion.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_event_sales'").get()) return;
  if (!db.isTransaction) throw new TypeError("Sale evidence requires the calendar transaction");
  const current = db.prepare("SELECT owner_id,source,provider_event_id FROM tour_dates WHERE id=?").get(row.id);
  if (!current || current.owner_id || current.source !== "ticketmaster" || current.provider_event_id !== row.provider_event_id) return;
  const old = db.prepare("SELECT observed_at FROM local_event_sales WHERE event_id=?").get(row.id);
  if (old?.observed_at >= at) return;
  const sale = ticketmasterPublicSale({ id: current.provider_event_id, sales: { public: row.public_sale_evidence } });
  db.prepare(`INSERT INTO local_event_sales VALUES (?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET
    provider_event_id=excluded.provider_event_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,observed_at=excluded.observed_at`)
    .run(row.id, current.provider_event_id, sale?.startsAt ?? null, sale?.endsAt ?? null, at);
  // A refreshed unchanged timestamp can repair a completed stale-evidence scan.
  if (old && at - old.observed_at > SALE_FRESHNESS_MS) db.prepare("UPDATE local_event_observations SET scan_cursor='',scan_complete=0 WHERE event_id=? AND scan_complete=1").run(row.id);
}
