import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ApiError } from "../../errors.js";
import { ensureNewsDeskSchema } from "./newsDeskService.js";
import { addLiveNote, ensureNewsLiveSchema, markLiveWinner, setLiveCategories, startLiveEvent } from "./newsLive.js";
import { newsLiveRoutes } from "./newsLiveRoutes.js";

const AT = Date.parse("2026-09-28T00:00:00Z");
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE moderation_actions(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,
      reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);`);
  ensureNewsDeskSchema(db); ensureNewsLiveSchema(db);
  const event = startLiveEvent(db, { title: "Fixture awards", keywords: "awards", hours: 4, at: AT });
  setLiveCategories(db, event.id, "Best Artist: Artist A; Artist B", { at: AT });
  const category = db.prepare("SELECT id FROM news_live_categories").get();
  markLiveWinner(db, event.id, category.id, "Artist A", { at: AT });
  const noteId = addLiveNote(db, event.id, { text: "Fixture update", at: AT });
  const routes = newsLiveRoutes({ database: db, ApiError, now: () => AT + 1,
    rateLimit() {}, requireAdmin: ctx => ctx.user });
  const ctx = (body, params = { id: event.id, categoryId: category.id }) => ({ body, params,
    user: { id: "fixture-admin", email_verified_at: 1 }, requestId: "fixture-request", setHeader() {} });
  const snapshot = () => Object.fromEntries(["news_live_events", "news_live_categories", "news_live_notes", "moderation_actions"]
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  return { db, routes, ctx, snapshot, event, category, noteId };
}

const cases = [
  ["start", "POST /api/moderation/news-desk/live", "news_live_started", f => f.ctx({ title: "Second awards", keywords: "awards", hours: 2 })],
  ["note", "POST /api/moderation/news-desk/live/:id/notes", "news_live_update", f => f.ctx({ text: "Another fixture update" })],
  ["categories", "POST /api/moderation/news-desk/live/:id/categories", "news_live_categories", f => f.ctx({ text: "Best Artist: Artist A; Artist B\nBest Album: Album A; Album B" })],
  ["replace winner", "POST /api/moderation/news-desk/live/:id/categories/:categoryId/winner", "news_live_winner", f => f.ctx({ nominee: "Artist B" })],
  ["clear winner", "POST /api/moderation/news-desk/live/:id/categories/:categoryId/winner", "news_live_winner_cleared", f => f.ctx({ nominee: null })],
  ["end", "POST /api/moderation/news-desk/live/:id/end", "news_live_ended", f => f.ctx({})],
  ["remove note", "POST /api/moderation/news-desk/live/notes/:id/remove", "news_live_update_removed", f => f.ctx({}, { id: f.noteId })],
];
for (const [name, route, action, request] of cases) {
  test(`live ${name}: audit failure rolls back every mutation; retry records once`, t => {
    const f = fixture(t), before = f.snapshot();
    f.db.exec("CREATE TRIGGER refuse_audit BEFORE INSERT ON moderation_actions BEGIN SELECT RAISE(ABORT,'fixture audit unavailable'); END");
    assert.throws(() => f.routes[route](request(f)), /fixture audit unavailable/);
    assert.deepEqual(f.snapshot(), before, "no changed winner, removed note, category or event escapes the failed audit");
    f.db.exec("DROP TRIGGER refuse_audit");
    const result = f.routes[route](request(f));
    assert.ok(Array.isArray(result.live));
    assert.notDeepEqual(f.snapshot(), before);
    assert.deepEqual(f.db.prepare("SELECT actor_id,action,target_type,request_id FROM moderation_actions").all()
      .map(row => ({ ...row })), [{ actor_id: "fixture-admin", action, target_type: "news_live", request_id: "fixture-request" }]);
  });
}

test("live route and nested category/winner savepoints compose without committing an outer transaction", t => {
  const f = fixture(t), before = f.snapshot();
  f.db.exec("BEGIN IMMEDIATE");
  f.routes["POST /api/moderation/news-desk/live/:id/categories"](f.ctx({ text: "Best Artist: Artist A; Artist B" }));
  const category = f.db.prepare("SELECT id FROM news_live_categories").get();
  f.routes["POST /api/moderation/news-desk/live/:id/categories/:categoryId/winner"](f.ctx({ nominee: "Artist B" }, { id: f.event.id, categoryId: category.id }));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 2);
  f.db.exec("ROLLBACK");
  assert.deepEqual(f.snapshot(), before);
});
