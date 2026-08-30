import assert from "node:assert/strict";
import test from "node:test";

import { fetchMyShowPlans } from "./showPlanningApi.mjs";

test("personal show-plan refresh is abortable, account-bound, and validates its snapshot", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const result = await fetchMyShowPlans({ accountId: "fan-a", signal }, {
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return { going: [{ key: "a|b|2026-09-01" }], attendance: [{ showId: "show-1", state: "interested" }] };
    },
  });
  assert.equal(calls[0].path, "/api/me/going");
  assert.equal(calls[0].options.expectedAccountId, "fan-a");
  assert.equal(calls[0].options.signal, signal);
  assert.equal(result.attendance[0].state, "interested");

  await assert.rejects(() => fetchMyShowPlans({ accountId: "fan-a" }, {
    apiCall: async () => ({ going: [], attendance: null }),
  }), /invalid/);
});
