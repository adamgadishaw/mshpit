import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogMaintenanceController, catalogBytes, catalogCount, catalogTime, catalogSourceSchedulerLabel, catalogPilotViewAllowed } from "./catalogMaintenanceState.mjs";
const payload = (mode = "maintenance") => ({ catalog: { mode, limits: {}, progress: {} } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test("pilot visibility requires a confirmed current owner response and clears on inactive or denied state", () => {
  const state = { confirmed: true, active: true, data: { localPilot: { canReview: true, mode: "offline-only", maxRecords: 100 } } };
  assert.equal(catalogPilotViewAllowed(state, "admin"), true);
  for (const role of ["fan", "editor", "moderator", null]) assert.equal(catalogPilotViewAllowed(state, role), false);
  for (const patch of [{ confirmed: false }, { active: false }, { data: null }, { data: { localPilot: { canReview: false } } }]) {
    assert.equal(catalogPilotViewAllowed({ ...state, ...patch }, "admin"), false);
  }
});

test("historical provider success cannot hide a disabled or unconfigured scheduler", () => {
  assert.equal(catalogSourceSchedulerLabel({ state: "succeeded", enabled: false, configured: true }), "Disabled");
  assert.equal(catalogSourceSchedulerLabel({ state: "succeeded", enabled: true, configured: false }), "Provider configuration missing");
  assert.equal(catalogSourceSchedulerLabel({ state: "succeeded" }), "Unverified");
  assert.equal(catalogSourceSchedulerLabel({ enabled: true, configured: true }), "Enabled");
});
function setup(overrides = {}) {
  const states = [];
  let changes = 0;
  const controller = createCatalogMaintenanceController({
    accountId: "admin-one", read: async () => payload(), change: async ({ mode }) => { changes += 1; return payload(mode); },
    onState: state => states.push(state), ...overrides,
  });
  return { controller, states, last: () => states.at(-1), changes: () => changes };
}
test("first-load failure is not an empty or complete catalog and retry restores status", async () => {
  let fail = true;
  const s = setup({ read: async () => { if (fail) throw new Error("offline"); return payload(); } });
  const attempt = s.controller.refresh();
  assert.equal(s.last().loading, true);
  assert.equal(s.last().data, null);
  await attempt;
  assert.equal(s.last().confirmed, false);
  assert.match(s.last().error, /could not refresh/);
  fail = false;
  await s.controller.refresh();
  assert.equal(s.last().confirmed, true);
});
test("pending writes are single-flight and are not optimistically reported successful", async () => {
  const save = deferred();
  let writes = 0;
  const s = setup({ change: async () => { writes += 1; return save.promise; } });
  await s.controller.refresh();
  const pending = s.controller.setMode("catch_up");
  await s.controller.setMode("paused");
  await s.controller.refresh();
  assert.equal(writes, 1);
  assert.equal(s.last().pendingMode, "catch_up");
  assert.equal(s.last().data.catalog.mode, "maintenance");
  save.resolve(payload("catch_up"));
  await pending;
  assert.equal(s.last().data.catalog.mode, "catch_up");
  assert.match(s.last().notice, /Mode saved/);
});
test("ambiguous failed writes lock mutations until a read confirms current server state", async () => {
  let writes = 0;
  const s = setup({ change: async () => { writes += 1; throw new Error("timeout"); } });
  await s.controller.refresh();
  await s.controller.setMode("paused");
  assert.equal(s.last().confirmed, false);
  assert.match(s.last().error, /server may already have saved it/);
  await s.controller.setMode("paused");
  assert.equal(writes, 1);
  await s.controller.refresh();
  assert.equal(s.last().confirmed, true);
});
test("access loss erases staff projection and does not replay an action", async () => {
  let denied = false;
  const s = setup({ read: async () => { if (denied) throw Object.assign(new Error("forbidden"), { status: 403 }); return payload(); } });
  await s.controller.refresh();
  denied = true;
  await s.controller.refresh();
  assert.equal(s.last().data, null);
  assert.equal(s.last().confirmed, false);
  await s.controller.setMode("catch_up");
  assert.equal(s.changes(), 0);
});
test("late reads from a disposed account generation cannot paint data", async () => {
  const response = deferred();
  let signal;
  const s = setup({ read: options => { signal = options.signal; return response.promise; } });
  const pending = s.controller.refresh();
  const initialLength = s.states.length;
  s.controller.dispose();
  response.resolve(payload());
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(s.states.length, initialLength);
});
test("late mode confirmation from a disposed account is ignored", async () => {
  const response = deferred();
  const s = setup({ change: () => response.promise });
  await s.controller.refresh();
  const pending = s.controller.setMode("paused");
  const initialLength = s.states.length;
  s.controller.dispose();
  response.resolve(payload("paused"));
  await pending;
  assert.equal(s.states.length, initialLength);
});
test("figures distinguish zero from unavailable and do not invent dates", () => {
  assert.equal(catalogCount(0), "0");
  for (const value of [null, undefined, -1, NaN, "0"]) assert.equal(catalogCount(value), "Unavailable");
  assert.equal(catalogBytes(1024 ** 2), "1 MiB");
  assert.equal(catalogBytes(null), "Unavailable");
  assert.equal(catalogTime(0), "Not recorded");
  assert.equal(catalogTime("garbage"), "Unavailable");
});

test("news desk reasons and Claude spending read as plain sentences", async () => {
  const { newsDeskReasonText, claudeMoney, claudeSpendBreakdown, claudeSpendTotal } = await import("./catalogMaintenanceState.mjs");
  assert.equal(newsDeskReasonText(null), "No check recorded since this version started.");
  assert.equal(newsDeskReasonText({ reason: "waiting_for_slot" }), "Waiting for the next publishing slot.");
  assert.equal(newsDeskReasonText({ reason: "no_qualifying_story" }), "No story is carried by enough independent outlets yet.");
  assert.equal(newsDeskReasonText({ reason: "something_new" }), "Finished without a recorded reason.");
  assert.equal(claudeMoney(0.3), "$0.30");
  assert.equal(claudeMoney(undefined), "Unverified");
  const entry = { confirmedUsd: 1.2, heldUsd: 0.05, unconfirmedUsd: 0 };
  assert.equal(claudeSpendBreakdown(entry), "$1.20 confirmed, $0.05 held, $0.00 unconfirmed");
  assert.equal(claudeSpendBreakdown(null), "Unverified");
  assert.equal(claudeSpendTotal(entry).toFixed(2), "1.25");
  assert.equal(claudeSpendTotal(null), null);
});
