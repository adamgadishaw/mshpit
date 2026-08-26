import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  createProfileSearchIndexingPolicy,
  profileAllowsSearchIndexing,
  profileAllowsSearchIndexingSql,
} from "./profileSearchIndexing.js";

test("profile search indexing defaults on, honors booleans, and fails malformed metadata closed", () => {
  assert.equal(profileAllowsSearchIndexing({}), true);
  assert.equal(profileAllowsSearchIndexing("{}"), true);
  assert.equal(profileAllowsSearchIndexing({ searchIndexingOptOut: false }), true);
  assert.equal(profileAllowsSearchIndexing({ extras: JSON.stringify({ searchIndexingOptOut: true }) }), false);
  assert.equal(profileAllowsSearchIndexing("{broken"), false);
  assert.equal(profileAllowsSearchIndexing({ searchIndexingOptOut: "true" }), false);
  assert.throws(() => profileAllowsSearchIndexingSql("u;DROP TABLE users"), TypeError);
});

test("the document policy and SQL sitemap predicate enforce the same preference", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE users (id TEXT PRIMARY KEY,handle TEXT NOT NULL,extras TEXT)");
    const insert = database.prepare("INSERT INTO users (id,handle,extras) VALUES (?,?,?)");
    insert.run("default", "default", "{}");
    insert.run("allowed", "allowed", JSON.stringify({ searchIndexingOptOut: false }));
    insert.run("hidden", "hidden", JSON.stringify({ searchIndexingOptOut: true }));
    insert.run("malformed", "malformed", "{broken");
    insert.run("wrong-shape", "wrongshape", "[]");

    const policy = createProfileSearchIndexingPolicy(database);
    assert.equal(policy.allows({ id: "default" }), true);
    assert.equal(policy.allows({ handle: "@allowed" }), true);
    assert.equal(policy.allows({ id: "hidden" }), false);
    assert.equal(policy.allows({ handle: "malformed" }), false);
    assert.equal(policy.allows({ id: "wrong-shape" }), false);

    const visible = database.prepare(`SELECT id FROM users u WHERE ${profileAllowsSearchIndexingSql("u")} ORDER BY id`).all();
    assert.deepEqual(visible.map((row) => row.id), ["allowed", "default"]);
  } finally {
    database.close();
  }
});
