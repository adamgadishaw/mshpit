import { stableShowIdForTourDateId, normalizeTourDateId } from "../shows/showIdentity.js";

// Show swipe: flip through upcoming shows and say going, interested or skip.
// It only saves the member's own plans (the same attendance every show page
// uses), so it is for every age. Meeting people happens in each show's
// Lounge through group plans (showPlansService.js), never by swiping people.

const DECK_SIZE = 20;

export class CrewError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ensureCrewSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS crew_show_passes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tour_date_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, tour_date_id)
  );`);
}

const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max) : "");

function attendanceState(database, showId, userId) {
  return database.prepare("SELECT state FROM show_attendance WHERE show_id=? AND user_id=?").get(showId, userId)?.state || null;
}

function goingCount(database, showId) {
  return database.prepare(`SELECT COUNT(*) c FROM show_attendance WHERE show_id=? AND state IN ('going','here')
    AND visibility<>'private'`).get(showId)?.c || 0;
}

// Upcoming visible shows in the member's city (or a city they choose) that
// they have not answered yet, soonest first.
export function crewShowDeck(database, { user, city = null, visibleTourDates, projectShow, at = Date.now() }) {
  const place = text(city, 80) || text(user?.home_city, 80) || null;
  const today = new Date(at).toISOString().slice(0, 10);
  const rows = visibleTourDates(user, { today, city: place, limit: 300, at });
  const passed = new Set(database.prepare("SELECT tour_date_id FROM crew_show_passes WHERE user_id=?").all(user.id)
    .map((row) => row.tour_date_id));
  const cards = [];
  for (const row of rows) {
    if (cards.length >= DECK_SIZE) break;
    if (passed.has(row.id)) continue;
    const showId = stableShowIdForTourDateId(row.id);
    if (!showId || attendanceState(database, showId, user.id)) continue;
    const show = projectShow(row);
    if (!show) continue;
    cards.push({ ...show, tourDateId: row.id, going: goingCount(database, showId) });
  }
  return { city: place, shows: cards };
}

export function passCrewShow(database, { user, tourDateId, at = Date.now() }) {
  const id = normalizeTourDateId(tourDateId);
  if (!id || !stableShowIdForTourDateId(id)) throw new CrewError(400, "Choose a show first.", "VALIDATION_FAILED");
  database.prepare("INSERT OR IGNORE INTO crew_show_passes(user_id,tour_date_id,created_at) VALUES (?,?,?)").run(user.id, id, at);
  return { ok: true };
}
