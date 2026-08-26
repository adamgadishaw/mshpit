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
  // A release label without enough agreement to classify the artist.
  release_hint: { rank: 1, confidence: 0.35, evidence: false },
  // Two or more independent providers agreeing.
  consensus: { rank: 2, confidence: 0.7, evidence: true },
  // Several distinct releases from one provider agreeing by a clear majority.
  release_consensus: { rank: 2, confidence: 0.7, evidence: true },
  // A provider stating the artist's genre directly, rather than a release-level
  // label or a search/crawl inference.
  provider: { rank: 3, confidence: 0.8, evidence: true },
  // A human decision. Always wins, never overwritten by an automated run.
  staff: { rank: 4, confidence: 1, evidence: true },
};

// Only claims backed by evidence may be shown as "this artist's genre".
export const GENRE_DISPLAY_THRESHOLD = 0.5;

const sourceOf = (name) => GENRE_SOURCES[name] || null;

export function hasReleaseConsensusEvidence(data, value) {
  const evidence = data?.genreEvidence;
  if (!evidence || evidence.provider !== "deezer" || evidence.basis !== "release-consensus-v1") return false;
  const evidenceGenre = String(evidence.genre || "").trim().toLocaleLowerCase("en-US");
  const claimGenre = String(value || "").trim().toLocaleLowerCase("en-US");
  const sampleCount = evidence.sampleCount;
  const supportingCount = evidence.supportingCount;
  const share = evidence.share;
  const counts = new Map();
  let countedSamples = 0;
  if (!Array.isArray(evidence.counts) || !evidence.counts.length) return false;
  for (const item of evidence.counts) {
    const label = typeof item?.genre === "string" ? item.genre.trim() : "";
    const key = label.toLocaleLowerCase("en-US");
    const count = item?.count;
    if (!key || label.length > 60 || !Number.isSafeInteger(count) || count < 1 || counts.has(key)) return false;
    counts.set(key, count);
    countedSamples += count;
  }
  const claimedSupport = counts.get(claimGenre) || 0;
  const largestSupport = Math.max(...counts.values());
  return !!claimGenre
    && evidenceGenre === claimGenre
    && Number.isSafeInteger(sampleCount) && sampleCount >= 3
    && Number.isSafeInteger(supportingCount) && supportingCount >= 2
    && supportingCount <= sampleCount
    && countedSamples === sampleCount
    && claimedSupport === supportingCount
    && supportingCount === largestSupport
    && Number.isFinite(share) && share >= 0.6 && share <= 1
    && Math.abs((supportingCount / sampleCount) - share) <= 0.0001;
}

function storedClaim(data, claim) {
  if (!claim?.value || !GENRE_SOURCES[claim.source]) return null;
  if (claim.source === "release_consensus") {
    return hasReleaseConsensusEvidence(data, claim.value) ? claim : { ...claim, source: "release_hint" };
  }
  if (claim.source === "provider" && data?.deezerId) {
    return { ...claim, source: hasReleaseConsensusEvidence(data, claim.value) ? "release_consensus" : "release_hint" };
  }
  return claim;
}

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

// Reading a legacy row that predates provenance. A bare string cannot tell us
// whether it came from a crawl bucket, an old import, or provider enrichment.
// Treat every unstructured value as a hint. Modern writers persist an explicit
// source in genreClaims; promoting a value based on casing or vocabulary is
// what made Alternative look verified while equally bare Pop was hidden.
export function classifyStoredGenre(value) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;
  return genreClaim(clean, "tag_hint");
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
  // Presence is authoritative, including an intentional empty array. An admin
  // can withdraw the only staff claim while the typed column still contains
  // its old value (the additive artist upsert preserves null columns). Falling
  // through here would reclassify that withdrawn value as provider evidence.
  if (Array.isArray(data?.genreClaims)) {
    return data.genreClaims.map((claim) => storedClaim(data, claim)).filter(Boolean);
  }
  if (data?.genreRecord?.value) {
    const record = storedClaim(data, data.genreRecord);
    return record ? [record] : [];
  }
  // Early versions of the crawler stored its discovery bucket only as
  // `genreHint`. Retain that context for staff review, but explicitly mark it
  // as a non-displayable tag hint instead of promoting it through the legacy
  // column classifier.
  const hint = genreClaim(data?.genreHint, "tag_hint");
  const legacy = hasReleaseConsensusEvidence(data, columnGenre)
    ? genreClaim(columnGenre, "release_consensus")
    : classifyStoredGenre(columnGenre);
  // The structured blob is newer than the typed legacy column. When both are
  // crawl hints, keep the explicit `genreHint`; when the column is provider
  // evidence, retain both and let the normal authority ranking resolve them.
  return hint ? upsertClaim(legacy ? [legacy] : [], hint) : (legacy ? [legacy] : []);
}

// One writer boundary for provider/staff/hint updates. Every source keeps its
// own claim, automated evidence cannot displace a staff decision, and callers
// persist both the resolved column value and the complete reversible history.
export function genreFieldsForClaim(data, columnGenre, value, source, at = Date.now()) {
  const claims = upsertClaim(storedClaims(data, columnGenre), genreClaim(value, source, at));
  const record = resolveGenre(claims);
  return {
    genre: record?.value || null,
    genreClaims: claims,
    // Retire the old single-record representation when a writer advances the
    // claim set. JSON.stringify omits undefined, so it cannot compete later.
    genreRecord: undefined,
  };
}

export function providerGenreFields(data, columnGenre, value, at = Date.now()) {
  return genreFieldsForClaim(data, columnGenre, value, "provider", at);
}

// What the interface is allowed to state as the artist's genre. Below the
// threshold the honest answer is nothing: a bucket guess presented as fact is
// what made Discover look broken.
export function displayGenre(record) {
  if (!record || !record.value) return null;
  const confidence = record.confidence ?? sourceOf(record.source)?.confidence ?? 0;
  return confidence >= GENRE_DISPLAY_THRESHOLD ? record.value : null;
}

// One public read boundary for API, Discover, and crawler-readable documents.
// Keeping this projection here prevents those surfaces from slowly developing
// different rules about which stored genres are safe to state as fact.
export function projectArtistGenre(data, columnGenre) {
  const record = resolveGenre(storedClaims(data, columnGenre));
  const genre = displayGenre(record);
  return {
    record,
    genre,
    genreHint: genre ? null : (record?.value || null),
    genreSource: record?.source || null,
    genreConfidence: record?.confidence ?? null,
  };
}

// True when a claim exists but is not good enough to show. Lets a surface offer
// it as a suggestion ("looks like Metal?") or ask staff to confirm, instead of
// silently dropping the only signal there is.
export function isUnverifiedGenre(record) {
  return !!(record && record.value && !displayGenre(record));
}
