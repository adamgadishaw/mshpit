import { Platform } from "react-native";
import { clientCrashDiagnostic, clientCrashRequestId, clientErrorSurface, normalizeClientCrashReport } from "../domain/clientCrashReport.mjs";
import { apiUrl } from "./api";

const DEDUPE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RECENT_REPORTS = 128;
const recentlyReported = new Map();

const currentSurface = () => {
  if (Platform.OS !== "web" || typeof window === "undefined") return "app";
  return clientErrorSurface(window.location?.pathname);
};

// This is deliberately not the ordinary authenticated API client. Crash
// telemetry must not wait on account hydration, create a toast, send cookies,
// or recursively diagnose its own failure.
export async function reportClientCrash({ kind, error, surface = currentSurface(), platform = Platform.OS } = {}) {
  const origin = platform === "web" && typeof window !== "undefined" ? window.location?.origin : undefined;
  const report = normalizeClientCrashReport({ kind, surface, platform, ...clientCrashDiagnostic(error, { origin }) });
  if (!report) return false;
  if (typeof __DEV__ !== "undefined" && __DEV__) return false;

  const now = Date.now();
  for (const [previousKey, reportedAt] of recentlyReported) {
    if (now - reportedAt >= DEDUPE_MS) recentlyReported.delete(previousKey);
  }
  // One bug whose message varies (an id, a count) is still one report per window.
  const identity = { ...report };
  delete identity.message;
  const key = JSON.stringify(identity);
  if (now - (recentlyReported.get(key) || 0) < DEDUPE_MS) return false;
  if (recentlyReported.size >= MAX_RECENT_REPORTS) recentlyReported.delete(recentlyReported.keys().next().value);
  recentlyReported.set(key, now);

  const options = {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: report.kind,
      platform: report.platform,
      surface: report.surface,
      ...(report.errorType ? { errorType: report.errorType, diagnosis: report.diagnosis } : {}),
      ...(report.location ? { location: report.location } : {}),
      ...(report.message ? { message: report.message } : {}),
    }),
  };
  if (Platform.OS === "web") {
    options.keepalive = true;
    options.referrerPolicy = "no-referrer";
  }

  let timeout;
  try {
    const controller = new AbortController();
    options.signal = controller.signal;
    // Bound completion even if a platform fetch does not settle after abort.
    const deadline = new Promise((resolve) => {
      timeout = setTimeout(() => { controller.abort(); resolve(false); }, REQUEST_TIMEOUT_MS);
    });
    const request = fetch(apiUrl("/api/client-errors"), options).then((response) => response.ok
      ? { requestId: clientCrashRequestId(response.headers?.get?.("X-Request-Id")) }
      : false);
    return await Promise.race([request, deadline]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function resetClientCrashReporterForTests() {
  recentlyReported.clear();
}
