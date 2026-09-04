import assert from "node:assert/strict";
import test from "node:test";
import { createApiResponseHeaders, createApiResponseHeaderSetter } from "./responseHeaders.js";

test("API responses are private by default and explicit public policy can override", () => {
  const headers = createApiResponseHeaders();
  assert.deepEqual(headers, { "Cache-Control": "no-store" });

  const setHeader = createApiResponseHeaderSetter(headers);
  assert.equal(setHeader("Cache-Control", "public, max-age=60"), true);
  assert.equal(headers["Cache-Control"], "public, max-age=60");
});

test("API response headers allow only bounded route-owned values", () => {
  const headers = {};
  const setHeader = createApiResponseHeaderSetter(headers);

  assert.equal(setHeader("cache-control", "public, max-age=3600, stale-while-revalidate=86400"), true);
  assert.equal(setHeader("X-Pit-Results-Truncated", "true"), true);
  assert.equal(setHeader("Link", '</api/tourdates?scope=all-upcoming&limit=500&after=cursor>; rel="next"'), true);
  assert.deepEqual(headers, {
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    "X-Pit-Results-Truncated": "true",
    Link: '</api/tourdates?scope=all-upcoming&limit=500&after=cursor>; rel="next"',
  });

  assert.equal(setHeader("Set-Cookie", "session=attacker"), false);
  assert.equal(setHeader("Content-Security-Policy", "default-src *"), false);
  assert.equal(setHeader("X-Pit-Results-Truncated", "maybe"), false);
  assert.equal(setHeader("Link", '<https://attacker.test/>; rel="next"'), false);
  assert.equal(setHeader("Cache-Control", "public\r\nSet-Cookie: bad=1"), false);
  assert.equal(headers["Set-Cookie"], undefined);
});
