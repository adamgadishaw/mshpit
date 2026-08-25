import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./db.js", import.meta.url), "utf8");

function tableDefinition(name) {
  const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\(([\\s\\S]*?)\\n\\)(?: WITHOUT ROWID)?;`).exec(source);
  assert.ok(match, `missing ${name} table`);
  return match[1];
}

test("guest search storage is aggregate-only and has no request or visitor identity", () => {
  const definition = tableDefinition("guest_search_daily");
  assert.match(definition, /day\s+TEXT NOT NULL/);
  assert.match(definition, /result_bucket\s+TEXT NOT NULL/);
  assert.match(definition, /outcome\s+TEXT NOT NULL/);
  assert.match(definition, /count\s+INTEGER NOT NULL/);
  assert.doesNotMatch(definition, /\b(user|account|visitor|session|cookie|device|ip|ua|agent|url|query|term|created_at)\b/i);
  assert.doesNotMatch(definition, /\b(?:search|query|term)_?text\b/i);
});

test("anonymous product suggestions cannot accidentally retain submitter identity", () => {
  const definition = tableDefinition("product_suggestions");
  assert.match(definition, /client_mutation_id\s+TEXT NOT NULL UNIQUE/);
  assert.match(definition, /body\s+TEXT NOT NULL/);
  assert.doesNotMatch(definition, /\b(user_id|account_id|email|ip|user_agent|cookie|device_id|url)\b/i);
});
