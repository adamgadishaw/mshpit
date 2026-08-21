import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("./", import.meta.url);
const read = (name) => readFile(new URL(name, ROOT), "utf8");

test("current status has one explicit source of truth and historical reports are labelled", async () => {
  const [status, handoff, oldAudit, oldSession, todo, guide, storage, migration] = await Promise.all([
    read("STATUS.md"),
    read("HANDOFF.md"),
    read("PROJECT_AUDIT_2026-08-04.md"),
    read("SESSION_LOG_2026-08-05.md"),
    read("TODO.md"),
    read("CLAUDE.md"),
    read("STORAGE.md"),
    read("MIGRATION.md"),
  ]);

  assert.match(status, /source of truth for current code/i);
  assert.match(status, /deployed.*2026-08-13/i);
  assert.match(status, /1e2ba65/);
  assert.match(status, /2ec2679/);
  assert.match(status, /31742684092/);
  assert.match(handoff.slice(0, 900), /HISTORICAL IMPLEMENTATION JOURNAL - NOT CURRENT STATUS/);
  assert.match(oldAudit.slice(0, 900), /HISTORICAL SNAPSHOT - SUPERSEDED/);
  assert.match(oldSession.slice(0, 900), /HISTORICAL SESSION RECORD - SUPERSEDED/);
  assert.match(todo.slice(0, 900), /STATUS\.md` is the source of truth/);
  assert.match(guide.slice(0, 900), /STATUS\.md.*current branch\/release\/production truth/i);
  assert.doesNotMatch(guide, /Current stabilization work is on `codex\/stabilize-core`/);
  assert.match(storage.slice(0, 900), /HISTORICAL PROPOSAL.*NOT CURRENT ARCHITECTURE/);
  assert.match(migration.slice(0, 900), /HISTORICAL MIGRATION JOURNAL.*NOT CURRENT ARCHITECTURE/);
});

test("current incident and security docs retain measured release caveats", async () => {
  const [status, audit, security, launch] = await Promise.all([
    read("STATUS.md"),
    read("AUDIT_AND_REMEDIATION_2026-08-13.md"),
    read("SECURITY.md"),
    read("LAUNCH.md"),
  ]);

  for (const source of [status, audit]) {
    assert.match(source, /2,253,157/);
    assert.match(source, /615,705/);
    assert.match(source, /504,824/);
    assert.match(source, /x-render-routing: no-server/);
  }
  for (const source of [status, security]) {
    assert.match(source, /17 advisories/);
    assert.match(source, /9 moderate and 8\s+high/);
    assert.match(source, /do not (?:use|run)\s+`npm audit fix --force`/i);
  }
  assert.match(audit, /19 advisories/);
  assert.match(audit, /8 moderate and 11\s+high/);
  for (const source of [audit]) {
    assert.match(source, /do not (?:use|run)\s+`npm audit fix --force`/i);
  }
  assert.match(launch, /consistent read lock, not an exclusive\/write/);
  assert.match(launch, /same persistent disk and are not disaster recovery|protects against a bad live database file, not loss of the whole disk/i);
  assert.match(launch, /BACKUP_S3_REGION.*Optional.*defaults to `auto`/);
});

test("comment previews are closed while Store and device acceptance stay open", async () => {
  const [status, audit, todo] = await Promise.all([
    read("STATUS.md"),
    read("AUDIT_AND_REMEDIATION_2026-08-13.md"),
    read("TODO.md"),
  ]);

  for (const source of [status, audit, todo]) {
    assert.match(source, /latest two visible comments/i);
    assert.match(source, /src\/store\.js|Store context/);
  }
  assert.match(status, /Real Android\/iOS acceptance remains mandatory/);
  assert.match(audit, /Real-device acceptance is still required/);
});
