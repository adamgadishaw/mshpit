import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const STATE_VERSION = 1;
const STATE_FILE = "venue-photo-backfill.state.json";
const MAX_CURSOR_LENGTH = 512;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function validCursor(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_CURSOR_LENGTH
    && value.trim() === value
    && !CONTROL_CHARACTERS.test(value);
}

export function resolveVenuePhotoBackfillStatePath(databasePath, override = null) {
  const explicit = typeof override === "string" ? override.trim() : "";
  if (explicit) return resolve(explicit);
  if (typeof databasePath !== "string" || !databasePath.trim()) {
    throw new Error("Venue-photo progress state requires a database path.");
  }
  return join(dirname(resolve(databasePath)), STATE_FILE);
}

export async function readVenuePhotoBackfillState(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return Object.freeze({ version: STATE_VERSION, cursor: null });
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Venue-photo progress state is invalid; refusing to discard it automatically.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || parsed.version !== STATE_VERSION || !validCursor(parsed.cursor)) {
    throw new Error("Venue-photo progress state is invalid; refusing to discard it automatically.");
  }
  return Object.freeze({ version: STATE_VERSION, cursor: parsed.cursor });
}

export async function writeVenuePhotoBackfillState(path, cursor) {
  if (!validCursor(cursor)) throw new Error("Venue-photo progress cursor is invalid.");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ version: STATE_VERSION, cursor }, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
