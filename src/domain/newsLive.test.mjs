import assert from "node:assert/strict";
import test from "node:test";
import { anyLive, liveEventsFrom, liveHeaderText, sinceText } from "./newsLive.mjs";

const NOW = Date.parse("2026-09-28T01:00:00Z");

test("live coverage payloads are cleaned before they are shown", () => {
  const events = liveEventsFrom({ events: [
    { id: "e1", title: "2026 MTV VMAs", live: true, updatedAt: NOW - 3 * 60_000, count: 2, items: [
      { id: "n1", kind: "note", at: NOW - 3 * 60_000, text: "Sabrina Carpenter wins Video of the Year", source: "Mshpit", url: null },
      { id: "https://www.nme.com/x", kind: "report", at: NOW - 9 * 60_000, title: "Watch the opening", source: "NME", url: "https://www.nme.com/x" },
      { id: "bad", kind: "report", at: "never", title: "Broken" },
      { id: "js", kind: "report", at: NOW, title: "Script link", url: "javascript:alert(1)" },
    ] },
    { title: "No id" },
  ] });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].items.map((item) => [item.kind, item.text, item.source, item.url]), [
    ["note", "Sabrina Carpenter wins Video of the Year", "Mshpit", null],
    ["report", "Watch the opening", "NME", "https://www.nme.com/x"],
    ["report", "Script link", "Mshpit", null],
  ], "only https links are kept");
  assert.equal(anyLive(events), true);
  assert.deepEqual(liveEventsFrom(null), []);
  assert.deepEqual(liveEventsFrom({ events: "nope" }), []);
});

test("the card says whether it is live and how fresh it is", () => {
  assert.equal(liveHeaderText({ live: true, count: 14, updatedAt: NOW - 3 * 60_000 }, NOW), "Live now · 14 updates · latest 3 min ago");
  assert.equal(liveHeaderText({ live: true, count: 0, updatedAt: 0 }, NOW), "Live now · updates appear here as they land");
  assert.equal(liveHeaderText({ live: false, count: 1 }, NOW), "Ended · 1 update");
  assert.equal(sinceText(NOW - 20_000, NOW), "just now");
  assert.equal(sinceText(NOW - 90 * 60_000, NOW), "2 hours ago");
});
