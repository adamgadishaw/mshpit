import { postBadgeBundle } from "./postBadgeBundle.mjs";

const definedFields = (value) => Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {})
  .filter(([, field]) => field !== undefined));
const profileVersion = (value) => {
  const parsed = Number(value?.profileUpdatedAt);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

// Feed/comment responses carry a fresh embedded public author projection. The
// shared people cache may still add role/badge fields, but it must not override
// a newly uploaded or removed avatar until somebody happens to visit a profile.
export function resolvePostAuthor({ userId, embedded, cached } = {}) {
  const cachedFields = definedFields(cached);
  const embeddedFields = definedFields(embedded);
  const cachedVersion = profileVersion(cachedFields);
  const embeddedVersion = profileVersion(embeddedFields);
  const cachedIsNewer = cachedVersion > 0 && cachedVersion > embeddedVersion;
  // Badge authority travels atomically in the current response. A newer avatar
  // version in the people cache must never resurrect a revoked role/check.
  const badgeSource = embeddedFields.badgeSnapshot === true ? embeddedFields : null;
  return {
    ...(cachedIsNewer ? embeddedFields : cachedFields),
    ...(cachedIsNewer ? cachedFields : embeddedFields),
    ...(badgeSource ? postBadgeBundle(badgeSource) : {}),
    ...(userId ? { id: userId } : {}),
  };
}
