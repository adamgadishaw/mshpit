import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { createSearchConsoleClient, SearchConsoleClientError, searchConsoleConfiguration } from "./searchConsoleClient.js";

// Fresh disposable test credentials, never a real service account or API call.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const ENV = { SEARCH_CONSOLE_PROPERTY: "sc-domain:mshpit.com",
  SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "search-growth@fixture-project.iam.gserviceaccount.com", SEARCH_CONSOLE_PRIVATE_KEY: PEM };
const NOW = Date.parse("2026-09-27T12:00:00Z");
const WINDOW = { startDate: "2026-08-01", endDate: "2026-08-28" };
const OAUTH = "https://oauth2.googleapis.com/token";
const QUERY = "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Amshpit.com/searchAnalytics/query";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN = { access_token: "test-token.not-a-real-token", token_type: "Bearer", expires_in: 3600, scope: SCOPE };
const METRICS = { clicks: 5, impressions: 20, position: 2.5, ctr: 0.25 };
const json = (body, options = {}) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...options });
const rows = (aggregation, values) => ({ responseAggregationType: aggregation, rows: values });
const stats = body => body.dimensions
  ? rows("byPage", [{ keys: ["https://www.mshpit.com/artist/fixture"], ...METRICS }]) : rows("byProperty", [{ ...METRICS }]);
function fixture(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    if (url === OAUTH) return overrides.oauth ? overrides.oauth(options) : json(TOKEN);
    assert.equal(url, overrides.queryUrl || QUERY, "only the fixed approved query endpoint is contacted");
    const body = JSON.parse(options.body);
    return overrides.query ? overrides.query(body, options) : json(stats(body));
  };
  const client = createSearchConsoleClient({ env: overrides.env || ENV, now: overrides.now || (() => NOW), fetchImpl });
  return { client, calls };
}
const rejects = code => error => error instanceof SearchConsoleClientError && error.code === code
  && !error.cause && !error.message.includes("secret");
async function flushUntil(predicate) { for (let n = 0; n < 200; n += 1) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail("fixture did not progress"); }

test("configuration exposes only a safe status and exact normalized Mshpit property", () => {
  for (const [input, property] of [["sc-domain:mshpit.com", "sc-domain:mshpit.com"], [" SC-DOMAIN:MSHPIT.COM ", "sc-domain:mshpit.com"],
    ["https://www.mshpit.com", "https://www.mshpit.com/"], [" HTTPS://MSHPIT.COM/ ", "https://mshpit.com/"]]) {
    assert.deepEqual(searchConsoleConfiguration({ ...ENV, SEARCH_CONSOLE_PROPERTY: input }), { configured: true, reason: "ready", property });
  }
  for (const input of ["http://mshpit.com/", "https://mshpit.com:443/", "https://user@mshpit.com/", "https://www.mshpit.com/?q=x",
    "https://mshpit.com/#x", "https://mshpit.com./", "https://mshpit.com.evil.test/", "https://mshpit.com/artist", "https://mshpit.com/../",
    "https:\\mshpit.com", "sc-domain:evil.test", "sc-domain:sub.mshpit.com", 1, {}]) {
    assert.deepEqual(searchConsoleConfiguration({ ...ENV, SEARCH_CONSOLE_PROPERTY: input }), { configured: false, reason: "invalid_property", property: null });
  }
  assert.equal(searchConsoleConfiguration({}).reason, "missing_property");
  assert.equal(searchConsoleConfiguration({ SEARCH_CONSOLE_PROPERTY: ENV.SEARCH_CONSOLE_PROPERTY }).reason, "missing_credentials");
  const escaped = { ...ENV, SEARCH_CONSOLE_PRIVATE_KEY: PEM.replace(/\n/gu, "\\n") };
  assert.equal(searchConsoleConfiguration(escaped).configured, true);
  for (const changes of [{ SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "user@gmail.com" }, { SEARCH_CONSOLE_PRIVATE_KEY: "secret-bad-key" },
    { SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL: "search@fixture.iam.gserviceaccount.com\nInjected: secret" },
    { SEARCH_CONSOLE_PRIVATE_KEY: publicKey.export({ type: "spki", format: "pem" }) }]) {
    const value = searchConsoleConfiguration({ ...ENV, ...changes });
    assert.equal(value.reason, "invalid_credentials");
    assert.deepEqual(Object.keys(value).sort(), ["configured", "property", "reason"]);
  }
  const weak = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" });
  assert.equal(searchConsoleConfiguration({ ...ENV, SEARCH_CONSOLE_PRIVATE_KEY: weak }).reason, "invalid_credentials");
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" });
  assert.equal(searchConsoleConfiguration({ ...ENV, SEARCH_CONSOLE_PRIVATE_KEY: ec }).reason, "invalid_credentials");
});

test("the JWT has a valid RSA256 signature, fixed audience/read-only scope and no impersonation", async () => {
  const { client, calls } = fixture();
  const result = await client.readWindow(WINDOW);
  assert.deepEqual(result, { totals: METRICS, pages: [{ page: "https://www.mshpit.com/artist/fixture", ...METRICS }], truncated: false });
  assert.equal(calls.length, 3);
  const form = new URLSearchParams(calls[0].options.body);
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [header, payload, signature] = form.get("assertion").split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url")), { iss: ENV.SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL, scope: SCOPE, aud: OAUTH, iat: NOW / 1000, exp: NOW / 1000 + 3600 });
  assert.equal(verify("RSA-SHA256", Buffer.from(header + "." + payload), publicKey, Buffer.from(signature, "base64url")), true);
  for (const call of calls.slice(1)) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, "Bearer " + TOKEN.access_token);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body), { ...WINDOW, type: "web", dataState: "final", aggregationType: "byProperty", rowLimit: 1 });
  assert.deepEqual(JSON.parse(calls[2].options.body), { ...WINDOW, type: "web", dataState: "final", aggregationType: "byPage", dimensions: ["page"], rowLimit: 1000 });
});

test("invalid calendar windows and missing configuration fail before authentication", async () => {
  const { client, calls } = fixture();
  for (const dates of [{ startDate: "2026-02-29", endDate: "2026-03-01" }, { startDate: "2026-04-31", endDate: "2026-05-01" },
    { startDate: "2026-08-28", endDate: "2026-08-01" }, { startDate: "2026-08-01", endDate: "2026-09-01" },
    { startDate: "2026-8-01", endDate: "2026-08-28" }, { startDate: 20260801, endDate: "2026-08-28" }]) {
    await assert.rejects(client.readWindow(dates), rejects("invalid_window"));
  }
  assert.equal(calls.length, 0);
  await assert.rejects(createSearchConsoleClient({ env: {}, fetchImpl() { assert.fail("must not fetch"); } }).readWindow(WINDOW), rejects("missing_property"));
  await client.readWindow({ startDate: "2024-02-29", endDate: "2024-03-30" });
  assert.equal(calls.length, 3, "inclusive 31-day leap-year window is accepted");
});

test("URL-prefix property is encoded in the fixed endpoint and later env changes cannot retarget credentials", async () => {
  const env = { ...ENV, SEARCH_CONSOLE_PROPERTY: "https://www.mshpit.com/" };
  const { client, calls } = fixture({ env, queryUrl: "https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fwww.mshpit.com%2F/searchAnalytics/query" });
  env.SEARCH_CONSOLE_PROPERTY = "https://evil.test/";
  await client.readWindow(WINDOW);
  assert.equal(calls.length, 3);
});

test("empty windows are explicit zeros and 1000 page rows are flagged, not paginated or summed", async () => {
  const empty = fixture({ query: () => json({}) });
  assert.deepEqual(await empty.client.readWindow(WINDOW), { totals: { clicks: 0, impressions: 0, position: 0, ctr: 0 }, pages: [], truncated: false });
  const full = fixture({ query: body => json(body.dimensions ? rows("byPage", Array.from({ length: 1000 }, (_, n) => ({ keys: ["https://www.mshpit.com/artist/" + n], ...METRICS }))) : stats(body)) });
  const result = await full.client.readWindow(WINDOW);
  assert.equal(result.pages.length, 1000); assert.equal(result.truncated, true); assert.deepEqual(result.totals, METRICS);
  assert.equal(full.calls.length, 3);
});

test("tokens are singleflight, reused until early expiry, and refreshed after clock rollback", async () => {
  let release; let at = NOW;
  const gate = new Promise(resolve => { release = resolve; });
  let tokenCalls = 0;
  const { client, calls } = fixture({ now: () => at, oauth: async () => { tokenCalls += 1; await gate; return json(TOKEN); } });
  const first = client.readWindow(WINDOW), second = client.readWindow(WINDOW);
  await flushUntil(() => tokenCalls === 1); release();
  await Promise.all([first, second]);
  assert.equal(tokenCalls, 1); assert.equal(calls.length, 5);
  at += 50 * 60_000; await client.readWindow(WINDOW); assert.equal(tokenCalls, 1);
  at += 10 * 60_000; await client.readWindow(WINDOW); assert.equal(tokenCalls, 2);
  at = NOW - 1; await client.readWindow(WINDOW); assert.equal(tokenCalls, 3);
});

test("one token waiter abort cannot cancel another reader; last-waiter abort cancels shared work", async () => {
  let release; let signal;
  const gate = new Promise(resolve => { release = resolve; });
  const firstAbort = new AbortController();
  const { client } = fixture({ oauth: async options => { signal = options.signal; await gate; return json(TOKEN); } });
  const first = client.readWindow({ ...WINDOW, signal: firstAbort.signal });
  const firstRejected = assert.rejects(first, rejects("request_aborted"));
  const second = client.readWindow(WINDOW);
  await flushUntil(() => !!signal); firstAbort.abort(new Error("secret reason")); await firstRejected;
  assert.equal(signal.aborted, false); release(); await second;
  const allAbort = new AbortController(); let lastSignal;
  const last = fixture({ oauth: options => { lastSignal = options.signal; return new Promise(() => {}); } });
  const pending = last.client.readWindow({ ...WINDOW, signal: allAbort.signal });
  const rejected = assert.rejects(pending, rejects("request_aborted"));
  await flushUntil(() => !!lastSignal); allAbort.abort(); await rejected;
  assert.equal(lastSignal.aborted, true);
});

test("redirects, provider failures and malformed tokens never expose bodies or retry", async () => {
  for (const status of [301, 302, 401, 403, 429, 500]) {
    const { client, calls } = fixture({ oauth: () => json({ error: "secret-body", private_key: PEM }, { status }) });
    await assert.rejects(client.readWindow(WINDOW), error => rejects("oauth_rejected")(error) && error.httpStatus === status && !JSON.stringify(error).includes("secret"));
    assert.equal(calls.length, 1);
  }
  const redirected = fixture({ oauth: () => ({ ok: true, status: 200, redirected: true, url: "https://evil.test/", body: { cancel() {} } }) });
  await assert.rejects(redirected.client.readWindow(WINDOW), rejects("oauth_rejected"));
  for (const changes of [{ access_token: "secret\nInjected: header" }, { access_token: "" }, { token_type: "Basic" }, { expires_in: 0 },
    { expires_in: 999999 }, { expires_in: "3600" }, { scope: "https://www.googleapis.com/auth/webmasters" }]) {
    const { client, calls } = fixture({ oauth: () => json({ ...TOKEN, ...changes }) });
    await assert.rejects(client.readWindow(WINDOW), rejects("oauth_invalid_response")); assert.equal(calls.length, 1);
  }
  const network = fixture({ oauth: () => { throw new Error("secret private URL token"); } });
  await assert.rejects(network.client.readWindow(WINDOW), rejects("oauth_unavailable"));
});

test("query rejection invalidates a rejected token without silently retrying", async () => {
  let rejected = true;
  const { client, calls } = fixture({ query: body => rejected ? json({ error: "secret" }, { status: 401 }) : json(stats(body)) });
  await assert.rejects(client.readWindow(WINDOW), rejects("query_rejected"));
  assert.equal(calls.length, 2); rejected = false; await client.readWindow(WINDOW);
  assert.equal(calls.filter(call => call.url === OAUTH).length, 2);
});

test("malformed metrics, page identities, duplicate rows and aggregation mismatch fail closed", async () => {
  for (const body of [rows("byPage", [{ ...METRICS }]), rows("byProperty", [{ ...METRICS }, { ...METRICS }]),
    rows("byProperty", [{ ...METRICS, clicks: "5" }]), rows("byProperty", [{ ...METRICS, ctr: 2 }]),
    rows("byProperty", [{ ...METRICS, impressions: -1 }]), rows("byProperty", [{ ...METRICS, position: 0 }]),
    { rows: [{ ...METRICS }] }, { rows: null }, { error: "not valid metric response", rows: "secret" }, { error: "secret" }]) {
    await assert.rejects(fixture({ query: () => json(body) }).client.readWindow(WINDOW), rejects("query_invalid_response"));
  }
  for (const page of ["https://evil.test/a", "javascript:alert(1)", "https://mshpit.com.evil.test/a", "https://user:pass@mshpit.com/a", "https://mshpit.com:444/a", "https://mshpit.com:443/a", "https://mshpit.com/a#secret", "//www.mshpit.com/a", "https:mshpit.com/a"]) {
    await assert.rejects(fixture({ query: body => json(body.dimensions ? rows("byPage", [{ keys: [page], ...METRICS }]) : stats(body)) }).client.readWindow(WINDOW), rejects("query_invalid_response"));
  }
  const duplicate = { keys: ["https://mshpit.com/a"], ...METRICS };
  await assert.rejects(fixture({ query: body => json(body.dimensions ? rows("byPage", [duplicate, duplicate]) : stats(body)) }).client.readWindow(WINDOW), rejects("query_invalid_response"));
});

test("body validation rejects oversized, truncated, non-JSON and invalid UTF8 before parsing", async () => {
  for (const [response, code] of [
    [() => new Response("{}", { headers: { "content-type": "application/json", "content-length": "65537" } }), "response_too_large"],
    [() => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }), "response_too_large"],
    [() => new Response("{}", { headers: { "content-type": "application/json", "content-length": "30" } }), "oauth_invalid_response"],
    [() => new Response("secret html", { headers: { "content-type": "text/html" } }), "oauth_invalid_response"],
    [() => new Response(Buffer.from([0xff]), { headers: { "content-type": "application/json" } }), "oauth_invalid_response"],
    [() => json([]), "oauth_invalid_response"],
  ]) await assert.rejects(fixture({ oauth: response }).client.readWindow(WINDOW), rejects(code));
  const tooManyChunks = fixture({ oauth: () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array([32])); },
  }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(tooManyChunks.client.readWindow(WINDOW), rejects("response_too_large"));
  const emptyChunks = fixture({ oauth: () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array()); },
  }), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(emptyChunks.client.readWindow(WINDOW), rejects("oauth_invalid_response"));
  const oversizedQuery = fixture({ query: () => new Response("x".repeat(3 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(oversizedQuery.client.readWindow(WINDOW), rejects("response_too_large"));
});

test("reported paths stay raw for downstream privacy validation, and typed failure messages stay sanitized", async () => {
  const page = "https://www.mshpit.com/private/../artist/fixture";
  const { client } = fixture({ query: body => json(body.dimensions ? rows("byPage", [{ keys: [page], ...METRICS }]) : stats(body)) });
  assert.equal((await client.readWindow(WINDOW)).pages[0].page, page);
  const failure = new SearchConsoleClientError("oauth_unavailable");
  failure.message = "secret credential";
  await assert.rejects(fixture({ oauth: () => { throw failure; } }).client.readWindow(WINDOW), rejects("oauth_unavailable"));
  const controller = new AbortController(); let release;
  const waiting = fixture({ oauth: () => new Promise(resolve => { release = resolve; }) });
  const pending = waiting.client.readWindow({ ...WINDOW, signal: controller.signal });
  const rejected = assert.rejects(pending, rejects("request_aborted"));
  await flushUntil(() => !!release); controller.abort(failure); await rejected;
  release(json(TOKEN));
});

test("request deadlines bound fetch and streaming even when transport ignores abort", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hanging = fixture({ oauth: () => new Promise(() => {}) });
  const request = hanging.client.readWindow(WINDOW);
  const rejected = assert.rejects(request, rejects("request_timeout"));
  await flushUntil(() => hanging.calls.length === 1); t.mock.timers.tick(10_000); await rejected;
  let read = false; let cancelled = false;
  const stream = fixture({ oauth: () => new Response(new ReadableStream({ pull() { read = true; return new Promise(() => {}); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/json" } }) });
  const streaming = stream.client.readWindow(WINDOW);
  const streamRejected = assert.rejects(streaming, rejects("request_timeout"));
  await flushUntil(() => read); t.mock.timers.tick(10_000); await streamRejected;
  assert.equal(cancelled, true);
});

test("stream abort and late responses clean up without returning partial results or leaking reasons", async () => {
  const controller = new AbortController(); let reading = false; let cancelled = false;
  const { client } = fixture({ query: () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('{"rows":[')); },
    pull() { reading = true; return new Promise(() => {}); }, cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json" } }) });
  const readingWindow = client.readWindow({ ...WINDOW, signal: controller.signal });
  const rejected = assert.rejects(readingWindow, rejects("request_aborted"));
  await flushUntil(() => reading); controller.abort(new Error("secret raw reason")); await rejected; assert.equal(cancelled, true);
  const before = new AbortController(); before.abort();
  const never = fixture(); await assert.rejects(never.client.readWindow({ ...WINDOW, signal: before.signal }), rejects("request_aborted")); assert.equal(never.calls.length, 0);
  let release; let lateCancelled = false;
  const lateController = new AbortController();
  const late = fixture({ oauth: () => new Promise(resolve => { release = resolve; }) });
  const pending = late.client.readWindow({ ...WINDOW, signal: lateController.signal });
  const lateRejected = assert.rejects(pending, rejects("request_aborted"));
  await flushUntil(() => !!release); lateController.abort(); await lateRejected;
  release({ body: { cancel() { lateCancelled = true; } } });
  await flushUntil(() => lateCancelled);
});
