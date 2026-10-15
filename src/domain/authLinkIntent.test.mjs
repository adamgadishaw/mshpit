import test from "node:test";
import assert from "node:assert/strict";
import { authLinkIntent } from "./authLinkIntent.mjs";
const token = "a".repeat(40);
test("auth links support fragments and legacy queries without choosing ambiguous capabilities", () => {
  assert.deepEqual(authLinkIntent({ hash: `#reset=${token}` }), { kind: "reset", token });
  assert.deepEqual(authLinkIntent({ search: `?verify=${token}` }), { kind: "verify", token });
  for (const hash of ["#reset=", "#reset=short", `#reset=${token}&verify=${token}`, `#reset=${token}&reset=${token}`, `#reset=${token}&unsubscribe=${token}`, `#verify=${token}&ownerApproval=${token}`]) {
    assert.deepEqual(authLinkIntent({ hash }), { kind: "invalid" });
  }
  assert.deepEqual(authLinkIntent({ hash: `#reset=${token}`, search: `?reset=${token}` }), { kind: "invalid" });
  assert.equal(authLinkIntent({ hash: "#section" }), null);
  assert.equal(authLinkIntent({ hash: `#unsubscribe=${token}` }), null);
  assert.equal(authLinkIntent({ hash: `#ownerApproval=${token}` }), null);
});
