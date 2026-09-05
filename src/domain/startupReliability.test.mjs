import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storeSource = await readFile(new URL("../store.js", import.meta.url), "utf8");
const tourDateApiSource = await readFile(new URL("../features/discovery/tourDateRangeApi.mjs", import.meta.url), "utf8");
const dmApiSource = await readFile(new URL("../features/chat/services/dmReadApi.mjs", import.meta.url), "utf8");

function functionBody(name, nextName) {
  const start = storeSource.indexOf(`const ${name} =`);
  const end = storeSource.indexOf(`const ${nextName} =`, start + 1);
  assert.notEqual(start, -1, `${name} should exist in the Store`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return storeSource.slice(start, end);
}

test("startup direct-message hydration requests summaries instead of full history", () => {
  const marker = "Hydrate only one summary row per conversation at startup";
  const start = storeSource.indexOf(marker);
  const end = storeSource.indexOf("// Slice 5:", start);
  assert.notEqual(start, -1, "startup DM hydration should be documented");
  assert.notEqual(end, -1, "startup DM hydration section should be bounded");
  const startupSection = storeSource.slice(start, end);

  assert.match(startupSection, /fetchDirectMessageSummaries\(\{ expectedAccountId: su\.id \}\)/);
  assert.match(dmApiSource, /api\("\/api\/me\/threads\?summary=1"/);
  assert.doesNotMatch(dmApiSource, /api\("\/api\/me\/threads"/);
});

test("shared startup tour dates use the bounded 30-day product window", () => {
  const body = functionBody("refreshTourDates", "loadDiscoverTourDateRange");
  assert.match(body, /fetchStartupTourDates\(\{/);
  assert.match(tourDateApiSource, /tourDateRangeRequestPath\(\{ days: 30, limit: DISCOVER_RANGE_MAX_EVENTS \}\)/);
  assert.match(body, /homeCountry: session\?\.home\?\.country \|\| countryForCity\(session\?\.home\?\.city\)/);
  assert.match(body, /ENABLE_DEMO_DATA \|\| partial/);
  assert.match(tourDateApiSource, /Promise\.allSettled/);
  assert.match(tourDateApiSource, /country: homeCountry/);
  assert.match(tourDateApiSource, /mergeStartupTourDatePages/);
  assert.doesNotMatch(body, /api\("\/api\/tourdates"/);
});
