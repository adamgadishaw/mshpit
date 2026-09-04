// Backward-compatible seed entry point. The verified major-venue facts live in
// the platform-neutral domain layer so the app and public SEO server share one
// source of truth without crossing architecture boundaries.
export { arenaVenueEntries, arenaVenues } from "../domain/majorVenueFacts.mjs";
