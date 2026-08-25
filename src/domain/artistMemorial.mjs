import { clean } from "./validation.mjs";

export const ARTIST_MEMORIAL_STATUSES = Object.freeze(["draft", "published"]);
export const ARTIST_MEMORIAL_SPOTLIGHT_DAYS = 90;
export const ARTIST_MEMORIAL_SPOTLIGHT_MS = ARTIST_MEMORIAL_SPOTLIGHT_DAYS * 24 * 60 * 60 * 1000;

export const ARTIST_MEMORIAL_LIMITS = Object.freeze({
  summary: 600,
  thankYou: 320,
  accomplishment: 180,
  accomplishments: 8,
  sourceUrl: 1000,
  sourceTitle: 180,
});

const MIN_DEATH_YEAR = 1000;
const STATUS_SET = new Set(ARTIST_MEMORIAL_STATUSES);
const ADMIN_FIELDS = new Set([
  "status",
  "deathDate",
  "summary",
  "thankYou",
  "accomplishments",
  "sourceUrl",
  "sourceTitle",
  "confirmedIndividual",
  "restartSpotlight",
]);
const IPV4_HOST = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

const invalid = (field, message) => ({ valid: false, field, message });

function validTimestamp(value, label = "Artist memorial") {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime())) {
    throw new TypeError(`${label} requires a valid timestamp.`);
  }
  return timestamp;
}

function storedTimestamp(value) {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 && Number.isFinite(new Date(timestamp).getTime())
    ? timestamp
    : null;
}

function normalizedStatus(value) {
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return STATUS_SET.has(status) ? status : null;
}

function strictText(value, { max, min = 1, newlines = false } = {}) {
  if (typeof value !== "string") return null;
  const normalized = clean(value, { max: max + 1, newlines });
  if (normalized.length < min || normalized.length > max) return null;
  return normalized;
}

function normalizedDeathDate(value, at) {
  if (typeof value !== "string") return null;
  const date = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match || Number(match[1]) < MIN_DEATH_YEAR) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const today = new Date(at).toISOString().slice(0, 10);
  return date <= today ? date : null;
}

function publicHttpsSource(value) {
  if (typeof value !== "string") return null;
  const raw = clean(value, { max: ARTIST_MEMORIAL_LIMITS.sourceUrl + 1 });
  if (!raw || raw.length > ARTIST_MEMORIAL_LIMITS.sourceUrl) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
    if (!hostname
      || !hostname.includes(".")
      || hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname === "::1"
      || hostname === "[::1]"
      || (hostname.startsWith("[") && hostname.endsWith("]"))
      || IPV4_HOST.test(hostname)) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizedAccomplishments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > ARTIST_MEMORIAL_LIMITS.accomplishments) return null;
  const accomplishments = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = strictText(item, { max: ARTIST_MEMORIAL_LIMITS.accomplishment, min: 2 });
    if (!normalized) return null;
    const identity = normalized.toLowerCase();
    if (seen.has(identity)) return null;
    seen.add(identity);
    accomplishments.push(normalized);
  }
  return accomplishments;
}

function canonicalContent(input, { at }) {
  const status = normalizedStatus(input?.status);
  if (!status) return invalid("status", "Choose draft or published for this memorial.");

  const deathDate = normalizedDeathDate(input?.deathDate, at);
  if (!deathDate) return invalid("deathDate", "Enter a real, non-future death date in YYYY-MM-DD format.");

  const summary = strictText(input?.summary, { max: ARTIST_MEMORIAL_LIMITS.summary, min: 20, newlines: true });
  if (!summary) return invalid("summary", `Write a memorial summary between 20 and ${ARTIST_MEMORIAL_LIMITS.summary} characters.`);

  const thankYou = strictText(input?.thankYou, { max: ARTIST_MEMORIAL_LIMITS.thankYou, min: 3, newlines: true });
  if (!thankYou) return invalid("thankYou", `Write a thank-you between 3 and ${ARTIST_MEMORIAL_LIMITS.thankYou} characters.`);

  const accomplishments = normalizedAccomplishments(input?.accomplishments);
  if (!accomplishments) return invalid("accomplishments", `Include 1-${ARTIST_MEMORIAL_LIMITS.accomplishments} distinct accomplishments.`);

  const sourceUrl = publicHttpsSource(input?.sourceUrl);
  if (!sourceUrl) return invalid("sourceUrl", "Add one public HTTPS verification source.");

  let sourceTitle = null;
  if (input?.sourceTitle != null && input.sourceTitle !== "") {
    sourceTitle = strictText(input.sourceTitle, { max: ARTIST_MEMORIAL_LIMITS.sourceTitle });
    if (!sourceTitle) return invalid("sourceTitle", `Keep the source title under ${ARTIST_MEMORIAL_LIMITS.sourceTitle} characters.`);
  }

  return {
    valid: true,
    payload: {
      status,
      deathDate,
      summary,
      thankYou,
      accomplishments,
      sourceUrl,
      sourceTitle,
    },
  };
}

/**
 * Canonicalize the complete admin-authored memorial payload. This is a data
 * boundary, not an authorization decision: the route must still require an
 * administrator and verify the exact catalog identity before persisting it.
 */
export function parseArtistMemorialAdminPayload(input, { at = Date.now() } = {}) {
  const timestamp = validTimestamp(at);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return invalid("memorial", "Enter the memorial details before saving.");
  }

  const unexpected = Object.keys(input).find((key) => !ADMIN_FIELDS.has(key));
  if (unexpected) return invalid(unexpected, "That field is not part of an artist memorial.");
  if (input.confirmedIndividual !== true) {
    return invalid("confirmedIndividual", "Confirm that this catalog page represents the deceased individual, not a group or band member.");
  }
  if (input.restartSpotlight != null && typeof input.restartSpotlight !== "boolean") {
    return invalid("restartSpotlight", "Restart spotlight must be a true or false choice.");
  }

  const result = canonicalContent(input, { at: timestamp });
  if (!result.valid) return result;
  if (result.payload.status !== "published" && input.restartSpotlight === true) {
    return invalid("restartSpotlight", "A draft cannot start the public spotlight.");
  }
  return {
    valid: true,
    payload: {
      ...result.payload,
      confirmedIndividual: true,
      restartSpotlight: input.restartSpotlight === true,
    },
  };
}

/**
 * Apply a validated admin edit and own the publish/restart clock semantics.
 * Ordinary edits to an already-published memorial never renew its spotlight.
 */
export function transitionArtistMemorial(current, input, { at = Date.now() } = {}) {
  const timestamp = validTimestamp(at);
  const parsed = parseArtistMemorialAdminPayload(input, { at: timestamp });
  if (!parsed.valid) return parsed;

  const { restartSpotlight } = parsed.payload;
  // Keep command attestations out of the durable record by rebuilding the
  // persistence shape instead of relying on callers to omit them.
  const content = {
    status: parsed.payload.status,
    deathDate: parsed.payload.deathDate,
    summary: parsed.payload.summary,
    thankYou: parsed.payload.thankYou,
    accomplishments: [...parsed.payload.accomplishments],
    sourceUrl: parsed.payload.sourceUrl,
    sourceTitle: parsed.payload.sourceTitle,
  };
  const wasPublished = normalizedStatus(current?.status) === "published";
  let publishedAt = null;
  let spotlightStartedAt = null;
  if (content.status === "published") {
    publishedAt = wasPublished
      ? (() => {
        const previous = storedTimestamp(current?.publishedAt ?? current?.published_at);
        return previous != null && previous <= timestamp ? previous : timestamp;
      })()
      : timestamp;
    spotlightStartedAt = !wasPublished || restartSpotlight
      ? timestamp
      : (() => {
        const previous = storedTimestamp(current?.spotlightStartedAt ?? current?.spotlight_started_at);
        return previous != null && previous <= timestamp ? previous : publishedAt;
      })();
  }

  return {
    valid: true,
    record: {
      ...content,
      publishedAt,
      spotlightStartedAt,
      updatedAt: timestamp,
    },
  };
}

/**
 * Expose only presentation-safe memorial fields. The deceased marker outlives
 * the 90-day spotlight; verifier/admin identity and arbitrary stored fields are
 * deliberately not projected.
 */
export function projectArtistMemorialPublic(record, { at = Date.now() } = {}) {
  const timestamp = validTimestamp(at);
  if (normalizedStatus(record?.status) !== "published") return null;
  const canonical = canonicalContent(record, { at: timestamp });
  if (!canonical.valid || canonical.payload.status !== "published") return null;

  const storedSpotlightAt = storedTimestamp(record?.spotlightStartedAt ?? record?.spotlight_started_at);
  const storedPublishedAt = storedTimestamp(record?.publishedAt ?? record?.published_at);
  const startedAt = storedSpotlightAt != null && storedSpotlightAt <= timestamp
    ? storedSpotlightAt
    : (storedPublishedAt != null && storedPublishedAt <= timestamp ? storedPublishedAt : null);
  const endsAt = startedAt == null || !Number.isSafeInteger(startedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS)
    ? null
    : startedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS;
  const active = startedAt != null && endsAt != null && timestamp >= startedAt && timestamp < endsAt;

  return {
    deceased: true,
    deathDate: canonical.payload.deathDate,
    summary: canonical.payload.summary,
    thankYou: canonical.payload.thankYou,
    accomplishments: [...canonical.payload.accomplishments],
    citation: {
      url: canonical.payload.sourceUrl,
      title: canonical.payload.sourceTitle,
    },
    spotlight: { active, startedAt, endsAt },
  };
}
