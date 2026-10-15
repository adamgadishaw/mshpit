import assert from "node:assert/strict";
import test from "node:test";
import { projectNewsDocument, renderNewsMain } from "./newsDocuments.js";

const story = { id: "one", postId: "news_one", headline: "A band announces a tour", summary: "The dates were reported by independent publishers.",
  category: "tour", publishedAt: Date.UTC(2026,8,27,12), sources: [{ name: "Source", url: "https://example.com/report" }] };
test("server-rendered news hub links to canonical article pages without JavaScript", () => {
  const document = projectNewsDocument({ stories: [story] });
  const html = renderNewsMain(document);
  assert.match(html, /<h2><a href="\/post\/news_one">A band announces a tour<\/a><\/h2>/);
  const item = document.jsonLd[0].mainEntity.itemListElement[0].item;
  assert.equal(item.url, "https://www.mshpit.com/post/news_one");
  assert.equal(item.mainEntityOfPage, item.url);
  assert.match(html, /up to five stories a day when qualifying reports are available/);
});
test("news hub rejects unsafe story identifiers and escapes supplied headlines", () => {
  const document = projectNewsDocument({ stories: [{ ...story, postId: '//evil.example', headline: '<script>bad</script>' }] });
  assert.doesNotMatch(renderNewsMain(document), /href="\/post\/|<script>/);
  assert.equal(document.jsonLd[0].mainEntity.itemListElement[0].item.url, undefined);
});
