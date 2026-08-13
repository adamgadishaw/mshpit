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
const result = spawnSync(process.execPath, ["--test"], {
  stdio: "inherit",
  // Render's build command deliberately carries production bootstrap approval
  // so modules used outside the test runner can open its throwaway database.
  // Never let those runtime values leak into assertions about the deployed
  // health policy: the test process owns a fresh non-production database and
  // must observe bootstrap as disabled unless a test opts in explicitly.
  env: {
    ...process.env,
    NODE_ENV: "test",
    // The suite's established default is the production application policy.
    // A staging Blueprint build must not mute campaign test recipients merely
    // because its eventual runtime uses PIT_ENV=staging.
    PIT_ENV: "production",
    PIT_DATA_DIR: dataDir,
    PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false",
  },
});
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(result.status ?? 1);
