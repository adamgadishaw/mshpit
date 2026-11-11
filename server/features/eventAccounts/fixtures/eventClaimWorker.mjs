import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [directory, adminId, claimId, name] = process.argv.slice(2);
process.env.PIT_DATA_DIR = directory; process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
globalThis.fetch = async () => { throw Error("Event claim worker forbids external requests"); };
const { db } = await import("../../../db.js");
const { routes } = await import("../../../api.js");
const { createSession } = await import("../../../auth.js");
const { readAuthorizedRequest } = await import("../../../requestAuthorization.js");
const wait = async file => {
  const deadline = Date.now() + 20000;
  while (!existsSync(file)) { if (Date.now() > deadline) throw Error("Event claim worker coordination timed out"); await new Promise(resolve => setTimeout(resolve, 10)); }
};
try {
  const token = createSession(adminId).token;
  writeFileSync(join(directory, name + "-ready"), "ready"); await wait(join(directory, name + "-go"));
  const authorized = await readAuthorizedRequest({ token, expectedAccount: adminId, method: "POST", pathname: `/api/admin/event-claims/${claimId}/approve`,
    readBody: () => ({ reason: "Checked the official organization and account authority.", reviewedUrl: "https://example.test/official", officialAccountConfirmed: true, ownershipConfirmed: true, expectedOwnerId: null }) });
  const exec = db.exec.bind(db);
  db.exec = sql => { if (sql === "BEGIN IMMEDIATE") writeFileSync(join(directory, name + "-waiting"), "waiting"); return exec(sql); };
  let result;
  try { result = routes["POST /api/admin/event-claims/:id/approve"]({ ...authorized, token, params: { id: claimId }, ip: name }); }
  catch(error) { result = { status: error.status, code: error.code }; }
  writeFileSync(join(directory, name + "-result.json"), JSON.stringify(result));
} finally { db.close(); }
