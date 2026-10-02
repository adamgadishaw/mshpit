import assert from "node:assert/strict";
import test from "node:test";
import { createPublicReadAdmission, isExpensiveApiRead, PUBLIC_READ_LIMITS } from "./publicReadAdmission.js";

const limited = (fn, retryAfterMs) => assert.throws(fn, error =>
  error.status === 429 && error.code === "RATE_LIMITED" && error.retryAfterMs === retryAfterMs);

test("shared prechecks reserve no capacity when an intervening policy denies work", () => {
  const gate = createPublicReadAdmission({ clock: () => 0, burstMax: 1 });
  for (let i = 0; i < 100; i += 1) gate.precheck();
  gate.admit("user:allowed");
  limited(() => gate.precheck(), 1_000);
});

test("shared burst rejects before identity lookup and recovers independently of the minute allowance", () => {
  let at = 0;
  const gate = createPublicReadAdmission({ clock: () => at, burstMax: 2, processMax: 3 });
  gate.admit("ip:a"); gate.admit("ip:b");
  limited(() => gate.admit(() => assert.fail("identity lookup after shared rejection")), 1_000);
  at = 1_000;
  gate.admit("user:c");
  limited(() => gate.admit("user:d"), 59_000);
  at = 60_000;
  gate.admit("user:d");
});

test("an identity-denied request cannot spend another visitor's shared allowance", () => {
  const gate = createPublicReadAdmission({ clock: () => 0, burstMax: 3, processMax: 3, identityMax: 1 });
  gate.admit("user:a");
  for (let i = 0; i < 20; i += 1) limited(() => gate.admit("user:a"), 60_000);
  gate.admit("user:b"); gate.admit("user:c");
  limited(() => gate.admit("user:d"), 60_000);
});

test("accounts behind a shared address are independent while guest addresses share one identity", () => {
  const gate = createPublicReadAdmission({ clock: () => 0, identityMax: 2 });
  gate.admit("ip:203.0.113.7"); gate.admit("ip:203.0.113.7");
  limited(() => gate.admit("ip:203.0.113.7"), 60_000);
  gate.admit("user:alice"); gate.admit("user:bob");
  gate.admit("ip:203.0.113.8");
  assert.equal(PUBLIC_READ_LIMITS.identityMax, 300);
});

test("identity capacity fails closed without clearing live counters and recovers at expiry", () => {
  let at = 0;
  const gate = createPublicReadAdmission({ clock: () => at, maxIdentities: 2, identityMax: 1 });
  gate.admit("ip:a"); gate.admit("ip:b");
  limited(() => gate.admit("ip:c"), 60_000);
  limited(() => gate.admit("ip:a"), 60_000);
  at = 60_000; gate.admit("ip:c"); gate.admit("ip:a");
});

test("classification protects projection APIs and leaves control-plane and unrelated requests alone", () => {
  for (const path of ["/api/page-head", "/api/resolve", "/api/artists", "/api/artists/a/profile",
    "/api/artists/archive", "/api/discover/chart", "/api/discovery/sidebar", "/api/tourdates",
    "/api/feed", "/api/feed/for-you", "/api/clips", "/api/cities/us/boston",
    "/api/venues/a/reviews", "/api/shows/a", "/api/landing/media", "/api/news",
    "/api/news-desk/stories", "/api/news-desk/live/a", "/api/festivals/a"]) {
    assert.equal(isExpensiveApiRead("GET", path), true, path);
    assert.equal(isExpensiveApiRead("POST", path), false, path);
  }
  for (const path of ["/api/health", "/api/readiness", "/robots.txt", "/sitemap.xml",
    "/sitemaps/artists-1.xml", "/.well-known/security.txt", "/_expo/static/a.js",
    "/api/time", "/api/login", "/api/news-desk/stories/id/image.png"]) {
    assert.equal(isExpensiveApiRead("GET", path), false, path);
  }
});
