import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const feedScreen = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const calendarScreen = readFileSync(new URL("../screens/CalendarScreen.jsx", import.meta.url), "utf8");
const rightRail = readFileSync(new URL("../components/Rails.jsx", import.meta.url), "utf8");
const countdown = readFileSync(new URL("../components/HomeShowCountdown.jsx", import.meta.url), "utf8");

test("Feed has a deliberate accessible pull refresh and no recurring head polling", () => {
  assert.match(feedScreen, /VinylRefreshBoundary/);
  assert.doesNotMatch(feedScreen, /\bRefreshControl\b|refreshControl=/);
  assert.match(feedScreen, /refreshing=\{refreshing\}/);
  assert.match(feedScreen, /onRefresh=\{refresh\}/);
  assert.match(feedScreen, /accessibilityLiveRegion/);
  assert.match(store, /const refreshFeed = async/);

  const effectStart = store.indexOf("// Load once for the confirmed account scope.");
  const effectEnd = store.indexOf("// Canonical server snapshot.", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  const initialFeedEffect = store.slice(effectStart, effectEnd);
  assert.match(initialFeedEffect, /hydrateFeed\(\{ resetPagination: true/);
  assert.doesNotMatch(initialFeedEffect, /setInterval|setTimeout|visibility|AppState|\.wake/);
  assert.doesNotMatch(store, /FEED_REFRESH_MS|FEED_REFRESH_MAX_BACKOFF_MS/);
});

test("foreground session work keeps safety reconciliation but cannot reload the feed head", () => {
  const start = store.indexOf("// Cold boot blocks on the HttpOnly-cookie handshake.");
  const end = store.indexOf("// Server-first auth", start);
  const lifecycle = store.slice(start, end);
  assert.match(lifecycle, /coordinator\.resume\(\)/);
  assert.match(lifecycle, /void revalidateCachedFeed\(\)/);
  assert.doesNotMatch(lifecycle, /hydrateFeed\(/);
  assert.doesNotMatch(lifecycle, /feedRefreshRef\.current\.wake/);
});

test("Calendar refresh is explicit and reports its state accessibly", () => {
  assert.match(calendarScreen, /VinylRefreshBoundary/);
  assert.doesNotMatch(calendarScreen, /\bRefreshControl\b|refreshControl=/);
  assert.match(calendarScreen, /onRefresh=\{refreshCalendar\}/);
  assert.match(calendarScreen, /refreshMyAttendance/);
  assert.match(calendarScreen, /refreshTourDates/);
  assert.match(calendarScreen, /Refreshing your calendar/);
  assert.match(calendarScreen, /accessibilityLiveRegion/);
});

test("home countdown ticks locally and moves between responsive top and empty-bottom placements", () => {
  assert.match(countdown, /setInterval/);
  assert.doesNotMatch(countdown, /\bapi\s*\(|\bfetch\s*\(/);
  assert.match(countdown, /Array\.isArray\(plan\?\.upNext\) \? plan\.upNext\.slice\(0, 2\)/);
  assert.match(countdown, /humanShowCountdown\(candidate\.targetMs, now\)/);
  assert.match(countdown, /\+\{remainingCount\} more/);
  assert.match(countdown, />View all in Calendar</);
  assert.match(feedScreen, /showHomeCountdown && countdownPlan/);
  assert.match(feedScreen, /showHomeCountdown && !countdownPlan/);
  assert.match(feedScreen, /onViewAll=\{onViewAllCountdown\}/);
  assert.equal((app.match(/onViewAllCountdown=\{\(\) => go\(\{ calendar: true \}\)\}/g) || []).length, 2);

  const railStart = rightRail.indexOf("export function RightRail");
  const railSource = rightRail.slice(railStart);
  const active = railSource.indexOf("accountId && countdownPlan");
  const artists = railSource.indexOf("{/* Artists");
  const upcoming = railSource.indexOf("{/* Upcoming events */}");
  const empty = railSource.lastIndexOf("accountId && !countdownPlan");
  assert.ok(active >= 0 && active < artists, "active countdown must lead the sidebar");
  assert.ok(empty > upcoming, "empty countdown guidance must trail sidebar discovery");
  assert.match(railSource, /onViewAll=\{onViewAllCountdown\}/);
});
