import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// Only synthetic accounts and a fresh test database; no provider call is allowed.
const dataDirectory = mkdtempSync(join(tmpdir(), "pit-dm-policy-"));
Object.assign(process.env, { NODE_ENV: "test", PIT_ENV: "test", PIT_DATA_DIR: dataDirectory,
  PIT_REQUIRE_VERIFIED_EMAIL: "true", ADMIN_EMAIL: "", ADMIN_PASSWORD: "", RESEND_API_KEY: "" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("External network is forbidden in DM policy tests"); };
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => {
  db.close();
  globalThis.fetch = originalFetch;
  rmSync(dataDirectory, { recursive: true, force: true });
});

let sequence = 0;
function account(ageBand, policy = "mutuals") {
  const id = `dm_policy_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unusable-password-record",
    "fan", "", null, null, "QA", "#123456", Date.now());
  db.prepare("UPDATE users SET age_band=?,dm_policy=?,email_verified_at=? WHERE id=?")
    .run(ageBand, policy, Date.now(), id);
  return q.userById.get(id);
}

function fixture({ senderBand, recipientBand, policy = "nobody", follows = "mutual", existing = false }) {
  const sender = account(senderBand), recipient = account(recipientBand, policy);
  if (["sender", "mutual"].includes(follows)) {
    db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(sender.id, recipient.id);
  }
  if (["recipient", "mutual"].includes(follows)) {
    db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(recipient.id, sender.id);
  }
  if (existing) {
    db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at) VALUES(?,?,?,?,?)")
      .run(`history_${sender.id}`, recipient.id, sender.id, "Synthetic earlier conversation.", Date.now() - 1000);
  }
  const rows = () => ({
    messages: db.prepare("SELECT * FROM dms WHERE from_id IN (?,?) OR to_id IN (?,?) ORDER BY id")
      .all(sender.id, recipient.id, sender.id, recipient.id),
    acceptances: db.prepare("SELECT * FROM dm_acceptances WHERE user_id IN (?,?) ORDER BY user_id,other_id")
      .all(sender.id, recipient.id),
    notifications: db.prepare("SELECT * FROM notifications WHERE user_id IN (?,?) ORDER BY id")
      .all(sender.id, recipient.id),
  });
  const send = () => routes["POST /api/dms/:otherId"]({ user: q.userById.get(sender.id),
    ip: `synthetic-${sender.id}`, params: { otherId: recipient.id },
    body: { text: "Synthetic policy regression message." } });
  return { sender, recipient, rows, send };
}

// These are actual POST handlers using persisted account policy/age/follow rows.
// The pure helper suite separately enumerates all 216 contract combinations.
for (const senderBand of ["18_plus", "13_17"]) {
  for (const recipientBand of ["18_plus", "13_17", "unknown"]) {
    test(`Nobody rejects mutual first contact from ${senderBand} to ${recipientBand} without side effects`, () => {
      const f = fixture({ senderBand, recipientBand });
      const before = f.rows();
      assert.throws(f.send, error => error.status === 403 && error.code === "CONTACT_NOT_ALLOWED"
        && error.message === "This account isn't accepting messages from you.");
      assert.deepEqual(f.rows(), before, "denied contact must not create messages, consent or notifications");
    });
  }
}

for (const existing of [false, true]) {
  test(`unknown sender still needs classification in ${existing ? "existing" : "new"} closed mutual chat`, () => {
    const f = fixture({ senderBand: "unknown", recipientBand: "18_plus", existing });
    const before = f.rows();
    assert.throws(f.send, error => error.status === 403 && error.code === "CONTACT_NOT_ALLOWED"
      && error.message === "Choose your age group in Settings before sending a message.");
    assert.deepEqual(f.rows(), before);
  });
}

const allowed = [
  ["adult first contact from a followed sender", { senderBand: "18_plus", recipientBand: "18_plus", policy: "people_i_follow", follows: "recipient" }],
  ["teen first contact with mutuals", { senderBand: "13_17", recipientBand: "18_plus", policy: "mutuals" }],
  ["unknown recipient first contact with mutuals", { senderBand: "18_plus", recipientBand: "unknown", policy: "people_i_follow" }],
  ["existing adult closed chat without follows", { senderBand: "18_plus", recipientBand: "18_plus", follows: "none", existing: true }],
  ["existing teen closed chat with mutuals", { senderBand: "18_plus", recipientBand: "13_17", existing: true }],
  ["existing unknown-recipient closed chat with mutuals", { senderBand: "18_plus", recipientBand: "unknown", existing: true }],
];
for (const [label, options] of allowed) {
  test(`${label} remains writable through the POST route`, () => {
    const f = fixture(options), before = f.rows();
    const result = f.send();
    assert.ok(result.id);
    const afterSend = f.rows();
    assert.equal(afterSend.messages.length, before.messages.length + 1);
    assert.equal(afterSend.notifications.length, before.notifications.length + 1);
    const message = db.prepare("SELECT from_id,to_id,text FROM dms WHERE id=?").get(result.id);
    assert.deepEqual({ ...message }, { from_id: f.sender.id, to_id: f.recipient.id, text: "Synthetic policy regression message." });
    assert.equal(afterSend.notifications.at(-1).post_id, result.id);
  });
}

const denied = [
  ["sender-only follow does not satisfy People I follow", { senderBand: "18_plus", recipientBand: "18_plus", policy: "people_i_follow", follows: "sender" }],
  ["teen recipient still requires mutual first contact", { senderBand: "18_plus", recipientBand: "13_17", policy: "people_i_follow", follows: "recipient" }],
  ["unknown recipient still requires mutual first contact", { senderBand: "18_plus", recipientBand: "unknown", policy: "people_i_follow", follows: "recipient" }],
  ["existing teen conversation pauses without mutual follows", { senderBand: "18_plus", recipientBand: "13_17", follows: "recipient", existing: true }],
];
for (const [label, options] of denied) {
  test(label, () => {
    const f = fixture(options), before = f.rows();
    assert.throws(f.send, error => error.status === 403 && error.code === "CONTACT_NOT_ALLOWED");
    assert.deepEqual(f.rows(), before);
  });
}
