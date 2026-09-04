import test from "node:test";
import assert from "node:assert/strict";

import { contentPreview, DEFAULT_CONTENT_PREVIEW_LIMIT } from "./contentPreview.mjs";

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
