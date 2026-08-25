import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Importing the application API client in bare Node also imports React Native.
// Keep this wiring contract focused and test the shared payload sanitizer in its
// domain test; runtime feature tests exercise this service through SearchScreen.
const source = await readFile(new URL("./guestSearchAnalyticsApi.mjs", import.meta.url), "utf8");

test("guest search service is guest-bound, best-effort, and sends no raw search fields", () => {
  assert.match(source, /export async function recordGuestSearch/);
  assert.match(source, /sanitizeGuestSearchPayload\(payload\)/);
  assert.match(source, /\/api\/analytics\/guest-search/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /expectedAccountId: null/);
  assert.match(source, /silent: true/);
  assert.doesNotMatch(source, /localStorage|AsyncStorage|SecureStore|setInterval|retry/i);
  assert.doesNotMatch(source, /body:\s*\{[^}]*\b(?:q|query|ip|userId|deviceId|url|at)\b/s);
});
