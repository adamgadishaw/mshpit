import assert from "node:assert/strict";
import test from "node:test";

import { homeShowCountdownPlan, homeShowStatusLabel, humanShowCountdown } from "./homeShowCountdown.mjs";

const now = new Date(2026, 7, 30, 12).getTime();

test("home countdown chooses the nearest Interested or Going night and ignores past attendance", () => {
  const plan = homeShowCountdownPlan({
    now,
    attendance: [
      { showId: "show_past", state: "going", artist: "Past", venue: "Room", date: "2026-08-20" },
      { showId: "show_later", state: "interested", artist: "Later", venue: "Arena", date: "2026-09-10" },
      { showId: "show_next", state: "going", artist: "Next", venue: "Club", date: "2026-09-02" },
      { showId: "show_went", state: "went", artist: "Done", venue: "Hall", date: "2026-09-01" },
    ],
  });
  assert.equal(plan.event.artist, "Next");
  assert.equal(plan.state, "going");
  assert.equal(homeShowStatusLabel("interested"), "Interested");
});

test("canonical Interested wins over a stale legacy Going row and catalogue data enriches it", () => {
  const attendance = [{
    showId: "show_abc", tourDateId: "tm-1", state: "interested",
    artist: "Earl Sweatshirt", venue: "History", date: "2026-09-16",
  }];
  const plan = homeShowCountdownPlan({
    now,
    attendance,
    going: [{ tourDateId: "tm-1", artist: "Earl Sweatshirt", venue: "History", date: "2026-09-16" }],
    upcoming: [{ id: "tm-1", tourDateId: "tm-1", artist: "Earl Sweatshirt", venue: "History", date: "2026-09-16", ticketUrl: "https://tickets.example" }],
  });
  assert.equal(plan.state, "interested");
  assert.equal(plan.event.ticketUrl, "https://tickets.example");
  assert.equal(attendance[0].state, "interested", "planner must not mutate attendance");
});

test("home countdown keeps one featured night, previews two more, and counts the rest", () => {
  const plan = homeShowCountdownPlan({
    now,
    attendance: [
      { showId: "show_first", state: "going", artist: "First", venue: "One", date: "2026-09-01" },
      { showId: "show_second", state: "interested", artist: "Second", venue: "Two", date: "2026-09-02" },
      { showId: "show_third", state: "going", artist: "Third", venue: "Three", date: "2026-09-03" },
      { showId: "show_fourth", state: "interested", artist: "Fourth", venue: "Four", date: "2026-09-04" },
      { showId: "show_fifth", state: "going", artist: "Fifth", venue: "Five", date: "2026-09-05" },
    ],
  });

  assert.equal(plan.event.artist, "First");
  assert.deepEqual(plan.upNext.map((candidate) => candidate.event.artist), ["Second", "Third"]);
  assert.equal(plan.totalPlans, 5);
  assert.equal(plan.remainingCount, 2);
});

test("human countdown uses plain-language buckets without any network clock", () => {
  assert.equal(humanShowCountdown(now + 3 * 24 * 60 * 60 * 1000, now), "In 3 days");
  assert.equal(humanShowCountdown(now + 24 * 60 * 60 * 1000, now), "Tomorrow");
  assert.equal(humanShowCountdown(now + 2 * 60 * 60 * 1000, now), "In 2 hours");
  assert.equal(humanShowCountdown(now + 15 * 60 * 1000, now), "In 15 minutes");
  assert.equal(humanShowCountdown(now + 20 * 1000, now), "Starting soon");
});
