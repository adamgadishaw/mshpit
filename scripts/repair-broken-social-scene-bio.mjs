#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import { openSync, writeFileSync, fsyncSync, closeSync, existsSync } from "node:fs";
import { repairSnapshot, repairAccidentalBioOverride } from "./repairs/broken-social-scene-bio.mjs";

const [mode, databasePath, expectedSha256, auditPath] = process.argv.slice(2);
if (!databasePath || !existsSync(databasePath) || !["--inspect", "--apply"].includes(mode)
  || (mode === "--apply" && (!expectedSha256 || !auditPath))) {
  throw new Error("Usage: --inspect DB_PATH | --apply DB_PATH REVIEWED_SHA256 NEW_AUDIT_PATH");
}
const database = new DatabaseSync(databasePath, { readOnly: mode === "--inspect" });
let auditFd;
try {
  if (mode === "--inspect") console.log(JSON.stringify(repairSnapshot(database), null, 2));
  else {
    auditFd = openSync(auditPath, "wx", 0o600);
    const audit = (event) => { writeFileSync(auditFd, `${JSON.stringify(event)}\n`); fsyncSync(auditFd); };
    const after = repairAccidentalBioOverride(database, { expectedSha256, audit });
    audit({ event: "committed", at: Date.now(), after });
    console.log("Repaired one biography curation flag. Audit:", auditPath);
  }
} finally {
  if (auditFd !== undefined) closeSync(auditFd);
  database.close();
}
