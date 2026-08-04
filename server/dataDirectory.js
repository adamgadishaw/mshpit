import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Production must never silently create a new fallback database. A missing or
// mistyped disk path otherwise looks like a healthy empty site and makes every
// account/post appear deleted.
//
// Two failure shapes look similar and are NOT equally dangerous, so they are
// handled differently:
//
//   1. The directory does not exist at all — no persistent disk was ever
//      attached (Render's free tier ignores the `disk:` block). Storage is
//      ephemeral and the database resets on every restart. That is bad, but
//      refusing to boot converts an intermittent outage into a permanent one,
//      so this WARNS LOUDLY and keeps serving. A safety check that takes the
//      site down is its own hazard.
//
//   2. The directory exists but the database is gone — a disk IS mounted and
//      the data vanished from it. That is genuinely alarming and unrecoverable
//      by guessing, so this still REFUSES rather than quietly standing up an
//      empty site that looks like every account was deleted.
export function prepareDataDirectory({
  env = process.env,
  fallbackDir,
  exists = existsSync,
  mkdir = (path) => mkdirSync(path, { recursive: true }),
  warn = (message) => console.error(message),
} = {}) {
  const configured = String(env?.PIT_DATA_DIR || "").trim();
  const production = String(env?.NODE_ENV || "").toLowerCase() === "production";
  if (production && !configured) {
    throw new Error("PIT_DATA_DIR is required in production; refusing to create an empty fallback database.");
  }
  const directory = resolve(configured || fallbackDir || "server/data");
  if (production) {
    if (!exists(directory)) {
      // Case 1: no disk. Serve, but make the consequence impossible to miss.
      warn(
        `[pit] WARNING: ${directory} is not mounted, so storage is EPHEMERAL — ` +
        "the database resets on every restart and posts/accounts will be lost. " +
        "Attach a persistent disk (Render Starter or above) at this path.",
      );
      // The configured path may also be unwritable (a protected root, a
      // read-only filesystem). Serving from a local fallback is still better
      // than refusing to start, so this degrades one more step before failing.
      try {
        mkdir(directory);
        return directory;
      } catch {
        const local = resolve(fallbackDir || "server/data");
        warn(`[pit] WARNING: could not create ${directory}; falling back to ${local}.`);
        mkdir(local);
        return local;
      }
    }
    const allowBootstrap = ["1", "true", "yes", "on"].includes(
      String(env?.PIT_ALLOW_EMPTY_DB_BOOTSTRAP || "").trim().toLowerCase(),
    );
    if (!exists(join(directory, "pit.db")) && !allowBootstrap) {
      // Case 2: the disk is there but the data is not. Refuse.
      throw new Error(`The production database is missing from ${directory}; refusing to create an empty site. Set PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true only for an intentional first boot.`);
    }
  } else {
    mkdir(directory);
  }
  return directory;
}
