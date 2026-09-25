// Artist news: new releases and newly added tour dates. Shared by the server
// (titles, search pages) and the screens, so the words match everywhere.

export const RELEASE_TYPES = Object.freeze({ album: "album", ep: "EP", single: "single" });

export function releaseTypeLabel(type) {
  return RELEASE_TYPES[type] || "release";
}

// "New album: Currents", "New single: Borderline".
export function releaseHeadline(release) {
  const type = releaseTypeLabel(release?.type);
  const noun = type === "EP" ? "EP" : type;
  return `New ${noun}: ${String(release?.title || "").trim()}`;
}

export function showsHeadline(count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  return n === 1 ? "New tour date added" : `${n} new tour dates added`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Calendar dates (YYYY-MM-DD) read as plain days, never shifted by time zone.
export function newsDateLabel(value, { withYear = true } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(typeof value === "string" ? value : "");
  if (!match) return "";
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return "";
  return `${MONTHS[month - 1]} ${day}${withYear ? `, ${year}` : ""}`;
}

// "Out now" for past or today, "Out Oct 3" for an announced future date.
export function releaseAvailability(releaseDate, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(releaseDate || "")) || !/^\d{4}-\d{2}-\d{2}$/u.test(String(today || ""))) return "";
  return releaseDate <= today ? "Out now" : `Out ${newsDateLabel(releaseDate, { withYear: false })}`;
}

// The years an artist's upcoming dates fall in: "2026" or "2026 & 2027".
export function tourYearsLabel(dates = []) {
  const years = [...new Set((Array.isArray(dates) ? dates : [])
    .map((value) => /^(\d{4})-\d{2}-\d{2}$/u.exec(String(value || ""))?.[1])
    .filter(Boolean))].sort();
  if (!years.length) return "";
  if (years.length === 1) return years[0];
  return `${years[0]} & ${years[years.length - 1]}`;
}
