import { activeAccountSql } from "../../accountVisibility.js";
import { artistHasLegacyMemorial, artistHasPublishedMemorial, tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";
import { canonicalBillingIdentity, storedBillingMatchesArtist } from "../../artistBillingIdentity.js";
import { currentOrUpcomingTourDateSql } from "../../tourDateLifecycle.js";
import { ApiError } from "../../errors.js";
import { inPersonReviewSql } from "../../onlineReviews.js";
import { pitArtistIdentity } from "../../sqliteFunctions.js";
import { artistScheduleCandidateIndex } from "./artistScheduleCandidateIndex.js";
import { isCurrentOrUpcomingLiveEvent, liveEventQueryFloorDate } from "../../../src/domain/eventLifecycle.mjs";

const DIMENSIONS = ["performance", "setlist", "sound", "venue", "crowd", "experience"];
const FRESH_MS = 12 * 60 * 60 * 1000;
const clean = (value, maximum) => typeof value === "string" ? value.trim().slice(0, maximum) : "";
const invalid = () => { throw new ApiError(400, "Refresh the artist dates and try again.", "VALIDATION_FAILED"); };
const numericAverage = (value) => value == null ? null : Number(value);

export function artistScheduleFilters(query = {}) {
  const limit = query.limit == null ? 12 : Number(query.limit);
  const countryCode = clean(query.countryCode, 3).toUpperCase();
  const city = clean(query.city, 121);
  const publicPreview = query.publicPreview === "1" || query.publicPreview === 1 || query.publicPreview === true;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50
    || (countryCode && !/^[A-Z]{2}$/u.test(countryCode)) || city.length > 120
    || /[\u0000-\u001f\u007f]/u.test(city)) invalid();
  return { limit, countryCode: countryCode || null, city: city || null, publicPreview };
}

function scopeKey(artistKey, filters) {
  return JSON.stringify([artistKey, filters.countryCode, filters.city?.toLocaleLowerCase("en") || null, filters.publicPreview]);
}

function decodeCursor(value, scope) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 1500 || !/^[A-Za-z0-9_-]+$/u.test(value)) invalid();
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); } catch { invalid(); }
  if (!parsed || parsed.v !== 1 || parsed.scope !== scope || typeof parsed.id !== "string"
    || !parsed.id || parsed.id.length > 240 || !/^\d{4}-\d{2}-\d{2}$/u.test(parsed.date || "")) invalid();
  return parsed;
}

function coverageProjection(row, { at, disabled, configured, count }) {
  const lastCheckedAt = Number(row?.attempted_at) || null;
  const lastSuccessAt = Number(row?.succeeded_at) || null;
  const refreshPending = row?.status === "pending" || row?.status === "running";
  const failed = !!row?.last_error_code;
  const limited = row?.ticketmaster_coverage_limited === 1;
  let status = "unknown";
  if (disabled) status = "disabled";
  else if (!configured) status = "unavailable";
  else if (limited || (failed && count > 0)) status = "partial";
  else if (failed) status = "unavailable";
  else if (lastSuccessAt) status = at - lastSuccessAt <= FRESH_MS && at >= lastSuccessAt ? "fresh" : "stale";
  return {
    status, lastCheckedAt, lastSuccessAt, refreshPending: disabled ? false : refreshPending,
    // Provider exception text and private queue/job identifiers never leave the server.
    errorCode: disabled ? null : !configured ? "PROVIDER_NOT_CONFIGURED"
      : limited ? "COVERAGE_LIMITED" : failed ? "PROVIDER_UNAVAILABLE" : null,
    basis: "stored-provider-catalog",
  };
}

function emptyReputation() {
  return { ratingCount: 0, reviewCount: 0, showCount: 0, avgRating: null, avgBand: null, avgRoom: null,
    dimensions: Object.fromEntries(DIMENSIONS.map((key) => [key, null])), basis: "in-person-reviews" };
}

// Unlike readArchive this endpoint does not hydrate review media, comments or
// tour cards, and never truncates reputation to the newest 2,000 reviews. Only
// aggregates and one bounded page cross the API boundary. No shared viewer cache
// can retain ratings after a block, account removal, or moderation change.
export function createArtistLiveSummaryService({ database, projectDate, clock = Date.now,
  providersConfigured = () => !!(process.env.TICKETMASTER_KEY || process.env.BANDSINTOWN_APP_ID) } = {}) {
  if (!database?.prepare || typeof projectDate !== "function") throw new TypeError("Artist live summary dependencies are missing");
  database.function("pit_artist_identity", { deterministic: true }, pitArtistIdentity);
  database.function("pit_live_billing_identity", { deterministic: true }, canonicalBillingIdentity);
  database.function("pit_live_billing_matches", { deterministic: true },
    (source, evidence, billed, name) => storedBillingMatchesArtist(source, evidence, billed, name) ? 1 : 0);
  database.function("pit_artist_event_current", { deterministic: true }, (date, end, timezone, at) =>
    isCurrentOrUpcomingLiveEvent({ date, eventEndDate: end, eventTimezone: timezone }, Number(at)) ? 1 : 0);
  const candidates = artistScheduleCandidateIndex(database);
  const exactNameCount = database.prepare("SELECT COUNT(*) total FROM artists WHERE name=? COLLATE NOCASE");

  const dimensionSql = DIMENSIONS.map((key) => {
    const json = "CASE WHEN json_valid(dims) THEN dims ELSE '{}' END";
    const value = `json_extract(${json},'$.${key}')`;
    return `AVG(CASE WHEN json_type(${json},'$.${key}') IN ('integer','real') AND ${value} BETWEEN 1 AND 5 THEN ${value} END) AS dim_${key}`;
  }).join(",");
  const reputation = database.prepare(`WITH ranked AS (
    SELECT p.*,ROW_NUMBER() OVER (
      PARTITION BY p.user_id,pit_artist_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue)),p.date
      ORDER BY p.created_at DESC,p.id DESC) AS vote_order
    FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.removed=0 AND ${inPersonReviewSql("p")}
      AND p.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(p.date)=p.date AND p.date<=@today
      AND (p.artist_key=@key OR (p.artist_key IS NULL AND LOWER(p.artist)=LOWER(@name)
        AND 1=(SELECT COUNT(*) FROM artists a WHERE a.name=p.artist COLLATE NOCASE)))
      AND ${activeAccountSql("u")}
      AND (COALESCE(u.profile_audience,'everyone')='everyone' OR u.id=@viewer
        OR (u.profile_audience='members' AND @viewer IS NOT NULL))
      AND (@viewer IS NULL OR NOT EXISTS(SELECT 1 FROM blocks b WHERE
        (b.blocker_id=@viewer AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=@viewer)))
  ) SELECT COUNT(CASE WHEN overall BETWEEN 1 AND 5 THEN 1 END) rating_count,
    COUNT(CASE WHEN TRIM(review)<>'' THEN 1 END) review_count,
    COUNT(DISTINCT pit_artist_identity(COALESCE(NULLIF(TRIM(venue_key),''),venue))||char(0)||date) show_count,
    AVG(CASE WHEN overall BETWEEN 1 AND 5 THEN overall END) avg_rating,
    AVG(CASE WHEN band BETWEEN 1 AND 5 THEN band END) avg_band,
    AVG(CASE WHEN room BETWEEN 1 AND 5 THEN room END) avg_room,${dimensionSql}
    FROM ranked WHERE vote_order=1`);

  const candidateSql = `WITH candidate_ids AS (
    SELECT id FROM tour_dates WHERE artist_key=@key
    UNION SELECT id FROM tour_dates WHERE artist_key IS NULL AND LOWER(artist)=LOWER(@name) AND @uniqueName=1
    UNION SELECT value FROM json_each(@billingIds)
  )`;
  const eventWhere = `FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
    WHERE td.id IN (SELECT id FROM candidate_ids) AND COALESCE(td.music_qualified,1)=1
      AND (td.artist_key=@key OR (td.artist_key IS NULL AND LOWER(td.artist)=LOWER(@name)
        AND @uniqueName=1)
        OR (td.owner_id IS NULL AND pit_live_billing_matches(td.source,td.music_evidence,td.billed_artists,@name)=1
          AND @uniqueBilling=1))
      AND ${currentOrUpcomingTourDateSql("td").replaceAll("?", "@floor")}
      AND ${tourDateHasNoPublishedMemorialSql("td")}
      AND pit_artist_event_current(td.date,td.event_end_date,td.event_timezone,@at)=1
      AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
      AND (td.owner_id IS NULL OR (${activeAccountSql("owner")}))
      AND (td.release_at<=@at OR (@publicPreview=0 AND (td.owner_id=@viewer OR @admin=1)))
      AND (@viewer IS NULL OR td.owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM blocks b WHERE
        (b.blocker_id=@viewer AND b.blocked_id=td.owner_id) OR (b.blocker_id=td.owner_id AND b.blocked_id=@viewer)))
      AND (@country IS NULL OR td.venue_country_code=@country COLLATE NOCASE)
      AND (@city IS NULL OR td.venue_city=@city COLLATE NOCASE)`;
  // All request values are bound; named placeholders keep count/page predicates identical.
  const upcomingSql = eventWhere;
  const countDates = database.prepare(`${candidateSql} SELECT COUNT(*) total ${upcomingSql}`);
  const pageDates = database.prepare(`${candidateSql} SELECT td.* ${upcomingSql}
    AND (@afterDate IS NULL OR td.date>@afterDate OR (td.date=@afterDate AND td.id>@afterId))
    ORDER BY td.date ASC,td.id ASC LIMIT @limit`);
  const queue = database.prepare("SELECT status,attempted_at,succeeded_at,ticketmaster_coverage_limited,last_error_code FROM artist_tourdate_refresh_queue WHERE artist_key=?");

  function readReputation({ artist, viewer = null, at = clock() } = {}) {
    if (!artist?.norm || !artist?.name) throw new ApiError(404, "That artist could not be found.", "NOT_FOUND");
    if (artistHasLegacyMemorial(database, { artistKey: artist.norm })) return emptyReputation();
    const row = reputation.get({ key: artist.norm, name: artist.name, viewer: viewer?.id || null,
      today: new Date(at).toISOString().slice(0, 10) });
    return { ratingCount: Number(row.rating_count), reviewCount: Number(row.review_count), showCount: Number(row.show_count),
      avgRating: numericAverage(row.avg_rating), avgBand: numericAverage(row.avg_band), avgRoom: numericAverage(row.avg_room),
      dimensions: Object.fromEntries(DIMENSIONS.map((key) => [key, numericAverage(row[`dim_${key}`])])), basis: "in-person-reviews" };
  }

  return Object.freeze({
    readReputation,
    read({ artist, viewer = null, query = {}, at: requestedAt = clock() } = {}) {
      if (!artist?.norm || !artist?.name) throw new ApiError(404, "That artist could not be found.", "NOT_FOUND");
      const filters = artistScheduleFilters(query);
      const scope = scopeKey(artist.norm, filters);
      const cursor = decodeCursor(query.after, scope);
      const at = Number.isSafeInteger(requestedAt) && requestedAt >= 0 ? requestedAt : clock();
      const viewerId = viewer?.id || null;
      const legacy = artistHasLegacyMemorial(database, { artistKey: artist.norm });
      const disabled = artistHasPublishedMemorial(database, { artistKey: artist.norm });
      const score = legacy ? emptyReputation() : readReputation({ artist, viewer, at });
      let rows = [];
      let total = 0;
      if (!disabled) {
        const billed = candidates.candidates(artist.name);
        const args = { key: artist.norm, name: artist.name, at, floor: liveEventQueryFloorDate(at), viewer: viewerId,
          billingIds: billed.ids, uniqueBilling: billed.unambiguous ? 1 : 0,
          uniqueName: Number(exactNameCount.get(artist.name).total) === 1 ? 1 : 0,
          admin: viewer?.role === "admin" && !viewer?.is_banned && !(viewer?.suspended_until > at) ? 1 : 0,
          country: filters.countryCode, city: filters.city, publicPreview: filters.publicPreview ? 1 : 0 };
        total = Number(countDates.get(args).total);
        rows = pageDates.all({ ...args, afterDate: cursor?.date || null, afterId: cursor?.id || null, limit: filters.limit + 1 });
      }
      const hasMore = rows.length > filters.limit;
      const page = rows.slice(0, filters.limit);
      const last = page.at(-1);
      const nextCursor = hasMore ? Buffer.from(JSON.stringify({ v: 1, scope, date: last.date, id: last.id })).toString("base64url") : null;
      return { artist: { key: artist.norm, name: artist.name }, reputation: score,
        schedule: { items: page.map(projectDate), total, hasMore, nextCursor, legacy,
          filters: { countryCode: filters.countryCode, city: filters.city, publicPreview: filters.publicPreview }, generatedAt: at,
          coverage: coverageProjection(queue.get(artist.norm), { at, disabled, configured: providersConfigured(), count: total }) } };
    },
  });
}
