import {
  genreFieldsForClaim, hasReleaseConsensusEvidence, resolveGenre, storedClaims,
} from "../src/domain/genre.mjs";

// Deezer attaches genres to releases, not directly to artists. A single album
// can be a compilation, collaboration, soundtrack, or provider mistake, so it
// is never enough evidence for an artist-level classification.
const ALIASES = new Map([
  ["rap/hip hop", "Hip-Hop"],
  ["soul & funk", "Soul"],
  ["electro", "Electronic"],
  ["dance", "Electronic"],
  ["latin music", "Latin"],
]);

const EXCLUDED = new Set(["films/games", "kids"]);

export function normalizeDeezerGenre(value) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 60) return null;
  const key = clean.toLocaleLowerCase("en-US");
  if (EXCLUDED.has(key)) return null;
  return ALIASES.get(key) || clean;
}

export function deezerReleaseGenreConsensus(values, {
  minimumSamples = 3,
  minimumSupporting = 2,
  minimumShare = 0.6,
} = {}) {
  const genres = (values || [])
    .map((value) => normalizeDeezerGenre(typeof value === "string" ? value : value?.genre))
    .filter(Boolean);
  if (genres.length < minimumSamples) return null;

  const counts = new Map();
  for (const genre of genres) {
    const key = genre.toLocaleLowerCase("en-US");
    const current = counts.get(key) || { genre, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  const distribution = [...counts.values()]
    .sort((left, right) => left.genre.localeCompare(right.genre))
    .map(({ genre, count }) => ({ genre, count }));
  const winner = [...distribution]
    .sort((left, right) => right.count - left.count || left.genre.localeCompare(right.genre))[0];
  const share = winner.count / genres.length;
  if (winner.count < minimumSupporting || share < minimumShare) return null;
  return Object.freeze({
    genre: winner.genre,
    provider: "deezer",
    basis: "release-consensus-v1",
    sampleCount: genres.length,
    supportingCount: winner.count,
    share: Number(share.toFixed(4)),
    counts: distribution,
  });
}

export function deezerGenreFields(data, columnGenre, evidence, at = Date.now()) {
  if (!hasReleaseConsensusEvidence({ genreEvidence: evidence }, evidence?.genre)) return {};
  const prepared = {
    ...data,
    genreClaims: storedClaims(data, columnGenre).filter((claim) => claim.source !== "release_hint"),
  };
  return {
    ...genreFieldsForClaim(prepared, columnGenre, evidence.genre, "release_consensus", at),
    genreEvidence: evidence,
  };
}

export function withoutDeezerGenreFields(data, columnGenre) {
  const claims = storedClaims(data, columnGenre).filter((claim) =>
    claim.source !== "release_consensus" && claim.source !== "release_hint");
  const record = resolveGenre(claims);
  return {
    genre: record?.value || null,
    genreClaims: claims,
    genreRecord: undefined,
    genreEvidence: undefined,
  };
}

export function needsDeezerGenreRevalidation(data, columnGenre) {
  if (!data?.deezerId) return false;
  const claims = storedClaims(data, columnGenre);
  return claims.some((claim) => claim.source === "release_hint")
    || !claims.some((claim) => claim.source === "release_consensus");
}

export function deezerEnrichmentGenreFields(data, columnGenre, { deezerId, genreEvidence } = {}) {
  const incomingIdentity = String(deezerId ?? "").trim();
  if (!incomingIdentity) return {};
  const identityChanged = !!data?.deezerId && String(data.deezerId) !== incomingIdentity;
  const cleared = identityChanged ? withoutDeezerGenreFields(data, columnGenre) : {};
  const prepared = identityChanged ? { ...data, ...cleared } : data;
  const consensus = deezerGenreFields(
    prepared,
    identityChanged ? cleared.genre : columnGenre,
    genreEvidence,
  );
  return {
    ...cleared,
    ...consensus,
  };
}
