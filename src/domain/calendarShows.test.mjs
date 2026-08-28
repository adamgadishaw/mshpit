import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CALENDAR_SHOW_VIEW,
  calendarShowsByDay,
  calendarShowsForView,
} from "./calendarShows.mjs";

const today = "2026-08-28";
const show = (id, date, extra = {}) => ({ id, artist: `Artist ${id}`, venue: `Venue ${id}`, date, ...extra });

const calendarScreen = fs.readFileSync(
  new URL("../screens/CalendarScreen.jsx", import.meta.url),
  "utf8",
);

test("Calendar exposes an accessible Upcoming and Past Shows period control", () => {
  assert.match(calendarScreen, /accessibilityRole="tablist"/);
  assert.match(calendarScreen, /[CALENDAR_SHOW_VIEW\.UPCOMING, "Upcoming"]/);
  assert.match(calendarScreen, /[CALENDAR_SHOW_VIEW\.PAST, "Past shows"]/);
  assert.match(calendarScreen, /myAttendance/);
  assert.match(calendarScreen, /useProfileHistory/);
  assert.match(calendarScreen, /CALENDAR_HISTORY_PAGE_SIZE/);
  assert.match(calendarScreen, /Load earlier shows/);
  assert.doesNotMatch(calendarScreen, /logsByUser/);
});

test("Calendar history is account-bound and keeps pagination under explicit user control", () => {
  assert.match(calendarScreen, /accountId: session\?\.id/);
  assert.match(calendarScreen, /targetId: session\?\.id/);
  assert.match(calendarScreen, /enabled: !!session\?\.id && view === CALENDAR_SHOW_VIEW\.PAST/);
  assert.match(calendarScreen, /historyWindow\.hasBufferedPage/);
  assert.match(calendarScreen, /historyWindow\.hasServerPage/);
  assert.match(calendarScreen, /history\.loadMore\(\)/);
  assert.doesNotMatch(calendarScreen, /while\s*\([^)]*nextCursor/);
});

test("calendar upcoming keeps today and future shows while moving stale Going rows out", () => {
  const rows = calendarShowsForView({
    today,
    upcoming: [show("past", "2026-08-27"), show("today", today), show("future", "2026-09-01")],
    going: [show("old-plan", "2026-08-20"), show("future", "2026-09-01")],
  });

  assert.deepEqual(rows.map(({ id }) => id), ["today", "future"]);
  assert.equal(rows[1].going, true);
});

test("calendar past shows use real logs and Here/Went history, never Interested or stale Going", () => {
  const rows = calendarShowsForView({
    view: CALENDAR_SHOW_VIEW.PAST,
    today,
    attendance: [
      show("interested", "2026-08-20", { state: "interested" }),
      show("going", "2026-08-21", { state: "going" }),
      show("here", "2026-08-22", { state: "here" }),
      show("went", "2026-08-23", { state: "went" }),
      show("future-went", "2026-09-01", { state: "went" }),
    ],
    logs: [
      show("status", "2026-08-24", { kind: "status" }),
      show("review", "2026-08-25", { kind: "review" }),
      show("legacy-review", "2026 · 08 · 26"),
    ],
  });

  assert.deepEqual(rows.map(({ id }) => id), ["legacy-review", "review", "went", "here"]);
  assert.equal(rows[0].logged, true);
  assert.equal(rows[2].attendanceState, "went");
});

test("calendar past deduplicates a logged night and attendance without mutating inputs", () => {
  const attendance = [{ artist: "Earl Sweatshirt", venue: "History", city: "Toronto", date: "2026-08-20", state: "went" }];
  const logs = [{ artist: "Earl Sweatshirt", venue: "History", city: "Toronto", date: "2026-08-20", review: "A night", kind: "review" }];
  const before = structuredClone({ attendance, logs });

  const grouped = calendarShowsByDay({ view: CALENDAR_SHOW_VIEW.PAST, today, attendance, logs });

  assert.equal(grouped["2026-08-20"].length, 1);
  assert.equal(grouped["2026-08-20"][0].attended, true);
  assert.equal(grouped["2026-08-20"][0].logged, true);
  assert.deepEqual({ attendance, logs }, before);
});

test("calendar ignores malformed and incomplete show identities", () => {
  assert.deepEqual(calendarShowsForView({
    today,
    upcoming: [
      show("bad-date", "2026-02-30"),
      { artist: "No room", date: "2026-09-01" },
      { venue: "No artist", date: "2026-09-01" },
    ],
  }), []);
});
