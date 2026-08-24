import assert from "node:assert/strict";
import test from "node:test";
import { selectConcertReviews, selectProfileTimeline } from "./profileTimeline.mjs";

test("profile timeline orders concert reviews by normalized show-held date", () => {
  const rows = [
    { id: "logged-last", kind: "review", date: "2024-01-05", createdAt: 500 },
    { id: "logged-first", date: "2026 · 08 · 20", createdAt: 100 },
    { id: "middle", kind: "review", date: "2025/03/14", createdAt: 300 },
  ];

  assert.deepEqual(
    selectProfileTimeline(rows).map((row) => row.id),
    ["logged-first", "middle", "logged-last"],
  );
});

test("status posts use publication day and remain sensible in the mixed profile timeline", () => {
  const rows = [
    { id: "concert-newer", kind: "review", date: "2026-08-20", createdAt: 10 },
    { id: "status-newest", kind: "status", date: "1999-01-01", createdAt: Date.UTC(2026, 7, 21, 18) },
    { id: "concert-older", kind: "review", date: "2026-08-18", createdAt: 30 },
    { id: "status-middle", kind: "status", createdAt: Date.UTC(2026, 7, 19, 12) },
  ];

  assert.deepEqual(
    selectProfileTimeline(rows).map((row) => row.id),
    ["status-newest", "concert-newer", "status-middle", "concert-older"],
  );
});

test("late-night statuses share the local day used by concert reviews", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Toronto";
  try {
    const rows = [
      { id: "next-night", kind: "review", date: "2026-08-24", createdAt: 1 },
      { id: "late-status", kind: "status", createdAt: Date.parse("2026-08-24T03:30:00Z") },
      { id: "same-night", kind: "review", date: "2026-08-23", createdAt: 1 },
    ];

    assert.deepEqual(
      selectProfileTimeline(rows).map((row) => row.id),
      ["next-night", "late-status", "same-night"],
    );
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("undated reviews fall back to publication time and ties are deterministic without mutation", () => {
  const rows = [
    { id: "z", kind: "review", date: "not-a-date", createdAt: Date.UTC(2026, 6, 1, 12) },
    { id: "b", kind: "review", date: "", createdAt: Date.UTC(2026, 6, 1, 12) },
    { id: "a", kind: "review", date: "", createdAt: Date.UTC(2026, 6, 1, 12) },
    { id: "known-night", kind: "review", date: "2026-06-30", createdAt: Date.UTC(2026, 7, 1, 12) },
  ];
  const original = [...rows];

  assert.deepEqual(
    selectProfileTimeline(rows).map((row) => row.id),
    ["a", "b", "z", "known-night"],
  );
  assert.deepEqual(rows, original);
  assert.deepEqual(selectProfileTimeline(null), []);
});

test("concert review counts exclude statuses but retain legacy review rows", () => {
  const legacyReview = { id: "legacy" };
  const explicitReview = { id: "review", kind: "review" };
  assert.deepEqual(
    selectConcertReviews([
      legacyReview,
      { id: "status", kind: "status" },
      { id: "future-kind", kind: "repost" },
      explicitReview,
    ]),
    [legacyReview, explicitReview],
  );
  assert.deepEqual(selectConcertReviews(null), []);
});
