import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CALENDAR_SHOW_VIEW,
  calendarFocusForPost,
  calendarShowFromPost,
  calendarShowsByDay,
  calendarShowsForView,
  memberCalendarModel,
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
  assert.match(calendarScreen, /enabled: !!session\?\.id/);
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

test("dated concert posts land in the correct period while unrelated statuses stay out", () => {
  const model = memberCalendarModel({
    today,
    posts: [
      show("past-review", "2026-08-20", { kind: "review" }),
      show("future-review", "2026-09-20", { kind: "review" }),
      show("future-context-post", "2026-10-20", { kind: "status" }),
      { id: "plain", kind: "status", review: "No show context here" },
    ],
  });

  assert.deepEqual(model.past.map(({ postId }) => postId), ["past-review"]);
  assert.deepEqual(model.upcoming.map(({ postId }) => postId), ["future-review", "future-context-post"]);
  assert.equal(model.past[0].logged, true);
  assert.equal(model.upcoming[1].posted, true);
  assert.equal(calendarShowFromPost({ id: "plain", kind: "status", review: "hello" }), null);
  assert.equal(calendarFocusForPost({ id: "plain", kind: "status", review: "hello" }, today), null);
});

test("online concert reviews never become attended calendar shows", () => {
  assert.equal(calendarShowFromPost(show("online", "2026-08-25", {
    kind: "review",
    experienceType: "online",
    venue: "YouTube",
  })), null);
  assert.equal(calendarShowFromPost(show("legacy-online", "2026-08-25", {
    kind: "review",
    experience_type: "online",
  })), null);
});

test("a server-owned Going post merges with its catalogue and private Going row once", () => {
  const ticketPost = {
    id: "post-ticket",
    kind: "status",
    attendanceTicket: {
      state: "going",
      tourDateId: "tm-123",
      artist: "Earl Sweatshirt",
      venue: "History",
      city: "Toronto",
      date: "2026-10-03",
      tourName: "Live Laugh Love Tour",
    },
  };
  const model = memberCalendarModel({
    today,
    posts: [ticketPost],
    upcoming: [{ id: "tm-123", artist: "Earl Sweatshirt", venue: "History", city: "Toronto", date: "2026-10-03", ticketUrl: "https://tickets.example/event" }],
    going: [{ key: "earl sweatshirt|history|2026-10-03", artist: "Earl Sweatshirt", venue: "History", city: "Toronto", date: "2026-10-03" }],
  });

  assert.equal(model.upcoming.length, 1);
  assert.equal(model.upcoming[0].id, "tm-123", "catalogue event identity wins over the post id");
  assert.equal(model.upcoming[0].postId, "post-ticket");
  assert.equal(model.upcoming[0].posted, true);
  assert.equal(model.upcoming[0].going, true);
  assert.equal(model.upcoming[0].performanceEvent, true);
  assert.equal(model.upcoming[0].ticketUrl, "https://tickets.example/event");
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
      { id: "status", kind: "status", review: "No attached show", date: "2026-08-24" },
      show("review", "2026-08-25", { kind: "review" }),
      show("legacy-review", "2026 · 08 · 26"),
    ],
  });

  assert.deepEqual(rows.map(({ id }) => id), ["legacy-review", "review", "went", "here"]);
  assert.equal(rows[0].logged, true);
  assert.equal(rows[2].attendanceState, "went");
});

test("calendar upcoming includes canonical Interested and Going without promoting them to past attendance", () => {
  const rows = calendarShowsForView({
    today,
    attendance: [
      show("interested", "2026-09-02", { state: "interested" }),
      show("going", "2026-09-03", { state: "going" }),
      show("past-interested", "2026-08-20", { state: "interested" }),
      show("future-went", "2026-09-04", { state: "went" }),
    ],
  });

  assert.deepEqual(rows.map(({ id }) => id), ["interested", "going"]);
  assert.equal(rows[0].interested, true);
  assert.equal(rows[0].going, false);
  assert.equal(rows[1].going, true);
  assert.equal(rows[1].attendanceState, "going");
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

test("calendar focus classifies canonical show dates without treating plain posts as calendar items", () => {
  assert.deepEqual(calendarFocusForPost(show("past", "2026-08-20", { kind: "review" }), today), {
    date: "2026-08-20",
    view: CALENDAR_SHOW_VIEW.PAST,
  });
  assert.deepEqual(calendarFocusForPost(show("future", "2026-09-20", { kind: "review" }), today), {
    date: "2026-09-20",
    view: CALENDAR_SHOW_VIEW.UPCOMING,
  });
  assert.deepEqual(calendarFocusForPost(
    show("future-date-object", "2026-09-20", { kind: "review" }),
    new Date(2026, 7, 28, 12),
  ), {
    date: "2026-09-20",
    view: CALENDAR_SHOW_VIEW.UPCOMING,
  }, "runtime Date objects must be converted at the local-calendar boundary");
  assert.equal(memberCalendarModel({
    today: new Date(2026, 7, 28, 12),
    posts: [show("date-object-model", "2026-08-20", { kind: "review" })],
  }).past.length, 1);
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
