// Load and concurrency probe against a RUNNING server.
//
//   node scripts/stress.mjs --url http://127.0.0.1:3000 --users 20 --rounds 40 --data-dir .tmp/capacity-local
//
// This is not a benchmark. It exists to answer three questions that unit tests
// cannot, because they need real concurrency against one shared database:
//
//   1. Does anything 500 under load, or only fail in the ways it should (429)?
//   2. Do concurrent writes to the SAME row stay consistent — no lost updates,
//      no double counting?
//   3. Is the database still internally consistent afterwards? Run
//      scripts/integrity-check.mjs after this; that pairing is the real test.
//
// NEVER point this at production. It creates accounts and writes rows.
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  CAPACITY_CHALLENGE_HEADER,
  capacityDatabaseProofMatches,
} from "../server/capacityHandshake.js";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = String(arg("url", "http://localhost:3000")).replace(/\/+$/, "");
const USERS = Math.max(1, Math.min(200, Math.floor(Number(arg("users", 12)) || 12)));
const ROUNDS = Math.max(1, Math.min(200, Math.floor(Number(arg("rounds", 25)) || 25)));
const virtualIp = (index) => `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
const requestedDataDir = String(arg("data-dir", "")).trim();

let target;
try { target = new URL(BASE); } catch { target = null; }
if (!target || target.protocol !== "http:" || target.username || target.password
  || target.pathname !== "/" || target.search || target.hash
  || !["localhost", "127.0.0.1", "::1"].includes(target.hostname)) {
  console.error("Refusing to stress a non-local server. This creates accounts and writes rows.");
  process.exit(2);
}
if (!requestedDataDir) {
  console.error("Pass --data-dir for the isolated .tmp/capacity-* database used by the local server.");
  process.exit(2);
}
let dataDir;
try { dataDir = realpathSync(resolve(requestedDataDir)); } catch { dataDir = ""; }
if (!dataDir || !dataDir.toLowerCase().includes(`${sep}.tmp${sep}capacity-`)) {
  console.error("Refusing to write outside an existing .tmp/capacity-* fixture.");
  process.exit(2);
}
let databasePath;
try { databasePath = realpathSync(resolve(join(dataDir, "pit.db"))); } catch { databasePath = ""; }
if (!databasePath || resolve(dirname(databasePath)).toLowerCase() !== resolve(dataDir).toLowerCase()) {
  console.error("Refusing to use a missing or linked-outside capacity database.");
  process.exit(2);
}

const stats = { codes: new Map(), latencies: [], errors: [] };
const record = (status, ms, note) => {
  stats.codes.set(status, (stats.codes.get(status) || 0) + 1);
  stats.latencies.push(ms);
  if (status >= 500) stats.errors.push(`${status} ${note}`);
  if (status === 0) stats.errors.push(`network failure: ${note}`);
};

async function call(path, {
  method = "GET", body, cookie, visitorIp, headers: requestHeaders,
} = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(visitorIp ? { "CF-Connecting-IP": visitorIp, "X-Forwarded-For": visitorIp } : {}),
        ...(requestHeaders || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const ms = Date.now() - started;
    record(res.status, ms, `${method} ${path}`);
    const setCookie = res.headers.get("set-cookie");
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json, cookie: setCookie ? setCookie.split(";")[0] : null };
  } catch (error) {
    const ms = Date.now() - started;
    const failureCode = error?.cause?.code || error?.code || error?.cause?.name || error?.name || "network_error";
    record(0, ms, `${method} ${path} (${failureCode})`);
    return { status: 0, json: null, cookie: null };
  }
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const stamp = Date.now();

console.log(`stress  ${BASE}  ${USERS} users x ${ROUNDS} rounds\n`);

// Prove the running process opened this exact isolated fixture before the first
// signup or any other HTTP mutation. Localhost alone is not enough: a developer
// may already have another PIT server running against their normal dev data.
const capacityChallenge = randomBytes(32).toString("hex");
const capacityBinding = await call("/api/dev/capacity-handshake", {
  headers: { [CAPACITY_CHALLENGE_HEADER]: capacityChallenge },
});
if (capacityBinding.status !== 200
  || !capacityDatabaseProofMatches(databasePath, capacityChallenge, capacityBinding.json?.proof)) {
  console.error("Refusing to write: the running server is not using the supplied capacity database.");
  process.exit(2);
}

// --- health next: never load-test a server that is already unwell ---
const health = await call("/api/health");
if (health.status !== 200) {
  console.error(`Server is not healthy (${health.status}). Start it first.`);
  process.exit(2);
}

// --- 1. the same email six times, concurrently. The public response is
//        deliberately privacy-safe (it never reveals whether an account was
//        created), so exact single-row proof happens below when --data-dir is
//        available.
//        Runs FIRST: signup is rate-limited per IP (5 per 15 min by design), and
//        every request here shares one address, so doing this after the bulk
//        signups would measure the rate limiter instead of the race. ---
console.log("1. duplicate signup race");
const dupeEmail = `stress-${stamp}-dupe@example.test`;
const dupes = await Promise.all(Array.from({ length: 6 }, () =>
  call("/api/signup", {
    method: "POST",
    body: {
      name: "Dupe",
      email: dupeEmail,
      password: "horsebattery7",
      genres: ["Rock"],
      ageBand: "18_plus",
      termsVersion: LEGAL_ACCEPTANCE_VERSION,
    },
  })));
const acceptedSignups = dupes.filter((entry) => entry.status === 200 && entry.json?.pending === true).length;
const signupLimited = dupes.filter((entry) => entry.status === 429).length;
const unexpectedSignup = dupes.length - acceptedSignups - signupLimited;
console.log(`   ${acceptedSignups} privacy-safe accepted, ${signupLimited} rate-limited, ${unexpectedSignup} unexpected`);
if (!acceptedSignups || unexpectedSignup) {
  stats.errors.push(`duplicate-email race returned ${unexpectedSignup} unexpected responses`);
}

// --- 2. accounts for the load phase.
//
//        Signup is limited to 5 per 15 minutes PER IP, which is correct and
//        which a single-machine load test will always hit. The required
//        isolated --data-dir lets this harness mint test-only sessions directly
//        instead of weakening or racing that production limit.
console.log("2. accounts for the load phase");
let signedUp = [];
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("../server/db.js");
const { createSession, hashPassword } = await import("../server/auth.js");
const duplicateRows = Number(db.prepare("SELECT COUNT(*) AS count FROM users WHERE lower(email)=lower(?)").get(dupeEmail)?.count);
console.log(`   duplicate-email race persisted ${duplicateRows} account row`);
if (duplicateRows !== 1) stats.errors.push(`duplicate-email race persisted ${duplicateRows} account rows`);
const hash = hashPassword("horsebattery7");
for (let i = 0; i < USERS; i += 1) {
  const id = `u_stress_${stamp}_${i}`;
  try {
    q.insertUser.run(id, `seed-${stamp}-${i}@example.test`, `Seed ${i}`, `seed${stamp}${i}`.slice(0, 20), hash, "fan", "Toronto", 43.65, -79.38, "S", "#123456", Date.now());
    const session = createSession(id, "127.0.0.1", "stress");
    signedUp.push({
      id,
      cookie: `pit_session=${session.token}`,
      handle: `seed${stamp}${i}`,
      visitorIp: virtualIp(i),
    });
  } catch (error) { stats.errors.push(`seed failed: ${error.message}`); }
}
console.log(`   ${signedUp.length} sessions minted directly (bypassing the per-IP signup limit)`);
if (!signedUp.length) { console.error("   no accounts available; pass --data-dir <server data dir>"); process.exit(1); }

// --- 3. read load ---
console.log("3. concurrent reads");
const readPaths = ["/api/feed?limit=20", "/api/artists?q=drake&limit=5", "/api/health", "/api/me"];
for (let round = 0; round < ROUNDS; round += 1) {
  await Promise.all(signedUp.map((a, i) => call(readPaths[(round + i) % readPaths.length], {
    cookie: a.cookie,
    visitorIp: a.visitorIp,
  })));
}
console.log(`   ${ROUNDS * signedUp.length} reads issued`);

// --- 4. concurrent writes, then the count is checked against reality. This is
//        the lost-update test: N users liking one post must yield exactly N. ---
console.log("4. write contention on one row");
const author = signedUp[0];
const post = await call("/api/posts", {
  method: "POST", cookie: author.cookie, visitorIp: author.visitorIp,
  body: { kind: "status", review: `stress ${stamp}`, artist: "Stress Test", venue: "Load", city: "Toronto", date: "2026-01-01", overall: 5, band: 5, room: 5 },
});
const postId = post.json?.post?.id || post.json?.id;
let likeReport = "   skipped (no post id returned)";
if (postId) {
  const likers = signedUp.slice(0, Math.min(signedUp.length, 10));
  // `liked: true` explicitly. The endpoint TOGGLES when the body omits it, so a
  // retry would silently unlike and this would measure nothing.
  await Promise.all(likers.map((a) => call(`/api/posts/${postId}/like`, {
    method: "POST",
    cookie: a.cookie,
    visitorIp: a.visitorIp,
    body: { liked: true },
  })));
  // There is no single-post GET; the count comes back on the feed projection.
  const feed = await call("/api/feed?limit=50", { cookie: author.cookie, visitorIp: author.visitorIp });
  const found = (feed.json?.posts || []).find((p) => p.id === postId);
  const likes = found?.likes ?? null;
  likeReport = `   ${likers.length} concurrent likes -> server reports ${likes ?? "post not found in feed"}`;
  if (likes != null && likes !== likers.length) stats.errors.push(`lost update: ${likers.length} likes recorded as ${likes}`);
}
console.log(likeReport);

// --- 5. rate limiting must engage on an active product route and must answer
//        429 rather than 500. Playlists are intentionally paused and return 404,
//        so exercising that retired surface would prove nothing.
console.log("5. rate limit behaviour");
// Deliberately more than the route's own ceiling (120/10 minutes), so this proves the
// limiter actually engages. A burst under the limit would pass while testing
// nothing. What matters is that the refusal is a 429, not a 500 or a crash.
const BURST = 140;
const burst = postId
  ? await Promise.all(Array.from({ length: BURST }, () =>
      call(`/api/posts/${postId}/like`, {
        method: "POST",
        cookie: author.cookie,
        visitorIp: author.visitorIp,
        body: { liked: true },
      })))
  : [];
const limited = burst.filter((b) => b.status === 429).length;
const accepted = burst.filter((b) => b.status === 200).length;
const server500 = burst.filter((b) => b.status >= 500).length;
console.log(`   ${BURST} rapid writes -> ${accepted} accepted, ${limited} rate-limited, ${server500} server errors`);
if (server500) stats.errors.push(`${server500} 5xx while rate limiting`);
if (!postId) stats.errors.push("rate-limit probe could not create its target post");
else if (!limited) stats.errors.push(`the limiter never engaged across ${BURST} writes`);

// --- report ---
const sorted = stats.latencies.slice().sort((a, b) => a - b);
const byCode = [...stats.codes.entries()].sort((a, b) => a[0] - b[0]).map(([c, n]) => `${c || "net-fail"}:${n}`).join("  ");
console.log(`\nrequests   ${stats.latencies.length}`);
console.log(`status     ${byCode}`);
console.log(`latency    p50 ${pct(sorted, 0.5)}ms   p95 ${pct(sorted, 0.95)}ms   max ${sorted[sorted.length - 1] ?? 0}ms`);

if (stats.errors.length) {
  console.log(`\nPROBLEMS (${stats.errors.length}):`);
  for (const e of [...new Set(stats.errors)].slice(0, 15)) console.log(`  - ${e}`);
  console.log("\nNow run: node scripts/integrity-check.mjs");
  process.exit(1);
}
console.log("\nNo 5xx or network failures, no lost updates, no duplicate identities.");
console.log("Now run: node scripts/integrity-check.mjs");
