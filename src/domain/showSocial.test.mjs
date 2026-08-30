import assert from "node:assert/strict";
import test from "node:test";

import {
  isCurrentShowSocialRead,
  normalizeLoungeMeta,
  normalizeShowAttendees,
  showSocialIdentity,
  showSocialView,
} from "./showSocial.mjs";

test("show social reads are scoped to both the concert and active account", () => {
  const read = { identity: showSocialIdentity("sza|history|2026-08-20", "fan-a"), status: "ready" };
  assert.equal(isCurrentShowSocialRead(read, "sza|history|2026-08-20", "fan-a"), true);
  assert.equal(isCurrentShowSocialRead(read, "sza|history|2026-08-20", "fan-b"), false);
  assert.equal(isCurrentShowSocialRead(read, "sza|other|2026-08-20", "fan-a"), false);
});

test("authoritative attendees are sanitized, deduplicated, and viewer toggles stay optimistic", () => {
  const key = "turnstile|history|2026-08-20";
  const read = {
    identity: showSocialIdentity(key, "fan-a"),
    status: "ready",
    attendees: normalizeShowAttendees([{ id: "fan-b", name: " B " }, { id: "fan-b", name: "duplicate" }, {}]),
    loungeMeta: { attendeeCount: 7, messageCount: 12 },
  };
  assert.deepEqual(showSocialView({ read, concertKey: key, accountId: "fan-a", viewer: { id: "fan-a", name: "Ada" }, viewerGoing: true }).attendees.map((row) => row.id), ["fan-a", "fan-b"]);
  assert.deepEqual(showSocialView({ read, concertKey: key, accountId: "fan-b", localAttendees: [{ id: "local", name: "Local" }] }).attendees.map((row) => row.id), ["local"], "a stale account read must not render");
});

test("lounge metadata supplies the pre-open message count and degrades to local data", () => {
  const key = "artist|venue|date";
  const read = { identity: showSocialIdentity(key, null), status: "ready", attendees: [], loungeMeta: normalizeLoungeMeta({ attendeeCount: "4", messageCount: "9" }) };
  assert.equal(showSocialView({ read, concertKey: key, accountId: null, localMessageCount: 2 }).messageCount, 9);
  assert.equal(showSocialView({ read: null, concertKey: key, accountId: null, localMessageCount: 2 }).messageCount, 2);
  assert.equal(normalizeLoungeMeta({ attendeeCount: "bad", messageCount: null }), null);
});

test("closed Lounge metadata never falls back to locally cached message counts", () => {
  const key = "artist|venue|date";
  const meta = normalizeLoungeMeta({
    attendeeCount: 4,
    messageCount: 0,
    status: "closed",
    timingKnown: true,
    cutoffAt: 1234,
    cutoffSource: "doors_open",
    fanClubArtist: "Artist",
  });
  const read = { identity: showSocialIdentity(key, "fan"), status: "ready", attendees: [], loungeMeta: meta };
  const view = showSocialView({ read, concertKey: key, accountId: "fan", localMessageCount: 9 });
  assert.equal(view.messageCount, 0);
  assert.equal(view.loungeStatus, "closed");
  assert.equal(view.loungeCutoffAt, 1234);
  assert.equal(view.loungeCutoffSource, "doors_open");
  assert.equal(view.fanClubArtist, "Artist");
});
