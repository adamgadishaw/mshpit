import { Platform } from "react-native";
import { clientErrorSurface, normalizeClientCrashReport } from "../domain/clientCrashReport.mjs";
import { apiUrl } from "./api";

const DEDUPE_MS = 30_000;
const recentlyReported = new Map();

const currentSurface = () => {
  if (Platform.OS !== "web" || typeof window === "undefined") return "app";
  return clientErrorSurface(window.location?.pathname);
};

// This is deliberately not the ordinary authenticated API client. Crash
// telemetry must not wait on account hydration, create a toast, send cookies,
// or recursively diagnose its own failure.
export async function reportClientCrash({ kind, surface = currentSurface(), platform = Platform.OS } = {}) {
  const report = normalizeClientCrashReport({ kind, surface, platform });
  if (!report) return false;
  if (typeof __DEV__ !== "undefined" && __DEV__) return false;

  const now = Date.now();
  const key = [report.kind, report.platform, report.surface].join(":");
  if (now - (recentlyReported.get(key) || 0) < DEDUPE_MS) return false;
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
    }),
  };
  if (Platform.OS === "web") {
    options.keepalive = true;
    options.referrerPolicy = "no-referrer";
  }

  try {
    const response = await fetch(apiUrl("/api/client-errors"), options);
    return response.ok;
  } catch {
    return false;
  }
}

export function resetClientCrashReporterForTests() {
  recentlyReported.clear();
}
