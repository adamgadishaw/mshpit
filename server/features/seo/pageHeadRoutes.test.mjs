import assert from "node:assert/strict";
import test from "node:test";
import { pageHeadRoutes } from "./pageHeadRoutes.js";
import { ApiError, errorEnvelope } from "../../errors.js";

test("page head endpoint resolves only the anonymous pathname and never passes viewer state", () => {
  const seen = [], headers = [], limits = [];
  const route = pageHeadRoutes({ ApiError, rateLimit: (...args) => limits.push(args), pageHeadFor: (...args) => {
    seen.push(args);
    return { head: "<title>Public</title>", privateField: "not returned" };
  } })["GET /api/page-head"];
  const result = route({ query: { path: "/event/one" }, user: { id: "admin", role: "owner" }, setHeader: (...args) => headers.push(args) });
  assert.deepEqual(seen, [["/event/one"]]);
  assert.deepEqual(result, { path: "/event/one", head: "<title>Public</title>" });
  assert.deepEqual(headers, [["Cache-Control", "no-store"]]);
  assert.equal(limits[0][1], "public-page-head");
});

test("page head rejects external, parameterized, ambiguous, oversized and malformed targets", () => {
  let reads = 0;
  const route = pageHeadRoutes({ ApiError, rateLimit() {}, pageHeadFor() { reads += 1; } })["GET /api/page-head"];
  for (const path of [undefined, [], "https://evil.example/event/1", "//evil.example", "/event/1?private=1", "/event/1#x", "/event/a\\b", "/event/a\nb", "/event/a b", "/" + "a".repeat(501)]) {
    assert.throws(() => route({ query: { path } }), (error) => error.status === 400);
  }
  assert.equal(reads, 0);
});

test("unavailable or oversized metadata has a stable bounded failure", () => {
  for (const result of [null, {}, { head: "x".repeat(128_001) }]) {
    const route = pageHeadRoutes({ ApiError, rateLimit() {}, pageHeadFor: () => result })["GET /api/page-head"];
    assert.throws(() => route({ query: { path: "/" } }), (error) => {
      assert.deepEqual(errorEnvelope(error, "metadata-request"), {
        error: "Page information is temporarily unavailable.",
        code: "PAGE_HEAD_UNAVAILABLE",
        status: 503,
        requestId: "metadata-request",
        retryable: true,
      });
      return true;
    });
  }
});
