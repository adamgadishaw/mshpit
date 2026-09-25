import { CREW_NOTE_MAX, CREW_PURPOSES, CREW_PURPOSE_LIMIT } from "../../../src/domain/crew.mjs";
import { stableShowIdForTourDateId, normalizeTourDateId } from "../shows/showIdentity.js";

// Crew: find people to go to a show with. Three steps, each opt-in:
//   1. swipe through upcoming shows and say you are going (or interested),
//   2. switch on "looking for a crew" for a show, saying what you are after,
//   3. swipe through others looking for a crew for that same show.
// Two people who both say yes are a crew, and may message each other.
//
// Safety rules live here, not in the screens: adults only; you are shown only
// to people seeking a crew for the same show; a one-sided like is never
// revealed; blocks hide people both ways; switching off hides you at once.

export { CREW_PURPOSES };
const NOTE_MAX = CREW_NOTE_MAX;
const DECK_SIZE = 20;

export class CrewError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ensureCrewSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS crew_seekers (
    show_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purposes TEXT NOT NULL DEFAULT '[]' CHECK(length(purposes) <= 400),
    note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 400),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (show_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_crew_seekers_user ON crew_seekers(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS crew_swipes (
    show_id TEXT NOT NULL,
    from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    decision TEXT NOT NULL CHECK(decision IN ('like','pass')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (show_id, from_id, to_id)
  );
  CREATE INDEX IF NOT EXISTS idx_crew_swipes_target ON crew_swipes(show_id, to_id, decision);
  CREATE TABLE IF NOT EXISTS crew_matches (
    show_id TEXT NOT NULL,
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (show_id, user_a, user_b),
    CHECK (user_a < user_b)
  );
  CREATE INDEX IF NOT EXISTS idx_crew_matches_a ON crew_matches(user_a, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_crew_matches_b ON crew_matches(user_b, created_at DESC);
  CREATE TABLE IF NOT EXISTS crew_show_passes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tour_date_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, tour_date_id)
  );`);
}

const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max) : "");

export function cleanCrewPurposes(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter((item) => typeof item === "string" && Object.hasOwn(CREW_PURPOSES, item)))].slice(0, CREW_PURPOSE_LIMIT);
}

export function assertCrewAdult(user) {
  if (user?.age_band === "18_plus") return;
  if (!user?.age_band || user.age_band === "unknown") {
    throw new CrewError(403, "Choose your age group in Settings to use Crew. It is for adults 18 and over.", "CREW_AGE_REQUIRED");
  }
  throw new CrewError(403, "Crew is for adults 18 and over.", "CREW_ADULTS_ONLY");
}

function showIdFor(tourDateId) {
  const id = normalizeTourDateId(tourDateId);
  const showId = id ? stableShowIdForTourDateId(id) : null;
  if (!showId) throw new CrewError(400, "Choose a show first.", "VALIDATION_FAILED");
  return { tourDateId: id, showId };
}

function attendanceState(database, showId, userId) {
  return database.prepare("SELECT state FROM show_attendance WHERE show_id=? AND user_id=?").get(showId, userId)?.state || null;
}

function crowdCounts(database, showId) {
  const going = database.prepare(`SELECT COUNT(*) c FROM show_attendance WHERE show_id=? AND state IN ('going','here')
    AND visibility<>'private'`).get(showId)?.c || 0;
  const crew = database.prepare("SELECT COUNT(*) c FROM crew_seekers WHERE show_id=?").get(showId)?.c || 0;
  return { going, lookingForCrew: crew };
}

// Public, identity-free counts for a show page.
export function crewCountsForTourDate(database, tourDateId) {
  const id = normalizeTourDateId(tourDateId);
  const showId = id ? stableShowIdForTourDateId(id) : null;
  return showId ? crowdCounts(database, showId) : { going: 0, lookingForCrew: 0 };
}

// 1. The shows deck: upcoming visible shows in the member's city (or a city
// they choose) they have not answered yet, soonest first.
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
    cards.push({ ...show, tourDateId: row.id, counts: crowdCounts(database, showId) });
  }
  return { city: place, shows: cards };
}

export function passCrewShow(database, { user, tourDateId, at = Date.now() }) {
  const { tourDateId: id } = showIdFor(tourDateId);
  database.prepare("INSERT OR IGNORE INTO crew_show_passes(user_id,tour_date_id,created_at) VALUES (?,?,?)").run(user.id, id, at);
  return { ok: true };
}

// 2. Looking for a crew for one show you are going to (or interested in).
export function setCrewSeeking(database, { user, tourDateId, purposes, note, at = Date.now() }) {
  assertCrewAdult(user);
  const { showId } = showIdFor(tourDateId);
  const state = attendanceState(database, showId, user.id);
  if (!["interested", "going", "here"].includes(state)) {
    throw new CrewError(409, "Say you're going or interested first, then look for a crew.", "CREW_ATTENDANCE_REQUIRED");
  }
  const cleaned = cleanCrewPurposes(purposes);
  const cleanNote = text(note, NOTE_MAX);
  database.prepare(`INSERT INTO crew_seekers(show_id,user_id,purposes,note,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(show_id,user_id) DO UPDATE SET purposes=excluded.purposes,note=excluded.note,updated_at=excluded.updated_at`)
    .run(showId, user.id, JSON.stringify(cleaned), cleanNote, at, at);
  return { seeking: true, purposes: cleaned, note: cleanNote, counts: crowdCounts(database, showId) };
}

export function stopCrewSeeking(database, { user, tourDateId }) {
  const { showId } = showIdFor(tourDateId);
  database.prepare("DELETE FROM crew_seekers WHERE show_id=? AND user_id=?").run(showId, user.id);
  return { seeking: false, counts: crowdCounts(database, showId) };
}

function sharedArtists(database, a, b) {
  const artists = (id) => new Map(database.prepare(`SELECT artist FROM posts WHERE user_id=? AND removed=0 AND artist<>''
      ORDER BY created_at DESC LIMIT 300`).all(id).map((row) => [row.artist.trim().toLowerCase(), row.artist.trim()]));
  const mine = artists(a);
  const theirs = artists(b);
  return [...mine.keys()].filter((key) => theirs.has(key)).slice(0, 3).map((key) => mine.get(key));
}

function sharedShowCount(database, a, b) {
  return database.prepare(`SELECT COUNT(*) c FROM show_attendance x JOIN show_attendance y ON y.show_id=x.show_id
    WHERE x.user_id=? AND y.user_id=? AND x.state IN ('going','here','went') AND y.state IN ('going','here','went')`).get(a, b)?.c || 0;
}

// 3. The people deck for one show: others looking for a crew there, whom you
// have not answered yet. Only visible to someone seeking a crew themselves.
export function crewPeopleDeck(database, { user, tourDateId, projectUser, blockedEitherWay, isAvailable = () => true }) {
  assertCrewAdult(user);
  const { showId } = showIdFor(tourDateId);
  if (!database.prepare("SELECT 1 FROM crew_seekers WHERE show_id=? AND user_id=?").get(showId, user.id)) {
    throw new CrewError(409, "Turn on Looking for a crew for this show to see who else is.", "CREW_NOT_SEEKING");
  }
  const rows = database.prepare(`SELECT s.user_id,s.purposes,s.note,s.updated_at,u.age_band,a.state FROM crew_seekers s
      JOIN users u ON u.id=s.user_id
      LEFT JOIN show_attendance a ON a.show_id=s.show_id AND a.user_id=s.user_id
      WHERE s.show_id=? AND s.user_id<>?
        AND NOT EXISTS (SELECT 1 FROM crew_swipes w WHERE w.show_id=s.show_id AND w.from_id=? AND w.to_id=s.user_id)
      ORDER BY s.updated_at DESC LIMIT 200`).all(showId, user.id, user.id);
  const people = [];
  for (const row of rows) {
    if (people.length >= DECK_SIZE) break;
    if (row.age_band !== "18_plus" || blockedEitherWay(user.id, row.user_id) || !isAvailable(row.user_id)) continue;
    const person = projectUser(row.user_id);
    if (!person) continue;
    let purposes = [];
    try { purposes = cleanCrewPurposes(JSON.parse(row.purposes)); } catch { purposes = []; }
    people.push({
      ...person,
      going: row.state === "going" || row.state === "here",
      purposes,
      note: row.note || "",
      sharedArtists: sharedArtists(database, user.id, row.user_id),
      sharedShows: sharedShowCount(database, user.id, row.user_id),
    });
  }
  return { people };
}

function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

export function crewMatchExists(database, a, b) {
  if (!a || !b || a === b) return false;
  const [first, second] = orderedPair(a, b);
  return !!database.prepare("SELECT 1 FROM crew_matches WHERE user_a=? AND user_b=? LIMIT 1").get(first, second);
}

// A yes or no on one person. Two yeses make a crew.
export function swipeCrewPerson(database, { user, tourDateId, targetId, decision, blockedEitherWay, at = Date.now() }) {
  assertCrewAdult(user);
  const { showId } = showIdFor(tourDateId);
  if (!["like", "pass"].includes(decision)) throw new CrewError(400, "Choose yes or no.", "VALIDATION_FAILED");
  const target = typeof targetId === "string" ? targetId.slice(0, 120) : "";
  if (!target || target === user.id) throw new CrewError(400, "Choose someone else.", "VALIDATION_FAILED");
  const seeking = database.prepare("SELECT 1 FROM crew_seekers WHERE show_id=? AND user_id=?");
  const targetAdult = database.prepare("SELECT age_band FROM users WHERE id=?").get(target)?.age_band === "18_plus";
  if (!seeking.get(showId, user.id) || !seeking.get(showId, target) || !targetAdult || blockedEitherWay(user.id, target)) {
    // The same answer whatever the reason, so a swipe cannot probe someone.
    throw new CrewError(404, "That person is no longer looking for a crew for this show.", "NOT_FOUND");
  }
  database.prepare(`INSERT INTO crew_swipes(show_id,from_id,to_id,decision,created_at) VALUES (?,?,?,?,?)
    ON CONFLICT(show_id,from_id,to_id) DO UPDATE SET decision=excluded.decision,created_at=excluded.created_at`)
    .run(showId, user.id, target, decision, at);
  if (decision !== "like") return { matched: false };
  const liked = database.prepare("SELECT 1 FROM crew_swipes WHERE show_id=? AND from_id=? AND to_id=? AND decision='like'")
    .get(showId, target, user.id);
  if (!liked) return { matched: false };
  const [first, second] = orderedPair(user.id, target);
  const created = database.prepare("INSERT OR IGNORE INTO crew_matches(show_id,user_a,user_b,created_at) VALUES (?,?,?,?)")
    .run(showId, first, second, at).changes > 0;
  return { matched: true, created };
}

// Your crews, newest first, with the show they are for.
export function listCrewMatches(database, { user, projectUser, blockedEitherWay, limit = 100 }) {
  const rows = database.prepare(`SELECT m.show_id,m.created_at,CASE WHEN m.user_a=? THEN m.user_b ELSE m.user_a END other,
      sh.artist,sh.venue,sh.city,sh.date,sh.tour_date_id
    FROM crew_matches m LEFT JOIN shows sh ON sh.id=m.show_id
    WHERE m.user_a=? OR m.user_b=? ORDER BY m.created_at DESC LIMIT ?`).all(user.id, user.id, user.id, Math.min(200, limit));
  return rows.filter((row) => !blockedEitherWay(user.id, row.other)).map((row) => {
    const person = projectUser(row.other);
    return person ? {
      person,
      matchedAt: row.created_at,
      show: { artist: row.artist || "", venue: row.venue || "", city: row.city || "", date: row.date || "", tourDateId: row.tour_date_id || null },
    } : null;
  }).filter(Boolean);
}

// The shows where you are looking for a crew, with how many others are.
export function listMyCrewShows(database, { user }) {
  return database.prepare(`SELECT s.show_id,s.purposes,s.note,sh.artist,sh.venue,sh.city,sh.date,sh.tour_date_id,
      (SELECT COUNT(*) FROM crew_seekers o WHERE o.show_id=s.show_id AND o.user_id<>s.user_id) others
    FROM crew_seekers s LEFT JOIN shows sh ON sh.id=s.show_id
    WHERE s.user_id=? ORDER BY sh.date ASC, s.updated_at DESC LIMIT 100`).all(user.id).map((row) => {
    let purposes = [];
    try { purposes = cleanCrewPurposes(JSON.parse(row.purposes)); } catch { purposes = []; }
    return {
      tourDateId: row.tour_date_id || null,
      artist: row.artist || "",
      venue: row.venue || "",
      city: row.city || "",
      date: row.date || "",
      purposes,
      note: row.note || "",
      others: row.others || 0,
    };
  });
}

// Upcoming shows with the most people going or looking for a crew, for the
// public /crew page. Counts only; callers still check each show is public.
export function crewShowcaseCandidates(database, { today, limit = 60 }) {
  return database.prepare(`SELECT tour_date_id tourDateId, crew lookingForCrew, going FROM (
      SELECT sh.tour_date_id, sh.date,
        (SELECT COUNT(*) FROM crew_seekers c WHERE c.show_id=sh.id) crew,
        (SELECT COUNT(*) FROM show_attendance a WHERE a.show_id=sh.id AND a.state IN ('going','here') AND a.visibility<>'private') going
      FROM shows sh WHERE sh.tour_date_id IS NOT NULL AND sh.date>=?)
    WHERE crew>0 OR going>0 ORDER BY crew DESC, going DESC, date ASC LIMIT ?`).all(today, Math.min(200, limit));
}
