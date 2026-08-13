import assert from "node:assert/strict";
import test from "node:test";
import { createApiResponseHeaderSetter } from "./responseHeaders.js";

test("API response headers allow only a safe bounded Cache-Control value", () => {
  const headers = {};
  const setHeader = createApiResponseHeaderSetter(headers);

  assert.equal(setHeader("cache-control", "public, max-age=3600, stale-while-revalidate=86400"), true);
  assert.deepEqual(headers, { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" });

  assert.equal(setHeader("Set-Cookie", "session=attacker"), false);
  assert.equal(setHeader("Content-Security-Policy", "default-src *"), false);
  assert.equal(setHeader("Cache-Control", "public\r\nSet-Cookie: bad=1"), false);
  assert.equal(headers["Set-Cookie"], undefined);
});
