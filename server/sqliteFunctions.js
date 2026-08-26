import { slugify } from "../src/domain/urls.mjs";

export function pitPublicSlug(value) {
  return slugify(value) || "";
}

export function pitVenuePublicSlug(source, providerVenueId) {
  const provider = slugify(providerVenueId);
  if (!provider) return "";
  const namespace = slugify(source) || "provider";
  return `${namespace}-${provider}`;
}

// SQLite expression indexes can only be parsed, vacuumed, and integrity-checked
// by a connection that knows every application-defined function in their schema.
// Register the same deterministic callbacks on web, backup, restore, and test
// connections so a healthy database never looks corrupt in another process.
export function registerPitSqliteFunctions(database) {
  if (!database || typeof database.function !== "function") {
    throw new Error("A SQLite connection is required to register PIT functions.");
  }
  database.function("pit_public_slug", { deterministic: true }, pitPublicSlug);
  database.function("pit_venue_public_slug", { deterministic: true }, pitVenuePublicSlug);
  return database;
}
