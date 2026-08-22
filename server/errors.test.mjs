import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ApiError,
  ERROR_CATALOG as SERVER_ERROR_CATALOG,
  errorCodeForStatus,
  errorEnvelope,
} from "./errors.js";
import {
  ERROR_CATALOG as CLIENT_ERROR_CATALOG,
  SERVER_CODE_MAP,
} from "../src/lib/errorCatalog.mjs";

const SERVER_ROOT = dirname(fileURLToPath(import.meta.url));

function runtimeSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSources(path);
    if (!entry.isFile() || ![".js", ".mjs"].includes(extname(entry.name))) return [];
    if (entry.name.endsWith(".test.mjs")) return [];
    return [path];
  });
}

function apiErrorCalls(source) {
  const calls = [];
  const startPattern = /\bnew\s+ApiError\s*\(/g;
  for (let match = startPattern.exec(source); match; match = startPattern.exec(source)) {
    const open = startPattern.lastIndex - 1;
    const args = [];
    let argStart = open + 1;
    let parentheses = 1;
    let brackets = 0;
    let braces = 0;
    let quote = "";
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let closed = false;

    for (let index = open + 1; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];

      if (lineComment) {
        if (character === "\n") lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "/" && next === "/") {
        lineComment = true;
        index += 1;
        continue;
      }
      if (character === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "(") parentheses += 1;
      else if (character === ")") {
        parentheses -= 1;
        if (parentheses === 0) {
          args.push(source.slice(argStart, index).trim());
          startPattern.lastIndex = index + 1;
          closed = true;
          break;
        }
      } else if (character === "[") brackets += 1;
      else if (character === "]") brackets -= 1;
      else if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      else if (character === "," && parentheses === 1 && brackets === 0 && braces === 0) {
        args.push(source.slice(argStart, index).trim());
        argStart = index + 1;
      }
    }

    assert.ok(closed, `Could not parse ApiError call at source offset ${match.index}`);
    calls.push({ args, offset: match.index });
  }
  return calls;
}

function namedErrorCodeConstants(source) {
  const values = new Map();
  const pattern = /\b(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*["']([A-Z][A-Z0-9_]*)["']/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    values.set(match[1], match[2]);
  }
  return values;
}

test("server error definitions have canonical statuses and safe envelopes", () => {
  assert.ok(Object.isFrozen(SERVER_ERROR_CATALOG));
  const statuses = new Set();

  for (const [code, definition] of Object.entries(SERVER_ERROR_CATALOG)) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(Number.isInteger(definition.status));
    assert.ok(definition.status >= 400 && definition.status <= 599);
    assert.equal(typeof definition.retryable, "boolean");
    statuses.add(definition.status);

    const error = new ApiError(definition.status, "Public-safe message.", code);
    assert.equal(error.code, code);
    assert.equal(error.status, definition.status);
    assert.deepEqual(errorEnvelope(error, "req_contract"), {
      error: "Public-safe message.",
      code,
      status: definition.status,
      requestId: "req_contract",
      retryable: definition.retryable,
    });
  }

  for (const status of statuses) {
    const defaultCode = errorCodeForStatus(status);
    assert.ok(SERVER_ERROR_CATALOG[defaultCode], `Status ${status} has no default error code`);
    assert.equal(SERVER_ERROR_CATALOG[defaultCode].status, status);
  }
});

test("ApiError refuses unknown codes and explicit status drift", () => {
  assert.throws(
    () => new ApiError(400, "No mutation should continue.", "UNKNOWN_CODE"),
    /Unknown API error code: UNKNOWN_CODE/,
  );
  assert.throws(
    () => new ApiError(409, "No mutation should continue.", "VALIDATION_FAILED"),
    /VALIDATION_FAILED requires status 400, received 409/,
  );
  assert.equal(new ApiError(418, "Unsupported status without an explicit code.").status, 400);
});

test("every server error code has a valid client diagnostic mapping", () => {
  assert.deepEqual(
    Object.keys(SERVER_CODE_MAP).sort(),
    Object.keys(SERVER_ERROR_CATALOG).sort(),
    "The client map must cover the complete server catalog with no stale keys",
  );
  for (const [serverCode, clientCode] of Object.entries(SERVER_CODE_MAP)) {
    assert.ok(
      CLIENT_ERROR_CATALOG[clientCode],
      `${serverCode} maps to unknown client error ${clientCode}`,
    );
  }
});

test("literal ApiError call sites use registered codes with canonical statuses", () => {
  let checked = 0;
  for (const path of runtimeSources(SERVER_ROOT)) {
    const source = readFileSync(path, "utf8");
    const namedCodes = namedErrorCodeConstants(source);
    for (const { args, offset } of apiErrorCalls(source)) {
      if (args.length < 3) continue;
      const location = `${relative(SERVER_ROOT, path)}:${source.slice(0, offset).split("\n").length}`;
      const status = /^(\d+)$/.exec(args[0]);
      const literalCode = /^["']([A-Z][A-Z0-9_]*)["']$/.exec(args[2])?.[1];
      const namedCode = /^[A-Z][A-Z0-9_]*$/.test(args[2]) ? namedCodes.get(args[2]) : null;
      const code = literalCode || namedCode;
      assert.ok(status, `${location} must use a literal HTTP status with an explicit error code`);
      assert.ok(code, `${location} must use a statically registered error code`);
      assert.ok(SERVER_ERROR_CATALOG[code], `${location} uses unknown error code ${code}`);
      assert.equal(
        Number(status[1]),
        SERVER_ERROR_CATALOG[code].status,
        `${location} status does not match ${code}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked >= 300, `Expected broad ApiError coverage, checked ${checked} call sites`);
});
