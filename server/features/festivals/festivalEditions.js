// Pure rules for turning ticket listings into festival editions.
//
// A festival sells several listings for one weekend: a 3-day pass, one ticket
// per day, VIP, camping. Listings for the same festival at the same venue whose
// dates run back to back (at most two days apart) are one edition, so
// the two weekends of a festival stay separate editions. Its lineup is every
// billed act; an act billed on a single-day listing also gets that day.

const DAY_MS = 86_400_000;
const EDITION_GAP_DAYS = 2;
const MAX_EDITION_DAYS = 14;
export const FESTIVAL_LINEUP_LIMIT = 250;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const collapse = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
const fold = (value) => collapse(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/gu, "");
const isDate = (value) => typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const addDays = (value, days) => new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// The catalog festival an event name belongs to, or null.
export function matchFestival(catalog, eventName) {
  const name = fold(eventName);
  if (!name) return null;
  for (const entry of catalog) {
    if (entry.exclude.some((phrase) => name.includes(fold(phrase)))) continue;
    if (entry.match.some((phrase) => name.includes(fold(phrase)))) return entry;
  }
  return null;
}

// Acts on a listing, minus the festival itself and its pass products.
export function festivalActs(entry, names) {
  const own = entry.match.map(fold);
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(names) ? names : []) {
    const name = collapse(typeof raw === "string" ? raw : raw?.name).slice(0, 160);
    const key = fold(name);
    if (!name || seen.has(key) || own.some((phrase) => key === phrase || key.startsWith(`${phrase} `) || key.endsWith(` ${phrase}`))) continue;
    if (/\b(pass|passes|ticket|tickets|parking|camping|shuttle|upgrade|locker|vip|ga)\b/iu.test(name)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// listings: [{ festivalSlug, providerEventId, name, startDate, endDate, venue, venueId,
//   city, region, countryCode, lat, lng, imageUrl, imageAttribution, ticketUrl, acts: [names] }]
// Returns editions: { id, festivalSlug, name, startDate, endDate, venue, city, ...,
//   lineup: [{ name, days: [dates] }], listings: [provider ids] }.
export function groupFestivalEditions(listings) {
  const valid = listings.filter((listing) => listing && listing.festivalSlug && isDate(listing.startDate))
    .map((listing) => ({ ...listing, endDate: isDate(listing.endDate) && listing.endDate >= listing.startDate
      && daysBetween(listing.startDate, listing.endDate) < MAX_EDITION_DAYS ? listing.endDate : listing.startDate }))
    .sort((a, b) => a.festivalSlug.localeCompare(b.festivalSlug) || placeKey(a).localeCompare(placeKey(b)) || a.startDate.localeCompare(b.startDate));
  const editions = [];
  for (const listing of valid) {
    const last = editions[editions.length - 1];
    if (last && last.festivalSlug === listing.festivalSlug && last.placeKey === placeKey(listing)
      && daysBetween(last.endDate, listing.startDate) <= EDITION_GAP_DAYS
      && daysBetween(last.startDate, listing.endDate) < MAX_EDITION_DAYS) {
      last.endDate = listing.endDate > last.endDate ? listing.endDate : last.endDate;
      last.members.push(listing);
      continue;
    }
    editions.push({ festivalSlug: listing.festivalSlug, placeKey: placeKey(listing), startDate: listing.startDate, endDate: listing.endDate, members: [listing] });
  }
  return editions.map(finishEdition);
}

function placeKey(listing) {
  return listing.venueId ? `venue:${listing.venueId}` : `place:${fold(listing.venue)}|${fold(listing.city)}|${fold(listing.countryCode)}`;
}

function finishEdition(edition) {
  const members = edition.members;
  // The most complete listing names the edition and supplies its place.
  const lead = members.slice().sort((a, b) => (b.acts?.length || 0) - (a.acts?.length || 0)
    || daysBetween(b.startDate, b.endDate) - daysBetween(a.startDate, a.endDate))[0];
  const lineup = new Map();
  for (const member of members) {
    const singleDay = member.startDate === member.endDate;
    for (const name of member.acts || []) {
      const key = fold(name);
      if (!lineup.has(key)) {
        if (lineup.size >= FESTIVAL_LINEUP_LIMIT) continue;
        lineup.set(key, { name, days: new Set() });
      }
      if (singleDay) lineup.get(key).days.add(member.startDate);
    }
  }
  const year = edition.startDate.slice(0, 4);
  return {
    id: `${edition.festivalSlug}:${edition.startDate}:${slugPart(lead.city || lead.venue || "")}`,
    festivalSlug: edition.festivalSlug,
    name: collapse(lead.name) || `${edition.festivalSlug} ${year}`,
    startDate: edition.startDate,
    endDate: edition.endDate,
    venue: collapse(lead.venue) || null,
    city: collapse(lead.city) || null,
    region: collapse(lead.region) || null,
    countryCode: collapse(lead.countryCode).toUpperCase() || null,
    lat: Number.isFinite(lead.lat) ? lead.lat : null,
    lng: Number.isFinite(lead.lng) ? lead.lng : null,
    imageUrl: members.find((member) => member.imageUrl)?.imageUrl || null,
    imageAttribution: members.find((member) => member.imageUrl)?.imageAttribution || null,
    ticketUrl: (members.find((member) => member.startDate !== member.endDate && member.ticketUrl) || members.find((member) => member.ticketUrl))?.ticketUrl || null,
    lineup: [...lineup.values()].map((act) => ({ name: act.name, days: [...act.days].sort() })),
    listings: members.map((member) => member.providerEventId).filter(Boolean),
  };
}

function slugPart(value) {
  return fold(value).replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 40) || "x";
}

// Every date of an edition, first to last.
export function editionDays(startDate, endDate) {
  if (!isDate(startDate)) return [];
  const last = isDate(endDate) && endDate >= startDate ? endDate : startDate;
  const days = [];
  for (let day = startDate; day <= last && days.length < MAX_EDITION_DAYS; day = addDays(day, 1)) days.push(day);
  return days;
}

// When a festival has no listed upcoming edition, the next one is estimated
// from when it last happened: same weekday pattern, a year later. Clearly an
// estimate, never presented as announced.
export function expectedEdition(pastEditions, { today }) {
  const latest = pastEditions.filter((edition) => isDate(edition.startDate))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
  if (!latest) return null;
  const start = new Date(`${latest.startDate}T00:00:00Z`);
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  let year = start.getUTCFullYear() + 1;
  while (`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` < today) year += 1;
  const part = day <= 10 ? "early" : day <= 20 ? "mid" : "late";
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return {
    year,
    month: month + 1,
    label: `Expected ${part} ${MONTHS[month]} ${year}`,
    basis: { startDate: latest.startDate, endDate: latest.endDate || latest.startDate, city: latest.city || null },
  };
}
