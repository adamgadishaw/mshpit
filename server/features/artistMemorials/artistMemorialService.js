import {
  ARTIST_MEMORIAL_SPOTLIGHT_MS,
  ARTIST_MEMORIAL_STATUSES,
  parseArtistMemorialAdminPayload,
  projectArtistMemorialPublic,
  transitionArtistMemorial,
} from "../../../src/domain/artistMemorial.mjs";
import { clean } from "../../../src/domain/validation.mjs";

const STATUS_SET = new Set(ARTIST_MEMORIAL_STATUSES);
const ARTIST_KEY_MAX = 180;
const MUSICBRAINZ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function canonicalMbid(value) {
  if (typeof value !== "string") return null;
  const mbid = value.trim().toLowerCase();
  return MUSICBRAINZ_ID.test(mbid) ? mbid : null;
}

function validTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || !Number.isFinite(new Date(timestamp).getTime())) {
    throw new TypeError("Artist memorials require a valid timestamp");
  }
  return timestamp;
}

function accomplishmentsFromRow(row) {
  try {
    const parsed = JSON.parse(row?.accomplishments || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

function domainRecord(row) {
  if (!row) return null;
  return {
    status: row.status,
    deathDate: row.death_date,
    summary: row.summary,
    thankYou: row.thank_you,
    accomplishments: accomplishmentsFromRow(row),
    sourceUrl: row.source_url,
    sourceTitle: row.source_title || null,
    publishedAt: row.published_at ?? null,
    spotlightStartedAt: row.spotlight_started_at ?? null,
    updatedAt: row.updated_at,
  };
}

function spotlightState(record, at) {
  const startedAt = record?.spotlightStartedAt != null && Number.isSafeInteger(Number(record.spotlightStartedAt))
    ? Number(record.spotlightStartedAt) : null;
  const endsAt = startedAt == null ? null : startedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS;
  return {
    spotlightStartedAt: startedAt,
    spotlightEndsAt: Number.isSafeInteger(endsAt) ? endsAt : null,
    spotlightActive: startedAt != null && Number.isSafeInteger(endsAt) && at >= startedAt && at < endsAt,
  };
}

function adminProjection(row, at) {
  if (!row) return null;
  const record = domainRecord(row);
  return Object.freeze({
    artistKey: row.artist_key,
    artistName: row.artist_name,
    status: record.status,
    deathDate: record.deathDate,
    summary: record.summary,
    thankYou: record.thankYou,
    accomplishments: Object.freeze([...record.accomplishments]),
    sourceUrl: record.sourceUrl,
    sourceTitle: record.sourceTitle,
    publishedAt: record.publishedAt,
    ...spotlightState(record, at),
    updatedAt: record.updatedAt,
  });
}

function searchProjection(row, at) {
  const memorial = projectArtistMemorialPublic(domainRecord(row), { at });
  if (!memorial) return null;
  return Object.freeze({
    artistKey: row.artist_key,
    deceased: true,
    deathDate: memorial.deathDate,
    spotlight: memorial.spotlight,
  });
}

function matchingPublishedProjection(row, artistMbid, at) {
  const mbid = canonicalMbid(artistMbid);
  if (!row || !mbid || row.artist_mbid !== mbid) return null;
  return projectArtistMemorialPublic(domainRecord(row), { at });
}

function matchingPublishedDetail(row, artistMbid, at) {
  const memorial = matchingPublishedProjection(row, artistMbid, at);
  if (!memorial) return null;
  const updatedAt = Number(row?.updated_at);
  return Object.freeze({
    memorial,
    updatedAt: Number.isSafeInteger(updatedAt) && updatedAt >= 0 ? updatedAt : null,
  });
}

export function memorialAuditProjection(row) {
  if (!row) return null;
  const record = domainRecord(row);
  const startedAt = record.spotlightStartedAt != null && Number.isSafeInteger(Number(record.spotlightStartedAt))
    ? Number(record.spotlightStartedAt) : null;
  const endsAt = startedAt == null ? null : startedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS;
  return Object.freeze({
    status: record.status,
    deathDate: record.deathDate,
    accomplishmentCount: record.accomplishments.length,
    publishedAt: record.publishedAt,
    spotlightStartedAt: startedAt,
    spotlightEndsAt: Number.isSafeInteger(endsAt) ? endsAt : null,
  });
}

function sameRecord(previous, record, artistName, artistMbid) {
  const current = domainRecord(previous);
  return current
    && previous.artist_mbid === artistMbid
    && previous.artist_name === artistName
    && current.status === record.status
    && current.deathDate === record.deathDate
    && current.summary === record.summary
    && current.thankYou === record.thankYou
    && JSON.stringify(current.accomplishments) === JSON.stringify(record.accomplishments)
    && current.sourceUrl === record.sourceUrl
    && current.sourceTitle === record.sourceTitle
    && current.publishedAt === record.publishedAt
    && current.spotlightStartedAt === record.spotlightStartedAt;
}

export function createArtistMemorialService({ repository }) {
  if (!repository?.findByArtistKey || !repository?.listAdmin || !repository?.findPublishedForSearch
    || !repository?.findPublishedByArtistKeys || !repository?.upsert || typeof repository.transaction !== "function") {
    throw new TypeError("Artist memorials require complete service dependencies");
  }

  function readPublicDetailsForArtistKeys({ artistKeys, artistMbids, at }) {
    const readAt = validTimestamp(at);
    if (!Array.isArray(artistKeys) || artistKeys.length > 40) {
      throw new TypeError("Artist memorial batch reads require no more than 40 artist keys");
    }
    if (!(artistMbids instanceof Map)) {
      throw new TypeError("Artist memorial batch reads require current MusicBrainz identities");
    }
    const keys = [];
    const seen = new Set();
    for (const value of artistKeys) {
      const key = clean(value, { max: ARTIST_KEY_MAX + 1 });
      if (typeof value !== "string" || key !== value || !key || key.length > ARTIST_KEY_MAX || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    const details = new Map();
    for (const row of repository.findPublishedByArtistKeys(keys)) {
      const detail = matchingPublishedDetail(row, artistMbids.get(row.artist_key), readAt);
      if (detail) details.set(row.artist_key, detail);
    }
    return details;
  }

  return Object.freeze({
    readPublic({ artistKey, artistMbid, at }) {
      const readAt = validTimestamp(at);
      return matchingPublishedProjection(repository.findByArtistKey(artistKey), artistMbid, readAt);
    },

    readPublicWithMetadata({ artistKey, artistMbid, at }) {
      const readAt = validTimestamp(at);
      return matchingPublishedDetail(repository.findByArtistKey(artistKey), artistMbid, readAt);
    },

    readPublicSearch({ query = null, limit = 20, artistMbids, at }) {
      const readAt = validTimestamp(at);
      if (!(artistMbids instanceof Map)) {
        throw new TypeError("Artist memorial search reads require current MusicBrainz identities");
      }
      const normalizedQuery = query == null || query === "" ? null : clean(query, { max: 121 });
      if (normalizedQuery && normalizedQuery.length > 120) return [];
      if (query != null && query !== "" && !normalizedQuery) return [];
      const take = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)));
      return repository.findPublishedForSearch({ query: normalizedQuery, limit: take })
        .filter((row) => canonicalMbid(artistMbids.get(row.artist_key)) === row.artist_mbid)
        .map((row) => searchProjection(row, readAt))
        .filter(Boolean);
    },

    readPublicForArtistKeys({ artistKeys, artistMbids, at }) {
      const details = readPublicDetailsForArtistKeys({ artistKeys, artistMbids, at });
      const memorials = new Map();
      for (const [artistKey, detail] of details) memorials.set(artistKey, detail.memorial);
      return memorials;
    },

    readPublicForArtistKeysWithMetadata(options) {
      return readPublicDetailsForArtistKeys(options);
    },

    listAdmin({ status = null, query = null, limit = 50, at }) {
      const readAt = validTimestamp(at);
      const normalizedStatus = status == null || status === "" ? null : String(status).trim().toLowerCase();
      if (normalizedStatus && !STATUS_SET.has(normalizedStatus)) return null;
      const normalizedQuery = query == null || query === "" ? null : clean(query, { max: 121 });
      if (normalizedQuery && normalizedQuery.length > 120) return null;
      if (query != null && query !== "" && !normalizedQuery) return null;
      const take = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 50)));
      return repository.listAdmin({ status: normalizedStatus, query: normalizedQuery, limit: take })
        .map((row) => adminProjection(row, readAt));
    },

    upsert(input, { artistKey, artistName, artistMbid, at, audit }) {
      const updatedAt = validTimestamp(at);
      const canonicalKey = clean(artistKey, { max: ARTIST_KEY_MAX + 1 });
      const canonicalName = clean(artistName, { max: 161 });
      const canonicalArtistMbid = canonicalMbid(artistMbid);
      if (!canonicalKey || canonicalKey.length > ARTIST_KEY_MAX || !canonicalName || canonicalName.length > 160
        || !canonicalArtistMbid) {
        return { ok: false, field: "artistKey", message: "Choose a canonical catalog artist before saving." };
      }
      const parsed = parseArtistMemorialAdminPayload(input, { at: updatedAt });
      if (!parsed.valid) return { ok: false, validation: true, ...parsed };

      return repository.transaction(() => {
        const previous = repository.findByArtistKey(canonicalKey);
        if (previous?.artist_mbid != null && previous.artist_mbid !== canonicalArtistMbid) {
          return {
            ok: false,
            conflict: true,
            field: "artistKey",
            message: "This catalog key now belongs to a different MusicBrainz identity. Review the existing memorial before editing.",
          };
        }
        const transitioned = transitionArtistMemorial(domainRecord(previous), parsed.payload, { at: updatedAt });
        if (!transitioned.valid) return { ok: false, validation: true, ...transitioned };
        if (sameRecord(previous, transitioned.record, canonicalName, canonicalArtistMbid)) {
          return { ok: true, changed: false, memorial: adminProjection(previous, updatedAt) };
        }
        const next = repository.upsert({
          artistKey: canonicalKey,
          artistMbid: canonicalArtistMbid,
          artistName: canonicalName,
          ...transitioned.record,
          createdAt: previous?.created_at ?? updatedAt,
        });
        if (!next) throw new Error("Artist memorial persistence failed");
        if (typeof audit === "function") {
          audit({
            previous: memorialAuditProjection(previous),
            next: memorialAuditProjection(next),
          });
        }
        return { ok: true, changed: true, memorial: adminProjection(next, updatedAt) };
      });
    },
  });
}
