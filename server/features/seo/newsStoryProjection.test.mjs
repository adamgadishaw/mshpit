import assert from "node:assert/strict";
import test from "node:test";
import { newsStoryPostDocument } from "./publicDocumentProjection.js";
import { renderPublicDocumentMain } from "./publicDocumentRenderer.js";

test("self-written news projection preserves the validated body and attached photo provenance", () => {
  const body = Array.from({ length: 1_701 }, (_, index) => `Reported paragraph word ${index + 1}.`).join(" ");
  const document = newsStoryPostDocument({
    story: {
      id: "story_self_written",
      origin: "self_written",
      headline: "A synthetic self-written music story",
      summary: "A synthetic summary for the projection boundary.",
      body,
      category: "tour",
      artists: [],
      sources: [
        { kind: "article", name: "NME", url: "https://www.nme.com/news/synthetic" },
        { kind: "photo", name: "Synthetic photographer", url: "https://example.com/photo-rights", credit: "CC0" },
      ],
      media: [{ kind: "image", url: "https://media.example.com/news/self-written.jpg", width: 1200, height: 800, mimeType: "image/jpeg", altText: "Synthetic article photo" }],
      publishedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
    card: { comments: 0, modifiedAt: 1_700_000_000_000 },
    comments: [],
    path: "/post/story_self_written",
    origin: "https://www.mshpit.com",
    paths: {},
  });
  assert.equal(document.news.body, body);
  assert.equal(document.image, "https://media.example.com/news/self-written.jpg");
  assert.equal(document.imageProvenance, "self-written-article-photo");
  assert.deepEqual(document.news.sources.map((source) => source.kind), ["article", "photo"]);
  assert.deepEqual(document.jsonLd[0].citation, ["https://www.nme.com/news/synthetic"]);
  const html = renderPublicDocumentMain(document);
  assert.match(html, /class="news-sources"/u);
  assert.match(html, /Read more music news/u);
  assert.match(html, /word 1701/u);
});

test("generated news projection keeps its paragraph sanitizer and card fallback", () => {
  const paragraph = "Generated paragraph ".repeat(200);
  const document = newsStoryPostDocument({
    story: { id: "story_generated", origin: "generated", headline: "Generated story", summary: "Summary", body: paragraph, category: "tour", artists: [], sources: [], publishedAt: 1_700_000_000_000 },
    card: { comments: 0, modifiedAt: 1_700_000_000_000 }, comments: [], path: "/post/story_generated", origin: "https://www.mshpit.com", paths: {},
  });
  assert.ok(document.news.body.length <= 1_200);
  assert.match(document.image, /api\/news-desk\/stories\/story_generated\/image\.png/u);
});
