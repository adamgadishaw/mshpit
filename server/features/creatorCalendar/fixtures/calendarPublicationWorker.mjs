import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [directory, adminId, name] = process.argv.slice(2);
process.env.PIT_DATA_DIR = directory; process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
globalThis.fetch = async () => { throw Error("Calendar publication worker forbids external requests"); };
const { db } = await import("../../../db.js");
const { routes } = await import("../../../api.js");
const { createSession } = await import("../../../auth.js");
const { readAuthorizedRequest } = await import("../../../requestAuthorization.js");
const wait = async file => {
  const deadline = Date.now() + 20000;
  while (!existsSync(file)) { if (Date.now() > deadline) throw Error("Calendar publication worker coordination timed out"); await new Promise(resolve => setTimeout(resolve, 10)); }
};
try {
  const token = createSession(adminId).token;
  writeFileSync(join(directory, name + "-ready"), "ready"); await wait(join(directory, name + "-go"));
  const authorized = await readAuthorizedRequest({ token, expectedAccount: adminId, method: "POST", pathname: "/api/posts",
    readBody: () => JSON.parse(readFileSync(join(directory,name+"-body.json"),"utf8")) });
  const exec = db.exec.bind(db);
  db.exec = sql => { if (sql === "BEGIN IMMEDIATE") writeFileSync(join(directory, name + "-waiting"), "waiting"); return exec(sql); };
  let result;
  try { result = routes["POST /api/posts"]({ ...authorized, token, params: {}, query: {}, ip: name }); }
  catch(error) { result = { status: error.status, code: error.code }; }
  writeFileSync(join(directory, name + "-result.json"), JSON.stringify(result));
} finally { db.close(); }
