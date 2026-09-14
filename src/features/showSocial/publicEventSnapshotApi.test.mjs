import assert from "node:assert/strict";
import test from "node:test";
import { readPublicEventSnapshot } from "./publicEventSnapshotApi.mjs";

const eventId = "provider/event-1";
const entity = { id: eventId, kind: "event", path: "/event/provider%2Fevent-1", publicEventSnapshot: true,
  name: "Club night", artist: "Club night", venue: "The Room", date: "2026-09-01" };

test("snapshot reads revalidate the exact event with the server and fence the account and abort signal", async () => {
  const calls = [];
  const controller = new AbortController();
  const snapshot = await readPublicEventSnapshot({ eventId, accountId: "viewer", signal: controller.signal }, {
    apiCall: async (path, options) => { calls.push({ path, options }); return { entity }; },
  });
  assert.equal(snapshot.name, entity.name);
  assert.equal(calls[0].path, "/api/resolve?path=%2Fevent%2Fprovider%252Fevent-1");
  assert.equal(calls[0].options.expectedAccountId, "viewer");
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.silent, true);
});

test("a missing server marker, wrong event or revoked event never opens the snapshot", async () => {
  for (const response of [{ entity: null }, { entity: { ...entity, publicEventSnapshot: undefined } }, { entity: { ...entity, id: "other" } }]) {
    assert.equal(await readPublicEventSnapshot({ eventId }, { apiCall: async () => response }), null);
  }
  assert.equal(await readPublicEventSnapshot({ eventId: "" }, { apiCall: () => assert.fail("No empty request") }), null);
});

test("network errors and cancellation are surfaced to the resource rather than converted to empty events", async () => {
  const failure = new Error("transport unavailable");
  await assert.rejects(readPublicEventSnapshot({ eventId }, { apiCall: async () => { throw failure; } }), (error) => error === failure);
  const aborted = Object.assign(new Error("aborted"), { name: "AbortError" });
  await assert.rejects(readPublicEventSnapshot({ eventId }, { apiCall: async () => { throw aborted; } }), (error) => error === aborted);
});
