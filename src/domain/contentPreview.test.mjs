import test from "node:test";
import assert from "node:assert/strict";

import { contentPreview, DEFAULT_CONTENT_PREVIEW_LIMIT, POST_CONTENT_PREVIEW_LIMIT } from "./contentPreview.mjs";

test("content preview leaves short content byte-for-byte unchanged", () => {
  const source = "  Short copy with a line break.\n";
  assert.deepEqual(contentPreview(source), {
    text: source,
    truncated: false,
    expandable: false,
  });
  assert.equal(DEFAULT_CONTENT_PREVIEW_LIMIT, 100);
});

test("content preview counts Unicode code points and prefers a nearby word boundary", () => {
  const source = `${"🎵".repeat(94)} finalword and the exact rest`;
  const compact = contentPreview(source, { limit: 100 });

  assert.equal(compact.text, `${"🎵".repeat(94)}…`);
  assert.equal(compact.truncated, true);
  assert.equal(compact.expandable, true);
  assert.ok([...compact.text].length <= 100);
});

test("content preview never exposes a partial mention or URL token", () => {
  const mentionSource = `${"A".repeat(88)} before @concert_friend after the show`;
  const mention = contentPreview(mentionSource, { limit: 100 });
  assert.equal(mention.text.endsWith("before…"), true);
  assert.equal(mention.text.includes("@concert_"), false);

  const url = `https://mshpit.com/${"night/".repeat(20)}`;
  const urlSource = `${url} after`;
  const linked = contentPreview(urlSource, { limit: 30 });
  assert.equal(linked.text, `${url}…`);
});

test("expanding restores the exact original content", () => {
  const source = `  ${"A long concert memory. ".repeat(10)}\nhttps://mshpit.com/show  `;
  const expanded = contentPreview(source, { limit: 100, expanded: true });

  assert.equal(expanded.text, source);
  assert.equal(expanded.truncated, false);
  assert.equal(expanded.expandable, true);
});

test("post previews allow 240 characters without increasing the shorter biography default", () => {
  assert.equal(POST_CONTENT_PREVIEW_LIMIT, 240);
  assert.equal(DEFAULT_CONTENT_PREVIEW_LIMIT, 100);
  for (const count of [101, 180, 239, 240]) {
    const source = "A".repeat(count);
    assert.deepEqual(contentPreview(source, { limit: POST_CONTENT_PREVIEW_LIMIT }), {
      text: source, truncated: false, expandable: false,
    });
  }
  const source = "A".repeat(241);
  assert.deepEqual(contentPreview(source, { limit: POST_CONTENT_PREVIEW_LIMIT }), {
    text: `${"A".repeat(240)}…`, truncated: true, expandable: true,
  });
});

test("longer post previews retain Unicode, whole mention/link tokens and exact expansion", () => {
  const unicode = `${"🎵".repeat(234)} finalword after the concert`;
  assert.equal(contentPreview(unicode, { limit: POST_CONTENT_PREVIEW_LIMIT }).text, `${"🎵".repeat(234)}…`);
  assert.equal(contentPreview("🎵".repeat(240), { limit: POST_CONTENT_PREVIEW_LIMIT }).expandable, false);

  for (const token of ["@concert_friend", "https://mshpit.com/artist/j-cole"]) {
    const source = `${"A".repeat(228)} before ${token} after the show\nExact final line.  `;
    const preview = contentPreview(source, { limit: POST_CONTENT_PREVIEW_LIMIT });
    assert.equal(preview.text, `${"A".repeat(228)} before…`);
    assert.equal(contentPreview(source, { limit: POST_CONTENT_PREVIEW_LIMIT, expanded: true }).text, source);
  }
});
