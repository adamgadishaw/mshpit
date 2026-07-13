// Client for the Pit backend (server/). Same-origin in production (the server
// serves the web build); in Expo dev (port 8081) it targets localhost:3000.
// Every call sends the httpOnly session cookie; errors normalize to Error(message).
import { Platform } from "react-native";

const DEV_WEB = Platform.OS === "web" && typeof window !== "undefined" && window.location.port === "8081";
const CONFIGURED_ORIGIN = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/+$/, "");
const BASE = CONFIGURED_ORIGIN || (DEV_WEB ? "http://localhost:3000" : Platform.OS === "web" ? "" : "https://www.mshpit.com");

// Absolute URL for routes that leave the app shell. Web production intentionally
// stays same-origin; native uses EXPO_PUBLIC_API_URL or the production origin.
export const apiUrl = (path) => BASE + path;

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// True when the backend is reachable, lets the store fall back to local-only
// mode in dev instead of hard-failing when the server isn't running.
export async function serverUp() {
  try {
    const r = await fetch(BASE + "/api/health", { credentials: "include" });
    return r.ok;
  } catch {
    return false;
  }
}
