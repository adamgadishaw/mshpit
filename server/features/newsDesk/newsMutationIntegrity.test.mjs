import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createNewsDeskEditor } from "./newsDeskEditor.js";
import { createNewsDesk } from "./newsDeskService.js";
import { ensureNewsLiveSchema, startLiveEvent, setLiveCategories, markLiveWinner } from "./newsLive.js";
import { runNewsDeskPass, startNewsDeskTimers } from "./newsDeskJob.js";
import { createBackgroundJobCoordinator } from "../../backgroundJobCoordinator.js";

const AT = Date.parse("2026-10-10T12:00:00Z");
const ENV = { NEWS_DESK_ACCOUNT_ID: "fixture-news" };
const summary = reports => ({ publish: true, headline: "Fixture band announces a world tour",
  summary: "Independent outlets report the tour.", body: "A fixture write-up.", category: "tour", artists: [],
  supporting: reports, costUsd: 0.01 });
function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE users(id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER);"
    + "INSERT INTO users(id) VALUES ('fixture-news'); CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,popularity REAL,data TEXT);"
    + "CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,artist TEXT,artist_key TEXT,venue TEXT,city TEXT,date TEXT,overall REAL,review TEXT,kind TEXT,created_at INTEGER);");
  const editor = createNewsDeskEditor({ database, env: ENV, now: () => AT, summarize: async reports => summary(reports),
    fetchArticle: async () => "<title>Fixture band announces world tour</title><p>Independent reporting.</p>" });
  const urls = ["https://www.nme.com/news/fixture-tour", "https://pitchfork.com/news/fixture-tour", "https://www.stereogum.com/fixture-tour"];
  const sources = ["nme", "pitchfork", "stereogum"];
  const put = database.prepare("INSERT INTO news_reports(url,source_id,title,category,published_at,fetched_at) VALUES (?,?,?,'tour',?,?)");
  urls.forEach((url, i) => put.run(url, sources[i], "Fixture Band Announce World Tour Dates", AT - 3_600_000, AT));
  return { database, editor, urls };
}

test("rejected or failed winner changes preserve the existing announcement and winner", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); ensureNewsLiveSchema(db);
  const event = startLiveEvent(db, { title: "Fixture awards", keywords: ["awards"], hours: 3, at: AT });
  setLiveCategories(db, event.id, "Best Artist: Artist A; Artist B", { at: AT });
  const category = db.prepare("SELECT id FROM news_live_categories").get();
  markLiveWinner(db, event.id, category.id, "Artist A", { at: AT });
  const before = db.prepare("SELECT * FROM news_live_categories").get();
  assert.throws(() => markLiveWinner(db, event.id, category.id, "Not a nominee", { at: AT + 1 }), error => error.code === "VALIDATION_FAILED");
  assert.equal(db.prepare("SELECT removed_at FROM news_live_notes").get().removed_at, null);
  db.exec("CREATE TRIGGER refuse_winner BEFORE UPDATE ON news_live_categories BEGIN SELECT RAISE(ABORT,'fixture save failure'); END");
  assert.throws(() => markLiveWinner(db, event.id, category.id, "Artist B", { at: AT + 2 }), /fixture save failure/);
  assert.throws(() => markLiveWinner(db, event.id, category.id, null, { at: AT + 3 }), /fixture save failure/);
  assert.deepEqual(db.prepare("SELECT * FROM news_live_categories").get(), before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM news_live_notes WHERE removed_at IS NULL").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM news_live_notes").get().n, 1);
});

test("draft completion and publication roll back together and retry publishes exactly once", async t => {
  const { database, editor, urls } = fixture(t);
  const draft = await editor.draft({ reportUrls: urls });
  database.exec("CREATE TRIGGER refuse_draft BEFORE UPDATE ON news_drafts WHEN NEW.status='published' BEGIN SELECT RAISE(ABORT,'fixture draft failure'); END");
  assert.throws(() => editor.publish(draft.id), /fixture draft failure/);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM posts").get().n, 0);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_stories").get().n, 0);
  assert.equal(database.prepare("SELECT status FROM news_drafts").get().status, "draft");
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_reports WHERE story_id IS NOT NULL").get().n, 0);
  assert.equal(database.prepare("SELECT status FROM news_desk_receipts").get().status, "settled", "paid work is not erased by publication rollback");
  database.exec("DROP TRIGGER refuse_draft");
  assert.ok(editor.publish(draft.id).postId);
  assert.throws(() => editor.publish(draft.id), error => error.code === "CONFLICT");
  assert.equal(database.prepare("SELECT COUNT(*) n FROM posts").get().n, 1);
});

test("two saved drafts cannot publish or steal the same reports; both charges remain", async t => {
  const { database, editor, urls } = fixture(t);
  const first = await editor.draft({ reportUrls: urls });
  const second = await editor.draft({ reportUrls: urls });
  const published = editor.publish(first.id);
  const winner = database.prepare("SELECT id FROM news_stories WHERE post_id=?").get(published.postId).id;
  assert.throws(() => editor.publish(second.id), error => error.code === "CONFLICT");
  assert.equal(database.prepare("SELECT COUNT(*) n FROM posts").get().n, 1);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_reports WHERE story_id=?").get(winner).n, 3);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_desk_receipts WHERE status='settled'").get().n, 2);
});

test("pasted-only reports acquire durable publication ownership too", async t => {
  const { database, editor } = fixture(t);
  const links = ["https://www.nme.com/news/pasted-tour", "https://pitchfork.com/news/pasted-tour"];
  const first = await editor.draft({ links }), second = await editor.draft({ links });
  editor.publish(first.id);
  assert.throws(() => editor.publish(second.id), error => error.code === "CONFLICT");
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_reports WHERE url IN (?,?) AND story_id IS NOT NULL").get(...links).n, 2);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM posts").get().n, 1);
});

test("late automatic results cannot duplicate publication or replace the winner's reports", async t => {
  for (const latePublish of [true, false]) {
    const { database } = fixture(t);
    const pending = [];
    const options = { database, env: ENV, now: () => AT, fetchText: async () => "", fetchArticle: null,
      summarize: reports => new Promise(resolve => pending.push({ reports, resolve })) };
    const one = createNewsDesk(options).publishPass(), two = createNewsDesk(options).publishPass();
    await new Promise(setImmediate);
    assert.equal(pending.length, 2);
    pending[0].resolve(summary(pending[0].reports)); const winner = await one;
    pending[1].resolve({ ...summary(pending[1].reports), publish: latePublish, reason: "fixture decline" }); const late = await two;
    assert.equal(winner.published, 1);
    assert.equal(late.published, 0); assert.equal(late.declined, 0); assert.equal(late.waiting, 1);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM posts").get().n, 1);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM news_stories").get().n, 1);
    const id = database.prepare("SELECT id FROM news_stories").get().id;
    assert.equal(database.prepare("SELECT COUNT(*) n FROM news_reports WHERE story_id=?").get(id).n, 3);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM news_desk_receipts WHERE status='settled'").get().n, 2);
  }
});

test("cancelled article lookup never reserves a paid draft request", async t => {
  const { database, urls } = fixture(t);
  const controller = new AbortController(); let calls = 0;
  const editor = createNewsDeskEditor({ database, env: ENV, now: () => AT,
    summarize: async reports => { calls++; return summary(reports); },
    fetchArticle: async () => { controller.abort(); throw new DOMException("Stopped", "AbortError"); } });
  await assert.rejects(editor.draft({ reportUrls: urls, signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(calls, 0);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM news_desk_receipts").get().n, 0);
});

test("both periodic timers are stopped and drained, including a live ingest", async t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close()); ensureNewsLiveSchema(db);
  startLiveEvent(db, { title: "Fixture awards", keywords: ["awards"], hours: 3, at: AT });
  const jobs = []; const stopped = [];
  let release, finished = false, signalSeen;
  const desk = { budgetLeft: () => 0, ingest: ({ signal }) => {
    signalSeen = signal;
    return new Promise(resolve => { release = () => { finished = true; resolve(0); }; });
  }};
  const scheduler = startNewsDeskTimers({ database: db, desk, now: () => AT, coordinate: job => job(), memoryReady: () => true,
    startJob(options) {
      const controller = new AbortController(); let active;
      const job = { trigger: () => active ||= options.run({ signal: controller.signal }),
        stop: ({ abortActive } = {}) => { stopped.push(options.intervalMs); if (abortActive) controller.abort(); return active || Promise.resolve(); } };
      jobs.push(job); return job;
    } });
  const running = jobs[0].trigger();
  const stopping = scheduler.stop({ abortActive: true });
  assert.equal(signalSeen.aborted, true);
  assert.deepEqual(stopped.sort((a,b) => a-b), [300_000, 1_200_000]);
  assert.equal(finished, false);
  release(); await Promise.all([running, stopping]); assert.equal(finished, true);
});

test("live-only ingest keeps the shared deadline and never calls the paid publisher", async () => {
  let publishes = 0;
  const keepAlive = setInterval(() => {}, 2000);
  try {
    assert.equal(await runNewsDeskPass({ publish: false, budgetMs: 1000, coordinate: job => job(), memoryReady: () => true, desk: {
      ingest: ({ signal }) => new Promise(resolve => signal.addEventListener("abort", () => resolve(0), { once: true })),
      publishPass: async () => { publishes++; return {}; },
    } }), false);
    assert.equal(publishes, 0);
  } finally { clearInterval(keepAlive); }
});

test("a live refresh queued during shutdown does no feed work after the queue advances", async () => {
  let release, ingests = 0;
  const coordinate = createBackgroundJobCoordinator({ acquireMemoryLease: () => ({ release() {} }) });
  const prior = coordinate(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const controller = new AbortController();
  const live = runNewsDeskPass({ publish: false, coordinate, signal: controller.signal, memoryReady: () => true,
    desk: { ingest: async () => { ingests++; return 0; } } });
  controller.abort(); release(); await prior;
  assert.equal(await live, false); assert.equal(ingests, 0);
});
