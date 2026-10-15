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

test("manual source attribution names evidence without claiming independent confirmation", () => {
  const story = { origin: "self_written", sources: [
    { kind: "article", name: "Fixture Artist", url: "https://artist.example.com/news" },
    { kind: "article", name: "Fixture Venue", url: "https://venue.example.com/news" },
    { kind: "photo", name: "Fixture Photographer" },
  ] };
  assert.equal(newsSourceLine(story), "Sources: Fixture Artist and Fixture Venue");
  assert.equal(newsSourceLine({ ...story, sources: story.sources.slice(0, 1) }), "Sources: Fixture Artist");
  assert.equal(newsSourceLine({ ...story, origin: "generated" }), "Confirmed by Fixture Artist and Fixture Venue");
});

test("uploaded article photos lead public cards and photo rights never confirm a story", () => {
  const story = { media: [{ kind: "image", url: "https://media.example.com/verified.jpg" }],
    artists: [{ photo: "https://example.com/artist.jpg" }], sources: [{ kind: "article", name: "NME" }, { kind: "photo", name: "Photographer" }] };
  assert.equal(newsStoryPhoto(story), "https://media.example.com/verified.jpg");
  assert.equal(newsSourceLine(story), "Confirmed by NME");
  assert.equal(newsStoryPhoto({ media: {}, artists: [] }), null);
  assert.equal(newsStoryPhoto({ photo: { url: "https://example.com/unverified.jpg" } }), null);
});
