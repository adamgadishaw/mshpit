// Display helpers for festivals: date ranges, places, lineup poster tiers and
// how many people are going on each day.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
