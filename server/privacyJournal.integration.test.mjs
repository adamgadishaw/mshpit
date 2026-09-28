import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-privacy-journal-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes, replayPrivacyJournalOnRestore } = await import("./api.js");
const { hashPassword } = await import("./auth.js");
const { RESTORE_GATE_KEY } = await import("./databaseRecovery.js");
const { PRIVACY_REPLAY_EVIDENCE_KEY, privacyObjectKey, signPrivacyEntry } = await import("./privacyJournal.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

function addUser(id, password = "journal-password") {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword(password), "fan", "Toronto", 43.65, -79.38, "PJ", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const outbox = (subjectId) => db.prepare("SELECT kind FROM privacy_journal_outbox WHERE subject_id=? ORDER BY at").all(subjectId).map((row) => row.kind);

test("deleting an account and withdrawing email consent are journaled with the change", async () => {
  const leaving = addUser("u_journal_leaving", "leave-now-please");
  assert.deepEqual(await routes["DELETE /api/me"]({ user: leaving, ip: "journal-delete", body: { password: "leave-now-please" }, clearSession() {} }), { ok: true });
  assert.equal(q.userById.get("u_journal_leaving"), undefined);
  assert.deepEqual(outbox("u_journal_leaving"), ["account_erased"]);

  const reader = addUser("u_journal_reader");
  const settings = routes["POST /api/me/email-preferences"];
  settings({ user: reader, ip: "journal-settings", body: { announcements: true } });
  assert.deepEqual(outbox("u_journal_reader"), [], "opting in is not journaled");
  settings({ user: q.userById.get("u_journal_reader"), ip: "journal-settings", body: { announcements: false } });
  assert.deepEqual(outbox("u_journal_reader"), ["marketing_opt_out"]);

  settings({ user: q.userById.get("u_journal_reader"), ip: "journal-settings", body: { announcements: true } });
  db.prepare("UPDATE users SET unsub_token='journal-unsubscribe-token' WHERE id='u_journal_reader'").run();
  await routes["POST /api/unsubscribe"]({ ip: "journal-unsub", body: { token: "journal-unsubscribe-token" } });
  await routes["POST /api/unsubscribe"]({ ip: "journal-unsub", body: { token: "journal-unsubscribe-token" } });
  assert.deepEqual(outbox("u_journal_reader"), ["marketing_opt_out", "marketing_opt_out"], "an unsubscribe link counts once, not per click");
});

test("a restored database erases journaled accounts before it serves anyone", async () => {
  const keyText = "r".repeat(48);
  const env = {
    PRIVACY_JOURNAL_KEY: keyText,
    BACKUP_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    BACKUP_S3_BUCKET: "mshpit-backups",
    BACKUP_S3_ACCESS_KEY_ID: "backup-access",
    BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret",
  };
  addUser("u_journal_resurrected");
  const subscriber = addUser("u_journal_subscriber");
  db.prepare("UPDATE users SET marketing_opt_out=0 WHERE id=?").run(subscriber.id);
  const at = Date.now();
  const objects = new Map([
    signPrivacyEntry({ id: "00000000-0000-4000-8000-0000000000e1", kind: "account_erased", subjectId: "u_journal_resurrected", at }, Buffer.from(keyText)),
    signPrivacyEntry({ id: "00000000-0000-4000-8000-0000000000e2", kind: "marketing_opt_out", subjectId: "u_journal_subscriber", at: at + 1 }, Buffer.from(keyText)),
  ].map((entry) => [privacyObjectKey(entry), JSON.stringify(entry)]));
  const fetchImpl = async (url) => {
    const target = new URL(url);
    const key = decodeURIComponent(target.pathname.replace(/^\/mshpit-backups\/?/u, ""));
    if (!key) return new Response(`<ListBucketResult>${[...objects.keys()].map((name) => `<Contents><Key>${name}</Key></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    return new Response(objects.get(key));
  };

  assert.deepEqual(await replayPrivacyJournalOnRestore({ env, fetchImpl }), { needed: false }, "the live database skips replay");
  db.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "reviewed", preparedAt: at }));
  try {
    const before = db.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox").get().n;
    const result = await replayPrivacyJournalOnRestore({ env, fetchImpl });
    assert.deepEqual({ erased: result.erased, optedOut: result.optedOut, rejected: result.rejected }, { erased: 1, optedOut: 1, rejected: 0 });
    assert.equal(q.userById.get("u_journal_resurrected"), undefined, "the resurrected account is erased again");
    assert.equal(q.userById.get("u_journal_subscriber").marketing_opt_out, 1, "withdrawn consent stays withdrawn");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox").get().n, before, "replaying does not journal again");
  } finally {
    db.prepare("DELETE FROM app_meta WHERE key IN (?,?)").run(RESTORE_GATE_KEY, PRIVACY_REPLAY_EVIDENCE_KEY);
  }
});

test("privacy changes roll back when their durable journal append fails", async () => {
  const leaving = addUser("u_journal_rollback_delete", "rollback-password");
  const subscriber = addUser("u_journal_rollback_consent");
  const settings = routes["POST /api/me/email-preferences"];
  settings({ user: subscriber, ip: "journal-rollback-settings", body: { announcements: true } });
  db.exec("CREATE TRIGGER fail_privacy_journal_append BEFORE INSERT ON privacy_journal_outbox BEGIN SELECT RAISE(ABORT,'synthetic journal failure'); END");
  try {
    await assert.rejects(routes["DELETE /api/me"]({ user: leaving, ip: "journal-rollback-delete", body: { password: "rollback-password" }, clearSession() {} }));
    assert.ok(q.userById.get(leaving.id), "account erasure and journal append commit together or neither commits");
    assert.throws(() => settings({ user: q.userById.get(subscriber.id), ip: "journal-rollback-settings", body: { announcements: false } }));
    assert.equal(q.userById.get(subscriber.id).marketing_opt_out, 0, "withdrawal cannot succeed without its replay record");
    assert.deepEqual(outbox(leaving.id), []);
    assert.deepEqual(outbox(subscriber.id), []);
  } finally {
    db.exec("DROP TRIGGER fail_privacy_journal_append");
  }
});
