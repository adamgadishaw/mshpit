import test from "node:test";
import assert from "node:assert/strict";
import { addCatalogBatchDraft, catalogDraftFromText, catalogExactSelection, createCatalogEditorApi } from "./catalogEditorApi.mjs";

test("exact catalog selection validates explicit types and keys without guessing or changing provider case", () => {
  assert.deepEqual(catalogExactSelection("venue", " ticketmaster:rZ7HnEZaeot "), { type: "venue", key: "ticketmaster:rZ7HnEZaeot" });
  assert.deepEqual(catalogExactSelection("artist", "ac/dc"), { type: "artist", key: "ac/dc" });
  assert.deepEqual(catalogExactSelection("event", "tm_fixture"), { type: "event", key: "tm_fixture" });
  for (const type of ["venues", "admin", null]) assert.throws(() => catalogExactSelection(type, "key"), /Choose Artists/);
  for (const key of [null, "", " ", "x".repeat(451), "x\ny", "x\u0000y"]) assert.throws(() => catalogExactSelection("artist", key), /1 and 450/);
  for (const key of [".", "..", "https://www.mshpit.com/venue/example", "/venue/example"]) assert.throws(() => catalogExactSelection("venue", key), /not a public page URL/);
  for (const key of ["rZ7HnEZaeot", "ticketmaster:", ":rZ7HnEZaeot", "ticketmaster:bad id"]) assert.throws(() => catalogExactSelection("venue", key), /source and exact provider ID/);
});

test("direct venue read encodes the exact key once and retains cancellation and account binding", async () => {
  const calls = [], controller = new AbortController();
  const service = createCatalogEditorApi({ accountId: "admin-exact", apiCall: async (...args) => { calls.push(args); return {}; } });
  await service.read({ ...catalogExactSelection("venue", "ticketmaster:rZ7HnEZaeot"), signal: controller.signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/api/admin/catalog-editor/venue/ticketmaster%3ArZ7HnEZaeot");
  assert.equal(calls[0][1].expectedAccountId, "admin-exact");
  assert.equal(calls[0][1].signal, controller.signal);
});

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

test("completion and fresh public verification use existing routes, cancellation and account binding", async () => {
  const calls = [], controller = new AbortController(), service = createCatalogEditorApi({ accountId: "reviewer", apiCall: async (...args) => { calls.push(args); return {}; } });
  const options = { type: "venue", key: "ticketmaster:CaseID", signal: controller.signal };
  await service.plan({ ...options, query: "A&B", cursor: "ticketmaster:before" });
  await service.completion(options); await service.publicText(options);
  assert.equal(calls[0][0], "/api/admin/catalog-editor/venue?completion=true&q=A%26B&cursor=ticketmaster%3Abefore");
  assert.equal(calls[1][0], "/api/admin/catalog-editor/venue/ticketmaster%3ACaseID?completion=true");
  assert.equal(calls[2][0], "/api/catalog-text/venue/ticketmaster%3ACaseID");
  assert.ok(calls.every(([, options]) => options.expectedAccountId === "reviewer" && options.signal === controller.signal));
  const value = catalogDraftFromText({ ...options, revision: 0, expectedHash: "current", completion: { hash: "evidence" } }, { summary: "A sentence.", sourceLines: "Source | https://mshpit.com/source", reason: "Fill" });
  assert.equal(value.completionHash, "evidence");
});
