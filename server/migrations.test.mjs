// Rollback safety.
//
// A deploy rolls back; the schema it migrated does not. Old code can therefore
// only survive a rollback while every migration is additive: it ignores columns
// it does not know about, but it cannot cope with one that was dropped, renamed
// or retyped underneath it. That property was rehearsed on 2026-08-05 (see
// LAUNCH.md section 5b) and this keeps it true.
//
// The migration loop in db.js already refuses anything but ADD COLUMN. What it
// cannot see is a destructive statement written outside the loop, which is what
// this test covers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./db.js", import.meta.url), "utf8");

test("no destructive DDL anywhere in the database layer", () => {
  // Dropping or renaming makes a code rollback insufficient on its own: the
  // database has to be restored from a snapshot first, which is slower and
  // loses everything written since. Adding one of these is a deliberate
  // decision that should also update LAUNCH.md section 5b.
  const banned = /\b(DROP\s+COLUMN|DROP\s+TABLE|RENAME\s+COLUMN|RENAME\s+TO|ALTER\s+COLUMN)\b/gi;
  const offenders = source.split("\n")
    .map((line, index) => ({ line: line.trim(), n: index + 1 }))
    .filter(({ line }) => banned.test(line));
  assert.deepEqual(offenders.map((o) => `db.js:${o.n}  ${o.line.slice(0, 70)}`), []);
});

test("the additive-migration guard is still enforced at runtime", () => {
  // The loop parses each statement and throws on anything that is not an
  // ADD COLUMN, so a destructive entry fails at boot rather than on first use.
  assert.match(source, /ALTER TABLE \(\[a-z_\]\+\) ADD COLUMN/,
    "the migration parser changed; re-check that non-additive statements still cannot run");
  assert.match(source, /Unsupported additive migration/,
    "the guard that rejects non-additive migrations is gone");
});

test("every additive migration carries a default or is nullable", () => {
  // NOT NULL without a default fails on a table that already has rows, which
  // turns a routine deploy into an outage on the first boot after it.
  const block = /for \(const stmt of \[([\s\S]*?)\n\]\) \{/.exec(source);
  assert.ok(block, "could not find the migration list; update this test");
  const statements = block[1].split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"ALTER TABLE'));
  assert.ok(statements.length > 10, `expected the real migration list, found ${statements.length}`);
  const unsafe = statements.filter((s) => /NOT NULL/i.test(s) && !/DEFAULT/i.test(s));
  assert.deepEqual(unsafe, [], "NOT NULL without DEFAULT fails on a table with existing rows");
});
