import assert from "node:assert/strict";
import test from "node:test";

import { newsCategoryLabel, newsSourceLine, newsStoryParagraphs, newsStoryPhoto } from "./newsDesk.mjs";

test("news stories read as labelled, sourced paragraphs", () => {
  assert.equal(newsCategoryLabel("lineup"), "Band news");
  assert.equal(newsCategoryLabel("nonsense"), "Music news");
  assert.equal(newsSourceLine({ sources: [{ name: "NME" }, { name: "Stereogum" }, { name: "NME" }] }), "Confirmed by NME and Stereogum");
  assert.deepEqual(newsStoryParagraphs("First  line.\n\n\nSecond\nline.\n\n"), ["First line.", "Second line."]);
  assert.deepEqual(newsStoryParagraphs(""), []);
  assert.equal(newsStoryPhoto({ artists: [{ name: "A" }, { name: "B", photo: "https://cdn-images.dzcdn.net/x.jpg" }] }), "https://cdn-images.dzcdn.net/x.jpg");
});

test("uploaded article photos lead public cards and photo rights never confirm a story", () => {
  const story = { media: [{ kind: "image", url: "https://media.example.com/verified.jpg" }],
    artists: [{ photo: "https://example.com/artist.jpg" }], sources: [{ kind: "article", name: "NME" }, { kind: "photo", name: "Photographer" }] };
  assert.equal(newsStoryPhoto(story), "https://media.example.com/verified.jpg");
  assert.equal(newsSourceLine(story), "Confirmed by NME");
  assert.equal(newsStoryPhoto({ media: {}, artists: [] }), null);
  assert.equal(newsStoryPhoto({ photo: { url: "https://example.com/unverified.jpg" } }), null);
});
