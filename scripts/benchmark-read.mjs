#!/usr/bin/env node
// Read-only capacity probe for an isolated/local Pit server.
//
//   node scripts/benchmark-read.mjs --url http://127.0.0.1:3130 --concurrency 12 --seconds 20
//
// Start the isolated server with RENDER=true and loopback in
// PIT_TRUSTED_PROXY_CIDRS. That enables the same verified CF-Connecting-IP
// boundary used in production, so virtual visitors do not share one local IP
// rate-limit bucket.
//
// This intentionally refuses production and never calls a mutating endpoint.
// X-Forwarded-For rotates across virtual visitors so the benchmark measures the
// application instead of one guest tripping the legitimate 300/min flood guard.
// Guest snapshots are the default. Member feed profiles require an isolated
// server session in PIT_BENCHMARK_SESSION_COOKIE; use npm run stress for actual
// multi-account capacity instead of measuring one account's rate limit.

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = String(arg("url", "http://127.0.0.1:3000")).replace(/\/+$/, "");
const concurrency = Math.max(1, Math.min(200, Math.floor(Number(arg("concurrency", 12)) || 12)));
const seconds = Math.max(2, Math.min(300, Number(arg("seconds", 20)) || 20));
const warmupSeconds = Math.max(0, Math.min(30, Number(arg("warmup", 2)) || 0));
const timeoutMs = Math.max(1000, Math.min(30000, Number(arg("timeout", 10000)) || 10000));
// Count-bounded probes compare the same workload even on busy CI machines.
// Omitted requests retains the normal time-bounded capacity mode.
const requestCount = Number(arg("requests", 0));
if (!Number.isSafeInteger(requestCount) || requestCount < 0 || requestCount > 100_000) {
  console.error("Choose --requests between 1 and 100000, or omit it for a timed probe.");
  process.exit(2);
}
const profileName = String(arg("profile", "guest")).toLowerCase();

let target;
try { target = new URL(baseUrl); } catch { target = null; }
if (!target || !["localhost", "127.0.0.1", "::1"].includes(target.hostname)) {
  console.error("Refusing to benchmark a non-local server. Run this only against an isolated local database.");
  process.exit(2);
}

// Weight endpoints by ordinary browse behavior. Media bytes do not pass
// through this Node service in production; they are served by R2 instead.
// Public snapshots are the default; personalized and legacy profiles explicitly
// measure the signed-in ranked and chronological feeds.
const profiles = {
  guest: [
    ["/api/discovery/sidebar", 30],
    ["/api/discover/overview?by=popularity&country=Worldwide", 20],
    ["/api/artists?q=cole&limit=12", 20],
    ["/api/tourdates?days=30&limit=500", 20],
    ["/api/landing/media", 10],
  ],
  personalized: [
    ["/api/feed/for-you?limit=30", 40],
    ["/api/discovery/sidebar", 20],
    ["/api/discover/overview?by=popularity&country=Worldwide", 15],
    ["/api/artists?q=cole&limit=12", 15],
    ["/api/tourdates?days=30&limit=500", 10],
  ],
  legacy: [
    ["/api/feed?limit=30", 40],
    ["/api/discovery/sidebar", 20],
    ["/api/discover/overview?by=popularity&country=Worldwide", 15],
    ["/api/artists?q=cole&limit=12", 15],
    ["/api/tourdates?days=30&limit=500", 10],
  ],
};
const profile = profiles[profileName];
if (!profile) {
  console.error("Unknown profile '" + profileName + "'. Choose guest, personalized, or legacy.");
  process.exit(2);
}
const schedule = profile.flatMap(([path, weight]) => Array.from({ length: weight }, () => path));
const sessionCookie = profileName === "guest" ? "" : String(process.env.PIT_BENCHMARK_SESSION_COOKIE || "").trim();
if (profileName !== "guest" && (!sessionCookie || /[\r\n]/u.test(sessionCookie))) {
  console.error("Member profiles require PIT_BENCHMARK_SESSION_COOKIE from the isolated local server. Use --profile guest for public snapshots.");
  process.exit(2);
}
const VISITOR_POOL = 60000;
const percentile = (sorted, value) => sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))]
  : 0;

async function runWindow(durationMs, record) {
  const deadline = performance.now() + durationMs;
  let sequence = 0;
  const workers = Array.from({ length: concurrency }, (_, worker) => (async () => {
    while (record && requestCount ? sequence < requestCount : performance.now() < deadline) {
      const requestNumber = sequence++;
      const path = schedule[requestNumber % schedule.length];
      const started = performance.now();
      let status = 0;
      let bytes = 0;
      try {
        // Include the worker so every concurrent connection owns a disjoint
        // guest bucket instead of resetting requestNumber to zero per worker.
        const visitor = ((requestNumber * concurrency + worker) % VISITOR_POOL) + 1;
        const response = await fetch(`${baseUrl}${path}`, {
          headers: {
            Accept: "application/json",
            ...(sessionCookie ? { Cookie: sessionCookie } : {}),
            // Production trusts Render's single-value edge header after the
            // socket ingress is verified. Send the same header in this strictly
            // localhost-only probe so virtual visitors exercise independent
            // anti-abuse buckets instead of collapsing into the loopback IP.
            "CF-Connecting-IP": `198.18.${Math.floor(visitor / 250)}.${(visitor % 250) + 1}`,
            "X-Forwarded-For": `198.18.${Math.floor(visitor / 250)}.${(visitor % 250) + 1}`,
            "User-Agent": `pit-capacity-probe/${worker}`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        status = response.status;
        bytes = (await response.arrayBuffer()).byteLength;
      } catch {}
      if (record) record({ path, status, bytes, latency: performance.now() - started });
    }
  })());
  await Promise.all(workers);
}

async function main() {
  const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
  if (!health?.ok) {
    console.error(`The isolated server is not healthy (${health?.status || "network failure"}).`);
    process.exitCode = 2;
    return;
  }

  if (sessionCookie) {
    const me = await fetch(baseUrl + "/api/me", {
      headers: { Cookie: sessionCookie, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    }).then(async (response) => response.ok ? response.json() : null).catch(() => null);
    if (!me?.user?.id) {
      console.error("The benchmark session is expired or does not belong to the isolated server. No feed load was started.");
      process.exitCode = 2;
      return;
    }
  }

  if (warmupSeconds) await runWindow(warmupSeconds * 1000, null);

  const rows = [];
  const startedAt = performance.now();
  await runWindow(seconds * 1000, (row) => rows.push(row));
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const latencies = rows.map((row) => row.latency).sort((a, b) => a - b);
  const successes = rows.filter((row) => row.status >= 200 && row.status < 300).length;
  const rateLimited = rows.filter((row) => row.status === 429).length;
  const serverErrors = rows.filter((row) => row.status >= 500).length;
  const networkErrors = rows.filter((row) => row.status === 0).length;
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);

  console.log(`target       ${baseUrl}`);
  console.log("profile     ", profileName, profileName === "guest" ? "public snapshot API browse mix" : "authenticated feed API browse mix");
  console.log(`load         ${concurrency} concurrent for ${elapsedSeconds.toFixed(1)}s (${rows.length} requests)`);
  console.log(`throughput   ${(rows.length / elapsedSeconds).toFixed(1)} req/s, ${(totalBytes / elapsedSeconds / 1024 / 1024).toFixed(1)} MiB/s JSON`);
  console.log(`latency      p50 ${percentile(latencies, 0.50).toFixed(1)}ms  p95 ${percentile(latencies, 0.95).toFixed(1)}ms  p99 ${percentile(latencies, 0.99).toFixed(1)}ms  max ${(latencies.at(-1) || 0).toFixed(1)}ms`);
  console.log(`outcomes     2xx ${successes}  429 ${rateLimited}  5xx ${serverErrors}  network ${networkErrors}`);
  if (rateLimited) {
    console.log("rate-limit   Verify the isolated server uses RENDER=true and trusts only its loopback benchmark ingress.");
  }

  for (const [path] of profile) {
    const subset = rows.filter((row) => row.path === path).map((row) => row.latency).sort((a, b) => a - b);
    console.log(`route p95    ${percentile(subset, 0.95).toFixed(1).padStart(7)}ms  ${path}`);
  }

  if (successes !== rows.length) process.exitCode = 1;
}

await main();
