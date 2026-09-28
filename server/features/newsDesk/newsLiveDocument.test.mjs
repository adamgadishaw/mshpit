import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-news-live-page-"));
process.env.PIT_DATA_DIR = directory;
const { db } = await import("../../db.js");
await import("../../api.js");
const { seoHttpPlan, pageHeadFor } = await import("../../seo.js");
const { renderPublicDocumentMain } = await import("../seo/publicDocumentRenderer.js");
const { projectLiveDocument, renderLiveMain } = await import("./newsLiveDocument.js");
const { markLiveWinner, setLiveCategories, startLiveEvent, staffLiveCoverage } = await import("./newsLive.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

const START = Date.parse("2026-09-27T23:30:00Z");
const event = (overrides = {}) => ({
  id: "e1", slug: "2026-mtv-vmas", title: "2026 MTV VMAs", keywords: ["VMAs"], live: true,
  startsAt: START, endsAt: START + 4 * 3_600_000, updatedAt: START + 3_600_000, count: 2,
  items: [
    { kind: "note", id: "n1", at: START + 3_600_000, text: "Sabrina Carpenter wins Video of the Year", source: "Mshpit", url: null },
    { kind: "report", id: "https://www.billboard.com/x", at: START + 1_800_000, title: "2026 VMAs Winners List <Updating>", source: "Billboard", url: "https://www.billboard.com/x" },
  ],
  winners: { total: 2, announced: 1, categories: [
    { id: "c1", name: "Video of the Year", nominees: ["Sabrina Carpenter - Manchild", "Taylor Swift - Fortnight"], winner: "Sabrina Carpenter - Manchild", announcedAt: START + 3_600_000 },
    { id: "c2", name: "Best New Artist", nominees: ["Lola Young", "Alex Warren"], winner: null, announcedAt: null },
  ] },
  ...overrides,
});

test("the page reads like an outlet's winners list, with live-blog structured data", () => {
  const document = projectLiveDocument({ origin: "https://www.mshpit.com", event: event() });
  assert.equal(document.title, "2026 MTV VMAs Winners List (Updating Live) | Mshpit");
  assert.equal(document.canonicalUrl, "https://www.mshpit.com/news/live/2026-mtv-vmas");
  assert.match(document.description, /^Every 2026 MTV VMAs winner\. Video of the Year: Sabrina Carpenter - Manchild\. Updated as each award is announced\.$/u);
  assert.equal(document.indexable, true);
  const [live, breadcrumbs] = document.jsonLd;
  assert.equal(live["@type"], "LiveBlogPosting");
  assert.equal(live.coverageStartTime, "2026-09-27T23:30:00.000Z");
  assert.equal(live.dateModified, "2026-09-28T00:30:00.000Z", "the modified time moves with each update");
  assert.equal(live.liveBlogUpdate.length, 2);
  assert.equal(live.liveBlogUpdate[1].citation, "https://www.billboard.com/x");
  assert.match(live.articleBody, /Video of the Year: Sabrina Carpenter - Manchild \(winner\)\. Nominees: Sabrina Carpenter - Manchild, Taylor Swift - Fortnight\./u);
  assert.equal(breadcrumbs.itemListElement[2].name, "2026 MTV VMAs");

  const ended = projectLiveDocument({ event: event({ live: false }) });
  assert.equal(ended.title, "2026 MTV VMAs Winners: Full List | Mshpit", "after the show it becomes the full list");
  const noCategories = projectLiveDocument({ event: event({ winners: { total: 0, announced: 0, categories: [] }, items: [] }) });
  assert.equal(noCategories.title, "2026 MTV VMAs: Live Updates | Mshpit");
  assert.equal(noCategories.indexable, false, "an empty page stays out of search");
});

test("the winners table is category, winner, nominees, and outlet links stay nofollow", () => {
  const html = renderLiveMain(projectLiveDocument({ event: event() }));
  assert.match(html, /<th scope="col">Category<\/th><th scope="col">Winner<\/th><th scope="col">Nominees<\/th>/u);
  assert.match(html, /<th scope="row">Video of the Year<\/th>\s*<td class="winner">Sabrina Carpenter - Manchild<\/td>/u);
  assert.match(html, /<th scope="row">Best New Artist<\/th>\s*<td class="winner"><span class="pending">To be announced<\/span><\/td>/u);
  assert.match(html, /<li class="won">Sabrina Carpenter - Manchild<\/li>/u);
  assert.match(html, /1 of 2 categories announced/u);
  assert.match(html, /<a href="https:\/\/www\.billboard\.com\/x" rel="nofollow noopener noreferrer">2026 VMAs Winners List &lt;Updating&gt;<\/a>/u, "headlines are escaped");
  assert.ok(html.includes('<time datetime="2026-09-28T00:30:00.000Z">8:30 PM ET</time> · Mshpit'), "times read in Eastern time");
  assert.equal(renderPublicDocumentMain(projectLiveDocument({ event: event() })), html);
});

test("/news/live/<slug> serves the page, redirects case, and 404s unknown events", () => {
  const at = Date.now() - 60_000;
  const created = startLiveEvent(db, { title: "2026 MTV VMAs", keywords: "VMAs", hours: 4, at });
  setLiveCategories(db, created.id, "Video of the Year: Sabrina Carpenter - Manchild; Taylor Swift - Fortnight", { at });
  const [staff] = staffLiveCoverage(db, { at: at + 1000 });
  markLiveWinner(db, created.id, staff.winners.categories[0].id, "Sabrina Carpenter - Manchild", { at: at + 1000 });

  const plan = seoHttpPlan("/news/live/2026-mtv-vmas");
  assert.equal(plan.type, "document");
  assert.equal(plan.indexable, true);
  assert.equal(plan.document.kind, "news-live");
  assert.deepEqual({ ...seoHttpPlan("/news/live/2026-MTV-VMAS") }, { type: "redirect", status: 301, location: "/news/live/2026-mtv-vmas", canonicalPath: "/news/live/2026-mtv-vmas" });
  assert.equal(seoHttpPlan("/news/live/nothing-here").type, "not-found");
  const head = pageHeadFor("/news/live/2026-mtv-vmas");
  assert.match(JSON.stringify(head), /2026 MTV VMAs Winners List \(Updating Live\)/u);
  const news = seoHttpPlan("/news");
  assert.equal(news.document.news.live[0].slug, "2026-mtv-vmas", "the /news hub links to live coverage");
});
