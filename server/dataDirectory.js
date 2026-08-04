import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Production must never silently create a new fallback database. A missing or
// mistyped disk path otherwise looks like a healthy empty site and makes every
// account/post appear deleted. Render mounts persistent disks before start, so
// a configured production directory must already exist.
export function prepareDataDirectory({
  env = process.env,
  fallbackDir,
  exists = existsSync,
  mkdir = (path) => mkdirSync(path, { recursive: true }),
} = {}) {
  const configured = String(env?.PIT_DATA_DIR || "").trim();
  const production = String(env?.NODE_ENV || "").toLowerCase() === "production";
  if (production && !configured) {
    throw new Error("PIT_DATA_DIR is required in production; refusing to create an empty fallback database.");
  }
  const directory = resolve(configured || fallbackDir || "server/data");
  if (production) {
    if (!exists(directory)) {
      throw new Error(`The configured production data directory is not mounted: ${directory}`);
    }
    const allowBootstrap = ["1", "true", "yes", "on"].includes(
      String(env?.PIT_ALLOW_EMPTY_DB_BOOTSTRAP || "").trim().toLowerCase(),
    );
    if (!exists(join(directory, "pit.db")) && !allowBootstrap) {
      throw new Error(`The production database is missing from ${directory}; refusing to create an empty site. Set PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true only for an intentional first boot.`);
    }
  } else {
    mkdir(directory);
  }
  return directory;
}
