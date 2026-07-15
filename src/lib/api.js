// Client for the Pit backend (server/). Same-origin in production (the server
// serves the web build); in Expo dev (port 8081) it targets localhost:3000.
// Every call sends the httpOnly session cookie. Failures become typed AppErrors,
// enter the safe diagnostics history, and show feedback for mutating requests.
import { Platform } from "react-native";
import { AppError, captureAppError } from "./diagnostics";
import { createRequestControl } from "./requestControl.mjs";

const DEV_WEB = Platform.OS === "web" && typeof window !== "undefined" && window.location.port === "8081";
const CONFIGURED_ORIGIN = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "");
const BASE = CONFIGURED_ORIGIN || (DEV_WEB ? "http://localhost:3000" : Platform.OS === "web" ? "" : "https://www.mshpit.com");

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
export async function api(path, { method = "GET", body, context, silent = false, signal, headers, timeoutMs } = {}) {
  const verb = String(method || "GET").toUpperCase();
  const operation = context || operationContext(verb);
  let payload;
  try {
    payload = body === undefined ? undefined : JSON.stringify(body);
  } catch (error) {
    const invalidBody = new AppError(undefined, { code: "PIT-REQ-001", context: operation, source: "api", cause: error });
    throw apiFailure(invalidBody, { path, method: verb, context: operation, silent });
  }

  const control = createRequestControl({ method: verb, timeoutMs, callerSignal: signal });
  let res;
  try {
    res = await fetch(BASE + path, {
      method: verb,
      credentials: "include",
      headers: payload !== undefined ? { "Content-Type": "application/json", ...headers } : headers,
      body: payload,
      signal: control.signal,
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
      const malformed = new AppError(undefined, {
        kind: "invalid_response",
        status: res.status,
        requestId,
        context: operation,
        source: "api",
        cause: error,
      });
      throw apiFailure(malformed, { path, method: verb, context: operation, silent });
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
