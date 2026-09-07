import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("retired catalog cron skips without a false failure alert or a claim that it refreshed data", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./cron-scrape.mjs", import.meta.url))], { encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 0);
  const message = JSON.parse(result.stdout.trim());
  assert.equal(message.code, "RETIRED_CATALOG_CRON");
  assert.equal(message.status, "skipped");
  assert.equal(message.dataChanged, false);
  assert.match(message.message, /did not refresh/);
  assert.match(message.action, /Disable.*Cron Job in Render/);
  assert.match(message.action, /web-service logs/);
  assert.equal(result.stderr, "");
});
