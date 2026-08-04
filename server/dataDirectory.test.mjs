import assert from "node:assert/strict";
import test from "node:test";

import { prepareDataDirectory } from "./dataDirectory.js";

test("production refuses an implicit database directory", () => {
  assert.throws(
    () => prepareDataDirectory({ env: { NODE_ENV: "production" }, fallbackDir: "fallback", exists: () => true }),
    /PIT_DATA_DIR is required/,
  );
});

test("an unmounted disk warns loudly but still serves", () => {
  // Free tier never attaches the disk. Refusing here would turn an intermittent
  // outage into a permanent one, so the site stays up and the ephemerality is
  // made unmissable instead.
  const warnings = [];
  let made = null;
  const directory = prepareDataDirectory({
    env: { NODE_ENV: "production", PIT_DATA_DIR: "missing" },
    exists: () => false,
    mkdir: (path) => { made = path; },
    warn: (message) => warnings.push(message),
  });
  assert.match(directory, /missing$/);
  assert.equal(made, directory, "it falls back to a usable directory rather than dying");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /EPHEMERAL/);
  assert.match(warnings[0], /persistent disk/i, "the warning must say how to fix it");
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
