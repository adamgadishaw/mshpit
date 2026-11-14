import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import assert from "node:assert/strict";
const [directory, accountId, name] = process.argv.slice(2);
assert.ok(basename(directory).startsWith("pit-calendar-posts-"));
process.env.PIT_DATA_DIR = directory;
globalThis.fetch = async () => { throw Error("Calendar due worker forbids external requests"); };
const { db } = await import("../../../db.js");
const { creatorCalendarService } = await import("../../../api.js");
try {
  assert.ok(db.prepare("SELECT 1 FROM users WHERE id=?").get(accountId));
  writeFileSync(join(directory, name + "-ready"), "ready");
  const deadline = Date.now() + 20000;
  while (!existsSync(join(directory, name + "-go"))) {
    if (Date.now() > deadline) throw Error("Calendar due worker coordination timed out");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const exec = db.exec.bind(db);
  db.exec = sql => { if (sql === "BEGIN IMMEDIATE") writeFileSync(join(directory, name + "-waiting"), "waiting"); return exec(sql); };
  const body = JSON.parse(readFileSync(join(directory, name + "-body.json"), "utf8"));
  const result = creatorCalendarService.runDue({ at: body.at });
  writeFileSync(join(directory, name + "-result.json"), JSON.stringify(result));
} finally { db.close(); }
