import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";
import { isMirroredVenuePhoto } from "../scripts/lib/venue-photo-mirror-batch.mjs";

export const runtimeVenuePhotoIdentity = row => JSON.stringify(
  [row?.name, row?.city, row?.country].map(value => String(value || "").trim().toLowerCase()),
);

// Shared by public reads and the isolated sitemap builder. This factory never
// migrates schema, reserves a budget, downloads an image, or starts maintenance.
export function createRuntimeVenuePhotoReader(database, { env = process.env } = {}) {
  const installed = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='venue_photo_enrichment'").get();
  if (!installed) return () => null;
  const read = database.prepare("SELECT status,identity,photo_json FROM venue_photo_enrichment WHERE venue_key=?");
  const currentIdentity = database.prepare(`SELECT MIN(venue) AS name,MIN(venue_city) AS city,MIN(venue_country_code) AS country
    FROM tour_dates WHERE source='ticketmaster' AND owner_id IS NULL AND lower(trim(venue_provider_id))=?
    HAVING COUNT(DISTINCT lower(trim(venue)))=1 AND COUNT(DISTINCT lower(trim(venue_city)))=1
      AND COUNT(DISTINCT upper(trim(venue_country_code)))=1`);
  return (key) => {
    if (typeof key !== "string" || !key.startsWith("provider:ticketmaster:")) return null;
    const row = read.get(key);
    if (row?.status !== "filled" || !row.photo_json || row.photo_json.length > 16000) return null;
    let photo;
    try { photo = JSON.parse(row.photo_json); } catch { return null; }
    const current = currentIdentity.get(key.slice("provider:ticketmaster:".length));
    return current && runtimeVenuePhotoIdentity(current) === row.identity
      && isMirroredVenuePhoto(photo, env) ? licensedVenuePhoto(photo) : null;
  };
}
