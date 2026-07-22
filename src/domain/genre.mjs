// Genre provenance and authority.
//
// The catalogue seeder discovers artists by crawling MusicBrainz tag pages, and
// for a long time it published the crawl bucket as the artist's genre. Those
// pages return loosely related artists, so Justin Bieber came back under "Metal",
// Eminem under "Hardcore", Rihanna under "House" and Adele under "Indie". None
// of that is evidence of anything; CLAUDE.md already says MusicBrainz search
// tags are discovery hints, not canonical primary genres.
//
// So a genre is never a bare string here. It is a claim with a source, and the
// source decides whether the claim may be stated as fact.

// Ranked lowest to highest. `rank` decides conflicts; `confidence` is what the
// UI and any future consensus logic reason about.
export const GENRE_SOURCES = {
  // A crawl bucket. Discovery only: enough to guess with, never to assert.
  tag_hint: { rank: 1, confidence: 0.25, evidence: false },
  // Two or more independent providers agreeing.
  consensus: { rank: 2, confidence: 0.7, evidence: true },
  // A provider stating this artist's genre directly (a Deezer album genre, an
  // explicit MusicBrainz genre), rather than us inferring it from a search.
  provider: { rank: 3, confidence: 0.8, evidence: true },
  // A human decision. Always wins, never overwritten by an automated run.
  staff: { rank: 4, confidence: 1, evidence: true },
};

// Only claims backed by evidence may be shown as "this artist's genre".
export const GENRE_DISPLAY_THRESHOLD = 0.5;

const sourceOf = (name) => GENRE_SOURCES[name] || null;

// The crawl vocabulary, kept in sync with GENRE_TAGS in server/catalogSeed.js.
// Membership is how a legacy row with no recorded provenance is identified: the
// seeder wrote these exact display labels, so a stored genre that is one of
// them, spelled exactly this way, came from a bucket rather than from evidence.
const CRAWL_LABELS = new Set([
  "Punk", "Pop Punk", "Hardcore", "Metalcore", "Indie", "Shoegaze", "Dream Pop", "Metal",
  "Electronic", "Techno", "House", "DnB", "Dubstep", "Trance", "EDM", "Ambient", "Hip-Hop",
  "Trap", "Grime", "R&B", "Soul", "Funk", "Disco", "Jazz", "Blues", "Pop", "Synthpop",
  "New Wave", "K-Pop", "J-Pop", "Rock", "Garage Rock", "Grunge", "Prog Rock", "Psych Rock",
  "Post-Rock", "Math Rock", "Noise Rock", "Emo", "Post-Punk", "Dance-Punk", "Alt Rock",
  "Experimental", "Folk", "Americana", "Country", "Bluegrass", "Singer-Songwriter",
  "Reggae", "Dancehall", "Ska", "Afrobeat", "Afrobeats", "Latin", "Reggaeton", "Classical",
  "Gospel", "World",
]);

export const isCrawlLabel = (value) => CRAWL_LABELS.has(String(value || "").trim());

// A genre claim: { value, source, at }. Returns null for anything unusable, so
// an empty or junk provider field can never enter the record.
export function genreClaim(value, source, at = Date.now()) {
  // Strings only: coercing would turn a stray number or object from a provider
  // payload into a plausible-looking genre ("42", "[object Object]").
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean || clean.length > 40) return null;
  if (!sourceOf(source)) return null;
  return { value: clean, source, at };
}

// Reading a legacy row that predates provenance. The value is trusted only as
// far as its shape allows: an exact crawl label is a hint, anything else came
// from provider enrichment (those arrive lowercased, like "hip hop").
export function classifyStoredGenre(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  return genreClaim(clean, isCrawlLabel(clean) ? "tag_hint" : "provider");
}

// The hierarchy. Highest rank wins; ties go to the more recent claim, so a
// re-run of the same provider refreshes rather than freezes. Returns null when
// there is nothing usable, never a guess.
export function resolveGenre(claims) {
  let best = null;
  for (const claim of claims || []) {
    if (!claim || !claim.value || !sourceOf(claim.source)) continue;
    if (!best) { best = claim; continue; }
    const a = sourceOf(claim.source).rank;
    const b = sourceOf(best.source).rank;
    if (a > b || (a === b && (claim.at || 0) > (best.at || 0))) best = claim;
  }
  if (!best) return null;
  const { confidence, evidence } = sourceOf(best.source);
  return { value: best.value, source: best.source, confidence, at: best.at || 0, evidence };
}

// Merge a new claim into the stored record. Two rules matter here:
//   - a null/empty incoming claim never erases what is already known, which is
//     the failure mode the request called out for deprecated provider fields;
//   - an automated source never overwrites a staff decision.
export function mergeGenre(current, incoming) {
  const existing = current && current.value ? current : null;
  if (!incoming || !incoming.value) return existing;
  if (existing && existing.source === "staff" && incoming.source !== "staff") return existing;
  return resolveGenre([existing, incoming].filter(Boolean));
}

// Every source keeps its own claim, so the record remembers what the providers
// said even while a staff correction is in force. That is what makes a
// correction reversible: withdraw the staff claim and the evidence underneath
// is still there to resolve against, instead of the artist falling to nothing.
export function upsertClaim(claims, incoming) {
  const kept = (claims || []).filter((c) => c && c.value && GENRE_SOURCES[c.source]);
  if (!incoming || !incoming.value) return kept;
  return [...kept.filter((c) => c.source !== incoming.source), incoming];
}

export function withoutSource(claims, source) {
  return (claims || []).filter((c) => c && c.source !== source);
}

// Normalizes whatever is on a stored row into a claims array: the modern list,
// a single legacy record, or a bare pre-provenance genre string.
export function storedClaims(data, columnGenre) {
  if (Array.isArray(data?.genreClaims) && data.genreClaims.length) {
    return data.genreClaims.filter((c) => c && c.value && GENRE_SOURCES[c.source]);
  }
  if (data?.genreRecord?.value) return [data.genreRecord];
  const legacy = classifyStoredGenre(columnGenre);
  return legacy ? [legacy] : [];
}

// What the interface is allowed to state as the artist's genre. Below the
// threshold the honest answer is nothing: a bucket guess presented as fact is
// what made Discover look broken.
export function displayGenre(record) {
  if (!record || !record.value) return null;
  const confidence = record.confidence ?? sourceOf(record.source)?.confidence ?? 0;
  return confidence >= GENRE_DISPLAY_THRESHOLD ? record.value : null;
}

// True when a claim exists but is not good enough to show. Lets a surface offer
// it as a suggestion ("looks like Metal?") or ask staff to confirm, instead of
// silently dropping the only signal there is.
export function isUnverifiedGenre(record) {
  return !!(record && record.value && !displayGenre(record));
}
