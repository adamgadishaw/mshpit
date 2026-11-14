import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const { PRIVACY_REPLAY_EVIDENCE_KEY, privacyObjectKey, shipPrivacyJournal, signPrivacyEntry } = await import("./privacyJournal.js");
const { COVERAGE_OBJECT, privacyEntryHead, readContinuity, signCoverage } = await import("./privacyJournalContinuity.js");
const { backupStorageIdentity } = await import("./backupStorageIdentity.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

function addUser(id, password = "journal-password") {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword(password), "fan", "Toronto", 43.65, -79.38, "PJ", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const outbox = (subjectId) => db.prepare("SELECT kind FROM privacy_journal_outbox WHERE subject_id=? ORDER BY at").all(subjectId).map((row) => row.kind);

function seedNewsArtifacts(userId) {
  const eventId = `live_${userId}`, noteId = `note_${userId}`, draftId = `draft_${userId}`;
  db.prepare("INSERT INTO news_live_events(id,slug,title,keywords,starts_at,ends_at,created_by,created_at) VALUES (?,?,?,'[]',1,2,?,1)")
    .run(eventId, eventId, "Preserved coverage", userId);
  db.prepare("INSERT INTO news_live_notes(id,event_id,text,created_by,created_at) VALUES (?,?,?,?,1)")
    .run(noteId, eventId, "Preserved timeline update", userId);
  db.prepare("INSERT INTO news_drafts(id,status,reports,result,cost_usd,created_by,created_at,updated_at) VALUES (?,'draft','[]',?,0.01,?,1,1)")
    .run(draftId, JSON.stringify({ headline: "Preserved editorial draft" }), userId);
  return [["news_live_events", eventId], ["news_live_notes", noteId], ["news_drafts", draftId]]
    .map(([table, id]) => ({ table, id, before: db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) }));
}

function assertNewsAttribution(artifacts, createdBy) {
  for (const { table, id, before } of artifacts) {
    assert.deepEqual({ ...db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) }, { ...before, created_by: createdBy },
      `${table}: preserve every content field while applying exactly the intended attribution`);
  }
}

test("deleting an account and withdrawing email consent are journaled with the change", async () => {
  const leaving = addUser("u_journal_leaving", "leave-now-please");
  const leavingNews = seedNewsArtifacts(leaving.id);
  const otherStaff = addUser("u_journal_other_staff");
  const otherNews = seedNewsArtifacts(otherStaff.id);
  assert.deepEqual(await routes["DELETE /api/me"]({ user: leaving, ip: "journal-delete", body: { password: "leave-now-please" }, clearSession() {} }), { ok: true });
  assert.equal(q.userById.get("u_journal_leaving"), undefined);
  assert.deepEqual(outbox("u_journal_leaving"), ["account_erased"]);
  assertNewsAttribution(leavingNews, null);
  assertNewsAttribution(otherNews, otherStaff.id);

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
  const restoredNews = seedNewsArtifacts("u_journal_resurrected");
  const subscriber = addUser("u_journal_subscriber");
  db.prepare("UPDATE users SET marketing_opt_out=0 WHERE id=?").run(subscriber.id);
  const at = Date.now();
  const objects = new Map();
  const etag = (body) => `"${createHash("sha256").update(body).digest("hex")}"`;
  const fetchImpl = async (url, init = {}) => {
    const target = new URL(url);
    if (!target.searchParams.has("X-Amz-Signature")) return new Response("", { status: 403 });
    const key = decodeURIComponent(target.pathname.replace(/^\/mshpit-backups\/?/u, ""));
    if (init.method === "PUT") {
      const headers = new Headers(init.headers);
      if (headers.get("If-None-Match") === "*" && objects.has(key)) return new Response("", { status: 412 });
      if (headers.has("If-Match") && (!objects.has(key) || headers.get("If-Match") !== etag(objects.get(key)))) return new Response("", { status: 412 });
      objects.set(key, init.body);
      return new Response("");
    }
    if (!key) {
      const names = [...objects.keys()].filter((name) => name.startsWith(target.searchParams.get("prefix") || ""));
      return new Response(`<ListBucketResult>${names.map((name) => `<Contents><Key>${name}</Key></Contents>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    return objects.has(key) ? new Response(objects.get(key), { headers: { ETag: etag(objects.get(key)) } }) : new Response("", { status: 404 });
  };

  // The restored snapshot retains its source anchor; the remote journal then
  // advances with decisions that happened after that snapshot was taken.
  assert.equal((await shipPrivacyJournal(db, { env, fetchImpl })).pending, 0);
  const anchor = readContinuity(db);
  assert.equal(anchor.legacyUnknown, false);
  let sequence = anchor.sequence;
  let head = anchor.head;
  for (const decision of [
    { id: "00000000-0000-4000-8000-0000000000e1", kind: "account_erased", subjectId: "u_journal_resurrected", at },
    { id: "00000000-0000-4000-8000-0000000000e2", kind: "marketing_opt_out", subjectId: "u_journal_subscriber", at: at + 1 },
  ]) {
    const entry = signPrivacyEntry({ ...decision, v: 2, streamId: anchor.streamId, sequence: ++sequence, previous: head }, Buffer.from(keyText));
    head = privacyEntryHead(entry);
    objects.set(privacyObjectKey(entry), JSON.stringify(entry));
  }
  objects.set(COVERAGE_OBJECT, JSON.stringify(signCoverage({ storageIdentity: backupStorageIdentity(env),
    streamId: anchor.streamId, sequence, head, legacyUnknown: false, at: at + 2 }, Buffer.from(keyText))));

  assert.deepEqual(await replayPrivacyJournalOnRestore({ env, fetchImpl }), { needed: false }, "the live database skips replay");
  db.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "reviewed", preparedAt: at }));
  try {
    const before = db.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox").get().n;
    const missingKey = [...objects.keys()].find((name) => name.startsWith("privacy-journal/v1/"));
    const missingEntry = objects.get(missingKey);
    objects.delete(missingKey);
    await assert.rejects(replayPrivacyJournalOnRestore({ env, fetchImpl }), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" });
    assert.ok(q.userById.get("u_journal_resurrected"), "an incomplete chain blocks account mutation");
    assertNewsAttribution(restoredNews, "u_journal_resurrected");
    assert.equal(q.userById.get("u_journal_subscriber").marketing_opt_out, 0, "an incomplete chain blocks consent mutation");
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key=?").get(PRIVACY_REPLAY_EVIDENCE_KEY), undefined);
    objects.set(missingKey, missingEntry);
    const beforeReplayRows = db.prepare("SELECT * FROM privacy_journal_outbox ORDER BY id").all();
    for (const trigger of [
      "BEFORE UPDATE ON users WHEN OLD.id='u_journal_subscriber'",
      "BEFORE INSERT ON app_meta WHEN NEW.key='privacy-journal:replay:v1'",
    ]) {
      db.exec(`CREATE TEMP TRIGGER fail_replay_completion ${trigger} BEGIN SELECT RAISE(ABORT,'injected replay completion failure'); END`);
      try { await assert.rejects(replayPrivacyJournalOnRestore({ env, fetchImpl }), { code: "PRIVACY_JOURNAL_REPLAY_REQUIRED" }); }
      finally { db.exec("DROP TRIGGER fail_replay_completion"); }
      assert.ok(q.userById.get("u_journal_resurrected"), "a later replay failure rolls back the earlier erasure");
      assertNewsAttribution(restoredNews, "u_journal_resurrected");
      assert.equal(q.userById.get("u_journal_subscriber").marketing_opt_out, 0);
      assert.deepEqual(readContinuity(db), anchor);
      assert.deepEqual(db.prepare("SELECT * FROM privacy_journal_outbox ORDER BY id").all(), beforeReplayRows);
      assert.equal(db.prepare("SELECT value FROM app_meta WHERE key=?").get(PRIVACY_REPLAY_EVIDENCE_KEY), undefined);
      assert.equal(db.isTransaction, false);
    }
    const result = await replayPrivacyJournalOnRestore({ env, fetchImpl });
    assert.deepEqual({ erased: result.erased, optedOut: result.optedOut, rejected: result.rejected }, { erased: 1, optedOut: 1, rejected: 0 });
    assert.equal(result.verificationVersion, 4);
    assert.equal(result.continuityVerified, true);
    assert.equal(result.storageIdentity, backupStorageIdentity(env));
    assert.equal(q.userById.get("u_journal_resurrected"), undefined, "the resurrected account is erased again");
    assertNewsAttribution(restoredNews, null);
    assert.equal(q.userById.get("u_journal_subscriber").marketing_opt_out, 1, "withdrawn consent stays withdrawn");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM privacy_journal_outbox").get().n, before, "replaying does not journal again");
    assert.deepEqual(result.snapshotAnchor, anchor, "replay keeps the original anchor in its evidence");
    assert.equal(readContinuity(db).sequence, sequence, "live decisions resume after the verified remote head");
    assert.equal(readContinuity(db).head, head);
    assert.equal(readContinuity(db).shippedHead, head);
    assert.deepEqual(await replayPrivacyJournalOnRestore({ env, fetchImpl }), { needed: false }, "the verified destination-bound receipt ends the restore requirement");
    const leavingAfterRestore = addUser("u_journal_post_restore_leaving");
    const subscriberAfterRestore = addUser("u_journal_post_restore_subscriber");
    const settings = routes["POST /api/me/email-preferences"];
    settings({ user: subscriberAfterRestore, ip: "post-restore-settings", body: { announcements: true } });
    await routes["DELETE /api/me"]({ user: leavingAfterRestore, ip: "post-restore-delete", body: { password: "journal-password" }, clearSession() {} });
    settings({ user: q.userById.get(subscriberAfterRestore.id), ip: "post-restore-settings", body: { announcements: false } });
    assert.deepEqual(await shipPrivacyJournal(db, { env, fetchImpl }), { shipped: 2, pending: 0, waiting: null });
    const resumedEvents = db.prepare("SELECT entry_json FROM privacy_journal_outbox WHERE subject_id IN (?,?) ORDER BY json_extract(entry_json,'$.sequence')")
      .all(leavingAfterRestore.id, subscriberAfterRestore.id).map(({ entry_json }) => JSON.parse(entry_json));
    assert.equal(resumedEvents[0].sequence, sequence + 1);
    assert.equal(resumedEvents[0].previous, head);
    assert.equal(resumedEvents[1].sequence, sequence + 2);
    assert.equal(JSON.parse(objects.get(COVERAGE_OBJECT)).head, privacyEntryHead(resumedEvents[1]));
  } finally {
    db.prepare("DELETE FROM app_meta WHERE key IN (?,?)").run(RESTORE_GATE_KEY, PRIVACY_REPLAY_EVIDENCE_KEY);
  }
});

test("privacy changes roll back when their durable journal append or continuity update fails", async () => {
  const leaving = addUser("u_journal_rollback_delete", "rollback-password");
  const leavingNews = seedNewsArtifacts(leaving.id);
  const subscriber = addUser("u_journal_rollback_consent");
  const settings = routes["POST /api/me/email-preferences"];
  settings({ user: subscriber, ip: "journal-rollback-settings", body: { announcements: true } });
  const continuity = readContinuity(db);
  for (const trigger of [
    "BEFORE INSERT ON privacy_journal_outbox",
    "BEFORE UPDATE ON app_meta WHEN NEW.key='privacy-journal:continuity:v1'",
  ]) {
    db.exec(`CREATE TRIGGER fail_privacy_journal_append ${trigger} BEGIN SELECT RAISE(ABORT,'synthetic journal failure'); END`);
    try {
      await assert.rejects(routes["DELETE /api/me"]({ user: leaving, ip: "journal-rollback-delete", body: { password: "rollback-password" }, clearSession() {} }));
      assert.ok(q.userById.get(leaving.id), "account erasure and journal append commit together or neither commits");
      assertNewsAttribution(leavingNews, leaving.id);
      assert.throws(() => settings({ user: q.userById.get(subscriber.id), ip: "journal-rollback-settings", body: { announcements: false } }));
      assert.equal(q.userById.get(subscriber.id).marketing_opt_out, 0, "withdrawal cannot succeed without its replay record");
      assert.deepEqual(outbox(leaving.id), []);
      assert.deepEqual(outbox(subscriber.id), []);
      assert.deepEqual(readContinuity(db), continuity, "failed durable appends cannot advance the stream sequence or head");
    } finally {
      db.exec("DROP TRIGGER fail_privacy_journal_append");
    }
  }
});
