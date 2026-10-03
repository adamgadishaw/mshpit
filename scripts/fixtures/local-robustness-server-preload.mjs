// Explicit local-test preload. Metadata and barriers use parent IPC only.
import assert from "node:assert/strict";
import { basename, dirname, resolve } from "node:path";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import childProcess from "node:child_process";
import workerThreads from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";

const directory = realpathSync(process.env.PIT_DATA_DIR || ".");
assert.equal(process.env.PIT_LOCAL_ROBUSTNESS_FIXTURE, "1");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(directory.toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.equal(dirname(directory).toLowerCase(), realpathSync(process.env.PIT_ROBUSTNESS_TEMP_PARENT).toLowerCase());
assert.ok(basename(directory).startsWith("pit-local-robustness-"));
assert.equal(typeof process.send, "function", "Synthetic fixtures require parent IPC.");
assert.equal(resolve(directory).toLowerCase(), resolve(process.env.PIT_DATA_DIR).toLowerCase());

// Install every transport guard before importing application modules, including
// the database. No mail/provider mock is allowed to send actual traffic.
const denied = () => { process.send?.({ kind: "outbound-blocked" }); throw new Error("Fixture outbound network disabled"); };
// Descendants can discard execArgv/env guards (the optional sitemap builder
// does). Keep this two-file harness owned by one server PID; no unguarded helper.
const deniedHelper = () => { process.send?.({ kind: "helper-blocked" }); throw new Error("Fixture helper processes disabled"); };
for (const key of ["spawn", "spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"]) childProcess[key] = deniedHelper;
workerThreads.Worker = class DisabledFixtureWorker { constructor() { deniedHelper(); } };
globalThis.fetch = async () => denied();
http.request = http.get = https.request = https.get = http2.connect = denied;
net.connect = net.createConnection = tls.connect = dgram.createSocket = denied;
net.Socket.prototype.connect = denied;
dgram.Socket.prototype.send = dgram.Socket.prototype.connect = denied;
const numericLookup = dns.lookup;
for (const key of Object.keys(dns)) {
  if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === "function") dns[key] = denied;
}
// net.Server.listen calls lookup even for a numeric bind address. Node's
// literal-address fast path performs no resolver/network operation.
dns.lookup = function loopbackLiteralLookup(host, ...args) {
  if (host !== "127.0.0.1") return denied();
  return numericLookup.call(this, host, ...args);
};
for (const key of Object.keys(dns.promises)) {
  if (/^(lookup|resolve|reverse)/.test(key) && typeof dns.promises[key] === "function") dns.promises[key] = async () => denied();
}
for (const Resolver of [dns.Resolver, dns.promises.Resolver]) {
  for (const key of Object.getOwnPropertyNames(Resolver.prototype)) {
    if (/^(resolve|reverse)/.test(key) && typeof Resolver.prototype[key] === "function") Resolver.prototype[key] = denied;
  }
}
const listen = net.Server.prototype.listen;
let observeContendedWrite = false;
net.Server.prototype.listen = function loopbackOnly(port) {
  assert.equal(arguments.length, 1);
  assert.equal(port, Number(process.env.PORT));
  this.prependListener("request", req => {
    if (req.method === "POST" && req.url === "/api/posts/robust_post/comments"
      && req.headers["x-local-robustness-barrier"] === "sqlite-lock") {
      observeContendedWrite = true;
    }
  });
  this.once("listening", () => process.send({ kind: "listener-bound", address: this.address().address }));
  return listen.call(this, { port, host: "127.0.0.1" });
};
syncBuiltinESMExports();

const { db, q } = await import("../../server/db.js");
// Observe, without replacing, the native SQLite call that can wait on the
// parent's writer lock. The parent releases only after this private signal.
const markWrite = () => {
  if (!observeContendedWrite) return;
  observeContendedWrite = false;
  process.send({ kind: "lock-write-attempt" });
};
const exec = db.exec;
db.exec = function observedExec(sql) {
  if (/^\s*(?:BEGIN\s+IMMEDIATE|INSERT|UPDATE|DELETE)/i.test(sql)) markWrite();
  return exec.call(this, sql);
};
const statementPrototype = Object.getPrototypeOf(db.prepare("SELECT 1"));
const run = statementPrototype.run;
statementPrototype.run = function observedRun(...args) { markWrite(); return run.apply(this, args); };
const { hashPassword, createSession, COOKIE } = await import("../../server/auth.js");
const { LEGAL_ACCEPTANCE_VERSION } = await import("../../src/domain/privacyDisclosures.mjs");
const { createBackgroundJobCoordinator } = await import("../../server/backgroundJobCoordinator.js");
const passHash = hashPassword("Synthetic-local-robustness-password1");
const members = ["alice", "bob"].map(name => ({ id: `robust_${name}`, handle: `robust${name}` }));
for (const member of members) {
  q.insertUser.run(member.id, `${member.handle}@example.test`, `Synthetic ${member.handle}`, member.handle,
    passHash, "fan", "Toronto", 43.65, -79.38, "RF", "#654321", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,onboarding_version=1,age_band='18_plus',extras=? WHERE id=?")
    .run(Date.now(), JSON.stringify({ termsAcceptedAt: Date.now(), termsVersion: LEGAL_ACCEPTANCE_VERSION,
      analyticsOptOut: true }), member.id);
}
db.prepare(`INSERT INTO artists (norm,name,public_slug,search_key,genre,bio,data,source,created_at,updated_at)
  VALUES ('robustness-fixture','Robustness Fixture','robustness-fixture','robustnessfixture','Rock',
    'Synthetic local concert artist.','{}','test',1,1)`).run();
db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,review,created_at)
  VALUES ('robust_post',?,'Robustness Fixture','Synthetic Room','Toronto','2026-01-01',4,
    'Synthetic local concert memory.',?)`).run(members[1].id, Date.now());

let queueProbe;
const inspect = () => ({
  likes: members.map(member => db.prepare("SELECT COUNT(*) n FROM likes WHERE post_id='robust_post' AND user_id=?").get(member.id).n),
  comments: members.map(member => db.prepare("SELECT COUNT(*) n FROM comments WHERE post_id='robust_post' AND user_id=?").get(member.id).n),
  activeComments: db.prepare("SELECT COUNT(*) n FROM comments WHERE post_id='robust_post' AND removed=0").get().n,
  integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
  foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
  busyTimeoutMs: db.prepare("PRAGMA busy_timeout").get().timeout,
});
async function command(action) {
  if (action === "inspect") return inspect();
  if (action === "queue-start") {
    assert.equal(queueProbe, undefined);
    let release;
    const gate = new Promise(done => { release = done; });
    const stats = { active: 0, maxActive: 0, acquired: 0, released: 0, order: [] };
    // Exercise the actual coordinator with its default maxPending=32. A private
    // lease isolates this deterministic queue check from host memory pressure.
    const run = createBackgroundJobCoordinator({ acquireMemoryLease: () => {
      stats.acquired++;
      return { release: () => { stats.released++; } };
    } });
    const jobs = Array.from({ length: 34 }, (_, index) => run(async () => {
      stats.active++; stats.maxActive = Math.max(stats.maxActive, stats.active);
      stats.order.push(index);
      try {
        if (index === 0) await gate;
        await new Promise(done => setImmediate(done));
        if (index === 5) throw new Error("Synthetic queued failure");
        return index;
      } finally { stats.active--; }
    }).then(() => "ok", error => error.code === "MEMORY_PRESSURE" ? "capacity" : "job-failed"));
    queueProbe = { release, stats, run, jobs };
    await new Promise(done => setImmediate(done));
    return { active: stats.active, started: stats.order.length,
      rejected: await Promise.all(jobs.slice(32)), submitted: jobs.length };
  }
  if (action === "queue-release") {
    assert.ok(queueProbe);
    queueProbe.release();
    const outcomes = await Promise.all(queueProbe.jobs);
    const recovered = await queueProbe.run(() => "recovered");
    return { ...queueProbe.stats, outcomes, recovered };
  }
  throw new Error("Unknown fixture command");
}
process.on("message", async message => {
  if (message?.kind !== "command" || !Number.isSafeInteger(message.id)) return;
  try { process.send({ kind: "reply", id: message.id, value: await command(message.action) }); }
  catch { process.send({ kind: "reply", id: message.id, failed: true }); }
});
process.send({ kind: "fixture", members: members.map(member => ({ ...member,
  cookie: `${COOKIE}=${createSession(member.id).token}` })), postId: "robust_post" });
