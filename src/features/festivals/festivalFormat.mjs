// Display helpers for festivals: date ranges, places, lineup poster tiers and
// how many people are going on each day.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const parts = (value) => (typeof value === "string" && DATE.test(value) ? new Date(`${value}T00:00:00Z`) : null);

// "Jul 24 to 26, 2026", "Jul 31 to Aug 3, 2026", "Dec 30, 2026 to Jan 1, 2027".
export function festivalDateRange(startDate, endDate) {
  const start = parts(startDate);
  if (!start) return "";
  const end = parts(endDate) && endDate > startDate ? parts(endDate) : null;
  const month = (at) => MONTHS[at.getUTCMonth()];
  if (!end) return `${month(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()}`;
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${month(start)} ${start.getUTCDate()}, ${start.getUTCFullYear()} to ${month(end)} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  if (start.getUTCMonth() === end.getUTCMonth()) return `${month(start)} ${start.getUTCDate()} to ${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  return `${month(start)} ${start.getUTCDate()} to ${month(end)} ${end.getUTCDate()}, ${start.getUTCFullYear()}`;
}

export function festivalDayLabel(day, { long = false } = {}) {
  const at = parts(day);
  if (!at) return "";
  return long ? `${WEEKDAYS[at.getUTCDay()]}, ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}` : WEEKDAYS[at.getUTCDay()];
}

export function festivalPlace(edition) {
  return [edition?.venue, [edition?.city, edition?.region].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
}

export function festivalLength(edition) {
  const days = Array.isArray(edition?.days) ? edition.days.length : 0;
  return days > 1 ? `${days} days` : days === 1 ? "1 day" : "";
}

// Poster tiers: the first few billed acts are the headliners, then the next
// rows, then everyone else. Billing order comes from the ticket listing.
export function lineupTiers(lineup, { day = null } = {}) {
  const acts = (Array.isArray(lineup) ? lineup : []).filter((act) => act?.name && (!day || !act.days?.length || act.days.includes(day)));
  return [
    { key: "top", acts: acts.slice(0, 4) },
    { key: "middle", acts: acts.slice(4, 16) },
    { key: "rest", acts: acts.slice(16) },
  ].filter((tier) => tier.acts.length);
}

// Whether the lineup knows which acts play which day.
export const lineupHasDays = (lineup) => (Array.isArray(lineup) ? lineup : []).some((act) => Array.isArray(act?.days) && act.days.length);

export function goingLine(edition) {
  const going = Number(edition?.going) || 0;
  if (!going) return "";
  return going === 1 ? "1 member going" : `${going.toLocaleString("en-US")} members going`;
}

// Lineup just announced or changed in the last two weeks.
export const lineupIsNew = (edition, now = Date.now()) => Number(edition?.lineupChangedAt) > now - 14 * 86_400_000;

// How long until an edition starts, by the viewer's calendar day: "Happening
// now", "Starts tomorrow", "In 5 days", "In 3 weeks", "In 4 months". Null
// once it is over or when the date is unknown.
export function festivalCountdown(edition, now = Date.now()) {
  const start = parts(edition?.startDate);
  if (!start) return null;
  const end = edition.endDate > edition.startDate ? parts(edition.endDate) || start : start;
  const at = new Date(now);
  const today = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());
  if (today > end.getTime()) return null;
  const days = Math.round((start.getTime() - today) / DAY_MS);
  if (days <= 0) return { days: 0, live: true, label: "Happening now" };
  if (days === 1) return { days, live: false, label: "Starts tomorrow" };
  if (days < 14) return { days, live: false, label: `In ${days} days` };
  if (days < 60) return { days, live: false, label: `In ${Math.round(days / 7)} weeks` };
  return { days, live: false, label: `In ${Math.round(days / 30.44)} months` };
}

// Each festival keeps its own two-colour gel, picked from its name, so the
// posters look different from one another but the same every visit.
export const FESTIVAL_ACCENTS = Object.freeze([
  ["#FF7A59", "#FF3D8B"],
  ["#7B5CFF", "#FF4FD8"],
  ["#00B7FF", "#6A5CFF"],
  ["#FFB224", "#FF5A36"],
  ["#1ED99B", "#0094FF"],
  ["#FF4F79", "#FFB84D"],
  ["#B45CFF", "#00D1FF"],
]);

export function festivalAccent(key) {
  const text = String(key || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return FESTIVAL_ACCENTS[hash % FESTIVAL_ACCENTS.length];
}

// Upcoming editions grouped by the month they start, in date order.
export function festivalMonths(upcoming) {
  const months = [];
  for (const edition of Array.isArray(upcoming) ? upcoming : []) {
    const key = typeof edition?.startDate === "string" ? edition.startDate.slice(0, 7) : "";
    if (!/^\d{4}-\d{2}$/u.test(key)) continue;
    const last = months[months.length - 1];
    if (last?.key === key) last.editions.push(edition);
    else months.push({ key, title: `${LONG_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, short: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, editions: [edition] });
  }
  return months;
}

// The headline numbers for the festivals page.
export function festivalSummary(upcoming, now = Date.now()) {
  const list = Array.isArray(upcoming) ? upcoming : [];
  const countries = new Set(list.map((edition) => edition?.countryCode).filter(Boolean));
  const next = list.find((edition) => festivalCountdown(edition, now)) || null;
  return { festivals: list.length, newLineups: list.filter((edition) => lineupIsNew(edition, now)).length, countries: countries.size, next };
}
