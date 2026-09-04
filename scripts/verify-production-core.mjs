#!/usr/bin/env node

// Read-only post-deploy proof for the database-backed public API. This is safe
// to run against production: it creates no accounts, rows, sessions, or media.
// Keep media and SEO as separate verifiers so a failure names the responsible
// subsystem instead of collapsing into one generic deploy check.

import { pathToFileURL } from "node:url";

export const DEFAULT_PRODUCTION_ORIGIN = "https://www.mshpit.com";
export const DEFAULT_PRODUCTION_TIMEOUT_MS = 10_000;
export const MAX_PRODUCTION_JSON_BYTES = 1024 * 1024;

function checkedOrigin(value) {
  let url;
  try { url = new URL(String(value || DEFAULT_PRODUCTION_ORIGIN)); }
  catch { throw new Error("Production origin is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Production verification requires a plain HTTPS origin.");
  }
  return url.origin;
}

function boundedTimeout(value) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout)) return DEFAULT_PRODUCTION_TIMEOUT_MS;
  return Math.max(1_000, Math.min(30_000, Math.trunc(timeout)));
}

async function boundedJson(response, maximumBytes = MAX_PRODUCTION_JSON_BYTES) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > maximumBytes)) {
    throw new Error("response exceeds the production payload budget");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) {
      throw new Error("response exceeds the production payload budget");
    }
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel("response too large");
        throw new Error("response exceeds the production payload budget");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
}

async function probe(origin, path, {
  fetchImpl,
  timeoutMs,
  validate,
  maximumBytes = MAX_PRODUCTION_JSON_BYTES,
}) {
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(new URL(path, `${origin}/`), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json",
        "user-agent": "Mshpit-Production-Core-Verification/1.0",
      },
    });
  } catch (error) {
    throw new Error(`${path} could not be reached`, { cause: error });
  }
  if (response.status !== 200) throw new Error(`${path} returned HTTP ${response.status}`);
  const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error(`${path} did not return JSON`);
  let payload;
  try { payload = await boundedJson(response, maximumBytes); }
  catch (error) {
    if (error?.message === "response exceeds the production payload budget") {
      throw new Error(`${path} response exceeds the production payload budget`, { cause: error });
    }
    throw new Error(`${path} returned invalid JSON`, { cause: error });
  }
  validate(payload, response);
  return Object.freeze({
    path,
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
  });
}

export async function verifyProductionCore({
  origin = DEFAULT_PRODUCTION_ORIGIN,
  timeoutMs = DEFAULT_PRODUCTION_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required.");
  const target = checkedOrigin(origin);
  const deadline = boundedTimeout(timeoutMs);
  const checks = [
    ["/api/health", (payload) => {
      if (payload?.ok !== true) throw new Error("core health is not ready");
    }],
    ["/api/readiness", (payload) => {
      if (payload?.ok !== true) throw new Error("strict readiness is not ready");
    }],
    ["/api/time", (payload) => {
      if (!Number.isFinite(payload?.now) || !payload?.iso) throw new Error("server clock projection is incomplete");
    }],
    ["/api/artists?q=drake&limit=3", (payload) => {
      if (!Array.isArray(payload?.artists) || payload.artists.length > 3
        || !Number.isSafeInteger(Number(payload?.total))
        || !payload.artists.some((artist) => String(artist?.name || "").trim().toLowerCase() === "drake")) {
        throw new Error("artist search projection is invalid");
      }
    }],
    ["/api/discover/overview?by=popularity&country=Worldwide", (payload) => {
      if (!Number.isSafeInteger(Number(payload?.catalogTotal)) || Number(payload.catalogTotal) < 1_000
        || !Array.isArray(payload?.chart?.rows) || payload.chart.rows.length < 1
        || !Array.isArray(payload?.topRatedShows)) {
        throw new Error("discover overview catalog is incomplete");
      }
    }],
    ["/api/tourdates?days=30&limit=5", (payload) => {
      if (!Array.isArray(payload?.tourDates) || payload.tourDates.length > 5
        || payload?.range?.days !== 30) {
        throw new Error("paged tour-date projection is invalid");
      }
    }],
    ["/api/tourdates", (payload, response) => {
      if (!Array.isArray(payload?.tourDates) || payload.tourDates.length > 500) {
        throw new Error("legacy tour-date compatibility response is unbounded");
      }
      const truncated = response.headers.get("x-pit-results-truncated");
      const link = response.headers.get("link");
      if (!["true", "false"].includes(truncated)
        || (truncated === "false" && link !== null)) {
        throw new Error("legacy tour-date continuation headers are invalid");
      }
      if (truncated === "true") {
        const linkTarget = String(link || "").match(/^<([^>]+)>; rel="next"$/)?.[1];
        let next;
        try { next = linkTarget ? new URL(linkTarget, `${target}/`) : null; } catch { next = null; }
        const limit = Number(next?.searchParams.get("limit"));
        if (!next || next.origin !== target || next.pathname !== "/api/tourdates"
          || next.searchParams.get("scope") !== "all-upcoming"
          || !next.searchParams.get("after")
          || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
          throw new Error("legacy tour-date continuation headers are invalid");
        }
      }
    }],
    ["/api/discovery/sidebar", (payload) => {
      if (!Array.isArray(payload?.upcomingEvents)) throw new Error("discovery sidebar projection is invalid");
    }],
  ];
  const results = [];
  for (const [path, validate] of checks) {
    results.push(await probe(target, path, { fetchImpl, timeoutMs: deadline, validate }));
  }
  return Object.freeze({ ok: true, origin: target, checks: Object.freeze(results) });
}

function cliOptions(argv) {
  let origin = DEFAULT_PRODUCTION_ORIGIN;
  let timeoutMs = DEFAULT_PRODUCTION_TIMEOUT_MS;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--origin" && argv[index + 1]) origin = argv[++index];
    else if (argv[index] === "--timeout-ms" && argv[index + 1]) timeoutMs = argv[++index];
    else throw new Error("Usage: npm run verify:production-core -- [--origin https://www.mshpit.com] [--timeout-ms 10000]");
  }
  return { origin, timeoutMs };
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  try {
    const report = await verifyProductionCore(cliOptions(process.argv.slice(2)));
    for (const result of report.checks) console.log(`PASS  ${result.path} (${result.latencyMs}ms)`);
    console.log("PASS  Production database-backed API is healthy and bounded.");
  } catch (error) {
    console.error(`FAIL  ${error?.message || "Production core verification failed."}`);
    process.exitCode = 1;
  }
}
