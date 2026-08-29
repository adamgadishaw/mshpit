import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accountTargetScope, isCurrentScreenRequest, scopedScreenValue } from "./screenScope.mjs";

test("account-target scopes change across either identity boundary", () => {
  const aliceProfile = accountTargetScope("alice", "profile:alice");
  assert.notEqual(aliceProfile, accountTargetScope("bob", "profile:alice"));
  assert.notEqual(aliceProfile, accountTargetScope(null, "profile:alice"));
  assert.notEqual(aliceProfile, accountTargetScope("alice", "profile:bob"));
  assert.equal(aliceProfile, accountTargetScope(" alice ", "profile:alice"));
});

test("scoped values are hidden synchronously after an account or target change", () => {
  const state = { scope: accountTargetScope("alice", "dm:bob"), value: "private draft" };
  assert.equal(scopedScreenValue(state, accountTargetScope("alice", "dm:bob"), ""), "private draft");
  assert.equal(scopedScreenValue(state, accountTargetScope("charlie", "dm:bob"), ""), "");
  assert.equal(scopedScreenValue(state, accountTargetScope("alice", "dm:charlie"), ""), "");
});

test("personalized discovery is hidden during A to B, guest, and location handoffs", () => {
  const torontoForA = accountTargetScope("account-a", "discovery-sidebar:[\"Toronto\",43.65,-79.38]");
  const state = {
    scope: torontoForA,
    value: { upcomingEvents: [{ id: "private-to-a-scope", city: "Toronto" }] },
  };
  const empty = { upcomingEvents: [] };

  assert.equal(scopedScreenValue(state, torontoForA, empty), state.value);
  assert.equal(
    scopedScreenValue(state, accountTargetScope("account-b", "discovery-sidebar:[\"Toronto\",43.65,-79.38]"), empty),
    empty,
  );
  assert.equal(
    scopedScreenValue(state, accountTargetScope(null, "discovery-sidebar:[\"\",null,null]"), empty),
    empty,
  );
  assert.equal(
    scopedScreenValue(state, accountTargetScope("account-a", "discovery-sidebar:[\"Vancouver\",49.28,-123.12]"), empty),
    empty,
  );
});

test("a deferred A discovery response stays hidden after B or guest becomes active", async () => {
  const accountAScope = accountTargetScope("account-a", "discovery-sidebar:[\"Toronto\",43.65,-79.38]");
  const accountBScope = accountTargetScope("account-b", "discovery-sidebar:[\"Vancouver\",49.28,-123.12]");
  const guestScope = accountTargetScope(null, "discovery-sidebar:[\"\",null,null]");
  const empty = { upcomingEvents: [] };
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const lateState = deferred.then((value) => ({ scope: accountAScope, value }));

  // The active scope changes before A's request settles. Even if the stale
  // callback writes its scoped resource, render-time projection refuses it.
  release({ upcomingEvents: [{ id: "toronto-a", city: "Toronto" }] });
  const settledAState = await lateState;
  assert.equal(scopedScreenValue(settledAState, accountBScope, empty), empty);
  assert.equal(scopedScreenValue(settledAState, guestScope, empty), empty);
});

test("screen requests require the same sequence, account scope, and target", () => {
  const request = { sequence: 4, scope: accountTargetScope("alice", "search"), target: "bjork" };
  assert.equal(isCurrentScreenRequest(request, { ...request }), true);
  assert.equal(isCurrentScreenRequest(request, { ...request, sequence: 5 }), false);
  assert.equal(isCurrentScreenRequest(request, { ...request, scope: accountTargetScope("bob", "search") }), false);
  assert.equal(isCurrentScreenRequest(request, { ...request, target: "beyonce" }), false);
});

test("the Store scopes viewer-derived caches and projects discovery at render time", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");

  assert.match(source, /accountTargetScope\(accountId, `artist-seen:\$\{norm\(name\)\}`\)/);
  assert.match(source, /seenCountCache\.current\.has\(key\)/);
  assert.match(source, /\(sessionRef\.current\?\.id \|\| null\) !== accountId/);
  assert.match(source, /const ratingAggregateKey = \(accountId, kind, artist, title\) => accountTargetScope\(/);
  assert.match(source, /setRatingAgg\(\{\}\);[\s\S]*seenCountCache\.current\.clear\(\);/);
  assert.match(source, /const scopedDiscoverySidebarResource = projectLoadState\([\s\S]*activeDiscoverySidebarScope/);
  assert.match(source, /const discoverySidebar = scopedDiscoverySidebarResource\.data/);
  assert.match(source, /setDiscoverySidebarResource\(\(current\) => beginLoadState\(current, \{/);
  assert.match(source, /setDiscoverySidebarResource\(resolveLoadState\(\{ scope: requestScope, data: next \}\)\)/);
  const feedRefreshStart = source.indexOf("// Keep the public feed fresh");
  const feedRefreshEnd = source.indexOf("// Canonical server snapshot", feedRefreshStart);
  assert.ok(feedRefreshStart >= 0 && feedRefreshEnd > feedRefreshStart);
  const feedRefresh = source.slice(feedRefreshStart, feedRefreshEnd);
  assert.match(feedRefresh, /if \(!authReady\) return undefined;/, "feed startup must wait for the cookie identity handshake");
  assert.match(feedRefresh, /\}, \[authReady, session\?\.id\]\);/, "auth readiness must restart the feed exactly once in its confirmed scope");
  const sidebarStart = source.indexOf("// The server ranks real provider dates");
  const sidebarEnd = source.indexOf("// --- Privacy-safe first-party product analytics", sidebarStart);
  assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart);
  const sidebar = source.slice(sidebarStart, sidebarEnd);
  assert.match(sidebar, /if \(!authReady\) return undefined;/, "personalized discovery must not start under provisional guest identity");
  assert.match(sidebar, /signal: controller\.signal/, "superseded discovery reads must cancel their network work");
  assert.match(sidebar, /\}, \[activeDiscoverySidebarScope, authReady\]\);/);
  assert.doesNotMatch(
    sidebar,
    /setTourDates\(/,
    "account/location-scoped sidebar events must not enter the global tour-date fallback",
  );
});
