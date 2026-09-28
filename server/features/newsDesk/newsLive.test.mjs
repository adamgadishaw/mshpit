import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ApiError } from "../../errors.js";
import { ensureNewsDeskSchema } from "./newsDeskService.js";
import { addLiveNote, endLiveEvent, ensureNewsLiveSchema, liveEventRunning, liveKeywordMatch, publicLiveCoverage, removeLiveNote, startLiveEvent } from "./newsLive.js";
import { newsLiveRoutes } from "./newsLiveRoutes.js";

// 2026-09-27 20:00 in Toronto: the VMAs are on.
const AT = Date.parse("2026-09-28T00:00:00Z");
const HOUR = 3_600_000;

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE moderation_actions(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',prior_state TEXT NOT NULL DEFAULT '{}',next_state TEXT NOT NULL DEFAULT '{}',request_id TEXT,created_at INTEGER NOT NULL);`);
  ensureNewsDeskSchema(db);
  ensureNewsLiveSchema(db);
  const report = db.prepare(`INSERT INTO news_reports (url,source_id,title,description,category,artist_keys,published_at,fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
  const add = (url, sourceId, title, at) => report.run(url, sourceId, title, "", "awards", "[]", at, at);
  add("https://www.billboard.com/vmas-winners", "billboard", "2026 MTV VMAs Winners List (Updating Live)", AT - HOUR);
  add("https://www.nme.com/vmas-performance", "nme", "Watch Sabrina Carpenter Open The Video Music Awards", AT + 20 * 60_000);
  add("https://variety.com/vmax", "variety", "IMAX and VMAX Screens Expand", AT);
  add("https://pitchfork.com/old-vmas", "pitchfork", "Looking Back At The 2025 VMAs", AT - 10 * HOUR);
  return db;
}

test("keywords match whole words, without accents or case", () => {
  assert.equal(liveKeywordMatch(["VMAs", "Video Music Awards"], "2026 MTV VMAs winners"), true);
  assert.equal(liveKeywordMatch(["video music awards"], "Watch her open the Video Music Awards!"), true);
  assert.equal(liveKeywordMatch(["vma"], "VMAX screens"), false);
  assert.equal(liveKeywordMatch(["Beyonce"], "Beyoncé wins big"), true);
});

test("a live event shows matching outlet headlines and the owner's updates, newest first", (t) => {
  const db = database(t);
  assert.equal(liveEventRunning(db, AT), false);
  assert.throws(() => startLiveEvent(db, { title: "VMAs", keywords: [], hours: 4, at: AT }), (error) => error.code === "VALIDATION_FAILED");
  assert.throws(() => startLiveEvent(db, { title: "2026 MTV VMAs", keywords: "VMAs", hours: 20, at: AT }), (error) => error.code === "VALIDATION_FAILED");
  const event = startLiveEvent(db, { title: "2026 MTV VMAs", keywords: "VMAs, Video Music Awards", hours: 4, actorId: "owner", at: AT });
  assert.equal(event.slug, "2026-mtv-vmas");
  assert.equal(liveEventRunning(db, AT + HOUR), true);
  addLiveNote(db, event.id, { text: "  Sabrina Carpenter wins Video of the Year  ", at: AT + 30 * 60_000 });
  assert.throws(() => addLiveNote(db, event.id, { text: "x".repeat(281), at: AT }), (error) => error.code === "VALIDATION_FAILED");
  assert.throws(() => addLiveNote(db, event.id, { text: "link", url: "http://example.com", at: AT }), (error) => error.code === "VALIDATION_FAILED");

  const [live] = publicLiveCoverage(db, { at: AT + 40 * 60_000 }).events;
  assert.equal(live.live, true);
  assert.deepEqual(live.items.map((item) => [item.kind, item.source, item.title || item.text]), [
    ["note", "Mshpit", "Sabrina Carpenter wins Video of the Year"],
    ["report", "NME", "Watch Sabrina Carpenter Open The Video Music Awards"],
    ["report", "Billboard", "2026 MTV VMAs Winners List (Updating Live)"],
  ], "last year's piece and a lookalike word are left out");
  assert.equal(live.count, 3);

  removeLiveNote(db, live.items[0].id, { at: AT + HOUR });
  assert.equal(publicLiveCoverage(db, { at: AT + HOUR }).events[0].count, 2);
  endLiveEvent(db, event.id, { at: AT + 2 * HOUR });
  assert.equal(liveEventRunning(db, AT + 2 * HOUR), false);
  const recap = publicLiveCoverage(db, { at: AT + 10 * HOUR }).events[0];
  assert.deepEqual({ live: recap.live, endsAt: recap.endsAt }, { live: false, endsAt: AT + 2 * HOUR }, "the recap stays up the morning after");
  assert.throws(() => addLiveNote(db, event.id, { text: "late", at: AT + 3 * HOUR }), (error) => error.code === "CONFLICT");
  assert.equal(publicLiveCoverage(db, { at: AT + 21 * HOUR }).events.length, 0, "and is gone the next evening");
});

test("only a verified admin runs live coverage; everyone can read it", (t) => {
  const db = database(t);
  const routes = newsLiveRoutes({ database: db, ApiError, rateLimit: () => {}, now: () => AT,
    requireAdmin: (ctx) => { if (ctx.user?.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN"); return ctx.user; } });
  const admin = { id: "owner", role: "admin", email_verified_at: 1 };
  assert.throws(() => routes["POST /api/moderation/news-desk/live"]({ user: { id: "fan", role: "fan" }, body: {} }), (error) => error.status === 403);
  assert.throws(() => routes["POST /api/moderation/news-desk/live"]({ user: { ...admin, email_verified_at: 0 }, body: {}, setHeader() {} }), (error) => error.status === 403);
  assert.throws(() => routes["POST /api/moderation/news-desk/live"]({ user: admin, body: { title: "x" }, setHeader() {} }), (error) => error.status === 400);
  const started = routes["POST /api/moderation/news-desk/live"]({ user: admin, body: { title: "2026 MTV VMAs", keywords: ["VMAs"], hours: 4 }, setHeader() {} });
  const id = started.live[0].id;
  routes["POST /api/moderation/news-desk/live/:id/notes"]({ user: admin, params: { id }, body: { text: "Doja Cat wins Best Hip Hop" }, setHeader() {} });
  const headers = {};
  const read = routes["GET /api/news-desk/live"]({ setHeader: (name, value) => { headers[name] = value; } });
  assert.equal(read.events[0].items[0].text, "Doja Cat wins Best Hip Hop");
  assert.equal(headers["Cache-Control"], "public, max-age=30");
  routes["POST /api/moderation/news-desk/live/:id/end"]({ user: admin, params: { id }, setHeader() {} });
  assert.deepEqual(db.prepare("SELECT action FROM moderation_actions ORDER BY created_at,action").all().map((row) => row.action).sort(),
    ["news_live_ended", "news_live_started", "news_live_update"]);
});
