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
  CREATE INDEX IF NOT EXISTS idx_news_live_notes_event ON news_live_notes(event_id,created_at);`);
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

export function startLiveEvent(database, { title, keywords, hours, actorId = null, at = Date.now() } = {}) {
  const name = String(title || "").replace(/\s+/gu, " ").trim();
  if (name.length < 3 || name.length > 80) fail("VALIDATION_FAILED", "Give the live coverage a title of 3 to 80 characters.");
  const words = [...new Set((Array.isArray(keywords) ? keywords : String(keywords || "").split(","))
    .map((word) => String(word).replace(/\s+/gu, " ").trim()).filter(Boolean))];
  if (!words.length || words.length > 6 || words.some((word) => word.length < 2 || word.length > 40)) {
    fail("VALIDATION_FAILED", "Add 1 to 6 keywords the outlets will use, such as VMAs, Video Music Awards.");
  }
  const length = Number(hours);
  if (!Number.isFinite(length) || length < 1 || length > MAX_LIVE_HOURS) fail("VALIDATION_FAILED", `Live coverage runs 1 to ${MAX_LIVE_HOURS} hours.`);
  const running = database.prepare("SELECT COUNT(*) AS n FROM news_live_events WHERE ended_at IS NULL AND ends_at>?").get(at).n;
  if (running >= 2) fail("CONFLICT", "Two live events are already running. End one first.");
  const id = randomUUID();
  database.prepare(`INSERT INTO news_live_events (id,slug,title,keywords,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, slugFor(database, name, at), name, JSON.stringify(words), at, at + Math.round(length * HOUR), actorId, at);
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

function eventJson(database, event, at) {
  const items = timeline(database, event, at);
  return {
    id: event.id, slug: event.slug, title: event.title, keywords: JSON.parse(event.keywords),
    live: isLive(event, at), startsAt: event.starts_at, endsAt: endOf(event),
    updatedAt: items[0]?.at ?? event.starts_at, count: items.length, items,
  };
}

// Public: events live now, or ended in the last 18 hours (the morning recap).
export function publicLiveCoverage(database, { at = Date.now() } = {}) {
  const events = database.prepare(`SELECT * FROM news_live_events WHERE starts_at<=? AND COALESCE(ended_at,ends_at)>?
    ORDER BY starts_at DESC LIMIT 3`).all(at, at - SHOWN_AFTER_END_MS);
  return { events: events.map((event) => eventJson(database, event, at)) };
}

export const liveEventRunning = (database, at = Date.now()) =>
  !!database.prepare("SELECT 1 FROM news_live_events WHERE starts_at<=? AND COALESCE(ended_at,ends_at)>? LIMIT 1").get(at, at);

// Staff view: current and recent events with every update, including the note
// IDs needed to remove one.
export function staffLiveCoverage(database, { at = Date.now() } = {}) {
  return publicLiveCoverage(database, { at }).events;
}
