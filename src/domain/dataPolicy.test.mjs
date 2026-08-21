import test from "node:test";
import assert from "node:assert/strict";

import { demoDataEnabled, remoteIdentityValidationEnabled } from "../config/runtime.mjs";
import {
  calendarDateKey,
  isUpcomingEventDate,
  PERSISTED_FEED_LIMIT,
  publicProfileCacheEntry,
  sanitizePersistedStoreValue,
  sanitizeTourDates,
} from "./dataPolicy.mjs";

test("demo data needs both development mode and the explicit public flag", () => {
  assert.equal(demoDataEnabled(true, "true"), true);
  assert.equal(demoDataEnabled(true, "false"), false);
  assert.equal(demoDataEnabled(false, "true"), false);
  assert.equal(remoteIdentityValidationEnabled(true), false);
  assert.equal(remoteIdentityValidationEnabled(false), true);
});

test("production removes only known generated tour date IDs", () => {
  const real = { id: "tm_event_123", date: "2026-08-14" };
  const rows = [
    real,
    { id: "g_t_1" },
    { id: "ca_t_22" },
    { id: "ct8" },
    { id: "t4" },
  ];

  assert.deepEqual(sanitizeTourDates(rows, false), [real]);
  assert.deepEqual(sanitizeTourDates(rows, true), rows);
});

test("persisted demo cleanup keeps server-created records", () => {
  const serverPost = { id: "p_server", userId: "u_real" };
  assert.deepEqual(
    sanitizePersistedStoreValue("pit.feed", [{ id: "log_1" }, serverPost]),
    [serverPost],
  );

  assert.deepEqual(
    sanitizePersistedStoreValue("pit.dms", {
      demo: [{ id: "dm1" }, { id: "msg_server", text: "keep" }],
      real: [{ id: "msg_real", text: "keep too" }],
    }),
    {
      demo: [{ id: "msg_server", text: "keep" }],
      real: [{ id: "msg_real", text: "keep too" }],
    },
  );
});

test("persisted public users use an exact privacy allowlist", () => {
  const [user] = sanitizePersistedStoreValue("pit.users", [{
    id: "u_real",
    name: "Real Member",
    role: "fan",
    verified: true,
    emailVerified: true,
    isBanned: true,
    suspendedUntil: 123,
    createdAt: 100,
    email: "private@example.com",
    genres: ["Indie", "Jazz"],
    favoriteArtists: ["Turnstile", "Beyoncé"],
    analyticsConsentAt: 99,
    termsAcceptedAt: 88,
    treble: { title: "Private taste" },
    playlists: [{ id: "private" }],
    home: { city: "Toronto", lat: 43.6, lng: -79.3 },
  }]);
  assert.deepEqual(user, {
    id: "u_real",
    name: "Real Member",
    role: "fan",
    verified: true,
    genres: ["Indie", "Jazz"],
    favoriteArtists: ["Turnstile", "Beyoncé"],
    home: { city: "Toronto" },
  });
  assert.deepEqual(publicProfileCacheEntry({ id: "u_x", name: "X", email: "secret", home: { city: "Ottawa", lat: 1 } }), {
    id: "u_x", name: "X", home: { city: "Ottawa" },
  });
  const bounded = publicProfileCacheEntry({
    id: "u_many",
    genres: Array.from({ length: 14 }, (_, index) => `Genre ${index}`),
    favoriteArtists: Array.from({ length: 52 }, (_, index) => `Artist ${index}`),
  });
  assert.equal(bounded.genres.length, 12);
  assert.equal(bounded.favoriteArtists.length, 50);
  assert.deepEqual(bounded.genres.slice(0, 2), ["Genre 0", "Genre 1"]);
  assert.deepEqual(bounded.favoriteArtists.slice(0, 2), ["Artist 0", "Artist 1"]);
});

test("persisted feed cache stays bounded for phone startup and localStorage writes", () => {
  const rows = Array.from({ length: PERSISTED_FEED_LIMIT + 25 }, (_, index) => ({ id: `p_${index}` }));
  const saved = sanitizePersistedStoreValue("pit.feed", rows);
  assert.equal(saved.length, PERSISTED_FEED_LIMIT);
  assert.equal(saved[0].id, "p_0");
});

test("calendar filtering includes today and excludes past or invalid dates", () => {
  const localNoon = new Date(2026, 6, 12, 12).getTime();
  assert.equal(calendarDateKey("2026 · 07 · 12"), 20260712);
  assert.equal(calendarDateKey("2026-02-30"), null);
  assert.equal(isUpcomingEventDate({ date: "2026 · 07 · 11" }, localNoon), false);
  assert.equal(isUpcomingEventDate({ date: "2026-07-12T01:00:00Z" }, localNoon), true);
  assert.equal(isUpcomingEventDate({ date: "2026 · 07 · 13" }, localNoon), true);
  assert.equal(isUpcomingEventDate({ date: "TBA" }, localNoon), false);
});
