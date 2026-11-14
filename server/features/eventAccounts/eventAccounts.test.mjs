import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const directory = mkdtempSync(join(tmpdir(), "pit-event-claims-")); process.env.PIT_DATA_DIR = directory;
const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("No external requests in event-account tests"); };
const { db, q } = await import("../../db.js"); const { routes } = await import("../../api.js");
after(() => { globalThis.fetch = realFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
const account = (role = "fan") => {
  const id = `event_account_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic", role, "Toronto", 0, 0, "EA", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id); return q.userById.get(id);
};
const context = (user, body = {}, extra = {}) => ({ user, body, query: {}, params: {}, ip: user?.id || "guest", ...extra });
const target = (kind = "festival") => {
  const id = `claim-target-${++sequence}`;
  if (kind === "festival") db.prepare("INSERT INTO festivals(slug,name,updated_at) VALUES (?,?,?)").run(id, `Fixture Festival ${sequence}`, Date.now());
  else db.prepare("INSERT INTO tour_dates(id,artist,venue,date,updated_at,music_qualified,music_evidence,provider_active,event_name) VALUES (?,'The Cure','Fixture Hall','2027-05-01',?,1,'ticketmaster:classification:music',1,'Fixture Event')").run(id, Date.now());
  return { kind, id };
};
const request = (user, item) => routes["POST /api/event-accounts/claims"](context(user, { ...item, note: "I manage this event. Verify through https://example.test/team." }));
const evidence = () => ({ reason: "Checked the official team contact and account authority.", reviewedUrl: "https://example.test/team", officialAccountConfirmed: true, ownershipConfirmed: true, expectedOwnerId: null });
const review = (admin, claim, action = "approve", body = evidence(), extra = {}) => routes[`POST /api/admin/event-claims/:id/${action}`](context(admin, body, { params: { id: claim.id }, ...extra }));
const fail = (run, status) => assert.throws(run, error => error.status === status);

test("event/festival requests grant nothing; reviewed approval converts role and permits shared composer", () => {
  for (const kind of ["event", "festival"]) {
    const member = account(), admin = account("admin"), item = target(kind), claim = request(member, item);
    assert.equal(request(member, item).id, claim.id);
    assert.equal(q.userById.get(member.id).role, "fan");
    assert.equal(db.prepare("SELECT 1 FROM creator_entities WHERE owner_id=?").get(member.id), undefined);
    db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)").run(`token-${member.id}`, member.id, Date.now(), Date.now() + 100000);
    fail(() => review(admin, claim, "approve", { ...evidence(), ownershipConfirmed: false }), 400);
    assert.deepEqual(review(admin, claim), { status: "approved" });
    assert.deepEqual(review(admin, claim), { status: "approved" });
    assert.equal(q.userById.get(member.id).role, "event");
    assert.equal(db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get(member.id), undefined);
    const page = routes["GET /api/event-accounts/target"](context(q.userById.get(member.id), {}, { query: item }));
    assert.equal(page.entity.entityKey, `${kind}:${item.id}`); assert.equal(page.canManage, true);
    const update = { version: 1, entityType: "event", entityKey: page.entity.entityKey, kind: "update", title: "Lineup announcement", date: "", location: "", url: "" };
    const posted = routes["POST /api/posts"](context(q.userById.get(member.id), { kind: "status", review: "", creatorUpdate: update, clientMutationId: `claim_post_${member.id}` }));
    assert.equal(posted.post.creatorUpdate.title, "Lineup announcement");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE action='approve_event_claim' AND target_id=?").get(member.id).count, 1);
  }
});

test("unknown pages, restricted applicants and spoofed or revoked reviewers fail closed", () => {
  const member = account(), item = target(), admin = account("admin");
  fail(() => request(member, { kind: "event", id: "missing" }), 404);
  for (const role of ["artist", "venue", "admin", "moderator", "editor"]) fail(() => request(account(role), item), 403);
  db.prepare("UPDATE users SET email_verified_at=0 WHERE id=?").run(member.id);
  fail(() => request(member, item), 403);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), member.id);
  const claim = request(member, item);
  fail(() => review({ ...account(), role: "admin" }, claim), 403);
  fail(() => review(account("moderator"), claim), 403);
  fail(() => review(admin, claim, "approve", evidence(), { assertCurrentSession() { db.prepare("UPDATE users SET role='fan' WHERE id=?").run(admin.id); } }), 403);
  assert.equal(q.userById.get(member.id).role, "fan");
  assert.equal(db.prepare("SELECT status FROM event_account_claims WHERE id=?").get(claim.id).status, "pending");
});

test("competing approvals cannot overwrite an owner; revocation cannot be replayed into authority", () => {
  const first = account(), second = account(), admin = account("admin"), item = target();
  const a = request(first, item), b = request(second, item);
  review(admin, a); fail(() => review(admin, b), 409);
  const key = `festival:${item.id}`;
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_key=?").get(key).owner_id, first.id);
  review(admin, a, "revoke", { reason: "Official ownership is no longer held by this account.", confirmed: true, expectedOwnerId: first.id });
  assert.equal(q.userById.get(first.id).role, "fan");
  fail(() => review(admin, a), 409);
  review(admin, b);
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_key=?").get(key).owner_id, second.id);
  assert.deepEqual(review(admin, a, "revoke", { reason: "Retry old revoke", confirmed: true, expectedOwnerId: first.id }), { status: "revoked" });
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_key=?").get(key).owner_id, second.id);
});

test("failed audit rolls back ownership, classification, claim state and sessions", () => {
  const member = account(), admin = account("admin"), claim = request(member, target());
  db.prepare("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)").run(`rollback-${member.id}`, member.id, Date.now(), Date.now() + 100000);
  db.exec("CREATE TRIGGER fail_event_claim_audit BEFORE INSERT ON moderation_actions WHEN NEW.action='approve_event_claim' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  try { assert.throws(() => review(admin, claim), /synthetic audit failure/); } finally { db.exec("DROP TRIGGER fail_event_claim_audit"); }
  assert.equal(q.userById.get(member.id).role, "fan");
  assert.equal(db.prepare("SELECT 1 FROM creator_entities WHERE owner_id=?").get(member.id), undefined);
  assert.equal(db.prepare("SELECT status FROM event_account_claims WHERE id=?").get(claim.id).status, "pending");
  assert.ok(db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get(member.id));
});

test("own claims export privately, delete with the account, and survive repeat schema and backup checks", async () => {
  const { ensureEventAccountSchema, exportEventClaims } = await import("./eventAccountSchema.js");
  const { backupSourceManifest } = await import("../../../scripts/backup-db-verification.mjs");
  const member = account(), other = account(), item = target(); const claim = request(member, item); request(other, item);
  ensureEventAccountSchema(db); ensureEventAccountSchema(db);
  assert.equal(exportEventClaims(db, member.id).length, 1);
  assert.equal(exportEventClaims(db, member.id)[0].id, claim.id);
  assert.ok(backupSourceManifest(db).event_account_claims.minimumRows >= 2);
  assert.equal(routes["GET /api/event-accounts/target"](context(null, {}, { query: item })).claim, null);
  const { hashPassword } = await import("../../auth.js");
  const password = "event-claim-export-password1";
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(password), member.id);
  const actor = q.userById.get(member.id);
  const exported = await routes["POST /api/me/export"](context(actor, { password }));
  assert.equal(exported.creatorAccount.eventClaims.length, 1);
  assert.equal(exported.creatorAccount.eventClaims[0].id, claim.id);
  await routes["DELETE /api/me"](context(actor, { password }));
  assert.equal(db.prepare("SELECT 1 FROM event_account_claims WHERE account_id=?").get(member.id), undefined);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

async function approvalWorker(admin, claim, name) {
  const { spawn } = await import("node:child_process"); const { fileURLToPath } = await import("node:url");
  const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
  const child = spawn(process.execPath, [fileURLToPath(new URL("./fixtures/eventClaimWorker.mjs", import.meta.url)), directory, admin.id, claim.id, name], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !["NODE_TEST_CONTEXT", "RESEND_API_KEY", "MAIL_FROM"].includes(key))),
  });
  let output = ""; for(const stream of [child.stdout, child.stderr]) stream.on("data", part => { output += part; });
  const ended = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(Error(`Event approval worker exited ${code}: ${output}`))); });
  void ended.catch(() => {});
  const timer = setTimeout(() => child.kill(), 35000);
  const wait = async suffix => {
    const deadline = Date.now() + 20000;
    while (!existsSync(join(directory, name + suffix))) { if(Date.now() > deadline) throw Error(`Event approval coordination timed out: ${name}${suffix}`); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  return { wait, go: () => writeFileSync(join(directory, name + "-go"), "go"), result: async () => { await ended; return JSON.parse(readFileSync(join(directory, name + "-result.json"), "utf8")); },
    stop: async () => { clearTimeout(timer); if(child.exitCode === null && child.signalCode === null) child.kill(); await ended.catch(() => {}); } };
}

test("independent contending approval connections grant an unclaimed page to exactly one account", { timeout: 45000 }, async () => {
  const first = account(), second = account(), admin = account("admin"), item = target();
  const a = request(first, item), b = request(second, item), workers = [];
  try {
    workers.push(await approvalWorker(admin, a, "race-a"), await approvalWorker(admin, b, "race-b"));
    await Promise.all(workers.map(worker => worker.wait("-ready")));
    db.exec("BEGIN IMMEDIATE"); workers.forEach(worker => worker.go());
    await Promise.all(workers.map(worker => worker.wait("-waiting"))); db.exec("COMMIT");
    const results = await Promise.all(workers.map(worker => worker.result()));
    assert.equal(results.filter(row => row.status === "approved").length, 1);
    assert.equal(results.filter(row => row.status === 409).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM event_account_claims WHERE entity_key=? AND status='approved'").get(`festival:${item.id}`).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM users WHERE id IN (?,?) AND role='event'").get(first.id, second.id).count, 1);
  } finally { if(db.isTransaction) db.exec("ROLLBACK"); await Promise.all(workers.map(worker => worker.stop())); }
});

test("reviewer demotion committed while approval waits for SQLite prevents the grant", { timeout: 45000 }, async () => {
  const member = account(), admin = account("admin"), claim = request(member, target());
  const worker = await approvalWorker(admin, claim, "demotion");
  try {
    await worker.wait("-ready"); db.exec("BEGIN IMMEDIATE"); worker.go(); await worker.wait("-waiting");
    db.prepare("UPDATE users SET role='fan' WHERE id=?").run(admin.id); db.exec("COMMIT");
    const result = await worker.result(); assert.equal(result.status, 401);
    assert.equal(q.userById.get(member.id).role, "fan");
    assert.equal(db.prepare("SELECT status FROM event_account_claims WHERE id=?").get(claim.id).status, "pending");
  } finally { if(db.isTransaction) db.exec("ROLLBACK"); await worker.stop(); }
});

test("revoking one page retains the event classification and access to other owned pages", () => {
  const member = account(), admin = account("admin"), first = target(), second = target();
  const a = request(member, first); review(admin, a);
  const b = request(q.userById.get(member.id), second); review(admin, b);
  db.prepare("UPDATE creator_entities SET status='held' WHERE entity_key=?").run(`festival:${second.id}`);
  review(admin, a, "revoke", { reason: "Ownership for only the first page ended.", expectedOwnerId: member.id, confirmed: true });
  assert.equal(q.userById.get(member.id).role, "event");
  db.prepare("UPDATE creator_entities SET status='active' WHERE entity_key=?").run(`festival:${second.id}`);
  const page = routes["GET /api/event-accounts/target"](context(q.userById.get(member.id), {}, { query: second }));
  assert.equal(page.canManage, true);
});

test("revocation preserves held and removed moderation restrictions on that page", () => {
  for (const status of ["held", "removed"]) {
    const member = account(), admin = account("admin"), item = target(), claim = request(member, item);
    review(admin, claim);
    db.prepare("UPDATE creator_entities SET status=? WHERE entity_key=?").run(status, `festival:${item.id}`);
    review(admin, claim, "revoke", { reason: "Remove ownership while preserving the existing moderation restriction.", confirmed: true, expectedOwnerId: member.id });
    const stored = db.prepare("SELECT owner_id,status FROM creator_entities WHERE entity_key=?").get(`festival:${item.id}`);
    assert.equal(stored.owner_id, null); assert.equal(stored.status, status);
    fail(() => request(account(), item), 409);
  }
});

test("staff pagination reaches every pending request and old approved owner without mixing statuses", () => {
  const admin = account("admin"), member = account("event");
  const insert = db.prepare("INSERT INTO event_account_claims(id,account_id,target_kind,target_id,entity_key,note,status,created_at) VALUES (?,?,'festival',?,?,?, ?,?)");
  const expected = new Set();
  for(let i=0;i<127;i++) {
    const id = `page-fixture-${i}`, slug = `page-festival-${i}`; expected.add(id);
    insert.run(id, member.id, slug, `festival:${slug}`, "Existing reviewed event account.", "approved", 100 + i);
    db.prepare("INSERT INTO festivals(slug,name,updated_at) VALUES (?,?,1)").run(slug, slug);
    db.prepare("INSERT INTO creator_entities(entity_type,entity_key,name,owner_id,status) VALUES ('event',?,?,?,'active')").run(`festival:${slug}`, slug, member.id);
  }
  const found = new Set(); let cursor = null, pages = 0;
  do {
    const page = routes["GET /api/admin/event-claims"](context(admin, {}, { query: { status: "approved", limit: "40", ...(cursor ? { before: cursor } : {}) } }));
    assert.ok(page.claims.length <= 40); assert.ok(page.claims.every(row => row.status === "approved"));
    page.claims.forEach(row => { assert.equal(found.has(row.id), false); found.add(row.id); }); cursor = page.nextCursor; pages++;
    assert.ok(pages < 10);
  } while(cursor);
  assert.ok(pages >= 4); for(const id of expected) assert.ok(found.has(id));
  review(admin, { id: "page-fixture-0" }, "revoke", { reason: "Revoke the oldest approved page after finding it through pagination.", confirmed: true, expectedOwnerId: member.id });
  assert.equal(db.prepare("SELECT owner_id FROM creator_entities WHERE entity_key='festival:page-festival-0'").get().owner_id, null);
  const pending = routes["GET /api/admin/event-claims"](context(admin)); assert.ok(pending.claims.every(row => row.status === "pending"));
  fail(() => routes["GET /api/admin/event-claims"](context(account())), 403);
  fail(() => routes["GET /api/admin/event-claims"](context(admin, {}, { query: { status: "any" } })), 400);
});

test("approval never converts an applicant who acquired another account classification while waiting", () => {
  const admin = account("admin");
  for(const role of ["artist", "venue", "moderator", "admin", "editor"]) {
    const member = account(), item = target(), claim = request(member, item);
    db.prepare("UPDATE users SET role=? WHERE id=?").run(role, member.id);
    fail(() => review(admin, claim), 409);
    assert.equal(q.userById.get(member.id).role, role);
    assert.equal(db.prepare("SELECT 1 FROM creator_entities WHERE entity_key=?").get(`festival:${item.id}`), undefined);
  }
});

test("claim target identifiers retain the established public event and festival URL limits", () => {
  const item = target("event"), id = "canonical-event-" + "x".repeat(160);
  db.prepare("UPDATE tour_dates SET id=? WHERE id=?").run(id, item.id);
  const page = routes["GET /api/event-accounts/target"](context(null, {}, { query: { kind: "event", id } }));
  assert.equal(page.entity.entityKey, `event:${id}`);
  fail(() => routes["GET /api/event-accounts/target"](context(null, {}, { query: { kind: "event", id: "x".repeat(181) } })), 400);
  fail(() => routes["GET /api/event-accounts/target"](context(null, {}, { query: { kind: "festival", id: "not/a/public-slug" } })), 400);
  fail(() => routes["GET /api/event-accounts/target"](context(null, {}, { query: { kind: "event", id: "artist|venue|2027-01-01" } })), 404);
});
