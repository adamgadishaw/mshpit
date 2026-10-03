import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { AT, AUTH, TOKEN, proposalInput } from "./catalogApiFixture.mjs";
import { CATALOG_SCOPES } from "./catalogApiPolicy.js";
import { secretHash } from "../mediaApi/mediaApiPolicy.js";
import { ownerIdentity, storeOwnerIdentity } from "../../ownerIdentity.js";
import { createCatalogPilotClient } from "../../../scripts/catalog-api-pilot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATA_DIR = mkdtempSync(join(tmpdir(), "pit-catalog-http-"));
const ENV = { ...process.env, NODE_ENV: "test", PIT_ENV: "production", PIT_DATA_DIR: DATA_DIR,
  PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" };
for (const key of Object.keys(ENV)) {
  if (/_ENABLED$/u.test(key)) ENV[key] = "false";
  if (/(?:API_KEY|PASSWORD|TOKEN|SECRET|CREDENTIAL)/u.test(key)) delete ENV[key];
}
Object.assign(process.env, ENV);
const { db, q } = await import("../../db.js");
after(() => { db.close(); rmSync(DATA_DIR, { recursive: true, force: true }); });
function user(id, role) {
  q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unused-hash", role, "Toronto", 43, -79, "X", "#000000", AT);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(AT - 1, id);
  const token = `synthetic_catalog_http_session_${id}`;
  q.insertSession.run(secretHash(token), id, AT - 1, AT + 86_400_000, "", "");
  return `pit_session=${token}`;
}
const OWNER_COOKIE = user("catalog_owner", "admin"), FAN_COOKIE = user("catalog_fan", "fan");
storeOwnerIdentity(db, ownerIdentity("catalog_owner@example.test", "catalog_owner", AT - 1));
db.prepare(`INSERT INTO api_grants(id,audience,owner_id,actor_type,actor_label,scopes,token_hash,status,issued_at,expires_at)
  VALUES ('http-grant','pit-catalog-v1','catalog_owner','assistant','Synthetic dot',?,?,'active',?,?)`)
  .run(JSON.stringify(CATALOG_SCOPES), secretHash(TOKEN), AT - 1, AT + 86_400_000);
db.prepare("INSERT INTO catalog_grant_limits(grant_id,entities_json,commit_limit) VALUES ('http-grant',?,6)")
  .run(JSON.stringify([{ type: "artist", key: "synthetic wet leg" }]));
db.prepare("INSERT INTO artists(norm,name,source,created_at,updated_at) VALUES ('synthetic wet leg','Synthetic Wet Leg','musicbrainz',?,?)").run(AT, AT);

async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function start(t, enabled = true) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    Date.now = () => ${AT};
    let outbound = 0;
    globalThis.fetch = async () => { outbound++; throw new Error("outbound network disabled"); };
    process.on("message", () => process.send({ outbound }));
    await import("./server/index.js");
  `], { cwd: ROOT, env: { ...ENV, NODE_ENV: "development", PORT: String(port), RENDER: "true",
    PIT_CATALOG_API_ENABLED: String(enabled), PIT_CATALOG_API_COMMIT_ENABLED: String(enabled) }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const exited = new Promise(resolve => child.once("exit", resolve));
  t.after(async () => { child.kill(); await exited; });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP startup failed: ${output.slice(-1200)}`)), 20_000);
    const read = chunk => { output += chunk; if (output.includes(`up on http://localhost:${port}`)) { clearTimeout(timer); resolve(); } };
    child.stdout.on("data", read); child.stderr.on("data", read);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`HTTP fixture exited: ${output.slice(-1200)}`)); });
  });
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async request(path, { method = "GET", body, key = "http-idempotency-key", authorization = AUTH, cookie, origin } = {}) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: {
        "content-type": "application/json", authorization, "idempotency-key": key, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}),
      }, ...(body == null ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    async outbound() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Fixture command timed out")), 3000);
        child.once("message", result => { clearTimeout(timer); resolve(result.outbound); }); child.send({});
      });
    },
  };
}
const entityPath = "/api/catalog/v1/artist/entities/synthetic%20wet%20leg";
test("actual HTTP is disabled before auth and exposes no catalog work", async t => {
  const http = await start(t, false);
  for (const [path, method] of [[entityPath, "GET"], [`${entityPath}/claim`, "POST"],
    ["/api/moderation/catalog-work/control", "POST"], ["/api/catalog/v1/artist/inventory", "GET"]]) {
    const result = await http.request(path, { method, authorization: "", ...(method === "POST" ? { body: {} } : {}) });
    assert.equal(result.status, 404);
  }
  assert.equal(await http.outbound(), 0);
});

test("real HTTP headers, two competing processes, owner review, commit replay and revocation", async t => {
  const first = await start(t), second = await start(t);
  assert.equal((await first.request(entityPath, { authorization: "", cookie: OWNER_COOKIE })).status, 401);
  assert.equal((await first.request(entityPath, { authorization: AUTH.toLowerCase() })).status, 401);
  const read = await first.request(entityPath, { cookie: FAN_COOKIE });
  assert.equal(read.status, 200); assert.equal(read.body.identity.name, "Synthetic Wet Leg");
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  const body = { revision: read.body.revision, valueHash: read.body.valueHash, identityHash: read.body.identityHash };
  assert.equal((await first.request(`${entityPath}/claim`, { method: "POST", body, key: "" })).status, 400);
  const raced = await Promise.all([first, second].map((server, i) => server.request(`${entityPath}/claim`,
    { method: "POST", body, key: `http-claim-key-${i}`, cookie: i ? FAN_COOKIE : undefined })));
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
  const lease = raced.find(r => r.status === 200).body;
  const submitted = proposalInput(); submitted.patch.summary = `Synthetic ${submitted.patch.summary}`;
  const proposed = await first.request(`${entityPath}/propose`, { method: "POST", key: "http-propose-key",
    body: { nonce: lease.nonce, ...submitted } });
  assert.equal(proposed.status, 200); const proposal = proposed.body;
  const commitBody = { nonce: lease.nonce, proposalId: proposal.id, payloadHash: proposal.payloadHash };
  assert.equal((await first.request(`${entityPath}/commit`, { method: "POST", body: commitBody })).status, 409);
  const reviewPath = `/api/moderation/catalog-proposals/${proposal.id}/review`;
  assert.equal((await first.request(reviewPath, { method: "POST", body: { approved: true, payloadHash: proposal.payloadHash } })).status, 401);
  assert.equal((await first.request(reviewPath, { method: "POST", cookie: FAN_COOKIE,
    body: { approved: true, payloadHash: proposal.payloadHash } })).status, 403);
  const detail = await first.request(`/api/moderation/catalog-proposals/${proposal.id}`, { cookie: OWNER_COOKIE });
  assert.equal(detail.status, 200); assert.equal(detail.body.evidence[0].verification, "submitted");
  assert.equal((await first.request(reviewPath, { method: "POST", cookie: OWNER_COOKIE,
    body: { approved: true, payloadHash: proposal.payloadHash } })).status, 200);
  const committed = await first.request(`${entityPath}/commit`, { method: "POST", body: commitBody });
  assert.equal(committed.status, 200); assert.equal(committed.body.revision, 1);
  const replay = await second.request(`${entityPath}/commit`, { method: "POST", body: commitBody });
  assert.equal(replay.status, 200); assert.deepEqual(replay.body.proposal, committed.body.proposal);
  assert.equal(replay.body.revision, committed.body.revision);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_work_audit WHERE action='committed'").get().n, 1);
  assert.equal((await first.request("/api/moderation/catalog-grants/http-grant", { method: "DELETE", cookie: OWNER_COOKIE })).status, 200);
  assert.equal((await second.request(`${entityPath}/commit`, { method: "POST", body: commitBody })).status, 401);
  assert.equal(await first.outbound(), 0); assert.equal(await second.outbound(), 0);
});

test("public event and venue research share the origin projection ceiling", async t => {
  const http = await start(t);
  const paths = ["/api/events/synthetic-missing/research", "/api/venues/synthetic-missing/research"];
  for (let index = 0; index < 30; index++) {
    const result = await http.request(paths[index % 2], { authorization: "" });
    assert.equal(result.status, 200); assert.equal(result.body.research, null);
  }
  for (const path of paths) assert.equal((await http.request(path, { authorization: "" })).status, 429);
  assert.equal(await http.outbound(), 0);
});

test("supervised HTTPS client runs over actual loopback HTTP with lost-response replay, public display and correction", async t => {
  const key = "synthetic pilot artist", type = "artist";
  db.prepare("INSERT INTO artists(norm,name,source,created_at,updated_at) VALUES (?,?,'musicbrainz',?,?)")
    .run(key, "Synthetic Pilot Artist", AT, AT);
  const http = await start(t);
  const owner = (path, options = {}) => http.request(path, { cookie: OWNER_COOKIE, authorization: "", ...options });
  const pairingInput = { actorLabel: "Synthetic supervised client", entities: [{ type, key }],
    scopes: ["catalog:artist:read", "catalog:artist:propose", "catalog:artist:commit"], commitLimit: 1 };
  assert.equal((await owner("/api/moderation/catalog-grants/pairing", {
    method: "POST", origin: "https://foreign.example.test", body: pairingInput })).status, 403);
  const pairing = await owner("/api/moderation/catalog-grants/pairing", { method: "POST", body: pairingInput });
  assert.equal(pairing.status, 200);
  let dropCommitResponse = false;
  const client = createCatalogPilotClient({ baseUrl: http.baseUrl, allowLoopback: true, fetchImpl: async (url, options) => {
    const response = await fetch(url, options);
    if (dropCommitResponse && url.pathname.endsWith("/commit")) {
      dropCommitResponse = false; await response.arrayBuffer(); throw new Error("Synthetic interrupted response");
    }
    return response;
  } });
  t.after(() => client.close());
  const grant = await client.pair(pairing.body.pairingCode);
  assert.equal(grant.accessToken, undefined); assert.equal(grant.commitLimit, 1);
  const repeated = createCatalogPilotClient({ baseUrl: http.baseUrl, allowLoopback: true });
  await assert.rejects(() => repeated.pair(pairing.body.pairingCode), { status: 401 });
  assert.equal((await client.execute({ operation: "inventory", type })).items.length, 1);
  await assert.rejects(() => client.execute({ operation: "read", type, key: "synthetic wet leg" }), { status: 403 });
  const read = await client.execute({ operation: "read", type, key });
  const run = (operation, body, idempotencyKey) => client.execute({ operation, type, key, body, idempotencyKey, confirmWrite: true });
  const lease = await run("claim", { revision: read.revision, identityHash: read.identityHash, valueHash: read.valueHash }, "pilot-claim-0001");
  const submitted = proposalInput(); submitted.patch.summary = "Synthetic Pilot Artist has this deliberately synthetic sourced description for an isolated integration check.";
  const proposal = await run("propose", { nonce: lease.nonce, ...submitted }, "pilot-propose-0001");
  const commit = { nonce: lease.nonce, proposalId: proposal.id, payloadHash: proposal.payloadHash };
  await assert.rejects(() => run("commit", commit, "pilot-commit-0001"), { status: 409 });
  assert.equal((await owner(`/api/moderation/catalog-proposals/${proposal.id}/review`, { method: "POST",
    body: { approved: true, payloadHash: proposal.payloadHash } })).status, 200);
  dropCommitResponse = true;
  await assert.rejects(() => run("commit", commit, "pilot-commit-0001"), /interrupted response/u);
  const replay = await run("commit", commit, "pilot-commit-0001");
  assert.equal(replay.revision, 1);
  assert.equal((await client.execute({ operation: "status", type })).grant.commits, 1);
  const publicPath = `/api/artists/${encodeURIComponent(key)}/research`;
  const published = await http.request(publicPath, { authorization: "" });
  assert.equal(published.status, 200); assert.equal(published.body.research.summary, submitted.patch.summary);
  assert.equal(published.headers.get("cache-control"), "private, no-store");
  const ownerPath = `/api/moderation/catalog-entities/${type}/${encodeURIComponent(key)}`;
  const current = (await owner(ownerPath)).body;
  const expected = { revision: current.revision, valueHash: current.valueHash, identityHash: current.identityHash };
  assert.equal((await owner(`${ownerPath}/correct`, { method: "POST", body: { ...expected, action: "hide" } })).status, 200);
  assert.equal((await http.request(publicPath, { authorization: "" })).body.research, null);
  assert.equal((await owner(`${ownerPath}/correct`, { method: "POST", body: { ...expected, action: "restore", changeId: proposal.id } })).status, 409);
  const hidden = (await owner(ownerPath)).body;
  assert.equal((await owner(`${ownerPath}/correct`, { method: "POST", body: { action: "restore", changeId: proposal.id,
    revision: hidden.revision, valueHash: hidden.valueHash, identityHash: hidden.identityHash } })).status, 200);
  assert.equal((await http.request(publicPath, { authorization: "" })).body.research, null);
  assert.equal((await owner(`/api/moderation/catalog-grants/${grant.grantId}`, { method: "DELETE" })).status, 200);
  await assert.rejects(() => client.execute({ operation: "read", type, key }), { status: 401 });
  assert.equal(await http.outbound(), 0);
});
