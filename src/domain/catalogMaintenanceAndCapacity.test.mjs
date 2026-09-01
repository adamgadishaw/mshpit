import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("catalog photo repair leaves the browser request and runs as a resumable job", () => {
  const screen = read("../screens/AdminScreen.jsx");

  assert.match(screen, /startCatalogSeed\(\{ mode: "photos" \}\)/);
  assert.match(screen, />Fill missing photos</);
  assert.match(screen, /seedJob\.mode === "photos"/);
  assert.match(screen, /await enrichArtists\(\[name\]\)/, "one-artist manual repair remains available");
  assert.doesNotMatch(screen, /seedNames\(/, "the old multi-artist browser request is removed");
  assert.doesNotMatch(screen, /catalog\.thin\.map\(\(t\) => t\.name\)/);
  assert.doesNotMatch(screen, /catalog\.missing\.map\(\(m\) => m\.name\)/);
});

test("the local capacity harness models trusted Render visitor addresses and refuses remote targets", () => {
  const benchmark = read("../../scripts/benchmark-read.mjs");

  assert.match(benchmark, /\"CF-Connecting-IP\"/);
  assert.match(benchmark, /Refusing to benchmark a non-local server/);
  assert.match(benchmark, /\["localhost", "127\.0\.0\.1", "::1"\]/);
});

test("the capacity fixture registers Pit SQLite functions before preparing triggered inserts", () => {
  const fixture = read("../../scripts/seed-capacity-fixture.mjs");
  const openedAt = fixture.indexOf("const database = new DatabaseSync(resolved)");
  const registeredAt = fixture.indexOf("registerPitSqliteFunctions(database)");
  const preparedAt = fixture.indexOf("const insertPost = database.prepare");

  assert.ok(openedAt >= 0);
  assert.ok(registeredAt > openedAt);
  assert.ok(preparedAt > registeredAt);
});

test("the capacity fixture resolves junctions and refuses the repository database", () => {
  const fixture = read("../../scripts/seed-capacity-fixture.mjs");

  assert.match(fixture, /realpathSync\(resolve\(databasePath\)\)/);
  assert.match(fixture, /resolved === realpathSync\(repositoryDatabase\)/);
  assert.match(fixture, /Refusing to seed the repository database/);
});
