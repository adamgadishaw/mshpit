import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replaceVenueReviewSnapshot } from "./accountMediaCache.mjs";
import { isLoadCancellation } from "./loadState.mjs";

// Exercise the existing Store read function with synthetic transport/state.
// This is not a network-schema validator or a live account request.
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const start = store.indexOf("  const loadVenueReviews =");
const end = store.indexOf("  const addVenueReview =", start);
assert.ok(start >= 0 && end > start);
function fixture() {
  const calls = [], sessionRef = { current: { id: "A" } };
  const venuePhotoCacheRef = { current: { privacy: { revision: 1 } } };
  let cache = { hall: [{ id: "saved", userId: "visible" }] };
  const bindings = { norm: name => name.trim().toLowerCase(), sessionRef, venuePhotoCacheRef,
    blockedIdsRef: { current: ["blocked"] }, ago: () => "now", replaceVenueReviewSnapshot, isLoadCancellation,
    setVenueReviews: update => { cache = update(cache); },
    api: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
  };
  const load = new Function(...Object.keys(bindings), `${store.slice(start, end)}; return loadVenueReviews;`)(...Object.values(bindings));
  return { load, calls, sessionRef, venuePhotoCacheRef, cache: () => cache };
}
test("existing Store reviews read preserves cache on failure and confirms authoritative empty success", async () => {
  const f = fixture(), signal = new AbortController().signal;
  const failed = f.load(" Hall ", { signal });
  assert.equal(f.calls[0].path, "/api/venues/hall/reviews");
  assert.equal(f.calls[0].options.silent, true);
  assert.equal(f.calls[0].options.expectedAccountId, "A");
  assert.equal(f.calls[0].options.signal, signal);
  f.calls[0].reject(new Error("synthetic offline")); assert.equal((await failed).ok, false);
  assert.equal(f.cache().hall[0].id, "saved");
  const stats = { average: null, ratings: 0 };
  const empty = f.load("Hall"); f.calls[1].resolve({ reviews: [], stats });
  assert.deepEqual(await empty, { ok: true, reviews: [], stats }); assert.deepEqual(f.cache().hall, []);
});
test("existing Store result exposes filtered snapshot and rejects ambiguous/account/privacy changes", async () => {
  const f = fixture(); const read = f.load("Hall");
  f.calls[0].resolve({ reviews: [{ id: "blocked", userId: "blocked" }, { id: "fresh", userId: "visible" }] });
  const result = await read; assert.equal(result.ok, true); assert.deepEqual(result.reviews.map(r => r.id), ["fresh"]);
  const malformed = f.load("Hall"); f.calls[1].resolve({}); assert.deepEqual(await malformed, { ok: false, stale: true });
  const account = f.load("Hall"); f.sessionRef.current = { id: "B" }; f.calls[2].resolve({ reviews: [] });
  assert.deepEqual(await account, { ok: false, stale: true });
  const privacy = f.load("Hall"); f.venuePhotoCacheRef.current.privacy.revision++;
  f.calls[3].resolve({ reviews: [] }); assert.deepEqual(await privacy, { ok: false, stale: true });
  assert.equal(f.cache().hall[0].id, "fresh");
});
test("existing Store cancelled transport returns aborted without replacing cached notes", async () => {
  const f = fixture(), controller = new AbortController(); const read = f.load("Hall", { signal: controller.signal });
  controller.abort(); f.calls[0].reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.deepEqual(await read, { ok: false, aborted: true }); assert.equal(f.cache().hall[0].id, "saved");
});
