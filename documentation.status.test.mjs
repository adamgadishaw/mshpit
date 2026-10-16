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
  }
  assert.match(audit, /x-render-routing: no-server/);
  assert.match(status, /staging service was retired/i);
  assert.match(status, /Releases are direct from `master`/i);
  // STATUS describes the last deployed release; SECURITY describes the
  // current scoped security review and must distinguish code from live controls.
  assert.match(status, /17 advisories/);
  assert.match(status, /9 moderate and 8\s+high/);
  assert.match(status, /do not (?:use|run)\s+`npm audit fix --force`/i);
  assert.match(security, /October 16 production-server dependency audit reports zero vulnerabilities/i);
  assert.match(security, /full development\/mobile graph reports 19 high findings inherited through\s+two underlying braces\/node-forge advisories; neither lists a patched release/i);
  assert.match(security, /Current installed Expo is 57\.0\.29\. A fresh \x60expo install --check\x60 now expects\s+~57\.0\.30, so the SDK patch update and native revalidation remain outstanding/i);
  assert.match(security, /earlier Expo Doctor run passed 21\/21 checks on Expo 57\.0\.19 \/ React Native\s+0\.86\.3; that historical result is not a fresh check of this tree/i);
  assert.match(security, /Real\s+iOS and Android device acceptance is still required before a native-store\s+release/i);
  assert.match(security, /not\s+production controls until/i);
  assert.match(security, /historical database from Git history/i);
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
