import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-owner-routes-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const { db, q } = await import("./db.js");
const { hashPassword, createSession, getSession } = await import("./auth.js");
const { routes } = await import("./api.js");
const { createOwnerApprovalRequest } = await import("./ownerApprovals.js");
const { ownerIdentity, storeOwnerIdentity } = await import("./ownerIdentity.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
function addUser(role, password, { emailVerified = true, handle = null } = {}) {
  sequence += 1;
  const id = `owner_route_${sequence}`;
  const email = `${id}@example.test`;
  q.insertUser.run(
    id,
    email,
    `Owner Route ${sequence}`,
    handle || `${id}_${role}`,
    hashPassword(password),
    role,
    "Toronto",
    43.65,
    -79.38,
    "OR",
    "#123456",
    Date.now(),
  );
  if (emailVerified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

const ownerPassword = "locked-owner-route-password";
const owner = addUser("admin", ownerPassword, { handle: "mshpit" });
const administrator = addUser("admin", "requesting-admin-password", { handle: "staff_admin" });
const target = addUser("fan", "target-member-password", { handle: "target_listener" });
storeOwnerIdentity(db, ownerIdentity(owner.email, owner.id, Date.now()));

function context(user, { body = {}, params = {}, query = {} } = {}) {
  return {
    user: q.userById.get(user.id),
    body,
    params,
    query,
    ip: `owner-route-${user.id}`,
    requestId: `request-${sequence}-${Date.now()}`,
    setHeader() {},
  };
}

test("Members and the private self projection derive Owner from the locked identity", () => {
  const self = routes["GET /api/me"](context(owner));
  assert.equal(self.user.owner, true);
  const directory = routes["GET /api/admin/members"](context(administrator));
  assert.equal(directory.users.find((user) => user.id === owner.id).owner, true);
  assert.equal(directory.users.find((user) => user.id === administrator.id).owner, false);
});

test("requesting a head-role change keeps authority unchanged and never returns the bearer token", async () => {
  const liveSession = createSession(target.id, "127.0.0.1", "target-before-approval");
  const result = await routes["POST /api/admin/users/:id/role"](context(administrator, {
    params: { id: target.id },
    body: { role: "moderator", handle: "target_listener_mod" },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(result.emailSent, false);
  assert.equal("token" in result, false);
  assert.equal(q.userById.get(target.id).role, "fan");
  assert.equal(getSession(liveSession.token)?.user_id, target.id, "a request alone cannot revoke or elevate the member");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='change_role'").get(target.id).count, 0);
});

test("only the exact Owner can review and decide, with password reauthentication", async () => {
  const current = q.userById.get(target.id);
  const created = createOwnerApprovalRequest(db, {
    kind: "privileged_role_change",
    requestedBy: administrator.id,
    targetUserId: target.id,
    summary: "Privileged role change awaiting Owner review",
    payload: {
      targetUserId: target.id,
      expectedRole: current.role,
      expectedHandle: current.handle,
      requestedRole: "moderator",
      requestedHandle: "target_listener_mod",
    },
    requestId: "owner-route-approval",
    at: Date.now(),
  });

  assert.throws(
    () => routes["POST /api/owner-approvals/review"](context(administrator, { body: { token: created.token } })),
    (error) => error?.code === "FORBIDDEN",
  );
  const review = routes["POST /api/owner-approvals/review"](context(owner, { body: { token: created.token } }));
  assert.equal(review.review.request.id, created.request.id);
  assert.equal(review.review.payload.requestedRole, "moderator");

  await assert.rejects(
    () => routes["POST /api/owner-approvals/decide"](context(owner, {
      body: { token: created.token, password: "wrong-owner-password", decision: "approved" },
    })),
    (error) => error?.code === "AUTH_INVALID",
  );

  const session = createSession(target.id, "127.0.0.1", "target-awaiting-owner");
  const decided = await routes["POST /api/owner-approvals/decide"](context(owner, {
    body: { token: created.token, password: ownerPassword, decision: "approved" },
  }));
  assert.equal(decided.ok, true);
  assert.equal(decided.decision, "approved");
  assert.equal(decided.receipt.kind, "privileged_role_change");
  assert.equal(q.userById.get(target.id).role, "moderator");
  assert.equal(q.userById.get(target.id).handle, "target_listener_mod");
  assert.equal(getSession(session.token), null);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='change_role'").get(target.id).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM owner_approval_receipts WHERE request_id=?").get(created.request.id).count, 1);

  await assert.rejects(
    () => routes["POST /api/owner-approvals/decide"](context(owner, {
      body: { token: created.token, password: ownerPassword, decision: "approved" },
    })),
    (error) => error?.code === "CONFLICT",
  );
});

test("the Owner cannot be role-targeted, restricted, or self-deleted through the API", () => {
  assert.throws(
    () => routes["POST /api/admin/users/:id/role"](context(administrator, {
      params: { id: owner.id }, body: { role: "fan" },
    })),
    (error) => error?.code === "FORBIDDEN",
  );
  assert.throws(
    () => routes["POST /api/admin/users/:id/suspend"](context(administrator, {
      params: { id: owner.id }, body: { days: 7 },
    })),
    (error) => error?.code === "FORBIDDEN",
  );
  assert.throws(
    () => routes["DELETE /api/me"](context(owner, { body: { password: ownerPassword } })),
    (error) => error?.code === "FORBIDDEN",
  );
});
