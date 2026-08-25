import {
  ARTIST_MEMORIAL_SPOTLIGHT_MS,
  parseArtistMemorialAdminPayload,
} from "../../domain/artistMemorial.mjs";
import { clean } from "../../domain/validation.mjs";

const ARTIST_KEY_MAX = 180;

function artistKey(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  const key = clean(raw, { max: ARTIST_KEY_MAX + 1 });
  if (!key || key !== raw || key.length > ARTIST_KEY_MAX) {
    throw new TypeError("Artist memorial requests require a valid artist key.");
  }
  return key;
}

function expectedAccountId(value) {
  if (value === undefined) return undefined;
  if (value == null) return null;
  const accountId = clean(value, { max: 180 });
  return accountId || null;
}

function timestamp(value, { nullable = false, label = "timestamp" } = {}) {
  if (nullable && value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || !Number.isFinite(new Date(parsed).getTime())) {
    throw new TypeError(`Artist memorial ${label} is invalid.`);
  }
  return parsed;
}

function parseAdminRecord(input, { at = Date.now() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Artist memorial response is invalid.");
  }
  const key = artistKey(input.artistKey ?? input.artist_key);
  const parsed = parseArtistMemorialAdminPayload({
    status: input.status,
    deathDate: input.deathDate ?? input.death_date,
    summary: input.summary,
    thankYou: input.thankYou ?? input.thank_you,
    accomplishments: input.accomplishments,
    sourceUrl: input.sourceUrl ?? input.source_url,
    sourceTitle: input.sourceTitle ?? input.source_title,
    confirmedIndividual: true,
    restartSpotlight: false,
  }, { at });
  if (!parsed.valid) throw new TypeError(`Artist memorial response is invalid: ${parsed.field}.`);

  const publishedAt = timestamp(input.publishedAt ?? input.published_at, { nullable: true, label: "publication time" });
  const spotlightStartedAt = timestamp(input.spotlightStartedAt ?? input.spotlight_started_at, { nullable: true, label: "spotlight time" });
  const updatedAt = timestamp(input.updatedAt ?? input.updated_at, { label: "update time" });
  if (parsed.payload.status === "draft" && (publishedAt != null || spotlightStartedAt != null)) {
    throw new TypeError("Draft artist memorial response contains public timestamps.");
  }
  if (parsed.payload.status === "published" && (publishedAt == null || spotlightStartedAt == null)) {
    throw new TypeError("Published artist memorial response is missing public timestamps.");
  }
  if (parsed.payload.status === "published"
    && (publishedAt > spotlightStartedAt || spotlightStartedAt > updatedAt)) {
    throw new TypeError("Published artist memorial response has inconsistent public timestamps.");
  }
  const spotlightEndsAt = spotlightStartedAt == null ? null : spotlightStartedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS;
  if (spotlightEndsAt != null && !Number.isSafeInteger(spotlightEndsAt)) {
    throw new TypeError("Artist memorial spotlight window is invalid.");
  }
  const now = timestamp(at, { label: "projection time" });
  const { confirmedIndividual: _confirmation, restartSpotlight: _restart, ...content } = parsed.payload;
  return {
    artistKey: key,
    artistName: clean(input.artistName ?? input.artist_name, { max: 120 }) || key,
    ...content,
    publishedAt,
    spotlightStartedAt,
    spotlightEndsAt,
    spotlightActive: spotlightStartedAt != null && now >= spotlightStartedAt && now < spotlightEndsAt,
    updatedAt,
  };
}

function parsePublicProjection(input, { at = Date.now() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.deceased !== true) {
    throw new TypeError("Public artist memorial response is invalid.");
  }
  const parsed = parseArtistMemorialAdminPayload({
    status: "published",
    deathDate: input.deathDate,
    summary: input.summary,
    thankYou: input.thankYou,
    accomplishments: input.accomplishments,
    sourceUrl: input.citation?.url,
    sourceTitle: input.citation?.title,
    confirmedIndividual: true,
    restartSpotlight: false,
  }, { at });
  if (!parsed.valid) throw new TypeError(`Public artist memorial response is invalid: ${parsed.field}.`);
  const startedAt = timestamp(input.spotlight?.startedAt, { nullable: true, label: "spotlight start" });
  const endsAt = timestamp(input.spotlight?.endsAt, { nullable: true, label: "spotlight end" });
  if ((startedAt == null) !== (endsAt == null)
    || (startedAt != null && endsAt !== startedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS)) {
    throw new TypeError("Public artist memorial spotlight window is invalid.");
  }
  const now = timestamp(at, { label: "projection time" });
  const { confirmedIndividual: _confirmation, restartSpotlight: _restart, status: _status, sourceUrl, sourceTitle, ...content } = parsed.payload;
  return {
    deceased: true,
    ...content,
    citation: { url: sourceUrl, title: sourceTitle },
    spotlight: {
      active: startedAt != null && now >= startedAt && now < endsAt,
      startedAt,
      endsAt,
    },
  };
}

export function artistMemorialPublicRequest({ artistKey: value, accountId } = {}) {
  const key = artistKey(value);
  return {
    path: `/api/artists/${encodeURIComponent(key)}/memorial`,
    expectedAccountId: expectedAccountId(accountId),
  };
}

export function artistMemorialAdminListRequest({ accountId } = {}) {
  return {
    path: "/api/admin/artist-memorials",
    expectedAccountId: expectedAccountId(accountId),
  };
}

export function artistMemorialSaveRequest(input, { accountId, at = Date.now() } = {}) {
  const key = artistKey(input?.artistKey);
  const parsed = parseArtistMemorialAdminPayload({
    status: input?.status,
    deathDate: input?.deathDate,
    summary: input?.summary,
    thankYou: input?.thankYou,
    accomplishments: input?.accomplishments,
    sourceUrl: input?.sourceUrl,
    sourceTitle: input?.sourceTitle,
    confirmedIndividual: input?.confirmedIndividual,
    restartSpotlight: input?.restartSpotlight,
  }, { at });
  if (!parsed.valid) {
    const error = new TypeError(parsed.message);
    error.field = parsed.field;
    throw error;
  }
  return {
    path: `/api/admin/artist-memorials/${encodeURIComponent(key)}`,
    expectedAccountId: expectedAccountId(accountId),
    body: parsed.payload,
  };
}

export function artistMemorialFromResponse(response, { at = Date.now() } = {}) {
  if (!response || typeof response !== "object" || Array.isArray(response) || !Object.hasOwn(response, "memorial")) {
    throw new TypeError("Artist memorial response is invalid.");
  }
  return response.memorial == null ? null : parsePublicProjection(response.memorial, { at });
}

export function artistMemorialListFromResponse(response, { at = Date.now() } = {}) {
  if (!response || typeof response !== "object" || !Array.isArray(response.memorials)) {
    throw new TypeError("Artist memorial list response is invalid.");
  }
  return response.memorials.map((record) => parseAdminRecord(record, { at }));
}

export function artistMemorialSavedFromResponse(response, { at = Date.now() } = {}) {
  if (!response || typeof response !== "object" || Array.isArray(response) || !response.memorial) {
    throw new TypeError("Saved artist memorial response is invalid.");
  }
  return parseAdminRecord(response.memorial, { at });
}
