import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

function configuredFalseCount(source, key) {
  const pattern = new RegExp(`^\\s*- key: ${key}\\r?\\n\\s*value: ["']false["']`, "gm");
  return [...source.matchAll(pattern)].length;
}

function configuredTrueCount(source, key) {
  const pattern = new RegExp(`^\\s*- key: ${key}\\r?\\n\\s*value: ["']true["']`, "gm");
  return [...source.matchAll(pattern)].length;
}

test("both Render services gate deployment on the full check in isolated build storage", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const commands = [...source.matchAll(/^\s*buildCommand:\s*(.+)$/gm)].map((match) => match[1]);
  assert.equal(commands.length, 2, "production and staging both declare a build command");
  for (const command of commands) {
    assert.match(command, /npm run check(?:\s|$)/);
    assert.match(command, /PIT_DATA_DIR=\/tmp\/pit-build-data/);
    assert.match(command, /PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true/);
  }
});

test("runtime bootstrap and high-cost background jobs fail closed on both Render services", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  assert.equal(configuredFalseCount(source, "PIT_ALLOW_EMPTY_DB_BOOTSTRAP"), 2);
  assert.equal(configuredFalseCount(source, "CACHE_WARM_ENABLED"), 2);
  assert.equal(configuredFalseCount(source, "TOURDATE_REFRESH_ENABLED"), 2);
  assert.equal(configuredTrueCount(source, "BACKUP_ENABLED"), 2);
  assert.equal([...source.matchAll(/^\s*- key: BACKUP_S3_BUCKET$/gm)].length, 2, "each service exposes a separate private off-host backup setting");
});

test("quality runs on both branches that Render auto-deploys", async () => {
  const source = await readFile(new URL(".github/workflows/quality.yml", ROOT), "utf8");
  assert.match(source, /branches:\s*\[master, staging\]/);
});
