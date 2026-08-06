// `space` is a FUNCTION — space(n) => n * 4 — not an object of named sizes.
// Writing `space.sm` is valid JavaScript that silently evaluates to undefined,
// and a StyleSheet value of undefined is dropped without warning. The result is
// a screen that renders with every padding, margin and gap missing while the
// code still reads as though it has them, and nothing fails.
//
// That shipped once, in the admin email console. This is the cheap guard.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SRC = dirname(fileURLToPath(import.meta.url));
const SKIP = new Set(["seed", "node_modules"]);

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(jsx?|mjs)$/.test(entry) && !entry.endsWith(".test.mjs")) found.push(full);
  }
  return found;
}

test("space is called, never treated as an object of named sizes", () => {
  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      // `space.sm`, `space.md`, … — a property access on the function itself.
      const match = /\bspace\.[a-zA-Z_$]/.exec(line);
      if (match) offenders.push(`${file.slice(SRC.length + 1)}:${index + 1}  ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, [], `space is a function; use space(n).\n${offenders.join("\n")}`);
});

test("the spacing scale is what the call sites assume", () => {
  // Guards the other half: if the scale changed, every space(n) silently
  // rescales. 4px steps are what the existing screens were built against.
  const theme = readFileSync(join(SRC, "theme.js"), "utf8");
  assert.match(theme, /export const space = \(n\) => n \* 4/,
    "the spacing scale changed; re-check the space(n) call sites before updating this test");
});
