import assert from "node:assert/strict";
import test from "node:test";

import { createStaffReadCoordinator, staffScopeFor } from "./staffReadCoordinator.mjs";

const admin = { id: "staff-a", role: "admin" };
const moderator = { id: "staff-b", role: "moderator" };

test("only active staff identities receive a private read scope", () => {
  assert.equal(staffScopeFor(admin), "staff-a\u0000admin");
  assert.equal(staffScopeFor(moderator), "staff-b\u0000moderator");
  assert.equal(staffScopeFor({ id: "fan", role: "fan" }), null);
  assert.equal(staffScopeFor(null), null);
});

test("the latest staff read wins within one account and dataset", () => {
  const coordinator = createStaffReadCoordinator();
  const oldRead = coordinator.claim("moderation", admin);
  const freshRead = coordinator.claim("moderation", admin);
  assert.equal(coordinator.isCurrent(oldRead, admin), false);
  assert.equal(coordinator.isCurrent(freshRead, admin), true);
});

test("a mutation invalidates an older read without affecting another dataset", () => {
  const coordinator = createStaffReadCoordinator();
  const queueRead = coordinator.claim("moderation", admin);
  const memberRead = coordinator.claim("members", admin);
  coordinator.invalidate("moderation", admin);
  assert.equal(coordinator.isCurrent(queueRead, admin), false);
  assert.equal(coordinator.isCurrent(memberRead, admin), true);
});

test("account and role changes reject responses from the previous staff scope", () => {
  const coordinator = createStaffReadCoordinator();
  const adminRead = coordinator.claim("members", admin);
  assert.equal(coordinator.isCurrent(adminRead, moderator), false);
  assert.equal(coordinator.isCurrent(adminRead, { ...admin, role: "moderator" }), false);
});

test("reset prevents an old request reviving after the same account signs in again", () => {
  const coordinator = createStaffReadCoordinator();
  const beforeLogout = coordinator.claim("moderation", admin);
  coordinator.reset();
  const afterLogin = coordinator.claim("moderation", admin);
  assert.equal(beforeLogout.ticket, afterLogin.ticket, "the underlying ticket number may be reused");
  assert.equal(coordinator.isCurrent(beforeLogout, admin), false, "the epoch keeps the old request stale");
  assert.equal(coordinator.isCurrent(afterLogin, admin), true);
});
