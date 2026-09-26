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
