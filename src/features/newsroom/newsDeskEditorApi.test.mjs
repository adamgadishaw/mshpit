import assert from "node:assert/strict";
import test from "node:test";
import {
  correctNewsStoryCategory, publishedNewsPostId, readSelfWrittenNewsStory,
  newsCandidateLine, newsCandidateNeed, newsDraftStatus, newsEditorCostLine, parseNewsLinks,
  publishNewsDraft, readNewsEditor, writeNewsDraft,
} from "./newsDeskEditorApi.mjs";

const categoryStory = { postId: "news_category-test", headline: "Synthetic release", origin: "self_written", category: "charts", updatedAt: 1000 };
const correction = { accountId: "editor_1", postId: categoryStory.postId, category: "release", expectedCategory: "charts", expectedUpdatedAt: 1000 };

test("published story lookup accepts only Mshpit post links and reads fresh account-bound metadata", async () => {
  for (const value of [categoryStory.postId, `/post/${categoryStory.postId}`, `https://www.mshpit.com/post/${categoryStory.postId}?share=1`, `https://mshpit.com/post/${categoryStory.postId}/`]) {
    assert.equal(publishedNewsPostId(value), categoryStory.postId);
  }
  for (const value of ["https://elsewhere.test/post/news_category-test", "https://www.mshpit.com@elsewhere.test/post/news_category-test", "//elsewhere.test/post/news_category-test", "http://mshpit.com/post/news_category-test", "https://user@mshpit.com/post/news_category-test", "https://mshpit.com:123/post/news_category-test", "news_../../api/me", "/artist/name", ""]) {
    assert.equal(publishedNewsPostId(value), null);
  }
  let calls = 0;
  const result = await readSelfWrittenNewsStory({ accountId: "editor_1", value: categoryStory.postId }, { apiCall: async (path, options) => {
    calls += 1;
    assert.equal(path, `/api/posts/${categoryStory.postId}`);
    assert.equal(options.cache, "no-store");
    assert.equal(options.expectedAccountId, "editor_1");
    assert.equal(options.body, undefined);
    return { post: { id: categoryStory.postId, news: { ...categoryStory, body: "Never part of a correction", sources: [] } } };
  } });
  assert.deepEqual(result, { postId: categoryStory.postId, headline: categoryStory.headline, category: "charts", updatedAt: 1000 });
  assert.equal(calls, 1);
});

test("lookup refuses generated, missing, mismatched or unversioned stories", async () => {
  for (const patch of [{ origin: "generated" }, { updatedAt: undefined }, { updatedAt: 1.5 }, { updatedAt: 0 }, { category: "other" }, { postId: "news_other" }]) {
    await assert.rejects(readSelfWrittenNewsStory({ accountId: "editor_1", value: categoryStory.postId }, {
      apiCall: async () => ({ post: { id: categoryStory.postId, news: { ...categoryStory, ...patch } } }),
    }), /unavailable/u);
  }
  await assert.rejects(readSelfWrittenNewsStory({ accountId: "editor_1", value: categoryStory.postId }, { apiCall: async () => ({ post: {} }) }), /unavailable/u);
});

test("category correction carries only the narrow CAS fields and accepts a confirmed same-category no-op", async () => {
  const calls = [];
  const apiCall = async (path, options) => {
    calls.push({ path, options });
    return { postId: categoryStory.postId, category: options.body.category, changed: options.body.category !== "charts", updatedAt: options.body.category === "charts" ? 1000 : 1001 };
  };
  await correctNewsStoryCategory({ ...correction, body: "ignored", title: "ignored", sources: ["ignored"], photo: "ignored" }, { apiCall });
  assert.equal(calls[0].path, `/api/moderation/news-desk/editor/stories/${categoryStory.postId}/category`);
  assert.equal(calls[0].options.method, "PATCH");
  assert.equal(calls[0].options.expectedAccountId, "editor_1");
  assert.deepEqual(calls[0].options.body, { category: "release", expectedCategory: "charts", expectedUpdatedAt: 1000 });
  const noop = await correctNewsStoryCategory({ ...correction, category: "charts" }, { apiCall });
  assert.equal(noop.changed, false);
  for (const patch of [{ changed: false }, { updatedAt: 1000 }, { postId: "news_wrong" }, { category: "tour" }]) {
    await assert.rejects(correctNewsStoryCategory(correction, { apiCall: async () => ({ postId: categoryStory.postId, category: "release", changed: true, updatedAt: 1001, ...patch }) }), /not be confirmed/u);
  }
});

test("category requests preserve authorization/conflict failures and never retry or call draft generation", async () => {
  for (const status of [401, 403, 409, 503]) {
    const reason = Object.assign(new Error("Synthetic rejection"), { status });
    let calls = 0;
    await assert.rejects(correctNewsStoryCategory(correction, { apiCall: async (path) => {
      calls += 1; assert.ok(path.endsWith("/category")); throw reason;
    } }), error => error === reason);
    assert.equal(calls, 1);
  }
  const noCall = async () => assert.fail("Invalid input must not invoke transport");
  for (const patch of [{ accountId: "" }, { expectedUpdatedAt: undefined }, { category: "other" }, { postId: "/post/news_category-test" }]) {
    await assert.rejects(correctNewsStoryCategory({ ...correction, ...patch }, { apiCall: noCall }));
  }
});

const overview = { candidates: [], budget: { leftTodayUsd: 0.284, typicalDraftUsd: 0.018 }, drafts: { last24h: 3, limit: 10, recent: [] } };

test("requests go to the moderation editor as the signed-in admin", async () => {
  const calls = [];
  const apiCall = async (path, options) => { calls.push({ path, options }); return path.includes("/drafts") ? { draft: { id: "d1", status: path.endsWith("/publish") ? "published" : "draft" }, postId: "news_1" } : overview; };
  await readNewsEditor({ accountId: "admin_1", query: "  Radiohead tour " }, { apiCall });
  assert.equal(calls[0].path, "/api/moderation/news-desk/editor?q=Radiohead%20tour");
  assert.equal(calls[0].options.expectedAccountId, "admin_1");
  await writeNewsDraft({ accountId: "admin_1", reportUrls: ["https://www.nme.com/a"], links: [] }, { apiCall });
  assert.deepEqual({ method: calls[1].options.method, body: calls[1].options.body }, { method: "POST", body: { reportUrls: ["https://www.nme.com/a"], links: [] } });
  assert.equal((await publishNewsDraft({ accountId: "admin_1", id: "d1", expectedRevision: 0 }, { apiCall })).postId, "news_1");
  assert.equal(calls[2].path, "/api/moderation/news-desk/editor/drafts/d1/publish");
  assert.deepEqual(calls[2].options.body, { expectedRevision: 0 });
  await assert.rejects(readNewsEditor({ accountId: "" }, { apiCall }), /administrator/u);
  await assert.rejects(readNewsEditor({ accountId: "admin_1" }, { apiCall: async () => ({}) }), /invalid response/u);
});

test("publishing requires the exact reviewed revision and preserves conflicts without retrying", async () => {
  let calls = 0;
  for (const expectedRevision of [undefined, null, "0", false, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(publishNewsDraft({ accountId: "editor", id: "draft", expectedRevision }, {
      apiCall: async () => { calls++; },
    }), /current draft/u);
  }
  assert.equal(calls, 0);
  const conflict = Object.assign(new Error("Concurrent draft edit"), { code: "CONFLICT", status: 409 });
  await assert.rejects(publishNewsDraft({ accountId: "editor", id: "draft", expectedRevision: 3 }, {
    apiCall: async (_path, options) => { calls++; assert.deepEqual(options.body, { expectedRevision: 3 }); throw conflict; },
  }), error => error === conflict);
  assert.equal(calls, 1);
});

test("links, candidates, drafts and cost read as plain sentences", () => {
  assert.deepEqual(parseNewsLinks("https://www.nme.com/a\nhttp://x.com/b, https://www.nme.com/a https://pitchfork.com/c https://spinmagazine.com/d https://clashmusic.com/e"),
    ["https://www.nme.com/a", "https://pitchfork.com/c", "https://spinmagazine.com/d"], "https only, no repeats, at most three");
  const candidate = { outlets: [{ name: "NME" }, { name: "Stereogum" }], groups: 2, ageHours: 5, ready: true, needed: 2 };
  assert.equal(newsCandidateLine(candidate), "NME, Stereogum · 2 outlets · 5 hours ago");
  assert.equal(newsCandidateNeed(candidate), "");
  assert.equal(newsCandidateNeed({ groups: 1, needed: 2, ready: false }), "Needs one more outlet: paste a link below.");
  assert.equal(newsCandidateNeed({ groups: 1, needed: 3, ready: false }), "Needs 2 more outlets: paste links below.");
  assert.equal(newsDraftStatus({ status: "draft" }), "Ready to publish");
  assert.equal(newsDraftStatus({ status: "draft", expired: true }), "More than a day old: write a fresh one");
  assert.equal(newsDraftStatus({ status: "declined", reason: "gossip" }), "Claude turned it down: gossip");
  assert.equal(newsEditorCostLine(overview),
    "Finding stories is free. A draft is one Claude call, about 2 cents, from the news budget: $0.28 left today. 3 of 10 drafts used in the last 24 hours.");
});

test("live coverage controls post to the moderation live routes", async () => {
  const { startNewsLive, postNewsLiveUpdate, endNewsLive, removeNewsLiveUpdate, newsLiveStatus } = await import("./newsDeskEditorApi.mjs");
  const calls = [];
  const apiCall = async (path, options) => { calls.push({ path, body: options.body, account: options.expectedAccountId }); return { live: [] }; };
  await startNewsLive({ accountId: "admin_1", title: "2026 MTV VMAs", keywords: "VMAs", hours: "4" }, { apiCall });
  await postNewsLiveUpdate({ accountId: "admin_1", id: "e1", text: "Big win", url: "  " }, { apiCall });
  await endNewsLive({ accountId: "admin_1", id: "e1" }, { apiCall });
  await removeNewsLiveUpdate({ accountId: "admin_1", noteId: "n1" }, { apiCall });
  assert.deepEqual(calls.map((call) => [call.path, call.body]), [
    ["/api/moderation/news-desk/live", { title: "2026 MTV VMAs", keywords: "VMAs", hours: 4 }],
    ["/api/moderation/news-desk/live/e1/notes", { text: "Big win" }],
    ["/api/moderation/news-desk/live/e1/end", {}],
    ["/api/moderation/news-desk/live/notes/n1/remove", {}],
  ]);
  assert.ok(calls.every((call) => call.account === "admin_1"));
  await assert.rejects(endNewsLive({ accountId: "admin_1", id: "e1" }, { apiCall: async () => ({}) }), /could not be confirmed/u);
  const formatTime = () => "11:30 PM";
  assert.equal(newsLiveStatus({ live: true, count: 14, endsAt: 1 }, { formatTime }), "Live until 11:30 PM · 14 updates");
  assert.equal(newsLiveStatus({ live: false, count: 1 }), "Ended · 1 update");
});

test("award categories, winners and scheduled starts go to the live routes", async () => {
  const { setNewsLiveCategories, markNewsLiveWinner, startNewsLive, categoriesText, parseStartTime, livePageUrl } = await import("./newsDeskEditorApi.mjs");
  const calls = [];
  const apiCall = async (path, options) => { calls.push({ path, body: options.body }); return { live: [] }; };
  await setNewsLiveCategories({ accountId: "admin_1", id: "e1", text: "Video of the Year: A; B" }, { apiCall });
  await markNewsLiveWinner({ accountId: "admin_1", id: "e1", categoryId: "c1", nominee: "A" }, { apiCall });
  await markNewsLiveWinner({ accountId: "admin_1", id: "e1", categoryId: "c1", nominee: null }, { apiCall });
  await startNewsLive({ accountId: "admin_1", title: "2027 Grammys", keywords: "Grammys", hours: "5", startsAt: 1_800_000_000_000 }, { apiCall });
  assert.deepEqual(calls.map((call) => [call.path, call.body]), [
    ["/api/moderation/news-desk/live/e1/categories", { text: "Video of the Year: A; B" }],
    ["/api/moderation/news-desk/live/e1/categories/c1/winner", { nominee: "A" }],
    ["/api/moderation/news-desk/live/e1/categories/c1/winner", { nominee: null }],
    ["/api/moderation/news-desk/live", { title: "2027 Grammys", keywords: "Grammys", hours: 5, startsAt: 1_800_000_000_000 }],
  ]);
  assert.equal(categoriesText({ winners: { categories: [{ name: "Best Pop", nominees: ["Lorde", "Addison Rae"] }] } }), "Best Pop: Lorde; Addison Rae");
  assert.equal(parseStartTime(""), null);
  assert.equal(parseStartTime("2027-02-01 20:00"), new Date(2027, 1, 1, 20, 0).getTime());
  assert.ok(Number.isNaN(parseStartTime("next friday")));
  assert.equal(livePageUrl("2026-mtv-vmas"), "https://www.mshpit.com/news/live/2026-mtv-vmas");
});
