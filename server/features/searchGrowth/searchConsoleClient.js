import { createPrivateKey, sign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const READ_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DAY = 86_400_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_LIMIT = 1000;
const CODES = new Set([
  "missing_property", "invalid_property", "missing_credentials", "invalid_credentials", "invalid_window",
  "oauth_unavailable", "oauth_rejected", "oauth_invalid_response",
  "query_unavailable", "query_rejected", "query_invalid_response",
  "response_too_large", "request_timeout", "request_aborted",
]);

export class SearchConsoleClientError extends Error {
  constructor(code, httpStatus = null) {
    const safeCode = CODES.has(code) ? code : "query_unavailable";
    super("Search Console data could not be read.");
    this.name = "SearchConsoleClientError";
    this.code = safeCode;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
  }
}
const fail = (code, status) => new SearchConsoleClientError(code, status);

function configuration(env) {
  const rawProperty = env?.SEARCH_CONSOLE_PROPERTY;
  const missing = value => value == null || (typeof value === "string" && !value.trim());
  if (missing(rawProperty)) return { configured: false, reason: "missing_property", property: null };
  const value = typeof rawProperty === "string" && rawProperty.length <= 256 ? rawProperty.trim().toLowerCase() : "";
  let property = null;
  if (value === "sc-domain:mshpit.com") property = value;
  else if (/^https:\/\/(?:www\.)?mshpit\.com\/?$/u.test(value)) property = value.endsWith("/") ? value : value + "/";
  if (!property) return { configured: false, reason: "invalid_property", property: null };
  const emailValue = env?.SEARCH_CONSOLE_SERVICE_ACCOUNT_EMAIL;
  const keyValue = env?.SEARCH_CONSOLE_PRIVATE_KEY;
  if (missing(emailValue) || missing(keyValue)) return { configured: false, reason: "missing_credentials", property };
  const email = typeof emailValue === "string" && emailValue.length <= 320 ? emailValue.trim() : "";
  const keyText = typeof keyValue === "string" && keyValue.length <= 16_384
    ? keyValue.replace(/\\r\\n/gu, "\n").replace(/\\n/gu, "\n").trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+gserviceaccount\.com$/u.test(email)
    || !/^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n/u.test(keyText)) {
    return { configured: false, reason: "invalid_credentials", property };
  }
  try {
    const key = createPrivateKey(keyText);
    const bits = key.asymmetricKeyDetails?.modulusLength;
    if (key.asymmetricKeyType !== "rsa" || !Number.isInteger(bits) || bits < 2048 || bits > 4096) {
      return { configured: false, reason: "invalid_credentials", property };
    }
    return { configured: true, reason: "ready", property, email, key };
  } catch {
    // A configuration report contains no credential, PEM parser error or cause.
    return { configured: false, reason: "invalid_credentials", property };
  }
}

export function searchConsoleConfiguration(env = process.env) {
  const { configured, reason, property } = configuration(env);
  return Object.freeze({ configured, reason, property });
}

function assertActive(signal) {
  if (signal?.aborted) throw fail("request_aborted");
}

function cancelBody(body) {
  // architecture: allow-empty-catch -- best-effort body cleanup cannot prolong a bounded provider request or expose its rejection.
  try { void Promise.resolve(body?.cancel?.()).catch(() => {}); } catch { /* transport cleanup */ }
}

function waitFor(operation, signal, lateValue = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
      return true;
    };
    const onAbort = () => finish(reject, fail(signal?.reason instanceof SearchConsoleClientError
      && signal.reason.code === "request_timeout" ? "request_timeout" : "request_aborted"));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(value => {
      if (!finish(resolve, value)) lateValue?.(value);
    }, error => finish(reject, error));
  });
}

async function requestJson(fetchImpl, url, options, { stage, signal = null, maxBytes }) {
  assertActive(signal);
  const controller = new AbortController();
  const onAbort = () => controller.abort(fail("request_aborted"));
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(fail("request_timeout")), REQUEST_TIMEOUT_MS);
  let reader = null;
  let response = null;
  try {
    if (signal?.aborted) onAbort();
    if (controller.signal.aborted) throw controller.signal.reason;
    response = await waitFor(Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return fetchImpl(url, { ...options, redirect: "error", signal: controller.signal });
    }), controller.signal, late => cancelBody(late?.body));
    if (response?.redirected || (response?.url && response.url !== url)) throw fail(stage + "_rejected", response?.status);
    if (!response?.ok || !Number.isInteger(response.status) || response.status < 200 || response.status > 299) {
      throw fail(stage + "_rejected", response?.status);
    }
    const type = String(response.headers?.get?.("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    if (type !== "application/json") throw fail(stage + "_invalid_response");
    const rawLength = response.headers?.get?.("content-length");
    let declared = null;
    if (rawLength != null) {
      if (!/^\d+$/u.test(rawLength) || !Number.isSafeInteger(Number(rawLength))) throw fail(stage + "_invalid_response");
      declared = Number(rawLength);
      if (declared > maxBytes) throw fail("response_too_large");
    }
    reader = response.body?.getReader?.();
    if (!reader) throw fail(stage + "_invalid_response");
    const chunks = [];
    let length = 0;
    while (true) {
      if (controller.signal.aborted) throw controller.signal.reason;
      const part = await waitFor(reader.read(), controller.signal);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || !part.value.byteLength) throw fail(stage + "_invalid_response");
      if (chunks.length >= 4096) throw fail("response_too_large");
      length += part.value.byteLength;
      if (length > maxBytes) throw fail("response_too_large");
      chunks.push(Buffer.from(part.value));
    }
    if (controller.signal.aborted) throw controller.signal.reason;
    if (!length || (declared != null && declared !== length)) throw fail(stage + "_invalid_response");
    let value;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length))); }
    catch { throw fail(stage + "_invalid_response"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(stage + "_invalid_response");
    return value;
  } catch (error) {
    cancelBody(reader || response?.body);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof SearchConsoleClientError) throw fail(error.code, error.httpStatus);
    throw fail(stage + "_unavailable");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    // architecture: allow-empty-catch -- release an already cancelled/closed stream without surfacing provider internals.
    try { reader?.releaseLock?.(); } catch { /* transport cleanup */ }
  }
}

function validatedWindow(startDate, endDate) {
  const date = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return NaN;
    const at = Date.parse(value + "T00:00:00.000Z");
    return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value ? at : NaN;
  };
  const start = date(startDate), end = date(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 30 * DAY) throw fail("invalid_window");
  // Search Console interprets these calendar dates in Pacific Time. Do not
  // translate them to the server's UTC or Toronto calendar.
  return { startDate, endDate };
}

function metrics(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw fail("query_invalid_response");
  const result = {};
  for (const field of ["clicks", "impressions", "position", "ctr"]) {
    const value = row[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw fail("query_invalid_response");
    }
    result[field] = value;
  }
  if (result.ctr > 1 || result.clicks > result.impressions || (result.impressions > 0 && result.position < 1)) throw fail("query_invalid_response");
  return result;
}

function rowsOf(value, aggregation, limit) {
  const rows = value.rows === undefined ? [] : value.rows;
  if (Object.hasOwn(value, "error") || !Array.isArray(rows) || rows.length > limit
    || (value.responseAggregationType !== undefined && value.responseAggregationType !== aggregation)
    || (rows.length && value.responseAggregationType !== aggregation)) throw fail("query_invalid_response");
  return rows;
}

function pageUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)
    || !/^https?:\/\/(?:www\.)?mshpit\.com(?:\/|$)/iu.test(value)) throw fail("query_invalid_response");
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || !["mshpit.com", "www.mshpit.com"].includes(url.hostname)
      || url.username || url.password || url.port || url.hash || value.includes("\\")) throw fail("query_invalid_response");
    // Keep the reported URL intact: later privacy/path validation must see
    // dot segments and escapes, not a URL parser's normalized replacement.
    return value;
  } catch { throw fail("query_invalid_response"); }
}

export function createSearchConsoleClient({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const config = configuration(env);
  let cachedToken = null;
  let tokenFlight = null;
  const clock = () => {
    let at;
    try { at = Number(now()); } catch { throw fail("oauth_unavailable"); }
    if (!Number.isSafeInteger(at) || at < 0 || at > 8_640_000_000_000_000) throw fail("oauth_unavailable");
    return at;
  };
  const issueToken = async signal => {
    assertActive(signal);
    const issuedAt = clock();
    let assertion;
    try {
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ iss: config.email, scope: READ_SCOPE, aud: TOKEN_URL,
        iat: Math.floor(issuedAt / 1000), exp: Math.floor(issuedAt / 1000) + 3600 })).toString("base64url");
      const unsigned = header + "." + payload;
      assertion = unsigned + "." + sign("RSA-SHA256", Buffer.from(unsigned), config.key).toString("base64url");
    } catch { throw fail("invalid_credentials"); }
    const value = await requestJson(fetchImpl, TOKEN_URL, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    }, { stage: "oauth", signal, maxBytes: 64 * 1024 });
    if (typeof value.access_token !== "string" || value.access_token.length > 8192
      || !/^[A-Za-z0-9._~+/-]+=*$/u.test(value.access_token)
      || typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer"
      || !Number.isInteger(value.expires_in) || value.expires_in < 1 || value.expires_in > 3600
      || (value.scope !== undefined && value.scope !== READ_SCOPE)) throw fail("oauth_invalid_response");
    assertActive(signal);
    return { value: value.access_token, issuedAt, expiresAt: issuedAt + value.expires_in * 1000 - 60_000 };
  };
  const token = async signal => {
    assertActive(signal);
    const at = clock();
    if (cachedToken && at >= cachedToken.issuedAt && at < cachedToken.expiresAt) return cachedToken.value;
    if (!tokenFlight || tokenFlight.controller.signal.aborted) {
      const flight = { controller: new AbortController(), waiters: 0, settled: false, promise: null };
      flight.promise = issueToken(flight.controller.signal).then(value => {
        cachedToken = value;
        return value.value;
      }).finally(() => { flight.settled = true; if (tokenFlight === flight) tokenFlight = null; });
      tokenFlight = flight;
    }
    const flight = tokenFlight;
    flight.waiters += 1;
    try { return await waitFor(flight.promise, signal); }
    finally {
      flight.waiters -= 1;
      if (!flight.waiters && !flight.settled) flight.controller.abort(fail("request_aborted"));
    }
  };
  return Object.freeze({
    async readWindow({ startDate, endDate, signal = null } = {}) {
      if (!config.configured) throw fail(config.reason);
      const dates = validatedWindow(startDate, endDate);
      assertActive(signal);
      const accessToken = await token(signal);
      const url = "https://www.googleapis.com/webmasters/v3/sites/" + encodeURIComponent(config.property) + "/searchAnalytics/query";
      const query = async body => {
        try {
          return await requestJson(fetchImpl, url, { method: "POST", headers: {
            Authorization: "Bearer " + accessToken, "Content-Type": "application/json", Accept: "application/json",
          }, body: JSON.stringify({ ...dates, type: "web", dataState: "final", ...body }) },
          { stage: "query", signal, maxBytes: 3 * 1024 * 1024 });
        } catch (error) {
          if (error.httpStatus === 401 && cachedToken?.value === accessToken) cachedToken = null;
          throw error;
        }
      };
      const totalRows = rowsOf(await query({ aggregationType: "byProperty", rowLimit: 1 }), "byProperty", 1);
      if (totalRows[0]?.keys !== undefined && (!Array.isArray(totalRows[0].keys) || totalRows[0].keys.length)) throw fail("query_invalid_response");
      const totals = totalRows.length ? metrics(totalRows[0]) : { clicks: 0, impressions: 0, position: 0, ctr: 0 };
      const pageRows = rowsOf(await query({ aggregationType: "byPage", dimensions: ["page"], rowLimit: PAGE_LIMIT }), "byPage", PAGE_LIMIT);
      const seen = new Set();
      const pages = pageRows.map(row => {
        if (!Array.isArray(row?.keys) || row.keys.length !== 1) throw fail("query_invalid_response");
        const page = pageUrl(row.keys[0]);
        if (seen.has(page)) throw fail("query_invalid_response");
        seen.add(page);
        return { page, ...metrics(row) };
      });
      assertActive(signal);
      return { totals, pages, truncated: pageRows.length >= PAGE_LIMIT };
    },
  });
}
