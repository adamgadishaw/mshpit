import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { resetClientSourceLocationForTests, resolveClientSourceLocation } from "./clientSourceLocation.js";

const asset = "index-0123456789abcdef0123456789abcdef.js";
// Generated line 3 (index 2), column 0 maps to /src/screens/Landing.jsx line 9, column 1, name renderHero.
const map = { version: 3, sources: ["/src/screens/Landing.jsx"], names: ["renderHero"], mappings: ";;AAQAA" };

beforeEach(() => resetClientSourceLocationForTests());

function build(t, { withMap = true, mapBody = map } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "pit-source-location-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, asset), "compiled fixture");
  if (withMap) writeFileSync(join(directory, `${asset}.map`), typeof mapBody === "string" ? mapBody : JSON.stringify(mapBody));
  return directory;
}

test("a minified location resolves to the original source file, line and function", (t) => {
  const directory = build(t);
  assert.equal(resolveClientSourceLocation({ asset, line: 3, column: 1 }, { directory }), "src/screens/Landing.jsx:9:1 in renderHero");
});

test("a line past the map is never reported as the nearest earlier mapping", (t) => {
  const directory = build(t);
  // Node's SourceMap#findEntry returns line 3's mapping for line 60; accepting it would name the wrong line.
  assert.equal(resolveClientSourceLocation({ asset, line: 60, column: 1 }, { directory }), `${asset}:60:1 (no exact source mapping)`);
  assert.equal(resolveClientSourceLocation({ asset, line: 1, column: 1 }, { directory }), `${asset}:1:1 (no exact source mapping)`);
});

test("the reason a location cannot be resolved is itself reported", (t) => {
  const directory = build(t, { withMap: false });
  assert.equal(resolveClientSourceLocation({ asset, line: 3, column: 1 }, { directory }), `${asset}:3:1 (no source map in this build)`);
  const stale = "LogScreen-ffffffffffffffffffffffffffffffff.js";
  assert.equal(
    resolveClientSourceLocation({ asset: stale, line: 1, column: 9 }, { directory }),
    `${stale}:1:9 (not in the current build: the page was loaded before a deploy)`,
  );
  const unreadable = build(t, { mapBody: "{ not json" });
  assert.equal(resolveClientSourceLocation({ asset, line: 3, column: 1 }, { directory: unreadable }), `${asset}:3:1 (source map unreadable)`);
});

test("only an emitted bundle or the boot script can be named", (t) => {
  const directory = build(t);
  for (const bad of [`../${asset}`, `${asset}.map`, "private.js", "nested/index-0123456789abcdef0123456789abcdef.js", 7]) {
    assert.equal(resolveClientSourceLocation({ asset: bad, line: 3, column: 1 }, { directory }), null);
  }
  for (const coordinate of [0, -1, 1.5, Number.NaN, 10_000_000, "3"]) {
    assert.equal(resolveClientSourceLocation({ asset, line: coordinate, column: 1 }, { directory }), null);
  }
  assert.equal(resolveClientSourceLocation(null, { directory }), null);
  assert.equal(
    resolveClientSourceLocation({ asset: "mshpit-web-boot-v1.js", line: 23, column: 5 }, { directory }),
    "public/mshpit-web-boot-v1.js:23:5",
  );
});

test("source paths are normalized and never escape upward", (t) => {
  const prefixed = build(t, { mapBody: { ...map, sources: ["webpack:///src/App.js"] } });
  assert.equal(resolveClientSourceLocation({ asset, line: 3, column: 1 }, { directory: prefixed }), "src/App.js:9:1 in renderHero");
  resetClientSourceLocationForTests();
  const escaping = build(t, { mapBody: { ...map, sources: ["/src/../../etc/passwd"] } });
  assert.equal(resolveClientSourceLocation({ asset, line: 3, column: 1 }, { directory: escaping }), `${asset}:3:1 (no exact source mapping)`);
});

test("map parsing is bounded across the whole process", (t) => {
  const directories = Array.from({ length: 21 }, () => build(t));
  const now = 1_000_000;
  const results = directories.map((directory) => resolveClientSourceLocation({ asset, line: 3, column: 1 }, { directory, now }));
  assert.equal(results.slice(0, 20).every((value) => value === "src/screens/Landing.jsx:9:1 in renderHero"), true);
  assert.equal(results[20], `${asset}:3:1 (source lookup deferred: too many recent crash lookups)`);
  // A new window allows lookups again.
  assert.equal(
    resolveClientSourceLocation({ asset, line: 3, column: 1 }, { directory: directories[20], now: now + 10 * 60_000 }),
    "src/screens/Landing.jsx:9:1 in renderHero",
  );
});
