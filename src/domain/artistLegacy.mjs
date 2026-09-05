export const LEGACY_ARTIST_DEATH_DATE_CUTOFF = "1970-01-01";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

function canonicalDeathDate(value) {
  if (typeof value !== "string") return null;
  const date = value.trim();
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

/**
 * Legacy pages are the strict, educational subset of verified memorials whose
 * recorded death predates 1970. Public memorial projections omit `status`
 * because their existence already proves publication; persisted/admin records
 * must explicitly be published. Malformed or draft records always fail closed.
 */
export function isLegacyArtistMemorial(memorial) {
  if (!memorial || typeof memorial !== "object" || Array.isArray(memorial)) return false;
  const status = typeof memorial.status === "string" ? memorial.status.trim().toLowerCase() : null;
  const published = status === "published" || (status == null && memorial.deceased === true);
  if (!published) return false;
  const deathDate = canonicalDeathDate(memorial.deathDate ?? memorial.death_date);
  return deathDate != null && deathDate < LEGACY_ARTIST_DEATH_DATE_CUTOFF;
}
