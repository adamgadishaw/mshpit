import test from "node:test";
import assert from "node:assert/strict";
import { addCatalogBatchDraft, catalogDraftFromText, createCatalogEditorApi } from "./catalogEditorApi.mjs";

test("catalog batch preserves mixed entities and replaces only the matching draft", () => {
  const artist = { type: "artist", key: "a", summary: "first" }, venue = { type: "venue", key: "a" };
  assert.deepEqual(addCatalogBatchDraft([artist, venue], { ...artist, summary: "corrected" }), [venue, { ...artist, summary: "corrected" }]);
  assert.throws(() => addCatalogBatchDraft(Array.from({ length: 10 }, (_, i) => ({ type: "artist", key: String(i) })), artist), /batch/);
});

test("draft preparation retains observed revision and named source URLs", () => {
  const value = catalogDraftFromText({ type: "event", key: "event-1", revision: 7, expectedHash: "hash" },
    { summary: "Context", sourceLines: "Official | https://www.mshpit.com/a\n\nVenue | https://www.mshpit.com/b", reason: "Fill gap" });
  assert.equal(value.expectedRevision, 7); assert.equal(value.expectedHash, "hash");
  assert.equal(value.sources.length, 2); assert.equal(value.sources[1].label, "Venue");
});

test("API requests bind account, preserve retry key and never load unrelated admin data", async () => {
  const calls = [], service = createCatalogEditorApi({ accountId: "admin-a", apiCall: async (...args) => { calls.push(args); return {}; } });
  const draft = { type: "venue", key: "ticketmaster:hall" };
  await service.list({ type: "venue", query: "A&B", missingOnly: true });
  await service.read(draft); await service.prepare([draft]);
  await service.save(draft, "same-operation-key"); await service.save(draft, "same-operation-key");
  assert.ok(calls.every(([path, options]) => path.startsWith("/api/admin/catalog-editor/") && options.expectedAccountId === "admin-a"));
  assert.match(calls[0][0], /q=A%26B/);
  assert.deepEqual(calls[3][1].body, calls[4][1].body);
});
