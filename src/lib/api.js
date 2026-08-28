// Client for the Pit backend (server/). Same-origin in production (the server
// serves the web build); in Expo dev (port 8081) it targets localhost:3000.
// Every call sends the httpOnly session cookie. Failures become typed AppErrors,
// enter the safe diagnostics history, and show feedback for mutating requests.
import { Platform } from "react-native";
import { AppError, captureAppError } from "./diagnostics";
import { createRequestControl } from "./requestControl.mjs";
import { apiIdentityBarrierDecision } from "../domain/apiIdentityState.mjs";

const DEV_WEB = Platform.OS === "web" && typeof window !== "undefined" && window.location.port === "8081";
const CONFIGURED_ORIGIN = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "");
const BASE = CONFIGURED_ORIGIN || (DEV_WEB ? "http://localhost:3000" : Platform.OS === "web" ? "" : "https://www.mshpit.com");

// Cookies are origin-wide on the web, while React state is tab-local. Bind every
// account-scoped request to the identity the tab believes it owns so a login in
// another tab cannot silently turn an old tab's action into the new account's
// action. `/api/me` is the sole identity-discovery call and opts out explicitly.
let apiIdentity = { accountId: null, ready: false, generation: 0 };
let resolveIdentityReady;
let identityReady = new Promise((resolve) => { resolveIdentityReady = resolve; });

export function configureApiIdentity(accountId, { ready = true } = {}) {
  const normalized = accountId ? String(accountId) : null;
  if (apiIdentity.accountId !== normalized || apiIdentity.ready !== !!ready) {
    apiIdentity = { accountId: normalized, ready: !!ready, generation: apiIdentity.generation + 1 };
    if (apiIdentity.ready) {
      resolveIdentityReady?.();
    } else {
      identityReady = new Promise((resolve) => { resolveIdentityReady = resolve; });
    }
  }
  return apiIdentity.generation;
}

// Absolute URL for routes that leave the app shell. Web production intentionally
// stays same-origin; native uses EXPO_PUBLIC_API_URL or the production origin.
export const apiUrl = (path) => BASE + path;

const operationContext = (method) => {
  if (method === "GET" || method === "HEAD") return "Loading fresh data";
  if (method === "DELETE") return "Removing an item";
  if (method === "PATCH" || method === "PUT") return "Saving changes";
  return "Publishing a change";
};

function apiFailure(error, { path, method, context, silent, kind, status, requestId, serverCode } = {}) {
  const appError = error instanceof AppError ? error : new AppError(error?.message, {
    kind,
    status,
    requestId,
    serverCode,
    context,
    source: "api",
    cause: error,
  });
  const mutating = method !== "GET" && method !== "HEAD";
  return captureAppError(appError, {
    context,
    source: "api",
    toast: mutating && !silent,
    meta: { method, path, status: appError.status, requestId: appError.requestId, serverCode: appError.serverCode },
  });
}

// `context` is a short operation label for Diagnostics. `silent` suppresses the
// toast only; the failure is still recorded. Existing { method, body } calls are
// fully backward compatible.
export async function api(path, { method = "GET", body, context, silent = false, signal, headers, timeoutMs, expectedAccountId, skipIdentityCheck = false, cache } = {}) {
  const verb = String(method || "GET").toUpperCase();
  const operation = context || operationContext(verb);
  const identityAtInvocation = apiIdentity;
  // Calls mounted during cold boot wait behind the authoritative `/api/me`
  // handshake. This avoids accidentally sending a cookie-authenticated A request
  // while the tab still renders guest/B state, without dropping one-shot loads.
  const barrierDecision = apiIdentityBarrierDecision(identityAtInvocation, { skipIdentityCheck, expectedAccountId });
  if (barrierDecision === "reject") {
    // A previously-authenticated tab must never queue A's click and replay it as
    // B after cross-tab validation adopts the new shared cookie identity.
    const err = new AppError("Your account is being revalidated. Try again in a moment.", {
      status: 409, serverCode: "IDENTITY_CHANGED", context: operation, source: "api",
    });
    throw apiFailure(err, { path, method: verb, context: operation, silent });
  }
  if (barrierDecision === "wait") {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    await Promise.race([
      identityReady,
      signal ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason || new DOMException("Aborted", "AbortError")), { once: true })) : new Promise(() => {}),
    ]);
  }
  let payload;
  try {
    payload = body === undefined ? undefined : JSON.stringify(body);
  } catch (error) {
    const invalidBody = new AppError(undefined, { code: "PIT-REQ-001", context: operation, source: "api", cause: error });
    throw apiFailure(invalidBody, { path, method: verb, context: operation, silent });
  }

  const control = createRequestControl({ method: verb, timeoutMs, callerSignal: signal });
  const identityAtStart = apiIdentity;
  const explicitExpected = expectedAccountId !== undefined ? (expectedAccountId ? String(expectedAccountId) : null) : undefined;
  const requestIdentity = explicitExpected !== undefined
    ? { accountId: explicitExpected, ready: true, generation: identityAtStart.generation }
    : identityAtStart;
  const identityHeaders = !skipIdentityCheck && requestIdentity.ready
    ? { "X-Pit-Expected-Account": requestIdentity.accountId || "guest" }
    : {};
  let res;
  try {
    res = await fetch(BASE + path, {
      method: verb,
      credentials: "include",
      headers: payload !== undefined
        ? { "Content-Type": "application/json", ...identityHeaders, ...headers }
        : { ...identityHeaders, ...headers },
      body: payload,
      signal: control.signal,
      ...(cache ? { cache } : {}),
    });
  } catch (error) {
    // Leaving a live screen intentionally cancels its read. That is lifecycle
    // cleanup, not a network failure, so do not add a false PIT-NET diagnostic.
    if (signal?.aborted && !control.didTimeout()) {
      control.cleanup();
      throw error;
    }
    const kind = control.didTimeout() ? "timeout" : signal?.aborted || error?.name === "AbortError" ? "abort" : "network";
    control.cleanup();
    throw apiFailure(error, { path, method: verb, context: operation, silent, kind });
  }

  let text;
  try {
    text = await res.text();
  } catch (error) {
    if (signal?.aborted && !control.didTimeout()) {
      control.cleanup();
      throw error;
    }
    const kind = control.didTimeout() ? "timeout" : signal?.aborted || error?.name === "AbortError" ? "abort" : "network";
    control.cleanup();
    throw apiFailure(error, { path, method: verb, context: operation, silent, kind, status: res.status });
  }
  control.cleanup();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      const requestId = res.headers?.get?.("x-request-id") || res.headers?.get?.("x-render-request-id");
      // Distinguish an intermediary from genuinely corrupt data. When a CDN,
      // proxy, or captive portal intercepts an API call it returns an HTML page
      // (a challenge, an "always online" cache, an error interstitial) with a
      // 200. That is not our server sending bad JSON — it is the request never
      // reaching us — so it is a retryable network condition, not the alarming
      // "response we could not safely read". Our API only ever emits JSON, which
      // starts with { or [; anything leading with < is someone else's HTML.
      const contentType = res.headers?.get?.("content-type") || "";
      const looksHtml = /^\s*</.test(text) || /text\/html/i.test(contentType);
      const failure = new AppError(undefined, {
        kind: looksHtml ? "network" : "invalid_response",
        status: res.status,
        requestId,
        context: operation,
        source: "api",
        cause: error,
      });
      throw apiFailure(failure, { path, method: verb, context: operation, silent });
    }
  }

  const requestId = res.headers?.get?.("x-request-id") || res.headers?.get?.("x-render-request-id") || data?.requestId;
  if (!res.ok) {
    const serverCode = typeof data?.code === "string" ? data.code : undefined;
    // Preserve actionable validation/auth copy for existing forms. Never surface
    // raw 5xx text, which may contain internal implementation details.
    const message = res.status < 500 && typeof data?.error === "string" ? data.error : undefined;
    const err = new AppError(message, {
      status: res.status,
      requestId,
      serverCode,
      retryable: typeof data?.retryable === "boolean" ? data.retryable : undefined,
      context: operation,
      source: "api",
    });
    throw apiFailure(err, { path, method: verb, context: operation, silent });
  }
  // Even a correctly bound response can finish after this tab deliberately
  // adopted another account. Never hand that stale success to a Store callback
  // that would mutate the new account's local state.
  if (!skipIdentityCheck && expectedAccountId === undefined && identityAtStart.generation !== apiIdentity.generation) {
    const err = new AppError("Your account changed while that request was running. Try again.", {
      status: 409,
      serverCode: "IDENTITY_CHANGED",
      context: operation,
      source: "api",
    });
    throw apiFailure(err, { path, method: verb, context: operation, silent });
  }
  return data;
}

// True when the backend is reachable, lets the store fall back to local-only
// mode in dev instead of hard-failing when the server isn't running.
export async function serverUp() {
  try {
    await api("/api/health", { context: "Checking service availability", silent: true });
    return true;
  } catch {
    return false;
  }
}

export { AppError, captureAppError };
