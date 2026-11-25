// Source-reviewed public timing exceptions, not a provider access-time rule.
const reviewed = new Map([
  ["tm_177Zv0G6G5g4C9b", {
    date: "2026-11-26", city: "toronto", venue: "the danforth music hall", seller: "100064C2F554E5D8",
    doors: "19:00", start: "20:00", source: "https://www.ticketmaster.ca/event/100064C2F554E5D8",
  }],
  ["tm_177Zv0G6GCW_REF", {
    date: "2026-11-28", city: "london", venue: "london music hall", seller: "100064C3BD66F9C8",
    doors: "19:00", start: "20:00", source: "https://londonmusichall.com/events/default-the-fallout-25th-anniversary-tour/",
  }],
  ["tm_1k7ZvPfZGACyvb9", {
    date: "2026-12-06", city: "toronto", venue: "the danforth music hall", seller: "100065500EE41617",
    doors: "14:30", start: "15:00",
    source: "https://www.ticketmaster.ca/33rd-annual-riverdale-share-concert-toronto-ontario-12-06-2026/event/100065500EE41617?language=en-us",
  }],
]);
const lower = (value) => String(value ?? "").trim().toLowerCase();

export function reviewedPublicShowTiming(row, ticketUrl) {
  const item = reviewed.get(row?.id);
  if (!item || row.owner_id != null || row.ownerId != null || lower(row.source) !== "ticketmaster"
    || (row.provider_event_id != null && row.provider_event_id !== row.id.slice(3))
    || item.date !== row.date || item.city !== lower(row.venue_city)
    || item.venue !== lower(row.venue) || lower(row.venue_country_code) !== "ca"
    || !["", "scheduled", "onsale", "offsale"].includes(lower(row.event_status))) return null;
  let seller;
  try { seller = new URL(ticketUrl); } catch { return null; }
  if (seller.protocol !== "https:" || !["ticketmaster.ca", "www.ticketmaster.ca"].includes(seller.hostname)
    || seller.pathname.split("/").filter(Boolean).slice(-2).join("/") !== `event/${item.seller}`) return null;

  // Keep this exception bounded to the observed stale provider snapshot.
  // A changed/unknown start, date, or timezone must not inherit reviewed times.
  if (!["", "america/toronto", "america/new_york"].includes(lower(row.event_timezone))) return null;
  const doorsDateTime = `${item.date}T${item.doors}:00-05:00`;
  const rawStart = String(row.start_date_time ?? "");
  if (!/(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(rawStart) || Date.parse(rawStart) !== Date.parse(doorsDateTime)
    || (row.start_local_time && ![item.doors, `${item.doors}:00`, `${item.date}T${item.doors}:00`].includes(row.start_local_time))) return null;
  return {
    doorsDateTime, doorsLocalTime: item.doors, timingSource: item.source,
    startDateTime: `${item.date}T${item.start}:00-05:00`, localTime: item.start,
  };
}
