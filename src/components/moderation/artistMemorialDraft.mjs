import { ARTIST_MEMORIAL_LIMITS } from "../../domain/artistMemorial.mjs";
import { clean } from "../../domain/validation.mjs";

const ARTIST_KEY_LIMIT = 180;
const FACT_LIMIT = 120;
const ALBUM_LIMIT = 3;
const MUSICBRAINZ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, max, { newlines = false } = {}) {
  return clean(value, { max, newlines });
}

function boundedText(value, max, { newlines = false } = {}) {
  const normalized = text(value, max + 1, { newlines });
  return normalized.length <= max ? normalized : "";
}

function year(value) {
  const normalized = boundedText(String(value ?? ""), 4);
  return /^\d{4}$/u.test(normalized) ? normalized : "";
}

function calendarDate(value) {
  const normalized = boundedText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return "";
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : "";
}

function albumFacts(artist) {
  const albums = Array.isArray(artist.albums) ? artist.albums : [];
  const facts = [];
  const seen = new Set();
  for (const album of albums) {
    if (facts.length >= ALBUM_LIMIT) break;
    const title = boundedText(object(album).title, FACT_LIMIT);
    if (!title) continue;
    const identity = title.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    facts.push({ title, year: year(object(album).year) });
  }
  return facts;
}

function generatedCopy(artistKey, artist) {
  const name = boundedText(artist.name, FACT_LIMIT) || artistKey;
  const genre = boundedText(artist.genre, FACT_LIMIT);
  const country = boundedText(artist.country, FACT_LIMIT);
  const albums = albumFacts(artist);
  const summary = [
    `Pit remembers ${name}.`,
    genre ? `${name} is cataloged under ${genre}.` : "",
    country ? `Pit lists ${country} as the artist's country.` : "",
    albums[0]
      ? `The catalog includes ${albums[0].title}${albums[0].year ? ` (${albums[0].year})` : ""}.`
      : "",
  ].filter(Boolean).join(" ");

  const accomplishmentLines = [
    genre ? `Catalog genre: ${genre}` : "",
    country ? `Catalog country: ${country}` : "",
    ...albums.map((album) => `Catalog release: ${album.title}${album.year ? ` (${album.year})` : ""}`),
  ].filter(Boolean).map((line) => text(line, ARTIST_MEMORIAL_LIMITS.accomplishment));

  return {
    summary: text(summary, ARTIST_MEMORIAL_LIMITS.summary, { newlines: true }),
    thankYou: text(`Thank you, ${name}, for the music.`, ARTIST_MEMORIAL_LIMITS.thankYou, { newlines: true }),
    accomplishmentsText: accomplishmentLines.length
      ? accomplishmentLines.slice(0, ARTIST_MEMORIAL_LIMITS.accomplishments).join("\n")
      : text(`Pit catalog artist: ${name}`, ARTIST_MEMORIAL_LIMITS.accomplishment),
  };
}

function existingOrGenerated(existing, field, generated, max, { newlines = false } = {}) {
  const current = boundedText(existing[field], max, { newlines });
  return current || generated;
}

function artistIdentity(value) {
  return boundedText(value, ARTIST_KEY_LIMIT).normalize("NFKC").toLocaleLowerCase();
}

export function isMemorialDraftCandidate(value) {
  const artist = object(value);
  return Boolean(
    boundedText(artist.key, ARTIST_KEY_LIMIT)
    && boundedText(artist.name, FACT_LIMIT)
    && MUSICBRAINZ_ID.test(String(artist.mbid || "")),
  );
}

export function memorialDraftCandidates(values, { limit = 6 } = {}) {
  if (!Array.isArray(values)) return [];
  const take = Math.max(1, Math.min(20, Math.trunc(Number(limit) || 6)));
  const seen = new Set();
  const candidates = [];
  for (const artist of values) {
    if (!isMemorialDraftCandidate(artist)) continue;
    const key = `${artist.key}\u0000${String(artist.mbid).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(artist);
    if (candidates.length >= take) break;
  }
  return candidates;
}

/**
 * Build a private memorial draft from catalog facts only. This helper never
 * infers a death date, awards, cause of death, or other biographical claims.
 * Staff-supplied non-empty form fields win so autofill cannot erase authored
 * copy, and the result always remains a non-publishing draft.
 */
export function createArtistMemorialDraft({
  artistKey: requestedArtistKey,
  artist: artistInput,
  deathDate = "",
  sourceTitle = "",
  sourceUrl = "",
  existingForm: existingInput = null,
} = {}) {
  const artist = object(artistInput);
  const existing = object(existingInput);
  const artistKey = boundedText(requestedArtistKey ?? artist.artistKey ?? artist.key, ARTIST_KEY_LIMIT);
  if (!artistKey) throw new TypeError("Memorial autofill requires a canonical artist key.");

  // Authored memorial facts are identity-scoped. If staff typed content for a
  // different artist before choosing a catalog result, never carry that copy
  // across to the newly selected identity.
  const existingArtistKey = artistIdentity(existing.artistKey);
  const sameArtistExisting = !existingArtistKey || existingArtistKey === artistIdentity(artistKey)
    ? existing
    : {};

  const generated = generatedCopy(artistKey, artist);
  return {
    artistKey,
    status: "draft",
    deathDate: existingOrGenerated(sameArtistExisting, "deathDate", calendarDate(deathDate), 10),
    summary: existingOrGenerated(sameArtistExisting, "summary", generated.summary, ARTIST_MEMORIAL_LIMITS.summary, { newlines: true }),
    thankYou: existingOrGenerated(sameArtistExisting, "thankYou", generated.thankYou, ARTIST_MEMORIAL_LIMITS.thankYou, { newlines: true }),
    accomplishmentsText: existingOrGenerated(
      sameArtistExisting,
      "accomplishmentsText",
      generated.accomplishmentsText,
      (ARTIST_MEMORIAL_LIMITS.accomplishment + 1) * ARTIST_MEMORIAL_LIMITS.accomplishments,
      { newlines: true },
    ),
    sourceUrl: existingOrGenerated(sameArtistExisting, "sourceUrl", boundedText(sourceUrl, ARTIST_MEMORIAL_LIMITS.sourceUrl), ARTIST_MEMORIAL_LIMITS.sourceUrl),
    sourceTitle: existingOrGenerated(sameArtistExisting, "sourceTitle", boundedText(sourceTitle, ARTIST_MEMORIAL_LIMITS.sourceTitle), ARTIST_MEMORIAL_LIMITS.sourceTitle),
    restartSpotlight: false,
  };
}
