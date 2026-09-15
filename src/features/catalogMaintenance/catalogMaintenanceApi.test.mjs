import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_MAINTENANCE_PATH, readCatalogMaintenance, setCatalogMaintenanceMode, validateCatalogMaintenance } from "./catalogMaintenanceApi.mjs";
const payload = (mode = "maintenance") => ({ catalog: { mode, limits: {}, progress: {} } });

test("upkeep reads bind to the exact administrator and never trigger provider work", async () => {
  const controller = new AbortController();
  let call;
  assert.deepEqual(await readCatalogMaintenance({ accountId: "admin-one", signal: controller.signal }, {
    apiCall: async (...args) => { call = args; return payload(); },
  }), payload());
  assert.equal(call[0], CATALOG_MAINTENANCE_PATH);
  assert.equal(call[1].expectedAccountId, "admin-one");
  assert.equal(call[1].signal, controller.signal);
  assert.equal(call[1].method, undefined);
  assert.equal(call[1].silent, true);
});
test("upkeep mode writes use only an allowlisted mode and server-confirmed result", async () => {
  let call;
  await setCatalogMaintenanceMode({ accountId: "admin-one", mode: "paused" }, {
    apiCall: async (...args) => { call = args; return payload("paused"); },
  });
  assert.equal(call[1].method, "POST");
  assert.deepEqual(call[1].body, { mode: "paused" });
  assert.equal(call[1].expectedAccountId, "admin-one");
  await assert.rejects(setCatalogMaintenanceMode({ accountId: "admin-one", mode: "catch_up" }, {
    apiCall: async () => payload("paused"),
  }), /did not confirm/);
});
test("missing identity and unsupported actions never reach transport", async () => {
  let calls = 0;
  const services = { apiCall: async () => { calls += 1; return payload(); } };
  await assert.rejects(readCatalogMaintenance({}, services), /administrator/);
  await assert.rejects(setCatalogMaintenanceMode({ accountId: "admin-one", mode: "run-now" }, services), /supported/);
  assert.equal(calls, 0);
});
test("conflicting administrator sessions use the last confirmed mode as a precondition", async () => {
  let body;
  await setCatalogMaintenanceMode({ accountId: "admin-one", mode: "catch_up", expectedMode: "maintenance" }, {
    apiCall: async (_path, options) => { body = options.body; return payload("catch_up"); },
  });
  assert.deepEqual(body, { mode: "catch_up", expectedMode: "maintenance" });
});
test("unavailable control is explicit and malformed success is rejected", () => {
  assert.deepEqual(validateCatalogMaintenance({ catalog: null }), { catalog: null });
  for (const value of [null, {}, [], { catalog: {} }, { catalog: { mode: "complete", limits: {}, progress: {} } }]) {
    assert.throws(() => validateCatalogMaintenance(value), /invalid status/);
  }
});
