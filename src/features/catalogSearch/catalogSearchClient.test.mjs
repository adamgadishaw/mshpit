import assert from "node:assert/strict";
import test from "node:test";
import { mergeCatalogEvents, readCatalogSearchPage, readCatalogSearchPages } from "./catalogSearchClient.mjs";

test("catalog pages carry cancellation, stable IDs and explicit continuation without automatic archive downloads", async () => {
  const controller = new AbortController(), calls = [];
  const api = async (url, options) => { calls.push({ url, options }); return { events: [{ id: "future", date: "2027-08-04" }], nextCursor: "next" }; };
  const page = await readCatalogSearchPages(api, "Bon Jovi", { signal: controller.signal });
  assert.equal(calls.length, 1); assert.equal(calls[0].options.signal, controller.signal);
  assert.match(calls[0].url, /q=Bon\+Jovi/); assert.match(calls[0].url, /limit=24/);
  assert.equal(page.nextCursor, "next"); assert.equal(page.pages, 1);
  assert.deepEqual(mergeCatalogEvents(page.rows, page.rows).map(row => row.id), ["future"]);
});

test("restored depth is bounded, a later page failure preserves earlier results, and a repeated cursor fails", async () => {
  let calls = 0;
  const partial = await readCatalogSearchPages(async () => { if (++calls === 2) throw Error("offline"); return { events: [{ id: "first" }], nextCursor: "second" }; }, "Rogers", { pages: 2 });
  assert.equal(partial.rows[0].id, "first"); assert.equal(partial.nextCursor, "second"); assert.match(partial.error.message, /offline/);
  calls = 0;
  await readCatalogSearchPages(async () => ({ events: [{ id: String(++calls) }], nextCursor: String(calls) }), "query", { pages: 999 });
  assert.equal(calls, 5);
  await assert.rejects(readCatalogSearchPage(async () => ({ events: [], nextCursor: "same" }), "query", { after: "same" }), /invalid page/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readCatalogSearchPages(async () => { throw controller.signal.reason; }, "query", { signal: controller.signal }), /abort/i);
});
