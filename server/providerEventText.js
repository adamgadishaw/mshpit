// Repair only known UTF-8 apostrophe bytes decoded as Latin-1 or CP1252.
// Display-only: never use this to rewrite IDs, catalog keys, stored billing
// or member-authored text. Unknown corruption stays rejected by SEO policy.
export function publicProviderEventText(value, ownerId = null) {
  if (ownerId != null || typeof value !== "string") return value;
  return value
    .replace(/\u00e2(?:\u0080\u0099|\u20ac\u2122)/gu, "\u2019")
    .replace(/\u00e2(?:\u0080\u0098|\u20ac\u02dc)/gu, "\u2018");
}
