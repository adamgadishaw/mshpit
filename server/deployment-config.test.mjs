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

test("the production Render service gates deployment on deterministic checks in isolated build storage", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const commands = [...source.matchAll(/^\s*buildCommand:\s*(.+)$/gm)].map((match) => match[1]);
  assert.equal(commands.length, 1, "the production web service declares one build command");
  for (const command of commands) {
    assert.match(command, /npm run check:deploy(?:\s|$)/);
    assert.match(command, /PIT_DATA_DIR=\/tmp\/pit-build-data/);
    assert.match(command, /PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true/);
  }

  const packageJson = JSON.parse(await readFile(new URL("package.json", ROOT), "utf8"));
  assert.match(packageJson.scripts.check, /check:dependencies/, "CI retains the live dependency advisory gate");
  assert.doesNotMatch(packageJson.scripts["check:deploy"], /check:dependencies|npm audit/,
    "a transient advisory-service outage cannot block an otherwise verified deploy");
  for (const gate of ["test", "check:syntax", "check:architecture", "build:web"]) {
    assert.match(packageJson.scripts["check:deploy"], new RegExp(`npm run ${gate.replace(":", "\\:")}`));
  }

  const servicePlans = [...source.matchAll(/^\s*plan:\s*(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(servicePlans, ["1c-2g", "1c-2g"],
    "web and verifier must codify the paid 1 CPU / 2 GiB plan instead of relying on dashboard drift");
  assert.equal([...source.matchAll(/^\s*autoDeployTrigger:\s*checksPass\s*$/gm)].length, 2,
    "both runtime services must wait for the master Quality check");
  assert.doesNotMatch(source, /^\s*autoDeploy:\s*/m,
    "the deprecated commit-immediate deploy switch must not return");
});

test("the expensive verifier rebuilds only when one of its complete runtime inputs changes", async () => {
  const source = (await readFile(new URL("render.yaml", ROOT), "utf8")).replace(/\r\n/g, "\n");
  const verifier = source.slice(source.indexOf("  - type: pserv\n    name: pit-video-verifier\n"));
  for (const runtimeInput of [
    "Dockerfile.video-verifier",
    "package.json",
    "render.yaml",
    "server/mediaDeliveryPolicy.js",
    "server/videoVerifierProtocol.js",
    "server/videoVerifierService.js",
    "src/domain/mediaUploadPolicy.mjs",
  ]) {
    assert.ok(verifier.split("\n").some((line) => line.trim() === `- ${runtimeInput}`),
      `${runtimeInput} must trigger a verifier image build`);
  }
  assert.match(verifier, /^\s*buildFilter:\s*\n\s*paths:\s*$/m);
});

test("the production Render service verifies a persistent-disk snapshot before migrations", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const commands = [...source.matchAll(/^\s*startCommand:\s*(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(commands, ["node scripts/start-production.mjs"]);

  const launcher = await readFile(new URL("scripts/start-production.mjs", ROOT), "utf8");
  assert.match(launcher, /backup-db\.mjs/);
  assert.match(launcher, /await loadServer\(\)/);
  assert.ok(launcher.indexOf("runStartupBackup") < launcher.indexOf("await loadServer()"));
});

test("the test runner cannot inherit Render's hosted runtime or bootstrap approval", async () => {
  const source = await readFile(new URL("scripts/run-tests.mjs", ROOT), "utf8");
  assert.match(source, /NODE_ENV:\s*["']test["']/);
  assert.match(source, /PIT_ENV:\s*["']production["']/);
  assert.match(source, /PIT_ALLOW_EMPTY_DB_BOOTSTRAP:\s*["']false["']/);
  assert.match(source, /delete\s+testEnvironment\.RENDER/);
  assert.match(source, /delete\s+testEnvironment\.RESEND_API_KEY/);
  assert.match(source, /delete\s+testEnvironment\.MAIL_FROM/);
  assert.match(source, /env:\s*testEnvironment/);
});

test("Render health checks stay core-only while manual release verification remains strict", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const healthPaths = [...source.matchAll(/^\s*healthCheckPath:\s*(\S+)$/gm)].map((match) => match[1]);
  assert.deepEqual(healthPaths, ["/api/health"]);
  assert.doesNotMatch(source, /^\s*healthCheckPath:\s*\/api\/readiness$/m,
    "an optional R2 or verifier outage must not restart the web service");

  const api = await readFile(new URL("server/api.js", ROOT), "utf8");
  assert.match(api, /"GET \/api\/readiness": \(\) => deploymentReadinessProjection\(\)/);
  assert.match(api, /if \(videoRequired && runtimeMediaPublishingCapabilities\(\)\.videos !== true\) \{\s*throw new ApiError\(503/,
    "manual release verification must retain the strict media dependency gate");
});

test("runtime bootstrap fails closed while production alone owns the bounded tour refresh", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  assert.equal(configuredFalseCount(source, "PIT_ALLOW_EMPTY_DB_BOOTSTRAP"), 1);
  assert.equal(configuredFalseCount(source, "CACHE_WARM_ENABLED"), 1);
  assert.equal(configuredFalseCount(source, "TOURDATE_REFRESH_ENABLED"), 0);
  assert.equal(configuredTrueCount(source, "TOURDATE_REFRESH_ENABLED"), 1);
  assert.equal(configuredTrueCount(source, "BACKUP_ENABLED"), 1);
  assert.equal(configuredTrueCount(source, "MEDIA_CLEANUP_ENABLED"), 1);
  assert.equal([...source.matchAll(/^\s*- key: MEDIA_ORPHAN_TTL_MS$/gm)].length, 1);
  assert.equal([...source.matchAll(/^\s*- key: BACKUP_S3_BUCKET$/gm)].length, 1,
    "production exposes its private off-host backup setting");
  assert.match(source, /PutObject, DeleteObject, and ListBucket/);
  assert.match(source, /BACKUP_KEEP controls\s*\n\s*# local files only/);
});

test("only production carries the bounded legacy-poster release identity", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const assignments = [...source.matchAll(/^\s*- key: PIT_LEGACY_VIDEO_POSTER_RELEASE\r?\n\s*value: ([^\s#]+)$/gm)];
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0][1], "2026-08-22-v1");
  const productionStart = source.search(/^\s*name: mshpit\s*$/m);
  const verifierStart = source.search(/^\s*- type: pserv\r?\n\s*name: pit-video-verifier\s*$/m);
  assert.ok(productionStart >= 0 && assignments[0].index > productionStart && assignments[0].index < verifierStart,
    "the production web service alone carries deletion authority");
});

test("quality runs on the production branch that Render auto-deploys", async () => {
  const source = await readFile(new URL(".github/workflows/quality.yml", ROOT), "utf8");
  assert.match(source, /branches:\s*\[master\]/);
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
    "OWNER_EMAIL",
    "OWNER_MIGRATION_EMAIL",
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
    const isVerifierSecret = key === "PIT_VIDEO_VERIFIER_SECRET";
    const isGeneratedVerifierSecret = isVerifierSecret && /^\s*generateValue:\s*true\s*(?:#.*)?$/m.test(block);
    const isPrivateServiceReference = isVerifierSecret
      && /^\s*fromService:\s*$/m.test(block)
      && /^\s*type:\s*pserv\s*$/m.test(block)
      && /^\s*name:\s*pit-video-verifier\s*$/m.test(block)
      && /^\s*envVarKey:\s*PIT_VIDEO_VERIFIER_SECRET\s*$/m.test(block);
    assert.ok(
      /^\s*sync:\s*false\s*(?:#.*)?$/m.test(block) || isGeneratedVerifierSecret || isPrivateServiceReference,
      `${key} must be supplied by or generated inside the host secret store`,
    );
    assert.doesNotMatch(block, /^\s*value\s*:/m, `${key} must not have a tracked value`);
  }
  for (const key of privateKeys) assert.ok(seen.get(key), `${key} is missing from the deployment contract`);
  assert.equal(seen.get("OWNER_EMAIL"), 1, "production must source Owner mail from Render rather than git");
  assert.equal(seen.get("OWNER_MIGRATION_EMAIL"), 1, "one-time Owner migration approval must remain a Render secret");
  assert.equal(seen.get("ADMIN_EMAIL"), 1, "production must source the administrator identity from Render");
  assert.equal(seen.get("PIT_VIDEO_VERIFIER_SECRET"), 2,
    "production references the verifier's generated secret");
});

test("the Blueprint declares only the explicit production web deployment", async () => {
  const source = await readFile(new URL("render.yaml", ROOT), "utf8");
  const verifierStart = source.search(/^\s*- type: pserv\r?\n\s*name: pit-video-verifier\s*$/m);
  assert.ok(verifierStart > 0);
  const productionWeb = source.slice(0, verifierStart);
  assert.match(productionWeb, /^\s*branch:\s*master\s*$/m);
  assert.match(productionWeb, /^\s*- key: PIT_ENV\r?\n\s*value: production\s*$/m);
  assert.doesNotMatch(source, /mshpit-staging|pit-staging-data|^\s*branch:\s*staging\s*$/m);
});

test("the retired catalog cron cannot place a GitHub token in process arguments", async () => {
  const source = await readFile(new URL("scripts/cron-scrape.mjs", ROOT), "utf8");
  assert.doesNotMatch(source, /GITHUB_TOKEN|x-access-token/i);
  assert.match(source, /retired/i);
  assert.match(source, /process\.exitCode\s*=\s*1/);
});
