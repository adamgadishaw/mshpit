import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ownerApprovalPresentation, ownerApprovalRemaining } from "./ownerApproval.mjs";

test("privileged role approvals disclose the exact before and after state", () => {
  const view = ownerApprovalPresentation({
    request: { id: "oa_123", kind: "privileged_role_change", summary: "Review role", expiresAt: 200_000 },
    payload: { expectedRole: "fan", expectedHandle: "listener", requestedRole: "admin", requestedHandle: "listener_admin" },
  });
  assert.equal(view.title, "Change @listener to admin?");
  assert.deepEqual(view.details, [
    { label: "Account", value: "@listener" },
    { label: "Current role", value: "fan" },
    { label: "Requested role", value: "admin" },
    { label: "Requested username", value: "@listener_admin" },
  ]);
});

test("security approvals expose only known completed checks", () => {
  const view = ownerApprovalPresentation({
    request: { id: "oa_security", kind: "security_release", expiresAt: 500_000 },
    payload: { category: "security_audit", checks: ["tests", "architecture", "invented"], commit: "abc123" },
  });
  assert.equal(view.title, "Approve this security audit stamp?");
  assert.equal(view.details.at(-1).value, "Automated tests / Architecture checks");
  assert.equal(ownerApprovalPresentation({ request: { kind: "security_release" }, payload: { category: "security_audit", checks: [] } }), null);
});

test("approval expiry is deterministic and bounded to whole minutes", () => {
  assert.deepEqual(ownerApprovalRemaining(160_001, 100_000), { expired: false, minutes: 2 });
  assert.deepEqual(ownerApprovalRemaining(100_000, 100_000), { expired: true, minutes: 0 });
  assert.deepEqual(ownerApprovalRemaining(null, 100_000), { expired: false, minutes: null });
});

test("Owner token APIs keep the bearer in POST bodies and the screen requires password decisions", () => {
  const service = fs.readFileSync(new URL("../features/ownerApprovals/services/ownerApprovalApi.mjs", import.meta.url), "utf8");
  const screen = fs.readFileSync(new URL("../screens/OwnerApprovalScreen.jsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  assert.match(service, /api\("\/api\/owner-approvals\/review", \{[\s\S]*method: "POST"[\s\S]*body: \{ token \}/);
  assert.match(service, /api\("\/api\/owner-approvals\/decide", \{[\s\S]*body: \{ token, decision, password \}/);
  assert.doesNotMatch(service, /owner-approvals[^"`]*\?/);
  assert.match(screen, /decide\("approved"\)/);
  assert.match(screen, /decide\("rejected"\)/);
  assert.match(screen, /secureTextEntry/);
  assert.match(app, /readSensitiveFragmentToken\(window\.location, "ownerApproval"\)/);
  assert.match(app, /scrubSensitiveUrl\("ownerApproval"\)/);
});
