import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { parseDocument } from "yaml";
import { readProviderSchema, validateBlueprint } from "./check-render-blueprint.mjs";
import { admitClaudeSpend, anthropicMonthlyCeilingMicroUsd, claudeCeilingLeftMicroUsd, claudeMonthSpendMicroUsd } from "../server/claudeSpendCeiling.js";
import { catalogResearchDailyBudgetMicroUsd, catalogResearchMonthlyBudgetMicroUsd } from "../server/features/catalogResearch/catalogResearchService.js";

const schema = await readProviderSchema();
const source = await readFile(new URL("../render.yaml", import.meta.url), "utf8");

function webService() {
  return parseDocument(source).toJS().services.find((service) => service.name === "mshpit");
}

function postPruneGuardSource(buildCommand = webService().buildCommand) {
  const match = buildCommand.match(/\bnode -e "([^\"]+)"/);
  assert.ok(match, "Render build must include an executable post-prune dependency guard");
  return match[1];
}

async function writeResolvablePackage(root, name) {
  const directory = join(root, "node_modules", ...name.split("/"));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.js" }));
  await writeFile(join(directory, "index.js"), "module.exports = {};\n");
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function runNodeChain(commands, marker) {
  const node = JSON.stringify(process.execPath);
  const command = commands.map((script) => `${node} -e ${JSON.stringify(script)}`).join(" && ");
  return spawnSync(command, {
    cwd: process.cwd(),
    env: { ...process.env, PIT_PACKAGING_TEST_MARKER: marker },
    shell: true,
    encoding: "utf8",
  });
}
test("the Blueprint caps shared Claude spending at $10 monthly while keeping news off and catalogue daily pacing", () => {
  const web = parseDocument(source).toJS().services.find((service) => service.name === "mshpit");
  const env = Object.fromEntries(web.envVars.map((entry) => [entry.key, entry.value]));
  assert.equal(env.NEWS_DESK_DAILY_USD, "0.75");
  assert.equal(env.NEWS_DESK_MONTHLY_USD, "15");
  assert.equal(env.ANTHROPIC_MONTHLY_USD, "10");
  assert.equal(env.CATALOG_RESEARCH_DAILY_USD, "0.30");
  assert.equal(env.CATALOG_RESEARCH_MONTHLY_USD, "10");
  assert.equal(env.NEWS_DESK_ENABLED, "false");
  assert.equal(web.envVars.find((entry) => entry.key === "ANTHROPIC_API_KEY").sync, false);
});

test("the configured monthly allocation retains the daily clamp and honors smaller limits", () => {
  const env = Object.fromEntries(webService().envVars.map((entry) => [entry.key, entry.value]));
  assert.equal(anthropicMonthlyCeilingMicroUsd(env), 10_000_000);
  assert.equal(catalogResearchMonthlyBudgetMicroUsd(env), 10_000_000);
  assert.equal(catalogResearchDailyBudgetMicroUsd(env), 300_000);
  assert.equal(catalogResearchDailyBudgetMicroUsd({ ...env, CATALOG_RESEARCH_DAILY_USD: "10" }), 1_000_000,
    "even an increased daily setting cannot exceed one tenth of the monthly allowance");
  assert.equal(catalogResearchDailyBudgetMicroUsd({ ...env, CATALOG_RESEARCH_MONTHLY_USD: "2" }), 200_000);
  assert.equal(catalogResearchDailyBudgetMicroUsd({ ...env, CATALOG_RESEARCH_MONTHLY_USD: "0" }), 0);
});

test("the $10 Blueprint ceiling includes prior current-month news and catalogue usage without resetting ledgers", (t) => {
  const env = Object.fromEntries(webService().envVars.map((entry) => [entry.key, entry.value]));
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE catalog_research_spend(token TEXT PRIMARY KEY, utc_day TEXT, charged_micro_usd INTEGER);
    CREATE TABLE news_desk_spend(day TEXT PRIMARY KEY, usd REAL);
    CREATE TABLE news_desk_receipts(token TEXT PRIMARY KEY, day TEXT, charged_usd REAL);
    INSERT INTO catalog_research_spend VALUES ('previous-month','2026-09-30',50000000),('earlier-research','2026-10-01',6000000);
    INSERT INTO news_desk_spend VALUES ('2026-10-02',3.5);
    INSERT INTO news_desk_receipts VALUES ('pending-news','2026-10-15',0.25);`);
  const at = Date.parse("2026-10-15T12:00:00Z");
  assert.equal(claudeMonthSpendMicroUsd(database, at), 9_750_000,
    "current-month settled spending and pending reservations count; last month does not");
  assert.equal(claudeCeilingLeftMicroUsd(database, { env: { ...env, ANTHROPIC_MONTHLY_USD: "20" }, at }), 10_250_000);
  assert.equal(claudeCeilingLeftMicroUsd(database, { env, at }), 250_000,
    "changing the cap leaves $0.25, not a fresh $10 allowance");
  const read = (sql) => Number(database.prepare(sql).get().spent);
  const research = {
    env, at, reserveMicroUsd: 200_000,
    dailyCapMicroUsd: catalogResearchDailyBudgetMicroUsd(env),
    monthlyCapMicroUsd: catalogResearchMonthlyBudgetMicroUsd(env),
    readDailySpendMicroUsd: () => read("SELECT COALESCE(SUM(charged_micro_usd),0) spent FROM catalog_research_spend WHERE utc_day='2026-10-15'"),
    readMonthlySpendMicroUsd: () => read("SELECT SUM(charged_micro_usd) spent FROM catalog_research_spend WHERE utc_day>='2026-10-01'"),
    reserve: () => {
      database.prepare("INSERT INTO catalog_research_spend VALUES ('new-research','2026-10-15',200000)").run();
      return "new-research";
    },
  };
  assert.deepEqual(admitClaudeSpend(database, research), { ok: true, value: "new-research" });
  assert.equal(claudeMonthSpendMicroUsd(database, at), 9_950_000);
  const denied = () => assert.fail("exhausted shared headroom must prevent a new reservation");
  assert.deepEqual(admitClaudeSpend(database, { ...research, reserveMicroUsd: 100_000, reserve: denied }),
    { ok: false, reason: "claude_monthly_ceiling" });
  assert.deepEqual(admitClaudeSpend(database, {
    env, at, reserveMicroUsd: 100_000,
    dailyCapMicroUsd: Number(env.NEWS_DESK_DAILY_USD) * 1_000_000,
    monthlyCapMicroUsd: Number(env.NEWS_DESK_MONTHLY_USD) * 1_000_000,
    readDailySpendMicroUsd: () => 250_000, readMonthlySpendMicroUsd: () => 3_750_000, reserve: denied,
  }), { ok: false, reason: "claude_monthly_ceiling" },
  "the larger unchanged news feature allowance cannot bypass the shared ceiling");
  database.prepare("INSERT INTO news_desk_receipts VALUES ('earlier-uncertain-news','2026-10-14',0.10)").run();
  assert.equal(claudeCeilingLeftMicroUsd(database, { env, at }), 0);
  assert.deepEqual(admitClaudeSpend(database, { ...research, reserveMicroUsd: 1, reserve: denied }),
    { ok: false, reason: "claude_monthly_ceiling" });
  assert.equal(claudeMonthSpendMicroUsd(database, at), 10_050_000,
    "existing usage above the new cap is preserved and stops further reservations");
  assert.equal(read("SELECT SUM(charged_micro_usd) spent FROM catalog_research_spend WHERE token='previous-month'"), 50_000_000,
    "older ledger entries also remain intact");
});

test("disk-backed services omit unsupported custom shutdown delays", () => {
  const blueprint = parseDocument(source).toJS();
  const web = blueprint.services.find((service) => service.name === "mshpit");
  assert.deepEqual(web.disk, { name: "pit-data", mountPath: "/data", sizeGB: 5 });
  for (const service of blueprint.services.filter((entry) => entry.disk)) {
    assert.equal(Object.hasOwn(service, "maxShutdownDelaySeconds"), false,
      `${service.name}: Render rejects maxShutdownDelaySeconds when a persistent disk is attached`);
  }
  const verifier = blueprint.services.find((service) => service.name === "pit-video-verifier");
  assert.equal(verifier.disk, undefined);
  assert.equal(verifier.maxShutdownDelaySeconds, 60,
    "the disk-free verifier keeps its separately supported shutdown delay");
});

test("Render and CI install build validators even in production mode", async () => {
  const blueprint = parseDocument(source).toJS();
  const web = blueprint.services.find((service) => service.name === "mshpit");
  const env = Object.fromEntries(web.envVars.map((entry) => [entry.key, entry.value]));
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.NPM_CONFIG_INCLUDE, undefined,
    "Render must not keep development packages in the runtime environment");
  assert.match(web.buildCommand, /env -u NPM_CONFIG_INCLUDE -u npm_config_include npm prune --omit=dev\b/,
    "Render must clear both npm include spellings before pruning development packages");
  const installAt = web.buildCommand.indexOf("npm ci --include=dev");
  const checkAt = web.buildCommand.indexOf("npm run check:deploy");
  const pruneAt = web.buildCommand.indexOf("npm prune --omit=dev");
  const guardAt = web.buildCommand.indexOf("node -e", pruneAt);
  assert.ok(installAt >= 0, "Render must install development build inputs explicitly");
  assert.ok(checkAt > installAt, "Render must run the complete build/check gate after installing build inputs");
  assert.ok(pruneAt > checkAt, "Render must prune development packages only after the build/check gate");
  assert.ok(guardAt > pruneAt, "Render must run the production dependency guard after pruning");
  assert.match(web.buildCommand, /Production dependency guard failed/,
    "the post-prune guard must fail closed with a bounded diagnostic");
  const workflow = parseDocument(await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8")).toJS();
  const install = workflow.jobs["test-and-build"].steps.find((step) => step.run === "npm ci");
  assert.equal(install.env.NODE_ENV, "production");
  assert.equal(install.env.NPM_CONFIG_INCLUDE, "dev");
});

test("Render post-prune guard executes module resolution and rejects retained build tooling", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-render-guard-"));
  try {
    for (const name of ["@anthropic-ai/sdk", "heic-decode", "sharp"]) {
      await writeResolvablePackage(root, name);
    }
    const guard = postPruneGuardSource();
    let result = spawnSync(process.execPath, ["-e", guard], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    await writeResolvablePackage(root, "node-forge");
    result = spawnSync(process.execPath, ["-e", guard], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0, "retained node-forge must make the production guard fail");
    assert.match(`${result.stderr}${result.stdout}`, /retained=node-forge/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inherited uppercase or lowercase npm include cannot survive the guarded prune", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-render-npm-"));
  const packageRoot = join(root, "node_modules", "pit-packaging-dev-fixture");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.NPM_CONFIG_INCLUDE;
  delete cleanEnvironment.npm_config_include;
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({
      name: "pit-packaging-prune-fixture",
      version: "1.0.0",
      private: true,
      devDependencies: { "pit-packaging-dev-fixture": "file:./dev-fixture" },
    }));
    const fixtureDirectory = join(root, "dev-fixture");
    await mkdir(fixtureDirectory, { recursive: true });
    await writeFile(join(fixtureDirectory, "package.json"), JSON.stringify({
      name: "pit-packaging-dev-fixture",
      version: "0.0.0",
      main: "index.js",
    }));
    await writeFile(join(fixtureDirectory, "index.js"), "module.exports = {};\n");
    let result = spawnSync(npmCommand, ["install", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: root,
      env: cleanEnvironment,
      shell: true,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await pathExists(packageRoot), true);

    for (const variable of ["NPM_CONFIG_INCLUDE", "npm_config_include"]) {
      const inheritedEnvironment = { ...cleanEnvironment, [variable]: "dev" };
      result = spawnSync(npmCommand, ["prune", "--omit=dev", "--no-audit", "--no-fund"], {
        cwd: root,
        env: inheritedEnvironment,
        shell: true,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(await pathExists(packageRoot), true,
        `${variable}=dev must demonstrate why the build command clears inherited include settings`);
    }

    result = spawnSync(npmCommand, ["prune", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: root,
      env: cleanEnvironment,
      shell: true,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await pathExists(packageRoot), false,
      "pruning after clearing both include spellings must remove the dev-only package");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the build gate prevents prune and the post-prune guard from being bypassed after failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "pit-render-chain-"));
  const marker = join(root, "prune-ran");
  const writeMarker = "require('node:fs').writeFileSync(process.env.PIT_PACKAGING_TEST_MARKER,'ran')";
  try {
    let result = runNodeChain(["process.exit(17)", writeMarker], marker);
    assert.notEqual(result.status, 0);
    assert.equal((await import("node:fs")).existsSync(marker), false,
      "a failed build/check stage must skip prune");

    result = runNodeChain(["process.exit(0)", "process.exit(19)", writeMarker], marker);
    assert.notEqual(result.status, 0);
    assert.equal((await import("node:fs")).existsSync(marker), false,
      "a failed prune or guard stage must prevent a successful build chain");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("committed Render Blueprint matches pinned provider schema and local wiring", async () => {
  assert.deepEqual(await validateBlueprint(source, schema), []);
});
test("Blueprint validation catches invalid types, duplicate keys and missing references", async () => {
  assert.ok((await validateBlueprint(source.replace("type: web", "type: spaceship"), schema)).length);
  assert.ok((await validateBlueprint(source.replace("runtime: node", "runtime: node\n    runtime: python"), schema)).length);
  assert.ok((await validateBlueprint(source.replace("name: pit-video-verifier", "name: missing-verifier"), schema)).length);
  assert.ok((await validateBlueprint(source.replace("envVarKey: MEDIA_ENDPOINT", "envVarKey: MISSING_ENDPOINT"), schema)).length);
});
