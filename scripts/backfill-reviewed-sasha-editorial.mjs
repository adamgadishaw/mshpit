#!/usr/bin/env node
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";
import { applyReviewedSashaEditorialBackfill, previewReviewedSashaEditorialBackfill } from "../server/reviewedSashaEditorialBackfill.js";

const CONFIRM = "sasha-keable-toronto-2027-03-30";

export function runReviewedSashaEditorialCommand(args, { at = Date.now() } = {}) {
  const { values } = parseArgs({ args, options: {
    database: { type: "string" }, "checked-at": { type: "string" }, apply: { type: "string" },
  }});
  if (!values.database || !isAbsolute(values.database)) throw new TypeError("Supply an absolute --database path.");
  const path = realpathSync(values.database);
  if (!statSync(path).isFile()) throw new TypeError("The --database must be an existing SQLite file.");
  const rawCheck = values["checked-at"] || "";
  const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(rawCheck) ? Date.parse(rawCheck) : NaN;
  const checkedAt = Number.isFinite(parsed) && new Date(parsed).toISOString() === rawCheck.replace(/(\d{2}:\d{2}:\d{2})Z$/u, "$1.000Z") ? parsed : null;
  const applying = values.apply === CONFIRM;
  if (values.apply != null && !applying) throw new TypeError("Provide the exact --apply acknowledgement for this one show.");
  if (applying && !Number.isSafeInteger(checkedAt)) throw new TypeError("Apply requires a current --checked-at UTC official waitlist check.");
  // The default opens with SQLite read-only protections. No migration, server
  // startup, environment secrets, network calls, or automatic DB discovery.
  const db = new DatabaseSync(path, {readOnly: !applying});
  try {
    registerPitSqliteFunctions(db);
    const operation = applying ? applyReviewedSashaEditorialBackfill : previewReviewedSashaEditorialBackfill;
    return operation(db, {checkedAt,at});
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runReviewedSashaEditorialCommand(process.argv.slice(2));
    process.stdout.write(JSON.stringify(result,null,2) + "\n");
    if (result.status === "needs_review") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(String(error?.message || "Reviewed editorial command failed.") + "\n");
    process.exitCode = 1;
  }
}
