import { discoverRowCountryLabel } from "./discoverScene.mjs";

const text = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const exact = value => text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const idOf = row => text(row?.id || row?.identity);

function qualifiedPlace(row) {
  const parts = text(row?.place).split(",").map(text).filter(Boolean);
  // Only a recognized explicit country tail makes a name/place recovery safe.
  // Do not infer the nation from a city or a contradictory separate field.
  return parts.length > 1 && discoverRowCountryLabel({ place: parts.join(", ") })
    ? parts.map(exact).join(",") : null;
}

function providerIdentities(row) {
  const alias = value => {
    const match = /^provider:([^:\s]+):(.+)$/.exec(text(value));
    return match && text(match[2]) ? `provider:${exact(match[1])}:${text(match[2])}` : null;
  };
  const aliases = new Set((Array.isArray(row?.providerIdentities) ? row.providerIdentities : [])
    .map(alias).filter(Boolean));
  const source = exact(row?.source), provider = text(row?.providerVenueId || row?.venue_provider_id);
  const explicitProvider = /^[a-z0-9_-]+$/.test(source) && provider ? `provider:${source}:${provider}` : null;
  for (const value of [row?.id, row?.identity]) {
    const identifier = alias(value);
    // The old search index folded opaque ids. Do not promote that corrupted
    // alias over an available exact source/id pair.
    if (identifier && (!explicitProvider || identifier === explicitProvider)) aliases.add(identifier);
  }
  if (explicitProvider) aliases.add(explicitProvider);
  return [...aliases];
}

export function snapshotVenueMapSelection(row) {
  if (!row || typeof row !== "object") return null;
  const place = qualifiedPlace(row), name = exact(row.name || row.venue);
  return { id: idOf(row), providerIdentities: providerIdentities(row), qualifiedPlace: place,
    qualifiedNamePlace: name && place ? `${name}\u0000${place}` : null };
}

/** Recover the same selected venue after catalogue hydration changes its row id. */
export function reconcileVenueMapSelection(rows, snapshot) {
  if (!snapshot || !Array.isArray(rows)) return null;
  const samePlace = row => !snapshot.qualifiedPlace || qualifiedPlace(row) === snapshot.qualifiedPlace;
  const stable = snapshot.id ? rows.filter(row => idOf(row) === snapshot.id) : [];
  if (stable.length) return stable.length === 1 && samePlace(stable[0]) ? idOf(stable[0]) : null;
  const aliases = new Set(snapshot.providerIdentities || []);
  const providerMatches = aliases.size ? rows.filter(row => providerIdentities(row).some(value => aliases.has(value))) : [];
  if (providerMatches.length) return providerMatches.length === 1 && snapshot.qualifiedPlace && samePlace(providerMatches[0]) ? idOf(providerMatches[0]) : null;
  if (!snapshot.qualifiedNamePlace) return null;
  const matches = rows.filter(row => (!aliases.size || !providerIdentities(row).length)
    && snapshotVenueMapSelection(row)?.qualifiedNamePlace === snapshot.qualifiedNamePlace);
  return matches.length === 1 ? idOf(matches[0]) || null : null;
}
