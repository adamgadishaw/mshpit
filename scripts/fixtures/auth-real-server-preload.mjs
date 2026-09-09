// Explicit local-test preload; never imported by production application code.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const directory = resolve(process.env.PIT_DATA_DIR || ".");
assert.equal(process.env.PIT_AUTH_BROWSER_FIXTURE, "1");
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith("pit-auth-real-browser-"));
assert.equal(process.env.NODE_ENV, "test");
assert.equal(typeof process.send, "function", "Fixture metadata uses parent-only IPC, never logs or HTTP.");

// Block provider traffic before importing any server module. The actual HTTP
// listener, routing, body/security boundary and database remain unmodified.
const denied = () => { process.send?.({ kind: "outbound-blocked" }); throw new Error("Fixture outbound network disabled"); };
globalThis.fetch = async () => denied();
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
net.connect = denied; net.createConnection = denied; tls.connect = denied;
net.Socket.prototype.connect = denied;
// The deploy listener normally binds all interfaces. Restrict only its test
// socket address so synthetic credentials are never reachable over the LAN.
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function fixtureListen(port) {
  assert.equal(arguments.length, 1);
  assert.equal(port, Number(process.env.PORT));
  this.once("listening", () => process.send?.({ kind: "listener-bound", address: this.address().address }));
  return listen.call(this, { port, host: "127.0.0.1" });
};
syncBuiltinESMExports();

const { db, q } = await import("../../server/db.js");
const { hashPassword, createSession, COOKIE } = await import("../../server/auth.js");
const { LEGAL_ACCEPTANCE_VERSION } = await import("../../src/domain/privacyDisclosures.mjs");
const password = "Fixture-password1";
const passHash = hashPassword(password);
const members = [
  { id: "real_auth_a", name: "Real Fixture Alice", handle: "realfixturealice", email: "linked@example.test" },
  { id: "real_auth_b", name: "Real Fixture Bob", handle: "realfixturebob", email: "linked@example.test" },
  { id: "real_auth_reset", name: "Reset Fixture", handle: "realfixturereset", email: "reset@example.test" },
  { id: "real_auth_change", name: "Change Fixture", handle: "realfixturechange", email: "change@example.test" },
  ...Array.from({ length: 100 }, (_, index) => ({ id: `real_read_${index}`, name: `Read Fixture ${index}`, handle: `realread${index}`, email: `read-${index}@example.test` })),
];
for (const user of members) {
  q.insertUser.run(user.id, user.email, user.name, user.handle, passHash, "fan", "Toronto", 43.6532, -79.3832, "RF", "#654321", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,onboarding_version=1,age_band='18_plus',extras=? WHERE id=?")
    .run(Date.now(), JSON.stringify({ termsAcceptedAt: Date.now(), termsVersion: LEGAL_ACCEPTANCE_VERSION, analyticsOptOut: true }), user.id);
}
const cookie = (id) => `${COOKIE}=${createSession(id).token}`;
const resetToken = randomBytes(32).toString("base64url");
db.prepare("UPDATE users SET reset_hash=?,reset_expires=? WHERE id=?")
  .run(createHash("sha256").update(resetToken).digest("hex"), Date.now() + 3_600_000, members[2].id);
process.send({ kind: "fixture", password, cookieName: COOKIE, alice: members[0], bob: members[1],
  reset: { ...members[2], token: resetToken, oldCookies: [cookie(members[2].id), cookie(members[2].id)] },
  change: { ...members[3], oldCookies: [cookie(members[3].id), cookie(members[3].id)] },
  readers: members.slice(4).map(user => ({ id: user.id, cookie: cookie(user.id) })),
});
