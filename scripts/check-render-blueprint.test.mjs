import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readProviderSchema, validateBlueprint } from "./check-render-blueprint.mjs";

const schema = await readProviderSchema();
const source = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
test("committed Render Blueprint matches pinned provider schema and local wiring", async () => {
  assert.deepEqual(await validateBlueprint(source, schema), []);
});
test("Blueprint validation catches invalid types, duplicate keys and missing references", async () => {
  assert.ok((await validateBlueprint(source.replace("type: web", "type: spaceship"), schema)).length);
  assert.ok((await validateBlueprint(source.replace("runtime: node", "runtime: node\n    runtime: python"), schema)).length);
  assert.ok((await validateBlueprint(source.replace("name: pit-video-verifier", "name: missing-verifier"), schema)).length);
  assert.ok((await validateBlueprint(source.replace("envVarKey: MEDIA_ENDPOINT", "envVarKey: MISSING_ENDPOINT"), schema)).length);
});
