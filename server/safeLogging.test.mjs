import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { safeRequestFailureContext } from "./safeLogging.js";

test("failure log context never carries raw paths, queries, messages, or stacks", () => {
  const error = new Error("secret token and submitted body");
  error.stack = "private stack path";
  error.code = "ERR_PRIVATE\nINJECT";
  const preRoute = safeRequestFailureContext({
    method: "POST\nforged",
    pathname: "/api/users/u_private_123?token=secret",
    routePattern: "",
    error,
  });
  assert.deepEqual(preRoute, {
    method: "POSTforged",
    route: "<api-pre-route>",
    cause: "Error/ERR_PRIVATEINJECT",
  });
  assert.doesNotMatch(JSON.stringify(preRoute), /u_private|token|submitted|stack|secret/i);

  const matched = safeRequestFailureContext({
    method: "GET",
    pathname: "/api/users/u_private_123",
    routePattern: "/api/users/:id",
    error: { cause: { name: "DatabaseError", code: "SQLITE_BUSY", message: "private SQL" } },
  });
  assert.deepEqual(matched, {
    method: "GET",
    route: "/api/users/:id",
    cause: "DatabaseError/SQLITE_BUSY",
  });
});

test("index request failures log only the bounded context helper", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /safeRequestFailureContext\(/);
  assert.doesNotMatch(source, /on \$\{req\.method\} \$\{pathname\}/);
  assert.doesNotMatch(source, /\(\$\{Date\.now\(\) - started\}ms\):`, e\)/);
  assert.doesNotMatch(source, /console\.error\([^;\n]*,\s*(?:e|error)\s*\)/);
});
