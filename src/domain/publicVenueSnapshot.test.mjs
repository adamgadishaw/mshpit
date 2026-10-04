import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicVenueSnapshot, publicVenueArtistTarget, publicVenueRequestPath, publicVenueUpcomingLabel } from "./publicVenueSnapshot.mjs";
import { fetchPublicVenueSnapshot } from "../features/venuePublic/venuePublicApi.mjs";

const identity = { source: "ticketmaster", providerVenueId: "rZ7HnEZaeot" };
const path = "/venue/ticketmaster-rz7hnezaeot";
const value = { path, venue: { name: "Lee's Palace", ...identity, place: "Toronto, Canada", address: { streetAddress: "529 Bloor Street West" } },
  events: [{ id: "lee-1", name: "Band live", artist: "Band", venue: "Lee's Palace", ...identity, date: "2036-01-01" }], hasMore: true, nextCursor: "cursor", after: null };

test("provider target overrides stale name/path; snapshot keeps public facts without global data", () => {
  assert.equal(publicVenueRequestPath("Wrong name", { ...identity, path: "/venue/other" }), path);
  const snapshot = normalizePublicVenueSnapshot(value, { path, identity });
  assert.equal(snapshot.venue.place, "Toronto, Canada");
  assert.equal(snapshot.events[0].eventName, "Band live");
  assert.deepEqual(publicVenueUpcomingLabel(snapshot), { value: 1, label: "UPCOMING PREVIEW" });
  assert.deepEqual(publicVenueUpcomingLabel(null), { value: "—", label: "UPCOMING" });
  assert.equal(publicVenueUpcomingLabel({ ...snapshot, hasMore: false, after: "cursor" }).label, "UPCOMING PREVIEW");
  assert.equal(publicVenueUpcomingLabel({ ...snapshot, hasMore: false }).label, "UPCOMING");
});

test("event-to-artist navigation preserves the canonical artist slug instead of a display-name guess", () => {
  assert.deepEqual(publicVenueArtistTarget({ artist: "Namesake", artistPath: "/artist/namesake-ca" }), { name: "Namesake", publicSlug: "namesake-ca" });
  assert.equal(publicVenueArtistTarget({ artist: "Namesake", artistPath: null }), null);
  assert.equal(publicVenueArtistTarget({ artist: "Namesake", artistPath: "/venue/namesake" }), null);
});

test("wrong providers, mixed event identities, wrong cursors and oversized pages cannot hydrate", () => {
  for (const changed of [
    { ...value, venue: { ...value.venue, source: "eventbrite" } },
    { ...value, venue: { ...value.venue, providerVenueId: "another-room" } },
    { ...value, events: [{ ...value.events[0], source: "eventbrite" }] },
    { ...value, events: Array(9).fill(value.events[0]) },
    { ...value, after: "stale-page" }, { ...value, nextCursor: null },
  ]) assert.equal(normalizePublicVenueSnapshot(changed, { path, identity }), null);
  const stripped = normalizePublicVenueSnapshot({ ...value, ownerId: "private", venue: { ...value.venue, secret: "private" } }, { path, identity });
  assert.equal(JSON.stringify(stripped).includes("private"), false);
});

test("API passes cancellation and account boundary; cursor pages are explicit and invalid replies fail", async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const result = await fetchPublicVenueSnapshot({ path, identity, after: "cursor", accountId: null, signal }, {
    apiCall: async (url, options) => { calls++; assert.match(url, /after=cursor$/); assert.equal(options.signal, signal); assert.equal(options.expectedAccountId, null); return { ...value, after: "cursor", hasMore: false, nextCursor: null }; },
    invalidResponse: () => new Error("invalid reply"),
  });
  assert.equal(result.after, "cursor"); assert.equal(calls, 1);
  await assert.rejects(fetchPublicVenueSnapshot({ path, identity }, { apiCall: async () => ({}), invalidResponse: () => new Error("invalid reply") }), /invalid reply/);
});
