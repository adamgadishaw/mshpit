import assert from "node:assert/strict";
import test from "node:test";

import { prepareDataDirectory } from "./dataDirectory.js";

test("production refuses an implicit or missing database directory", () => {
  assert.throws(
    () => prepareDataDirectory({ env: { NODE_ENV: "production" }, fallbackDir: "fallback", exists: () => true }),
    /PIT_DATA_DIR is required/,
  );
  assert.throws(
    () => prepareDataDirectory({ env: { NODE_ENV: "production", PIT_DATA_DIR: "missing" }, exists: () => false }),
    /not mounted/,
  );
});

test("production accepts an existing explicit path and development creates its fallback", () => {
  let made = null;
  const production = prepareDataDirectory({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "mounted" },
    exists: () => true,
    mkdir: () => { throw new Error("production must not create its mount"); },
  });
  assert.match(production, /mounted$/);
  const development = prepareDataDirectory({
    env: {},
    fallbackDir: "development-data",
    mkdir: (path) => { made = path; },
  });
  assert.equal(development, made);
});

test("production refuses an existing but uninitialized directory unless bootstrap is explicit", () => {
  const directoryOnly = (path) => !String(path).toLowerCase().endsWith("pit.db");
  assert.throws(
    () => prepareDataDirectory({
      env: { NODE_ENV: "production", PIT_DATA_DIR: "empty-mounted-directory" },
      exists: directoryOnly,
    }),
    /production database is missing/i,
  );
  assert.doesNotThrow(() => prepareDataDirectory({
    env: {
      NODE_ENV: "production",
      PIT_DATA_DIR: "intentional-first-boot",
      PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "true",
    },
    exists: directoryOnly,
  }));
});
