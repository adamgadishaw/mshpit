import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("Calendar and Profile share the canonical member calendar projection", () => {
  const calendar = source("../screens/CalendarScreen.jsx");
  const profile = source("../screens/ProfileScreen.jsx");

  assert.match(calendar, /memberCalendarModel\(\{/);
  assert.match(calendar, /posts:\s*session \? historyWindow\.posts : \[\]/);
  assert.match(calendar, /enabled:\s*!!session\?\.id/,
    "future authored show posts must hydrate in Upcoming, not only in Past");

  assert.match(profile, /const profileCalendar = memberCalendarModel\(\{/);
  assert.match(profile, /going:\s*isSelf \? goingFor\(user\.id\) : \[\]/);
  assert.match(profile, /attendance:\s*isSelf \? myAttendance : \[\]/);
  assert.match(profile, /posts:\s*logs/);
});

test("successful dated logs navigate to their canonical Calendar date while plain statuses keep Feed", () => {
  const app = source("../../App.js");
  const store = source("../store.js");

  assert.match(app, /calendarFocusForPost\(result\?\.post, new Date\(\)\)/);
  assert.match(app, /commitReplace\(\{\s*calendar:\s*true,\s*calendarDate:\s*calendarFocus\.date,\s*calendarView:\s*calendarFocus\.view,/s);
  assert.match(app, /else \{[\s\S]*commitClear\(\);\s*setTab\("feed"\);/);
  assert.match(app, /<CalendarScreen initialDate=\{nav\.calendarDate\} initialView=\{nav\.calendarView\}/);

  assert.match(store, /upsertProfileHistoryPost\(postingActor\.id, postingActor\.id, safe\)/,
    "the optimistic dated post should be visible without an extra calendar write");
  assert.match(store, /upsertProfileHistoryPost\(postingActor\.id, postingActor\.id, published, \{ previousId: localId \}\)/,
    "the canonical server post must replace the optimistic row");
  assert.match(store, /removeProfileHistoryPost\(postingActor\.id, postingActor\.id, localId\)/,
    "a failed publish must also disappear from the derived calendar");
  assert.match(store, /return \{ ok: true, id: id \|\| localId, post: canonicalPost \}/,
    "navigation must classify the canonical saved post rather than client copies");
});
