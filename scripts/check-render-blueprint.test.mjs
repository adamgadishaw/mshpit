import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { readProviderSchema, validateBlueprint } from "./check-render-blueprint.mjs";

const schema = await readProviderSchema();
const source = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
test("news expansion keeps the owner-approved caps and catalogue allocation", () => {
  const web = parseDocument(source).toJS().services.find((service) => service.name === "mshpit");
  const env = Object.fromEntries(web.envVars.map((entry) => [entry.key, entry.value]));
  assert.equal(env.NEWS_DESK_DAILY_USD, "0.75");
  assert.equal(env.NEWS_DESK_MONTHLY_USD, "15");
  assert.equal(env.ANTHROPIC_MONTHLY_USD, "20");
  assert.equal(env.CATALOG_RESEARCH_DAILY_USD, "0.30");
  assert.equal(env.CATALOG_RESEARCH_MONTHLY_USD, "4");
  assert.equal(web.envVars.find((entry) => entry.key === "ANTHROPIC_API_KEY").sync, false);
});
test("Render and CI install build validators even in production mode", async () => {
  const blueprint = parseDocument(source).toJS();
  const web = blueprint.services.find((service) => service.name === "mshpit");
  const env = Object.fromEntries(web.envVars.map((entry) => [entry.key, entry.value]));
  assert.equal(env.NODE_ENV, "production");
  assert.equal(env.NPM_CONFIG_INCLUDE, "dev");
  assert.match(web.buildCommand, /^npm ci\b/);
  const workflow = parseDocument(await readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8")).toJS();
  const install = workflow.jobs["test-and-build"].steps.find((step) => step.run === "npm ci");
  assert.equal(install.env.NODE_ENV, "production");
  assert.equal(install.env.NPM_CONFIG_INCLUDE, "dev");
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
