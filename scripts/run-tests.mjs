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
  env: { ...process.env, PIT_DATA_DIR: dataDir },
});
try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
process.exit(result.status ?? 1);
