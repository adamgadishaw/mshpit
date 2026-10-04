import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-news-editor-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("../../db.js");
const { ApiError } = await import("../../errors.js");
const { createNewsDeskEditor, articleTitle } = await import("./newsDeskEditor.js");
const { newsDeskEditorRoutes } = await import("./newsDeskEditorRoutes.js");
const { ensureNewsDeskSchema, normalizeSelfWrittenStory } = await import("./newsDeskService.js");
ensureNewsDeskSchema(db);
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

// 03:00 in Toronto: no publishing slot is open.
const NOW = Date.parse("2026-10-10T07:00:00Z");
const HOUR = 3_600_000;
const ENV = { NEWS_DESK_ACCOUNT_ID: "news_editor_account" };

q.insertUser.run("news_editor_account", "news-editor@example.test", "Mshpit News", "news_editor", "x", "fan", "Toronto", 43.65, -79.38, "MN", "#123456", NOW);
const report = db.prepare(`INSERT INTO news_reports (url,source_id,title,description,category,artist_keys,published_at,fetched_at) VALUES (?,?,?,?,?,?,?,?)`);
const add = (url, sourceId, title, hoursAgo, category = "tour") => report.run(url, sourceId, title, "", category, "[]", NOW - hoursAgo * HOUR, NOW);
add("https://www.nme.com/news/tour-1", "nme", "Radiohead Announce 2027 World Tour Dates", 5);
add("https://www.stereogum.com/tour-2", "stereogum", "Radiohead Announce 2027 World Tour", 4);
add("https://pitchfork.com/news/tour-3", "pitchfork", "Radiohead Reveal 2027 World Tour Dates", 3);
add("https://www.clashmusic.com/news/album", "clash", "Wet Leg Reveal Second Album Moisturizer Deluxe Edition", 2, "release");
add("https://www.jambase.com/old", "jambase", "Phish Announce Winter Run At Madison Square Garden", 100);

const summaryFor = (reports) => ({ publish: true, reason: "", headline: `Draft: ${reports[0].title}`.slice(0, 90), summary: "Several outlets report it.",
  body: "First paragraph.\n\nSecond paragraph.", category: reports[0].category === "release" ? "release" : "tour", artists: [],
  supporting: reports, costUsd: 0.015 });

function editor({ summarize = async (reports) => summaryFor(reports), env = ENV, draftsPerDay = 10, fetchArticle } = {}) {
  const calls = [];
  const instance = createNewsDeskEditor({ database: db, env, now: () => NOW, draftsPerDay,
    summarize: async (reports, options) => { calls.push({ reports, options }); return summarize(reports, options); },
    fetchArticle: fetchArticle || (async (url) => `<html><head><meta property="og:title" content="Wet Leg Reveal Second Album Moisturizer Deluxe"></head><body><p>${url}</p></body></html>`) });
  return { instance, calls };
}
const codeOf = (code) => (error) => error?.code === code;

test("stories ready to publish come first, and searching is free", async () => {
  const { instance, calls } = editor();
  const overview = await instance.overview();
  assert.equal(overview.configured, true);
  assert.equal(overview.publisherReady, true);
  assert.equal(overview.candidates[0].groups, 3);
  assert.equal(overview.candidates[0].ready, true);
  assert.deepEqual(overview.candidates[0].outlets.map((item) => item.name).sort(), ["NME", "Pitchfork", "Stereogum"]);
  const single = overview.candidates.find((item) => /Wet Leg/u.test(item.headline));
  assert.deepEqual({ ready: single.ready, groups: single.groups, needed: single.needed }, { ready: false, groups: 1, needed: 2 });
  assert.equal(overview.candidates.some((item) => /Phish/u.test(item.headline)), false, "only the last two days are candidates");

  const found = await instance.search("phish madison square garden");
  assert.equal(found.length, 1, "search reaches back a week");
  assert.deepEqual(await instance.search("x"), []);
  assert.equal(calls.length, 0, "listing and searching never call Claude");
});

test("a draft needs two independent outlets from the desk's list before Claude is called", async () => {
  const { instance, calls } = editor();
  await assert.rejects(instance.draft({ reportUrls: ["https://www.clashmusic.com/news/album"] }), codeOf("ACTION_REQUIRED"));
  await assert.rejects(instance.draft({ reportUrls: ["https://www.clashmusic.com/news/album"], links: ["https://example.com/story"] }),
    (error) => error.code === "ACTION_REQUIRED" && /outlets the desk reads/u.test(error.message));
  await assert.rejects(instance.draft({}), codeOf("VALIDATION_FAILED"));
  await assert.rejects(instance.draft({ reportUrls: ["https://www.nme.com/not-on-file"] }), codeOf("CONFLICT"));
  assert.equal(calls.length, 0);

  const draft = await instance.draft({ reportUrls: ["https://www.clashmusic.com/news/album"], links: ["https://www.nme.com/news/wet-leg-deluxe"], actorId: "owner" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.minIndependentPublishers, 2);
  assert.equal(draft.status, "draft");
  assert.deepEqual(draft.sources.map((source) => [source.name, source.used]), [["Clash", true], ["NME", true]]);
  assert.equal(draft.costUsd, 0.015);
  const receipt = db.prepare("SELECT status,charged_usd FROM news_desk_receipts ORDER BY created_at DESC LIMIT 1").get();
  assert.deepEqual({ ...receipt }, { status: "settled", charged_usd: 0.015 }, "the draft is paid from the news budget");

  const published = instance.publish(draft.id);
  assert.match(published.postId, /^news_/u);
  const post = db.prepare("SELECT user_id,kind FROM posts WHERE id=?").get(published.postId);
  assert.deepEqual({ ...post }, { user_id: "news_editor_account", kind: "status" }, "published at 3am: the owner skips the slots");
  assert.equal(published.draft.status, "published");
  assert.throws(() => instance.publish(draft.id), codeOf("CONFLICT"), "a draft publishes once");
  assert.throws(() => instance.discard(draft.id), codeOf("CONFLICT"));
});

test("Claude can still turn a pick down, and declined drafts cannot be published", async () => {
  const { instance } = editor({ summarize: async () => ({ publish: false, reason: "gossip, not music news", category: "not_music_news", costUsd: 0.004, supporting: [] }) });
  const draft = await instance.draft({ reportUrls: ["https://www.nme.com/news/tour-1", "https://www.stereogum.com/tour-2", "https://pitchfork.com/news/tour-3"] });
  assert.deepEqual({ status: draft.status, reason: draft.reason }, { status: "declined", reason: "gossip, not music news" });
  assert.throws(() => instance.publish(draft.id), codeOf("CONFLICT"));
  assert.equal(instance.discard(draft.id).status, "discarded");
});

test("drafts stop at the daily allowance and at the news budget", async () => {
  const limited = editor({ draftsPerDay: 0 });
  await assert.rejects(limited.instance.draft({ reportUrls: ["https://www.nme.com/news/tour-1", "https://www.stereogum.com/tour-2"] }), codeOf("RATE_LIMITED"));
  const broke = editor({ env: { ...ENV, NEWS_DESK_DAILY_USD: "0.001" } });
  await assert.rejects(broke.instance.draft({ reportUrls: ["https://www.nme.com/news/tour-1", "https://www.stereogum.com/tour-2"] }),
    (error) => error.code === "RATE_LIMITED" && /news budget/u.test(error.message));
  assert.equal(broke.calls.length + limited.calls.length, 0, "no Claude call when it cannot be paid for");
  const noKey = createNewsDeskEditor({ database: db, env: ENV, now: () => NOW, summarize: null });
  assert.equal((await noKey.overview()).configured, false);
  await assert.rejects(noKey.draft({ reportUrls: ["https://www.nme.com/news/tour-1"] }), codeOf("ACTION_REQUIRED"));
});

test("only a verified admin writes, publishes or discards, and each action is audited", async () => {
  const { instance } = editor();
  const users = { admin: { id: "news_editor_account", role: "admin", email_verified_at: 1 }, unverified: { id: "u2", role: "admin", email_verified_at: 0 } };
  const routes = newsDeskEditorRoutes({ editor: instance, database: db, ApiError, rateLimit: () => {}, now: () => NOW,
    requireAdmin: (ctx) => { if (ctx.user?.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN"); return ctx.user; } });
  await assert.rejects(routes["GET /api/moderation/news-desk/editor"]({ user: { id: "fan", role: "fan" }, query: {} }), (error) => error.status === 403);
  const overview = await routes["GET /api/moderation/news-desk/editor"]({ user: users.admin, query: { q: "radiohead tour" }, setHeader() {} });
  assert.ok(overview.matches.length >= 1);
  const drafts = routes["POST /api/moderation/news-desk/editor/drafts"];
  await assert.rejects(drafts({ user: users.unverified, body: { reportUrls: ["https://www.nme.com/news/tour-1"] }, setHeader() {} }), (error) => error.status === 403);
  await assert.rejects(drafts({ user: users.admin, body: { reportUrls: ["https://www.nme.com/news/tour-1"], extra: 1 }, setHeader() {} }), (error) => error.status === 400);
  await assert.rejects(drafts({ user: users.admin, body: { reportUrls: ["https://www.jambase.com/old"] }, setHeader() {} }),
    (error) => error.status === 422 && /two independent outlets/u.test(error.message), "the owner sees the reason");
  const { draft } = await drafts({ user: users.admin, body: { reportUrls: ["https://www.nme.com/news/tour-1", "https://www.stereogum.com/tour-2"] }, setHeader() {} });
  const discarded = await routes["POST /api/moderation/news-desk/editor/drafts/:id/discard"]({ user: users.admin, params: { id: draft.id }, setHeader() {} });
  assert.equal(discarded.draft.status, "discarded");
  const actions = db.prepare("SELECT action FROM moderation_actions WHERE target_id=? ORDER BY created_at,action").all(draft.id).map((row) => row.action);
  assert.deepEqual(actions.sort(), ["news_draft_discarded", "news_draft_written"]);
});

test("a pasted page's headline comes from its og:title or title", () => {
  assert.equal(articleTitle(`<meta property="og:title" content="Big &amp; Loud News">`), "Big & Loud News");
  assert.equal(articleTitle("<title>\n  Tour Announced | NME\n</title>"), "Tour Announced | NME");
  assert.equal(articleTitle("<p>no title</p>"), "");
});

test("self-written drafts persist delegated actor provenance and publish with revision CAS", () => {
  const { instance } = editor();
  const longBody = Array.from({ length: 180 }, (_, index) => `Radiohead tour update paragraph ${index + 1} confirms the announced dates and release plans.`).join(" ");
  const draft = instance.writeSelfWritten({
    headline: "Radiohead announce 2027 world tour dates",
    summary: "Radiohead have announced a new world tour with dates that will bring the band back to major venues.",
    body: longBody,
    sources: [
      { kind: "article", name: "NME", url: "https://www.nme.com/news/tour-1" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/tour-2" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/tour-3" },
    ],
    photo: { assetId: "ma_editor_test_photo", source: { name: "Synthetic photographer", url: "https://example.com/editor-photo" } },
    actorId: "news_editor_account",
    actorType: "assistant",
    actorLabel: "Jeeves",
    grantId: "mag_editor_test_grant",
  });
  assert.equal(draft.revision, 0);
  assert.deepEqual(draft.writer, { actorType: "assistant", actorLabel: "Jeeves", grantId: "mag_editor_test_grant" });
  const stored = db.prepare("SELECT created_by,created_actor_type,created_actor_label,created_grant_id,revision FROM news_drafts WHERE id=?").get(draft.id);
  assert.deepEqual({ ...stored }, { created_by: "news_editor_account", created_actor_type: "assistant", created_actor_label: "Jeeves", created_grant_id: "mag_editor_test_grant", revision: 0 });
  assert.throws(() => instance.publish(draft.id, { expectedRevision: 999999 }), codeOf("CONFLICT"));
  assert.equal(db.prepare("SELECT status,revision FROM news_drafts WHERE id=?").get(draft.id).status, "draft");
});

test("self-written save keys replay one draft and reject a different payload", () => {
  const { instance } = editor();
  const body = Array.from({ length: 180 }, (_, index) => `Idempotent tour report paragraph ${index + 1} confirms the announced dates and music release plans.`).join(" ");
  const input = {
    headline: "A stable self-written news draft",
    summary: "This synthetic article proves a lost response can be retried without creating a second draft.",
    body,
    category: "tour",
    sources: [
      { kind: "article", name: "NME", url: "https://www.nme.com/news/tour-1" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/tour-2" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/tour-3" },
    ],
    photo: { assetId: "ma_idempotent_photo", source: { name: "Synthetic photographer", url: "https://example.com/idempotent-photo" } },
    actorId: "news_editor_account",
    idempotencyKey: "manual-save-retry-0001",
  };
  const first = instance.writeSelfWritten(input);
  const replay = instance.writeSelfWritten(input);
  assert.equal(replay.id, first.id);
  const receipt = db.prepare("SELECT draft_id FROM news_editor_save_receipts WHERE actor_id=? AND idempotency_key=?").get("news_editor_account", input.idempotencyKey);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news_drafts WHERE id=?").get(receipt.draft_id).n, 1);
  assert.throws(() => instance.writeSelfWritten({ ...input, summary: "A different article under the same stable key." }), codeOf("CONFLICT"));
});


test("self-written stories require a body without a word minimum and retain source and photo guards", () => {
  const value = { headline: "Synthetic band announces a new studio album",
    summary: "Independent music reports confirm the new album and its release plans.",
    sources: [{ kind: "article", name: "NME", url: "https://www.nme.com/news/minimum-fixture" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/minimum-fixture" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/minimum-fixture" }],
    photo: { assetId: "ma_minimum_fixture", name: "Synthetic photographer", url: "https://example.test/photo-rights" } };
  const withWords = count => ({ ...value, body: Array.from({ length: count }, (_, index) => `album${index + 1}`).join(" ") });
  const { instance, calls } = editor();
  for (const body of [undefined, null, "", " \t\r\n\u00a0\u2003 "]) {
    assert.throws(() => normalizeSelfWrittenStory({ ...value, body }), /article body/u);
    assert.throws(() => instance.writeSelfWritten({ ...value, body, actorId: "news_editor_account" }), /article body/u);
  }
  for (const count of [1, 74, 199, 499, 500, 750, 1001]) {
    assert.equal(normalizeSelfWrittenStory(withWords(count)).wordCount, count);
    assert.equal(instance.writeSelfWritten({ ...withWords(count), actorId: "news_editor_account" }).wordCount, count);
  }
  assert.equal(normalizeSelfWrittenStory({ ...value, body: "x" }).body, "x", "no replacement character quota");
  assert.equal(normalizeSelfWrittenStory({ ...value, body: "album report ".repeat(5_001) }).body.length, 60_000, "existing body size bound remains");
  assert.equal(normalizeSelfWrittenStory({ ...withWords(1), sources: value.sources.slice(0, 1) }).sources.filter(source => source.kind === "article").length, 1);
  assert.throws(() => normalizeSelfWrittenStory({ ...withWords(1), sources: [] }), /named article sources/u);
  assert.throws(() => normalizeSelfWrittenStory({ ...withWords(1), sources: Array.from({ length: 11 }, (_, index) => ({ ...value.sources[index % 3], url: value.sources[index % 3].url + index })) }), /article sources/u);
  assert.throws(() => normalizeSelfWrittenStory({ ...withWords(1), sources: value.sources.map(source => ({ ...source, url: "https://unrelated.example.com/report" })) }), /publisher name must match/u);
  assert.throws(() => normalizeSelfWrittenStory({ ...withWords(1), photo: null }), /verified photo/u);
  assert.throws(() => normalizeSelfWrittenStory({ ...withWords(1), photo: { assetId: value.photo.assetId } }), /photo source/u);
  const invalidDraft = instance.writeSelfWritten({ ...withWords(1), actorId: "news_editor_account" });
  db.prepare("UPDATE news_drafts SET result=json_set(result,'$.body',?) WHERE id=?").run(" \t\n ", invalidDraft.id);
  assert.throws(() => instance.publish(invalidDraft.id), /article body/u, "publication rechecks the stored body");
  assert.equal(db.prepare("SELECT status FROM news_drafts WHERE id=?").get(invalidDraft.id).status, "draft");
  assert.equal(calls.length, 0, "manual articles do not invoke generation");
});
