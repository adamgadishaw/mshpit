import assert from "node:assert/strict";
import test from "node:test";
import {
  newsCandidateLine, newsCandidateNeed, newsDraftStatus, newsEditorCostLine, parseNewsLinks,
  publishNewsDraft, readNewsEditor, writeNewsDraft,
} from "./newsDeskEditorApi.mjs";

const overview = { candidates: [], budget: { leftTodayUsd: 0.284, typicalDraftUsd: 0.018 }, drafts: { last24h: 3, limit: 10, recent: [] } };

test("requests go to the moderation editor as the signed-in admin", async () => {
  const calls = [];
  const apiCall = async (path, options) => { calls.push({ path, options }); return path.includes("/drafts") ? { draft: { id: "d1", status: path.endsWith("/publish") ? "published" : "draft" }, postId: "news_1" } : overview; };
  await readNewsEditor({ accountId: "admin_1", query: "  Radiohead tour " }, { apiCall });
  assert.equal(calls[0].path, "/api/moderation/news-desk/editor?q=Radiohead%20tour");
  assert.equal(calls[0].options.expectedAccountId, "admin_1");
  await writeNewsDraft({ accountId: "admin_1", reportUrls: ["https://www.nme.com/a"], links: [] }, { apiCall });
  assert.deepEqual({ method: calls[1].options.method, body: calls[1].options.body }, { method: "POST", body: { reportUrls: ["https://www.nme.com/a"], links: [] } });
  assert.equal((await publishNewsDraft({ accountId: "admin_1", id: "d1" }, { apiCall })).postId, "news_1");
  assert.equal(calls[2].path, "/api/moderation/news-desk/editor/drafts/d1/publish");
  await assert.rejects(readNewsEditor({ accountId: "" }, { apiCall }), /administrator/u);
  await assert.rejects(readNewsEditor({ accountId: "admin_1" }, { apiCall: async () => ({}) }), /invalid response/u);
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
