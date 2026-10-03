// Local synthetic fixture only. Never imported by application startup.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
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
const sourceRoot = realpathSync(process.env.PIT_CLIPS_SERVER_ROOT || ".");
assert.equal(process.env.PIT_CLIPS_BROWSER_FIXTURE, "1");
assert.equal(process.env.NODE_ENV, "test");
assert.equal(typeof process.send, "function");
assert.equal(directory.toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.equal(dirname(directory).toLowerCase(), realpathSync(process.env.PIT_CLIPS_TEMP_PARENT).toLowerCase());
assert.ok(basename(directory).startsWith("pit-clips-browser-"));
const denied = () => { process.send({ kind: "outbound-blocked" }); throw new Error("Fixture outbound disabled"); };
const deniedHelper = () => { process.send({ kind: "helper-blocked" }); throw new Error("Fixture nested helpers disabled"); };
for (const key of ["spawn", "spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"]) childProcess[key] = deniedHelper;
childProcess.ChildProcess.prototype.spawn = deniedHelper;
workerThreads.Worker = class DisabledFixtureWorker { constructor() { deniedHelper(); } };
globalThis.fetch = async () => denied();
http.request = http.get = https.request = https.get = http2.connect = denied;
net.connect = net.createConnection = tls.connect = dgram.createSocket = denied;
net.Socket.prototype.connect = denied;
dgram.Socket.prototype.send = dgram.Socket.prototype.connect = denied;
const numericLookup = dns.lookup;
for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns[key] === "function") dns[key] = denied;
dns.lookup = function literalLoopback(host, ...args) {
  if (host !== "127.0.0.1") return denied();
  return numericLookup.call(this, host, ...args);
};
for (const key of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(key) && typeof dns.promises[key] === "function") dns.promises[key] = async () => denied();
for (const Resolver of [dns.Resolver, dns.promises.Resolver]) {
  for (const key of Object.getOwnPropertyNames(Resolver.prototype)) {
    if (/^(resolve|reverse)/.test(key) && typeof Resolver.prototype[key] === "function") Resolver.prototype[key] = denied;
  }
}

let armed = false, held = null, abortedHeld = 0, clipRequests = 0;
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function loopbackOnly(port) {
  assert.equal(arguments.length, 1); assert.equal(port, Number(process.env.PORT));
  this.prependListener("request", (req, res) => {
    if (req.method !== "GET" || new URL(req.url, "http://fixture.invalid").pathname !== "/api/clips") return;
    clipRequests++;
    if (!armed) return;
    armed = false;
    const end = res.end;
    // The genuine route computes the genuine response. Hold just its last
    // bytes, using parent IPC, to exercise the existing screen's AbortSignal.
    res.end = function heldEnd(...args) {
      assert.equal(held, null);
      const entry = { res, end, args, timer: null };
      held = entry;
      entry.timer = setTimeout(() => releaseHeld(), 15_000);
      process.send({ kind: "clips-response-held", status: res.statusCode });
      res.once("close", () => {
        if (!res.writableEnded) { abortedHeld++; process.send({ kind: "clips-response-aborted" }); }
      });
      return res;
    };
  });
  this.once("listening", () => process.send({ kind: "listener-bound", address: this.address().address }));
  return listen.call(this, { host: "127.0.0.1", port });
};
function releaseHeld() {
  const entry = held; held = null;
  if (!entry) return;
  clearTimeout(entry.timer);
  if (!entry.res.destroyed) entry.end.apply(entry.res, entry.args);
}
syncBuiltinESMExports();
const imported = path => import(pathToFileURL(join(sourceRoot, path)).href);
const { db, q } = await imported("server/db.js");
const { COOKIE, createSession, hashPassword } = await imported("server/auth.js");
const { LEGAL_ACCEPTANCE_VERSION } = await imported("src/domain/privacyDisclosures.mjs");
const passHash = hashPassword("Synthetic-clips-browser-password1");
const members = ["viewer", "owner", "hidden"].map(name => ({ id: `clips_${name}`, handle: `clips${name}` }));
for (const member of members) {
  q.insertUser.run(member.id, `${member.handle}@example.test`, `Synthetic ${member.handle}`, member.handle,
    passHash, "fan", "Toronto", 43.65, -79.38, "CF", "#654321", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,onboarding_version=1,age_band='18_plus',extras=? WHERE id=?")
    .run(Date.now(), JSON.stringify({ termsAcceptedAt: Date.now(), termsVersion: LEGAL_ACCEPTANCE_VERSION, analyticsOptOut: true }), member.id);
}
const mediaOrigin = "https://clips-fixture.invalid";
const baseTime = 1_760_000_000_000;
const expected = [];
function seedPost(id, owner, at, photos, photosPublic = 1) {
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,'Synthetic Room','Toronto','2025-01-01',4,?,?,?,?)`)
    .run(id, owner, `Synthetic ${id}`, `Synthetic concert memory ${id}.`, JSON.stringify(photos), photosPublic, at);
}
function seedClip(sequence, { owner = members[1].id, photosPublic = 1, at = baseTime - Math.floor(sequence / 2) * 100 } = {}) {
  const id = `clip_${String(sequence).padStart(3, "0")}`, assetId = `asset_${id}`;
  const sourceKey = `users/${owner}/post/${id}.webm`, posterKey = `users/${owner}/post/${id}.png`;
  const clipUrl = `${mediaOrigin}/${id}.webm`, posterUrl = `${mediaOrigin}/${id}.png`, posterId = `poster_${id}`;
  seedPost(id, owner, at, [clipUrl], photosPublic);
  for (const key of [sourceKey, posterKey]) db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?,'post',4096,'associated',?,?,?)`).run(key, owner, at, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,original_name,mime_type,byte_size,
     width,height,duration_ms,metadata_status,codec_status,codec_verified_at,status,edit_recipe,finalize_hash,source_verified_at,
     render_state,poster_variant_id,poster_key,poster_url,poster_time_ms,created_at,updated_at)
    VALUES (?,?,?,'fixture','post','video',?,?,?,'video/webm',4096,320,180,2000,'declared','verified',?,'ready',
      '{}','fixture',?,'not_required',?,?,?,0,?,?)`)
    .run(assetId, owner, `client_${id}`, sourceKey, clipUrl, `${id}.webm`, at, at, posterId, posterKey, posterUrl, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,time_ms,status,
     verification_origin,finalize_hash,verified_at,created_at,updated_at)
    VALUES (?,?,?,'fixture','poster',?,?,'image/png',100,320,180,0,'verified','private_derivative_v1','fixture',?,?,?)`)
    .run(posterId, assetId, `variant_${id}`, posterKey, posterUrl, at, at, at);
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)").run(id, assetId, at);
  return { id, at, assetId, clipUrl };
}
db.exec("BEGIN IMMEDIATE");
try {
  for (let index = 0; index < 26; index++) expected.push(seedClip(index));
  // Long gaps of raw false positives must not become empty public pages.
  for (let index = 0; index < 70; index++) seedPost(`bait_${index}`, members[1].id,
    baseTime + index, [`${mediaOrigin}/photo.png?campaign=.mp4-bait-${index}`]);
  seedClip(90, { photosPublic: 0, at: baseTime + 1000 });
  seedClip(91, { owner: members[2].id, at: baseTime + 1100 });
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(members[2].id);
  seedClip(92, { at: baseTime + 1200 });
  db.prepare("UPDATE media_assets SET status='render_unavailable' WHERE id='asset_clip_092'").run();
  db.exec("COMMIT");
} catch (error) { db.exec("ROLLBACK"); throw error; }
expected.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
process.on("message", message => {
  if (message?.kind !== "command" || !Number.isSafeInteger(message.id)) return;
  try {
    let value;
    if (message.action === "hold-next-clips") { assert.equal(held, null); assert.equal(armed, false); armed = true; value = { armed: true }; }
    else if (message.action === "release-clips") { armed = false; releaseHeld(); value = { released: true, abortedHeld }; }
    else if (message.action === "disconnect-clips") {
      assert.ok(held); const entry = held; held = null; clearTimeout(entry.timer);
      // An unseen-header GET disconnect can be retried transparently by the
      // browser. Begin the genuine response, then interrupt its body, so the
      // unchanged client sees the failure and exposes its existing retry.
      const body = entry.args[0];
      assert.ok(Buffer.isBuffer(body) || typeof body === "string");
      assert.ok(body.length > 1);
      entry.res.flushHeaders();
      entry.res.write(body.subarray ? body.subarray(0, 1) : body.slice(0, 1), () => {
        setTimeout(() => entry.res.destroy(), 75);
      });
      value = { interruptionScheduled: true };
    }
    else if (message.action === "media-unavailable") { db.prepare("UPDATE media_assets SET status='render_unavailable' WHERE id='asset_clip_002'").run(); value = { updated: true }; }
    else if (message.action === "media-ready") { db.prepare("UPDATE media_assets SET status='ready' WHERE id='asset_clip_002'").run(); value = { updated: true }; }
    else if (message.action === "inspect") value = { clipRequests, held: Boolean(held), abortedHeld,
      integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
      foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length };
    else throw new Error("Unknown private fixture command");
    process.send({ kind: "reply", id: message.id, value });
  } catch { process.send({ kind: "reply", id: message.id, failed: true }); }
});
process.send({ kind: "fixture", mediaOrigin, expected: expected.map(row => row.id),
  members: members.map(member => ({ ...member, cookie: `${COOKIE}=${createSession(member.id).token}` })), cookieName: COOKIE });
