// Canonical performance dates.
//
// A Performance is artist + venue + date, and `concertKey` puts the date string
// straight into that identity. When the stored date was also the *display*
// string ("YYYY · MM · DD" from the DatePicker), any variation in the separator
// forked one night into two performances and split its lounge, attendance and
// score aggregation. A row that reached the database as "2026 <U+FFFD> 06
// <U+FFFD> 21" did exactly that to The Fillmore.
//
// So: storage is ISO `YYYY-MM-DD`, always. Display formatting happens at render
// time via `formatDate`. Everything that reads a date runs it through
// `toIsoDate` first, which means legacy rows, bundled seed data and provider
// payloads all collapse onto one identity regardless of how they were written.

// Separator is deliberately permissive on read (1-3 non-digits covers "-", "/",
// " · ", and the mangled " <U+FFFD> ") and never preserved on write.
const DATE_PARTS = /^(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})$/;

const pad = (n) => String(n).padStart(2, "0");

// 1900 through two years out: wide enough for archival logs and announced
// tours, narrow enough to catch a mistyped or mangled year.
const MIN_YEAR = 1900;
const maxYear = () => new Date().getFullYear() + 2;

// The one parser. Returns "YYYY-MM-DD", or "" for anything that is not a real
// calendar day. Never guesses: "2026-02-31" is not a date, it is a typo.
export function toIsoDate(value) {
  const match = DATE_PARTS.exec(String(value ?? "").trim());
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > maxYear()) return "";
  const candidate = new Date(Date.UTC(year, month - 1, day));
  // Rejects 2026-02-31 and friends: Date rolls those over to another day.
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return "";
  return `${year}-${pad(month)}-${pad(day)}`;
}

export const isValidDate = (value) => toIsoDate(value) !== "";

// Display form. Keeps the interface's existing "YYYY · MM · DD" look, so this
// migration changes what is stored without changing what anyone sees. Anything
// unparseable falls back rather than rendering mojibake at someone.
export function formatDate(value, fallback = "") {
  const iso = toIsoDate(value);
  if (!iso) return fallback;
  const [year, month, day] = iso.split("-");
  return `${year} · ${month} · ${day}`;
}

// Today, in the canonical stored form. Uses local calendar components so a show
// logged at 11pm is not dated tomorrow.
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
