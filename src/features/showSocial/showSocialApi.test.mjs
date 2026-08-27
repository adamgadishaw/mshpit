import assert from "node:assert/strict";
import test from "node:test";

import {
  readShowCrowdAttendance, readShowDocument, readShowLoungeMeta, writeShowAttendance,
} from "./showSocialApi.mjs";

test("Show document transport is abortable, account-bound, and normalized", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const show = await readShowDocument({
    concertKey: "provider:event/7",
    accountId: "fan-a",
    signal,
  }, {
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return { show: {
        id: `show_${"a".repeat(64)}`,
        canonicalKey: "provider:event-7",
        lifecycle: "happening",
        startsAt: 1234,
        provider: { name: "ticketmaster", eventId: "event-7", backed: true },
      } };
    },
  });
  assert.equal(calls[0].path, "/api/shows/provider%3Aevent%2F7");
  assert.equal(calls[0].options.expectedAccountId, "fan-a");
  assert.equal(calls[0].options.signal, signal);
  assert.equal(show.lifecycle, "happening");
  assert.equal(show.startsAt, 1234);
});

test("Crowd transport encodes show identity and binds the response to the active account", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const attendance = await readShowCrowdAttendance({
    concertKey: "artist|venue/room?night=1",
    scope: "Following",
    accountId: "fan-a",
    signal,
  }, {
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return {
        scope: "following",
        total: 1,
        attendees: [{ id: "fan-b", state: "went", verifiedAttendance: true }],
        viewerGoing: false,
      };
    },
  });

  assert.equal(calls[0].path, "/api/going/artist%7Cvenue%2Froom%3Fnight%3D1/attendees?scope=following");
  assert.equal(calls[0].options.expectedAccountId, "fan-a");
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.silent, true);
  assert.equal(attendance.scope, "following");
  assert.equal(attendance.attendees[0].verifiedAttendance, true);
});

test("lounge metadata uses the same identity guard and normalizes its public counts", async () => {
  const calls = [];
  const lounge = await readShowLoungeMeta({ concertKey: "artist|venue|date", accountId: null }, {
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return { attendeeCount: "8", messageCount: "13" };
    },
  });

  assert.equal(calls[0].path, "/api/lounges/artist%7Cvenue%7Cdate/meta");
  assert.equal(calls[0].options.expectedAccountId, null);
  assert.deepEqual(lounge, { attendeeCount: 8, messageCount: 13 });
});

test("invalid Crowd requests fail before transport", async () => {
  let calls = 0;
  const services = { apiCall: async () => { calls += 1; } };
  await assert.rejects(
    () => readShowCrowdAttendance({ concertKey: "show", scope: "private" }, services),
    /scope is invalid/u,
  );
  await assert.rejects(
    () => readShowLoungeMeta({ concertKey: "" }, services),
    /concert identity/u,
  );
  assert.equal(calls, 0);
});

test("typed attendance writes use only a stable Show ID and preserve Here's server privacy default", async () => {
  const calls = [];
  const showId = `show_${"d".repeat(64)}`;
  const attendance = await writeShowAttendance({
    showId,
    state: "here",
    accountId: "fan-a",
    show: {
      artist: "The Artist",
      venue: "The Room",
      city: "Toronto",
      localDate: "2026-08-27",
    },
  }, {
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return {
        showId,
        attendance: { showId, state: "here", visibility: "private", verified: false, checkedInAt: 123 },
      };
    },
  });

  assert.equal(calls[0].path, "/api/going");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.expectedAccountId, "fan-a");
  assert.deepEqual(calls[0].options.body, {
    key: showId,
    state: "here",
    artist: "The Artist",
    artistKey: undefined,
    venue: "The Room",
    venueKey: undefined,
    city: "Toronto",
    date: "2026-08-27",
    tour: undefined,
  });
  assert.equal(Object.hasOwn(calls[0].options.body, "visibility"), false,
    "fresh Here lets the server choose Private instead of exposing live attendance");
  assert.equal(Object.hasOwn(calls[0].options.body, "verified"), false);
  assert.equal(Object.hasOwn(calls[0].options.body, "location"), false);
  assert.deepEqual(attendance.attendance, {
    showId, state: "here", visibility: "private", verified: false, checkedInAt: 123,
  });
});

test("typed attendance rejects ambiguous identities and mismatched responses before UI adoption", async () => {
  let calls = 0;
  await assert.rejects(
    () => writeShowAttendance({ showId: "artist|room|date", state: "going", accountId: "fan-a" }, {
      apiCall: async () => { calls += 1; },
    }),
    /stable Show identity/u,
  );
  assert.equal(calls, 0, "an unnamespaced legacy value never enters the typed mutation path");

  const expectedId = `show_${"e".repeat(64)}`;
  const wrongId = `show_${"f".repeat(64)}`;
  await assert.rejects(
    () => writeShowAttendance({ showId: expectedId, state: "went", accountId: "fan-a" }, {
      apiCall: async () => ({ showId: wrongId, attendance: { showId: wrongId, state: "went" } }),
    }),
    /response was invalid/u,
  );
});
