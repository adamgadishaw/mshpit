// Shared words for Crew, used by the server rules and the screens alike.

export const CREW_PURPOSES = Object.freeze({
  meet_before: "Meet before doors",
  ride: "Share a ride",
  hotel: "Split a hotel",
  spare_ticket: "Have a spare ticket",
  need_ticket: "Need a ticket",
  pit: "Someone for the pit",
});

export const CREW_PURPOSE_LIMIT = 4;
export const CREW_NOTE_MAX = 160;

export function crewPurposeLabels(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids)].filter((id) => typeof id === "string" && Object.hasOwn(CREW_PURPOSES, id))
    .slice(0, CREW_PURPOSE_LIMIT).map((id) => CREW_PURPOSES[id]);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Show dates are calendar days (YYYY-MM-DD) in the venue's own time, so they
// are read as plain dates, never shifted through the viewer's time zone.
export function crewDateLabel(value, { short = false, today = null } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/u.exec(typeof value === "string" ? value : "");
  if (!match) return "";
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return "";
  const monthDay = `${MONTHS[month - 1]} ${day}`;
  if (short) return monthDay;
  const now = today ? new Date(`${today}T00:00:00Z`) : new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()));
  const days = Math.round((date - now) / 86_400_000);
  if (days === 0) return `Tonight · ${monthDay}`;
  if (days === 1) return `Tomorrow · ${monthDay}`;
  const sameYear = now.getUTCFullYear() === year;
  return `${DAYS[date.getUTCDay()]} · ${monthDay}${sameYear ? "" : `, ${year}`}`;
}

export function crewCountLabel(count, kind) {
  const n = Number.isFinite(Number(count)) ? Math.max(0, Math.floor(Number(count))) : 0;
  if (kind === "going") return n ? `${n} going` : "Be the first going";
  if (kind === "crew") return `${n} looking for a crew`;
  if (kind === "others") return `${n} ${n === 1 ? "other" : "others"} looking`;
  return String(n);
}
