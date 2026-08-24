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

test("both Render services verify a persistent-disk snapshot before migrations", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const commands = [...source.matchAll(/^\s*startCommand:\s*(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(commands, ["node scripts/start-production.mjs", "node scripts/start-production.mjs"]);

  const launcher = await readFile(new URL("scripts/start-production.mjs", ROOT), "utf8");
  assert.match(launcher, /backup-db\.mjs/);
  assert.match(launcher, /await loadServer\(\)/);
  assert.ok(launcher.indexOf("runStartupBackup") < launcher.indexOf("await loadServer()"));
});

test("the test runner cannot inherit Render's production bootstrap approval", async () => {
  const source = await readFile(new URL("scripts/run-tests.mjs", ROOT), "utf8");
  assert.match(source, /NODE_ENV:\s*["']test["']/);
  assert.match(source, /PIT_ENV:\s*["']production["']/);
  assert.match(source, /PIT_ALLOW_EMPTY_DB_BOOTSTRAP:\s*["']false["']/);
});

test("runtime bootstrap fails closed while production alone owns the bounded tour refresh", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  assert.equal(configuredFalseCount(source, "PIT_ALLOW_EMPTY_DB_BOOTSTRAP"), 2);
  assert.equal(configuredFalseCount(source, "CACHE_WARM_ENABLED"), 2);
  assert.equal(configuredFalseCount(source, "TOURDATE_REFRESH_ENABLED"), 1);
  assert.equal(configuredTrueCount(source, "TOURDATE_REFRESH_ENABLED"), 1);
  const stagingStart = source.indexOf("name: mshpit-staging");
  assert.equal(configuredTrueCount(source.slice(0, stagingStart), "TOURDATE_REFRESH_ENABLED"), 1);
  assert.equal(configuredTrueCount(source, "BACKUP_ENABLED"), 2);
  assert.equal(configuredTrueCount(source, "MEDIA_CLEANUP_ENABLED"), 2);
  assert.equal([...source.matchAll(/^\s*- key: MEDIA_ORPHAN_TTL_MS$/gm)].length, 2);
  assert.equal([...source.matchAll(/^\s*- key: BACKUP_S3_BUCKET$/gm)].length, 2, "each service exposes a separate private off-host backup setting");
  assert.match(source, /PutObject, DeleteObject, and ListBucket/);
  assert.match(source, /BACKUP_KEEP controls\s*\n\s*# local files only/);
});

test("only production carries the bounded legacy-poster release identity", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const assignments = [...source.matchAll(/^\s*- key: PIT_LEGACY_VIDEO_POSTER_RELEASE\r?\n\s*value: ([^\s#]+)$/gm)];
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0][1], "2026-08-22-v1");
  const stagingStart = source.indexOf("name: mshpit-staging");
  assert.ok(stagingStart > 0);
  assert.ok(assignments[0].index < stagingStart, "staging must not inherit production deletion authority");
});

test("quality runs on both branches that Render auto-deploys", async () => {
  const source = await readFile(new URL(".github/workflows/quality.yml", ROOT), "utf8");
  assert.match(source, /branches:\s*\[master, staging\]/);
});

test("CI actions are immutable and checkout does not persist a repository credential", async () => {
  const source = await readFile(new URL(".github/workflows/quality.yml", ROOT), "utf8");
  const actionUses = [...source.matchAll(/^\s*- uses:\s*([^\s#]+)(?:\s*#.*)?$/gm)].map((match) => match[1]);
  assert.ok(actionUses.length >= 2, "expected the checkout and Node setup actions");
  for (const action of actionUses) {
    assert.match(action, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/,
      `${action} must be pinned to an immutable full commit SHA`);
  }
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(source, /persist-credentials:\s*false/);
});

test("Render never stores private credentials in the tracked blueprint", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const privateKeys = new Set([
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "YOUTUBE_API_KEY",
    "RESEND_API_KEY",
    "TICKETMASTER_KEY",
    "MEDIA_ACCESS_KEY_ID",
    "MEDIA_SECRET_ACCESS_KEY",
    "BACKUP_S3_ACCESS_KEY_ID",
    "BACKUP_S3_SECRET_ACCESS_KEY",
    "PIT_VIDEO_VERIFIER_SECRET",
  ]);
  const blocks = source.split(/(?=^\s*- key: )/gm);
  const seen = new Map();
  for (const block of blocks) {
    const key = /^\s*- key:\s*([A-Z0-9_]+)/m.exec(block)?.[1];
    if (!privateKeys.has(key)) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
    assert.match(block, /^\s*sync:\s*false\s*(?:#.*)?$/m, `${key} must be supplied by the host secret store`);
    assert.doesNotMatch(block, /^\s*value\s*:/m, `${key} must not have a tracked value`);
  }
  for (const key of privateKeys) assert.ok(seen.get(key), `${key} is missing from the deployment contract`);
  assert.equal(seen.get("ADMIN_EMAIL"), 2, "production and staging must each source the administrator identity from Render");
});

test("the retired catalog cron cannot place a GitHub token in process arguments", async () => {
  const source = await readFile(new URL("scripts/cron-scrape.mjs", ROOT), "utf8");
  assert.doesNotMatch(source, /GITHUB_TOKEN|x-access-token/i);
  assert.match(source, /retired/i);
  assert.match(source, /process\.exitCode\s*=\s*1/);
});
