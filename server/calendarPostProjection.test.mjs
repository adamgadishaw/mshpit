import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-calendar-post-projection-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});
function addUser(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

test("profile history projects server-owned concert identity needed by the derived calendar", () => {
  const author = addUser("calendarauthor");
  const viewer = addUser("calendarviewer");
  const create = routes["POST /api/posts"];

  const review = create({
    user: author,
    ip: "calendar-review-create",
    body: {
      clientMutationId: "calendar_review_001",
      kind: "review",
      artist: "Earl Sweatshirt",
      venue: "History",
      city: "Toronto",
      date: "2026-09-20",
      tour: "Live Laugh Love Tour",
      overall: 4.5,
      review: "A complete dated concert log",
    },
  });
  const status = create({
    user: author,
    ip: "calendar-status-create",
    body: {
      clientMutationId: "calendar_status_001",
      kind: "status",
      review: "An unrelated update should remain a feed post",
    },
  });

  assert.deepEqual(
    {
      kind: review.post.kind,
      artist: review.post.artist,
      venue: review.post.venue,
      city: review.post.city,
      date: review.post.date,
      tour: review.post.tour,
    },
    {
      kind: "review",
      artist: "Earl Sweatshirt",
      venue: "History",
      city: "Toronto",
      date: "2026-09-20",
      tour: "Live Laugh Love Tour",
    },
  );

  const history = routes["GET /api/users/:id/posts"]({
    user: viewer,
    params: { id: author.id },
    query: { limit: "30" },
  });
  const projectedReview = history.posts.find(({ id }) => id === review.id);
  const projectedStatus = history.posts.find(({ id }) => id === status.id);
  assert.ok(projectedReview);
  assert.equal(projectedReview.date, "2026-09-20");
  assert.equal(projectedReview.artist, "Earl Sweatshirt");
  assert.equal(projectedReview.venue, "History");
  assert.equal(projectedReview.tour, "Live Laugh Love Tour");
  assert.ok(projectedStatus);
  assert.equal(projectedStatus.kind, "status");
  assert.equal(projectedStatus.artist, "");
  assert.equal(projectedStatus.venue, "");
  assert.equal(projectedStatus.date, "");
});
