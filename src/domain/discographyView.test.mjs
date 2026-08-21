import assert from "node:assert/strict";
import test from "node:test";

import { discographyIdentityCopy, discographyPresentation } from "./discographyView.mjs";

test("discography presentation distinguishes loading, failure, and authoritative empty", () => {
  assert.equal(discographyPresentation(null, { status: "loading" }).state, "loading");
  assert.equal(discographyPresentation(null, { status: "error", error: "Offline" }).state, "error");
  const empty = discographyPresentation({ albums: [], status: "not_found", stale: false }, { status: "ready" });
  assert.equal(empty.state, "empty");
  assert.match(empty.message, /No matching releases/);
});

test("stale discography data stays visible but is never described as fresh", () => {
  const cached = { status: "stale", stale: true, albums: [{ id: "a1", title: "SOS" }] };
  const view = discographyPresentation(cached, { status: "ready" });
  assert.equal(view.state, "stale");
  assert.deepEqual(view.albums, cached.albums);
  assert.match(view.message, /cached catalogue/);

  const refreshFailure = discographyPresentation({ albums: cached.albums }, { status: "error", error: "Timeout" });
  assert.equal(refreshFailure.state, "stale");
  assert.match(refreshFailure.message, /last loaded/);
});

test("ready discographies and artist identity are presented from response truth", () => {
  const payload = { status: "fresh", stale: false, artist: { name: "SZA" }, albums: [{ id: "a1" }] };
  const view = discographyPresentation(payload, { status: "ready" });
  assert.equal(view.state, "ready");
  assert.equal(discographyIdentityCopy(payload, "SZA", view), "Matched to SZA");
  assert.equal(discographyIdentityCopy(null, "SZA", { state: "error" }), "SZA's catalogue is unavailable");
});
