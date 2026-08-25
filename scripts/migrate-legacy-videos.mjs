import { db } from "../server/db.js";
import { migrateLegacyVideoRelease } from "../server/legacyVideoMigration.js";

const args = new Set(process.argv.slice(2));
const allowed = new Set(["--apply"]);
const unknown = [...args].filter((argument) => !allowed.has(argument));
try {
  if (unknown.length) {
    console.error(`Unknown option: ${unknown[0]}`);
    process.exitCode = 2;
  } else {
    const result = await migrateLegacyVideoRelease(db, { apply: args.has("--apply") });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: String(error?.code || "MIGRATION_FAILED"),
    message: String(error?.message || "Historical clip migration failed."),
  }));
  process.exitCode = 1;
} finally {
  db.close();
}
