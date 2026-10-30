// Reviewed evidence is deliberately scoped to provider IDs AND performance facts.
// Never infer doors from two nearby clock times: venues can run two performances.
const SOUTH_IDS = new Set(["tm_16wZk8IvsZA5v122", "tm_LvZ18QnJ_3ZBENPibGAjN"]);
export const REVIEWED_SOUTH_SOURCE = "https://www.the-brook.com/tm-event/the-south/";
const text = (value) => String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");

function reviewedSouth(row) {
  return row?.owner_id == null && row.source === "ticketmaster" && SOUTH_IDS.has(row.id)
    && row.date === "2026-10-30" && text(row.artist) === "the south"
    && text(row.event_name || row.artist) === "the south"
    && text(row.venue) === "the brook" && /\bsouthampton\b/iu.test(row.place || "");
}

export function reviewedEventTimes(row) {
  return reviewedSouth(row) ? {
    start_date_time: "2026-10-30T20:00:00.000Z",
    start_local_time: "2026-10-30T20:00:00",
    access_start_date_time: "2026-10-30T19:30:00.000Z",
    access_start_approximate: 0,
    start_time_approximate: true,
  } : {};
}

export function reviewedEventBilling(row) {
  // Both names are explicitly billed by the reviewed venue source. Keeping
  // this projection separate leaves each imported provider snapshot intact.
  return reviewedSouth(row) ? ["The South", "King Brasstards"] : null;
}

// Only ticket URLs identifying a single sale qualify. Tracking parameters do
// not create another sale; unknown query parameters are retained fail-closed.
function saleIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (!/^(?:ticketmaster\.(?:com|ca|co\.uk|ie|com\.au)|ticketweb\.(?:uk|com|ca))$/u.test(host)
      || !/\/(?:event|ticket)\//iu.test(url.pathname)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|camefrom|brand|referrer|ref|cid)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return host + url.pathname.replace(/\/$/u, "") + url.search;
  } catch { return null; }
}

export function providerPerformanceKey(row) {
  if (!row || row.owner_id != null || !["ticketmaster", "bandsintown"].includes(row.source)
    || (row.event_kind && row.event_kind !== "concert")) return "";
  if (reviewedSouth(row)) return "reviewed:the-south:brook:2026-10-30";
  const sale = saleIdentity(row.ticket_url);
  const start = Date.parse(row.start_date_time || "");
  const venue = text(row.venue), place = text(row.place), artist = text(row.artist);
  if (!sale || !Number.isFinite(start) || !venue || !place || !artist || !row.date) return "";
  return JSON.stringify([sale, artist, venue, place, row.date, start, text(row.event_name || row.artist), text(row.event_status)]);
}

const fields = ["id", "owner_id", "source", "artist", "venue", "place", "date", "ticket_url", "start_date_time", "event_name", "event_status", "event_kind"];
const rowSql = (alias) => {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(alias)) throw new TypeError("Invalid event SQL alias");
  return `json_array(${fields.map((field) => `${alias}.${field}`).join(",")})`;
};
export function installProviderEventIdentitySql(database) {
  database?.function?.("pit_provider_performance", { deterministic: true }, (json) => {
    const values = JSON.parse(json);
    return providerPerformanceKey(Object.fromEntries(fields.map((field, index) => [field, values[index]])));
  });
}

export function canonicalProviderEventSql(alias = "td", peerArtist = null) {
  const row = rowSql(alias), peer = rowSql("performance_peer");
  if (peerArtist != null && !/^@[A-Za-z_][A-Za-z_0-9]*$/u.test(peerArtist)) throw new TypeError("Invalid artist SQL parameter");
  const billingScope = peerArtist ? `AND (LOWER(performance_peer.artist)=LOWER(${peerArtist})
    OR pit_live_billing_matches(performance_peer.source,performance_peer.music_evidence,performance_peer.billed_artists,${peerArtist})=1)` : "";
  return `(${alias}.owner_id IS NOT NULL OR (COALESCE(${alias}.ticket_url,'')='' AND ${alias}.id NOT IN ('tm_16wZk8IvsZA5v122','tm_LvZ18QnJ_3ZBENPibGAjN')) OR NOT EXISTS (SELECT 1 FROM tour_dates performance_peer
    WHERE performance_peer.artist=${alias}.artist AND performance_peer.date=${alias}.date
      AND performance_peer.id<${alias}.id AND performance_peer.owner_id IS NULL
      AND COALESCE(performance_peer.provider_active,1)=1 AND performance_peer.music_qualified=1
      AND performance_peer.release_at<=${alias}.release_at
      ${billingScope}
      AND pit_provider_performance(${row})<>''
      AND pit_provider_performance(${peer})=pit_provider_performance(${row})))`;
}

export function canonicalProviderEventId(database, id, at = Date.now()) {
  const row = database.prepare("SELECT * FROM tour_dates WHERE id=?").get(id);
  // An unpublished, unqualified, or withdrawn alias cannot gain access by
  // borrowing an independently public target's identity.
  if (!row || row.music_qualified !== 1 || row.release_at > at || row.provider_active === 0) return id;
  const key = providerPerformanceKey(row);
  if (!key) return id;
  const peers = database.prepare(`SELECT * FROM tour_dates WHERE artist=? AND date=?
    AND owner_id IS NULL AND COALESCE(provider_active,1)=1 AND music_qualified=1
    AND release_at<=? ORDER BY id`).all(row.artist, row.date, row.release_at);
  return peers.find((peer) => providerPerformanceKey(peer) === key)?.id || id;
}
