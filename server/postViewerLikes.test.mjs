import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { attachViewerLikes } from "./postViewerLikes.js";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE likes (
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (post_id,user_id)
  )`);
  database.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("p_two", "u_viewer");
  return database;
}

test("one page lookup attaches exact viewer like state without changing row order", () => {
  const database = fixture();
  const rows = [{ id: "p_one", marker: 1 }, { id: "p_two", marker: 2 }, { id: "p_three", marker: 3 }];
  const projected = attachViewerLikes(database, rows, "u_viewer");

  assert.deepEqual(projected.map((row) => [row.id, row.viewer_liked]), [
    ["p_one", 0],
    ["p_two", 1],
    ["p_three", 0],
  ]);
  assert.deepEqual(rows, [{ id: "p_one", marker: 1 }, { id: "p_two", marker: 2 }, { id: "p_three", marker: 3 }],
    "the database rows remain reusable by other projectors");
  database.close();
});

test("anonymous and empty pages perform no database work", () => {
  let prepares = 0;
  const database = { prepare() { prepares += 1; throw new Error("must not query"); } };

  assert.deepEqual(attachViewerLikes(database, [{ id: "p_one" }], null), [{ id: "p_one", viewer_liked: 0 }]);
  assert.deepEqual(attachViewerLikes(database, [], "u_viewer"), []);
  assert.equal(prepares, 0);
});
