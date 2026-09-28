// Live coverage for big nights (award shows, festival headliners). The owner
// starts an event with a title, a few keywords and how long it runs. Its page
// is a running timeline of every outlet headline that matches the keywords,
// plus short updates the owner posts. Nothing here calls Claude: the headlines
// come from the feeds the desk already reads (every 5 minutes while an event
// is live) and the updates are typed by hand.
import { randomUUID } from "node:crypto";
import { newsSourceById } from "./newsSources.js";

const HOUR = 60 * 60 * 1000;
const BEFORE_START_MS = 3 * HOUR;
const AFTER_END_MS = 6 * HOUR;
const SHOWN_AFTER_END_MS = 18 * HOUR;
const MAX_ITEMS = 60;
export const MAX_LIVE_HOURS = 12;

export class NewsLiveError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NewsLiveError";
    this.code = code;
  }
}
const fail = (code, message) => { throw new NewsLiveError(code, message); };

export function ensureNewsLiveSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS news_live_events (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    keywords TEXT NOT NULL,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    ended_at INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_news_live_events_end ON news_live_events(ends_at);
  CREATE TABLE IF NOT EXISTS news_live_notes (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES news_live_events(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    url TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    removed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_news_live_notes_event ON news_live_notes(event_id,created_at);
  CREATE TABLE IF NOT EXISTS news_live_categories (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES news_live_events(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    nominees TEXT NOT NULL,
    winner TEXT,
    announced_at INTEGER,
    note_id TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_news_live_categories_event ON news_live_categories(event_id,position);`);
}

// Lower case, no accents, words separated by single spaces and padded, so a
// keyword matches whole words only ("vma" never matches "vmax").
const normalize = (text) => ` ${String(text || "").normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
  .replace(/[^a-z0-9]+/gu, " ").trim()} `;

export function liveKeywordMatch(keywords, text) {
  const haystack = normalize(text);
  return keywords.some((keyword) => {
    const needle = normalize(keyword).trim();
    return needle.length >= 2 && haystack.includes(` ${needle} `);
  });
}

const endOf = (event) => event.ended_at ?? event.ends_at;
const isLive = (event, at) => event.starts_at <= at && at < endOf(event);

function slugFor(database, title, at) {
  const base = normalize(title).trim().replace(/ /gu, "-").slice(0, 60) || "live";
  const taken = database.prepare("SELECT 1 FROM news_live_events WHERE slug=?");
  if (!taken.get(base)) return base;
  const dated = `${base}-${new Date(at).toISOString().slice(0, 10)}`;
  return taken.get(dated) ? `${base}-${randomUUID().slice(0, 8)}` : dated;
}

function readEvent(database, id) {
  const event = typeof id === "string" && id.length <= 80 ? database.prepare("SELECT * FROM news_live_events WHERE id=?").get(id) : null;
  if (!event) fail("NOT_FOUND", "That live coverage no longer exists.");
  return event;
}

// `startsAt` (optional) schedules a future show, up to 60 days ahead, so its
// categories can be set up before the night; it goes public when it starts.
export function startLiveEvent(database, { title, keywords, hours, startsAt = null, actorId = null, at = Date.now() } = {}) {
  const name = String(title || "").replace(/\s+/gu, " ").trim();
  if (name.length < 3 || name.length > 80) fail("VALIDATION_FAILED", "Give the live coverage a title of 3 to 80 characters.");
  const words = [...new Set((Array.isArray(keywords) ? keywords : String(keywords || "").split(","))
    .map((word) => String(word).replace(/\s+/gu, " ").trim()).filter(Boolean))];
  if (!words.length || words.length > 6 || words.some((word) => word.length < 2 || word.length > 40)) {
    fail("VALIDATION_FAILED", "Add 1 to 6 keywords the outlets will use, such as VMAs, Video Music Awards.");
  }
  const length = Number(hours);
  if (!Number.isFinite(length) || length < 1 || length > MAX_LIVE_HOURS) fail("VALIDATION_FAILED", `Live coverage runs 1 to ${MAX_LIVE_HOURS} hours.`);
  const start = startsAt === null || startsAt === undefined || startsAt === "" ? at : Number(startsAt);
  if (!Number.isSafeInteger(start) || start < at - HOUR || start > at + 60 * 24 * HOUR) fail("VALIDATION_FAILED", "Pick a start time from now up to 60 days ahead.");
  const end = start + Math.round(length * HOUR);
  const overlapping = database.prepare("SELECT COUNT(*) AS n FROM news_live_events WHERE COALESCE(ended_at,ends_at)>? AND starts_at<?").get(start, end).n;
  if (overlapping >= 2) fail("CONFLICT", "Two live events already cover that time. End or move one first.");
  const id = randomUUID();
  database.prepare(`INSERT INTO news_live_events (id,slug,title,keywords,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, slugFor(database, name, start), name, JSON.stringify(words), start, end, actorId, at);
  return readEvent(database, id);
}

export function endLiveEvent(database, id, { at = Date.now() } = {}) {
  const event = readEvent(database, id);
  if (event.ended_at === null && event.ends_at > at) database.prepare("UPDATE news_live_events SET ended_at=? WHERE id=?").run(at, event.id);
  return readEvent(database, event.id);
}

export function addLiveNote(database, eventId, { text, url = null, actorId = null, at = Date.now() } = {}) {
  const event = readEvent(database, eventId);
  if (!isLive(event, at)) fail("CONFLICT", "That live coverage has ended.");
  const body = String(text || "").replace(/\s+/gu, " ").trim();
  if (!body || body.length > 280) fail("VALIDATION_FAILED", "An update is 1 to 280 characters.");
  let link = null;
  if (url) {
    try { link = new URL(String(url).trim()); }
    catch { fail("VALIDATION_FAILED", "The link is not a web address."); }
    if (link.protocol !== "https:" || link.username || link.password) fail("VALIDATION_FAILED", "Links must start with https://.");
  }
  const id = randomUUID();
  database.prepare("INSERT INTO news_live_notes (id,event_id,text,url,created_by,created_at) VALUES (?,?,?,?,?,?)")
    .run(id, event.id, body, link ? link.href.slice(0, 2000) : null, actorId, at);
  return id;
}

export function removeLiveNote(database, noteId, { at = Date.now() } = {}) {
  const note = typeof noteId === "string" ? database.prepare("SELECT id FROM news_live_notes WHERE id=?").get(noteId) : null;
  if (!note) fail("NOT_FOUND", "That update no longer exists.");
  database.prepare("UPDATE news_live_notes SET removed_at=? WHERE id=? AND removed_at IS NULL").run(at, note.id);
}

// Newest first: outlet headlines matching the keywords, and the owner's updates.
function timeline(database, event, at) {
  const keywords = JSON.parse(event.keywords);
  const until = Math.min(at, endOf(event) + AFTER_END_MS);
  const reports = database.prepare(`SELECT url,source_id,title,description,published_at FROM news_reports
    WHERE published_at>=? AND published_at<=? ORDER BY published_at DESC,url ASC LIMIT 3000`)
    .all(event.starts_at - BEFORE_START_MS, until)
    .filter((row) => liveKeywordMatch(keywords, `${row.title} ${row.description || ""}`))
    .map((row) => ({ kind: "report", id: row.url, at: row.published_at, title: row.title, url: row.url,
      source: newsSourceById(row.source_id)?.name || row.source_id }));
  const notes = database.prepare(`SELECT id,text,url,created_at FROM news_live_notes WHERE event_id=? AND removed_at IS NULL
    ORDER BY created_at DESC LIMIT ?`).all(event.id, MAX_ITEMS)
    .map((row) => ({ kind: "note", id: row.id, at: row.created_at, text: row.text, url: row.url || null, source: "Mshpit" }));
  return [...notes, ...reports].sort((left, right) => right.at - left.at || (left.id < right.id ? -1 : 1)).slice(0, MAX_ITEMS);
}

// ---- Award show winners -------------------------------------------------
// The owner pastes the categories and nominees once, then taps each winner as
// it is announced. A category is "Video of the Year: A; B; C" on one line, or
// a line ending in ":" followed by one nominee per line ("- " or "• " fine).
const MAX_CATEGORIES = 40;
const MAX_NOMINEES = 12;
const clean = (value, max) => String(value || "").replace(/^[\s\-•*·]+/u, "").replace(/\s+/gu, " ").trim().slice(0, max);

export function parseLiveCategories(text) {
  const categories = [];
  let open = null;
  for (const raw of String(text || "").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line) { open = null; continue; }
    const colon = line.indexOf(":");
    if (colon > 0 && colon === line.length - 1) {
      open = { name: clean(line.slice(0, -1), 120), nominees: [] };
      categories.push(open);
    } else if (colon > 0 && /[;|]/u.test(line.slice(colon + 1))) {
      categories.push({ name: clean(line.slice(0, colon), 120), nominees: line.slice(colon + 1).split(/[;|]/u).map((item) => clean(item, 160)).filter(Boolean) });
      open = null;
    } else if (open) {
      open.nominees.push(clean(line, 160));
    } else if (colon > 0) {
      // One nominee after the colon, more may follow on the next lines.
      open = { name: clean(line.slice(0, colon), 120), nominees: [clean(line.slice(colon + 1), 160)].filter(Boolean) };
      categories.push(open);
    }
  }
  const usable = categories.map((category) => ({ ...category, nominees: [...new Set(category.nominees.filter(Boolean))] }))
    .filter((category) => category.name && category.nominees.length);
  if (!usable.length) fail("VALIDATION_FAILED", "Paste each category with its nominees, like: Video of the Year: Artist A; Artist B; Artist C");
  if (usable.length > MAX_CATEGORIES) fail("VALIDATION_FAILED", `Up to ${MAX_CATEGORIES} categories.`);
  if (usable.some((category) => category.nominees.length > MAX_NOMINEES)) fail("VALIDATION_FAILED", `Up to ${MAX_NOMINEES} nominees a category.`);
  return usable;
}

const sameName = (left, right) => normalize(left) === normalize(right);

// Replaces the category list. A winner already marked survives when its
// category and nominee are still there.
export function setLiveCategories(database, eventId, text, { at = Date.now() } = {}) {
  const event = readEvent(database, eventId);
  const parsed = parseLiveCategories(text);
  const before = database.prepare("SELECT name,winner,announced_at,note_id FROM news_live_categories WHERE event_id=?").all(event.id);
  database.exec("SAVEPOINT news_live_categories");
  try {
    database.prepare("DELETE FROM news_live_categories WHERE event_id=?").run(event.id);
    const insert = database.prepare(`INSERT INTO news_live_categories (id,event_id,position,name,nominees,winner,announced_at,note_id,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    parsed.forEach((category, position) => {
      const kept = before.find((old) => sameName(old.name, category.name) && old.winner && category.nominees.some((name) => sameName(name, old.winner)));
      insert.run(randomUUID(), event.id, position, category.name, JSON.stringify(category.nominees), kept?.winner ?? null,
        kept?.announced_at ?? null, kept?.note_id ?? null, at);
    });
    database.exec("RELEASE news_live_categories");
  } catch (error) {
    database.exec("ROLLBACK TO news_live_categories; RELEASE news_live_categories");
    throw error;
  }
  return parsed.length;
}

// Marks (or with `nominee: null` clears) a category's winner, and posts or
// removes the matching "X wins Y" update on the timeline.
export function markLiveWinner(database, eventId, categoryId, nominee, { actorId = null, at = Date.now() } = {}) {
  const event = readEvent(database, eventId);
  const category = typeof categoryId === "string"
    ? database.prepare("SELECT * FROM news_live_categories WHERE id=? AND event_id=?").get(categoryId, event.id) : null;
  if (!category) fail("NOT_FOUND", "That category no longer exists. Refresh and try again.");
  const winner = nominee === null ? null : JSON.parse(category.nominees).find((name) => sameName(name, nominee));
  if (nominee !== null && !winner) fail("VALIDATION_FAILED", "Pick one of the category's nominees.");
  database.exec("SAVEPOINT news_live_winner");
  try {
    if (category.note_id) database.prepare("UPDATE news_live_notes SET removed_at=? WHERE id=? AND removed_at IS NULL").run(at, category.note_id);
    let noteId = null;
    if (winner && isLive(event, at)) {
      noteId = randomUUID();
      database.prepare("INSERT INTO news_live_notes (id,event_id,text,url,created_by,created_at) VALUES (?,?,?,?,?,?)")
        .run(noteId, event.id, `${winner} wins ${category.name}`.slice(0, 280), null, actorId, at);
    }
    database.prepare("UPDATE news_live_categories SET winner=?,announced_at=?,note_id=?,updated_at=? WHERE id=?")
      .run(winner, winner ? at : null, noteId, at, category.id);
    database.exec("RELEASE news_live_winner");
  } catch (error) {
    database.exec("ROLLBACK TO news_live_winner; RELEASE news_live_winner");
    throw error;
  }
  return winner;
}

// The act a nominee names: "Sabrina Carpenter - Espresso" is Sabrina Carpenter.
const nomineeAct = (name) => String(name).split(/\s[-–—]\s|,\s(?:feat|ft)\.?\s/u)[0].trim();
const CATEGORY_FILLER = new Set(["best", "the", "of", "and", "for", "award", "awards", "video", "song", "artist"]);

// Unannounced categories whose winner an outlet headline already names:
// the act, a win verb, and a telling word from the category. Staff confirm.
function winnerSuggestions(categories, reports) {
  const headlines = reports.map((report) => ({ ...report, text: normalize(report.title) }));
  return categories.filter((category) => !category.winner).flatMap((category) => {
    const words = normalize(category.name).trim().split(" ").filter((word) => word.length >= 3 && !CATEGORY_FILLER.has(word));
    for (const report of headlines) {
      if (!/ (wins|won|win|takes home|nabs|scores) /u.test(report.text)) continue;
      if (words.length && !words.some((word) => report.text.includes(` ${word} `))) continue;
      const nominee = category.nominees.find((name) => {
        const act = normalize(nomineeAct(name)).trim();
        return act.length >= 3 && report.text.includes(` ${act} `);
      });
      if (nominee) return [{ categoryId: category.id, nominee, source: report.source, url: report.url, at: report.at }];
    }
    return [];
  });
}

function categoriesFor(database, event) {
  return database.prepare("SELECT * FROM news_live_categories WHERE event_id=? ORDER BY position").all(event.id)
    .map((row) => ({ id: row.id, name: row.name, nominees: JSON.parse(row.nominees), winner: row.winner || null, announcedAt: row.announced_at || null }));
}

function eventJson(database, event, at, { staff = false } = {}) {
  const items = timeline(database, event, at);
  const categories = categoriesFor(database, event);
  const lastWinnerAt = Math.max(0, ...categories.map((category) => category.announcedAt || 0));
  return {
    id: event.id, slug: event.slug, title: event.title, keywords: JSON.parse(event.keywords),
    live: isLive(event, at), startsAt: event.starts_at, endsAt: endOf(event),
    updatedAt: Math.max(items[0]?.at ?? event.starts_at, lastWinnerAt), count: items.length, items,
    winners: { total: categories.length, announced: categories.filter((category) => category.winner).length, categories },
    ...(staff ? { suggestions: winnerSuggestions(categories, items.filter((item) => item.kind === "report")) } : {}),
  };
}

// Public: events live now, or ended in the last 18 hours (the morning recap).
export function publicLiveCoverage(database, { at = Date.now(), staff = false } = {}) {
  const events = database.prepare(`SELECT * FROM news_live_events WHERE starts_at<=? AND COALESCE(ended_at,ends_at)>?
    ORDER BY starts_at DESC LIMIT 3`).all(at, at - SHOWN_AFTER_END_MS);
  return { events: events.map((event) => eventJson(database, event, at, { staff })) };
}

// The permanent public page of one event (/news/live/<slug>): a winners list
// stays useful long after the night itself.
export function liveEventBySlug(database, slug, { at = Date.now() } = {}) {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,80}$/u.test(slug)) return null;
  const event = database.prepare("SELECT * FROM news_live_events WHERE slug=? AND starts_at<=?").get(slug, at);
  return event ? eventJson(database, event, at) : null;
}

// Every event page, newest first, for the sitemap and the /news hub.
export function liveEventPages(database, { at = Date.now(), limit = 50 } = {}) {
  return database.prepare(`SELECT slug,title,starts_at,COALESCE(ended_at,ends_at) AS ends FROM news_live_events
    WHERE starts_at<=? ORDER BY starts_at DESC LIMIT ?`).all(at, limit)
    .map((row) => ({ slug: row.slug, title: row.title, startsAt: row.starts_at, endsAt: row.ends, live: row.starts_at <= at && at < row.ends }));
}

export const liveEventRunning = (database, at = Date.now()) =>
  !!database.prepare("SELECT 1 FROM news_live_events WHERE starts_at<=? AND COALESCE(ended_at,ends_at)>? LIMIT 1").get(at, at);

// Staff view: current and recent events with every update (note IDs for
// removal) and suggested winners from outlet headlines.
export function staffLiveCoverage(database, { at = Date.now() } = {}) {
  const events = database.prepare(`SELECT * FROM news_live_events WHERE COALESCE(ended_at,ends_at)>?
    ORDER BY starts_at ASC LIMIT 5`).all(at - SHOWN_AFTER_END_MS);
  return events.map((event) => ({ ...eventJson(database, event, at, { staff: true }), scheduled: event.starts_at > at }));
}
