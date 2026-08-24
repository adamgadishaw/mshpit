// Hermetic test runner: every `node --test` run gets a FRESH throwaway SQLite
// directory. The test files import server/db.js, which opens the database at
// PIT_DATA_DIR on import, so without this the suite either writes into the real
// dev database (PIT_DATA_DIR unset locally) or crashes outright where the data
// dir is unwritable (a Render build container, where the disk is not mounted).
// Always forcing a temp dir makes `npm test` safe to run anywhere.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "pit-tests-"));
const testArgs = process.argv.slice(2);
const testEnvironment = {
  ...process.env,
  NODE_ENV: "test",
  // The suite's established default is the production application policy.
  // A staging Blueprint build must not mute campaign test recipients merely
  // because its eventual runtime uses PIT_ENV=staging.
  PIT_ENV: "production",
  PIT_DATA_DIR: dataDir,
  PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false",
};
// Render injects RENDER=true into its build environment. That hosted-runtime
// marker deliberately makes email verification impossible to disable in the
// application, but it must not override tests of the local-only kill switch.
// Omit it instead of weakening the production guard in verification.js.
delete testEnvironment.RENDER;
// Tests that exercise signup must never inherit a hosted mail credential and
// send to fixture addresses or consume production quota. Mail-specific tests
// opt into explicit test values and stub their own transport.
delete testEnvironment.RESEND_API_KEY;
delete testEnvironment.MAIL_FROM;
const result = spawnSync(process.execPath, ["--test", ...testArgs], {
  stdio: "inherit",
  // Render's build command deliberately carries production bootstrap approval
  // so modules used outside the test runner can open its throwaway database.
  // Never let those runtime values leak into assertions about the deployed
  // health policy: the test process owns a fresh non-production database and
  // must observe bootstrap as disabled unless a test opts in explicitly.
  env: testEnvironment,
});
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(result.status ?? 1);
