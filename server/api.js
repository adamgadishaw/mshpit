import { MEDIA_POST_MAX_ATTACHMENTS } from "../src/domain/mediaUploadPolicy.mjs";
// API routes. Conventions that keep this hard to crash and easy to fix:
// - every route: authenticate -> rate-limit -> validate (shape) -> act -> respond
// - all handlers are wrapped by the server's try/catch; throwing ApiError(status,
//   message, stableCode) is the ONLY sanctioned way to fail; anything else is a
//   clean INTERNAL_ERROR with a request ID and no internal details
// - responses only ever contain public projections (publicUser), never raw rows
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mailConfigured, mailDiagnostics } from "./mailer.js";
import { DEFAULT_TEMPLATES, availableTokens, isCodeOwnedTemplate, renderEmail, safeUrl } from "./emails.js";
import {
  dailySendLimit, deliver, logStatsSince, publicOrigin, recentLog, remainingToday,
  sendTemplate, sendTemplateInBackground, sentToday, templateFor, unsubscribeUrl,
} from "./emailService.js";
import { AUDIENCES, audienceSize, campaignProgress, drainCampaign, pauseCampaign, startCampaign } from "./emailQueue.js";
import { db, DATABASE_PATH, q, emailStmts, badgeStmts, customBadgesFor, publicUser as storedPublicUser, parseJsonArray, parseJsonObject, artistStmts, publicArtist, artistRow, artistSearchKey, normName, pruneMissingArtists } from "./db.js";
import { BADGE_COLORS, BADGE_GLYPHS, BADGE_KINDS, validateBadge } from "../src/domain/badgeArt.mjs";
import { alertCooldownMs, alertRecipient, alertsEnabled, errorStats, maybeAlert, recentErrors, recordError } from "./errorLog.js";
import { genreClaim, resolveGenre, storedClaims, upsertClaim, withoutSource } from "../src/domain/genre.mjs";
import { deezerEnrichmentGenreFields } from "./deezerGenre.js";
import { ARTIST_GENRE_SQL_COLUMNS, projectArtistGenreColumns } from "./artistGenreProjection.js";
import { hashPassword, verifyPassword, verifyPasswordForUser, createSession, destroySession, rateLimit, reserveRateLimits } from "./auth.js";
import { createRecoveryResponseFloor } from "./authResponseFloor.js";
import { startCatalogSeed, catalogSeedStatus, stopCatalogSeed, deezerEnrich } from "./catalogSeed.js";
import { clean, cleanEmail, isEmail, cleanName, isName, cleanHandle, isPassword, clampRating, cleanStringArray, cleanDate, shape, LIMITS } from "./validate.js";
import { ApiError, privateErrorLabel } from "./errors.js";
import {
  mediaConfigured,
  privateMediaIsolationStatus,
  privateVideoMediaConfigured,
} from "./media.js";
import {
  assertPhotosMatchSelection,
  assetIdsMatchingPostPhotos,
  assetObjectRecords,
  attachPostMedia,
  cleanMediaAssetIds,
  cancelMediaAsset,
  createMediaAsset,
  createMediaVariant,
  deleteMediaAssets,
  finalizeMediaAsset,
  finalizeMediaVariant,
  isTerminalMediaSourceFailure,
  mediaSelection,
  ownedMediaAsset,
  postMediaAssetIds,
  postMediaState,
  postMediaStateByPost,
  replacePostMedia,
  updateMediaAsset,
} from "./mediaAssets.js";
import { mediaAssetRoutes } from "./mediaAssetRoutes.js";
import { mediaLegacyFinalizeRoutes } from "./mediaLegacyFinalizeRoutes.js";
import { directMessageReadProjection, dmReadRoutes } from "./dmReadRoutes.js";
import { postTagRoutes } from "./postTagRoutes.js";
import { artistReviewRoutes } from "./features/artistReviews/artistReviewRoutes.js";
import { artistArchiveRoutes } from "./features/artistArchive/artistArchiveRoutes.js";
import { accountPrivacyRoutes } from "./features/accountPrivacy/accountPrivacyRoutes.js";
import { artistDiscographyRoutes } from "./features/artistDiscography/artistDiscographyRoutes.js";
import { showAttendanceRoutes } from "./features/shows/showAttendanceRoutes.js";
import { showRoutes } from "./features/shows/showRoutes.js";
import { createShowAttendanceRepository } from "./features/shows/showAttendanceRepository.js";
import {
  enqueueAllOwnedMedia,
  enqueueOwnedMediaKeys,
  enqueueOwnedMediaUrls,
  enqueueOwnerMediaSweep,
  markOwnedMediaAssociated,
  mediaDeletionHealth,
  unreferencedOwnedMediaUrls,
} from "./mediaDeletion.js";
import {
  associateFinalizedLegacyMedia,
  ensureLegacyMediaFinalizeSchema,
  eraseLegacyMediaFinalizeDescriptors,
  legacyMediaFinalizeHealth,
  verifiedFinalizedLegacyMedia,
} from "./mediaLegacyFinalize.js";
import { imageProcessorHealth } from "./imageProcessor.js";
import {
  legacyVideoPosterDescriptors,
  legacyVideoPosterDescriptorsByPost,
  retireLegacyVideoPosters,
} from "./legacyVideoPosters.js";
import {
  legacyImageRecoveryEnabled,
  legacyImageRecoveryHealth,
} from "./legacyPostImageRecovery.js";
import { discoverySidebar } from "./discovery.js";
import { resolveEntity, sitemapSnapshotHealth } from "./seo.js";
import { userRewards } from "./rewards.js";
import { beginVerification, completeVerification, resendVerification, sendWelcomeOnce, verificationEnabled } from "./verification.js";
import {
  clearYouTubeTrackCache,
  ProviderError,
  findDeezerArtistCandidates,
  getDeezerDiscography,
  getFreshDeezerPreview,
  legacyTrackOverrideKey,
  normalizeMusicText,
  parseYouTubeVideoId,
  resolveYouTubeTrack,
  searchCatalogSongs,
  searchDeezerTracks,
  trackOverrideKey,
  trackSourceOverrideKey,
  youtubeOEmbed,
  youtubeProviderStatus,
} from "./musicProviders.js";
import { sameTrackOverrideIdentity } from "./trackIdentity.js";
import { wikidataProviderStatus } from "./wikidataChannels.js";
import { backgroundJobEnabled } from "./backgroundJobs.js";
import { backupSchedulerEnabled, offhostBackupConfigured } from "./backupScheduler.js";
import {
  mediaPublishingCapabilitiesForRuntime,
} from "../src/domain/mediaPublishingCapabilities.mjs";
import { verifyVideoObject, videoVerifierRuntimeStatus } from "./videoVerifier.js";
import { VIDEO_VERIFIER_PIPELINE_VERSION } from "./videoVerifierProtocol.js";
import {
  startVideoFinalizeJob,
  videoFinalizeState,
  waitForVideoFinalizeCompletion,
} from "./videoFinalizeJobs.js";
import { discoverChart, discoverCountries, discoverGenres, discoverOverview } from "./discoverService.js";
import {
  applyModerationAction,
  moderationOverview,
  openModerationReports,
  recordModerationAction as moderationRecord,
} from "./moderation.js";
import { ANALYTICS_MAX_RAW_ROWS, ANALYTICS_MAX_ROWS_PER_ACCOUNT, ANALYTICS_RETENTION_DAYS, ingestAnalyticsBatch } from "./analyticsService.js";
import { readGuestSearchAnalytics } from "./guestSearchAnalytics.js";
import { guestSearchAnalyticsRoutes } from "./features/guestSearchAnalytics/guestSearchAnalyticsRoutes.js";
import { suggestionRoutes } from "./features/suggestions/suggestionRoutes.js";
import { artistMemorialRoutes } from "./features/artistMemorials/artistMemorialRoutes.js";
import { createArtistMemorialRepository } from "./features/artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "./features/artistMemorials/artistMemorialService.js";
import { recommendedFeedPage } from "./recommendationService.js";
import { hasTrustedLandingImage, landingCommunityMedia, landingTotals } from "./landingMedia.js";
import { createSuccessfulReadinessCache } from "./healthAvailability.js";
import { assertSafeAuthoredFields, assertSafeAuthoredText } from "./contentSafety.js";
import { canonicalProfileExtras } from "./profileExtras.js";
import { licensedVenuePhoto, verifiedHttpsUrl } from "../src/domain/venuePhotoProvenance.mjs";
import { accountIsPublic, activeAccountSql } from "./accountVisibility.js";
import { visibleTourDateRows } from "./tourDateVisibility.js";
import { safeOwnedReadyMediaUrl } from "./publicMedia.js";
import { normalizeArtistCampaign } from "../src/domain/artistCampaignPost.mjs";
import { normalizeTaggedUserIds } from "../src/domain/postFriendTags.mjs";
import { canonicalTicketUrl, projectedTourDateTicketUrl } from "../src/domain/ticketLinks.mjs";
import { isOwnerId, ownerAccount } from "./ownerIdentity.js";
import {
  createOwnerApprovalRequest,
  emailOwnerApprovalRequest,
} from "./ownerApprovals.js";
import { ownerApprovalRoutes } from "./features/ownerApprovals/ownerApprovalRoutes.js";

export { ApiError } from "./errors.js";

const now = () => Date.now();
const showAttendanceRepository = createShowAttendanceRepository(db);
const artistMemorialService = createArtistMemorialService({
  repository: createArtistMemorialRepository(db),
});
ensureLegacyMediaFinalizeSchema(db);
const uid = (p) => `${p}_${randomUUID().slice(0, 12)}`;
const PROFILE_EXTRAS_MAX_BYTES = 8000;
const CURRENT_TERMS_VERSION = "2026-08";
const CURRENT_MARKETING_CONSENT_VERSION = "2026-08";
// Corrected licensed inventory must replace previously cached empty responses.
// Keep revalidation short until production has completed one healthy cache cycle.
const VENUE_PHOTO_CACHE_CONTROL = "public, max-age=60, must-revalidate";
const YOUTUBE_COLD_SEARCH_ACTOR_BUDGET_VERSION = 2;
// v2 is charged once per explicit cold track attempt, not once per internal
// provider request. Twenty listener attempts leaves useful room for discovery;
// the shared provider ceiling remains the final hard stop at 100 searches/day.
const YOUTUBE_COLD_SEARCH_USER_DAILY_LIMIT = 20;
const YOUTUBE_COLD_SEARCH_IP_DAILY_LIMIT = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
// These sit far above the one-slot worker's physical hourly throughput. They
// are incident breakers, not a creator allowance, so an eight-clip post cannot
// make a second post fail halfway through.
const VIDEO_VERIFY_USER_HOURLY_LIMIT = 240;
const VIDEO_VERIFY_IP_HOURLY_LIMIT = 480;
const VIDEO_VERIFY_GLOBAL_HOURLY_LIMIT = 2_000;
const MUSICBRAINZ_ARTIST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MUSICBRAINZ_ARTIST_LOOKUP_TIMEOUT_MS = 12_000;
const VIDEO_CACHED_FINALIZE_WAIT_MS = 18_000;
const runtimeReadinessSuccessCache = createSuccessfulReadinessCache();
const YOUTUBE_PLAYBACK_FAILURE_TTL_MS = 30 * DAY_MS;
const VENUE_PHOTO_LIMIT = 24;
const VENUE_PHOTO_SOURCE = new URL("../src/seed/catalog.venue-photos.json", import.meta.url);
let venuePhotoCatalog;

function decodedPathParam(ctx, name, { max, label = "link" }) {
  const raw = ctx?.params?.[name];
  if (typeof raw !== "string" || raw.length > max * 12 + 16) {
    throw new ApiError(400, `That ${label} is invalid.`, "VALIDATION_FAILED");
  }
  let decoded;
  try { decoded = decodeURIComponent(raw); }
  catch { throw new ApiError(400, `That ${label} is invalid.`, "VALIDATION_FAILED"); }
  // `clean` truncates ordinary authored text for UX. A route identity must never
  // truncate: two distinct overlong URLs resolving to the same database key is
  // an ambiguous authorization and pagination boundary.
  if ([...decoded].length > max) {
    throw new ApiError(400, `That ${label} is too long.`, "VALIDATION_FAILED");
  }
  return clean(decoded, { max });
}

function venuePhotoSeed() {
  if (venuePhotoCatalog) return venuePhotoCatalog;
  try {
    const parsed = JSON.parse(readFileSync(VENUE_PHOTO_SOURCE, "utf8"));
    venuePhotoCatalog = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    return venuePhotoCatalog;
  } catch (error) {
    throw new ApiError(500, "Venue photos are temporarily unavailable.", "INTERNAL_ERROR", error);
  }
}

function normalizedVenuePhotoPool(key) {
  const raw = venuePhotoSeed()[key];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const gallery = Array.isArray(raw.galleryPool) ? raw.galleryPool : [];
  const licensed = gallery.map(licensedVenuePhoto).filter(Boolean);
  const byUrl = new Map(licensed.map((entry) => [entry.uri, entry]));
  const preferred = Array.isArray(raw.photos)
    ? raw.photos.map((uri) => byUrl.get(verifiedHttpsUrl(uri))).filter(Boolean)
    : [];
  const out = [];
  const seen = new Set();
  for (const entry of [...preferred, ...licensed]) {
    if (seen.has(entry.uri)) continue;
    seen.add(entry.uri);
    out.push(entry);
    if (out.length >= VENUE_PHOTO_LIMIT) break;
  }
  return out;
}

function serializeProfileExtras(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || Buffer.byteLength(encoded, "utf8") > PROFILE_EXTRAS_MAX_BYTES) return null;
    return encoded;
  } catch {
    return null;
  }
}

function parseStoredProfileExtras(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Advance a timestamp by N business days (skip Sat/Sun), for the @handle cooldown.
function addBusinessDays(ts, n) {
  const d = new Date(ts);
  let added = 0;
  while (added < n) { d.setUTCDate(d.getUTCDate() + 1); const day = d.getUTCDay(); if (day !== 0 && day !== 6) added++; }
  return d.getTime();
}
const HANDLE_COOLDOWN_DAYS = 10; // business days between username changes
const AUTH_RATE_SCOPE = randomBytes(32);
function jsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
// Staff must carry their role in their @ (moderator → "mod", admin → "admin").
function handleAllowedForRole(handle, role) {
  if (role === "admin") return handle.includes("admin");
  if (role === "moderator") return handle.includes("mod");
  return true;
}

function requireSessionUser(ctx) {
  if (!ctx.user) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED");
  return ctx.user;
}
function requireUser(ctx) {
  const user = requireSessionUser(ctx);
  if (user.is_banned) throw new ApiError(403, "This account is banned.", "FORBIDDEN");
  if (user.suspended_until && user.suspended_until > now()) throw new ApiError(403, "This account is suspended.", "FORBIDDEN");
  return user;
}
function requireVerifiedUser(ctx) {
  const user = requireUser(ctx);
  if (!user.email_verified_at) {
    throw new ApiError(403, "Confirm your email before viewing attendee identities.", "EMAIL_VERIFICATION_REQUIRED");
  }
  return user;
}
function publicAccountOrNull(id) {
  const user = q.userById.get(id);
  return accountIsPublic(user) ? user : null;
}
function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (u.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN");
  return u;
}
function requireModerator(ctx) {
  const u = requireUser(ctx);
  if (u.role !== "admin" && u.role !== "moderator") throw new ApiError(403, "Moderators only.", "FORBIDDEN");
  return u;
}
function requireOwner(ctx) {
  const user = requireAdmin(ctx);
  if (!isOwnerId(db, user.id)) throw new ApiError(403, "The locked Mshpit Owner must approve this action.", "FORBIDDEN");
  return user;
}
function assertModerationRank(actor, target) {
  if (isOwnerId(db, target?.id)) {
    throw new ApiError(403, "The Owner account cannot be restricted.", "FORBIDDEN");
  }
  if (actor?.role === "admin") {
    if (target?.role === "admin") throw new ApiError(403, "Administrator accounts require Owner approval.", "FORBIDDEN");
    return;
  }
  if (target?.role === "admin" || target?.role === "moderator") {
    throw new ApiError(403, "Staff accounts require administrator review.", "FORBIDDEN");
  }
}
function limit(ctx, name, max, windowMs) {
  // Authenticated activity is primarily limited per account so users behind the
  // same carrier/proxy do not consume one shared posting or messaging bucket.
  const actor = ctx.user?.id ? `user:${ctx.user.id}` : `ip:${ctx.ip}`;
  if (!rateLimit(`${name}:${actor}`, max, windowMs)) throw new ApiError(429, "Too many requests, slow down and try again.", "RATE_LIMITED");
}

function limitAuthentication(ctx, name, {
  ipMax,
  ipWindowMs,
  target,
  targetMax = ipMax,
  targetWindowMs = ipWindowMs,
} = {}) {
  const normalizedTarget = cleanEmail(target);
  const requests = [{ key: `${name}:ip:${ctx.ip}`, max: ipMax, windowMs: ipWindowMs }];
  if (normalizedTarget) {
    const targetScope = createHash("sha256")
      .update(AUTH_RATE_SCOPE)
      .update("\0")
      .update(normalizedTarget)
      .digest("hex");
    requests.push({ key: `${name}:target:${targetScope}`, max: targetMax, windowMs: targetWindowMs });
  }
  const reservation = reserveRateLimits(requests);
  if (!reservation) throw new ApiError(429, "Too many requests, slow down and try again.", "RATE_LIMITED");
  reservation.commit();
}

function desiredState(body, field, current) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, field)) return !current;
  if (typeof body[field] !== "boolean") throw new ApiError(400, `${field} must be true or false.`, "VALIDATION_FAILED");
  return body[field];
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.created_at, row.id]), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!Number.isSafeInteger(createdAt) || createdAt < 0 || typeof id !== "string" || !id || id.length > 100) throw new Error();
    return { createdAt, id };
  } catch {
    throw new ApiError(400, "That page link is invalid. Refresh and try again.", "VALIDATION_FAILED");
  }
}

function pageRequest(ctx, defaultLimit, maxLimit) {
  const requested = Number(ctx.query?.limit);
  const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, maxLimit) : defaultLimit;
  return { cursor: decodeCursor(ctx.query?.before), limit };
}

function finishPage(rows, limit) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { rows: page, nextCursor: hasMore && page.length ? encodeCursor(page.at(-1)) : null };
}

function youtubeQuotaDay(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function youtubeColdSearchActorAllowance(user, value = new Date()) {
  const day = youtubeQuotaDay(value);
  const key = `youtube_cold_user:v${YOUTUBE_COLD_SEARCH_ACTOR_BUDGET_VERSION}:${day}:${user?.id || ""}`;
  const used = user?.id
    ? Math.max(0, Number(db.prepare("SELECT value FROM app_meta WHERE key=?").get(key)?.value) || 0)
    : 0;
  const accountVerified = !!user?.email_verified_at;
  const adminBypass = user?.role === "admin";
  return {
    version: YOUTUBE_COLD_SEARCH_ACTOR_BUDGET_VERSION,
    day,
    eligible: accountVerified || adminBypass,
    accountVerified,
    adminBypass,
    used,
    limit: YOUTUBE_COLD_SEARCH_USER_DAILY_LIMIT,
    remaining: Math.max(0, YOUTUBE_COLD_SEARCH_USER_DAILY_LIMIT - used),
    key,
  };
}

function reserveYouTubeColdSearch(ctx, user) {
  const allowance = youtubeColdSearchActorAllowance(user);
  const { day } = allowance;
  const ipHash = createHash("sha256").update(String(ctx.ip || "unknown")).digest("hex").slice(0, 24);
  // Fast process-local gates stop one account or network from hammering SQLite.
  // The account allowance is also persisted below so a restart cannot reset it;
  // raw IP addresses never enter SQLite.
  const localReservation = reserveRateLimits([
    { key: `yt-cold-v${YOUTUBE_COLD_SEARCH_ACTOR_BUDGET_VERSION}-user:${day}:${user.id}`, max: YOUTUBE_COLD_SEARCH_USER_DAILY_LIMIT, windowMs: DAY_MS },
    { key: `yt-cold-v${YOUTUBE_COLD_SEARCH_ACTOR_BUDGET_VERSION}-ip:${day}:${ipHash}`, max: YOUTUBE_COLD_SEARCH_IP_DAILY_LIMIT, windowMs: DAY_MS },
  ]);
  if (!localReservation) {
    throw new ProviderError("YouTube", 429, "Your daily YouTube search allowance is used.", {
      code: "search_actor_budget_exhausted",
      retryable: false,
    });
  }
  try {
    const prefix = `youtube_cold_user:v${YOUTUBE_COLD_SEARCH_ACTOR_BUDGET_VERSION}:${day}:`;
    atomicWrite(() => {
      db.prepare("DELETE FROM app_meta WHERE key GLOB 'youtube_cold_user:*' AND key NOT GLOB ?").run(`${prefix}*`);
      const reserved = db.prepare(`INSERT INTO app_meta (key,value) VALUES (?,'1')
        ON CONFLICT(key) DO UPDATE SET value=MAX(0,CAST(app_meta.value AS INTEGER))+1
          WHERE MAX(0,CAST(app_meta.value AS INTEGER)) < ?
        RETURNING CAST(value AS INTEGER) AS used`).get(allowance.key, YOUTUBE_COLD_SEARCH_USER_DAILY_LIMIT);
      if (!reserved) {
        throw new ProviderError("YouTube", 429, "Your daily YouTube search allowance is used.", {
          code: "search_actor_budget_exhausted",
          retryable: false,
        });
      }
    });
    localReservation.commit();
  } catch (error) {
    localReservation.rollback();
    throw error;
  }
}

function analyticsEventsRoute(ctx, { requireIds = false } = {}) {
  limit(ctx, "events-batch", 90, 10 * 60 * 1000);
  const events = Array.isArray(ctx.body?.events) ? ctx.body.events.slice(0, 40) : [];
  const volumeActor = ctx.user?.id ? `user:${ctx.user.id}` : `ip:${ctx.ip}`;
  // Limit event volume as well as HTTP calls; otherwise one client could turn 90
  // legal batches into thousands of synchronous SQLite writes per window.
  for (let index = 0; index < events.length; index++) {
    if (!rateLimit(`analytics-volume:${volumeActor}`, 200, 10 * 60 * 1000)) {
      throw new ApiError(429, "Analytics is catching up. The app will retry shortly.", "RATE_LIMITED");
    }
  }
  return ingestAnalyticsBatch({ user: ctx.user, events, requireIds, at: now() });
}

function atomicWrite(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function artistIdentityMatches(user, key) {
  return user?.role === "artist" && normName(user.artist_name) === normName(key);
}

function matchingArtistAccountIds(key) {
  return db.prepare("SELECT id,artist_name FROM users WHERE role='artist'").all()
    .filter((row) => normName(row.artist_name) === normName(key))
    .map((row) => row.id);
}

function assertArtistManagementCandidate(user, key) {
  if (user?.role === "admin") return;
  if (!artistIdentityMatches(user, key)) throw new ApiError(403, "Not your page.", "FORBIDDEN");
  const ownerId = db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(key)?.owner_id;
  if (ownerId && ownerId !== user.id) throw new ApiError(403, "Not your page.", "FORBIDDEN");
}

// Page ownership is a durable database binding, not a display-name comparison.
// A name match is used only to claim an unowned legacy row, and only when that
// identity is unambiguous. Existing duplicate legacy accounts therefore fail
// closed until an administrator assigns the row deliberately.
function claimArtistManagement(user, key) {
  const existing = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
  if (user?.role === "admin") return existing || null;
  assertArtistManagementCandidate(user, key);
  if (existing?.owner_id) {
    if (existing.owner_id !== user.id) throw new ApiError(403, "Not your page.", "FORBIDDEN");
    return existing;
  }
  const candidates = matchingArtistAccountIds(key);
  if (candidates.length !== 1 || candidates[0] !== user.id) {
    throw new ApiError(409, "This legacy artist page needs an administrator to confirm its owner.", "CONFLICT");
  }
  if (existing) {
    const claimed = db.prepare("UPDATE artist_profiles SET owner_id=?,updated_at=? WHERE artist_key=? AND owner_id IS NULL")
      .run(user.id, now(), key).changes === 1;
    if (!claimed && db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(key)?.owner_id !== user.id) {
      throw new ApiError(409, "This artist page changed while it was being claimed.", "CONFLICT");
    }
  } else {
    db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,updated_at) VALUES (?,?,?)").run(key, user.id, now());
  }
  return db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
}

function canManageArtistProfile(user, key, profile) {
  if (!user || !accountIsPublic(user)) return false;
  if (user.role === "admin") return true;
  return artistIdentityMatches(user, key) && profile?.owner_id === user.id;
}

const TOUR_DATE_BATCH_LIMIT = 50;
const TOUR_DATE_PLACE_LIMIT = 180;
const TOUR_DATE_RELEASE_HORIZON_MS = 3 * 366 * 24 * 60 * 60 * 1000;

function tourDateJson(row) {
  let billedArtists = [];
  if (row.music_evidence) {
    try {
      const parsed = JSON.parse(row.billed_artists || "[]");
      if (Array.isArray(parsed)) billedArtists = parsed.slice(0, 20)
        .filter((name) => typeof name === "string" && name.trim());
    } catch { /* architecture: allow-empty-catch -- malformed provider evidence stays out of the public projection */ }
  }
  return {
    id: row.id,
    artist: row.artist,
    venue: row.venue,
    place: row.place,
    lat: row.lat,
    lng: row.lng,
    date: row.date,
    ticketUrl: projectedTourDateTicketUrl(row),
    soldOut: !!row.sold_out,
    source: row.source || null,
    releaseAt: Number(row.release_at) || 0,
    createdBy: row.owner_id || "import",
    ...(row.music_evidence ? {
      eventName: row.event_name || null,
      eventKind: row.event_kind || "concert",
      eventEndDate: row.event_end_date || null,
      billedArtists,
    } : {}),
  };
}

function cleanTourTicketUrl(value) {
  if (value == null || value === "") return "";
  const canonical = canonicalTicketUrl(value, { allowUntrusted: true });
  if (!canonical) throw new ApiError(400, "Ticket URLs must be safe public HTTPS links without credentials or ports.", "VALIDATION_FAILED");
  return canonical;
}

function cleanTourDateBatch(ctx, user) {
  if (user.role !== "artist" && user.role !== "admin") {
    throw new ApiError(403, "Approved artists or admins only.", "FORBIDDEN");
  }
  const input = ctx.body?.dates;
  if (!Array.isArray(input) || !input.length || input.length > TOUR_DATE_BATCH_LIMIT) {
    throw new ApiError(400, `Submit between 1 and ${TOUR_DATE_BATCH_LIMIT} tour dates.`, "VALIDATION_FAILED");
  }
  const requestedArtist = clean(ctx.body?.artist, { max: LIMITS.artist });
  const ownedArtist = clean(user.artist_name, { max: LIMITS.artist });
  const artist = user.role === "artist" ? ownedArtist : requestedArtist;
  if (user.role === "admin" && (typeof ctx.body?.artist !== "string" || [...ctx.body.artist].length > LIMITS.artist)) {
    throw new ApiError(400, "Choose a valid artist.", "VALIDATION_FAILED");
  }
  if (!artist || !/\p{L}|\p{N}/u.test(artist)) {
    throw new ApiError(400, "Choose a valid artist.", "VALIDATION_FAILED");
  }
  if (user.role === "artist" && requestedArtist && normName(requestedArtist) !== normName(ownedArtist)) {
    throw new ApiError(403, "Artist accounts can only publish their own tour dates.", "FORBIDDEN");
  }
  assertSafeAuthoredText(artist, { field: "artist name" });

  const dates = input.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApiError(400, `Tour date ${index + 1} is invalid.`, "VALIDATION_FAILED");
    }
    if (typeof entry.venue !== "string" || typeof entry.place !== "string"
      || [...entry.venue].length > LIMITS.venue || [...entry.place].length > TOUR_DATE_PLACE_LIMIT) {
      throw new ApiError(400, `Tour date ${index + 1} has an invalid venue or place.`, "VALIDATION_FAILED");
    }
    const venue = clean(entry.venue, { max: LIMITS.venue });
    const place = clean(entry.place, { max: TOUR_DATE_PLACE_LIMIT });
    const date = cleanDate(entry.date);
    const ticketUrl = cleanTourTicketUrl(entry.ticketUrl);
    if (!venue || !place || !date || !/\p{L}|\p{N}/u.test(venue) || !/\p{L}|\p{N}/u.test(place)) {
      throw new ApiError(400, `Tour date ${index + 1} needs a valid venue, place, and date.`, "VALIDATION_FAILED");
    }
    assertSafeAuthoredFields({ venue, place });
    return { venue, place, date, ticketUrl };
  });
  const naturalKeys = new Set();
  for (const entry of dates) {
    const key = `${normName(artist)}|${normName(entry.venue)}|${normName(entry.place)}|${entry.date}`;
    if (naturalKeys.has(key)) throw new ApiError(400, "The batch contains the same show twice.", "VALIDATION_FAILED");
    naturalKeys.add(key);
  }

  let releaseAt = 0;
  if (ctx.body?.releaseAt != null && ctx.body.releaseAt !== "") {
    const candidate = Number(ctx.body.releaseAt);
    if (!Number.isSafeInteger(candidate) || candidate < 0) {
      throw new ApiError(400, "Choose a valid release date.", "VALIDATION_FAILED");
    }
    if (candidate !== 0 && candidate <= now()) {
      throw new ApiError(400, "Scheduled releases must be in the future.", "VALIDATION_FAILED");
    }
    if (candidate > 0) releaseAt = candidate;
  }
  const firstShowAt = Math.min(...dates.map((entry) => Date.parse(`${entry.date}T23:59:59.999Z`)));
  if (releaseAt && (releaseAt > now() + TOUR_DATE_RELEASE_HORIZON_MS || releaseAt > firstShowAt)) {
    throw new ApiError(400, "Release the dates before the first show and within three years.", "VALIDATION_FAILED");
  }
  return { artist, dates, releaseAt };
}

// Ensure a unique handle derived from a public-safe base string.
function uniqueHandle(base) {
  let h = cleanHandle(base) || "fan";
  if (h.length < 3) h = (h + "fan").slice(0, 20);
  let candidate = h, i = 1;
  while (q.userByHandle.get(candidate)) candidate = (h.slice(0, 17) + i++).slice(0, 20);
  return candidate;
}

function handleAvailableTo(handle, userId) {
  const owner = q.userByHandle.get(handle);
  return !owner || owner.id === userId;
}

// Allocate staff handles against the complete directory while the caller holds
// the write lock. Keeping the role marker before the numeric suffix avoids the
// old client-side truncation edge where a collision could cut `_mod`/`_admin`
// off a 20-character handle. Excluding the target also makes a lost-response
// retry resolve to the same handle selected by the first request.
function uniqueTaggedHandle(base, role, userId) {
  const tag = role === "admin" ? "admin" : "mod";
  const marker = `_${tag}`;
  let preferred = cleanHandle(base) || "user";
  if (!handleAllowedForRole(preferred, role)) {
    preferred = `${preferred.slice(0, 20 - marker.length)}${marker}`;
  }
  if (handleAvailableTo(preferred, userId)) return preferred;

  const trailingMarker = new RegExp(`_${tag}\\d*$`);
  const stem = preferred.replace(trailingMarker, "").replace(/_+$/, "") || "user";
  for (let i = 1; ; i += 1) {
    const suffix = `${marker}${i}`;
    const candidate = `${stem.slice(0, Math.max(1, 20 - suffix.length))}${suffix}`;
    if (handleAvailableTo(candidate, userId)) return candidate;
  }
}

const POST_RATING_DIM_KEYS = ["performance", "setlist", "sound", "venue", "crowd", "experience"];
function cleanPostRatingDims(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out = {};
  for (const key of POST_RATING_DIM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const numeric = Number(value[key]);
    if (!Number.isFinite(numeric)) return undefined;
    out[key] = clampRating(numeric);
  }
  return out;
}

const postRow = db.prepare(`INSERT INTO posts (id,user_id,artist,venue,city,date,overall,band,room,dims,review,photos,photos_public,landing_showcase,campaign,setlist,tour,tags,tagged_user_ids,kind,song,playlist,artist_key,artist_mbid,venue_key,client_mutation_id,client_mutation_hash,created_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const postByClientMutation = db.prepare("SELECT id,removed,client_mutation_hash FROM posts WHERE user_id=? AND client_mutation_id=? LIMIT 1");

function clientMutationId(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "That post retry token is invalid.", "VALIDATION_FAILED");
  const id = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(id)) throw new ApiError(400, "That post retry token is invalid.", "VALIDATION_FAILED");
  return id;
}

function chatClientMutationId(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(400, "That message retry token is invalid.", "VALIDATION_FAILED");
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) {
    throw new ApiError(400, "That message retry token is invalid.", "VALIDATION_FAILED");
  }
  return id;
}

function assertChatRetryMatches(existing, fields) {
  if (!existing) return;
  const samePayload = Object.entries(fields).every(([key, value]) => existing[key] === value);
  if (!samePayload) {
    throw new ApiError(409, "That retry token belongs to a different message.", "CONFLICT");
  }
  if (existing.removed) {
    throw new ApiError(409, "That message was already removed. Send a new message instead.", "CONFLICT");
  }
}

function stableMutationValue(value) {
  if (Array.isArray(value)) return value.map(stableMutationValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableMutationValue(value[key])]));
  }
  return value;
}

function postMutationHash(canonicalPost) {
  return createHash("sha256").update(JSON.stringify(stableMutationValue(canonicalPost))).digest("hex");
}

// A review binds to a catalog entity, not to whatever the user typed. The client
// sends the key it picked from the suggestion list; the server only accepts it
// when it resolves to a real artist AND still matches the submitted name, so a
// stale or forged key cannot silently attach a review to the wrong act. Free
// text stays allowed, it just does not earn an entity binding.
function resolveArtistBinding(name, claimedKey) {
  // Current clients explicitly send null when someone typed a name without
  // choosing a suggestion. Preserve name fallback only for legacy callers that
  // omit the field entirely; explicit null must stay unbound.
  if (claimedKey === null) return { artist_key: null, artist_mbid: null };
  const key = normName(clean(claimedKey, { max: 120 }) || (claimedKey === undefined ? name : ""));
  if (!key) return { artist_key: null, artist_mbid: null };
  const row = artistStmts.byNorm.get(key);
  if (!row || normName(row.name) !== normName(name)) return { artist_key: null, artist_mbid: null };
  return { artist_key: row.norm, artist_mbid: row.mbid || null };
}

// Venues live in the bundled catalog rather than a table, so the normalized name
// is the stable key. Recording it means a same-named room in another city is a
// different venue the moment the catalog can tell them apart.
const venueBinding = (name) => normName(clean(name, { max: LIMITS.venue })) || null;

// A tagged YouTube video on a post. Only the canonical video id is authoritative.
// Build the thumbnail URL ourselves so a post cannot persist an arbitrary remote
// image URL while still preserving the provider-supplied title/channel metadata.
function cleanSong(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const videoId = parseYouTubeVideoId(value.videoId || value.url || "");
  if (!videoId) return undefined;
  const str = (v, max) => { const s = clean(String(v ?? ""), { max }); return s || null; };
  const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: str(value.title, 200), artist: str(value.artist, 120), thumb };
}

const PLAYLIST_VISIBILITIES = new Set(["public", "unlisted", "private"]);
function cleanPlaylistVisibility(value, fallback = "public") {
  const visibility = clean(value, { max: 20 });
  return PLAYLIST_VISIBILITIES.has(visibility) ? visibility : fallback;
}
function cleanPlaylistTracks(value, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) return undefined;
  if (value.length > 100) return undefined;
  const tracks = [];
  const seen = new Set();
  for (const raw of value.slice(0, 100)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const title = clean(raw.title, { max: 200 });
    if (!title) continue;
    const artist = clean(raw.artist, { max: 120 }) || null;
    const suppliedUrl = clean(raw.url, { max: 400 }) || null;
    // Fall back to the link so a track that only carries a watch URL still
    // records its exact video id. A playlist snapshot is supposed to replay the
    // same recording later, and a bare URL is weaker evidence than the id.
    const videoId = parseYouTubeVideoId(raw.videoId || "") || parseYouTubeVideoId(suppliedUrl || "") || null;
    const source = cleanPlaybackSource(raw.provider, raw.sourceId ?? raw.id);
    const provider = source.provider || (videoId ? "youtube" : null);
    const sourceId = source.sourceId || (provider === "youtube" ? videoId : null);
    const url = cleanTrackPlaybackUrl({ videoId, provider, sourceId });
    const art = cleanTrackArtwork(raw.art, { videoId, provider });
    const durationValue = Number(raw.duration);
    const duration = Number.isFinite(durationValue) && durationValue > 0 ? Math.min(Math.round(durationValue), 86_400) : null;
    const identity = videoId
      ? `youtube:${videoId}`
      : sourceId
        ? `source:${provider || "unknown"}:${sourceId.toLowerCase()}`
        : url
          ? `url:${url.toLowerCase()}`
          : `text:${(artist || "").toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    tracks.push({ title, artist, url, videoId, provider, sourceId, art, duration });
  }
  if (!allowEmpty && !tracks.length) return undefined;
  return tracks;
}

function cleanPlaybackSource(providerValue, sourceIdValue) {
  const provider = String(clean(providerValue, { max: 24 }) || "").toLowerCase();
  const sourceId = clean(String(sourceIdValue ?? ""), { max: 64 }) || "";
  if (provider === "deezer" && /^\d{1,20}$/.test(sourceId)) return { provider, sourceId };
  if (provider === "spotify" && /^[A-Za-z0-9]{1,64}$/.test(sourceId)) return { provider, sourceId };
  if (provider === "youtube") {
    const videoId = parseYouTubeVideoId(sourceId);
    if (videoId) return { provider, sourceId: videoId };
  }
  return { provider: null, sourceId: null };
}

function roleChangeTouchesHead(currentRole, nextRole) {
  return [currentRole, nextRole].some((role) => role === "admin" || role === "moderator");
}

function selectedRoleHandle(target, role, requestedHandle = null) {
  const handle = requestedHandle ? cleanHandle(requestedHandle) : null;
  if (handle && !handleAllowedForRole(handle, role)) {
    throw new ApiError(400, `A ${role} username must include ${role === "admin" ? "admin" : "mod"}.`, "VALIDATION_FAILED");
  }
  if (role === "admin" || role === "moderator") {
    return uniqueTaggedHandle(handle || target.handle, role, target.id);
  }
  const selected = handle || target.handle;
  if (handle && !handleAvailableTo(handle, target.id)) {
    throw new ApiError(409, "That username is already taken.", "CONFLICT");
  }
  return selected;
}

function applyRoleChange(ctx, target, role, requestedHandle, { reason = "", requestedBy = null } = {}) {
  if (isOwnerId(db, target.id)) throw new ApiError(403, "The Owner role cannot be changed.", "FORBIDDEN");
  const selectedHandle = selectedRoleHandle(target, role, requestedHandle);
  if (target.role === role && target.handle === selectedHandle) return { changed: false, role, handle: selectedHandle };
  const changed = db.prepare(`UPDATE users SET role=?,handle=?
    WHERE id=? AND role=? AND handle=?`).run(role, selectedHandle, target.id, target.role, target.handle).changes === 1;
  if (!changed) throw new ApiError(409, "That member changed while the role was being reviewed. Start a new approval.", "CONFLICT");
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(target.id);
  moderationRecord(ctx, "change_role", "user", target.id, reason,
    { role: target.role, handle: target.handle },
    { role, handle: selectedHandle, ...(requestedBy ? { requestedBy } : {}) });
  return { changed: true, role, handle: selectedHandle };
}

function cleanTrackPlaybackUrl({ videoId = null, provider = null, sourceId = null } = {}) {
  if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
  if (provider === "deezer" && /^\d{1,20}$/u.test(String(sourceId || ""))) {
    return `https://www.deezer.com/track/${sourceId}`;
  }
  if (provider === "spotify" && /^[A-Za-z0-9]{1,64}$/u.test(String(sourceId || ""))) {
    return `https://open.spotify.com/track/${sourceId}`;
  }
  return null;
}

function cleanTrackArtwork(value, { videoId = null, provider = null } = {}) {
  // YouTube artwork is deterministic: never trust a caller's alternate host.
  if (videoId) return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  if (typeof value !== "string" || value.length > 500) return null;
  let url;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const trusted = provider === "deezer"
    ? host === "dzcdn.net" || host.endsWith(".dzcdn.net")
    : provider === "spotify"
      ? host === "i.scdn.co" || host === "mosaic.scdn.co"
      : false;
  if (!trusted) return null;
  // Provider query strings are not needed to identify cover art and can carry
  // per-view identifiers. Persist only the provider-owned path.
  url.search = "";
  url.hash = "";
  return url.toString();
}

function cleanTrackRecordingSource(providerValue, sourceIdValue, { strict = false } = {}) {
  const provider = String(clean(providerValue, { max: 24 }) || "").toLowerCase();
  const sourceId = clean(String(sourceIdValue ?? ""), { max: 64 }) || "";
  const supplied = !!provider || !!sourceId;
  if (!supplied) return null;
  const key = trackSourceOverrideKey(provider, sourceId);
  if (key) return { provider, sourceId, key };
  if (strict) {
    throw new ApiError(400, "That provider recording identity is invalid.", "VALIDATION_FAILED");
  }
  return null;
}
function assertSafePlaylistContent(name, tracks) {
  assertSafeAuthoredFields({
    "playlist name": name,
    "track title": (tracks || []).map((track) => track.title),
    "track artist": (tracks || []).map((track) => track.artist).filter(Boolean),
  });
}
function playlistProjection(row) {
  if (!row) return null;
  let stored = [];
  try { stored = JSON.parse(row.tracks || "[]"); } catch {}
  const tracks = cleanPlaylistTracks(stored) || [];
  return {
    id: row.id,
    ownerId: row.user_id,
    owner: row.u_name ? { id: row.user_id, name: row.u_name, handle: row.u_handle } : undefined,
    name: row.name,
    tracks,
    visibility: cleanPlaylistVisibility(row.visibility),
    at: row.created_at,
    updatedAt: row.updated_at || null,
  };
}
const ownedPlaylistForPost = db.prepare(`SELECT p.*, u.name AS u_name, u.handle AS u_handle
  FROM playlists p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.user_id=?`);
function playlistSnapshotForPost(user, playlistId, currentSnapshot = null) {
  if (playlistId == null || playlistId === "") return null;
  if (typeof playlistId !== "string" || playlistId.length > 100) throw new ApiError(400, "That playlist could not be attached.", "VALIDATION_FAILED");
  // An old post keeps its immutable snapshot even if its source playlist was
  // later edited or deleted. Re-saving unrelated text must not rewrite the songs.
  if (currentSnapshot?.id === playlistId) return currentSnapshot;
  const row = ownedPlaylistForPost.get(playlistId, user.id);
  if (!row) throw new ApiError(404, "That playlist left the set. Refresh and choose another.", "NOT_FOUND");
  const playlist = playlistProjection(row);
  assertSafePlaylistContent(playlist.name, playlist.tracks);
  if (playlist.visibility === "private") throw new ApiError(400, "Make this playlist public or unlisted before sharing it.", "VALIDATION_FAILED");
  if (!playlist.tracks.length) throw new ApiError(400, "Add at least one song before sharing this playlist.", "VALIDATION_FAILED");
  return {
    id: playlist.id,
    name: playlist.name,
    tracks: playlist.tracks,
    owner: playlist.owner,
    publishedAt: now(),
  };
}
function playlistPostProjection(value) {
  if (!value) return null;
  let playlist = value;
  if (typeof value === "string") {
    try { playlist = JSON.parse(value); } catch { return null; }
  }
  if (!playlist || typeof playlist !== "object" || Array.isArray(playlist)) return null;
  const tracks = cleanPlaylistTracks(Array.isArray(playlist.tracks) ? playlist.tracks : []) || [];
  return {
    id: playlist.id,
    name: playlist.name,
    owner: playlist.owner,
    trackCount: tracks.length,
    duration: tracks.reduce((total, track) => total + (track.duration || 0), 0) || null,
    tracks: tracks.slice(0, 4),
    publishedAt: playlist.publishedAt || null,
  };
}
// How many times the author has logged this artist up to and including this
// post: powers the "3rd time in the pit" marker on the card.
const SEEN_ORDINAL_SQL = `(SELECT COUNT(*) FROM posts s
    WHERE s.user_id = p.user_id AND LOWER(s.artist) = LOWER(p.artist) AND s.removed = 0
      AND (s.created_at < p.created_at OR (s.created_at = p.created_at AND s.id <= p.id))) AS seen_ordinal`;
const feedPostById = db.prepare(`
  SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
    u.role AS u_role,u.artist_name AS u_artist_name,
    (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id WHERE l.post_id=p.id AND ${activeAccountSql("lu")}) AS like_count,
    (SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.user_id
      WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("cu")}) AS comment_count,
    ${SEEN_ORDINAL_SQL}
  FROM posts p JOIN users u ON u.id = p.user_id
  WHERE p.id = ? AND ${activeAccountSql("u")}`);
// Short word-art descriptors on a review ("RAW", "wall of sound"). Word-ish
// only, capped hard, so they can't become a second review or a slur vector for
// markup injection.
function cleanPostTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const raw of value.slice(0, 12)) {
    const tag = clean(String(raw ?? ""), { max: 24 }).replace(/[^\p{L}\p{N} '&.!-]/gu, "").replace(/\s+/g, " ").trim();
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
    if (out.length >= 5) break;
  }
  return out;
}

function privateSignupHandle() {
  // An email local-part is private identity data, not a public username. Use a
  // neutral random base and let the user choose a meaningful handle later.
  return uniqueHandle(`pitfan_${randomBytes(4).toString("hex")}`);
}

function storedPostTaggedUserIds(value) {
  const ids = normalizeTaggedUserIds(parseJsonArray(value));
  return ids || [];
}

const structuredTagsForRecipient = db.prepare(`SELECT p.id,p.tagged_user_ids,p.created_at,p.updated_at,t.user_id AS removed_user_id
  FROM post_user_tags t JOIN posts p ON p.id=t.post_id
  WHERE t.user_id=?`);
const structuredTagsByAuthorAndRecipient = db.prepare(`SELECT p.id,p.tagged_user_ids,p.created_at,p.updated_at,t.user_id AS removed_user_id
  FROM post_user_tags t JOIN posts p ON p.id=t.post_id
  WHERE t.author_id=? AND t.user_id=?`);
const deleteStructuredPostTag = db.prepare("DELETE FROM post_user_tags WHERE post_id=? AND user_id=?");
const replaceStructuredPostTags = db.prepare("UPDATE posts SET tagged_user_ids=?,updated_at=? WHERE id=?");

function scrubStructuredPostTagRows(rows) {
  const seen = new Set();
  for (const post of rows) {
    const pair = `${post.id}\u0000${post.removed_user_id}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const current = storedPostTaggedUserIds(post.tagged_user_ids);
    const next = current.filter((id) => id !== post.removed_user_id);
    if (next.length !== current.length) {
      const currentVersion = post.updated_at || post.created_at;
      replaceStructuredPostTags.run(
        JSON.stringify(next),
        Math.max(now(), currentVersion + 1),
        post.id,
      );
    }
    // The trigger above normally performs this delete while synchronizing the
    // complete JSON list. Keep the targeted delete as a fail-closed repair for
    // an old malformed JSON row that could not be projected safely.
    deleteStructuredPostTag.run(post.id, post.removed_user_id);
  }
}

function scrubTaggedUserFromPosts(userId) {
  scrubStructuredPostTagRows(structuredTagsForRecipient.all(userId));
}
function scrubPostTagsBetweenUsers(leftId, rightId) {
  scrubStructuredPostTagRows([
    ...structuredTagsByAuthorAndRecipient.all(leftId, rightId),
    ...structuredTagsByAuthorAndRecipient.all(rightId, leftId),
  ]);
}

// Existing committed ids may be preserved after a later block/suspension so an
// exact lost-response retry stays idempotent. Every newly added id must resolve
// to an active account with no two-way block, and authors cannot tag themselves.
const rejectedPostTag = db.prepare("SELECT 1 FROM post_tag_rejections WHERE post_id=? AND user_id=?");
const mutualFollowForPostTag = db.prepare(`SELECT 1
  WHERE EXISTS (SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?)
    AND EXISTS (SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?)`);
const existingPostTagNotification = db.prepare(`SELECT 1 FROM notifications
  WHERE actor_id=? AND user_id=? AND post_id=? AND type='post_tag'`);
const recentPostTagNotificationCount = db.prepare(`SELECT COUNT(*) AS count FROM notifications
  WHERE actor_id=? AND user_id=? AND type='post_tag' AND created_at>=?`);
const POST_TAG_RECIPIENT_DAILY_LIMIT = 3;
const POST_TAG_RECIPIENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function mutuallyFollowing(leftId, rightId) {
  if (!leftId || !rightId || leftId === rightId) return false;
  return !!mutualFollowForPostTag.get(leftId, rightId, rightId, leftId);
}

function validatedPostTaggedUserIds(user, value, { committedIds = [], postId = null } = {}) {
  const ids = normalizeTaggedUserIds(value);
  if (!ids) throw new ApiError(400, "Those tagged people are invalid. Refresh the people search and try again.", "VALIDATION_FAILED");
  const committed = new Set(normalizeTaggedUserIds(committedIds) || []);
  for (const id of ids) {
    if (committed.has(id)) continue;
    if (id === user?.id || !publicAccountOrNull(id) || blockedEitherWay(user?.id, id) || !mutuallyFollowing(user?.id, id)
      || (postId && rejectedPostTag.get(postId, id))) {
      throw new ApiError(400, "One tagged person is no longer available. Refresh the people search and try again.", "VALIDATION_FAILED");
    }
  }
  return ids;
}

// A mutual follow is consent to be discoverable in the composer, not permission
// to repeatedly ping someone. Count durable, unique post-tag notifications so a
// retry of the same post remains free while a fourth distinct post in 24h stops.
function assertPostTagRecipientBudget(actorId, recipientIds, { postId = null } = {}) {
  const cutoff = now() - POST_TAG_RECIPIENT_WINDOW_MS;
  for (const recipientId of normalizeTaggedUserIds(recipientIds) || []) {
    if (postId && existingPostTagNotification.get(actorId, recipientId, postId)) continue;
    const count = Number(recentPostTagNotificationCount.get(actorId, recipientId, cutoff)?.count) || 0;
    if (count >= POST_TAG_RECIPIENT_DAILY_LIMIT) {
      throw new ApiError(429, "You've tagged this friend in several recent posts. Try again tomorrow.", "RATE_LIMITED");
    }
  }
}

const TAGGED_PEOPLE_PROJECTION = Symbol("taggedPeopleProjection");
const TAGGED_PEOPLE_POST_BATCH = 300;

function withTaggedPeople(posts, viewerId = null) {
  if (!Array.isArray(posts) || !posts.length) return posts || [];
  const postIds = [...new Set(posts.map((post) => post?.id).filter(Boolean))];
  const byPost = new Map(postIds.map((id) => [id, []]));
  for (let offset = 0; offset < postIds.length; offset += TAGGED_PEOPLE_POST_BATCH) {
    const batch = postIds.slice(offset, offset + TAGGED_PEOPLE_POST_BATCH);
    const placeholders = batch.map(() => "?").join(",");
    const rows = db.prepare(`SELECT t.post_id AS tag_post_id,t.position AS tag_position,u.*
      FROM post_user_tags t JOIN users u ON u.id=t.user_id
      WHERE t.post_id IN (${placeholders})
        AND ${activeAccountSql("u")}
        AND NOT EXISTS (SELECT 1 FROM blocks author_block WHERE
          (author_block.blocker_id=t.author_id AND author_block.blocked_id=t.user_id) OR
          (author_block.blocker_id=t.user_id AND author_block.blocked_id=t.author_id))
        AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM blocks viewer_block WHERE
          (viewer_block.blocker_id=? AND viewer_block.blocked_id=t.user_id) OR
          (viewer_block.blocker_id=t.user_id AND viewer_block.blocked_id=?)))
      ORDER BY t.post_id,t.position`).all(...batch, viewerId, viewerId, viewerId);
    for (const row of rows) {
      const person = publicUser(row);
      byPost.get(row.tag_post_id)?.push({
        id: person.id,
        name: person.name,
        handle: person.handle,
        initials: person.initials,
        avatarUri: person.avatarUri,
        avatarColor: person.avatarColor,
        role: person.role,
        verified: person.verified,
      });
    }
  }
  return posts.map((post) => ({
    ...post,
    [TAGGED_PEOPLE_PROJECTION]: byPost.get(post.id) || [],
  }));
}

function projectedPostTaggedPeople(post, viewerId) {
  if (Array.isArray(post?.[TAGGED_PEOPLE_PROJECTION])) return post[TAGGED_PEOPLE_PROJECTION];
  return withTaggedPeople([post], viewerId)[0]?.[TAGGED_PEOPLE_PROJECTION] || [];
}

// Idempotency compares the canonical user-authored post, not the incidental JSON
// spelling a particular client version used. Server enrichment that can evolve
// independently (notably an artist's MBID) is deliberately excluded: changing a
// catalog identifier after the write must not make an identical retry conflict.
// Harmless normalization changes (`false` vs `0`, display date vs ISO, numeric
// strings vs numbers, trimmed text) are likewise stable, while a real authored
// content change still conflicts.
function requestedPostMediaSelection(user, source, storedPost = null) {
  const assetIds = cleanMediaAssetIds(source?.mediaAssetIds);
  if (assetIds === null) return null;
  const selection = mediaSelection(db, {
    ownerId: user.id,
    assetIds,
    currentPostId: storedPost?.id || null,
  });
  if (Object.prototype.hasOwnProperty.call(source || {}, "photos")) {
    const supplied = cleanStringArray(source.photos, { maxItems: MEDIA_POST_MAX_ATTACHMENTS, maxLen: 2000 });
    assertPhotosMatchSelection(supplied, selection);
  }
  return selection;
}

function isLegacyVideoUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  try {
    // Match the same full-URI boundary used by feed/Clips display. Looking only
    // at pathname lets `?format=.mp4` publish as a legacy image server-side and
    // then mount as a video client-side without a durable poster.
    new URL(value);
    return /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(value);
  } catch {
    return false;
  }
}

function rejectNewLegacyMediaUrls(nextPhotos, previousPhotos = []) {
  const retained = new Set(Array.isArray(previousPhotos) ? previousPhotos : []);
  if ((Array.isArray(nextPhotos) ? nextPhotos : []).some((url) => !retained.has(url))) {
    throw new ApiError(400, "New post media must finish PIT's verified media upload and rendition flow before publishing.", "VALIDATION_FAILED");
  }
}

function artistCampaignMediaRows(selectionOrRows) {
  const source = Array.isArray(selectionOrRows)
    ? selectionOrRows
    : Array.isArray(selectionOrRows?.rows) ? selectionOrRows.rows : [];
  return source.map((entry) => entry?.row || entry).filter(Boolean);
}

function currentPostCampaignMediaRows(postId, ownerId) {
  return db.prepare(`SELECT a.id,a.kind FROM post_media pm
    JOIN media_assets a ON a.id=pm.asset_id
    WHERE pm.post_id=? AND a.owner_id=? ORDER BY pm.position`).all(postId, ownerId);
}

// Campaign styling is a server-granted capability, not a client-side badge.
// Only the approved artist identity may create/change it, and a background must
// be one of this same post's verified image assets. No URLs, CSS, colors, or
// other presentation primitives cross this boundary.
function sameArtistCampaignIntent(left, right) {
  const a = normalizeArtistCampaign(left);
  const b = normalizeArtistCampaign(right);
  return !!a && !!b
    && a.treatment === b.treatment
    && (a.backgroundAssetId || null) === (b.backgroundAssetId || null);
}

function cleanArtistCampaign(value, {
  user,
  mediaRows = [],
  committedCampaign = null,
  allowCommittedReplay = false,
} = {}) {
  if (value == null) return null; // lets a demoted artist remove old styling
  const campaign = normalizeArtistCampaign(value);
  if (!campaign) throw new ApiError(400, "That artist drop style is invalid.", "VALIDATION_FAILED");
  const committed = normalizeArtistCampaign(committedCampaign);
  const currentArtistName = user?.role === "artist"
    ? clean(user?.artist_name, { max: LIMITS.artist })
    : "";
  const currentArtistKey = currentArtistName ? normName(currentArtistName) : null;
  // Exact create retries compare against the durable row and remain idempotent
  // even after revocation, but projection still fails closed. PATCH is a new
  // authorship decision: a revoked or renamed identity cannot explicitly carry
  // old official styling into rewritten copy.
  if (allowCommittedReplay && committed && sameArtistCampaignIntent(campaign, committed)) return committed;
  if (!currentArtistKey) {
    throw new ApiError(403, "Only an approved artist account can publish an artist drop.", "FORBIDDEN");
  }
  if (committed?.artistKey && normName(committed.artistKey) !== currentArtistKey) {
    throw new ApiError(403, "That artist drop belongs to an identity this account no longer manages.", "FORBIDDEN");
  }
  if (campaign.backgroundAssetId) {
    const background = artistCampaignMediaRows(mediaRows)
      .find((row) => row.id === campaign.backgroundAssetId);
    if (!background || background.kind !== "image") {
      throw new ApiError(400, "Choose an attached, finished image as the artist drop background.", "VALIDATION_FAILED");
    }
  }
  return {
    version: 1,
    treatment: campaign.treatment,
    artistKey: currentArtistKey,
    ...(campaign.backgroundAssetId ? { backgroundAssetId: campaign.backgroundAssetId } : {}),
  };
}

function canonicalCreateRequest(user, body, storedPost = null) {
  const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const stableMedia = requestedPostMediaSelection(user, source, storedPost);
  const taggedUserIds = validatedPostTaggedUserIds(user, source.taggedUserIds, {
    committedIds: storedPostTaggedUserIds(storedPost?.tagged_user_ids),
    postId: storedPost?.id || null,
  });
  if (source.kind === "status") {
    const [errs, v] = shape(source, {
      review: { parse: (x) => clean(x, { max: LIMITS.review, newlines: true }) },
      photos: { parse: (x) => cleanStringArray(x, { maxItems: MEDIA_POST_MAX_ATTACHMENTS, maxLen: 2000 }) },
      photosPublic: { parse: (x) => typeof x === "boolean" ? (x ? 1 : 0) : x === 0 || x === 1 ? x : undefined },
      song: { parse: cleanSong },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const playlist = playlistSnapshotForPost(user, source.playlistId, parsedStoredObject(storedPost?.playlist));
    if (!stableMedia) rejectNewLegacyMediaUrls(v.photos || [], parseJsonArray(storedPost?.photos));
    const campaign = cleanArtistCampaign(source.campaign, {
      user,
      mediaRows: stableMedia,
      committedCampaign: parsedStoredObject(storedPost?.campaign),
      allowCommittedReplay: !!storedPost,
    });
    const values = {
      review: v.review || "",
      photos: stableMedia ? stableMedia.photos : (v.photos || []),
      photosPublic: v.photosPublic ?? 1,
      landingShowcase: 0,
      song: v.song || null,
      playlist,
      campaign,
      taggedUserIds,
      mediaSelection: stableMedia,
    };
    assertSafeAuthoredFields({
      post: values.review,
      "tagged song title": values.song?.title,
      "tagged song artist": values.song?.artist,
    });
    if (!values.review && !values.photos.length && !values.song && !playlist) {
      throw new ApiError(400, "Write something, add media, tag a song, or share a playlist to post.", "VALIDATION_FAILED");
    }
    return {
      kind: "status",
      values,
      canonical: {
        kind: "status",
        artist: "",
        artistKey: null,
        venue: "",
        venueKey: null,
        city: "",
        date: "",
        overall: 0,
        band: null,
        room: null,
        dims: {},
        review: values.review,
        photos: values.photos,
        mediaAssetIds: stableMedia?.ids || [],
        photosPublic: values.photosPublic,
        landingShowcase: 0,
        setlist: [],
        tour: null,
        tags: [],
        taggedUserIds,
        song: values.song,
        playlistId: playlist?.id || null,
        campaign,
      },
    };
  }

  const [errs, v] = shape(source, {
    artist: { required: true, parse: (x) => clean(x, { max: LIMITS.artist }) || undefined },
    venue: { required: true, parse: (x) => clean(x, { max: LIMITS.venue }) || undefined },
    city: { parse: (x) => clean(x, { max: LIMITS.city }) },
    date: { parse: cleanDate },
    overall: { required: true, parse: (x) => { const r = clampRating(x); return r > 0 ? r : undefined; } },
    band: { parse: (x) => clampRating(x) },
    room: { parse: (x) => clampRating(x) },
    dims: { parse: cleanPostRatingDims },
    review: { parse: (x) => clean(x, { max: LIMITS.review, newlines: true }) },
    photos: { parse: (x) => cleanStringArray(x, { maxItems: MEDIA_POST_MAX_ATTACHMENTS, maxLen: 2000 }) },
    photosPublic: { parse: (x) => typeof x === "boolean" ? (x ? 1 : 0) : x === 0 || x === 1 ? x : undefined },
    landingShowcase: { parse: (x) => typeof x === "boolean" ? (x ? 1 : 0) : x === 0 || x === 1 ? x : undefined },
    setlist: { parse: (x) => cleanStringArray(x, { maxItems: 40, maxLen: 120 }) },
    tour: { parse: (x) => clean(x, { max: 80 }) || null },
    tags: { parse: cleanPostTags },
    song: { parse: cleanSong },
  });
  if (errs.length) throw new ApiError(400, errs[0]);
  const binding = resolveArtistBinding(v.artist, source.artistKey);
  if (!stableMedia) rejectNewLegacyMediaUrls(v.photos || [], parseJsonArray(storedPost?.photos));
  const photos = stableMedia ? stableMedia.photos : (v.photos || []);
  const requestedLandingShowcase = v.photosPublic === 0 ? 0 : (v.landingShowcase ?? 0);
  const landingShowcase = requestedLandingShowcase && hasTrustedLandingImage(photos, {
    authorId: user.id,
    mediaBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL,
  }) ? 1 : 0;
  const values = {
    ...v,
    city: v.city || "",
    date: v.date || "",
    band: v.band ?? null,
    room: v.room ?? null,
    dims: v.dims || {},
    review: v.review || "",
    photos,
    // A direct API caller cannot create an impossible permission state. An
    // explicit private choice wins; otherwise enabling the showcase also makes
    // the photos available on their ordinary public artist surface.
    photosPublic: v.photosPublic === 0 ? 0 : v.landingShowcase ? 1 : (v.photosPublic ?? 0),
    landingShowcase,
    setlist: v.setlist || [],
    tour: v.tour || null,
    tags: v.tags || [],
    taggedUserIds,
    song: v.song || null,
    binding,
    mediaSelection: stableMedia,
  };
  assertSafeAuthoredFields({
    artist: values.artist,
    venue: values.venue,
    city: values.city,
    review: values.review,
    "setlist entry": values.setlist,
    tour: values.tour,
    tag: values.tags,
    "tagged song title": values.song?.title,
    "tagged song artist": values.song?.artist,
  });
  return {
    kind: "review",
    values,
    canonical: {
      kind: "review",
      artist: values.artist,
      artistKey: binding.artist_key || null,
      venue: values.venue,
      venueKey: venueBinding(values.venue),
      city: values.city,
      date: values.date,
      overall: values.overall,
      band: values.band,
      room: values.room,
      dims: values.dims,
      review: values.review,
      photos: values.photos,
      mediaAssetIds: stableMedia?.ids || [],
      photosPublic: values.photosPublic,
      landingShowcase: values.landingShowcase,
      setlist: values.setlist,
      tour: values.tour,
      tags: values.tags,
      taggedUserIds,
      song: values.song,
      playlistId: null,
      campaign: null,
    },
  };
}

function parsedStoredObject(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

function canonicalStoredPost(row) {
  const kind = row?.kind === "status" ? "status" : "review";
  const song = cleanSong(parsedStoredObject(row?.song));
  const playlist = parsedStoredObject(row?.playlist);
  const campaign = kind === "status" ? normalizeArtistCampaign(parsedStoredObject(row?.campaign)) : null;
  const dims = cleanPostRatingDims(parsedStoredObject(row?.dims) || {}) || {};
  return {
    kind,
    artist: kind === "status" ? "" : clean(row?.artist, { max: LIMITS.artist }),
    artistKey: kind === "status" ? null : row?.artist_key || null,
    venue: kind === "status" ? "" : clean(row?.venue, { max: LIMITS.venue }),
    venueKey: kind === "status" ? null : row?.venue_key || venueBinding(row?.venue),
    city: kind === "status" ? "" : clean(row?.city, { max: LIMITS.city }),
    date: kind === "status" ? "" : cleanDate(row?.date) || "",
    overall: kind === "status" ? 0 : clampRating(row?.overall),
    band: kind === "status" || row?.band == null ? null : clampRating(row.band),
    room: kind === "status" || row?.room == null ? null : clampRating(row.room),
    dims: kind === "status" ? {} : dims,
    review: clean(row?.review, { max: LIMITS.review, newlines: true }),
    photos: cleanStringArray(parseJsonArray(row?.photos), { maxItems: MEDIA_POST_MAX_ATTACHMENTS, maxLen: 2000 }),
    mediaAssetIds: row?.id ? postMediaAssetIds(db, row.id) : [],
    photosPublic: row?.photos_public ? 1 : 0,
    landingShowcase: kind === "review" && row?.landing_showcase ? 1 : 0,
    setlist: kind === "status" ? [] : cleanStringArray(parseJsonArray(row?.setlist), { maxItems: 40, maxLen: 120 }),
    tour: kind === "status" ? null : clean(row?.tour, { max: 80 }) || null,
    tags: kind === "status" ? [] : cleanPostTags(parseJsonArray(row?.tags)) || [],
    taggedUserIds: storedPostTaggedUserIds(row?.tagged_user_ids),
    song: song || null,
    playlistId: kind === "status" ? playlist?.id || null : null,
    campaign,
  };
}
// Insert a notification for a recipient (never notify yourself).
const notifRow = db.prepare("INSERT INTO notifications (id,user_id,actor_id,type,post_id,artist,text,created_at) VALUES (?,?,?,?,?,?,?,?)");
const postTagNotifRow = db.prepare("INSERT OR IGNORE INTO notifications (id,user_id,actor_id,type,post_id,artist,text,created_at) VALUES (?,?,?,?,?,?,?,?)");
function addNotif(recipientId, actorId, type, extra = {}) {
  if (!recipientId || recipientId === actorId) return;
  if (actorId && blockedEitherWay(recipientId, actorId)) return; // no pings across a block
  notifRow.run(uid("n"), recipientId, actorId, type, extra.postId ?? null, extra.artist ?? null, extra.text ?? null, now());
}

// True when either user has blocked the other (blocks act both ways).
const blockCheck = db.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)");
function blockedEitherWay(a, b) {
  if (!a || !b) return false;
  return !!blockCheck.get(a, b, b, a);
}
function addPostTagNotifications(recipientIds, actorId, postId, artist = null) {
  for (const recipientId of normalizeTaggedUserIds(recipientIds) || []) {
    if (!recipientId || recipientId === actorId || blockedEitherWay(recipientId, actorId)) continue;
    postTagNotifRow.run(uid("n"), recipientId, actorId, "post_tag", postId, artist || null, null, now());
  }
}
// Ids hidden from a viewer's feed (people they blocked or who blocked them).
const blockedIdsStmt = db.prepare("SELECT blocked_id id FROM blocks WHERE blocker_id=? UNION SELECT blocker_id id FROM blocks WHERE blocked_id=?");
function blockedIdSet(userId) {
  if (!userId) return new Set();
  return new Set(blockedIdsStmt.all(userId, userId).map((r) => r.id));
}

const DM_TOMBSTONE_LIMIT = 750;
function removedDmIdsFor(userId, otherId = null) {
  if (otherId) {
    return db.prepare(`SELECT id FROM dms WHERE removed=1
      AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))
      ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(userId, otherId, otherId, userId, DM_TOMBSTONE_LIMIT).map((row) => row.id);
  }
  return db.prepare(`SELECT id FROM dms WHERE removed=1 AND (from_id=? OR to_id=?)
    ORDER BY created_at DESC,id DESC LIMIT ?`)
    .all(userId, userId, DM_TOMBSTONE_LIMIT).map((row) => row.id);
}

const REPORTABLE_TARGET_TYPES = new Set([
  "post",
  "comment",
  "user",
  "message",
  "fan_message",
  "lounge_message",
  "venue_review",
  "artist_post",
  "artist_profile",
]);

function unavailableReportTarget() {
  throw new ApiError(404, "That item is no longer available.", "NOT_FOUND");
}

function preventSelfReport(authorId, reporterId) {
  if (authorId && authorId === reporterId) {
    throw new ApiError(400, "You can't report your own content.", "VALIDATION_FAILED");
  }
}

// Reporting must prove that the caller can actually see the target. Besides
// stopping guessed ids from becoming a private-content oracle, this keeps the
// report queue aligned with each surface's own membership/blocking rules.
function reportableTargetFor(user, targetType, targetId) {
  if (targetType === "post") {
    const row = db.prepare("SELECT id,user_id,photos,removed FROM posts WHERE id=?").get(targetId);
    if (!row || row.removed || !publicAccountOrNull(row.user_id)
      || blockedEitherWay(user.id, row.user_id)) unavailableReportTarget();
    preventSelfReport(row.user_id, user.id);
    return {
      authorId: row.user_id,
      photos: parseJsonArray(row.photos).filter((url) => !!safeOwnedReadyMediaUrl(db, { ownerId: row.user_id, url })),
    };
  }

  if (targetType === "comment") {
    const row = db.prepare(`SELECT c.user_id,c.removed,p.user_id post_user_id,p.removed post_removed
      FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?`).get(targetId);
    if (!row || row.removed || row.post_removed
      || !publicAccountOrNull(row.user_id)
      || !publicAccountOrNull(row.post_user_id)
      || blockedEitherWay(user.id, row.user_id)
      || blockedEitherWay(user.id, row.post_user_id)) unavailableReportTarget();
    preventSelfReport(row.user_id, user.id);
    return { authorId: row.user_id, photos: [] };
  }

  if (targetType === "user") {
    const row = q.userById.get(targetId);
    if (!accountIsPublic(row) || blockedEitherWay(user.id, row?.id)) unavailableReportTarget();
    preventSelfReport(row.id, user.id);
    return { authorId: row.id, photos: [] };
  }

  if (targetType === "message") {
    const row = db.prepare("SELECT from_id,to_id,removed FROM dms WHERE id=?").get(targetId);
    // Only an incoming message's recipient can report it. A participant cannot
    // report their own outbound message, and outsiders learn nothing from ids.
    if (!row || row.removed || row.to_id !== user.id) unavailableReportTarget();
    preventSelfReport(row.from_id, user.id);
    return { authorId: row.from_id, photos: [] };
  }

  if (targetType === "fan_message") {
    const row = db.prepare("SELECT artist,user_id,removed FROM fan_club_messages WHERE id=?").get(targetId);
    const member = row && db.prepare("SELECT 1 FROM fan_club_members WHERE artist=? AND user_id=?").get(row.artist, user.id);
    if (!row || row.removed || !member || !publicAccountOrNull(row.user_id)
      || blockedEitherWay(user.id, row.user_id)) unavailableReportTarget();
    preventSelfReport(row.user_id, user.id);
    return { authorId: row.user_id, photos: [] };
  }

  if (targetType === "lounge_message") {
    const row = db.prepare("SELECT lounge_id,user_id,removed FROM lounge_messages WHERE id=?").get(targetId);
    const attendee = row && showAttendanceRepository.hasAttendeeAccess(user.id, row.lounge_id);
    if (!row || row.removed || !attendee || !publicAccountOrNull(row.user_id)
      || blockedEitherWay(user.id, row.user_id)) unavailableReportTarget();
    preventSelfReport(row.user_id, user.id);
    return { authorId: row.user_id, photos: [] };
  }

  if (targetType === "venue_review") {
    const row = db.prepare("SELECT user_id,photos,removed FROM venue_reviews WHERE id=?").get(targetId);
    if (!row || row.removed || !publicAccountOrNull(row.user_id)
      || blockedEitherWay(user.id, row.user_id)) unavailableReportTarget();
    preventSelfReport(row.user_id, user.id);
    return {
      authorId: row.user_id,
      photos: parseJsonArray(row.photos).filter((url) => !!safePublicProfileImage(row.user_id, url)),
    };
  }

  if (targetType === "artist_post") {
    const row = db.prepare(`SELECT p.user_id,p.removed,profile.owner_id profile_owner_id,
      COALESCE(profile.feed_enabled,0) feed_enabled,COALESCE(profile.removed,0) profile_removed
      FROM artist_posts p LEFT JOIN artist_profiles profile ON profile.artist_key=p.artist_key
      WHERE p.id=?`).get(targetId);
    if (!row || !row.user_id || row.removed || row.profile_removed || !row.feed_enabled
      || !publicAccountOrNull(row.user_id) || blockedEitherWay(user.id, row.user_id)
      || (row.profile_owner_id && (!publicAccountOrNull(row.profile_owner_id)
        || blockedEitherWay(user.id, row.profile_owner_id)))) unavailableReportTarget();
    preventSelfReport(row.user_id, user.id);
    return { authorId: row.user_id, photos: [] };
  }

  if (targetType === "artist_profile") {
    const row = db.prepare("SELECT owner_id,bio,banner,avatar_uri,removed FROM artist_profiles WHERE artist_key=?").get(targetId);
    if (!row || !row.owner_id || row.removed || !publicAccountOrNull(row.owner_id)
      || blockedEitherWay(user.id, row.owner_id)) unavailableReportTarget();
    preventSelfReport(row.owner_id, user.id);
    return {
      authorId: row.owner_id,
      photos: [row.banner, row.avatar_uri].filter((url) => !!safePublicProfileImage(row.owner_id, url)),
    };
  }

  unavailableReportTarget();
}

function postJson(p, viewerId) {
  const stableMedia = postMediaState(db, p.id, { ownerId: viewerId || null });
  const storedPhotos = parseJsonArray(p.photos);
  const stableByUrl = new Map(stableMedia.assets.map((asset) => [asset.url, asset]));
  const legacyDescriptors = legacyVideoPosterDescriptors(db, { postId: p.id, photos: storedPhotos });
  const legacyByUrl = new Map(legacyDescriptors.map((asset) => [asset.url, asset]));
  const photos = [];
  const seenPhotos = new Set();
  for (const url of storedPhotos) {
    const publishable = stableByUrl.has(url)
      || legacyByUrl.has(url)
      || !!safeOwnedReadyMediaUrl(db, { ownerId: p.user_id, url });
    if (publishable && !seenPhotos.has(url)) {
      seenPhotos.add(url);
      photos.push(url);
    }
  }
  // post_media remains authoritative even if an old denormalized URL array
  // drifted. Verified release-only video descriptors can fill only their exact
  // stored slots and never become composer IDs.
  for (const asset of stableMedia.assets) {
    if (!seenPhotos.has(asset.url)) {
      seenPhotos.add(asset.url);
      photos.push(asset.url);
    }
  }
  const media = photos.map((url) => stableByUrl.get(url) || legacyByUrl.get(url)).filter(Boolean);
  const storedCampaign = p.kind === "status" ? normalizeArtistCampaign(parsedStoredObject(p.campaign)) : null;
  // Official presentation is a live authorization claim, not a permanent
  // visual badge embedded in authored JSON. Every row source feeding this
  // projector supplies current role/artist identity aliases; an old or custom
  // source missing them fails closed rather than reviving revoked styling.
  const campaignAuthorized = !!storedCampaign?.artistKey
    && p.u_role === "artist"
    && normName(p.u_artist_name) === normName(storedCampaign.artistKey);
  let campaign = campaignAuthorized ? storedCampaign : null;
  const campaignBackground = campaign?.backgroundAssetId
    ? media.find((asset) => asset.id === campaign.backgroundAssetId && asset.kind === "image")
    : null;
  if (campaign?.backgroundAssetId && !campaignBackground) {
    const { backgroundAssetId: _unavailableBackground, ...fallbackCampaign } = campaign;
    campaign = fallbackCampaign;
  }
  return {
    id: p.id,
    userId: p.user_id,
    kind: p.kind || "review",
    user: { name: p.u_name, handle: p.u_handle, initials: p.u_initials, avatarUri: safePublicProfileImage(p.user_id, p.u_avatar), avatarColor: p.u_color },
    artist: p.artist, venue: p.venue, city: p.city, date: p.date,
    artistKey: p.artist_key || null, artistMbid: p.artist_mbid || null, venueKey: p.venue_key || null,
    // Guarded, like `song` below and like publicUser: one malformed column must
    // degrade that field, not throw while building the page and take the whole
    // feed down with it.
    overall: p.overall, band: p.band, room: p.room, dims: parseJsonObject(p.dims), review: p.review,
    // A stable descriptor is the publication authority. If its verified
    // rendition/source becomes unavailable, do not let the denormalized legacy
    // URL column bypass that fail-closed state. Historical URL-only rows are
    // exposed only when the URL now resolves to this author's verified asset or
    // an exact verified release-only video mapping.
    photos,
    photosPublic: !!p.photos_public,
    // New clients get stable, poster-aware descriptors. A historical URL is
    // considered only after the ownership/readiness check above; unverified
    // legacy values are omitted instead of becoming public fetch targets.
    media,
    // Release-only legacy descriptors are presentation metadata, not stable
    // composer assets and must never be sent back through mediaAssetIds.
    mediaAssetIds: stableMedia.assets.map((asset) => asset.id),
    // Separate homepage consent is owner-only account state, not social proof.
    ...(viewerId === p.user_id ? { landingShowcase: !!p.landing_showcase } : {}),
    setlist: parseJsonArray(p.setlist),
    tour: p.tour || null,
    tags: parseJsonArray(p.tags),
    taggedPeople: projectedPostTaggedPeople(p, viewerId),
    song: p.song ? (() => { try { return JSON.parse(p.song); } catch { return null; } })() : null,
    // Feed pages receive a bounded preview. The full immutable song list is
    // loaded only when somebody presses Play, keeping 50-card feeds lightweight.
    playlist: playlistPostProjection(p.playlist),
    campaign,
    seen: p.seen_ordinal ?? null,
    ...(p.open_reports != null ? { flags: p.open_reports } : {}),
    likes: p.like_count ?? 0, comments: p.comment_count ?? 0,
    ...(p.comment_preview != null ? { commentPreview: parseJsonArray(p.comment_preview) } : {}),
    liked: viewerId ? !!db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(p.id, viewerId) : false,
    createdAt: p.created_at,
    editedAt: p.updated_at || null,
    version: p.updated_at || p.created_at,
  };
}

// Feed cards need only the latest two comments. Fetch them for the whole page in
// one indexed/windowed query instead of mounting N cards that each issue their
// own HTTP request. Full threads (including ancestor tombstones) remain on the
// dedicated comments endpoint and load only when somebody opens Afterparty.
function withCommentPreviews(posts, viewerId) {
  if (!Array.isArray(posts) || !posts.length) return posts || [];
  const ids = posts.map((post) => post.id).filter(Boolean);
  if (!ids.length) return posts;
  const placeholders = ids.map(() => "?").join(",");
  const blockSql = viewerId ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
    (b.blocker_id=? AND b.blocked_id=c.user_id) OR
    (b.blocker_id=c.user_id AND b.blocked_id=?))` : "";
  const args = [...ids];
  if (viewerId) args.push(viewerId, viewerId);
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT c.post_id,c.id,c.user_id,c.text,c.parent_id,c.created_at,
        u.name,u.initials,u.avatar_uri,u.avatar_color,u.role,u.verified,
        ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at DESC,c.id DESC) AS preview_rank
      FROM comments c JOIN users u ON u.id=c.user_id
      WHERE c.post_id IN (${placeholders}) AND c.removed=0 AND ${activeAccountSql("u")} ${blockSql}
    ) ranked
    WHERE preview_rank<=2
    ORDER BY post_id,created_at,id`).all(...args);
  const byPost = new Map();
  for (const comment of rows) {
    const projected = {
      id: comment.id,
      userId: comment.user_id,
      name: comment.name,
      initials: comment.initials,
      avatarUri: safePublicProfileImage(comment.user_id, comment.avatar_uri),
      avatarColor: comment.avatar_color,
      role: comment.role,
      verified: !!comment.verified,
      text: comment.text,
      deleted: false,
      parentId: comment.parent_id || null,
      createdAt: comment.created_at,
    };
    const list = byPost.get(comment.post_id) || [];
    list.push(projected);
    byPost.set(comment.post_id, list);
  }
  return posts.map((post) => ({ ...post, comment_preview: JSON.stringify(byPost.get(post.id) || []) }));
}

// Resolve an artist by name from MusicBrainz (CC0, keyless). Public lookup may
// return a transient fuzzy fallback, but staff identity creation must be exact.
function normalizedMusicBrainzArtistName(value) {
  const name = clean(typeof value === "string" ? value : "", { max: 241 });
  if (!name || [...name].length > 120) return null;
  return normName(name.normalize("NFKC"));
}

function musicBrainzArtistProjection(candidate) {
  const name = clean(candidate?.name, { max: 241 });
  const mbid = String(candidate?.id || "").trim().toLowerCase();
  if (!name || [...name].length > 120 || !MUSICBRAINZ_ARTIST_ID.test(mbid)) return null;
  const tags = Array.isArray(candidate?.tags)
    ? candidate.tags.slice().sort((left, right) => (Number(right?.count) || 0) - (Number(left?.count) || 0))
    : [];
  const genre = tags[0]?.name
    ? clean(tags[0].name, { max: 40 })
      .split(" ")
      .map((word) => word ? word[0].toUpperCase() + word.slice(1) : word)
      .join(" ")
    : null;
  const score = Number(candidate?.score);
  return {
    name,
    mbid,
    genre: genre || null,
    country: clean(candidate?.area?.name || candidate?.country || "", { max: 80 }) || null,
    beginYear: clean(candidate?.["life-span"]?.begin || "", { max: 20 }).slice(0, 4) || null,
    rank_score: Number.isFinite(score) ? score : 1,
  };
}

async function readMusicBrainzArtistCandidates(name) {
  const slash = String.fromCharCode(92);
  const escapedName = name.split(slash).join(slash + slash).split('"').join(slash + '"');
  const query = 'artist:"' + escapedName + '"';
  const url = "https://musicbrainz.org/ws/2/artist?query="
    + encodeURIComponent(query)
    + "&fmt=json&limit=5";
  let response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "Pit/1.0 (https://mshpit.com)", Accept: "application/json" },
      signal: AbortSignal.timeout(MUSICBRAINZ_ARTIST_LOOKUP_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderError("MusicBrainz", 502, "MusicBrainz could not be reached.", {
      code: "network",
      cause: error,
    });
  }
  if (!response.ok) {
    throw new ProviderError("MusicBrainz", response.status, "MusicBrainz did not return a usable response.", {
      code: response.status === 429 ? "rate_limited" : "http_error",
    });
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ProviderError("MusicBrainz", 502, "MusicBrainz returned unreadable data.", {
      code: "invalid_json",
      cause: error,
    });
  }
  return (Array.isArray(payload?.artists) ? payload.artists : [])
    .map(musicBrainzArtistProjection)
    .filter(Boolean);
}

async function resolveFromMusicBrainz(name, { requireExactIdentity = false } = {}) {
  const requestedIdentity = normalizedMusicBrainzArtistName(name);
  if (!requestedIdentity) {
    if (requireExactIdentity) {
      throw new ApiError(400, "Enter one complete artist name before resolving its identity.", "VALIDATION_FAILED");
    }
    return null;
  }

  let candidates;
  try {
    candidates = await readMusicBrainzArtistCandidates(name);
  } catch (error) {
    if (!requireExactIdentity) return null;
    throw new ApiError(
      502,
      "MusicBrainz is unavailable right now. Retry the artist lookup before continuing.",
      "PROVIDER_UNAVAILABLE",
      error,
    );
  }

  const exact = candidates.filter(
    (candidate) => normalizedMusicBrainzArtistName(candidate.name) === requestedIdentity,
  );
  if (!requireExactIdentity) return exact[0] || candidates[0] || null;

  const exactByIdentity = new Map(exact.map((candidate) => [candidate.mbid, candidate]));
  if (!exactByIdentity.size) {
    throw new ApiError(
      404,
      "MusicBrainz did not return an exact artist match. Check the official spelling before continuing.",
      "NOT_FOUND",
    );
  }
  if (exactByIdentity.size > 1) {
    throw new ApiError(
      409,
      "That exact artist name maps to multiple MusicBrainz identities. Resolve the catalog identity before continuing.",
      "CONFLICT",
    );
  }
  return exactByIdentity.values().next().value;
}

const artistByOtherMusicBrainzIdentity = db.prepare(
  "SELECT norm,name,mbid FROM artists WHERE mbid IS NOT NULL AND lower(mbid)=? AND norm<>? LIMIT 1",
);

async function persistExactMusicBrainzIdentity(name) {
  const resolved = await resolveFromMusicBrainz(name, { requireExactIdentity: true });
  const artistKey = normalizedMusicBrainzArtistName(resolved.name);
  const mbid = resolved.mbid.toLowerCase();
  const existing = artistStmts.byNorm.get(artistKey);
  let existingData = {};
  try {
    existingData = existing?.data ? JSON.parse(existing.data) : {};
  } catch {
    existingData = {};
  }
  if (!existingData || typeof existingData !== "object" || Array.isArray(existingData)) existingData = {};

  const recordedMbids = [existing?.mbid, existingData.mbid]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (recordedMbids.some((value) => !MUSICBRAINZ_ARTIST_ID.test(value) || value !== mbid)) {
    throw new ApiError(
      409,
      "This catalog artist already has a different identity. Review that artist before replacing its MusicBrainz ID.",
      "CONFLICT",
    );
  }

  const identityOwner = artistByOtherMusicBrainzIdentity.get(mbid, artistKey);
  if (identityOwner) {
    throw new ApiError(
      409,
      "That MusicBrainz identity is already attached to another catalog artist. Merge or correct the catalog rows first.",
      "CONFLICT",
    );
  }

  const rankCandidates = [
    Number(existingData.rank_score),
    Number(existing?.rank_score),
    Number(resolved.rank_score),
  ].filter(Number.isFinite);
  const merged = {
    ...resolved,
    ...existingData,
    name: resolved.name,
    mbid,
    genre: existingData.genre ?? existing?.genre ?? resolved.genre ?? null,
    photo: existingData.photo ?? existing?.photo ?? null,
    bio: existingData.bio ?? existing?.bio ?? null,
    spotifyId: existingData.spotifyId ?? existing?.spotify_id ?? null,
    country: existingData.country ?? existing?.country ?? resolved.country ?? null,
    beginYear: existingData.beginYear ?? existingData.formed ?? existing?.formed ?? resolved.beginYear ?? null,
    popularity: existingData.popularity ?? existing?.popularity ?? null,
    rank_score: rankCandidates.length ? Math.max(...rankCandidates) : 1,
  };

  artistStmts.upsert.run(artistRow(artistKey, merged, existing?.source || "musicbrainz"));
  const persisted = artistStmts.byNorm.get(artistKey);
  if (!persisted || String(persisted.mbid || "").toLowerCase() !== mbid) {
    throw new ApiError(
      409,
      "The artist identity changed while it was being saved. Reload the catalog and try again.",
      "CONFLICT",
    );
  }
  return persisted;
}

// Enrich a (usually thin) catalog artist from Deezer: photo, popularity, top
// tracks, and a genre if it has none. Uses the shared exact-name-preferred matcher
// so we don't attach a same-named act's photo/songs. Upserts so the page fills in.
// Returns true if Deezer had a match.
async function enrichArtistFromDeezer(name) {
  const e = await deezerEnrich(name);
  if (!e) return false;
  const existing = artistStmts.byNorm.get(normName(name));
  let data = {};
  try { data = existing?.data ? JSON.parse(existing.data) : {}; } catch {}
  const merged = {
    ...data,
    name: existing?.name || name,
    ...deezerEnrichmentGenreFields(data, existing?.genre, e),
    photo: e.photo || data.photo || null,
    mbid: existing?.mbid || data.mbid || null, country: existing?.country || null, beginYear: existing?.formed || null,
    popularity: e.popularity, followers: e.followers, topTracks: e.topTracks, deezerId: e.deezerId,
  };
  artistStmts.upsert.run(artistRow(normName(name), merged, "deezer"));
  return true;
}

// A likeable media URL: real https, sane length, no credentials, hash dropped
// (the URL is the reaction's primary key, so it has to be canonical).
function cleanMediaReactionUrl(value) {
  const raw = clean(value, { max: 600 });
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
}

function safePublicProfileImage(ownerId, value) {
  return safeOwnedReadyMediaUrl(db, { ownerId, url: value, kind: "image" })
    || (verifiedFinalizedLegacyMedia(db, { ownerId, publicUrl: value }) ? value : null);
}

// Keep the database projector useful for self-service/export while applying the
// live media capability check to every other-user projection in this API.
function publicUser(row, options = {}) {
  const projected = storedPublicUser(row, options);
  if (!projected) return projected;
  if (options.self) return { ...projected, owner: isOwnerId(db, row.id) };
  return {
    ...projected,
    avatarUri: safePublicProfileImage(row.id, projected.avatarUri),
    banner: safePublicProfileImage(row.id, projected.banner),
  };
}

function expectedMediaPurpose(purposes, index) {
  if (!Array.isArray(purposes)) return purposes;
  return purposes[index];
}

function assertNewOwnedReadyImageUrls(
  ownerId,
  nextValues,
  previousValues = [],
  label = "profile photo",
  purposes = [],
) {
  const next = Array.isArray(nextValues) ? nextValues : [];
  const previous = Array.isArray(previousValues) ? previousValues : [];
  for (let index = 0; index < next.length; index += 1) {
    const url = next[index];
    if (!url || url === previous[index]) continue;
    if (!verifiedFinalizedLegacyMedia(db, {
      ownerId,
      publicUrl: url,
      purpose: expectedMediaPurpose(purposes, index),
    })) {
      throw new ApiError(400, `New ${label} media must be a finished PIT-owned photo.`, "VALIDATION_FAILED");
    }
  }
}

function associateNewFinalizedImageUrls(
  ownerId,
  nextValues,
  previousValues = [],
  purposes = [],
  at = now(),
) {
  const next = Array.isArray(nextValues) ? nextValues : [];
  const previous = Array.isArray(previousValues) ? previousValues : [];
  for (let index = 0; index < next.length; index += 1) {
    const publicUrl = next[index];
    if (!publicUrl || publicUrl === previous[index]) continue;
    associateFinalizedLegacyMedia(db, {
      ownerId,
      publicUrl,
      purpose: expectedMediaPurpose(purposes, index),
      at,
    });
  }
}

function isVisibleAttachedMedia(user, postId, url) {
  if (!postId || !url) return false;
  const post = feedPostById.get(postId);
  if (!post || post.removed || !post.photos_public || !publicAccountOrNull(post.user_id)
      || (user && blockedEitherWay(user.id, post.user_id))) return false;
  const attached = postJson(post, user?.id || null).photos
    .map(cleanMediaReactionUrl)
    .filter(Boolean);
  return attached.includes(url);
}

function assertVisibleAttachedMedia(user, postId, url) {
  if (!postId) throw new ApiError(400, "Choose the post this photo belongs to.", "VALIDATION_FAILED");
  if (!isVisibleAttachedMedia(user, postId, url)) {
    throw new ApiError(404, "That photo is no longer available.", "NOT_FOUND");
  }
}

function runtimeReadiness() {
  // Render can probe several times while browsers also negotiate media
  // capability. Cache only successful SQLite/filesystem work for one second;
  // environment flags and privacy state below remain live on every request.
  const runtime = runtimeReadinessSuccessCache.get("database-file", () => {
    let database = false;
    try { database = db.prepare("SELECT 1 AS ok").get()?.ok === 1; }
    catch (readinessError) { void readinessError; database = false; }
    if (!database) throw new ApiError(503, "The database is not ready.", "DATABASE_UNAVAILABLE");
    const databaseFilePresent = existsSync(DATABASE_PATH);
    if (!databaseFilePresent) throw new ApiError(503, "Durable storage is not ready.", "STORAGE_UNAVAILABLE");
    return { database, databaseFilePresent };
  });
  const production = process.env.NODE_ENV === "production";
  const storageConfigured = !production || !!String(process.env.PIT_DATA_DIR || "").trim();
  if (!storageConfigured) {
    throw new ApiError(503, "Durable storage is not ready.", "STORAGE_UNAVAILABLE");
  }
  const bootstrapAllowed = production && ["1", "true", "yes", "on"].includes(
    String(process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP || "").trim().toLowerCase(),
  );
  const privateMediaIsolation = privateMediaIsolationStatus(process.env);
  return { ...runtime, storageConfigured, bootstrapAllowed, privateMediaIsolation };
}

function runtimeMediaPublishingCapabilities() {
  const flagged = mediaPublishingCapabilitiesForRuntime(process.env);
  const verifier = videoVerifierRuntimeStatus(process.env);
  const production = process.env.NODE_ENV === "production";
  const privateStorageReady = !production || privateMediaIsolationStatus(process.env).ready;
  const photos = !production || (
    mediaConfigured(process.env)
    && privateVideoMediaConfigured(process.env)
    && privateStorageReady
  );
  const videos = flagged.videos === true
    && mediaConfigured(process.env)
    && privateVideoMediaConfigured(process.env)
    && privateStorageReady
    && verifier.ready;
  return videos
    ? {
        photos,
        videos: true,
        pipeline: verifier.pipeline,
        sourceTypes: verifier.sourceTypes,
        sourceCodecs: verifier.sourceCodecs,
      }
    : { photos, videos: false };
}

function videoRequestBody(body) {
  return String(body?.contentType || "").split(";", 1)[0].trim().toLowerCase().startsWith("video/");
}

function normalizedRequestedMediaType(body) {
  return String(body?.contentType || "").split(";", 1)[0].trim().toLowerCase();
}

function runtimeAcceptsVideoSourceType(capabilities, contentType) {
  return capabilities?.videos === true
    && Array.isArray(capabilities.sourceTypes)
    && capabilities.sourceTypes.includes(String(contentType || "").toLowerCase());
}

function canonicalFinalizeTransportValue(value, depth = 0) {
  if (depth > 16) throw new ApiError(400, "Media verification details are invalid.", "VALIDATION_FAILED");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalFinalizeTransportValue(entry, depth + 1));
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new ApiError(400, "Media verification details are invalid.", "VALIDATION_FAILED");
  }
  const output = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    output[key] = canonicalFinalizeTransportValue(value[key], depth + 1);
  }
  return output;
}

function videoFinalizeOperationFingerprint(body) {
  let encoded;
  try { encoded = JSON.stringify(canonicalFinalizeTransportValue(body)); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Media verification details are invalid.", "VALIDATION_FAILED");
  }
  if (Buffer.byteLength(encoded || "", "utf8") > 64 * 1024) {
    throw new ApiError(400, "Media verification details are too large.", "VALIDATION_FAILED");
  }
  return createHash("sha256").update(encoded || "null").digest("hex");
}

function observeBackgroundVideoFinalizeFailure(error) {
  const status = error instanceof ApiError ? error.status : 500;
  if (status < 500) return;
  const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
  const cause = privateErrorLabel(error);
  console.error(`[media] background clip finalize failed safely: status=${status} code=${code} cause=${cause}`);
  recordError({
    level: "error",
    code,
    status,
    method: "POST",
    route: "/api/media/assets/:id/finalize",
    cause,
  });
  setTimeout(() => {
    maybeAlert().catch((alertError) => {
      console.error(`[media] background clip alert failed safely: cause=${privateErrorLabel(alertError)}`);
    });
  }, 0).unref?.();
}

function requireVideoPublishingActor(user) {
  if (user?.email_verified_at || user?.role === "admin") return;
  throw new ApiError(403, "Verify your email before publishing clips.", "FORBIDDEN");
}

export function reserveVideoPublishingDemand(ctx, user, phase) {
  // Source creation is count-unmetered. Durable outstanding-object/byte and
  // rolling byte/ticket breakers in mediaDeletion remain the service safety
  // boundary without turning carrier NATs or the whole site into a daily plan.
  if (phase === "upload") return null;
  if (phase !== "verify") {
    throw new ApiError(500, "Clip publishing admission is invalid.", "INTERNAL_ERROR");
  }
  const ipHash = createHash("sha256").update(String(ctx.ip || "unknown")).digest("hex").slice(0, 24);
  const windowMs = 60 * 60 * 1000;
  const reservation = reserveRateLimits([
    // Keep count-based fairness only on the scarce decoder slot, where one
    // actor or network could otherwise starve everyone.
    {
      key: `video-${phase}-user:${user.id}`,
      max: VIDEO_VERIFY_USER_HOURLY_LIMIT,
      windowMs,
    },
    {
      key: `video-${phase}-ip:${ipHash}`,
      max: VIDEO_VERIFY_IP_HOURLY_LIMIT,
      windowMs,
    },
    {
      key: `video-${phase}-global`,
      max: VIDEO_VERIFY_GLOBAL_HOURLY_LIMIT,
      windowMs,
    },
  ]);
  if (!reservation) {
    throw new ApiError(429, "Clip publishing is busy for this account or network. Try again later.", "RATE_LIMITED");
  }
  return reservation;
}

function publicHealthProjection(ctx) {
  // Core liveness is independent of optional remote media storage. Media
  // capabilities remain false until the private bucket passes its live privacy
  // probe, and every upload/download path enforces that gate independently.
  runtimeReadiness();
  const negotiated = ctx?.query?.mediaPipeline === VIDEO_VERIFIER_PIPELINE_VERSION;
  const capabilities = runtimeMediaPublishingCapabilities();
  return {
    ok: true,
    ts: now(),
    capabilities: {
      mediaPublishing: negotiated
        ? capabilities
        : { photos: capabilities.photos, videos: false },
    },
  };
}

function staffHealthProjection(actor) {
  const readiness = runtimeReadiness();
  const allowance = youtubeColdSearchActorAllowance(actor);
  const actorAllowance = {
    version: allowance.version,
    day: allowance.day,
    eligible: allowance.eligible,
    accountVerified: allowance.accountVerified,
    adminBypass: allowance.adminBypass,
    used: allowance.used,
    limit: allowance.limit,
    remaining: allowance.remaining,
  };
  return {
    ok: true,
    ts: now(),
    uptimeSeconds: Math.round(process.uptime()),
    commit: String(process.env.RENDER_GIT_COMMIT || "").slice(0, 12) || null,
    capabilities: { mediaPublishing: runtimeMediaPublishingCapabilities() },
    services: {
      database: readiness.database,
      storageConfigured: readiness.storageConfigured,
      storage: {
        configured: readiness.storageConfigured,
        databaseFilePresent: readiness.databaseFilePresent,
        bootstrapAllowed: readiness.bootstrapAllowed,
      },
      mediaObjectStorageConfigured: mediaConfigured(process.env),
      privateVideoSourceStorageConfigured: privateVideoMediaConfigured(process.env),
      privateMediaIsolation: readiness.privateMediaIsolation,
      imageProcessor: imageProcessorHealth(),
      legacyMediaFinalize: legacyMediaFinalizeHealth(db),
      legacyImageRecovery: legacyImageRecoveryHealth(db),
      videoVerifier: videoVerifierRuntimeStatus(process.env),
      youtubeConfigured: !!process.env.YOUTUBE_API_KEY,
      youtubeLookup: {
        ...youtubeProviderStatus(),
        actorAllowance,
      },
      wikidataLookup: wikidataProviderStatus(),
      tourProviderConfigured: !!(process.env.TICKETMASTER_KEY || process.env.BANDSINTOWN_APP_ID),
      tourDates: db.prepare("SELECT COUNT(*) c FROM tour_dates").get().c,
      sitemap: sitemapSnapshotHealth(),
      backgroundJobs: {
        cacheWarmEnabled: backgroundJobEnabled(process.env, "CACHE_WARM_ENABLED"),
        tourDateRefreshEnabled: backgroundJobEnabled(process.env, "TOURDATE_REFRESH_ENABLED"),
        backupEnabled: backupSchedulerEnabled(process.env),
        legacyImageRecoveryEnabled: legacyImageRecoveryEnabled(process.env),
        offhostBackupConfigured: offhostBackupConfigured(process.env),
      },
      mailConfigured: mailConfigured(),
      mail: mailDiagnostics(),
      mediaStorageConfigured: mediaConfigured(),
      mediaDeletion: mediaDeletionHealth(db),
    },
  };
}

// Build the playback decision from request data without registering or
// migrating override identities. GET is intentionally allowed to read an exact
// legacy-only pin created by a rolled-back instance, but startup/admin writes
// are the only places that may create v2 shadows or compatibility provenance.
function youtubeTrackPlaybackContext(ctx, input = {}) {
  const title = clean(input.title, { max: 200 });
  const artist = clean(input.artist, { max: 120 });
  if (!title) throw new ApiError(400, "Missing title.");
  const sourceProvider = String(clean(input.provider, { max: 24 }) || "").toLowerCase();
  const sourceId = clean(input.sourceId, { max: 64 }) || "";
  const recordingSource = cleanTrackRecordingSource(sourceProvider, sourceId);
  const overrideKey = trackOverrideKey(title, artist);
  const legacyOverrideKey = legacyTrackOverrideKey(title, artist);
  const playbackFailureKey = recordingSource?.key || overrideKey;
  const requestedExcluded = String(clean(input.exclude, { max: 256 }) || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9_-]{11}$/.test(value))
    .slice(0, 5);
  const storedExcluded = ctx.user ? db.prepare(`SELECT video_id FROM youtube_playback_failures
    WHERE track_key=? AND user_id=? AND created_at>? ORDER BY created_at DESC LIMIT 25`)
    .all(playbackFailureKey, ctx.user.id, now() - YOUTUBE_PLAYBACK_FAILURE_TTL_MS)
    .map((row) => row.video_id) : [];
  // Query exclusions are response-local and untrusted. The resolver refuses
  // shared cache writes whenever this set is non-empty.
  const excludedVideoIds = [...new Set([...storedExcluded, ...requestedExcluded])].slice(0, 25);
  const excludedSet = new Set(excludedVideoIds);

  const currentPinned = db.prepare("SELECT key,title,artist,video_id,set_by,updated_at FROM track_overrides WHERE key=?")
    .get(overrideKey);
  let pinned = currentPinned && sameTrackOverrideIdentity(currentPinned, title, artist)
    ? currentPinned
    : null;
  const legacy = db.prepare("SELECT key,title,artist,video_id,set_by,updated_at FROM track_overrides WHERE key=?")
    .get(legacyOverrideKey);
  const compatibilityLinks = db.prepare("SELECT current_key FROM track_override_compat_links WHERE legacy_key=? ORDER BY current_key")
    .all(legacyOverrideKey);
  if (!currentPinned && legacy && compatibilityLinks.length === 0 && sameTrackOverrideIdentity(legacy, title, artist)) {
    // A rolled-back process can create a new legacy row after startup. Serving
    // its exact title/artist match is safe; mutating provenance from a GET is
    // not. The next boot reconciles it, while an ambiguous historical slot
    // (one with any compatibility link) continues to fail closed.
    pinned = legacy;
  }

  const sourcePinned = recordingSource
    ? db.prepare(`SELECT provider,source_id,title,artist,video_id,set_by,updated_at
        FROM track_source_overrides WHERE provider=? AND source_id=?`)
      .get(recordingSource.provider, recordingSource.sourceId)
    : null;
  const exactSourcePinned = sourcePinned && sameTrackOverrideIdentity(sourcePinned, title, artist)
    ? sourcePinned
    : null;
  // An exact staff decision is more precise than an older tuple decision.
  // Without an exact source row, tuple-level NULL remains global moderation
  // authority and cannot be bypassed by an arbitrary provider query.
  if (exactSourcePinned && !exactSourcePinned.video_id) {
    return { result: { videoId: null, status: "confirmed_unavailable" } };
  }
  if (exactSourcePinned?.video_id && !excludedSet.has(exactSourcePinned.video_id)) {
    return { result: { videoId: exactSourcePinned.video_id, status: "pinned" } };
  }
  if (pinned && !pinned.video_id && !exactSourcePinned) {
    return { result: { videoId: null, status: "confirmed_unavailable" } };
  }
  // A positive tuple pin is ambiguous for two source recordings with the same
  // display metadata. Source-aware moderation above is exact; otherwise proof
  // selection decides. Legacy/no-source playback keeps the original behavior.
  if (pinned?.video_id && !recordingSource && !excludedSet.has(pinned.video_id)) {
    return { result: { videoId: pinned.video_id, status: "pinned" } };
  }
  const duration = Math.max(0, Math.min(24 * 60 * 60, Number(input.duration) || 0));
  return {
    result: null,
    title,
    artist,
    resolverOptions: {
      expectedDurationSec: duration,
      excludedVideoIds,
      sourceProvider,
      sourceId,
    },
  };
}

async function readYouTubeTrack(ctx, input) {
  const playback = youtubeTrackPlaybackContext(ctx, input);
  if (playback.result) return playback.result;
  const withoutSearch = await resolveYouTubeTrack(playback.title, playback.artist, {
    ...playback.resolverOptions,
    allowSearch: false,
    readOnly: true,
  });
  if (withoutSearch.status !== "search_deferred") return withoutSearch;
  if (!ctx.user) return { videoId: null, status: "search_login_required", retryable: false };
  const user = requireUser(ctx);
  if (!youtubeColdSearchActorAllowance(user).eligible) {
    return { videoId: null, status: "search_verification_required", retryable: false };
  }
  // The safe read phase is exhausted. A current client follows this explicit
  // boundary with the authenticated POST route; GET never reserves or spends a
  // listener, network, or global YouTube search allowance.
  return { videoId: null, status: "search_deferred", retryable: false, resolveMethod: "POST" };
}

async function searchYouTubeTrack(ctx, input) {
  const user = requireUser(ctx);
  if (!youtubeColdSearchActorAllowance(user).eligible) {
    return { videoId: null, status: "search_verification_required", retryable: false };
  }
  const playback = youtubeTrackPlaybackContext(ctx, input);
  if (playback.result) return playback.result;
  // Keep the listener allowance lazy so cache/catalogue hits remain free, but
  // make it idempotent: one explicit cold-track attempt can consume at most one
  // actor permit even if provider internals change later.
  let actorReserved = false;
  const reserveActorOnce = () => {
    if (actorReserved) return;
    reserveYouTubeColdSearch(ctx, user);
    actorReserved = true;
  };
  return resolveYouTubeTrack(playback.title, playback.artist, {
    ...playback.resolverOptions,
    beforeSearch: reserveActorOnce,
    signal: ctx.signal,
    // Keep actor/IP demand failures out of another listener's in-flight result.
    // The provider sees only this opaque process-local coalescing partition.
    demandScope: createHash("sha256")
      .update(`youtube-cold-v${YOUTUBE_COLD_SEARCH_ACTOR_BUDGET_VERSION}\0${user.id}\0${String(ctx.ip || "unknown")}`)
      .digest("hex")
      .slice(0, 24),
  });
}

// route table: "METHOD /path" -> handler(ctx) ; :params exposed as ctx.params
export const routes = {
  ...mediaAssetRoutes({ database: db, requireUser, now }),
  ...mediaLegacyFinalizeRoutes({ database: db, requireUser, now }),
  ...artistArchiveRoutes({
    database: db,
    ApiError,
    clean,
    normName,
    // Stable post_media is the only archive publication authority. Mark every
    // requested post as evaluated so historical raw URLs cannot reappear.
    projectMediaState: (postIds, viewerId) => {
      const state = postMediaStateByPost(db, postIds, { ownerId: viewerId || null });
      return { ...state, linkedPostIds: new Set(postIds) };
    },
    projectReviewUser: (user) => ({
      name: user.name,
      handle: user.handle,
      initials: user.initials,
      avatarUri: safePublicProfileImage(user.id, user.avatarUri),
      avatarColor: user.avatarColor,
    }),
    rateLimit: limit,
    resolveArtistName: (key) => artistStmts.byNorm.get(key)?.name || null,
  }),
  ...accountPrivacyRoutes({
    database: db,
    ApiError,
    findUserById: (id) => q.userById.get(id),
    marketingConsentVersion: CURRENT_MARKETING_CONSENT_VERSION,
    now,
    ownedMediaAsset,
    projectSelf: (user) => publicUser(user, { self: true }),
    rateLimit: limit,
    requireSessionUser,
    setMarketingPreference: (preference) => emailStmts.setMarketingPreference.run(preference),
    verifyPassword,
  }),
  ...artistDiscographyRoutes({
    ApiError,
    ProviderError,
    clean,
    loadDiscography: getDeezerDiscography,
    rateLimit: limit,
    requireUser,
  }),
  ...artistReviewRoutes({
    database: db,
    ApiError,
    clean,
    normName,
    projectPost: postJson,
    rateLimit: limit,
    resolveArtistName: (key) => artistStmts.byNorm.get(key)?.name || null,
  }),
  ...postTagRoutes({
    database: db,
    requireUser,
    limit,
    atomicWrite,
    ApiError,
    normalizeTaggedUserIds,
    now,
  }),
  ...dmReadRoutes({
    database: db,
    requireUser,
    userById: q.userById,
    blockedEitherWay,
    atomicWrite,
    ApiError,
  }),
  ...showAttendanceRoutes({
    database: db,
    attendanceRepository: showAttendanceRepository,
    ApiError,
    assertSafeAuthoredFields,
    atomicWrite,
    clean,
    cleanDate,
    decodeShowKey: (ctx) => decodedPathParam(ctx, "key", { max: 300, label: "show link" }),
    finishPage,
    limits: LIMITS,
    now,
    pageRequest,
    projectUser: publicUser,
    rateLimit: limit,
    requireSessionUser,
    requireUser,
    requireVerifiedUser,
    userById: q.userById,
  }),
  ...showRoutes({
    database: db,
    ApiError,
    decodeShowKey: (ctx) => decodedPathParam(ctx, "key", { max: 300, label: "show link" }),
    requireUser,
  }),
  ...guestSearchAnalyticsRoutes({
    database: db,
    ApiError,
    now,
    rateLimit: limit,
  }),
  ...suggestionRoutes({
    database: db,
    ApiError,
    assertSafeAuthoredText,
    createId: uid,
    now,
    rateLimit: limit,
    recordModerationAction: moderationRecord,
    requireAdmin,
    requireUser,
  }),
  ...artistMemorialRoutes({
    database: db,
    ApiError,
    assertSafeAuthoredText,
    decodeArtistKey: (ctx) => decodedPathParam(ctx, "key", { max: 180, label: "artist memorial link" }),
    normName,
    now,
    rateLimit: limit,
    recordModerationAction: moderationRecord,
    requireAdmin,
    resolveArtist: (key) => artistStmts.byNorm.get(key) || null,
  }),
  ...ownerApprovalRoutes({
    database: db,
    ApiError,
    applyRoleChange,
    getUser: (id) => q.userById.get(id),
    limit,
    now,
    requireAdmin,
    requireOwner,
    roleChangeTouchesHead,
    selectedRoleHandle,
  }),
  // Render only needs liveness plus capability flags. Operational topology,
  // commit ids, quota and mail diagnostics belong on the authenticated staff
  // route so a public probe cannot inventory the deployment.
  "GET /api/health": (ctx) => publicHealthProjection(ctx),
  "GET /api/admin/health": (ctx) => {
    const actor = requireModerator(ctx);
    return staffHealthProjection(actor);
  },

  // Versioned media assets are additive to the legacy URL-only upload route.
  // The server mints both the stable asset identity and its original source
  // location; a caller can never register an arbitrary public URL as PIT media.
  "POST /api/media/assets": (ctx) => {
    const u = requireUser(ctx);
    // Stable asset creation has no per-member count bucket. Outstanding object
    // accounting and service-wide circuit breakers bound abandoned/corrupt
    // work, while video additionally has IP/global incident admission below.
    const video = videoRequestBody(ctx.body);
    const requestedType = normalizedRequestedMediaType(ctx.body);
    const mediaCapabilities = video ? runtimeMediaPublishingCapabilities() : null;
    if (video && !runtimeAcceptsVideoSourceType(mediaCapabilities, requestedType)) {
      // Enforce the runtime capability before createMediaAsset can reserve a
      // ledger row or sign an R2 PUT. Stale/direct clients therefore receive
      // the same fail-closed production boundary as the composer.
      throw new ApiError(
        415,
        "New clip publishing is being prepared. Existing clips remain viewable; photos can still be published.",
        "MEDIA_TYPE_UNSUPPORTED",
      );
    }
    if (video) {
      requireVideoPublishingActor(u);
    }
    const retryToken = typeof ctx.body?.clientAssetId === "string" ? ctx.body.clientAssetId : "";
    const existing = video && retryToken
      ? db.prepare("SELECT id,status FROM media_assets WHERE owner_id=? AND client_asset_id=?").get(u.id, retryToken)
      : null;
    const suppressDuplicateUpload = existing?.status === "upload_pending"
      && videoFinalizeState({
        ownerId: u.id,
        assetId: existing.id,
        at: now(),
      }).state === "processing";
    // createMediaAsset still validates the complete retry identity/hash. The
    // flag only prevents a second signed writer from being minted for the same
    // validated row while its detached verifier job is reading it.
    return createMediaAsset(db, {
      ownerId: u.id,
      body: ctx.body,
      at: now(),
      suppressDuplicateUpload,
    });
  },

  // A signed HEAD confirms ticket MIME/length. Readiness-gated private-derivative-v1
  // clips then receive bounded, generation-bound MP4 preflight plus a private
  // full decode and server-generated cover; without that live verifier the
  // route fails before it can elevate the source. Image pixels/dimensions
  // remain client-declared until an authoritative image probe exists.
  "POST /api/media/assets/:id/finalize": async (ctx) => {
    const u = requireUser(ctx);
    const owned = db.prepare("SELECT kind,mime_type FROM media_assets WHERE id=? AND owner_id=?").get(ctx.params.id, u.id);
    if (!owned) throw new ApiError(404, "That media item was not found.", "NOT_FOUND");
    const video = owned?.kind === "video";
    const capabilities = video ? runtimeMediaPublishingCapabilities() : null;
    if (video) {
      requireVideoPublishingActor(u);
      if (!runtimeAcceptsVideoSourceType(capabilities, owned.mime_type)) {
        throw new ApiError(503, "Clip verification is temporarily unavailable. Try again later.", "MEDIA_STORAGE_UNAVAILABLE");
      }
    }

    // `async` is a transport hint, never authored media metadata. Every video
    // uses the background coordinator, including cached clients that omit the
    // hint, so no public request waits on the proxy's hard timeout. Those old
    // clients receive a resumable pending asset instead of losing its bytes.
    const asyncRequested = ctx.body?.async === true;
    const finalizeBody = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)
      ? { ...ctx.body }
      : ctx.body;
    if (finalizeBody && typeof finalizeBody === "object") delete finalizeBody.async;

    if (video) {
      const initialAsset = ownedMediaAsset(db, {
        ownerId: u.id,
        assetId: ctx.params.id,
        renew: true,
        at: now(),
      });
      if (initialAsset.status === "ready") {
        // Preserve the immutable-finalize conflict contract on a lost-response
        // retry. A healthy ready row returns before storage I/O; a corrupt row
        // fails quickly instead of dragging this compatibility check back over
        // the public proxy deadline.
        const result = await finalizeMediaAsset(db, {
          ownerId: u.id,
          assetId: ctx.params.id,
          body: finalizeBody,
          at: now(),
          authoritativeVideoVerifier: verifyVideoObject,
          authoritativePosterRequired: true,
          fetchImpl: async () => {
            throw new ApiError(503, "Clip verification is temporarily unavailable. Try again later.", "MEDIA_STORAGE_UNAVAILABLE");
          },
        });
        return { ...result, finalize: { state: "completed" } };
      }
      const ownerId = u.id;
      const assetId = ctx.params.id;
      const requestIp = String(ctx.ip || "unknown");
      const operationFingerprint = videoFinalizeOperationFingerprint(finalizeBody);
      const started = startVideoFinalizeJob({
        ownerId,
        assetId,
        fingerprint: operationFingerprint,
        at: now(),
        run: async () => {
          try {
            return await finalizeMediaAsset(db, {
              ownerId,
              assetId,
              body: finalizeBody,
              at: now(),
              authoritativeVideoVerifier: verifyVideoObject,
              authoritativePosterRequired: true,
              beforeAuthoritativeVerify: () => reserveVideoPublishingDemand(
                { ip: requestIp },
                { id: ownerId },
                "verify",
              ),
              // Deliberately no caller signal: a browser disconnect or proxy
              // timeout must not cancel the shared process-local job.
            });
          } catch (error) {
            observeBackgroundVideoFinalizeFailure(error);
            if (isTerminalMediaSourceFailure(error)) {
              cancelMediaAsset(db, { ownerId, assetId, at: now() });
            }
            throw error;
          }
        },
      });
      if (!asyncRequested) {
        const compatibility = await waitForVideoFinalizeCompletion(started.completion, {
          // Tests use a tiny deterministic budget; production keeps a large
          // margin beneath both the browser and outer-proxy request limits.
          timeoutMs: process.env.NODE_ENV === "test" ? 10 : VIDEO_CACHED_FINALIZE_WAIT_MS,
          signal: ctx.signal,
        });
        if (compatibility.settled) {
          return { ...compatibility.value, finalize: { state: "completed" } };
        }
        // Cached bundles do not understand a successful `processing` body: they
        // would immediately PATCH recipe/poster metadata as though verification
        // had completed. A retryable response stops that old flow at finalize,
        // while the detached coordinator keeps the already-uploaded bytes and
        // finishes normally for the next retry.
        throw new ApiError(
          429,
          "PIT is still processing this clip. Your upload is saved—try again to resume it.",
          "RATE_LIMITED",
        );
      }
      return { asset: initialAsset, finalize: started.finalize };
    }

    const result = await finalizeMediaAsset(db, {
      ownerId: u.id,
      assetId: ctx.params.id,
      body: finalizeBody,
      at: now(),
      signal: ctx.signal,
    });
    return { ...result, finalize: { state: result.asset?.status === "ready" ? "completed" : "idle" } };
  },

  "GET /api/media/assets/:id": (ctx) => {
    const u = requireUser(ctx);
    const knownFinalize = videoFinalizeState({ ownerId: u.id, assetId: ctx.params.id, at: now() });
    const asset = ownedMediaAsset(db, {
      ownerId: u.id,
      assetId: ctx.params.id,
      // A live background job already owns the draft and its source lease.
      // Avoid turning a two-second poll into a stream of SQLite writes.
      renew: knownFinalize.state !== "processing",
      at: now(),
    });
    const finalize = videoFinalizeState({ ownerId: u.id, assetId: ctx.params.id, asset, at: now() });
    if (!asset && finalize.state === "idle") throw new ApiError(404, "That media item was not found.", "NOT_FOUND");
    return { asset, finalize };
  },

  "PATCH /api/media/assets/:id": (ctx) => {
    const u = requireUser(ctx);
    return updateMediaAsset(db, {
      ownerId: u.id,
      assetId: ctx.params.id,
      body: ctx.body,
      at: now(),
    });
  },

  "POST /api/media/assets/:id/variants": (ctx) => {
    const u = requireUser(ctx);
    return createMediaVariant(db, {
      ownerId: u.id,
      assetId: ctx.params.id,
      body: ctx.body,
      at: now(),
    });
  },

  "POST /api/media/assets/:id/variants/:variantId/finalize": async (ctx) => {
    const u = requireUser(ctx);
    return finalizeMediaVariant(db, {
      ownerId: u.id,
      assetId: ctx.params.id,
      variantId: ctx.params.variantId,
      body: ctx.body,
      at: now(),
    });
  },

  // ---- per-photo reactions (the full-screen media viewer) ----
  // Keyed by the media URL itself: unique per upload, so likes survive post
  // edits/reordering and follow the photo into artist galleries.
  "POST /api/media/react": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "media-react", 120, 10 * 60 * 1000);
    const url = cleanMediaReactionUrl(ctx.body?.url);
    if (!url) throw new ApiError(400, "That photo can't be liked.", "VALIDATION_FAILED");
    const postId = clean(ctx.body?.postId, { max: 60 }) || null;
    assertVisibleAttachedMedia(u, postId, url);
    const existing = db.prepare("SELECT 1 FROM media_reactions WHERE media_url=? AND user_id=?").get(url, u.id);
    if (existing) db.prepare("DELETE FROM media_reactions WHERE media_url=? AND user_id=?").run(url, u.id);
    else db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)").run(url, u.id, postId, now());
    const count = db.prepare("SELECT COUNT(*) c FROM media_reactions WHERE media_url=?").get(url).c;
    return { liked: !existing, count };
  },

  // Batch counts for a visible post-attached photo set (one call when the viewer
  // opens). The attachment context prevents a known private/removed URL from
  // becoming a reaction-count oracle. `mine` is filled only for a signed-in
  // viewer.
  "POST /api/media/reactions": (ctx) => {
    limit(ctx, "media-react-read", 240, 10 * 60 * 1000);
    const fallbackPostId = clean(ctx.body?.postId, { max: 60 }) || null;
    const requested = Array.isArray(ctx.body?.items)
      ? ctx.body.items
      : (Array.isArray(ctx.body?.urls) ? ctx.body.urls : []).map((url) => ({ url, postId: fallbackPostId }));
    const out = {};
    const seen = new Set();
    for (const item of requested.slice(0, 48)) {
      const url = cleanMediaReactionUrl(item?.url);
      const postId = clean(item?.postId, { max: 60 }) || null;
      if (!url || seen.has(url) || !isVisibleAttachedMedia(ctx.user || null, postId, url)) continue;
      seen.add(url);
      const count = db.prepare("SELECT COUNT(*) c FROM media_reactions WHERE media_url=?").get(url).c;
      const mine = ctx.user ? !!db.prepare("SELECT 1 FROM media_reactions WHERE media_url=? AND user_id=?").get(url, ctx.user.id) : false;
      out[url] = { count, mine };
      if (seen.size >= 24) break;
    }
    return { reactions: out };
  },

  // ---- server clock ---- authoritative time so the calendar + scheduling don't
  // trust the device clock. Returns epoch ms, ISO, the server's IANA timezone and
  // its current UTC offset (minutes), so the client can render "today" correctly.
  "GET /api/time": () => {
    const d = new Date();
    let tz = "UTC";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch {}
    return { now: d.getTime(), iso: d.toISOString(), tz, offsetMinutes: -d.getTimezoneOffset() };
  },

  // ---- artist catalog (DB-backed; scales past the bundled JSON) ----
  // Search the catalog. Empty query → the top artists by rank. Notable artists
  // surface first (rank_score); exact name matches float to the top.
  "GET /api/artists": (ctx) => {
    const term = clean(ctx.query.q, { max: 80 }).toLowerCase();
    const lim = Math.min(40, Math.max(1, Number(ctx.query.limit) || 20));
    const literal = term.replace(/[%_\\]/g, "");
    const folded = artistSearchKey(term);
    const rows = term.length >= 1
      ? artistStmts.search.all(`%${literal}%`, folded ? `%${folded}%` : "\u0000", term, folded, lim)
      : artistStmts.top.all(lim);
    const artistMbids = new Map(rows.map((row) => [row.norm, row.mbid]));
    const memorials = artistMemorialService.readPublicForArtistKeys({
      artistKeys: rows.map((row) => row.norm),
      artistMbids,
      at: now(),
    });
    return {
      artists: rows.map((row) => {
        const memorial = memorials.get(row.norm);
        return {
          ...publicArtist(row),
          // Search receives only the compact public marker. The complete prose,
          // accomplishments, thank-you, and citation load on the artist page.
          memorial: memorial ? {
            deceased: true,
            deathDate: memorial.deathDate,
            spotlight: memorial.spotlight,
          } : null,
        };
      }),
      total: artistStmts.count.get().c,
    };
  },

  // Resolve a public URL to the thing it names, so the client router can open
  // /turnstile without shipping the whole catalogue to guess with. Uses the same
  // lookup as the page metadata, so a shared link and a crawler agree.
  "GET /api/resolve": (ctx) => {
    const path = clean(ctx.query.path, { max: 300 });
    if (!path.startsWith("/")) throw new ApiError(400, "Missing path.");
    limit(ctx, "public-url-resolve", 120, 10 * 60 * 1000);
    return { entity: resolveEntity(path) };
  },

  // Song search, so the search box works for someone who remembers the song but
  // not who made it. Deliberately Deezer-backed: it is keyless, so this costs no
  // YouTube quota. A playable video is resolved later, only if the song is
  // actually played.
  "GET /api/songs/search": async (ctx) => {
    const term = clean(ctx.query.q, { max: 80 });
    if (term.length < 2) return { songs: [] };
    limit(ctx, "song-search", 120, 10 * 60 * 1000);
    const want = Math.min(20, Math.max(1, Number(ctx.query.limit) || 12));

    // The catalogue answers first: it is in memory, needs no network, and only
    // contains acts we already know are real, so results appear instantly and
    // still work when a provider is down.
    const catalog = searchCatalogSongs(term, { limit: want });
    const seen = new Set(catalog.map((s) => `${normalizeMusicText(s.artist)}|${normalizeMusicText(s.title)}`));

    let remote = [];
    try {
      remote = await searchDeezerTracks(term, { limit: want });
    } catch {
      // A provider outage must not take the whole search box down. The
      // catalogue results above still stand, and the other sections (people,
      // artists, venues, events) are unaffected.
      remote = [];
    }

    const merged = [...catalog];
    for (const song of remote) {
      const identity = `${normalizeMusicText(song.artist)}|${normalizeMusicText(song.title)}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push({ ...song, source: "provider" });
    }

    // Match quality outranks where the result came from. Listing the whole
    // catalogue first put its partial match ("This Photograph Is Proof") above
    // the songs actually called "Photograph", which is not what someone typing
    // that word wants. The catalogue only breaks ties, where it is preferred
    // because it is instant and already known to be a real touring act.
    const q = normalizeMusicText(term);
    const quality = (song) => {
      const title = normalizeMusicText(song.title);
      if (title === q) return 4;
      if (title.startsWith(q)) return 3;
      if (title.includes(q)) return 2;
      return 1;
    };
    merged.sort((a, b) =>
      quality(b) - quality(a)
      || (a.source === b.source ? 0 : a.source === "catalog" ? -1 : 1)
      || (Number(b.popularity) || 0) - (Number(a.popularity) || 0)
    );
    return { songs: merged.slice(0, want) };
  },

  // Resolve one artist by name without letting a public GET mutate the shared
  // catalogue, popularity counters, or admin missing queue. Unknown artists are
  // returned as request-scoped MusicBrainz projections; ingestion remains an
  // explicit staff/background operation.
  "GET /api/artists/resolve": async (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    const existing = artistStmts.byNorm.get(normName(name));
    if (existing) return { artist: publicArtist(existing), created: false };
    limit(ctx, "resolve", 90, 10 * 60 * 1000); // cap outbound MB lookups per client
    const mb = await resolveFromMusicBrainz(name);
    if (!mb) return { artist: null, created: false };
    return { artist: publicArtist(artistRow(mb.name, mb, "musicbrainz")), created: false, transient: true };
  },


  // Same-named artists disambiguation: a short list of Deezer candidates (fans,
  // photo, album count) so a listener can pick the one they actually mean and
  // re-pin this name to that artist via the discography endpoint's deezerId.
  "GET /api/artists/candidates": async (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    limit(ctx, "artist-candidates", 60, 10 * 60 * 1000);
    try { return { candidates: await findDeezerArtistCandidates(name) }; }
    catch (error) {
      if (error instanceof ProviderError) return { candidates: [] };
      throw error;
    }
  },

  // Resolve a fresh, identity-checked Deezer preview. These signed links expire
  // within minutes and are therefore cached only briefly in memory, never in DB.
  "GET /api/deezer/track": async (ctx) => {
    const title = clean(ctx.query.title, { max: 200 });
    const artist = clean(ctx.query.artist, { max: 120 });
    if (!title) throw new ApiError(400, "Missing title.");
    limit(ctx, "deezer-track", 180, 10 * 60 * 1000);
    try { return await getFreshDeezerPreview(title, artist, { signal: ctx.signal }); }
    catch (error) {
      if (ctx.signal?.aborted) throw ctx.signal.reason || error;
      if (error instanceof ProviderError) {
        return { preview: null, status: error.code, retryable: error.retryable };
      }
      throw error;
    }
  },

  // Resolve a track title (+ artist) to a YouTube video ID, so the in-app player
  // streams the full song/video. Candidate metadata, embeddability, artist/title,
  // duration, official-channel patterns, and known bad variants are scored before
  // a finite-lived cache entry is accepted.
  // Every public fan photo posted for this artist, newest first, with the
  // poster's name. The artist page's rolling gallery reads THIS instead of the
  // viewer's transient feed cache, so photos never vanish just because the post
  // scrolled off the first feed page.
  "GET /api/artists/photos": (ctx) => {
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    limit(ctx, "artist-photos", 120, 10 * 60 * 1000);
    const viewerId = ctx.user?.id || null;
    const requestedArtistKey = normName(clean(ctx.query.artistKey, { max: 120 }));
    const identitySql = requestedArtistKey ? "p.artist_key=?" : "LOWER(p.artist)=LOWER(?)";
    const blockSql = viewerId ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))` : "";
    const args = [requestedArtistKey || name, now()];
    if (viewerId) args.push(viewerId, viewerId);
    const rows = db.prepare(`SELECT p.id,p.user_id,p.photos,p.created_at,u.name AS by
      FROM posts p JOIN users u ON u.id=p.user_id
      WHERE ${identitySql} AND p.removed=0 AND p.photos_public=1 AND p.photos!='[]'
        AND u.is_banned=0 AND (u.suspended_until IS NULL OR u.suspended_until<=?) ${blockSql}
      ORDER BY p.created_at DESC,p.id DESC LIMIT 40`).all(...args);
    const stableMedia = postMediaStateByPost(db, rows.map((row) => row.id));
    const legacyMedia = legacyVideoPosterDescriptorsByPost(db, rows.map((row) => row.id));
    const photos = [];
    for (const r of rows) {
      let list = []; try { list = JSON.parse(r.photos || "[]"); } catch {}
      const projectedAssets = stableMedia.assetsByPost.get(r.id) || [];
      const stableByUrl = new Map(projectedAssets
        .map((asset) => [asset.url, asset]));
      const legacyByUrl = new Map((legacyMedia.get(r.id) || [])
        .map((asset) => [asset.url, asset]));
      const publishableUris = [];
      const seenUris = new Set();
      for (const uri of list) {
        if ((stableByUrl.has(uri) || legacyByUrl.has(uri)
            || !!safeOwnedReadyMediaUrl(db, { ownerId: r.user_id, url: uri })) && !seenUris.has(uri)) {
          seenUris.add(uri);
          publishableUris.push(uri);
        }
      }
      for (const asset of projectedAssets) {
        if (!seenUris.has(asset.url)) {
          seenUris.add(asset.url);
          publishableUris.push(asset.url);
        }
      }      for (const uri of publishableUris) {
        if (typeof uri === "string" && /^https?:\/\//i.test(uri)) {
          const asset = stableByUrl.get(uri) || legacyByUrl.get(uri);
          photos.push({
            uri,
            posterUrl: asset?.posterUrl || null,
            posterTimeMs: asset?.posterTimeMs ?? null,
            kind: asset?.kind || (isLegacyVideoUrl(uri) ? "video" : "image"),
            altText: asset?.altText || "",
            by: r.by,
            postId: r.id,
            userId: r.user_id,
            at: r.created_at,
          });
        }
        if (photos.length >= 30) break;
      }
      if (photos.length >= 30) break;
    }
    return { photos };
  },

  // How many times the signed-in user has logged this artist ("you've been in
  // the pit with them N times" on the artist profile).
  "GET /api/artists/seen": (ctx) => {
    const u = requireUser(ctx);
    const name = clean(ctx.query.name, { max: 120 });
    if (!name) throw new ApiError(400, "Missing name.");
    const row = db.prepare("SELECT COUNT(*) c, MAX(date) last FROM posts WHERE user_id=? AND LOWER(artist)=LOWER(?) AND removed=0").get(u.id, name);
    return { count: row?.c || 0, last: row?.last || null };
  },

  "GET /api/youtube/track": async (ctx) => {
    try {
      limit(ctx, "yt-read", 120, 10 * 60 * 1000);
      return await readYouTubeTrack(ctx, ctx.query || {});
    } catch (error) {
      if (error instanceof ProviderError) return { videoId: null, status: error.code, retryable: error.retryable };
      throw error;
    }
  },

  // A top-level cross-site navigation may carry a SameSite=Lax cookie, so the
  // scarce listener/network/global search reservations live only behind POST.
  // GET above remains the anonymous-safe pin/cache/catalogue read phase.
  "POST /api/youtube/track/resolve": async (ctx) => {
    try {
      limit(ctx, "yt-search", 120, 10 * 60 * 1000);
      return await searchYouTubeTrack(ctx, ctx.body || {});
    } catch (error) {
      if (error instanceof ProviderError) return { videoId: null, status: error.code, retryable: error.retryable };
      throw error;
    }
  },

  // Turn a pasted YouTube link into a safe post attachment. The provider call is
  // keyless and only receives a canonical youtube.com URL derived from the video
  // id, so arbitrary user URLs are never fetched by the server.
  "GET /api/youtube/oembed": async (ctx) => {
    requireUser(ctx);
    limit(ctx, "yt-oembed", 60, 10 * 60 * 1000);
    const url = clean(ctx.query.url, { max: 500 });
    if (!url) throw new ApiError(400, "Paste a YouTube link to attach a video.", "VALIDATION_FAILED");
    const song = await youtubeOEmbed(url);
    if (!song) throw new ApiError(400, "That link is not a playable YouTube video.", "VALIDATION_FAILED");
    return { song };
  },

  // IFrame errors 100/101/150 mean this listener could not use the served ID.
  // Remember that fact per actor and re-resolve for them. A client assertion is
  // never global authority: otherwise any account could suppress correct music
  // site-wide by submitting arbitrary title/video pairs.
  "POST /api/youtube/invalidate": (ctx) => {
    const user = requireUser(ctx);
    limit(ctx, "yt-invalidate", 60, 60 * 60 * 1000);
    const title = clean(ctx.body?.title, { max: 200 });
    const artist = clean(ctx.body?.artist, { max: 120 });
    const videoId = clean(ctx.body?.videoId, { max: 32 });
    if (!title || !videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new ApiError(400, "That failed video could not be identified.", "VALIDATION_FAILED");
    const source = cleanTrackRecordingSource(ctx.body?.provider, ctx.body?.sourceId, { strict: true });
    const key = source?.key || trackOverrideKey(title, artist);
    db.prepare(`INSERT INTO youtube_playback_failures (track_key,video_id,user_id,created_at)
      VALUES (?,?,?,?) ON CONFLICT(track_key,video_id,user_id) DO UPDATE SET created_at=excluded.created_at`)
      .run(key, videoId, user.id, now());
    const pinned = source
      ? db.prepare("SELECT title,artist,video_id FROM track_source_overrides WHERE provider=? AND source_id=?")
        .get(source.provider, source.sourceId)
      : db.prepare("SELECT title,artist,video_id FROM track_overrides WHERE key=?").get(key);
    if (pinned?.video_id === videoId && sameTrackOverrideIdentity(pinned, title, artist)) {
      const existing = db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type='track' AND target_id=? AND status='open'")
        .get(user.id, key);
      if (!existing) {
        const reason = JSON.stringify({
          title,
          artist: artist || "",
          category: "wont_play",
          suggestedVideoId: null,
          note: "Pinned video failed to embed for this listener.",
          ...(source ? { provider: source.provider, sourceId: source.sourceId } : {}),
        });
        db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)")
          .run(uid("r"), "track", key, reason, user.id, now());
      }
    }
    return { ok: true, quarantined: true, globallyInvalidated: false };
  },

  // ---- Discover: DB-backed charts, genre share, explore-by-genre ----
  // Live from the whole catalog (not the bundled snapshot), so it reflects real
  // growth and re-ranks as popularity/plays change (new artists can take top spots).
  // `by=popularity` = the Deezer-tracked chart; `by=plays` = what Pit users actually
  // play. Optional genre + country filters power the interactive pie + explore.
  "GET /api/discover/chart": (ctx) => {
    const by = ctx.query.by === "plays" ? "plays" : "popularity";
    const n = Math.min(60, Math.max(3, Number(ctx.query.limit) || 24));
    const genre = clean(ctx.query.genre, { max: 60 });
    const country = clean(ctx.query.country, { max: 60 });
    ctx.setHeader?.("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return discoverChart({ by, limit: n, genre, country });
  },
  // Genre distribution for the pie, canonicalized (optionally scoped to a country).
  "GET /api/discover/genres": (ctx) => {
    const country = clean(ctx.query.country, { max: 60 });
    const n = Math.min(12, Math.max(4, Number(ctx.query.n) || 8));
    ctx.setHeader?.("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return discoverGenres({ country, limit: n });
  },
  // Country distribution for the region chips (biggest scenes first).
  "GET /api/discover/countries": (ctx) => {
    const min = Math.max(1, Number(ctx.query.min) || 5);
    ctx.setHeader?.("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return discoverCountries({ min });
  },
  // One coherent first-paint payload replaces three sequential phone requests.
  // The data is public and changes slowly, so a short shared cache absorbs repeat
  // loads without making charts feel stale after staff/catalog activity.
  "GET /api/discover/overview": (ctx) => {
    const by = ctx.query.by === "plays" ? "plays" : "popularity";
    const country = clean(ctx.query.country, { max: 60 }) || "Worldwide";
    ctx.setHeader?.("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    const { memberTotal: _privateMemberTotal, ...overview } = discoverOverview({ by, country });
    return overview;
  },

  // A deliberately tiny public projection for the logged-out hero. The service
  // accepts only explicitly opted-in review photos from PIT-owned media storage,
  // applies account/report/block safety filters, and never returns a review,
  // location, date, email, or user id. Keep this cache private because a signed-in
  // cookie can make block filtering viewer-specific.
  "GET /api/landing/media": (ctx) => {
    ctx.setHeader?.("Cache-Control", "private, max-age=60");
    const timestamp = now();
    const media = landingCommunityMedia({
      viewerId: ctx.user?.id || null,
      limit: ctx.query?.limit,
      at: timestamp,
    });
    return { media, totals: landingTotals(), source: media.length ? "community" : "fallback" };
  },

  // ---- Listening: cross-device play history + "friends listening" ----
  "POST /api/plays": (ctx) => {
    const u = requireUser(ctx);
    const title = clean(ctx.body?.title, { max: 200 });
    if (!title) return { ok: false };
    const artist = clean(ctx.body?.artist, { max: 120 }) || null;
    assertSafeAuthoredFields({ "track title": title, "track artist": artist });
    limit(ctx, "play", 300, 60 * 60 * 1000);
    const id = uid("play");
    const createdAt = now();
    const videoId = parseYouTubeVideoId(ctx.body?.videoId || "") || null;
    const { provider, sourceId } = cleanPlaybackSource(ctx.body?.provider, ctx.body?.sourceId);
    const url = cleanTrackPlaybackUrl({ videoId, provider, sourceId });
    const art = cleanTrackArtwork(ctx.body?.art, { videoId, provider });
    db.prepare("INSERT INTO plays (id,user_id,title,artist,url,video_id,provider,source_id,art,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, u.id, title, artist, url, videoId, provider, sourceId, art, createdAt);
    db.prepare("DELETE FROM plays WHERE user_id=? AND id NOT IN (SELECT id FROM plays WHERE user_id=? ORDER BY created_at DESC LIMIT 300)").run(u.id, u.id);
    return { ok: true, play: { id, title, artist, url, videoId, provider, sourceId, art, at: createdAt } };
  },
  "GET /api/me/plays": (ctx) => {
    const u = requireUser(ctx);
    const { cursor, limit: pageSize } = pageRequest(ctx, 50, 100);
    const cursorSql = cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : "";
    const args = cursor ? [u.id, cursor.createdAt, cursor.createdAt, cursor.id, pageSize + 1] : [u.id, pageSize + 1];
    const found = db.prepare(`SELECT id,title,artist,url,video_id,provider,source_id,art,created_at FROM plays WHERE user_id=? ${cursorSql} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, pageSize);
    return { plays: rows.map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      url: cleanTrackPlaybackUrl({ videoId: r.video_id, provider: r.provider, sourceId: r.source_id }),
      videoId: r.video_id,
      provider: r.provider,
      sourceId: r.source_id,
      art: cleanTrackArtwork(r.art, { videoId: r.video_id, provider: r.provider }),
      at: r.created_at,
    })), nextCursor };
  },
  // The latest track from each person you follow, most recent first.
  "GET /api/plays/friends": (ctx) => {
    const u = requireUser(ctx);
    const at = now();
    const rows = db.prepare(`
      SELECT p.user_id, p.title, p.artist, p.url, p.video_id, p.provider, p.source_id, p.art, p.created_at,
        us.name u_name, us.handle u_handle, us.initials u_initials, us.avatar_uri u_avatar, us.avatar_color u_color, us.verified u_verified, us.role u_role
      FROM plays p JOIN users us ON us.id = p.user_id
      WHERE p.user_id IN (SELECT followee_id FROM follows WHERE follower_id=?)
        AND us.is_banned=0
        AND (us.suspended_until IS NULL OR us.suspended_until<=?)
      ORDER BY p.created_at DESC LIMIT 200`).all(u.id, at);
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      out.push({ user: { id: r.user_id, name: r.u_name, handle: r.u_handle, initials: r.u_initials, avatarUri: safePublicProfileImage(r.user_id, r.u_avatar), avatarColor: r.u_color, verified: !!r.u_verified, role: r.u_role }, track: {
        title: r.title,
        artist: r.artist,
        url: cleanTrackPlaybackUrl({ videoId: r.video_id, provider: r.provider, sourceId: r.source_id }),
        videoId: r.video_id,
        provider: r.provider,
        sourceId: r.source_id,
        art: cleanTrackArtwork(r.art, { videoId: r.video_id, provider: r.provider }),
        at: r.created_at,
      } });
      if (out.length >= 30) break;
    }
    return { listening: out };
  },

  // ---- Playlists (saved sessions, shareable, on the profile) ----
  "POST /api/playlists": (ctx) => {
    const u = requireUser(ctx);
    // Every other content-creating route is capped. Without this, one account can
    // add rows to a 1GB disk as fast as it can post, bounded only by the global
    // per-IP flood guard.
    limit(ctx, "playlist-write", 60, 60 * 60 * 1000);
    const name = clean(ctx.body?.name, { max: 80 }) || "Untitled";
    const tracks = cleanPlaylistTracks(ctx.body?.tracks, { allowEmpty: false });
    if (!tracks) throw new ApiError(400, "A playlist needs at least one song.", "VALIDATION_FAILED");
    assertSafePlaylistContent(name, tracks);
    let visibility = "public";
    if (Object.prototype.hasOwnProperty.call(ctx.body || {}, "visibility")) {
      const requested = clean(ctx.body.visibility, { max: 20 });
      if (!PLAYLIST_VISIBILITIES.has(requested)) throw new ApiError(400, "Choose public, unlisted, or private.", "VALIDATION_FAILED");
      visibility = requested;
    }
    const id = uid("pls");
    const createdAt = now();
    db.prepare("INSERT INTO playlists (id,user_id,name,tracks,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, u.id, name, JSON.stringify(tracks), visibility, createdAt, createdAt);
    return playlistProjection({ id, user_id: u.id, u_name: u.name, u_handle: u.handle, name, tracks: JSON.stringify(tracks), visibility, created_at: createdAt, updated_at: createdAt });
  },
  "GET /api/users/:id/playlists": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const self = ctx.user?.id === ctx.params.id;
    if (!self && !publicAccountOrNull(ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const rows = db.prepare(`SELECT p.*, u.name AS u_name, u.handle AS u_handle FROM playlists p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=? ${self ? "" : "AND p.visibility='public'"} ORDER BY COALESCE(p.updated_at,p.created_at) DESC, p.id DESC LIMIT 50`).all(ctx.params.id);
    return { playlists: rows.map(playlistProjection) };
  },
  "GET /api/playlists/:id": (ctx) => {
    const row = db.prepare(`SELECT p.*, u.name AS u_name, u.handle AS u_handle FROM playlists p JOIN users u ON u.id=p.user_id WHERE p.id=?`).get(ctx.params.id);
    if (!row || blockedEitherWay(ctx.user?.id, row.user_id)) throw new ApiError(404, "That playlist isn't available.", "NOT_FOUND");
    if (ctx.user?.id !== row.user_id && !publicAccountOrNull(row.user_id)) throw new ApiError(404, "That playlist isn't available.", "NOT_FOUND");
    if (row.visibility === "private" && ctx.user?.id !== row.user_id) throw new ApiError(404, "That playlist isn't available.", "NOT_FOUND");
    return { playlist: playlistProjection(row) };
  },
  // Add tracks to (and/or rename) an existing playlist. Lets people build a
  // playlist one song at a time instead of only snapshotting a whole session.
  "PATCH /api/playlists/:id": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "playlist-write", 60, 60 * 60 * 1000);
    const row = db.prepare("SELECT * FROM playlists WHERE id=? AND user_id=?").get(ctx.params.id, u.id);
    if (!row) throw new ApiError(404, "That playlist left the set.", "NOT_FOUND");
    let storedTracks = [];
    try { storedTracks = JSON.parse(row.tracks || "[]"); } catch {}
    let tracks = cleanPlaylistTracks(storedTracks) || [];
    if (Object.prototype.hasOwnProperty.call(ctx.body || {}, "tracks")) {
      const replacement = cleanPlaylistTracks(ctx.body.tracks);
      if (!replacement) throw new ApiError(400, "Those playlist songs are invalid.", "VALIDATION_FAILED");
      tracks = replacement;
    }
    const incoming = Array.isArray(ctx.body?.add) ? ctx.body.add : (ctx.body?.track ? [ctx.body.track] : []);
    const add = cleanPlaylistTracks(incoming);
    if (!add) throw new ApiError(400, "A playlist can hold up to 100 valid songs.", "VALIDATION_FAILED");
    for (const t of add) {
      const key = t.videoId ? `youtube:${t.videoId}` : t.sourceId ? `source:${t.provider || "unknown"}:${t.sourceId.toLowerCase()}` : t.url ? `url:${t.url.toLowerCase()}` : `text:${(t.artist || "").toLowerCase()}|${t.title.toLowerCase()}`;
      const exists = cleanPlaylistTracks(tracks)?.some((x) => {
        const existingKey = x.videoId ? `youtube:${x.videoId}` : x.sourceId ? `source:${x.provider || "unknown"}:${x.sourceId.toLowerCase()}` : x.url ? `url:${x.url.toLowerCase()}` : `text:${(x.artist || "").toLowerCase()}|${x.title.toLowerCase()}`;
        return existingKey === key;
      });
      if (!exists) tracks.push(t);
    }
    if (tracks.length > 100) throw new ApiError(400, "This playlist is full at 100 songs.", "VALIDATION_FAILED");
    const name = Object.prototype.hasOwnProperty.call(ctx.body || {}, "name") ? clean(ctx.body.name, { max: 80 }) : row.name;
    if (!name) throw new ApiError(400, "Give this playlist a name.", "VALIDATION_FAILED");
    assertSafePlaylistContent(name, tracks);
    let visibility = row.visibility || "public";
    if (Object.prototype.hasOwnProperty.call(ctx.body || {}, "visibility")) {
      const requested = clean(ctx.body.visibility, { max: 20 });
      if (!PLAYLIST_VISIBILITIES.has(requested)) throw new ApiError(400, "Choose public, unlisted, or private.", "VALIDATION_FAILED");
      visibility = requested;
    }
    const updatedAt = now();
    db.prepare("UPDATE playlists SET tracks=?, name=?, visibility=?, updated_at=? WHERE id=? AND user_id=?").run(JSON.stringify(tracks), name, visibility, updatedAt, ctx.params.id, u.id);
    return { playlist: playlistProjection({ ...row, name, tracks: JSON.stringify(tracks), visibility, updated_at: updatedAt, u_name: u.name, u_handle: u.handle }) };
  },
  "DELETE /api/playlists/:id": (ctx) => {
    const u = requireUser(ctx);
    const result = db.prepare("DELETE FROM playlists WHERE id=? AND user_id=?").run(ctx.params.id, u.id);
    if (!result.changes) throw new ApiError(404, "That playlist already left the set.", "NOT_FOUND");
    return { ok: true };
  },

  // ---- auth ----
  "POST /api/signup": (ctx) => {
    // Auth endpoints are always limited by network + normalized target,
    // independent of whatever cookie the caller happens to carry. A bot cannot
    // mint a new account and thereby mint a fresh signup/login/recovery bucket.
    limitAuthentication(ctx, "signup", {
      ipMax: 5,
      ipWindowMs: 15 * 60 * 1000,
      target: ctx.body?.email,
      targetMax: 5,
    });
    const [errs, v] = shape(ctx.body, {
      name: { required: true, parse: (x) => (isName(x) ? cleanName(x) : undefined) },
      email: { required: true, parse: (x) => (isEmail(x) ? cleanEmail(x) : undefined) },
      password: { required: true, parse: (x) => (isPassword(x) ? x : undefined) },
      city: { required: false, parse: (x) => clean(x, { max: LIMITS.city }) || undefined },
      lat: { required: false, parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      lng: { required: false, parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      analyticsConsent: { required: false, parse: (x) => typeof x === "boolean" ? x : undefined },
      termsVersion: { required: false, parse: (x) => clean(x, { max: 32 }) || undefined },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    assertSafeAuthoredFields({ "profile name": v.name, city: v.city });
    if (v.termsVersion !== CURRENT_TERMS_VERSION) {
      throw new ApiError(400, "Accept the current Terms & Conditions and Privacy policy to create an account.", "VALIDATION_FAILED");
    }
    // Do the expensive password work before the existence check so registered
    // and new addresses have the same dominant timing cost. The response and
    // cookie behavior below are also identical: signup must not be an account
    // lookup oracle.
    const passwordHash = hashPassword(v.password);
    const existing = q.userByEmail.get(v.email);
    const id = uid("u");
    const initials = (v.name.match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase();
    const colors = ["#F2A65A", "#E0457B", "#5B8DEF", "#6FCF97", "#B98AE0", "#E8B65A"];
    const createdAt = now();
    let created = null;
    if (!existing) {
      try {
        atomicWrite(() => {
          q.insertUser.run(id, v.email, v.name, privateSignupHandle(), passwordHash,
            "fan", v.city ?? null, v.lat ?? null, v.lng ?? null, initials, colors[Math.floor(Math.random() * colors.length)], createdAt);
          db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify({
            termsAcceptedAt: createdAt,
            termsVersion: CURRENT_TERMS_VERSION,
            ...(v.analyticsConsent ? { analyticsConsentAt: createdAt } : {}),
          }), id);
        });
        created = q.userById.get(id);
      } catch (error) {
        // A concurrent request for this address may win between the existence
        // check and INSERT. Hide only that race; unrelated constraints and disk
        // failures remain real errors.
        if (!q.userByEmail.get(v.email)) throw error;
      }
    }
    if (created) {
      // Verification mail now; WELCOME remains held until confirmation. This is
      // background work, but the public response never claims delivery and is
      // exactly the same for an address that was already registered.
      beginVerification(created);
    }
    return { ok: true, pending: true };
  },

  "POST /api/login": (ctx) => {
    limitAuthentication(ctx, "login", {
      ipMax: 10,
      ipWindowMs: 10 * 60 * 1000,
      target: ctx.body?.email,
      targetMax: 20,
    });
    const [errs, v] = shape(ctx.body, {
      email: { required: true, parse: (x) => cleanEmail(x) || undefined },
      password: { required: true, parse: (x) => (typeof x === "string" ? x.slice(0, 100) : undefined) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const u = q.userByEmail.get(v.email);
    // same error either way, never reveal which part was wrong
    if (!verifyPasswordForUser(v.password, u?.pass_hash)) throw new ApiError(401, "Wrong email or password.", "AUTH_INVALID");
    // Banned accounts receive a restricted session so the account gate can
    // still offer export and permanent deletion. Social routes continue to
    // fail through requireUser(); the self projection carries the restriction.
    const sess = createSession(u.id, ctx.ip, ctx.ua);
    ctx.setSession(sess);
    return { user: publicUser(u, { self: true }) };
  },

  "POST /api/logout": (ctx) => {
    destroySession(ctx.token);
    ctx.clearSession();
    return { ok: true };
  },

  // Forgot password — email a one-hour reset link. Always responds the same way so
  // it never reveals which emails have accounts. Reset secrets are never logged.
  "POST /api/forgot": async (ctx) => {
    limitAuthentication(ctx, "forgot", {
      ipMax: 5,
      ipWindowMs: 15 * 60 * 1000,
      target: ctx.body?.email,
      targetMax: 4,
      targetWindowMs: 60 * 60 * 1000,
    });
    const responseFloor = createRecoveryResponseFloor();
    const generic = { ok: true };
    try {
      const email = cleanEmail(ctx.body?.email);
      if (!email) return generic;
      const u = q.userByEmail.get(email);
      const requestedAt = now();
      // Persist the cooldown in the existing expiry field so a distributed spray
      // cannot invalidate a person's latest link or send repeated mail merely by
      // rotating IP addresses/processes. A fresh request is allowed 15 minutes
      // after the previous one while the prior one-hour link remains usable.
      const resetEligible = !!u && Number(u.reset_expires || 0) <= requestedAt + 45 * 60 * 1000;
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest("hex");
      // Keep the database operation write-shaped for eligible and ineligible
      // identities. A real-row update and mail scheduling still have different
      // costs, so every path also settles behind the response floor in `finally`.
      db.prepare("UPDATE users SET reset_hash=?, reset_expires=? WHERE id=?").run(
        hash,
        requestedAt + 60 * 60 * 1000,
        resetEligible ? u.id : -1,
      );
      if (!resetEligible) return generic;
      const configuredOrigin = (process.env.PUBLIC_ORIGIN || "").replace(/\/+$/, "");
      const publicOrigin = configuredOrigin || (process.env.NODE_ENV === "production" ? "https://www.mshpit.com" : ctx.origin);
      // Keep bearer credentials in the URL fragment: browsers do not send a
      // fragment in HTTP requests, reverse-proxy logs, or Referer headers.
      const link = `${publicOrigin}/#reset=${token}`;
      // Transactional: goes out regardless of marketing opt-out, since a user who
      // muted announcements still has to be able to get back into their account.
      sendTemplateInBackground("password_reset", {
        user: u,
        vars: { link },
        idempotencyKey: `password-reset-${hash.slice(0, 32)}`,
      });
      return generic;
    } finally {
      await responseFloor.settle();
    }
  },

  // Complete a reset: swap the password, invalidate the token + all sessions, and
  // sign the user straight in on this device.
  "POST /api/reset": (ctx) => {
    limit(ctx, "reset", 10, 15 * 60 * 1000);
    const token = clean(ctx.body?.token, { max: 200 });
    const password = typeof ctx.body?.password === "string" ? ctx.body.password : "";
    if (!token || !isPassword(password)) throw new ApiError(400, "Need a valid link and a new password of at least 8 characters.");
    const hash = createHash("sha256").update(token).digest("hex");
    const resetAt = now();
    const u = db.prepare("SELECT * FROM users WHERE reset_hash=? AND reset_expires > ?").get(hash, resetAt);
    if (!u) throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.");
    // Compute scrypt before taking SQLite's write lock, then make token
    // consumption, credential replacement, prior-session revocation, and the
    // replacement session one atomic security boundary. The conditional update
    // is the single-use compare-and-swap if another process races this token.
    const replacementPasswordHash = hashPassword(password);
    const sess = atomicWrite(() => {
      const consumed = db.prepare(`UPDATE users SET pass_hash=?, reset_hash=NULL, reset_expires=0
        WHERE id=? AND reset_hash=? AND reset_expires>?`)
        .run(replacementPasswordHash, u.id, hash, now()).changes === 1;
      if (!consumed) throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.");
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id); // sign out everywhere else
      return createSession(u.id, ctx.ip, ctx.ua);
    });
    ctx.setSession(sess);
    return { user: publicUser(q.userById.get(u.id), { self: true }) };
  },

  "GET /api/me": (ctx) => {
    ctx.setHeader?.("Cache-Control", "no-store");
    return { user: ctx.user ? publicUser(ctx.user, { self: true, badges: true }) : null };
  },

  "POST /api/me/analytics-consent": (ctx) => {
    const user = requireUser(ctx);
    limit(ctx, "analytics-consent", 20, 10 * 60 * 1000);
    if (typeof ctx.body?.enabled !== "boolean") throw new ApiError(400, "Choose whether product analytics are enabled.", "VALIDATION_FAILED");
    const extras = parseStoredProfileExtras(user.extras);
    // Older accounts used `consentAt` for both Terms acceptance and analytics.
    // Split those purposes without erasing the only legal acceptance record.
    if (extras.consentAt && !extras.termsAcceptedAt) extras.termsAcceptedAt = extras.consentAt;
    if (extras.termsAcceptedAt && !extras.termsVersion) extras.termsVersion = "legacy";
    delete extras.consentAt;
    if (ctx.body.enabled) {
      extras.analyticsConsentAt = now();
      extras.analyticsOptOut = false;
    } else {
      delete extras.analyticsConsentAt;
      extras.analyticsOptOut = true;
    }
    atomicWrite(() => {
      db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify(extras), user.id);
      if (!ctx.body.enabled) db.prepare("DELETE FROM events WHERE user_id=?").run(user.id);
    });
    return { user: publicUser(q.userById.get(user.id), { self: true }) };
  },

  // Standalone so profiles can show badges without widening the bulk user list,
  // where one query per row would be an N+1 on every feed render.
  "GET /api/users/:id/badges": (ctx) => {
    if (!publicAccountOrNull(ctx.params.id)) throw new ApiError(404, "No such member.", "NOT_FOUND");
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) {
      throw new ApiError(404, "No such member.", "NOT_FOUND");
    }
    return { badges: customBadgesFor(ctx.params.id) };
  },

  // The ids this account follows, lets the client hydrate its follow graph on
  // login / a new device (SQLite migration slice 1, see MIGRATION.md).
  "GET /api/me/following": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare(`SELECT f.followee_id FROM follows f JOIN users target ON target.id=f.followee_id
      WHERE f.follower_id=? AND ${activeAccountSql("target")} ORDER BY f.followee_id LIMIT 2000`).all(u.id);
    return { following: rows.map((r) => r.followee_id) };
  },

  // ---- profile ----
  "PATCH /api/me": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "profile", 30, 10 * 60 * 1000);

    // Reject invalid/oversized metadata atomically. Truncating serialized JSON
    // can leave an account with malformed data that breaks every projection.
    const hasExtras = Object.prototype.hasOwnProperty.call(ctx.body || {}, "extras");
    const hasSearchIndexingOptOut = Object.prototype.hasOwnProperty.call(ctx.body || {}, "searchIndexingOptOut");
    if (hasSearchIndexingOptOut && typeof ctx.body.searchIndexingOptOut !== "boolean") {
      throw new ApiError(400, "searchIndexingOptOut must be a boolean.", "VALIDATION_FAILED");
    }
    const incomingExtras = hasExtras ? canonicalProfileExtras(ctx.body.extras, { strict: true }) : null;
    let serializedExtras = hasExtras && incomingExtras.valid ? serializeProfileExtras(incomingExtras.value) : undefined;
    if (hasExtras && (!incomingExtras.valid || serializedExtras === null)) {
      throw new ApiError(400, `extras must be a JSON object no larger than ${PROFILE_EXTRAS_MAX_BYTES} bytes.`);
    }
    if (hasExtras) {
      // Consent and terms timestamps are server-authored account records. The
      // search-indexing choice has a dedicated boolean field below. A generic
      // compatibility-envelope patch may neither forge nor erase any of them.
      const requested = incomingExtras.value;
      const current = canonicalProfileExtras(parseStoredProfileExtras(u.extras)).value;
      for (const key of ["consentAt", "analyticsConsentAt", "termsAcceptedAt", "termsVersion", "analyticsOptOut", "searchIndexingOptOut"]) {
        if (current[key] === undefined) delete requested[key];
        else requested[key] = current[key];
      }
      serializedExtras = serializeProfileExtras(requested);
      assertSafeAuthoredFields({
        "now-playing title": requested.nowPlaying?.title,
        "now-playing artist": requested.nowPlaying?.artist,
      });
    }

    const [, v] = shape(ctx.body, {
      name: { parse: (x) => (isName(x) ? cleanName(x) : undefined) },
      handle: { parse: (x) => { const h = cleanHandle(x); return h && h.length >= 3 ? h : undefined; } },
      bio: { parse: (x) => clean(x, { max: LIMITS.bio, newlines: true }) },
      banner: { parse: (x) => clean(x, { max: 2000 }) },
      avatarUri: { parse: (x) => clean(x, { max: 2000 }) },
      city: { parse: (x) => clean(x, { max: LIMITS.city }) || undefined },
      lat: { parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      lng: { parse: (x) => (Number.isFinite(Number(x)) ? Number(x) : undefined) },
      genres: { parse: (x) => cleanStringArray(x, { maxItems: 12, maxLen: 30 }) },
      favoriteArtists: { parse: (x) => cleanStringArray(x, { maxItems: 50, maxLen: 80 }) },
      // Keep this server allow-list aligned with theme.js. If it falls behind,
      // newer themes get silently rejected here, the server then re-hydrates the
      // stale theme on /api/me and the client "snaps back" to a previous theme.
      theme: { parse: (x) => (["stage", "neon", "forest", "ember", "backstage", "vinyl", "daylight", "ice", "rose", "mint", "sunset", "lavender"].includes(x) ? x : undefined) },
      searchIndexingOptOut: { parse: (x) => (typeof x === "boolean" ? x : undefined) },
      extras: { parse: () => serializedExtras },
    });
    assertSafeAuthoredFields({
      "profile name": v.name,
      username: v.handle,
      bio: v.bio,
      city: v.city,
      genre: v.genres,
      "favorite artist": v.favoriteArtists,
    });
    assertNewOwnedReadyImageUrls(
      u.id,
      [v.banner, v.avatarUri],
      [u.banner, u.avatar_uri],
      "profile",
      ["banner", "avatar"],
    );
    const sets = [];
    const args = [];
    if (v.name) { sets.push("name = ?", "initials = ?"); args.push(v.name, (v.name.match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase()); }
    // @handle change: unique + role-tag + a 10-business-day cooldown.
    if (v.handle && v.handle !== u.handle) {
      const taken = q.userByHandle.get(v.handle);
      if (taken && taken.id !== u.id) throw new ApiError(409, "That username is taken.");
      if (!isOwnerId(db, u.id) && !handleAllowedForRole(v.handle, u.role)) {
        throw new ApiError(400, u.role === "admin" ? 'Admin usernames must contain "admin".' : 'Moderator usernames must contain "mod".');
      }
      if (u.handle_changed_at) {
        const nextAt = addBusinessDays(u.handle_changed_at, HANDLE_COOLDOWN_DAYS);
        if (now() < nextAt) {
          const when = new Date(nextAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          throw new ApiError(429, `Username can only change every ${HANDLE_COOLDOWN_DAYS} business days, next change available ${when}.`);
        }
      }
      sets.push("handle = ?", "handle_changed_at = ?"); args.push(v.handle, now());
    }
    if (v.bio !== undefined) { sets.push("bio = ?"); args.push(v.bio); }
    if (v.banner !== undefined) { sets.push("banner = ?"); args.push(v.banner); }
    if (v.avatarUri !== undefined) { sets.push("avatar_uri = ?"); args.push(v.avatarUri); }
    if (v.city !== undefined) { sets.push("home_city = ?", "home_lat = ?", "home_lng = ?"); args.push(v.city, v.lat ?? null, v.lng ?? null); }
    if (v.genres) { sets.push("genres = ?"); args.push(JSON.stringify(v.genres)); }
    if (v.favoriteArtists) { sets.push("favorite_artists = ?"); args.push(JSON.stringify(v.favoriteArtists)); }
    // Theme is stored inside the extras blob, so it survives sign-out and follows
    // the account. Merge it with an extras patch when both arrive together.
    if (v.theme || v.searchIndexingOptOut !== undefined) {
      const cur = parseStoredProfileExtras(v.extras ?? u.extras);
      if (v.theme) cur.theme = v.theme;
      if (v.searchIndexingOptOut !== undefined) cur.searchIndexingOptOut = v.searchIndexingOptOut;
      const encoded = serializeProfileExtras(cur);
      if (!encoded) throw new ApiError(400, `profile metadata must be no larger than ${PROFILE_EXTRAS_MAX_BYTES} bytes.`);
      sets.push("extras = ?"); args.push(encoded);
    } else if (v.extras !== undefined) { sets.push("extras = ?"); args.push(v.extras); }
    if (sets.length) {
      sets.push("profile_updated_at = ?");
      args.push(now());
    }
    const replacedProfileMedia = [
      ...(v.banner !== undefined && v.banner !== u.banner ? [u.banner] : []),
      ...(v.avatarUri !== undefined && v.avatarUri !== u.avatar_uri ? [u.avatar_uri] : []),
    ].filter(Boolean);
    atomicWrite(() => {
      associateNewFinalizedImageUrls(
        u.id,
        [v.banner, v.avatarUri],
        [u.banner, u.avatar_uri],
        ["banner", "avatar"],
      );
      if (sets.length) db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...args, u.id);
      markOwnedMediaAssociated(db, { ownerId: u.id, urls: [v.banner, v.avatarUri], at: now() });
      const deletable = unreferencedOwnedMediaUrls(db, { ownerId: u.id, urls: replacedProfileMedia });
      enqueueOwnedMediaUrls(db, { ownerId: u.id, urls: deletable, at: now() });
      const inside = q.userById.get(u.id);
      if (parseStoredProfileExtras(inside.extras).analyticsOptOut) db.prepare("DELETE FROM events WHERE user_id=?").run(u.id);
    });
    const updatedUser = q.userById.get(u.id);
    return { user: publicUser(updatedUser, { self: true }) };
  },

  // Signed-in people search + member directory (find friends), cross-device.
  // Empty browsing is alphabetical: account creation order is private metadata,
  // and the public API does not double as a newest-member or member-count feed.
  "GET /api/people": (ctx) => {
    const term = clean(ctx.query.q, { max: 60 }).toLowerCase();
    const postTagEligibleOnly = ctx.query.scope === "post_tag";
    const viewer = requireUser(ctx);
    if (!postTagEligibleOnly) limit(ctx, "people-search", 120, 10 * 60 * 1000);
    const cols = "id,name,handle,initials,avatar_uri,avatar_color,verified,role,home_city";
    const map = (r) => ({ id: r.id, name: r.name, handle: r.handle, initials: r.initials, avatarUri: safePublicProfileImage(r.id, r.avatar_uri), avatarColor: r.avatar_color, verified: !!r.verified, role: r.role, home: { city: r.home_city } });
    // Never surface someone you've blocked (or who blocked you) in search.
    const hidden = blockedIdSet(viewer?.id);
    if (postTagEligibleOnly) {
      limit(ctx, "post-tag-people", 120, 10 * 60 * 1000);
      let postId = null;
      if (ctx.query.postId != null && ctx.query.postId !== "") {
        if (typeof ctx.query.postId !== "string" || ctx.query.postId.length > 100) {
          throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
        }
        postId = ctx.query.postId;
        const ownedPost = db.prepare("SELECT 1 FROM posts WHERE id=? AND user_id=? AND removed=0")
          .get(postId, viewer.id);
        if (!ownedPost) throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
      }
      // Start at this account's indexed follow edges rather than scanning the
      // complete member directory for every composer keystroke. The reciprocal
      // primary-key probe proves mutual consent; an edit-specific rejection is
      // excluded only after proving the caller owns that active post.
      const rejectionSql = postId
        ? "AND NOT EXISTS (SELECT 1 FROM post_tag_rejections rejected WHERE rejected.post_id=? AND rejected.user_id=users.id)"
        : "";
      const eligibleFrom = `FROM follows mine
        JOIN follows theirs ON theirs.follower_id=mine.followee_id AND theirs.followee_id=mine.follower_id
        JOIN users ON users.id=mine.followee_id
        WHERE mine.follower_id=? AND users.id<>? AND ${activeAccountSql("users")}
          AND NOT EXISTS (SELECT 1 FROM blocks post_tag_block WHERE
            (post_tag_block.blocker_id=? AND post_tag_block.blocked_id=users.id) OR
            (post_tag_block.blocker_id=users.id AND post_tag_block.blocked_id=?))
          ${rejectionSql}`;
      const eligibleArgs = [viewer.id, viewer.id, viewer.id, viewer.id, ...(postId ? [postId] : [])];
      const total = db.prepare(`SELECT COUNT(*) c ${eligibleFrom}`).get(...eligibleArgs).c;
      if (term.length < 1) {
        const rows = db.prepare(`SELECT ${cols} ${eligibleFrom} ORDER BY name COLLATE NOCASE LIMIT 40`).all(...eligibleArgs);
        return { users: rows.filter((r) => !hidden.has(r.id)).map(map), total };
      }
      const like = `%${term.replace(/[%_\\]/g, "")}%`;
      const rows = db.prepare(`SELECT ${cols} ${eligibleFrom}
        AND (lower(name) LIKE ? OR lower(handle) LIKE ?)
        ORDER BY (lower(handle)=? OR lower(name)=?) DESC, name COLLATE NOCASE LIMIT 30`)
        .all(...eligibleArgs, like, like, term, term);
      return { users: rows.filter((r) => !hidden.has(r.id)).map(map), total };
    }
    if (term.length < 1) {
      const rows = db.prepare(`SELECT ${cols} FROM users WHERE ${activeAccountSql("users")} ORDER BY name COLLATE NOCASE,id LIMIT 60`).all();
      return { users: rows.filter((r) => !hidden.has(r.id)).map(map).slice(0, 40) };
    }
    const like = `%${term.replace(/[%_\\]/g, "")}%`;
    const rows = db.prepare(
      `SELECT ${cols} FROM users WHERE ${activeAccountSql("users")} AND (lower(name) LIKE ? OR lower(handle) LIKE ?) ORDER BY (lower(handle)=? OR lower(name)=?) DESC, name LIMIT 40`
    ).all(like, like, term, term);
    return { users: rows.filter((r) => !hidden.has(r.id)).map(map).slice(0, 30) };
  },

  "GET /api/users/:id": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const u = publicAccountOrNull(ctx.params.id);
    if (!u) throw new ApiError(404, "No such user.");
    const followers = db.prepare(`SELECT COUNT(*) c FROM follows f JOIN users actor ON actor.id=f.follower_id
      WHERE f.followee_id=? AND ${activeAccountSql("actor")}`).get(u.id).c;
    const following = db.prepare(`SELECT COUNT(*) c FROM follows f JOIN users target ON target.id=f.followee_id
      WHERE f.follower_id=? AND ${activeAccountSql("target")}`).get(u.id).c;
    const isFollowing = ctx.user ? !!db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(ctx.user.id, u.id) : false;
    return { user: publicUser(u), followers, following, isFollowing };
  },

  // The real people behind the follower/following numbers, so profiles have a
  // clickable follow list like any social platform.
  "GET /api/users/:id/followers": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    if (!publicAccountOrNull(ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const hidden = blockedIdSet(ctx.user?.id);
    const rows = db.prepare(`
      SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.followee_id = ? AND ${activeAccountSql("u")} ORDER BY u.name COLLATE NOCASE LIMIT 500`).all(ctx.params.id);
    return { users: rows.filter((r) => !hidden.has(r.id)).map((r) => publicUser(r)) };
  },
  "GET /api/users/:id/following": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    if (!publicAccountOrNull(ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    const hidden = blockedIdSet(ctx.user?.id);
    const rows = db.prepare(`
      SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id
      WHERE f.follower_id = ? AND ${activeAccountSql("u")} ORDER BY u.name COLLATE NOCASE LIMIT 500`).all(ctx.params.id);
    return { users: rows.filter((r) => !hidden.has(r.id)).map((r) => publicUser(r)) };
  },

  "GET /api/users/:id/rewards": (ctx) => {
    if (!publicAccountOrNull(ctx.params.id)) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    return userRewards(ctx.params.id);
  },

  "POST /api/users/:id/follow": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "follow", 60, 10 * 60 * 1000);
    if (u.id === ctx.params.id) throw new ApiError(400, "You can't follow yourself.");
    if (!publicAccountOrNull(ctx.params.id)) throw new ApiError(404, "No such user.");
    if (blockedEitherWay(u.id, ctx.params.id)) throw new ApiError(403, "You can't follow this account.");
    const has = !!db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(u.id, ctx.params.id);
    const following = desiredState(ctx.body, "following", has);
    if (!following && has) db.prepare("DELETE FROM follows WHERE follower_id=? AND followee_id=?").run(u.id, ctx.params.id);
    else if (following && !has) { db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(u.id, ctx.params.id); addNotif(ctx.params.id, u.id, "follow"); }
    return { following };
  },

  // ---- blocks: a real block, not a mute. Severs the follow both ways, stops
  // DMs in both directions, and hides each other's posts from the feed. ----
  "POST /api/users/:id/block": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "block", 30, 10 * 60 * 1000);
    const other = ctx.params.id;
    if (other === u.id) throw new ApiError(400, "You can't block yourself.");
    if (!q.userById.get(other)) throw new ApiError(404, "No such user.");
    const has = !!db.prepare("SELECT 1 FROM blocks WHERE blocker_id=? AND blocked_id=?").get(u.id, other);
    const blocked = desiredState(ctx.body, "blocked", has);
    if (!blocked && has) {
      db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(u.id, other);
    } else if (blocked && !has) {
      atomicWrite(() => {
        db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(u.id, other, now());
        // Sever every visible association both ways. Existing structured tags
        // are scrubbed (not merely hidden) and validation prevents new ones for
        // as long as either block direction remains active.
        db.prepare("DELETE FROM follows WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)").run(u.id, other, other, u.id);
        scrubPostTagsBetweenUsers(u.id, other);
      });
    }
    return { blocked };
  },
  "GET /api/me/blocked": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare(`
      SELECT us.* FROM blocks b JOIN users us ON us.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC LIMIT 500`).all(u.id);
    return { users: rows.map((r) => publicUser(r)) };
  },


  // Permanent account deletion. Password confirmation and a tight rate limit
  // guard the destructive action. Rows whose foreign keys would otherwise be
  // anonymized with SET NULL are explicitly removed before deleting the user;
  // all remaining account-owned rows disappear through FK cascades.
  "DELETE /api/me": (ctx) => {
    // A moderation restriction cannot trap someone in the service.
    const u = requireSessionUser(ctx);
    if (isOwnerId(db, u.id)) {
      throw new ApiError(403, "The permanent Owner account cannot be deleted.", "FORBIDDEN");
    }
    limit(ctx, "delete-account", 5, 60 * 60 * 1000);
    const password = typeof ctx.body?.password === "string" ? ctx.body.password : "";
    if (!password) throw new ApiError(400, "Enter your current password to delete your account.", "VALIDATION_FAILED");
    if (!verifyPassword(password, u.pass_hash)) throw new ApiError(401, "That password doesn't match your account.", "AUTH_INVALID");

    db.exec("BEGIN IMMEDIATE");
    try {
      const accountReportWhere = `reporter_id=?
        OR (target_type='user' AND target_id=?)
        OR (target_type='post' AND target_id IN (SELECT id FROM posts WHERE user_id=?))
        OR (target_type='comment' AND target_id IN (SELECT id FROM comments WHERE user_id=?))
        OR (target_type='message' AND target_id IN (SELECT id FROM dms WHERE from_id=? OR to_id=?))
        OR (target_type='fan_message' AND target_id IN (SELECT id FROM fan_club_messages WHERE user_id=?))
        OR (target_type='lounge_message' AND target_id IN (SELECT id FROM lounge_messages WHERE user_id=?))
        OR (target_type='venue_review' AND target_id IN (SELECT id FROM venue_reviews WHERE user_id=?))
        OR (target_type='artist_post' AND target_id IN (SELECT id FROM artist_posts WHERE user_id=?))
        OR (target_type='artist_profile' AND target_id IN (SELECT artist_key FROM artist_profiles WHERE owner_id=?))`;
      const accountReportParams = [u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id];

      // Reactions are keyed by durable media URL rather than a post FK. Remove
      // both exact attachments and every canonical object path owned by this
      // account so another person's like cannot keep the deleted user id alive.
      const authoredMediaUrls = [
        u.avatar_uri,
        u.banner,
        ...db.prepare("SELECT photos FROM posts WHERE user_id=?").all(u.id),
        ...db.prepare("SELECT photos FROM venue_reviews WHERE user_id=?").all(u.id),
        ...db.prepare("SELECT avatar_uri,banner FROM artist_profiles WHERE owner_id=?").all(u.id),
      ].flatMap((value) => {
        if (typeof value === "string") return [value];
        if (value && Object.hasOwn(value, "photos")) return parseJsonArray(value.photos);
        return [value?.avatar_uri, value?.banner].filter(Boolean);
      });

      // Bootstrap any trusted pre-ledger associations, then queue the complete
      // owner ledger. That second step is what catches a successful direct
      // upload that never became a post/profile after a lost response or an
      // abandoned composer. Both writes are inside this account transaction and
      // survive the user/content cascades below.
      enqueueOwnedMediaUrls(db, { ownerId: u.id, urls: authoredMediaUrls, at: now() });
      enqueueAllOwnedMedia(db, { ownerId: u.id, at: now() });
      enqueueOwnerMediaSweep(db, { ownerId: u.id, at: now() });
      eraseLegacyMediaFinalizeDescriptors(db, { ownerId: u.id, at: now() });
      db.prepare(`DELETE FROM media_reactions
        WHERE post_id IN (SELECT id FROM posts WHERE user_id=?) OR instr(media_url, ?) > 0`)
        .run(u.id, `users/${encodeURIComponent(u.id)}/`);
      const deleteReactionForUrl = db.prepare("DELETE FROM media_reactions WHERE media_url=?");
      for (const mediaUrl of new Set(authoredMediaUrls)) deleteReactionForUrl.run(mediaUrl);

      // The moderation ledger intentionally contains ids and bounded state JSON.
      // There is no documented retention basis after account erasure, so delete
      // actions performed by this account and actions about its reports/content.
      db.prepare(`DELETE FROM moderation_actions WHERE target_type='report'
        AND target_id IN (SELECT id FROM reports WHERE ${accountReportWhere})`).run(...accountReportParams);
      db.prepare(`DELETE FROM moderation_actions WHERE actor_id=?
        OR (target_type='user' AND target_id=?)
        OR (target_type='post' AND target_id IN (SELECT id FROM posts WHERE user_id=?))
        OR (target_type='comment' AND target_id IN (SELECT id FROM comments WHERE user_id=?))
        OR (target_type='message' AND target_id IN (SELECT id FROM dms WHERE from_id=? OR to_id=?))
        OR (target_type='fan_message' AND target_id IN (SELECT id FROM fan_club_messages WHERE user_id=?))
        OR (target_type='lounge_message' AND target_id IN (SELECT id FROM lounge_messages WHERE user_id=?))
        OR (target_type='venue_review' AND target_id IN (SELECT id FROM venue_reviews WHERE user_id=?))
        OR (target_type='artist_post' AND target_id IN (SELECT id FROM artist_posts WHERE user_id=?))
        OR (target_type='artist_profile' AND target_id IN (SELECT artist_key FROM artist_profiles WHERE owner_id=?))`)
        .run(u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id, u.id);

      // Campaign queues/logs deliberately have no user FK. Clear both identity
      // columns because old rows may have only one of them populated, and ensure
      // no already-queued campaign can send after the account is gone.
      db.prepare("DELETE FROM email_queue WHERE user_id=? OR lower(to_email)=lower(?)").run(u.id, u.email);
      db.prepare("DELETE FROM email_log WHERE user_id=? OR lower(to_email)=lower(?)").run(u.id, u.email);

      // Durable staff-created artifacts survive their creator, but must no longer
      // identify the erased account. Badge grant notes are author-entered, so the
      // attribution and note are removed together.
      db.prepare("UPDATE custom_badges SET created_by=NULL WHERE created_by=?").run(u.id);
      db.prepare("UPDATE user_badges SET granted_by=NULL,note='' WHERE granted_by=?").run(u.id);
      db.prepare("UPDATE track_overrides SET set_by=NULL WHERE set_by=?").run(u.id);
      db.prepare("UPDATE track_source_overrides SET set_by=NULL WHERE set_by=?").run(u.id);
      db.prepare("UPDATE email_templates SET updated_by=NULL WHERE updated_by=?").run(u.id);
      db.prepare("UPDATE email_campaigns SET created_by=NULL WHERE created_by=?").run(u.id);

      // These relationships use ON DELETE SET NULL so shared rows can normally
      // survive account changes. Deletion is a privacy erasure, so remove the
      // account's authored/attributable records instead of leaving them behind.
      db.prepare("DELETE FROM notifications WHERE actor_id=?").run(u.id);
      db.prepare("DELETE FROM events WHERE user_id=?").run(u.id);
      db.prepare(`DELETE FROM reports WHERE ${accountReportWhere}`).run(...accountReportParams);
      db.prepare("DELETE FROM artist_posts WHERE user_id=?").run(u.id);
      db.prepare("DELETE FROM artist_profiles WHERE owner_id=?").run(u.id);
      // Structured post tags are JSON rather than foreign-key rows, so account
      // erasure must explicitly remove this id from posts authored by others.
      scrubTaggedUserFromPosts(u.id);
      db.prepare("DELETE FROM users WHERE id=?").run(u.id);
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
    ctx.clearSession?.();
    return { ok: true };
  },

  // ---- authoritative tour dates (provider imports + artist/admin batches) ----
  "GET /api/discovery/sidebar": (ctx) => discoverySidebar(ctx.user),

  "GET /api/tourdates": (ctx) => {
    // The legacy client snapshot is upcoming-only. Historical truth now lives
    // in the artist archive; letting expired provider rows consume this bounded
    // 5,000-row window would hide current worldwide dates as coverage grows.
    const today = new Date(now()).toISOString().slice(0, 10);
    const rows = visibleTourDateRows(ctx.user, { today });
    return {
      tourDates: rows.map(tourDateJson),
    };
  },

  "POST /api/tourdates": (ctx) => {
    const user = requireUser(ctx);
    limit(ctx, "tour-date-batch", 20, 60 * 60 * 1000);
    const batch = cleanTourDateBatch(ctx, user);
    const writtenAt = now();
    const source = user.role === "artist" ? "artist-submitted" : "admin-submitted";
    const rows = atomicWrite(() => batch.dates.map((entry) => {
      const existing = db.prepare(`SELECT id FROM tour_dates
        WHERE owner_id=? AND lower(artist)=lower(?) AND lower(venue)=lower(?)
          AND lower(place)=lower(?) AND date=? LIMIT 1`)
        .get(user.id, batch.artist, entry.venue, entry.place, entry.date);
      const updatedAt = Math.max(writtenAt, Date.parse(`${entry.date}T00:00:00.000Z`) || writtenAt);
      const id = existing?.id || uid("td");
      if (existing) {
        db.prepare(`UPDATE tour_dates SET artist=?,venue=?,place=?,lat=NULL,lng=NULL,ticket_url=?,sold_out=0,
          source=?,updated_at=?,release_at=? WHERE id=? AND owner_id=?`)
          .run(batch.artist, entry.venue, entry.place, entry.ticketUrl, source, updatedAt, batch.releaseAt, id, user.id);
      } else {
        db.prepare(`INSERT INTO tour_dates
          (id,artist,venue,place,lat,lng,date,ticket_url,sold_out,source,updated_at,owner_id,release_at)
          VALUES (?,?,?,?,NULL,NULL,?,?,0,?,?,?,?)`)
          .run(id, batch.artist, entry.venue, entry.place, entry.date, entry.ticketUrl, source, updatedAt, user.id, batch.releaseAt);
      }
      return db.prepare("SELECT * FROM tour_dates WHERE id=?").get(id);
    }));
    return { tourDates: rows.map(tourDateJson) };
  },

  // ---- feed / posts ----
  "GET /api/feed": (ctx) => {
    const { cursor, limit: lim } = pageRequest(ctx, 30, 100);
    const requestedOffset = Number(ctx.query?.offset);
    const off = !cursor && Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? Math.min(requestedOffset, 1_000_000) : 0;
    const viewer = ctx.user?.id;
    const blockSql = viewer ? `AND NOT EXISTS (
      SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)
    )` : "";
    const cursorSql = cursor ? "AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : "";
    const args = [];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    if (viewer) args.push(viewer, viewer);
    args.push(lim + 1);
    if (!cursor) args.push(off);
    // Moderators see which cards carry open reports right on the feed, so
    // flagged content is visible in context instead of only in the queue.
    const staff = accountIsPublic(ctx.user) && (ctx.user.role === "admin" || ctx.user.role === "moderator");
    const flagSql = staff ? `, (SELECT COUNT(*) FROM reports r WHERE r.target_type = 'post' AND r.target_id = p.id AND r.status = 'open') AS open_reports` : "";
    const found = db.prepare(`
      SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
        u.role AS u_role,u.artist_name AS u_artist_name,
        (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id WHERE l.post_id=p.id AND ${activeAccountSql("lu")}) AS like_count,
        (SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.user_id
          WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("cu")}) AS comment_count,
        ${SEEN_ORDINAL_SQL}${flagSql}
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.removed=0 AND ${activeAccountSql("u")} ${cursorSql} ${blockSql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?${cursor ? "" : " OFFSET ?"}`).all(...args);
    const { rows, nextCursor } = finishPage(found, lim);
    const projectedRows = withTaggedPeople(withCommentPreviews(rows, viewer), viewer);
    return { posts: projectedRows.map((p) => postJson(p, viewer)), nextCursor };
  },

  // Global-first For You feed. A bounded worldwide candidate pool is scored for
  // freshness, engagement, completeness and diversity before small explainable
  // account-taste boosts are applied. Pagination points at an immutable in-memory
  // snapshot, so new posts and changing like counts cannot duplicate or reorder
  // cards halfway through a scroll. The legacy chronological route above stays
  // available to old clients and as the new client's outage fallback.
  "GET /api/feed/for-you": (ctx) => {
    limit(ctx, "for-you-feed", 180, 10 * 60 * 1000);
    const requested = Number(ctx.query?.limit);
    const pageSize = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 50) : 20;
    const result = recommendedFeedPage({
      viewer: ctx.user || null,
      cursor: ctx.query?.cursor || null,
      limit: pageSize,
      at: now(),
    });
    const projectedRows = withTaggedPeople(withCommentPreviews(result.rows, ctx.user?.id), ctx.user?.id);
    const projected = projectedRows.map((row) => ({
      ...postJson(row, ctx.user?.id),
      recommendation: result.recommendations.get(row.id),
    }));
    return { posts: projected, nextCursor: result.nextCursor, algorithm: result.algorithm };
  },

  // A ranked snapshot deliberately does not change under the user's feet, but
  // moderation, account restrictions, two-way blocks, and exact-post feed
  // preferences are immediate safety state. Revalidate the bounded local cache
  // without reranking or resetting its cursor; the client removes tombstones.
  "POST /api/feed/revalidate": (ctx) => {
    limit(ctx, "feed-revalidate", 120, 10 * 60 * 1000);
    const requested = Array.isArray(ctx.body?.postIds) ? ctx.body.postIds : [];
    const postIds = [...new Set(requested
      .filter((id) => typeof id === "string" && /^p_[A-Za-z0-9_-]{1,77}$/.test(id))
      .slice(0, 200))];
    if (!postIds.length) return { invalidPostIds: [] };
    const placeholders = postIds.map(() => "?").join(",");
    const blockSql = ctx.user?.id ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))` : "";
    const preferenceSql = ctx.user?.id
      ? "AND NOT EXISTS (SELECT 1 FROM recommendation_preferences rp WHERE rp.user_id=? AND rp.post_id=p.id)"
      : "";
    const args = [...postIds, now()];
    if (ctx.user?.id) args.push(ctx.user.id, ctx.user.id, ctx.user.id);
    const live = new Set(db.prepare(`SELECT p.id FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.id IN (${placeholders}) AND p.removed=0 AND u.is_banned=0
        AND (u.suspended_until IS NULL OR u.suspended_until<=?)
        ${blockSql} ${preferenceSql}`).all(...args).map((row) => row.id));
    return { invalidPostIds: postIds.filter((id) => !live.has(id)) };
  },

  "POST /api/feed/preferences/:postId": (ctx) => {
    const user = requireUser(ctx);
    limit(ctx, "recommendation-preference", 120, 10 * 60 * 1000);
    const postId = clean(ctx.params.postId, { max: 100 });
    const post = db.prepare("SELECT id,user_id,removed FROM posts WHERE id=?").get(postId);
    if (!post || post.removed || blockedEitherWay(user.id, post.user_id)) {
      throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
    }
    const action = clean(ctx.body?.action, { max: 30 });
    if (action !== "not_interested" && action !== "hide") {
      throw new ApiError(400, "Choose a supported feed preference.", "VALIDATION_FAILED");
    }
    db.prepare(`INSERT INTO recommendation_preferences (user_id,post_id,action,created_at)
      VALUES (?,?,?,?) ON CONFLICT(user_id,post_id) DO UPDATE SET action=excluded.action,created_at=excluded.created_at`)
      .run(user.id, postId, action, now());
    return { ok: true, postId, action };
  },

  "GET /api/feed/preferences": (ctx) => {
    const user = requireUser(ctx);
    limit(ctx, "recommendation-preferences-read", 120, 10 * 60 * 1000);
    return {
      hiddenPostIds: db.prepare(`SELECT post_id FROM recommendation_preferences
        WHERE user_id=? ORDER BY created_at DESC LIMIT 500`).all(user.id).map((row) => row.post_id),
    };
  },

  "DELETE /api/feed/preferences/:postId": (ctx) => {
    const user = requireUser(ctx);
    limit(ctx, "recommendation-preference-undo", 120, 10 * 60 * 1000);
    const postId = clean(ctx.params.postId, { max: 100 });
    db.prepare("DELETE FROM recommendation_preferences WHERE user_id=? AND post_id=?").run(user.id, postId);
    return { ok: true, postId };
  },

  // Canonical single-post read. Besides powering direct links, this is the
  // authority a client can consult after an ambiguous PATCH response: if every
  // intended field is already present, the save committed even though the
  // response was lost. Removed and blocked content stays indistinguishable from
  // a missing post.
  "GET /api/posts/:id": (ctx) => {
    const row = feedPostById.get(ctx.params.id);
    if (!row || row.removed || blockedEitherWay(ctx.user?.id, row.user_id)) {
      throw new ApiError(404, "That post left the stage.", "NOT_FOUND");
    }
    const projected = withTaggedPeople(withCommentPreviews([row], ctx.user?.id), ctx.user?.id)[0];
    return { post: postJson(projected, ctx.user?.id) };
  },

  "GET /api/posts/:id/playlist": (ctx) => {
    const row = db.prepare("SELECT user_id,playlist,removed FROM posts WHERE id=?").get(ctx.params.id);
    if (!row || row.removed || !row.playlist || !publicAccountOrNull(row.user_id) || blockedEitherWay(ctx.user?.id, row.user_id)) {
      throw new ApiError(404, "That shared playlist isn't available.", "NOT_FOUND");
    }
    let playlist = null;
    try { playlist = JSON.parse(row.playlist); } catch {}
    if (!playlist?.id || !Array.isArray(playlist.tracks)) throw new ApiError(404, "That shared playlist isn't available.", "NOT_FOUND");
    return { playlist: { ...playlist, tracks: cleanPlaylistTracks(playlist.tracks) || [] } };
  },

  // Clips reel: the same posts as the feed, but only the ones carrying a video,
  // newest first, for the vertical swipe-through mode. Each row keeps its full
  // post projection (so likes/comments/artist all work) plus a `clips` array of
  // just the video URLs. Blocks respected; same (created_at,id) cursor as feed.
  "GET /api/clips": (ctx) => {
    const { cursor, limit: lim } = pageRequest(ctx, 12, 30);
    const viewer = ctx.user?.id;
    const blockSql = viewer ? `AND NOT EXISTS (
      SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?)
    )` : "";
    // A cheap prefilter in SQL (photos JSON mentions a video extension); the
    // authoritative per-URL check happens in JS below. Because the prefilter can
    // deliberately over-match (for example `photo.jpg?campaign=.mp4-bait`), it
    // must never define the public page boundary. Continue through raw candidate
    // batches until we have one extra real clip or have exhausted the reel.
    const findCandidates = (before, batchLimit) => {
      const cursorSql = before ? "AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : "";
      const args = [];
      if (before) args.push(before.createdAt, before.createdAt, before.id);
      if (viewer) args.push(viewer, viewer);
      args.push(batchLimit);
      return db.prepare(`
        SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
          u.role AS u_role,u.artist_name AS u_artist_name,
          EXISTS (SELECT 1 FROM post_media pm JOIN media_assets ma ON ma.id=pm.asset_id
            WHERE pm.post_id=p.id AND ma.kind='video') AS has_stable_video,
          (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id WHERE l.post_id=p.id AND ${activeAccountSql("lu")}) AS like_count,
          (SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.user_id
            WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("cu")}) AS comment_count,
          ${SEEN_ORDINAL_SQL}
        FROM posts p JOIN users u ON u.id = p.user_id
        WHERE p.removed=0 AND p.photos_public=1 AND ${activeAccountSql("u")}
          AND (p.photos LIKE '%.mp4%' OR p.photos LIKE '%.webm%' OR p.photos LIKE '%.mov%' OR p.photos LIKE '%.m4v%'
            OR EXISTS (SELECT 1 FROM post_media pm JOIN media_assets ma ON ma.id=pm.asset_id
              WHERE pm.post_id=p.id AND ma.kind='video'))
          ${cursorSql} ${blockSql}
        ORDER BY p.created_at DESC, p.id DESC LIMIT ?`).all(...args);
    };
    const candidatesPerScan = Math.max(lim + 1, 32);
    const authoritative = [];
    let scanCursor = cursor;
    while (authoritative.length <= lim) {
      const found = findCandidates(scanCursor, candidatesPerScan);
      if (!found.length) break;
      // Reject cheap SQL false positives before running comment/media/reaction
      // projection. Otherwise a page of bait URLs can force several synchronous
      // DB lookups per row even though none can ever enter the reel.
      const plausible = found.filter((row) => row.has_stable_video
        || parseJsonArray(row.photos).some((uri) => isLegacyVideoUrl(uri)));
      const projectedCandidates = withTaggedPeople(withCommentPreviews(plausible, viewer), viewer);
      for (const p of projectedCandidates) {
        const projected = postJson(p, viewer); // photos already parsed here
        const descriptorClips = new Set((projected.media || [])
          .filter((asset) => asset?.kind === "video" && typeof asset.url === "string")
          .map((asset) => asset.url));
        const clips = (projected.photos || []).filter((uri) => descriptorClips.has(uri) || isLegacyVideoUrl(uri));
        if (clips.length) authoritative.push({ row: p, clip: { ...projected, clips } });
        if (authoritative.length > lim) break;
      }
      if (authoritative.length > lim || found.length < candidatesPerScan) break;
      const last = found.at(-1);
      scanCursor = { createdAt: last.created_at, id: last.id };
    }
    const hasMore = authoritative.length > lim;
    const page = hasMore ? authoritative.slice(0, lim) : authoritative;
    const clips = page.map(({ clip }) => clip);
    const nextCursor = hasMore && page.length ? encodeCursor(page.at(-1).row) : null;
    return { clips, nextCursor };
  },

  "GET /api/users/:id/posts": (ctx) => {
    if (ctx.user?.id !== ctx.params.id && blockedEitherWay(ctx.user?.id, ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    if (!publicAccountOrNull(ctx.params.id)) throw new ApiError(404, "This profile isn't available.", "NOT_FOUND");
    // Shipped clients called this endpoint without pagination and received the
    // newest 100 posts. Preserve that compatibility window; current clients
    // explicitly request 30 and page with the new cursor contract (capped 50).
    const legacyUnpaged = ctx.query?.limit == null && !ctx.query?.before;
    const { cursor, limit: pageLimit } = legacyUnpaged
      ? { cursor: null, limit: 100 }
      : pageRequest(ctx, 30, 50);
    const cursorSql = cursor ? "AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))" : "";
    const args = [ctx.params.id];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    args.push(pageLimit + 1);
    const found = db.prepare(`
      SELECT p.*, u.name AS u_name, u.handle AS u_handle, u.initials AS u_initials, u.avatar_uri AS u_avatar, u.avatar_color AS u_color,
        u.role AS u_role,u.artist_name AS u_artist_name,
        (SELECT COUNT(*) FROM likes l JOIN users lu ON lu.id=l.user_id WHERE l.post_id=p.id AND ${activeAccountSql("lu")}) AS like_count,
        (SELECT COUNT(*) FROM comments c JOIN users cu ON cu.id=c.user_id
          WHERE c.post_id=p.id AND c.removed=0 AND ${activeAccountSql("cu")}) AS comment_count,
        ${SEEN_ORDINAL_SQL}
      FROM posts p JOIN users u ON u.id = p.user_id
      WHERE p.removed = 0 AND p.user_id = ? ${cursorSql}
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, pageLimit);
    return {
      posts: withTaggedPeople(withCommentPreviews(rows, ctx.user?.id), ctx.user?.id)
        .map((p) => postJson(p, ctx.user?.id)),
      nextCursor,
    };
  },

  "POST /api/posts": (ctx) => {
    const u = requireUser(ctx);
    const mutationId = clientMutationId(ctx.body?.clientMutationId);
    const existing = mutationId ? postByClientMutation.get(u.id, mutationId) : null;
    if (existing?.removed) {
      // A retry token identifies one logical create forever. Returning its
      // soft-deleted payload makes removed or moderated content appear to have
      // published again on the originating device.
      throw new ApiError(409, "That post was already removed. Start a new post to publish again.", "POST_REMOVED");
    }
    const stored = existing ? feedPostById.get(existing.id) : null;
    const request = canonicalCreateRequest(u, ctx.body, stored);
    const mutationHash = mutationId ? postMutationHash(request.canonical) : null;
    if (existing) {
      const storedHash = stored ? postMutationHash(canonicalStoredPost(stored)) : null;
      if (!storedHash || storedHash !== mutationHash) {
        throw new ApiError(409, "That retry belongs to an earlier version of this post. Reopen it before publishing your new changes.", "POST_MUTATION_CONFLICT");
      }
      // Rows created before canonical hashing may contain a raw-payload hash or
      // NULL. Heal only after proving the stored post means exactly the same
      // thing as this request; never guess that a missing hash implies success.
      if (existing.client_mutation_hash !== mutationHash) {
        db.prepare("UPDATE posts SET client_mutation_hash=? WHERE id=? AND user_id=?").run(mutationHash, existing.id, u.id);
      }
      return { id: existing.id, post: postJson(feedPostById.get(existing.id), u.id), duplicate: true };
    }
    limit(ctx, "post", 20, 60 * 60 * 1000);

    // A plain status/update ("post whatever", not a concert review) shares the
    // posts table so it keeps the same feed, likes, comments, and moderation.
    if (request.kind === "status") {
      const v = request.values;
      if (v.campaign) limit(ctx, "artist-campaign", 2, 24 * 60 * 60 * 1000);
      const id = uid("p");
      atomicWrite(() => {
        // Re-read consent/account/block state while holding SQLite's write lock.
        // The earlier validation shapes a friendly response quickly; this one
        // closes the gap before the durable post + notification write.
        const transactionTaggedUserIds = validatedPostTaggedUserIds(u, v.taggedUserIds);
        assertPostTagRecipientBudget(u.id, transactionTaggedUserIds);
        postRow.run(id, u.id, "", "", "", "", 0, null, null,
          "{}", v.review, JSON.stringify(v.photos), v.photosPublic, 0, v.campaign ? JSON.stringify(v.campaign) : null, "[]", null,
          "[]", JSON.stringify(transactionTaggedUserIds), "status", v.song ? JSON.stringify(v.song) : null, v.playlist ? JSON.stringify(v.playlist) : null, null, null, null, mutationId, mutationHash, now());
        markOwnedMediaAssociated(db, { ownerId: u.id, urls: v.photos, at: now() });
        if (v.mediaSelection) attachPostMedia(db, { postId: id, ownerId: u.id, selection: v.mediaSelection, at: now() });
        addPostTagNotifications(transactionTaggedUserIds, u.id, id);
      });
      return { id, post: postJson(feedPostById.get(id), u.id) };
    }

    const v = request.values;
    const id = uid("p");
    atomicWrite(() => {
      const transactionTaggedUserIds = validatedPostTaggedUserIds(u, v.taggedUserIds);
      assertPostTagRecipientBudget(u.id, transactionTaggedUserIds);
      postRow.run(id, u.id, v.artist, v.venue, v.city, v.date, v.overall, v.band, v.room,
        JSON.stringify(v.dims), v.review, JSON.stringify(v.photos), v.photosPublic, v.landingShowcase, null, JSON.stringify(v.setlist), v.tour,
        JSON.stringify(v.tags), JSON.stringify(transactionTaggedUserIds), "review", v.song ? JSON.stringify(v.song) : null, null,
        v.binding.artist_key, v.binding.artist_mbid, venueBinding(v.venue), mutationId, mutationHash, now());
      markOwnedMediaAssociated(db, { ownerId: u.id, urls: v.photos, at: now() });
      if (v.mediaSelection) attachPostMedia(db, { postId: id, ownerId: u.id, selection: v.mediaSelection, at: now() });
      addPostTagNotifications(transactionTaggedUserIds, u.id, id, v.artist);
    });
    return { id, post: postJson(feedPostById.get(id), u.id) };
  },

  "PATCH /api/posts/:id": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "post-edit", 60, 60 * 60 * 1000);
    const current = db.prepare("SELECT * FROM posts WHERE id=? AND removed=0").get(ctx.params.id);
    if (!current) throw new ApiError(404, "That post left the stage. Refresh the feed and try again.", "NOT_FOUND");
    // Author-only, deliberately including admins: a review is someone's own
    // words, and moderation removes content, it never rewrites it.
    if (current.user_id !== u.id) {
      throw new ApiError(403, "Only the person who posted this review can edit it.", "FORBIDDEN");
    }

    const body = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
    const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
    const editable = ["artist", "artistKey", "venue", "city", "date", "overall", "band", "room", "dims", "review", "photos", "mediaAssetIds", "photosPublic", "landingShowcase", "setlist", "tour", "tags", "taggedUserIds", "song", "playlistId", "campaign"];
    if (!editable.some(has)) throw new ApiError(400, "Make a change before saving this post.", "VALIDATION_FAILED");

    // Optimistic concurrency prevents two devices (or an old open edit sheet)
    // from silently overwriting one another. Older clients may omit `version`,
    // while current clients always send the server projection's version.
    const currentVersion = current.updated_at || current.created_at;
    if (has("version")) {
      const expected = Number(body.version);
      if (!Number.isSafeInteger(expected) || expected < 0) throw new ApiError(400, "That post version is invalid. Refresh and try again.", "VALIDATION_FAILED");
      if (expected !== currentVersion) throw new ApiError(409, "This review changed on another screen. Refresh before saving again.", "CONFLICT");
    }

    const next = { ...current };
    const previousTaggedUserIds = storedPostTaggedUserIds(current.tagged_user_ids);
    const textField = (key, max, { required = false, newlines = false } = {}) => {
      if (!has(key)) return;
      if (typeof body[key] !== "string") throw new ApiError(400, `${key} is invalid`, "VALIDATION_FAILED");
      const value = clean(body[key], { max, newlines });
      if (required && !value) throw new ApiError(400, `${key} is required`, "VALIDATION_FAILED");
      next[key] = value;
    };
    const ratingField = (key, { required = false } = {}) => {
      if (!has(key)) return;
      if (body[key] === null && !required) { next[key] = null; return; }
      const numeric = Number(body[key]);
      if (!Number.isFinite(numeric)) throw new ApiError(400, `${key} is invalid`, "VALIDATION_FAILED");
      const value = clampRating(numeric);
      if (required && value <= 0) throw new ApiError(400, `${key} is required`, "VALIDATION_FAILED");
      next[key] = value;
    };

    textField("artist", LIMITS.artist, { required: true });
    textField("venue", LIMITS.venue, { required: true });
    textField("city", LIMITS.city);
    // Stored ISO, same as create. A post still holding a legacy display-format
    // or mangled date is repaired by this rather than rejected, since the value
    // canonicalizes to the night it always meant. "" clears the field, which is
    // a normal edit.
    if (has("date")) {
      if (typeof body.date !== "string") throw new ApiError(400, "date is invalid", "VALIDATION_FAILED");
      const raw = clean(body.date, { max: LIMITS.date });
      const value = raw ? cleanDate(raw) : "";
      if (raw && !value) throw new ApiError(400, "date is invalid", "VALIDATION_FAILED");
      next.date = value;
    }
    textField("review", LIMITS.review, { newlines: true });
    if (has("review")) assertSafeAuthoredText(next.review, { field: current.kind === "status" ? "post" : "review" });
    ratingField("overall", { required: true });
    ratingField("band");
    ratingField("room");
    if (has("dims")) {
      const dims = cleanPostRatingDims(body.dims);
      if (!dims) throw new ApiError(400, "dims is invalid", "VALIDATION_FAILED");
      next.dims = JSON.stringify(dims);
    }

    let editedMediaSelection = null;
    if (has("mediaAssetIds")) {
      const ids = cleanMediaAssetIds(body.mediaAssetIds, { optional: false });
      editedMediaSelection = mediaSelection(db, { ownerId: u.id, assetIds: ids, currentPostId: current.id });
      if (has("photos")) {
        if (!Array.isArray(body.photos) || body.photos.some((item) => typeof item !== "string")) {
          throw new ApiError(400, "photos is invalid", "VALIDATION_FAILED");
        }
        assertPhotosMatchSelection(cleanStringArray(body.photos, { maxItems: MEDIA_POST_MAX_ATTACHMENTS, maxLen: 2000 }), editedMediaSelection);
      }
      next.photos = JSON.stringify(editedMediaSelection.photos);
    }
    if (has("photos") && !has("mediaAssetIds")) {
      if (!Array.isArray(body.photos) || body.photos.some((item) => typeof item !== "string")) throw new ApiError(400, "photos is invalid", "VALIDATION_FAILED");
      const legacyPhotos = cleanStringArray(body.photos, { maxItems: MEDIA_POST_MAX_ATTACHMENTS, maxLen: 2000 });
      rejectNewLegacyMediaUrls(legacyPhotos, parseJsonArray(current.photos));
      next.photos = JSON.stringify(legacyPhotos);
    }
    if (has("photosPublic")) {
      if (typeof body.photosPublic === "boolean") next.photos_public = body.photosPublic ? 1 : 0;
      else if (body.photosPublic === 0 || body.photosPublic === 1) next.photos_public = body.photosPublic;
      else throw new ApiError(400, "photosPublic is invalid", "VALIDATION_FAILED");
    }
    if (has("landingShowcase")) {
      if (typeof body.landingShowcase === "boolean") next.landing_showcase = body.landingShowcase ? 1 : 0;
      else if (body.landingShowcase === 0 || body.landingShowcase === 1) next.landing_showcase = body.landingShowcase;
      else throw new ApiError(400, "landingShowcase is invalid", "VALIDATION_FAILED");
    }
    if (has("setlist")) {
      if (!Array.isArray(body.setlist) || body.setlist.some((item) => typeof item !== "string")) throw new ApiError(400, "setlist is invalid", "VALIDATION_FAILED");
      next.setlist = JSON.stringify(cleanStringArray(body.setlist, { maxItems: 40, maxLen: 120 }));
    }
    if (has("tour")) {
      if (body.tour !== null && typeof body.tour !== "string") throw new ApiError(400, "tour is invalid", "VALIDATION_FAILED");
      next.tour = body.tour === null ? null : clean(body.tour, { max: 80 }) || null;
    }
    if (has("tags")) {
      const tags = cleanPostTags(body.tags);
      if (!tags) throw new ApiError(400, "tags is invalid", "VALIDATION_FAILED");
      next.tags = JSON.stringify(tags);
    }
    if (has("taggedUserIds")) {
      next.tagged_user_ids = JSON.stringify(validatedPostTaggedUserIds(u, body.taggedUserIds, {
        committedIds: previousTaggedUserIds,
        postId: current.id,
      }));
    }
    if (has("song")) {
      // null clears the tag; anything present must be a valid YouTube link.
      const song = cleanSong(body.song);
      if (song === undefined) throw new ApiError(400, "song is invalid", "VALIDATION_FAILED");
      next.song = song ? JSON.stringify(song) : null;
    }
    if (has("playlistId")) {
      if (current.kind !== "status") throw new ApiError(400, "Playlists can only be attached to regular posts.", "VALIDATION_FAILED");
      let currentSnapshot = null;
      try { currentSnapshot = current.playlist ? JSON.parse(current.playlist) : null; } catch {}
      const playlist = playlistSnapshotForPost(u, body.playlistId, currentSnapshot);
      next.playlist = playlist ? JSON.stringify(playlist) : null;
    }

    let editedSong = null;
    if (has("song") && next.song) {
      try { editedSong = JSON.parse(next.song); } catch {}
    }
    assertSafeAuthoredFields({
      artist: has("artist") ? next.artist : undefined,
      venue: has("venue") ? next.venue : undefined,
      city: has("city") ? next.city : undefined,
      review: has("review") ? next.review : undefined,
      "setlist entry": has("setlist") ? cleanStringArray(body.setlist, { maxItems: 40, maxLen: 120 }) : undefined,
      tour: has("tour") ? next.tour : undefined,
      tag: has("tags") ? cleanPostTags(body.tags) : undefined,
      "tagged song title": editedSong?.title,
      "tagged song artist": editedSong?.artist,
    });

    let storedPhotos = [];
    try { storedPhotos = JSON.parse(next.photos || "[]"); } catch {}
    // Privacy wins if a forged/older client submits contradictory toggles. A
    // standalone showcase opt-in makes ordinary photo sharing public, while an
    // explicit public-off edit immediately clears homepage eligibility.
    if (current.kind === "status" || !storedPhotos.length || (has("photosPublic") && !next.photos_public)) {
      next.landing_showcase = 0;
    } else if (has("landingShowcase") && next.landing_showcase) {
      next.photos_public = 1;
    }
    if (next.landing_showcase && !hasTrustedLandingImage(storedPhotos, {
      authorId: u.id,
      mediaBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL,
    })) {
      next.landing_showcase = 0;
    }

    if (current.kind === "status") {
      if (!next.review && !storedPhotos.length && !next.song && !next.playlist) {
        throw new ApiError(400, "Keep some text, media, a tagged song, or a playlist in this post.", "VALIDATION_FAILED");
      }
    }

    const editedAt = Math.max(now(), currentVersion + 1);
    const previousPhotos = parseJsonArray(current.photos);
    const removedPhotos = previousPhotos.filter((value) => !storedPhotos.includes(value));
    // An older client may edit a post that already has stable media while only
    // sending the legacy URL array. Preserve any linked assets whose publish URL
    // is still present and detach only the ones it actually removed.
    if (!has("mediaAssetIds") && has("photos") && postMediaAssetIds(db, current.id).length) {
      const retainedIds = assetIdsMatchingPostPhotos(db, { postId: current.id, photos: storedPhotos });
      editedMediaSelection = mediaSelection(db, { ownerId: u.id, assetIds: retainedIds, currentPostId: current.id });
    }
    const availableCampaignMedia = editedMediaSelection
      ? artistCampaignMediaRows(editedMediaSelection)
      : currentPostCampaignMediaRows(current.id, u.id);
    if (has("campaign")) {
      if (current.kind !== "status") {
        throw new ApiError(400, "Artist drops can only style regular feed posts.", "VALIDATION_FAILED");
      }
      const currentCampaign = normalizeArtistCampaign(parsedStoredObject(current.campaign));
      const campaign = cleanArtistCampaign(body.campaign, {
        user: u,
        mediaRows: availableCampaignMedia,
        committedCampaign: currentCampaign,
      });
      if (!currentCampaign && campaign) limit(ctx, "artist-campaign", 2, 24 * 60 * 60 * 1000);
      next.campaign = campaign ? JSON.stringify(campaign) : null;
    } else if (current.kind === "status") {
      const campaign = normalizeArtistCampaign(parsedStoredObject(current.campaign));
      const currentArtistKey = u.role === "artist" ? normName(u.artist_name) : null;
      if (campaign && (!currentArtistKey || currentArtistKey !== normName(campaign.artistKey))) {
        // An old client does not know to submit `campaign:null`. Treat any
        // ordinary edit after role/name revocation as the point where the stale
        // capability is durably removed instead of letting rewritten copy keep
        // official presentation metadata.
        next.campaign = null;
      } else if (campaign?.backgroundAssetId && !availableCampaignMedia.some((row) => row.id === campaign.backgroundAssetId && row.kind === "image")) {
        // A legacy client may remove the background without knowing about the
        // campaign field. Keep the still-authorized treatment, but never retain
        // a dangling asset reference or let it bypass post_media deletion.
        const { backgroundAssetId: _removedBackground, ...fallback } = campaign;
        next.campaign = JSON.stringify(fallback);
      }
    }
    // Re-resolve the binding on every edit: renaming the artist must move the
    // review to that artist's page, and retyping it as free text must drop the
    // binding rather than leave the post pointing at the previous entity.
    const editBinding = current.kind === "status"
      ? { artist_key: null, artist_mbid: null }
      : resolveArtistBinding(next.artist, has("artistKey") ? body.artistKey : current.artist_key);
    const nextTaggedUserIds = storedPostTaggedUserIds(next.tagged_user_ids);
    atomicWrite(() => {
      const transactionCurrent = db.prepare(`SELECT tagged_user_ids,COALESCE(updated_at,created_at) AS version
        FROM posts WHERE id=? AND user_id=? AND removed=0`).get(current.id, u.id);
      if (!transactionCurrent || transactionCurrent.version !== currentVersion) {
        throw new ApiError(409, "This review changed on another screen. Refresh before saving again.", "CONFLICT");
      }
      const transactionCommittedIds = storedPostTaggedUserIds(transactionCurrent.tagged_user_ids);
      const transactionCommittedIdSet = new Set(transactionCommittedIds);
      // An unrelated edit must preserve the in-lock tag set, not the stale
      // pre-transaction snapshot. Only an explicit tag edit can add ids.
      const transactionRequestedIds = has("taggedUserIds") ? nextTaggedUserIds : transactionCommittedIds;
      const transactionTaggedUserIds = validatedPostTaggedUserIds(u, transactionRequestedIds, {
        committedIds: transactionCommittedIds,
        postId: current.id,
      });
      const transactionNewlyTaggedUserIds = transactionTaggedUserIds.filter((id) => !transactionCommittedIdSet.has(id));
      assertPostTagRecipientBudget(u.id, transactionNewlyTaggedUserIds, { postId: current.id });
      const updated = db.prepare(`UPDATE posts SET artist=?,venue=?,city=?,date=?,overall=?,band=?,room=?,dims=?,review=?,photos=?,photos_public=?,landing_showcase=?,campaign=?,setlist=?,tour=?,tags=?,tagged_user_ids=?,song=?,playlist=?,artist_key=?,artist_mbid=?,venue_key=?,updated_at=?
        WHERE id=? AND user_id=? AND removed=0 AND COALESCE(updated_at,created_at)=?`)
        .run(next.artist, next.venue, next.city, next.date, next.overall, next.band, next.room, next.dims, next.review, next.photos, next.photos_public, next.landing_showcase, next.campaign, next.setlist, next.tour, next.tags, JSON.stringify(transactionTaggedUserIds), next.song, next.playlist,
          editBinding.artist_key, editBinding.artist_mbid, current.kind === "status" ? null : venueBinding(next.venue), editedAt, current.id, u.id, currentVersion);
      if (Number(updated.changes || 0) !== 1) {
        throw new ApiError(409, "This review changed on another screen. Refresh before saving again.", "CONFLICT");
      }
      addPostTagNotifications(transactionNewlyTaggedUserIds, u.id, current.id, current.kind === "status" ? null : next.artist);
      retireLegacyVideoPosters(db, {
        postId: current.id,
        ownerId: u.id,
        mediaUrls: removedPhotos,
        at: now(),
      });
      markOwnedMediaAssociated(db, { ownerId: u.id, urls: storedPhotos, at: now() });
      let detachedAssetObjects = [];
      let detachedAssetIds = [];
      if (editedMediaSelection) {
        detachedAssetIds = replacePostMedia(db, {
          postId: current.id,
          ownerId: u.id,
          selection: editedMediaSelection,
          at: now(),
        });
        detachedAssetObjects = assetObjectRecords(db, detachedAssetIds);
      }
      const deletable = unreferencedOwnedMediaUrls(db, { ownerId: u.id, urls: removedPhotos });
      enqueueOwnedMediaUrls(db, { ownerId: u.id, urls: deletable, at: now() });
      const detachedAssetUrls = detachedAssetObjects.map((object) => object.publicUrl);
      const deletableAssetUrls = unreferencedOwnedMediaUrls(db, { ownerId: u.id, urls: detachedAssetUrls });
      const deletableAssetUrlSet = new Set(deletableAssetUrls);
      const detachedAssetKeys = detachedAssetObjects
        .filter((object) => deletableAssetUrlSet.has(object.publicUrl)).map((object) => object.objectKey);
      const queuedDetachedAssets = enqueueOwnedMediaKeys(db, {
        ownerId: u.id,
        keys: detachedAssetKeys,
        at: now(),
      });
      if (queuedDetachedAssets.accepted !== new Set(detachedAssetKeys).size) {
        throw new ApiError(409, "That media changed while it was being removed. Refresh and try again.", "CONFLICT");
      }
      // The stable descriptor no longer belongs to this post. Remove it even if
      // an old URL-only post still references one rendition; the object ledger
      // retains that still-referenced object while unused source/variants queue.
      deleteMediaAssets(db, detachedAssetIds);
      const deleteReaction = db.prepare("DELETE FROM media_reactions WHERE media_url=?");
      for (const mediaUrl of new Set([...deletable, ...deletableAssetUrls])) deleteReaction.run(mediaUrl);
    });
    return { post: postJson(feedPostById.get(current.id), u.id) };
  },

  "POST /api/posts/:id/like": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "like", 120, 10 * 60 * 1000);
    const targetPost = db.prepare("SELECT user_id,artist FROM posts WHERE id=? AND removed=0").get(ctx.params.id);
    if (!targetPost || !publicAccountOrNull(targetPost.user_id)) throw new ApiError(404, "No such post.");
    if (blockedEitherWay(u.id, targetPost.user_id)) throw new ApiError(403, "This interaction isn't available.", "FORBIDDEN");
    const has = !!db.prepare("SELECT 1 FROM likes WHERE post_id=? AND user_id=?").get(ctx.params.id, u.id);
    const liked = desiredState(ctx.body, "liked", has);
    if (!liked && has) db.prepare("DELETE FROM likes WHERE post_id=? AND user_id=?").run(ctx.params.id, u.id);
    else if (liked && !has) {
      db.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run(ctx.params.id, u.id);
      addNotif(targetPost.user_id, u.id, "like", { postId: ctx.params.id, artist: targetPost.artist });
    }
    return { liked };
  },

  // Delete your own post. Soft delete (removed=1), the same mechanism moderation
  // uses, so the row survives for audit and its comments keep their foreign key.
  // Author-only: an admin removing content goes through the moderation route,
  // which records a different action. A mismatched owner is deliberately
  // indistinguishable from a missing row, so deletion is not a probe for who
  // posted what.
  "DELETE /api/posts/:id": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "post-delete", 60, 60 * 60 * 1000);
    const post = db.prepare("SELECT id,user_id,photos,removed FROM posts WHERE id=?").get(ctx.params.id);
    if (!post || post.user_id !== u.id) throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
    const attached = parseJsonArray(post.photos);
    const stableAssetIds = postMediaAssetIds(db, post.id);
    const stableAssetObjects = assetObjectRecords(db, stableAssetIds);
    const stableAssetUrls = stableAssetObjects.map((object) => object.publicUrl);
    atomicWrite(() => {
        // Author deletion is irreversible content deletion, unlike a moderator's
        // reversible soft hide. Keep only the row identity/ownership/timestamps
        // required for foreign keys and the audit trail; authored copy, entity
        // bindings, ratings, media and request fingerprints are scrubbed.
        db.prepare(`UPDATE posts SET removed=1,artist='',venue='',city='',date='',overall=0,
          band=NULL,room=NULL,dims='{}',review='',photos='[]',photos_public=0,landing_showcase=0,campaign=NULL,
          setlist='[]',tour=NULL,tags='[]',tagged_user_ids='[]',song=NULL,playlist=NULL,artist_key=NULL,artist_mbid=NULL,
          venue_key=NULL,client_mutation_id=NULL,client_mutation_hash=NULL,updated_at=?
          WHERE id=? AND user_id=?`).run(now(), post.id, u.id);
        retireLegacyVideoPosters(db, { postId: post.id, ownerId: u.id, at: now() });
        const deletable = unreferencedOwnedMediaUrls(db, { ownerId: u.id, urls: attached });
        enqueueOwnedMediaUrls(db, { ownerId: u.id, urls: deletable, at: now() });
        const deletableAssetUrls = unreferencedOwnedMediaUrls(db, { ownerId: u.id, urls: stableAssetUrls });
        const deletableAssetUrlSet = new Set(deletableAssetUrls);
        const stableAssetKeys = stableAssetObjects
          .filter((object) => deletableAssetUrlSet.has(object.publicUrl)).map((object) => object.objectKey);
        const queuedStableAssets = enqueueOwnedMediaKeys(db, {
          ownerId: u.id,
          keys: stableAssetKeys,
          at: now(),
        });
        if (queuedStableAssets.accepted !== new Set(stableAssetKeys).size) {
          throw new ApiError(409, "That media changed while it was being removed. Refresh and try again.", "CONFLICT");
        }
        db.prepare("DELETE FROM post_media WHERE post_id=?").run(post.id);
        deleteMediaAssets(db, stableAssetIds);
        const deleteReaction = db.prepare("DELETE FROM media_reactions WHERE media_url=?");
        for (const mediaUrl of new Set([...deletable, ...deletableAssetUrls])) deleteReaction.run(mediaUrl);
        if (!post.removed) moderationRecord(ctx, "delete", "post", post.id, "author deleted", { removed: false }, { removed: true });
    });
    return { ok: true, id: post.id };
  },

  "GET /api/posts/:id/comments": (ctx) => {
    const post = db.prepare("SELECT user_id,removed FROM posts WHERE id=?").get(ctx.params.id);
    if (!post || post.removed || !publicAccountOrNull(post.user_id)) throw new ApiError(404, "That post is no longer available.", "NOT_FOUND");
    if (ctx.user?.id && blockedEitherWay(ctx.user.id, post.user_id)) {
      throw new ApiError(403, "This conversation isn't available.", "FORBIDDEN");
    }
    const { cursor, limit } = pageRequest(ctx, 400, 400);
    const viewerId = ctx.user?.id || null;
    const blockSql = viewerId
      ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
           (b.blocker_id=? AND b.blocked_id=c.user_id) OR
           (b.blocker_id=c.user_id AND b.blocked_id=?))`
      : "";
    const cursorSql = cursor ? "AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))" : "";
    const args = [ctx.params.id];
    if (viewerId) args.push(viewerId, viewerId);
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    args.push(limit + 1);
    const found = db.prepare(`SELECT c.*, u.name, u.initials, u.avatar_uri, u.avatar_color, u.role, u.verified FROM comments c JOIN users u ON u.id=c.user_id
                             WHERE c.post_id=? AND c.removed=0 AND ${activeAccountSql("u")} ${blockSql} ${cursorSql}
                             ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    // A page can contain a reply whose parent is older than the page. Pull a
    // bounded ancestor chain so the client never promotes that reply to a fake
    // top-level comment. Removed ancestors are projected as content-free
    // tombstones; leaf deletions disappear entirely.
    const hidden = blockedIdSet(viewerId);
    const byId = new Map(rows.map((comment) => [comment.id, comment]));
    let pending = rows.map((comment) => comment.parent_id).filter(Boolean);
    for (let depth = 0; depth < 6 && pending.length; depth++) {
      const ids = [...new Set(pending.filter((id) => !byId.has(id)))].slice(0, 100);
      if (!ids.length) break;
      const placeholders = ids.map(() => "?").join(",");
      const parents = db.prepare(`SELECT c.*,u.name,u.initials,u.avatar_uri,u.avatar_color,u.role,u.verified,u.is_banned,u.suspended_until
        FROM comments c JOIN users u ON u.id=c.user_id
        WHERE c.post_id=? AND c.id IN (${placeholders})`).all(ctx.params.id, ...ids);
      pending = [];
      for (const parent of parents) {
        if (hidden.has(parent.user_id)) continue;
        if (!accountIsPublic(parent)) parent.removed = 1;
        byId.set(parent.id, parent);
        if (parent.parent_id) pending.push(parent.parent_id);
      }
    }
    const comments = [...byId.values()]
      .sort((a, b) => a.created_at - b.created_at || String(a.id).localeCompare(String(b.id)))
      .map((c) => c.removed ? {
        id: c.id, userId: null, name: null, initials: null, avatarUri: null,
        avatarColor: null, role: null, verified: false, text: "", deleted: true,
        parentId: c.parent_id || null, createdAt: c.created_at,
      } : {
        id: c.id, userId: c.user_id, name: c.name, initials: c.initials,
        avatarUri: safePublicProfileImage(c.user_id, c.avatar_uri), avatarColor: c.avatar_color, role: c.role,
        verified: !!c.verified, text: c.text, deleted: false,
        parentId: c.parent_id || null, createdAt: c.created_at,
      });
    const removedIds = db.prepare("SELECT id FROM comments WHERE post_id=? AND removed=1 ORDER BY created_at DESC LIMIT 500")
      .all(ctx.params.id).map((row) => row.id);
    return { comments, nextCursor, removedIds };
  },

  "POST /api/posts/:id/comments": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "comment", 60, 60 * 60 * 1000);
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!text) throw new ApiError(400, "Say something first.");
    assertSafeAuthoredText(text, { field: "comment" });
    const targetPost = db.prepare("SELECT user_id,artist FROM posts WHERE id=? AND removed=0").get(ctx.params.id);
    if (!targetPost || !publicAccountOrNull(targetPost.user_id)) throw new ApiError(404, "No such post.");
    if (blockedEitherWay(u.id, targetPost.user_id)) throw new ApiError(403, "This interaction isn't available.", "FORBIDDEN");
    // A reply must point at a real comment on THIS post; ignore anything else.
    let parentId = clean(ctx.body?.parentId, { max: 60 }) || null;
    const parent = parentId ? db.prepare("SELECT user_id FROM comments WHERE id=? AND post_id=? AND removed=0").get(parentId, ctx.params.id) : null;
    if (parentId && !parent) parentId = null;
    if (parent && blockedEitherWay(u.id, parent.user_id)) throw new ApiError(403, "This reply isn't available.", "FORBIDDEN");
    const id = uid("c");
    db.prepare("INSERT INTO comments (id,post_id,user_id,text,parent_id,created_at) VALUES (?,?,?,?,?,?)").run(id, ctx.params.id, u.id, text, parentId, now());
    const p = db.prepare("SELECT user_id, artist FROM posts WHERE id=?").get(ctx.params.id);
    if (p) addNotif(p.user_id, u.id, "comment", { postId: ctx.params.id, artist: p.artist, text: text.slice(0, 80) });
    // Also ping the parent comment's author (if it's someone else) so replies notify.
    if (parentId) { const pc = db.prepare("SELECT user_id FROM comments WHERE id=?").get(parentId); if (pc && pc.user_id !== (p && p.user_id)) addNotif(pc.user_id, u.id, "comment", { postId: ctx.params.id, artist: p?.artist, text: text.slice(0, 80) }); }
    return { id, parentId };
  },

  // Members can retract only their own comment. Keep replies from other people:
  // the read route emits a blank tombstone when children still need this parent.
  // A mismatched owner is deliberately indistinguishable from a missing row.
  "DELETE /api/posts/:postId/comments/:id": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "comment-delete", 60, 60 * 60 * 1000);
    const comment = db.prepare("SELECT id,post_id,user_id,removed FROM comments WHERE id=? AND post_id=?")
      .get(ctx.params.id, ctx.params.postId);
    if (!comment || comment.user_id !== u.id) throw new ApiError(404, "That comment is no longer available.", "NOT_FOUND");
    if (!comment.removed) db.prepare("UPDATE comments SET removed=1 WHERE id=? AND post_id=? AND user_id=?").run(comment.id, comment.post_id, u.id);
    const hasReplies = !!db.prepare("SELECT 1 FROM comments WHERE post_id=? AND parent_id=? AND removed=0 LIMIT 1")
      .get(comment.post_id, comment.id);
    return { ok: true, id: comment.id, postId: comment.post_id, tombstone: hasReplies };
  },

  // ---- direct messages (SQLite migration slice 4) ----
  // Every user I've DM'd + that thread's messages. At prototype scale returning
  // all messages is cheap and lets the client compute the Requests/Friends split
  // and unread exactly as it does locally (read markers stay client-side).
  "GET /api/me/threads": (ctx) => {
    const u = requireUser(ctx);
    const hidden = blockedIdSet(u.id);
    const readProjection = directMessageReadProjection(db, u.id);
    // Inbox refreshes need only one latest message per conversation. A windowed
    // query avoids downloading up to 500 messages for every thread every time the
    // inbox is opened or refreshed, while the full route remains for hydration.
    if (String(ctx.query?.summary || "") === "1") {
      const latest = db.prepare(`SELECT id,from_id,to_id,text,created_at,other_id FROM (
        SELECT id,from_id,to_id,text,created_at,
          CASE WHEN from_id=? THEN to_id ELSE from_id END AS other_id,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN from_id=? THEN to_id ELSE from_id END
            ORDER BY created_at DESC,id DESC
          ) AS row_number
        FROM dms WHERE removed=0 AND (from_id=? OR to_id=?)
      ) WHERE row_number=1 ORDER BY created_at DESC,id DESC LIMIT 200`).all(u.id, u.id, u.id, u.id);
      return { threads: latest.filter((message) => !hidden.has(message.other_id)).map((message) => {
        const other = q.userById.get(message.other_id);
        return other ? {
          otherId: message.other_id,
          otherUser: publicUser(other),
          messages: [{ id: message.id, from: message.from_id, text: message.text, createdAt: message.created_at }],
          ...readProjection.forOther(message.other_id),
        } : null;
      }).filter(Boolean), removedIds: removedDmIdsFor(u.id) };
    }
    const others = db.prepare(`SELECT DISTINCT CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other
                               FROM dms WHERE removed=0 AND (from_id = ? OR to_id = ?)`).all(u.id, u.id, u.id);
    const threads = others.map((o) => {
      if (hidden.has(o.other)) return null; // blocked conversations disappear
      const other = q.userById.get(o.other);
      if (!other) return null;
      const msgs = db.prepare(`SELECT id, from_id, text, created_at FROM dms
        WHERE removed=0 AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) ORDER BY created_at DESC, id DESC LIMIT 500`)
        .all(u.id, o.other, o.other, u.id);
      return {
        otherId: o.other,
        otherUser: publicUser(other),
        messages: msgs.reverse().map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })),
        ...readProjection.forOther(o.other),
      };
    }).filter(Boolean);
    return { threads, removedIds: removedDmIdsFor(u.id) };
  },

  "GET /api/dms/:otherId": (ctx) => {
    const u = requireUser(ctx);
    const other = ctx.params.otherId;
    if (blockedEitherWay(u.id, other)) throw new ApiError(403, "This conversation isn't available.", "FORBIDDEN");
    const { cursor, limit } = pageRequest(ctx, 500, 500);
    const after = decodeCursor(ctx.query?.after);
    if (cursor && after) throw new ApiError(400, "Use either before or after, not both.", "VALIDATION_FAILED");

    // Live-chat polling walks forward from the newest row the client has seen.
    // Keep the existing `before` cursor untouched for loading older history.
    if (after) {
      const found = db.prepare(`SELECT id, from_id, text, created_at FROM dms
        WHERE removed=0 AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))
          AND (created_at > ? OR (created_at = ? AND id > ?))
        ORDER BY created_at ASC, id ASC LIMIT ?`)
        .all(u.id, other, other, u.id, after.createdAt, after.createdAt, after.id, limit + 1);
      const hasMore = found.length > limit;
      const rows = hasMore ? found.slice(0, limit) : found;
      return {
        messages: rows.map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })),
        nextCursor: null,
        syncCursor: rows.length ? encodeCursor(rows.at(-1)) : String(ctx.query.after),
        hasMore,
        removedIds: removedDmIdsFor(u.id, other),
      };
    }

    const cursorSql = cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : "";
    const args = [u.id, other, other, u.id];
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    args.push(limit + 1);
    const found = db.prepare(`SELECT id, from_id, text, created_at FROM dms
      WHERE removed=0 AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) ${cursorSql} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    const syncCursor = !cursor && rows.length ? encodeCursor(rows[0]) : null;
    return { messages: rows.reverse().map((m) => ({ id: m.id, from: m.from_id, text: m.text, createdAt: m.created_at })), nextCursor, syncCursor, hasMore: false, removedIds: removedDmIdsFor(u.id, other) };
  },

  "POST /api/dms/:otherId": (ctx) => {
    const u = requireUser(ctx);
    const other = ctx.params.otherId;
    if (other === u.id) throw new ApiError(400, "You can't message yourself.");
    if (!q.userById.get(other)) throw new ApiError(404, "No such user.");
    if (blockedEitherWay(u.id, other)) throw new ApiError(403, "You can't message this account.");
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!text) throw new ApiError(400, "Say something first.");
    assertSafeAuthoredText(text, { field: "message" });
    const mutationId = chatClientMutationId(ctx.body?.clientMutationId);
    const existing = mutationId
      ? db.prepare("SELECT id,to_id,text,removed FROM dms WHERE from_id=? AND client_mutation_id=? LIMIT 1").get(u.id, mutationId)
      : null;
    if (existing) {
      assertChatRetryMatches(existing, { to_id: other, text });
      return { id: existing.id, duplicate: true };
    }
    limit(ctx, "dm", 120, 10 * 60 * 1000);
    const id = uid("dm");
    if (mutationId) {
      const inserted = db.prepare("INSERT OR IGNORE INTO dms (id,from_id,to_id,text,client_mutation_id,created_at) VALUES (?,?,?,?,?,?)")
        .run(id, u.id, other, text, mutationId, now());
      if (!inserted.changes) {
        const raced = db.prepare("SELECT id,to_id,text,removed FROM dms WHERE from_id=? AND client_mutation_id=? LIMIT 1")
          .get(u.id, mutationId);
        assertChatRetryMatches(raced, { to_id: other, text });
        if (raced) return { id: raced.id, duplicate: true };
        throw new ApiError(409, "That message could not be reconciled. Refresh and try again.", "CONFLICT");
      }
    } else {
      db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)").run(id, u.id, other, text, now());
    }
    addNotif(other, u.id, "dm", { postId: id, text: text.slice(0, 80) });
    return { id };
  },

  // ---- notifications / activity (server-backed) ----
  "GET /api/me/notifications": (ctx) => {
    const u = requireUser(ctx);
    const hidden = blockedIdSet(u.id);
    const { cursor, limit } = pageRequest(ctx, 100, 100);
    const cursorSql = cursor ? "AND (n.created_at < ? OR (n.created_at = ? AND n.id < ?))" : "";
    const args = cursor ? [u.id, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [u.id, limit + 1];
    const found = db.prepare(`
      SELECT n.*, a.name AS actor_name, a.initials AS actor_initials, a.avatar_uri AS actor_uri, a.avatar_color AS actor_color
      FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      WHERE n.user_id = ? ${cursorSql} ORDER BY n.created_at DESC, n.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    return {
      notifications: rows.filter((n) => !n.actor_id || !hidden.has(n.actor_id)).map((n) => ({
        id: n.id, type: n.type, actorId: n.actor_id,
        actorName: n.actor_name || "Someone", actorInitials: n.actor_initials || "?",
        actorUri: safePublicProfileImage(n.actor_id, n.actor_uri), actorColor: n.actor_color,
        postId: n.post_id, artist: n.artist, text: n.text,
        ts: n.created_at, read: !!n.read,
      })),
      unread: db.prepare(`SELECT COUNT(*) c FROM notifications n WHERE n.user_id=? AND n.read=0
        AND (n.actor_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM blocks b WHERE (b.blocker_id=n.user_id AND b.blocked_id=n.actor_id) OR (b.blocker_id=n.actor_id AND b.blocked_id=n.user_id)
        ))`).get(u.id).c,
      nextCursor,
    };
  },

  "POST /api/me/notifications/read": (ctx) => {
    const u = requireUser(ctx);
    db.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND read=0").run(u.id);
    return { ok: true };
  },

  // ---- fan clubs (SQLite migration slice 5) ----
  // The artists this account is a member of, lets the client hydrate membership
  // (join-button state + counts) on login. Names are stored lowercased.
  "GET /api/me/fanclubs": (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare("SELECT artist FROM fan_club_members WHERE user_id = ?").all(u.id);
    return { artists: rows.map((r) => r.artist) };
  },

  // Public aggregate directory. Membership rows and non-removed messages are
  // the authority; no client-local social graph is used for counts.
  "GET /api/fanclubs": (ctx) => {
    limit(ctx, "fanclub-directory", 120, 10 * 60 * 1000);
    const found = db.prepare(`WITH active_clubs AS (
        SELECT members.artist FROM fan_club_members members JOIN users member_user ON member_user.id=members.user_id
          WHERE ${activeAccountSql("member_user")}
        UNION
        SELECT messages.artist FROM fan_club_messages messages JOIN users message_user ON message_user.id=messages.user_id
          WHERE messages.removed=0 AND ${activeAccountSql("message_user")}
      )
      SELECT active_clubs.artist,
        (SELECT COUNT(*) FROM fan_club_members members JOIN users member_user ON member_user.id=members.user_id
          WHERE members.artist=active_clubs.artist AND ${activeAccountSql("member_user")}) members,
        (SELECT COUNT(*) FROM fan_club_messages messages JOIN users message_user ON message_user.id=messages.user_id
          WHERE messages.artist=active_clubs.artist AND messages.removed=0 AND ${activeAccountSql("message_user")}) messages,
        COUNT(*) OVER() total_count
      FROM active_clubs
      ORDER BY members DESC,messages DESC,active_clubs.artist COLLATE NOCASE LIMIT 200`).all();
    const total = Number(found[0]?.total_count) || 0;
    const clubs = found.map(({ total_count: _totalCount, ...club }) => club);
    return { clubs, total };
  },

  "POST /api/fanclubs/:artist/join": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "fanclub", 60, 10 * 60 * 1000);
    const artist = decodedPathParam(ctx, "artist", { max: LIMITS.artist, label: "artist link" }).toLowerCase();
    if (!artist) throw new ApiError(400, "Bad artist.");
    const has = !!db.prepare("SELECT 1 FROM fan_club_members WHERE artist=? AND user_id=?").get(artist, u.id);
    const joined = desiredState(ctx.body, "joined", has);
    if (!joined && has) db.prepare("DELETE FROM fan_club_members WHERE artist=? AND user_id=?").run(artist, u.id);
    else if (joined && !has) db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(artist, u.id);
    return { member: joined, joined };
  },

  // The gate only needs aggregate counts. Keep that lightweight metadata public
  // without exposing message bodies to people who have not joined the club.
  "GET /api/fanclubs/:artist/meta": (ctx) => {
    const artist = decodedPathParam(ctx, "artist", { max: LIMITS.artist, label: "artist link" }).toLowerCase();
    if (!artist) throw new ApiError(400, "Bad artist.", "VALIDATION_FAILED");
    const members = db.prepare(`SELECT COUNT(*) c FROM fan_club_members m JOIN users u ON u.id=m.user_id
      WHERE m.artist=? AND ${activeAccountSql("u")}`).get(artist).c;
    const messageCount = db.prepare(`SELECT COUNT(*) c FROM fan_club_messages m JOIN users u ON u.id=m.user_id
      WHERE m.artist=? AND m.removed=0 AND ${activeAccountSql("u")}`).get(artist).c;
    return { members, messageCount };
  },

  "GET /api/fanclubs/:artist/messages": (ctx) => {
    const u = requireUser(ctx);
    const artist = decodedPathParam(ctx, "artist", { max: LIMITS.artist, label: "artist link" }).toLowerCase();
    if (!artist) throw new ApiError(400, "Bad artist.", "VALIDATION_FAILED");
    const member = db.prepare("SELECT 1 FROM fan_club_members WHERE artist=? AND user_id=?").get(artist, u.id);
    if (!member) throw new ApiError(403, "Join this fan club before opening its conversation.", "FAN_CLUB_MEMBERSHIP_REQUIRED");
    const { cursor, limit } = pageRequest(ctx, 300, 300);
    const after = decodeCursor(ctx.query?.after);
    if (cursor && after) throw new ApiError(400, "Use either before or after, not both.", "VALIDATION_FAILED");
    const members = db.prepare(`SELECT COUNT(*) c FROM fan_club_members m JOIN users member_user ON member_user.id=m.user_id
      WHERE m.artist=? AND ${activeAccountSql("member_user")}`).get(artist).c;
    const removedIds = db.prepare("SELECT id FROM fan_club_messages WHERE artist=? AND removed=1 ORDER BY created_at DESC, id DESC LIMIT 300")
      .all(artist).map((row) => row.id);

    if (after) {
      const found = db.prepare(`SELECT m.*, u.name, u.initials FROM fan_club_messages m JOIN users u ON u.id=m.user_id
                               WHERE m.artist=? AND m.removed=0 AND ${activeAccountSql("u")}
                                 AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                                   (b.blocker_id=? AND b.blocked_id=m.user_id) OR (b.blocker_id=m.user_id AND b.blocked_id=?))
                                 AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
                               ORDER BY m.created_at ASC, m.id ASC LIMIT ?`)
        .all(artist, u.id, u.id, after.createdAt, after.createdAt, after.id, limit + 1);
      const hasMore = found.length > limit;
      const rows = hasMore ? found.slice(0, limit) : found;
      return {
        members,
        messages: rows.map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, text: m.text, createdAt: m.created_at })),
        nextCursor: null,
        syncCursor: rows.length ? encodeCursor(rows.at(-1)) : String(ctx.query.after),
        hasMore,
        removedIds,
      };
    }

    const cursorSql = cursor ? "AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : "";
    const args = cursor ? [artist, u.id, u.id, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [artist, u.id, u.id, limit + 1];
    const found = db.prepare(`SELECT m.*, u.name, u.initials FROM fan_club_messages m JOIN users u ON u.id=m.user_id
                             WHERE m.artist=? AND m.removed=0 AND ${activeAccountSql("u")}
                               AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                                 (b.blocker_id=? AND b.blocked_id=m.user_id) OR (b.blocker_id=m.user_id AND b.blocked_id=?))
                               ${cursorSql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    const syncCursor = !cursor && rows.length ? encodeCursor(rows[0]) : null;
    return { members, messages: rows.reverse().map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, text: m.text, createdAt: m.created_at })), nextCursor, syncCursor, hasMore: false, removedIds };
  },

  "POST /api/fanclubs/:artist/messages": (ctx) => {
    const u = requireUser(ctx);
    const artist = decodedPathParam(ctx, "artist", { max: LIMITS.artist, label: "artist link" }).toLowerCase();
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!artist || !text) throw new ApiError(400, "Say something first.");
    assertSafeAuthoredText(text, { field: "fan-club message" });
    const member = db.prepare("SELECT 1 FROM fan_club_members WHERE artist=? AND user_id=?").get(artist, u.id);
    if (!member) throw new ApiError(403, "Join this fan club before jumping into the conversation.", "FAN_CLUB_MEMBERSHIP_REQUIRED");
    const mutationId = chatClientMutationId(ctx.body?.clientMutationId);
    const existing = mutationId
      ? db.prepare("SELECT id,artist,text,removed FROM fan_club_messages WHERE user_id=? AND client_mutation_id=? LIMIT 1").get(u.id, mutationId)
      : null;
    if (existing) {
      assertChatRetryMatches(existing, { artist, text });
      return { id: existing.id, duplicate: true };
    }
    limit(ctx, "fanmsg", 60, 60 * 60 * 1000);
    const id = uid("fc");
    if (mutationId) {
      const inserted = db.prepare("INSERT OR IGNORE INTO fan_club_messages (id,artist,user_id,text,client_mutation_id,created_at) VALUES (?,?,?,?,?,?)")
        .run(id, artist, u.id, text, mutationId, now());
      if (!inserted.changes) {
        const raced = db.prepare("SELECT id,artist,text,removed FROM fan_club_messages WHERE user_id=? AND client_mutation_id=? LIMIT 1")
          .get(u.id, mutationId);
        assertChatRetryMatches(raced, { artist, text });
        if (raced) return { id: raced.id, duplicate: true };
        throw new ApiError(409, "That message could not be reconciled. Refresh and try again.", "CONFLICT");
      }
    } else {
      db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, artist, u.id, text, now());
    }
    return { id };
  },

  // ---- concert lounge (shared attendee chat, keyed by concertKey) ----
  // The room gate can show activity without making the conversation public.
  "GET /api/lounges/:key/meta": (ctx) => {
    const key = decodedPathParam(ctx, "key", { max: 300, label: "lounge link" }).toLowerCase();
    if (!key) throw new ApiError(400, "Bad lounge.", "VALIDATION_FAILED");
    const attendeeCount = db.prepare(`SELECT COUNT(*) c FROM going g JOIN users u ON u.id=g.user_id
      WHERE g.concert_key=? AND ${activeAccountSql("u")}`).get(key).c;
    const messageCount = db.prepare(`SELECT COUNT(*) c FROM lounge_messages m JOIN users u ON u.id=m.user_id
      WHERE m.lounge_id=? AND m.removed=0 AND ${activeAccountSql("u")}`).get(key).c;
    return { attendeeCount, messageCount };
  },

  "GET /api/lounges/:key/messages": (ctx) => {
    const u = requireUser(ctx);
    const key = decodedPathParam(ctx, "key", { max: 300, label: "lounge link" }).toLowerCase();
    if (!key) throw new ApiError(400, "Bad lounge.", "VALIDATION_FAILED");
    const attendee = showAttendanceRepository.hasAttendeeAccess(u.id, key);
    if (!attendee) throw new ApiError(403, "Join this show's Going list before opening the lounge.", "LOUNGE_ATTENDANCE_REQUIRED");
    const { cursor, limit } = pageRequest(ctx, 300, 300);
    const after = decodeCursor(ctx.query?.after);
    if (cursor && after) throw new ApiError(400, "Use either before or after, not both.", "VALIDATION_FAILED");
    const removedIds = db.prepare("SELECT id FROM lounge_messages WHERE lounge_id=? AND removed=1 ORDER BY created_at DESC, id DESC LIMIT 300")
      .all(key).map((row) => row.id);

    if (after) {
      const found = db.prepare(`SELECT m.*, u.name, u.initials, u.avatar_uri, u.avatar_color, u.role FROM lounge_messages m JOIN users u ON u.id=m.user_id
                               WHERE m.lounge_id=? AND m.removed=0 AND ${activeAccountSql("u")}
                                 AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                                   (b.blocker_id=? AND b.blocked_id=m.user_id) OR (b.blocker_id=m.user_id AND b.blocked_id=?))
                                 AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
                               ORDER BY m.created_at ASC, m.id ASC LIMIT ?`)
        .all(key, u.id, u.id, after.createdAt, after.createdAt, after.id, limit + 1);
      const hasMore = found.length > limit;
      const rows = hasMore ? found.slice(0, limit) : found;
      return {
        messages: rows.map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, avatarUri: safePublicProfileImage(m.user_id, m.avatar_uri), avatarColor: m.avatar_color, role: m.role, text: m.text, createdAt: m.created_at })),
        nextCursor: null,
        syncCursor: rows.length ? encodeCursor(rows.at(-1)) : String(ctx.query.after),
        hasMore,
        removedIds,
      };
    }

    const cursorSql = cursor ? "AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))" : "";
    const args = cursor ? [key, u.id, u.id, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [key, u.id, u.id, limit + 1];
    const found = db.prepare(`SELECT m.*, u.name, u.initials, u.avatar_uri, u.avatar_color, u.role FROM lounge_messages m JOIN users u ON u.id=m.user_id
                             WHERE m.lounge_id=? AND m.removed=0 AND ${activeAccountSql("u")}
                               AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
                                 (b.blocker_id=? AND b.blocked_id=m.user_id) OR (b.blocker_id=m.user_id AND b.blocked_id=?))
                               ${cursorSql} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    const syncCursor = !cursor && rows.length ? encodeCursor(rows[0]) : null;
    return { messages: rows.reverse().map((m) => ({ id: m.id, userId: m.user_id, name: m.name, initials: m.initials, avatarUri: safePublicProfileImage(m.user_id, m.avatar_uri), avatarColor: m.avatar_color, role: m.role, text: m.text, createdAt: m.created_at })), nextCursor, syncCursor, hasMore: false, removedIds };
  },
  "POST /api/lounges/:key/messages": (ctx) => {
    const u = requireUser(ctx);
    const key = decodedPathParam(ctx, "key", { max: 300, label: "lounge link" }).toLowerCase();
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!key || !text) throw new ApiError(400, "Say something first.");
    assertSafeAuthoredText(text, { field: "lounge message" });
    const attendee = showAttendanceRepository.hasAttendeeAccess(u.id, key);
    if (!attendee) throw new ApiError(403, "Join this show's Going list before posting in the lounge.", "LOUNGE_ATTENDANCE_REQUIRED");
    const mutationId = chatClientMutationId(ctx.body?.clientMutationId);
    const existing = mutationId
      ? db.prepare("SELECT id,lounge_id,text,removed FROM lounge_messages WHERE user_id=? AND client_mutation_id=? LIMIT 1").get(u.id, mutationId)
      : null;
    if (existing) {
      assertChatRetryMatches(existing, { lounge_id: key, text });
      return { id: existing.id, duplicate: true };
    }
    limit(ctx, "loungemsg", 90, 60 * 60 * 1000);
    const id = uid("lm");
    if (mutationId) {
      const inserted = db.prepare("INSERT OR IGNORE INTO lounge_messages (id,lounge_id,user_id,text,client_mutation_id,created_at) VALUES (?,?,?,?,?,?)")
        .run(id, key, u.id, text, mutationId, now());
      if (!inserted.changes) {
        const raced = db.prepare("SELECT id,lounge_id,text,removed FROM lounge_messages WHERE user_id=? AND client_mutation_id=? LIMIT 1")
          .get(u.id, mutationId);
        assertChatRetryMatches(raced, { lounge_id: key, text });
        if (raced) return { id: raced.id, duplicate: true };
        throw new ApiError(409, "That message could not be reconciled. Refresh and try again.", "CONFLICT");
      }
    } else {
      db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, key, u.id, text, now());
    }
    return { id };
  },

  // ---- consented first-party product analytics ----
  // Signed-in/opted-in accounts only. The shared taxonomy admits categorical
  // behavior and internal ids, never authored text, searches, messages or media.
  // Current contract: every event carries a client-generated id and retries are
  // idempotent. Keep the old path as a compatibility delegate while clients
  // migrate; it receives the exact same shared allow-list and privacy sanitizer.
  "POST /api/events/batch": (ctx) => analyticsEventsRoute(ctx, { requireIds: true }),
  "POST /api/events": (ctx) => analyticsEventsRoute(ctx, { requireIds: true }),

  // Admin product-health dashboard. Public artist/venue trends come from public
  // posts, while private product events provide aggregate usage/funnel counts.
  "GET /api/admin/analytics": (ctx) => {
    requireAdmin(ctx);
    ctx.setHeader?.("Cache-Control", "no-store");
    const analyticsAt = now();
    const dayAgo = analyticsAt - 24 * 60 * 60 * 1000;
    const weekAgo = analyticsAt - 7 * 24 * 60 * 60 * 1000;
    const monthAgo = analyticsAt - 30 * 24 * 60 * 60 * 1000;
    const one = (sql, ...a) => db.prepare(sql).get(...a);
    const all = (sql, ...a) => db.prepare(sql).all(...a);
    const totals = {
      events: one("SELECT COUNT(*) c FROM events").c,
      events24h: one("SELECT COUNT(*) c FROM events WHERE created_at >= ?", dayAgo).c,
      knownUsers: one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE user_id IS NOT NULL").c,
      users: one("SELECT COUNT(*) c FROM users").c,
      newUsers7d: one("SELECT COUNT(*) c FROM users WHERE created_at >= ?", weekAgo).c,
      activeUsers7d: one("SELECT COUNT(DISTINCT user_id) c FROM events WHERE user_id IS NOT NULL AND created_at >= ?", weekAgo).c,
      posts: one("SELECT COUNT(*) c FROM posts WHERE removed=0").c,
      posts30d: one("SELECT COUNT(*) c FROM posts WHERE removed=0 AND created_at >= ?", monthAgo).c,
    };
    const topBy = (json, name, n = 12, minimum = 1) =>
      all(
        `SELECT json_extract(props, '$.${json}') AS k, COUNT(*) c
         FROM events WHERE name = ? AND json_extract(props, '$.${json}') IS NOT NULL
         GROUP BY k HAVING COUNT(*) >= ? ORDER BY c DESC LIMIT ?`,
        name, minimum, n
      ).map((r) => ({ label: r.k, count: r.c }));

    const signupDays = new Map(all("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) c FROM users WHERE created_at >= ? GROUP BY day", monthAgo).map((row) => [row.day, row.c]));
    const activeDays = new Map(all("SELECT date(created_at/1000,'unixepoch') day,COUNT(DISTINCT user_id) c FROM events WHERE user_id IS NOT NULL AND created_at >= ? GROUP BY day", monthAgo).map((row) => [row.day, row.c]));
    const postDays = new Map(all("SELECT date(created_at/1000,'unixepoch') day,COUNT(*) c FROM posts WHERE removed=0 AND created_at >= ? GROUP BY day", monthAgo).map((row) => [row.day, row.c]));
    const growth = [];
    for (let offset = 29; offset >= 0; offset--) {
      const date = new Date(analyticsAt);
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - offset);
      const day = date.toISOString().slice(0, 10);
      growth.push({ day, signups: signupDays.get(day) || 0, activeUsers: activeDays.get(day) || 0, posts: postDays.get(day) || 0 });
    }

    // Aggregate words across recent PUBLIC posts. Count a term at most once per
    // post and return only k-anonymous trends, never a post/user association.
    const stopWords = new Set(["the", "and", "for", "that", "this", "with", "was", "were", "are", "but", "not", "you", "your", "they", "their", "from", "have", "has", "had", "just", "show", "concert", "really", "very", "into", "out", "all", "our", "its", "it's"]);
    const wordCounts = new Map();
    for (const row of all("SELECT review FROM posts WHERE removed=0 AND created_at >= ? AND length(review) > 0 ORDER BY created_at DESC LIMIT 5000", analyticsAt - 90 * 24 * 60 * 60 * 1000)) {
      const words = new Set(String(row.review || "").toLowerCase().match(/[\p{L}\p{N}']{3,24}/gu) || []);
      for (const word of words) if (!stopWords.has(word) && !/^\d+$/.test(word)) wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
    const postKeywords = [...wordCounts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20).map(([label, count]) => ({ label, count }));
    const guestSearchRows = readGuestSearchAnalytics({ database: db, at: analyticsAt, days: 30 }).rows;
    const utcDay = (offset = 0) => {
      const date = new Date(analyticsAt);
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - offset);
      return date.toISOString().slice(0, 10);
    };
    const today = utcDay();
    const sevenDayStart = utcDay(6);
    const totalSearches = (rows) => rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
    const sevenDayRows = guestSearchRows.filter((row) => row.day >= sevenDayStart);
    const successfulSevenDayRows = sevenDayRows.filter((row) => row.outcome === "success");
    const successfulSevenDayCount = totalSearches(successfulSevenDayRows);
    const zeroSevenDayCount = totalSearches(successfulSevenDayRows.filter((row) => row.resultBucket === "zero"));
    const resultBucketLabels = {
      zero: "0 results",
      one_to_five: "1-5 results",
      six_to_twenty: "6-20 results",
      over_twenty: "21+ results",
    };
    const byResultBucket7d = Object.entries(resultBucketLabels).map(([bucket, label]) => ({
      label,
      count: totalSearches(successfulSevenDayRows.filter((row) => row.resultBucket === bucket)),
    }));
    const guestSearchDaily = [];
    for (let offset = 29; offset >= 0; offset -= 1) {
      const day = utcDay(offset);
      const rows = guestSearchRows.filter((row) => row.day === day);
      guestSearchDaily.push({
        day,
        searches: totalSearches(rows),
        failed: totalSearches(rows.filter((row) => row.outcome === "failed")),
        zeroResults: totalSearches(rows.filter((row) => row.outcome === "success" && row.resultBucket === "zero")),
      });
    }
    const guestSearches = {
      today: totalSearches(guestSearchRows.filter((row) => row.day === today)),
      sevenDays: totalSearches(sevenDayRows),
      thirtyDays: totalSearches(guestSearchRows),
      failed7d: totalSearches(sevenDayRows.filter((row) => row.outcome === "failed")),
      zeroResultRate7d: successfulSevenDayCount ? Math.round((zeroSevenDayCount / successfulSevenDayCount) * 1000) / 10 : 0,
      byResultBucket7d,
      daily: guestSearchDaily,
    };
    const genreActivity = new Map();
    for (const row of all(`SELECT ${ARTIST_GENRE_SQL_COLUMNS},COUNT(*) count
      FROM posts p JOIN artists a ON a.norm=p.artist_key
      WHERE p.removed=0 GROUP BY a.norm`)) {
      const label = projectArtistGenreColumns(row);
      if (!label) continue;
      const key = label.toLocaleLowerCase("en-US");
      const current = genreActivity.get(key) || { label, count: 0 };
      current.count += Number(row.count) || 0;
      genreActivity.set(key, current);
    }
    const topGenres = [...genreActivity.values()]
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 12);
    return {
      totals,
      guestSearches,
      retentionDays: ANALYTICS_RETENTION_DAYS,
      rawEventLimit: ANALYTICS_MAX_RAW_ROWS,
      rawEventLimitPerAccount: ANALYTICS_MAX_ROWS_PER_ACCOUNT,
      rawWindow: one("SELECT COUNT(*) count,MIN(created_at) oldestAt,MAX(created_at) newestAt FROM events"),
      growth,
      byName: all("SELECT name, COUNT(*) c FROM events GROUP BY name ORDER BY c DESC LIMIT 20").map((r) => ({ label: r.name, count: r.c })),
      // Name-level artist/venue/search strings are intentionally no longer part
      // of product analytics. Public-content trends come from authoritative
      // public tables rather than shadow copies of user navigation history.
      topArtists: all(`SELECT artist label,COUNT(*) count FROM posts
        WHERE removed=0 AND length(artist)>0 GROUP BY lower(artist) ORDER BY count DESC,label LIMIT 12`),
      topVenues: all(`SELECT venue label,COUNT(*) count FROM posts
        WHERE removed=0 AND length(venue)>0 GROUP BY lower(venue) ORDER BY count DESC,label LIMIT 12`),
      topGenres,
      topSearches: [],
      postKeywords,
    };
  },

  "GET /api/admin/analytics/users/:id": (ctx) => {
    requireAdmin(ctx);
    const member = q.userById.get(ctx.params.id);
    if (!member) throw new ApiError(404, "That member is no longer available.", "NOT_FOUND");
    const breakdown = db.prepare("SELECT name,COUNT(*) count FROM events WHERE user_id=? GROUP BY name ORDER BY count DESC LIMIT 30").all(member.id);
    return {
      user: publicUser(member),
      totals: {
        events: db.prepare("SELECT COUNT(*) c FROM events WHERE user_id=?").get(member.id).c,
        posts: db.prepare("SELECT COUNT(*) c FROM posts WHERE user_id=? AND removed=0").get(member.id).c,
        comments: db.prepare("SELECT COUNT(*) c FROM comments WHERE user_id=? AND removed=0").get(member.id).c,
        plays: db.prepare("SELECT COUNT(*) c FROM plays WHERE user_id=?").get(member.id).c,
        messagesSent: db.prepare("SELECT COUNT(*) c FROM dms WHERE from_id=?").get(member.id).c,
      },
      byName: breakdown.map((row) => ({ label: row.name, count: row.count })),
    };
  },

  // ---- reports + admin ----
  "POST /api/reports": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "report", 20, 60 * 60 * 1000);
    const [errs, v] = shape(ctx.body, {
      targetType: { required: true, parse: (x) => (REPORTABLE_TARGET_TYPES.has(x) ? x : undefined) },
      targetId: { required: true, parse: (x) => clean(x, { max: 240 }) || undefined },
      reason: { parse: (x) => clean(x, { max: LIMITS.note }) },
      // Optional exact attachment identity. It is verified against the target's
      // stored media. A one-based human hint and a stable SHA-256 fingerprint
      // are persisted; the URL itself is not. Authorized no-store moderation
      // reads project only the exact still-attached, PIT-owned object.
      mediaUri: { parse: (x) => clean(x, { max: 2000 }) || undefined },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const target = reportableTargetFor(u, v.targetType, v.targetId);
    let reason = v.reason || "";
    let mediaIndex = null;
    let mediaFingerprint = null;
    if (v.mediaUri) {
      if (!["post", "venue_review", "artist_profile"].includes(v.targetType)) {
        throw new ApiError(400, "This item does not support attached-media reports.", "VALIDATION_FAILED");
      }
      const media = (Array.isArray(target.photos) ? target.photos : [])
        .map((uri) => clean(uri, { max: 2000 }))
        .filter(Boolean);
      const matchedIndex = media.indexOf(v.mediaUri);
      if (matchedIndex < 0) unavailableReportTarget();
      mediaIndex = matchedIndex + 1;
      mediaFingerprint = createHash("sha256").update(v.mediaUri, "utf8").digest("hex");
      reason = clean(`Specific attached media ${mediaIndex} of ${media.length}. ${reason}`, { max: LIMITS.note });
    }
    const existing = db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type=? AND target_id=? AND status='open'").get(u.id, v.targetType, v.targetId);
    if (existing) return { id: existing.id, targetType: v.targetType, targetId: v.targetId, duplicate: true };
    const id = uid("r");
    db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,media_index,media_fingerprint,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, v.targetType, v.targetId, reason, u.id, mediaIndex, mediaFingerprint, now());
    return { id, targetType: v.targetType, targetId: v.targetId, duplicate: false };
  },

  // Report a song identity or playback failure. Optionally carries the CORRECT
  // link, which a moderator can validate and pin in one action. Lands in the
  // normal moderation queue with a constrained category for useful triage.
  "POST /api/tracks/report": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "track-report", 15, 60 * 60 * 1000);
    const [errs, v] = shape(ctx.body, {
      title: { required: true, parse: (x) => clean(x, { max: 200 }) || undefined },
      artist: { parse: (x) => clean(x, { max: 120 }) },
      category: { parse: (x) => (["wrong_video", "wont_play", "preview_only", "missing", "other"].includes(x) ? x : undefined) },
      url: { parse: (x) => clean(x, { max: 400 }) },
      note: { parse: (x) => clean(x, { max: LIMITS.note }) },
      provider: { parse: (x) => clean(x, { max: 24 }) },
      sourceId: { parse: (x) => clean(String(x ?? ""), { max: 64 }) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const suggestedId = v.url ? parseYouTubeVideoId(v.url) : null;
    if (v.url && !suggestedId) throw new ApiError(400, "That doesn't look like a YouTube link.", "VALIDATION_FAILED");
    const source = cleanTrackRecordingSource(v.provider, v.sourceId, { strict: true });
    const key = source?.key || trackOverrideKey(v.title, v.artist);
    const existing = db.prepare("SELECT id FROM reports WHERE reporter_id=? AND target_type='track' AND target_id=? AND status='open'").get(u.id, key);
    if (existing) return { id: existing.id, duplicate: true };
    const reason = JSON.stringify({
      title: v.title,
      artist: v.artist || "",
      category: v.category || "wrong_video",
      suggestedVideoId: suggestedId,
      note: v.note || "",
      ...(source ? { provider: source.provider, sourceId: source.sourceId } : {}),
    });
    const id = uid("r");
    db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)")
      .run(id, "track", key, reason, u.id, now());
    return { id };
  },

  // Pin the correct video for a song (or "none": confirmed nothing correct is
  // embeddable). Closes every open report on that song and busts the resolver
  // cache, so the fix is heard on the very next play.
  "POST /api/admin/tracks/override": (ctx) => {
    requireModerator(ctx);
    const [errs, v] = shape(ctx.body, {
      title: { required: true, parse: (x) => clean(x, { max: 200 }) || undefined },
      artist: { parse: (x) => clean(x, { max: 120 }) },
      url: { parse: (x) => clean(x, { max: 400 }) },
      none: { parse: (x) => !!x },
      provider: { parse: (x) => clean(x, { max: 24 }) },
      sourceId: { parse: (x) => clean(String(x ?? ""), { max: 64 }) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const videoId = v.none ? null : parseYouTubeVideoId(v.url);
    if (!v.none && !videoId) throw new ApiError(400, "Paste a YouTube link (watch, youtu.be, or shorts).", "VALIDATION_FAILED");
    const source = cleanTrackRecordingSource(v.provider, v.sourceId, { strict: true });
    const key = trackOverrideKey(v.title, v.artist);
    const legacyKey = legacyTrackOverrideKey(v.title, v.artist);
    const moderationKey = source?.key || key;
    if (source) {
      const changedAt = now();
      const existingSource = db.prepare(`SELECT title,artist FROM track_source_overrides
        WHERE provider=? AND source_id=?`).get(source.provider, source.sourceId);
      if (existingSource && !sameTrackOverrideIdentity(existingSource, v.title, v.artist)) {
        throw new ApiError(409, "That provider recording is already bound to different song metadata.", "CONFLICT");
      }
      db.prepare(`INSERT INTO track_source_overrides
        (provider,source_id,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(provider,source_id) DO UPDATE SET
          title=excluded.title,artist=excluded.artist,video_id=excluded.video_id,
          set_by=excluded.set_by,updated_at=excluded.updated_at`)
        .run(source.provider, source.sourceId, v.title, v.artist || "", videoId, ctx.user.id, changedAt);
    } else atomicWrite(() => {
      const changedAt = now();
      db.prepare(`INSERT INTO track_overrides (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET title=excluded.title,artist=excluded.artist,video_id=excluded.video_id,set_by=excluded.set_by,updated_at=excluded.updated_at`)
        .run(key, v.title, v.artist || "", videoId, ctx.user.id, changedAt);
      // Register every v2 identity, including ones that collide under the old
      // ASCII key. More than one link deliberately disables legacy triggers so
      // an old UPSERT that cannot preserve Unicode identity fails closed rather
      // than writing one song's video into another song.
      db.prepare(`INSERT INTO track_override_compat_links (legacy_key,current_key,title,artist)
        VALUES (?,?,?,?) ON CONFLICT(legacy_key,current_key) DO UPDATE SET
          title=excluded.title,artist=excluded.artist`)
        .run(legacyKey, key, v.title, v.artist || "");
      const legacyRow = db.prepare("SELECT key,title,artist FROM track_overrides WHERE key=?").get(legacyKey);
      if (!legacyRow) {
        db.prepare("INSERT INTO track_overrides (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,?,?)")
          .run(legacyKey, v.title, v.artist || "", videoId, ctx.user.id, changedAt);
      } else if (sameTrackOverrideIdentity(legacyRow, v.title, v.artist)) {
        db.prepare("UPDATE track_overrides SET title=?,artist=?,video_id=?,set_by=?,updated_at=? WHERE key=?")
          .run(v.title, v.artist || "", videoId, ctx.user.id, changedAt, legacyKey);
      }
    });
    clearYouTubeTrackCache(v.title, v.artist || "", {
      sourceProvider: source?.provider || "",
      sourceId: source?.sourceId || "",
    });
    if (source) {
      db.prepare("UPDATE reports SET status='actioned' WHERE target_type='track' AND target_id=? AND status='open'")
        .run(source.key);
    } else {
      db.prepare("UPDATE reports SET status='actioned' WHERE target_type='track' AND target_id IN (?,?) AND status='open'")
        .run(key, legacyKey);
    }
    moderationRecord(ctx, "track-override", "track", moderationKey, v.none ? "confirmed no correct video" : `pinned ${videoId}`);
    return { ok: true, videoId, confirmedUnavailable: v.none, provider: source?.provider || null, sourceId: source?.sourceId || null };
  },

  // Every pinned song video, newest first, so the Songs tab shows what's been
  // fixed (and lets a bad pin be removed).
  "GET /api/admin/tracks/overrides": (ctx) => {
    requireModerator(ctx);
    const tupleRows = db.prepare("SELECT key,title,artist,video_id,set_by,updated_at FROM track_overrides WHERE key LIKE 'track:v2:%' ORDER BY updated_at DESC LIMIT 200").all()
      .map((r) => ({ ...r, provider: null, source_id: null }));
    const sourceRows = db.prepare(`SELECT provider,source_id,title,artist,video_id,set_by,updated_at
      FROM track_source_overrides ORDER BY updated_at DESC LIMIT 200`).all()
      .map((r) => ({ ...r, key: trackSourceOverrideKey(r.provider, r.source_id) }));
    const rows = [...tupleRows, ...sourceRows]
      .sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
      .slice(0, 200);
    return { overrides: rows.map((r) => ({ key: r.key, title: r.title, artist: r.artist, videoId: r.video_id, provider: r.provider, sourceId: r.source_id, setBy: r.set_by, updatedAt: r.updated_at })) };
  },

  // Remove a pin: the search resolver takes over again on the next play.
  "DELETE /api/admin/tracks/override": (ctx) => {
    requireModerator(ctx);
    const [errs, v] = shape(ctx.body, {
      title: { required: true, parse: (x) => clean(x, { max: 200 }) || undefined },
      artist: { parse: (x) => clean(x, { max: 120 }) },
      provider: { parse: (x) => clean(x, { max: 24 }) },
      sourceId: { parse: (x) => clean(String(x ?? ""), { max: 64 }) },
    });
    if (errs.length) throw new ApiError(400, errs[0]);
    const source = cleanTrackRecordingSource(v.provider, v.sourceId, { strict: true });
    const key = trackOverrideKey(v.title, v.artist);
    const legacyKey = legacyTrackOverrideKey(v.title, v.artist);
    const moderationKey = source?.key || key;
    if (source) {
      const existingSource = db.prepare(`SELECT title,artist FROM track_source_overrides
        WHERE provider=? AND source_id=?`).get(source.provider, source.sourceId);
      if (existingSource && !sameTrackOverrideIdentity(existingSource, v.title, v.artist)) {
        throw new ApiError(409, "That provider recording is bound to different song metadata.", "CONFLICT");
      }
      db.prepare("DELETE FROM track_source_overrides WHERE provider=? AND source_id=?")
        .run(source.provider, source.sourceId);
    } else atomicWrite(() => {
      db.prepare("DELETE FROM track_overrides WHERE key=?").run(key);
      const legacyRow = db.prepare("SELECT key,title,artist FROM track_overrides WHERE key=?").get(legacyKey);
      if (legacyRow && sameTrackOverrideIdentity(legacyRow, v.title, v.artist)) {
        db.prepare("DELETE FROM track_overrides WHERE key=?").run(legacyKey);
      }
    });
    clearYouTubeTrackCache(v.title, v.artist || "", {
      sourceProvider: source?.provider || "",
      sourceId: source?.sourceId || "",
    });
    moderationRecord(ctx, "track-unpin", "track", moderationKey, "pin removed, resolver takes over");
    return { ok: true };
  },

  "GET /api/admin/reports": (ctx) => {
    requireModerator(ctx);
    ctx.setHeader?.("Cache-Control", "no-store");
    // Compatibility shape for the existing Store/AdminScreen. New staff tools
    // use the normalized overview below; this remains raw snake_case on purpose.
    return { reports: openModerationReports() };
  },

  "POST /api/admin/reports/:id/action": (ctx) => {
    requireModerator(ctx);
    const result = applyModerationAction(ctx, { action: "remove", reportId: clean(ctx.params.id, { max: 60 }) });
    return { ok: true, targetType: result.targetType, targetId: result.targetId };
  },

  // One staff load replaces a raw report list plus per-card content requests.
  // All fields are normalized and privacy-projected inside moderation.js.
  "GET /api/admin/moderation": (ctx) => {
    requireModerator(ctx);
    // Staff identity, reports, restrictions, and recent actions are live private
    // state. Never let a browser or intermediary retain them after sign-out.
    ctx.setHeader?.("Cache-Control", "no-store");
    const { cursor, limit } = pageRequest(ctx, 50, 100);
    return moderationOverview({ cursor, limit, encodeCursor });
  },

  // Desired-state moderation action. A report target is always derived from the
  // stored report, never trusted from the body. Direct remove/restore actions
  // name their bounded content target explicitly.
  "POST /api/admin/moderation/actions": (ctx) => {
    requireModerator(ctx);
    const action = clean(ctx.body?.action, { max: 16 });
    if (!["dismiss", "remove", "restore"].includes(action)) {
      throw new ApiError(400, "action must be dismiss, remove, or restore.", "VALIDATION_FAILED");
    }
    const reportId = clean(ctx.body?.reportId, { max: 60 });
    const targetType = clean(ctx.body?.targetType, { max: 40 });
    const targetId = clean(ctx.body?.targetId, { max: 60 });
    const reason = clean(ctx.body?.reason, { max: LIMITS.note });
    if (reportId) {
      if (targetType || targetId || action === "restore") {
        throw new ApiError(400, "Report actions derive their target and can only dismiss or remove.", "VALIDATION_FAILED");
      }
    } else if (!targetType || !targetId || action === "dismiss") {
      throw new ApiError(400, "Direct content actions require targetType, targetId, and remove or restore.", "VALIDATION_FAILED");
    }
    return applyModerationAction(ctx, { action, reportId, targetType, targetId, reason });
  },

  // ---- Email management -------------------------------------------------
  // Templates are the app's own mail (welcome, password reset); campaigns are
  // admin-composed broadcasts. Both render through server/emails.js and send
  // through the one logged path in server/emailService.js.

  "GET /api/admin/email/overview": (ctx) => {
    requireAdmin(ctx);
    const templates = Object.keys(DEFAULT_TEMPLATES).map((key) => {
      const t = templateFor(key);
      return { key, subject: t.subject, customized: t.customized, editable: t.editable, updatedAt: t.updated_at, updatedBy: t.updated_by };
    });
    return {
      mail: mailDiagnostics(),
      budget: { dailyLimit: dailySendLimit(), sentToday: sentToday(), remainingToday: remainingToday() },
      last7Days: logStatsSince(Date.now() - 7 * 24 * 60 * 60 * 1000),
      audiences: Object.entries(AUDIENCES).map(([key, a]) => ({ key, label: a.label, size: audienceSize(key) })),
      templates,
      campaigns: emailStmts.listCampaigns.all(50),
      tokens: availableTokens(),
      // Whether new signups are being asked to confirm, and how many have. An
      // admin needs to see the kill switch state somewhere, or "verification
      // stopped working" and "verification is switched off" look identical.
      verification: {
        enabled: verificationEnabled(),
        verified: db.prepare("SELECT COUNT(*) c FROM users WHERE email_verified_at > 0").get().c,
        unverified: db.prepare("SELECT COUNT(*) c FROM users WHERE email_verified_at = 0").get().c,
      },
    };
  },

  "GET /api/admin/email/templates/:key": (ctx) => {
    requireAdmin(ctx);
    const t = templateFor(ctx.params.key);
    if (!t || !DEFAULT_TEMPLATES[ctx.params.key]) throw new ApiError(404, "No such template.", "NOT_FOUND");
    return { template: t, default: DEFAULT_TEMPLATES[ctx.params.key], tokens: availableTokens() };
  },

  "PUT /api/admin/email/templates/:key": (ctx) => {
    const actor = requireAdmin(ctx);
    const key = ctx.params.key;
    if (!DEFAULT_TEMPLATES[key]) throw new ApiError(404, "No such template.", "NOT_FOUND");
    if (isCodeOwnedTemplate(key)) throw new ApiError(403, "Security and account templates are code-owned and cannot be edited here.", "FORBIDDEN");
    const subject = clean(ctx.body?.subject, { max: 200 });
    const body = clean(ctx.body?.body, { max: 8000 });
    if (!subject) throw new ApiError(400, "A subject is required.", "VALIDATION_FAILED");
    if (!body) throw new ApiError(400, "A body is required.", "VALIDATION_FAILED");
    const ctaUrl = clean(ctx.body?.ctaUrl, { max: 500 }) || null;
    // A token-bearing CTA can only be checked once it is filled in, so validate
    // the literal form here and let renderEmail drop anything that resolves to a
    // non-http target at send time.
    if (ctaUrl && !ctaUrl.includes("{{") && !safeUrl(ctaUrl)) {
      throw new ApiError(400, "The button link must be a full http or https URL.", "VALIDATION_FAILED");
    }
    emailStmts.upsertTemplate.run({
      key, subject, body,
      cta_label: clean(ctx.body?.ctaLabel, { max: 60 }) || null,
      cta_url: ctaUrl,
      updated_at: now(), updated_by: actor.id,
    });
    return { template: templateFor(key) };
  },

  // Restores the built-in copy by dropping the override row.
  "DELETE /api/admin/email/templates/:key": (ctx) => {
    requireAdmin(ctx);
    if (!DEFAULT_TEMPLATES[ctx.params.key]) throw new ApiError(404, "No such template.", "NOT_FOUND");
    if (isCodeOwnedTemplate(ctx.params.key)) throw new ApiError(403, "Security and account templates are code-owned and cannot be reset here.", "FORBIDDEN");
    emailStmts.deleteTemplate.run(ctx.params.key);
    return { template: templateFor(ctx.params.key) };
  },

  // Renders without sending, so copy can be checked before anyone is mailed.
  "POST /api/admin/email/preview": (ctx) => {
    const actor = requireAdmin(ctx);
    const kind = ctx.body?.kind === "campaign" ? "campaign" : "transactional";
    return {
      preview: renderEmail({
        subject: clean(ctx.body?.subject, { max: 200 }) || "(no subject)",
        body: clean(ctx.body?.body, { max: 8000 }) || "",
        ctaLabel: clean(ctx.body?.ctaLabel, { max: 60 }),
        ctaUrl: clean(ctx.body?.ctaUrl, { max: 500 }),
        kind,
        vars: {
          name: actor.name, handle: actor.handle, origin: publicOrigin(),
          link: `${publicOrigin()}/#reset=EXAMPLE-TOKEN`,
          unsubscribeUrl: `${publicOrigin()}/#unsubscribe=EXAMPLE-TOKEN`,
        },
      }),
    };
  },

  // Test sends always go to the acting admin's own address. Accepting an
  // arbitrary recipient here would turn the admin panel into a relay for
  // sending attacker-authored mail from a verified domain.
  "POST /api/admin/email/templates/:key/test": async (ctx) => {
    const actor = ["owner_approval_requested", "owner_approval_receipt", "site_health_digest"].includes(ctx.params.key)
      ? requireOwner(ctx)
      : requireAdmin(ctx);
    if (!DEFAULT_TEMPLATES[ctx.params.key]) throw new ApiError(404, "No such template.", "NOT_FOUND");
    limit(ctx, "email-test", 20, 60 * 60 * 1000);
    const result = await sendTemplate(ctx.params.key, {
      user: actor,
      vars: { link: `${publicOrigin()}/#reset=EXAMPLE-TOKEN` },
      idempotencyKey: `test-${ctx.params.key}-${Date.now()}`,
    });
    return { sent: result.sent, reason: result.reason, to: actor.email };
  },

  "GET /api/admin/email/campaigns/:id": (ctx) => {
    requireAdmin(ctx);
    const campaign = campaignProgress(ctx.params.id);
    if (!campaign) throw new ApiError(404, "No such campaign.", "NOT_FOUND");
    return { campaign };
  },

  "POST /api/admin/email/campaigns": (ctx) => {
    const actor = requireAdmin(ctx);
    const name = clean(ctx.body?.name, { max: 120 });
    const subject = clean(ctx.body?.subject, { max: 200 });
    const body = clean(ctx.body?.body, { max: 8000 });
    if (!name) throw new ApiError(400, "Give the campaign a name.", "VALIDATION_FAILED");
    if (!subject) throw new ApiError(400, "A subject is required.", "VALIDATION_FAILED");
    if (!body) throw new ApiError(400, "A body is required.", "VALIDATION_FAILED");
    const audience = AUDIENCES[ctx.body?.audience] ? ctx.body.audience : "all";
    const id = uid("cmp");
    const ctaUrl = clean(ctx.body?.ctaUrl, { max: 500 }) || null;
    if (ctaUrl && !ctaUrl.includes("{{") && !safeUrl(ctaUrl)) {
      throw new ApiError(400, "The button URL must be an http or https address.", "VALIDATION_FAILED");
    }
    emailStmts.insertCampaign.run({
      id, name, subject, body,
      cta_label: clean(ctx.body?.ctaLabel, { max: 60 }) || null,
      cta_url: ctaUrl,
      audience, created_by: actor.id, created_at: now(),
    });
    return { campaign: campaignProgress(id) };
  },

  "PATCH /api/admin/email/campaigns/:id": (ctx) => {
    requireAdmin(ctx);
    const existing = emailStmts.campaignById.get(ctx.params.id);
    if (!existing) throw new ApiError(404, "No such campaign.", "NOT_FOUND");
    if (existing.status !== "draft") throw new ApiError(409, "This campaign has already started sending and can no longer be edited.", "CONFLICT");
    const source = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
    const has = (field) => Object.prototype.hasOwnProperty.call(source, field);
    const subject = has("subject") ? clean(source.subject, { max: 200 }) : existing.subject;
    const body = has("body") ? clean(source.body, { max: 8000 }) : existing.body;
    if (!subject) throw new ApiError(400, "A subject is required.", "VALIDATION_FAILED");
    if (!body) throw new ApiError(400, "A body is required.", "VALIDATION_FAILED");
    const ctaUrl = has("ctaUrl") ? (clean(source.ctaUrl, { max: 500 }) || null) : existing.cta_url;
    if (ctaUrl && !ctaUrl.includes("{{") && !safeUrl(ctaUrl)) {
      throw new ApiError(400, "The button URL must be an http or https address.", "VALIDATION_FAILED");
    }
    if (has("audience") && !AUDIENCES[source.audience]) {
      throw new ApiError(400, "Choose a supported campaign audience.", "VALIDATION_FAILED");
    }
    const updated = emailStmts.updateCampaign.run({
      id: existing.id,
      expected_revision: existing.content_revision,
      name: has("name") ? (clean(source.name, { max: 120 }) || existing.name) : existing.name,
      subject, body,
      cta_label: has("ctaLabel") ? (clean(source.ctaLabel, { max: 60 }) || null) : existing.cta_label,
      cta_url: ctaUrl,
      audience: has("audience") ? source.audience : existing.audience,
      updated_at: now(),
    });
    if (updated.changes !== 1) {
      throw new ApiError(409, "This campaign changed or started sending. Refresh it before editing again.", "CONFLICT");
    }
    return { campaign: campaignProgress(existing.id) };
  },

  "POST /api/admin/email/campaigns/:id/test": async (ctx) => {
    const actor = requireAdmin(ctx);
    const campaign = emailStmts.campaignById.get(ctx.params.id);
    if (!campaign) throw new ApiError(404, "No such campaign.", "NOT_FOUND");
    limit(ctx, "email-test", 20, 60 * 60 * 1000);
    const rendered = renderEmail({
      subject: campaign.subject, body: campaign.body,
      ctaLabel: campaign.cta_label, ctaUrl: campaign.cta_url, kind: "campaign",
      vars: { name: actor.name, handle: actor.handle, origin: publicOrigin(), unsubscribeUrl: unsubscribeUrl(actor.id) },
    });
    // force:true so an admin who has opted out of announcements can still test.
    const result = await deliver({
      to: actor.email, userId: actor.id, kind: "campaign", campaignId: campaign.id,
      subject: `[TEST] ${rendered.subject}`, html: rendered.html, text: rendered.text,
      idempotencyKey: `test-${campaign.id}-r${campaign.content_revision}-${Date.now()}`, force: true,
    });
    if (result.sent) {
      const approved = emailStmts.markCampaignTested.run({
        id: campaign.id,
        revision: campaign.content_revision,
        tested_at: now(),
      });
      if (approved.changes !== 1) {
        throw new ApiError(409, "This campaign changed while the test was being delivered. Send a fresh test of the current version.", "CONFLICT");
      }
    }
    return { sent: result.sent, reason: result.reason, to: actor.email };
  },

  // Broadcast. Gated on a successful test send and an explicit confirmation,
  // because there is no recalling this once it leaves.
  "POST /api/admin/email/campaigns/:id/send": async (ctx) => {
    requireAdmin(ctx);
    const campaign = emailStmts.campaignById.get(ctx.params.id);
    if (!campaign) throw new ApiError(404, "No such campaign.", "NOT_FOUND");
    if (campaign.status === "sent") throw new ApiError(409, "This campaign has already been sent.", "CONFLICT");
    if (ctx.body?.confirm !== true) throw new ApiError(422, "Confirmation is required before a broadcast goes out.", "ACTION_REQUIRED");
    const started = startCampaign(campaign.id);
    if (!started.ok) {
      if (started.reason === "test-required") {
        throw new ApiError(422, "Send yourself a test first—or retest the current campaign version—before broadcasting it.", "ACTION_REQUIRED");
      }
      if (started.reason === "revision-conflict") {
        throw new ApiError(409, "This campaign changed while the broadcast was starting. Refresh it and send a fresh test.", "CONFLICT");
      }
      throw new ApiError(409, `Could not start this campaign (${started.reason}).`, "CONFLICT");
    }
    const drained = await drainCampaign(campaign.id, { max: Number(ctx.body?.batch) > 0 ? Math.min(Number(ctx.body.batch), 50) : 25 });
    return { started, drained, campaign: campaignProgress(campaign.id) };
  },

  // Continue a campaign that stopped at the daily cap, a provider error, or a
  // restart. Safe to call repeatedly; already-sent recipients are never redone.
  "POST /api/admin/email/campaigns/:id/resume": async (ctx) => {
    requireAdmin(ctx);
    const campaign = emailStmts.campaignById.get(ctx.params.id);
    if (!campaign) throw new ApiError(404, "No such campaign.", "NOT_FOUND");
    if (campaign.status === "paused") emailStmts.setCampaignStatus.run("sending", now(), campaign.id);
    const drained = await drainCampaign(campaign.id, { max: Number(ctx.body?.batch) > 0 ? Math.min(Number(ctx.body.batch), 50) : 25 });
    return { drained, campaign: campaignProgress(campaign.id) };
  },

  "POST /api/admin/email/campaigns/:id/pause": (ctx) => {
    requireAdmin(ctx);
    const result = pauseCampaign(ctx.params.id);
    if (!result.ok) throw new ApiError(409, `Could not pause this campaign (${result.reason}).`, "CONFLICT");
    return { campaign: campaignProgress(ctx.params.id) };
  },

  "GET /api/admin/email/log": (ctx) => {
    requireAdmin(ctx);
    return {
      entries: recentLog({
        limit: ctx.query?.limit,
        status: ["sent", "failed", "skipped"].includes(ctx.query?.status) ? ctx.query.status : null,
        kind: ["transactional", "campaign"].includes(ctx.query?.kind) ? ctx.query.kind : null,
        campaignId: clean(ctx.query?.campaignId, { max: 40 }) || null,
      }),
    };
  },

  // Unsubscribe. The emailed link is a GET, and mail scanners follow those, so
  // this only carries the token to a confirmation step. The opt-out itself is
  // the POST below, which a scanner will not issue.
  // A link in an inbox is a GET, and mail scanners follow links. So this only
  // hands the token to a confirmation screen; the POST below is what verifies.
  "GET /api/verify-email": (ctx) => {
    ctx.setHeader?.("Cache-Control", "no-store");
    const token = clean(ctx.query?.token, { max: 100 });
    return { redirect: `${publicOrigin()}/#verify=${encodeURIComponent(token || "")}` };
  },

  "POST /api/verify-email": (ctx) => {
    ctx.setHeader?.("Cache-Control", "no-store");
    limit(ctx, "verify-email", 20, 60 * 60 * 1000);
    const token = clean(ctx.body?.token, { max: 100 });
    const completion = completeVerification(token);
    if (!completion) return { ok: true, verified: false };
    const response = { ok: true, verified: true, alreadyVerified: completion.replayed };
    // Possession of an email token authorizes confirming that address, not
    // reading the account's private self projection. Only the matching active
    // session may receive `email`, `home`, and `emailVerified` back.
    if (ctx.user?.id === completion.user.id) {
      response.user = publicUser(completion.user, { self: true });
    }
    return response;
  },

  "POST /api/verify-email/resend": (ctx) => {
    ctx.setHeader?.("Cache-Control", "no-store");
    const u = requireUser(ctx);
    limit(ctx, "verify-resend", 5, 60 * 60 * 1000);
    const result = resendVerification(q.userById.get(u.id));
    const fresh = q.userById.get(u.id);
    const verified = !!fresh?.email_verified_at;
    return {
      ok: true,
      sent: result.sent,
      reason: result.reason,
      verified,
      ...(verified ? { user: publicUser(fresh, { self: true }) } : {}),
    };
  },

  "GET /api/unsubscribe": (ctx) => {
    ctx.setHeader?.("Cache-Control", "no-store");
    const token = clean(ctx.query?.token, { max: 100 });
    return { redirect: `${publicOrigin()}/#unsubscribe=${encodeURIComponent(token || "")}` };
  },

  "POST /api/unsubscribe": (ctx) => {
    limit(ctx, "unsubscribe", 20, 60 * 60 * 1000);
    const token = clean(ctx.body?.token, { max: 100 });
    // Deliberately identical whether or not the token resolves, so this endpoint
    // cannot be used to test which tokens are live.
    const done = { ok: true };
    if (!token) return done;
    const user = emailStmts.userByUnsubToken.get(token);
    if (!user) return done;
    // A bearer unsubscribe link may only reduce processing. Re-enabling
    // announcements requires an authenticated account session in Settings;
    // otherwise an old or forwarded link could silently undo consent.
    emailStmts.setMarketingPreference.run({
      id: user.id,
      opt_out: 1,
      at: now(),
      version: CURRENT_MARKETING_CONSENT_VERSION,
      source: "email-unsubscribe",
    });
    return done;
  },

  "POST /api/admin/reports/:id/dismiss": (ctx) => {
    requireModerator(ctx);
    applyModerationAction(ctx, { action: "dismiss", reportId: clean(ctx.params.id, { max: 60 }) });
    return { ok: true };
  },

  "POST /api/admin/content/:type/:id": (ctx) => {
    requireModerator(ctx);
    if (typeof ctx.body?.removed !== "boolean") throw new ApiError(400, "removed must be true or false.", "VALIDATION_FAILED");
    const result = applyModerationAction(ctx, {
      action: ctx.body.removed ? "remove" : "restore",
      targetType: clean(ctx.params.type, { max: 40 }),
      targetId: clean(ctx.params.id, { max: 60 }),
      reason: clean(ctx.body?.reason, { max: LIMITS.note }),
    });
    return { ok: true, removed: result.removed };
  },

  "POST /api/admin/users/:id/ban": (ctx) => {
    const actor = requireAdmin(ctx);
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't ban yourself.");
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (target.role === "admin") throw new ApiError(403, "Administrator accounts require owner review.", "FORBIDDEN");
    atomicWrite(() => {
      const changed = db.prepare("UPDATE users SET is_banned=1 WHERE id=? AND is_banned=0").run(ctx.params.id).changes === 1;
      // Kill sessions on both the initial action and a retry. This also repairs
      // any legacy banned row that somehow retained a session, without adding a
      // duplicate audit event for an already-achieved desired state.
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(ctx.params.id);
      if (changed) moderationRecord(ctx, "ban", "user", target.id, ctx.body?.reason || "", { banned: false }, { banned: true, by: actor.id });
    });
    return { ok: true };
  },

  // Admin-granted verification (the blue check), independent of role. Persisted so
  // it survives reload + shows cross-device.
  // Confirm an address on someone's behalf. Distinct from /verified below, which
  // grants the PUBLIC verification check; this one is private account state and
  // shows no badge. Also releases the welcome mail, exactly once.
  "POST /api/admin/users/:id/verify-email": (ctx) => {
    const actor = requireAdmin(ctx);
    const before = q.userById.get(ctx.params.id);
    if (!before) throw new ApiError(404, "No such member.", "NOT_FOUND");
    if (!before.email_verified_at) atomicWrite(() => {
      const changed = db.prepare(`UPDATE users
        SET email_verified_at=?, email_verify_hash=NULL, email_verify_expires=0
        WHERE id=? AND email_verified_at=0`).run(now(), ctx.params.id).changes === 1;
      if (changed) moderationRecord(ctx, "verify-email", "user", before.id, ctx.body?.reason || "",
        { emailVerified: false }, { emailVerified: true, by: actor.id });
    });
    const target = q.userById.get(ctx.params.id);
    // External delivery stays outside the transaction. The durable welcome
    // claim is itself guarded, so a retry repairs a crash after commit without
    // sending twice; an audit failure rolls verification back before this runs.
    void sendWelcomeOnce(target, { background: true });
    return { user: publicUser(target, { self: false }), emailVerified: !!target.email_verified_at };
  },

  "POST /api/admin/users/:id/verified": (ctx) => {
    requireAdmin(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    const verified = ctx.body?.verified ? 1 : 0;
    if (Number(target.verified) !== verified) atomicWrite(() => {
      const changed = db.prepare("UPDATE users SET verified=? WHERE id=? AND verified<>?").run(verified, ctx.params.id, verified).changes === 1;
      if (changed) moderationRecord(ctx, verified ? "grant_verification" : "remove_verification", "user", target.id, ctx.body?.reason || "", { verified: !!target.verified }, { verified: !!verified });
    });
    return { ok: true, verified: !!verified };
  },
  "POST /api/admin/users/:id/sponsor": (ctx) => {
    requireAdmin(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    const sponsor = ctx.body?.sponsor ? 1 : 0;
    if (Number(target.sponsor) !== sponsor) atomicWrite(() => {
      const changed = db.prepare("UPDATE users SET sponsor=? WHERE id=? AND sponsor<>?").run(sponsor, ctx.params.id, sponsor).changes === 1;
      if (changed) moderationRecord(ctx, sponsor ? "grant_sponsor" : "remove_sponsor", "user", target.id, ctx.body?.reason || "", { sponsor: !!target.sponsor }, { sponsor: !!sponsor });
    });
    return { ok: true, sponsor: !!sponsor };
  },

  // Full member directory for the admin console (includes banned) + live counts and
  // a per-region (home city) breakdown. This is what makes every real signup show
  // up in the Members tab so it can be verified / moderated.
  // Aggregated server errors. Deduplicated by problem, so `count` is the volume
  // and each row is one thing to fix.
  "GET /api/admin/errors": (ctx) => {
    requireAdmin(ctx);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      errors: recentErrors(50).map((e) => ({
        fingerprint: e.fingerprint, level: e.level, code: e.code, status: e.status,
        method: e.method, route: e.route, cause: e.cause, count: e.count,
        firstSeen: e.first_seen, lastSeen: e.last_seen,
      })),
      last24h: errorStats(dayAgo),
      last7Days: errorStats(weekAgo),
      alerts: { enabled: alertsEnabled(), cooldownMinutes: Math.round(alertCooldownMs() / 60000), to: alertRecipient() || null },
    };
  },

  // Prove the alert path end to end without waiting for a real incident. Bypasses
  // the cooldown only; it cannot invent errors, so an empty window still sends
  // nothing and says so.
  "POST /api/admin/errors/test-alert": async (ctx) => {
    requireAdmin(ctx);
    limit(ctx, "error-alert-test", 5, 60 * 60 * 1000);
    const result = await maybeAlert({ force: true });
    return { ok: true, ...result };
  },

  // ---- admin-created badges (tiers, events, ad-hoc status) ----
  "GET /api/admin/badges": (ctx) => {
    requireAdmin(ctx);
    return {
      badges: badgeStmts.all.all().map((b) => ({
        id: b.id, slug: b.slug, label: b.label, description: b.description, kind: b.kind,
        color: b.color, glyph: b.glyph, glyphChar: b.glyph_char,
        archived: !!b.archived_at, createdAt: b.created_at,
        holders: badgeStmts.holderCount.get(b.id).c,
      })),
      palette: { colors: BADGE_COLORS, glyphs: BADGE_GLYPHS, kinds: BADGE_KINDS },
    };
  },

  "POST /api/admin/badges": (ctx) => {
    const actor = requireAdmin(ctx);
    const draft = {
      slug: String(ctx.body?.slug || "").trim().toLowerCase(),
      label: clean(ctx.body?.label, { max: 40 }),
      description: clean(ctx.body?.description, { max: 200 }) || "",
      kind: String(ctx.body?.kind || "event"),
      color: String(ctx.body?.color || "cool"),
      glyph: String(ctx.body?.glyph || "check"),
      glyphChar: String(ctx.body?.glyphChar || "").trim().slice(0, 1),
    };
    const problems = validateBadge(draft);
    if (problems.length) throw new ApiError(400, problems[0], "VALIDATION_FAILED");
    if (badgeStmts.bySlug.get(draft.slug)) throw new ApiError(409, "A badge with that slug already exists.", "CONFLICT");
    const id = uid("bdg");
    badgeStmts.insert.run({
      id, slug: draft.slug, label: draft.label, description: draft.description, kind: draft.kind,
      color: draft.color, glyph: draft.glyph, glyph_char: draft.glyphChar || null,
      created_by: actor.id, created_at: now(),
    });
    moderationRecord(ctx, "badge-create", "badge", id, draft.label, {}, { slug: draft.slug });
    return { badge: badgeStmts.byId.get(id) };
  },

  "PUT /api/admin/badges/:id": (ctx) => {
    requireAdmin(ctx);
    const existing = badgeStmts.byId.get(ctx.params.id);
    if (!existing) throw new ApiError(404, "No such badge.", "NOT_FOUND");
    // The slug is identity and is deliberately not editable: changing it would
    // rename a badge out from under everyone already holding it.
    const draft = {
      slug: existing.slug,
      label: clean(ctx.body?.label, { max: 40 }),
      description: clean(ctx.body?.description, { max: 200 }) || "",
      kind: String(ctx.body?.kind || existing.kind),
      color: String(ctx.body?.color || existing.color),
      glyph: String(ctx.body?.glyph || existing.glyph),
      glyphChar: String(ctx.body?.glyphChar ?? existing.glyph_char ?? "").trim().slice(0, 1),
    };
    const problems = validateBadge(draft);
    if (problems.length) throw new ApiError(400, problems[0], "VALIDATION_FAILED");
    badgeStmts.update.run({
      id: existing.id, label: draft.label, description: draft.description, kind: draft.kind,
      color: draft.color, glyph: draft.glyph, glyph_char: draft.glyphChar || null, updated_at: now(),
    });
    return { badge: badgeStmts.byId.get(existing.id) };
  },

  // Retire, never delete. People keep badges they were granted.
  "POST /api/admin/badges/:id/archive": (ctx) => {
    requireAdmin(ctx);
    const existing = badgeStmts.byId.get(ctx.params.id);
    if (!existing) throw new ApiError(404, "No such badge.", "NOT_FOUND");
    const archived = ctx.body?.archived === false ? 0 : now();
    badgeStmts.setArchived.run(archived, now(), existing.id);
    return { badge: badgeStmts.byId.get(existing.id) };
  },

  "GET /api/admin/badges/:id/holders": (ctx) => {
    requireAdmin(ctx);
    if (!badgeStmts.byId.get(ctx.params.id)) throw new ApiError(404, "No such badge.", "NOT_FOUND");
    return { holders: badgeStmts.holders.all(ctx.params.id) };
  },

  "POST /api/admin/users/:id/badges": (ctx) => {
    const actor = requireAdmin(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such member.", "NOT_FOUND");
    const badge = badgeStmts.bySlug.get(String(ctx.body?.slug || "").trim().toLowerCase());
    if (!badge) throw new ApiError(404, "No such badge.", "NOT_FOUND");
    const held = !!db.prepare("SELECT 1 FROM user_badges WHERE user_id=? AND badge_id=?").get(target.id, badge.id);
    if (ctx.body?.revoke === true) {
      if (held) atomicWrite(() => {
        const changed = badgeStmts.revoke.run(target.id, badge.id).changes === 1;
        if (changed) moderationRecord(ctx, "badge-revoke", "user", target.id, badge.slug, { had: true }, { had: false, by: actor.id });
      });
    } else {
      // A retry after a successful grant is a no-op even if the badge was
      // retired between attempts. New grants of a retired badge remain blocked.
      if (!held) {
        if (badge.archived_at) throw new ApiError(400, "That badge is retired. Restore it before granting.", "VALIDATION_FAILED");
        atomicWrite(() => {
          const changed = badgeStmts.grant.run(target.id, badge.id, actor.id, now(), clean(ctx.body?.note, { max: 140 }) || "").changes === 1;
          if (changed) moderationRecord(ctx, "badge-grant", "user", target.id, badge.slug, { had: false }, { had: true, by: actor.id });
        });
      }
    }
    return { badges: customBadgesFor(target.id) };
  },

  "GET /api/admin/members": (ctx) => {
    const actor = requireModerator(ctx);
    ctx.setHeader?.("Cache-Control", "no-store");
    const { cursor, limit: memberLimit } = pageRequest(ctx, 50, 100);
    const query = clean(ctx.query?.q, { max: 80 }).toLowerCase();
    const role = clean(ctx.query?.role, { max: 16 }).toLowerCase();
    const status = clean(ctx.query?.status, { max: 16 }).toLowerCase();
    if (role && !["fan", "artist", "moderator", "admin"].includes(role)) {
      throw new ApiError(400, "That member role filter is invalid.", "VALIDATION_FAILED");
    }
    if (status && !["active", "banned", "suspended"].includes(status)) {
      throw new ApiError(400, "That member status filter is invalid.", "VALIDATION_FAILED");
    }
    const filters = [];
    const filterArgs = [];
    if (query) {
      filters.push("(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(handle) LIKE ? ESCAPE '\\' OR LOWER(id) LIKE ? ESCAPE '\\')");
      const escaped = query.replace(/[\\%_]/g, "\\$&");
      filterArgs.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }
    if (role) { filters.push("role=?"); filterArgs.push(role); }
    const at = now();
    if (status === "banned") filters.push("is_banned=1");
    else if (status === "suspended") { filters.push("is_banned=0 AND suspended_until>?"); filterArgs.push(at); }
    else if (status === "active") { filters.push("is_banned=0 AND COALESCE(suspended_until,0)<=?"); filterArgs.push(at); }
    const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const cursorSql = cursor ? `${whereSql ? "AND" : "WHERE"} (created_at < ? OR (created_at = ? AND id < ?))` : "";
    const pageArgs = [...filterArgs];
    if (cursor) pageArgs.push(cursor.createdAt, cursor.createdAt, cursor.id);
    pageArgs.push(memberLimit + 1);
    const found = db.prepare(`SELECT id,name,handle,initials,avatar_uri,avatar_color,verified,sponsor,role,home_city,
      is_banned,suspended_until,created_at,email_verified_at FROM users ${whereSql} ${cursorSql}
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(...pageArgs);
    const { rows, nextCursor } = finishPage(found, memberLimit);
    // `emailVerified` is private state that publicUser withholds from everyone but
    // the account owner. It is included here because this route is staff-only and
    // an admin needs it to answer "did my mail reach them".
    // One grouped read for every row's badges. Calling customBadgesFor per user
    // here would be one query per card. Scope the grouped read to this bounded
    // page so a large directory's badge table cannot dominate every search.
    const badgesByUser = new Map();
    if (rows.length) {
      for (const row of db.prepare(`SELECT ub.user_id, b.slug, b.label, b.color, b.glyph, b.glyph_char
        FROM user_badges ub JOIN custom_badges b ON b.id = ub.badge_id
        WHERE ub.user_id IN (${rows.map(() => "?").join(",")})`).all(...rows.map((row) => row.id))) {
        if (!badgesByUser.has(row.user_id)) badgesByUser.set(row.user_id, []);
        badgesByUser.get(row.user_id).push({ slug: row.slug, label: row.label, color: row.color, glyph: row.glyph, glyphChar: row.glyph_char });
      }
    }
    const lockedOwnerId = ownerAccount(db)?.user?.id || null;
    const users = rows.map((r) => ({
      id: r.id, name: r.name, handle: r.handle, initials: r.initials,
      avatarUri: safePublicProfileImage(r.id, r.avatar_uri), avatarColor: r.avatar_color, verified: !!r.verified,
      sponsor: !!r.sponsor, role: r.role, home: { city: r.home_city },
      owner: r.id === lockedOwnerId,
      isBanned: !!r.is_banned, suspendedUntil: r.suspended_until || null,
      createdAt: r.created_at, badges: badgesByUser.get(r.id) || [],
      // Address-confirmation state is private and actionable only by admins.
      // Moderators still receive the restriction fields they need for triage.
      ...(actor.role === "admin" ? { emailVerified: !!r.email_verified_at } : {}),
    }));
    const total = db.prepare("SELECT COUNT(*) c FROM users").get().c;
    const matchingTotal = filters.length
      ? Number(db.prepare(`SELECT COUNT(*) c FROM users ${whereSql}`).get(...filterArgs)?.c) || 0
      : total;
    const banned = db.prepare("SELECT COUNT(*) c FROM users WHERE is_banned=1").get().c;
    const verified = db.prepare("SELECT COUNT(*) c FROM users WHERE verified=1").get().c;
    const regions = db.prepare("SELECT COALESCE(NULLIF(home_city,''),'Unknown') city, COUNT(*) c FROM users GROUP BY city ORDER BY c DESC LIMIT 12").all().map((r) => ({ city: r.city, count: r.c }));
    return { users, total, matchingTotal, banned, verified, regions, nextCursor };
  },

  // Fan/artist changes remain an ordinary admin decision. Every transition to
  // or from moderator/admin is only REQUESTED here; it cannot mutate authority
  // until the locked Owner follows the founder email and reauthenticates.
  "POST /api/admin/users/:id/role": (ctx) => {
    const actor = requireAdmin(ctx);
    limit(ctx, "role-change-request", 20, 60 * 60 * 1000);
    const role = ["fan", "artist", "moderator", "admin"].includes(ctx.body?.role) ? ctx.body.role : null;
    if (!role) throw new ApiError(400, "Bad role.");
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't change your own role.");
    const handle = ctx.body?.handle ? cleanHandle(ctx.body.handle) : null;
    if (handle && !handleAllowedForRole(handle, role)) throw new ApiError(400, `A ${role} username must include ${role === "admin" ? "admin" : "mod"}.`, "VALIDATION_FAILED");
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (isOwnerId(db, target.id)) throw new ApiError(403, "The Owner role cannot be changed.", "FORBIDDEN");

    // Resolve a no-op without sending mail. The helper also validates a supplied
    // handle against the complete directory, not merely the loaded UI page.
    const selectedHandle = selectedRoleHandle(target, role, handle);
    if (target.role === role && target.handle === selectedHandle) {
      return { ok: true, role, handle: selectedHandle };
    }

    if (!roleChangeTouchesHead(target.role, role)) {
      const result = atomicWrite(() => applyRoleChange(ctx, target, role, handle, {
        reason: clean(ctx.body?.reason, { max: LIMITS.note }),
      }));
      return { ok: true, role: result.role, handle: result.handle };
    }

    if (target.is_banned || Number(target.suspended_until || 0) > now()) {
      throw new ApiError(409, "Restore this account before requesting a privileged role change.", "CONFLICT");
    }
    if ((role === "admin" || role === "moderator") && !target.email_verified_at) {
      throw new ApiError(409, "Confirm this member's email before requesting a privileged role.", "CONFLICT");
    }
    const created = createOwnerApprovalRequest(db, {
      kind: "privileged_role_change",
      requestedBy: actor.id,
      targetUserId: target.id,
      summary: "Privileged role change awaiting Owner review",
      payload: {
        targetUserId: target.id,
        expectedRole: target.role,
        expectedHandle: target.handle,
        requestedRole: role,
        requestedHandle: selectedHandle,
      },
      requestId: ctx.requestId || null,
      at: now(),
    });
    return emailOwnerApprovalRequest(db, created.request, created.token).then((delivery) => ({
      ok: true,
      pending: true,
      approvalId: created.request.id,
      expiresAt: created.request.expiresAt,
      emailSent: !!delivery.sent,
      message: delivery.sent
        ? "Awaiting Owner approval. A review link was sent to founder@mshpit.com."
        : "Authority was not changed. The Owner approval request was saved, but its email could not be delivered; retry the request after mail is healthy.",
    }));
  },

  // Catalog queue: thin artists (in the DB but no photo yet) + names people
  // searched that MusicBrainz had nothing for. Admin seeds these on demand.
  "GET /api/admin/artist-queue": (ctx) => {
    requireAdmin(ctx);
    pruneMissingArtists();
    return {
      thin: artistStmts.thin.all(60).map((r) => ({ norm: r.norm, name: r.name, searches: r.searches, genre: r.genre })),
      missing: artistStmts.listMissing.all(60).map((r) => ({ norm: r.norm, name: r.name, searches: r.searches })),
      thinTotal: artistStmts.thinCount.get().c,
    };
  },
  // Seed info + photos for specific artists from Deezer (the targeted alternative
  // to a blind 10M dump). Exact identity mode first creates or verifies the
  // canonical MusicBrainz row; Deezer remains optional enrichment.
  "POST /api/admin/artists/enrich": async (ctx) => {
    requireAdmin(ctx);
    if (ctx.body?.requireExactIdentity !== undefined
      && typeof ctx.body.requireExactIdentity !== "boolean") {
      throw new ApiError(400, "requireExactIdentity must be true or false.", "VALIDATION_FAILED");
    }
    const requireExactIdentity = ctx.body?.requireExactIdentity === true;
    const rawNames = Array.isArray(ctx.body?.names) ? ctx.body.names.slice(0, 40) : [];
    let names = rawNames.map((name) => String(name).slice(0, 120));
    if (requireExactIdentity) {
      const exactName = typeof rawNames[0] === "string"
        ? clean(rawNames[0], { max: 241 })
        : "";
      if (rawNames.length !== 1 || !exactName || [...exactName].length > 120) {
        throw new ApiError(
          400,
          "Exact identity enrichment requires one complete artist name.",
          "VALIDATION_FAILED",
        );
      }
      names = [exactName];
    }

    let enriched = 0;
    const artists = [];
    for (const name of names) {
      let expectedMbid = null;
      let artistKey = normName(name);
      let enrichmentName = name;
      if (requireExactIdentity) {
        const persisted = await persistExactMusicBrainzIdentity(name);
        expectedMbid = String(persisted.mbid || "").toLowerCase();
        artistKey = persisted.norm;
        enrichmentName = persisted.name;
      }

      try {
        if (await enrichArtistFromDeezer(enrichmentName)) enriched += 1;
      } catch (error) {
        if (!(requireExactIdentity && error instanceof ProviderError)) throw error;
      }

      const row = artistStmts.byNorm.get(artistKey);
      if (requireExactIdentity
        && (!row || String(row.mbid || "").toLowerCase() !== expectedMbid)) {
        throw new ApiError(
          409,
          "The artist identity changed during enrichment. Reload the catalog and try again.",
          "CONFLICT",
        );
      }
      if (row) {
        artistStmts.clearMissing.run(normName(name));
        if (artistKey !== normName(name)) artistStmts.clearMissing.run(artistKey);
        artists.push(publicArtist(row));
      }
    }
    return { enriched, requested: names.length, artists };
  },
  // Staff correction for a genre. This is the top of the provenance hierarchy:
  // once set it outranks every automated run, so a re-crawl cannot put Justin
  // Bieber back under Metal. Auditable like every other moderation action, and
  // reversible by passing an empty genre, which drops back to provider evidence.
  "POST /api/admin/artists/genre": (ctx) => {
    requireAdmin(ctx);
    const name = clean(ctx.body?.name, { max: 120 });
    if (!name) throw new ApiError(400, "Name is required.", "VALIDATION_FAILED");
    const row = artistStmts.byNorm.get(normName(name));
    if (!row) throw new ApiError(404, "That artist is not in the catalog.", "NOT_FOUND");

    let data = {};
    try { data = JSON.parse(row.data || "{}"); } catch {}
    const claims = storedClaims(data, row.genre);
    const prior = resolveGenre(claims);

    const requested = clean(ctx.body?.genre, { max: 40 });
    let nextClaims;
    if (requested) {
      const claim = genreClaim(requested, "staff");
      if (!claim) throw new ApiError(400, "That genre is invalid.", "VALIDATION_FAILED");
      nextClaims = upsertClaim(claims, claim);
    } else {
      // Undo: withdraw the staff decision only. The provider claims underneath
      // are still on the record, so the artist falls back to evidence rather
      // than to nothing, and the correction is genuinely reversible.
      nextClaims = withoutSource(claims, "staff");
    }
    const next = resolveGenre(nextClaims);

    const merged = { ...data, genre: next?.value || null, genreClaims: nextClaims, genreRecord: undefined };
    artistStmts.upsert.run(artistRow(row.norm, { ...merged, name: row.name }, row.source || "staff"));
    moderationRecord(ctx, "artist_genre", "artist", row.norm, clean(ctx.body?.reason, { max: LIMITS.note }),
      { genre: prior?.value || null, source: prior?.source || null },
      { genre: next?.value || null, source: next?.source || null });
    return { artist: publicArtist(artistStmts.byNorm.get(row.norm)) };
  },

  // Purge a dead / typo / never-found artist to keep the catalog clean.
  "POST /api/admin/artists/purge": (ctx) => {
    requireAdmin(ctx);
    const norm = normName(clean(ctx.body?.norm, { max: 200 }));
    if (norm) { artistStmts.purge.run(norm); artistStmts.clearMissing.run(norm); }
    return { ok: true };
  },
  // Grow the whole catalog toward N artists across all genres (MusicBrainz crawl +
  // Deezer ranking), as a background job so the request returns immediately. Poll
  // GET for live progress. No bundle change, nothing to deploy.
  "POST /api/admin/catalog/seed": (ctx) => {
    requireAdmin(ctx);
    const mode = ctx.body?.mode === "refresh" ? "refresh" : "grow";
    if (mode === "refresh") return startCatalogSeed({ mode });
    const add = Math.max(100, Math.min(20000, Number(ctx.body?.add) || 2000));
    return startCatalogSeed({ add });
  },
  "GET /api/admin/catalog/seed": (ctx) => {
    requireAdmin(ctx);
    return catalogSeedStatus();
  },
  "DELETE /api/admin/catalog/seed": (ctx) => {
    requireAdmin(ctx);
    return stopCatalogSeed();
  },
  // Durable history for catalog jobs. The in-memory status is lost on restart and
  // once reported "done" after adding nothing, which is how a no-op grow looked
  // successful. This is the record that survives and tells the truth.
  "GET /api/admin/catalog/runs": (ctx) => {
    requireAdmin(ctx);
    const limitN = Math.min(20, Math.max(1, Number(ctx.query.limit) || 8));
    const rows = db.prepare(`SELECT id,mode,status,start_total,target,added,enriched,error_code,note,started_at,finished_at
      FROM seed_runs ORDER BY started_at DESC LIMIT ?`).all(limitN);
    return {
      runs: rows.map((r) => ({
        id: r.id, mode: r.mode, status: r.status, startTotal: r.start_total, target: r.target,
        added: r.added, enriched: r.enriched, errorCode: r.error_code, note: r.note,
        startedAt: r.started_at, finishedAt: r.finished_at,
      })),
    };
  },

  "POST /api/admin/users/:id/unban": (ctx) => {
    requireAdmin(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    if (target.is_banned || target.suspended_until != null) atomicWrite(() => {
      const changed = db.prepare(`UPDATE users SET is_banned=0, suspended_until=NULL
        WHERE id=? AND (is_banned<>0 OR suspended_until IS NOT NULL)`).run(ctx.params.id).changes === 1;
      if (changed) moderationRecord(ctx, "unban", "user", target.id, ctx.body?.reason || "", { banned: !!target.is_banned, suspendedUntil: target.suspended_until || null }, { banned: false, suspendedUntil: null });
    });
    return { ok: true };
  },

  "POST /api/admin/users/:id/unsuspend": (ctx) => {
    const actor = requireModerator(ctx);
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    assertModerationRank(actor, target);
    if (target.is_banned) throw new ApiError(409, "This account is banned; an administrator must unban it.", "CONFLICT");
    if (target.suspended_until != null) atomicWrite(() => {
      const changed = db.prepare("UPDATE users SET suspended_until=NULL WHERE id=? AND suspended_until IS NOT NULL").run(target.id).changes === 1;
      if (changed) moderationRecord(ctx, "lift_suspension", "user", target.id, ctx.body?.reason || "", { suspendedUntil: target.suspended_until || null }, { suspendedUntil: null });
    });
    return { ok: true };
  },

  "POST /api/admin/users/:id/suspend": (ctx) => {
    const actor = requireModerator(ctx);
    if (ctx.params.id === ctx.user.id) throw new ApiError(400, "You can't suspend yourself.");
    const days = Math.max(1, Math.min(365, Number(ctx.body?.days) || 7));
    const target = q.userById.get(ctx.params.id);
    if (!target) throw new ApiError(404, "No such user.", "NOT_FOUND");
    assertModerationRank(actor, target);
    const actionAt = now();
    // Desired-state semantics: an already-live timeout is success, not an
    // extension. This makes a retry after a lost response return the exact same
    // deadline and avoids duplicate audit history. Staff can lift it first if a
    // genuinely different timeout is required.
    if (Number(target.suspended_until || 0) > actionAt) return { ok: true, suspendedUntil: target.suspended_until };
    const requestedUntil = actionAt + days * 86400000;
    const suspendedUntil = atomicWrite(() => {
      const changed = db.prepare(`UPDATE users SET suspended_until=?
        WHERE id=? AND (suspended_until IS NULL OR suspended_until<=?)`).run(requestedUntil, ctx.params.id, actionAt).changes === 1;
      if (!changed) return q.userById.get(ctx.params.id)?.suspended_until || requestedUntil;
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(ctx.params.id);
      moderationRecord(ctx, "suspend", "user", target.id, ctx.body?.reason || "", { suspendedUntil: target.suspended_until || null }, { suspendedUntil: requestedUntil, days });
      return requestedUntil;
    });
    return { ok: true, suspendedUntil };
  },

  // ---- ratings: album + song stars (SQLite migration slice 7) ----
  "GET /api/ratings": (ctx) => {
    const kind = ctx.query.kind === "song" ? "song" : "album";
    const ref = clean(ctx.query.ref, { max: 200 });
    if (!ref) throw new ApiError(400, "Missing ref.");
    const agg = db.prepare(`SELECT AVG(r.rating) avg,COUNT(*) count FROM ratings r JOIN users u ON u.id=r.user_id
      WHERE r.kind=? AND r.ref=? AND ${activeAccountSql("u")}`).get(kind, ref);
    const mine = ctx.user ? db.prepare("SELECT rating FROM ratings WHERE user_id=? AND kind=? AND ref=?").get(ctx.user.id, kind, ref) : null;
    return { avg: agg.avg || 0, count: agg.count || 0, mine: mine?.rating || 0 };
  },
  "POST /api/ratings": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "rate", 120, 10 * 60 * 1000);
    const kind = ctx.body?.kind === "song" ? "song" : "album";
    const ref = clean(ctx.body?.ref, { max: 200 });
    const rating = clampRating(ctx.body?.rating);
    if (!ref || !rating) throw new ApiError(400, "Bad rating.");
    db.prepare(`INSERT INTO ratings (user_id,kind,ref,rating) VALUES (?,?,?,?)
                ON CONFLICT(user_id,kind,ref) DO UPDATE SET rating=excluded.rating`).run(u.id, kind, ref, rating);
    const agg = db.prepare(`SELECT AVG(r.rating) avg,COUNT(*) count FROM ratings r JOIN users u ON u.id=r.user_id
      WHERE r.kind=? AND r.ref=? AND ${activeAccountSql("u")}`).get(kind, ref);
    return { avg: agg.avg || 0, count: agg.count || 0, mine: rating };
  },

  // One bounded venue pool at a time. The 2.1 MB source stays server-side so a
  // phone opening the app no longer downloads every venue's gallery.
  "GET /api/venues/:key/photos": (ctx) => {
    const key = decodedPathParam(ctx, "key", { max: 200, label: "venue link" }).toLowerCase();
    if (!key) throw new ApiError(400, "Choose a venue first.", "VALIDATION_FAILED");
    ctx.setHeader?.("Cache-Control", VENUE_PHOTO_CACHE_CONTROL);
    return { key, photos: normalizedVenuePhotoPool(key) };
  },

  // ---- venue reviews (slice 7) ----
  "GET /api/venues/:key/reviews": (ctx) => {
    const key = decodedPathParam(ctx, "key", { max: 200, label: "venue link" }).toLowerCase();
    const viewer = ctx.user?.id || null;
    const { cursor, limit } = pageRequest(ctx, 200, 200);
    const blockSql = viewer ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=r.user_id) OR (b.blocker_id=r.user_id AND b.blocked_id=?))` : "";
    const cursorSql = cursor ? "AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))" : "";
    const args = [key];
    if (viewer) args.push(viewer, viewer);
    if (cursor) args.push(cursor.createdAt, cursor.createdAt, cursor.id);
    args.push(limit + 1);
    const found = db.prepare(`SELECT r.*, u.name, u.initials FROM venue_reviews r JOIN users u ON u.id=r.user_id
                             WHERE r.venue_key=? AND r.removed=0 AND ${activeAccountSql("u")} ${blockSql} ${cursorSql}
                             ORDER BY r.created_at DESC, r.id DESC LIMIT ?`).all(...args);
    const { rows, nextCursor } = finishPage(found, limit);
    return { reviews: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      name: r.name,
      initials: r.initials,
      rating: r.rating,
      text: r.text,
      photos: parseJsonArray(r.photos).filter((url) => !!safePublicProfileImage(r.user_id, url)),
      createdAt: r.created_at,
    })), nextCursor };
  },
  "POST /api/venues/:key/reviews": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "venuereview", 30, 60 * 60 * 1000);
    const key = decodedPathParam(ctx, "key", { max: 200, label: "venue link" }).toLowerCase();
    const rating = clampRating(ctx.body?.rating);
    if (!key || !rating) throw new ApiError(400, "Bad review.");
    const text = clean(ctx.body?.text, { max: LIMITS.review, newlines: true });
    assertSafeAuthoredText(text, { field: "venue review" });
    const photos = cleanStringArray(ctx.body?.photos, { maxItems: MEDIA_POST_MAX_ATTACHMENTS, maxLen: 2000 });
    if ((photos || []).some(isLegacyVideoUrl)) {
      throw new ApiError(400, "Venue reviews support photos only until verified venue clips are available.", "VALIDATION_FAILED");
    }
    const venuePhotoPurposes = (photos || []).map(() => ["venue", "review"]);
    assertNewOwnedReadyImageUrls(u.id, photos, [], "venue-review", venuePhotoPurposes);
    const id = uid("vr");
    atomicWrite(() => {
      associateNewFinalizedImageUrls(u.id, photos, [], venuePhotoPurposes);
      db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, key, u.id, rating, text || "", JSON.stringify(photos || []), now());
      markOwnedMediaAssociated(db, { ownerId: u.id, urls: photos, at: now() });
    });
    return { id };
  },

  // ---- artist requests + owned profiles (slice 7) ----
  "POST /api/artist-requests": (ctx) => {
    const u = requireUser(ctx);
    limit(ctx, "artistreq", 5, 60 * 60 * 1000);
    const artistName = clean(ctx.body?.artistName, { max: LIMITS.artist });
    if (!artistName || artistName.length < 2) throw new ApiError(400, "Enter the artist name.");
    const note = clean(ctx.body?.note, { max: LIMITS.note, newlines: true }) || "";
    assertSafeAuthoredFields({ "artist name": artistName, "request note": note });
    const id = uid("ar");
    db.prepare("INSERT INTO artist_requests (id,user_id,artist_name,note,status,created_at) VALUES (?,?,?,?,'pending',?)")
      .run(id, u.id, artistName, note, now());
    return { id };
  },
  "GET /api/admin/artist-requests": (ctx) => {
    requireAdmin(ctx);
    const rows = db.prepare("SELECT * FROM artist_requests WHERE status='pending' ORDER BY created_at DESC LIMIT 200").all();
    return { requests: rows.map((r) => ({ id: r.id, userId: r.user_id, artistName: r.artist_name, note: r.note, status: r.status })) };
  },
  "POST /api/admin/artist-requests/:id/approve": (ctx) => {
    requireAdmin(ctx);
    const r = db.prepare("SELECT * FROM artist_requests WHERE id=?").get(ctx.params.id);
    if (!r) throw new ApiError(404, "No such request.");
    const key = normName(r.artist_name);
    atomicWrite(() => {
      const target = q.userById.get(r.user_id);
      if (!target) throw new ApiError(404, "The requesting account no longer exists.", "NOT_FOUND");
      const conflictingAccount = matchingArtistAccountIds(key).find((id) => id !== target.id);
      const profile = db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(key);
      if (conflictingAccount || (profile?.owner_id && profile.owner_id !== target.id)
        || (target.role === "artist" && target.artist_name && normName(target.artist_name) !== key)) {
        throw new ApiError(409, "That artist identity is already assigned to another account.", "CONFLICT");
      }
      db.prepare("UPDATE artist_requests SET status='approved' WHERE id=?").run(r.id);
      const roleChanged = db.prepare("UPDATE users SET role='artist', artist_name=? WHERE id=? AND (role<>'artist' OR artist_name IS NOT ?)")
        .run(r.artist_name, r.user_id, r.artist_name).changes === 1;
      if (roleChanged) db.prepare("DELETE FROM sessions WHERE user_id=?").run(r.user_id);
      if (profile) {
        const bound = db.prepare("UPDATE artist_profiles SET owner_id=?,updated_at=? WHERE artist_key=? AND (owner_id IS NULL OR owner_id=?)")
          .run(target.id, now(), key, target.id).changes === 1;
        if (!bound) throw new ApiError(409, "That artist page changed while approval was being saved.", "CONFLICT");
      } else {
        db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,updated_at) VALUES (?,?,?)").run(key, target.id, now());
      }
    });
    return { ok: true };
  },
  "POST /api/admin/artist-requests/:id/reject": (ctx) => {
    requireAdmin(ctx);
    db.prepare("UPDATE artist_requests SET status='rejected' WHERE id=?").run(ctx.params.id);
    return { ok: true };
  },
  "GET /api/artists/:key/profile": (ctx) => {
    const key = decodedPathParam(ctx, "key", { max: 200, label: "artist link" }).toLowerCase();
    const p = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get(key);
    const blocked = blockedIdSet(ctx.user?.id);
    // Owner overrides are ordinary user-authored UGC. A block must hide them in
    // both directions just like profiles and posts elsewhere; the client can
    // still render provider/catalog metadata beneath this null overlay.
    if (p?.owner_id && (blocked.has(p.owner_id) || !publicAccountOrNull(p.owner_id))) return { profile: null, posts: [] };
    const viewer = ctx.user?.id || null;
    const blockSql = viewer ? `AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
      (b.blocker_id=? AND b.blocked_id=post.user_id) OR (b.blocker_id=post.user_id AND b.blocked_id=?))` : "";
    const args = viewer ? [key, viewer, viewer] : [key];
    // A disabled updates feed is a publication boundary, not just a client-side
    // presentation preference. Keep its posts available to the owning artist
    // and admins for management, but never disclose them to public/non-owners.
    const canManageFeed = canManageArtistProfile(ctx.user, key, p);
    const posts = p?.removed || (!p?.feed_enabled && !canManageFeed) ? [] : db.prepare(`SELECT post.id,post.user_id,post.text,post.created_at
      FROM artist_posts post JOIN users author ON author.id=post.user_id
      WHERE post.artist_key=? AND post.removed=0 AND ${activeAccountSql("author")}
        ${blockSql}
      ORDER BY post.created_at DESC,post.id DESC LIMIT 100`).all(...args);
    return {
      profile: p && !p.removed ? {
        ownerId: p.owner_id || null,
        bio: p.bio,
        banner: safePublicProfileImage(p.owner_id, p.banner),
        avatarUri: safePublicProfileImage(p.owner_id, p.avatar_uri),
        feedEnabled: !!p.feed_enabled,
      } : null,
      posts: posts.map((x) => ({ id: x.id, userId: x.user_id, text: x.text, createdAt: x.created_at })),
    };
  },
  "PATCH /api/artists/:key/profile": (ctx) => {
    const u = requireUser(ctx);
    const key = decodedPathParam(ctx, "key", { max: 200, label: "artist link" }).toLowerCase();
    assertArtistManagementCandidate(u, key);
    const [, v] = shape(ctx.body, {
      bio: { parse: (x) => clean(x, { max: 600, newlines: true }) },
      banner: { parse: (x) => clean(x, { max: 2000 }) },
      avatarUri: { parse: (x) => clean(x, { max: 2000 }) },
      feedEnabled: { parse: (x) => (x ? 1 : 0) },
    });
    assertSafeAuthoredText(v.bio, { field: "artist bio" });
    const existing = db.prepare("SELECT owner_id,banner,avatar_uri FROM artist_profiles WHERE artist_key=?").get(key);
    assertNewOwnedReadyImageUrls(
      u.id,
      [v.banner, v.avatarUri],
      [existing?.banner, existing?.avatar_uri],
      "artist-profile",
      ["banner", "avatar"],
    );
    const sets = [], args = [];
    if (v.bio !== undefined) { sets.push("bio=?"); args.push(v.bio); }
    if (v.banner !== undefined) { sets.push("banner=?"); args.push(v.banner); }
    if (v.avatarUri !== undefined) { sets.push("avatar_uri=?"); args.push(v.avatarUri); }
    if (v.feedEnabled !== undefined) { sets.push("feed_enabled=?"); args.push(v.feedEnabled); }
    sets.push("updated_at=?"); args.push(now());
    const replacedProfileMedia = [
      ...(v.banner !== undefined && v.banner !== existing?.banner ? [existing?.banner] : []),
      ...(v.avatarUri !== undefined && v.avatarUri !== existing?.avatar_uri ? [existing?.avatar_uri] : []),
    ].filter(Boolean);
    atomicWrite(() => {
      associateNewFinalizedImageUrls(
        u.id,
        [v.banner, v.avatarUri],
        [existing?.banner, existing?.avatar_uri],
        ["banner", "avatar"],
      );
      claimArtistManagement(u, key);
      if (!existing && u.role === "admin") {
        db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,updated_at) VALUES (?,?,?)").run(key, null, now());
      }
      db.prepare(`UPDATE artist_profiles SET ${sets.join(", ")} WHERE artist_key=?`).run(...args, key);
      markOwnedMediaAssociated(db, { ownerId: u.id, urls: [v.banner, v.avatarUri], at: now() });
      const deletable = unreferencedOwnedMediaUrls(db, { ownerId: u.id, urls: replacedProfileMedia });
      enqueueOwnedMediaUrls(db, { ownerId: u.id, urls: deletable, at: now() });
    });
    return { ok: true };
  },
  "POST /api/artists/:key/posts": (ctx) => {
    const u = requireUser(ctx);
    // Ownership is already checked below, so abuse is bounded to your own page.
    // This bounds the volume as well, matching the other post routes.
    limit(ctx, "artist-post", 40, 60 * 60 * 1000);
    const key = decodedPathParam(ctx, "key", { max: 200, label: "artist link" }).toLowerCase();
    assertArtistManagementCandidate(u, key);
    const text = clean(ctx.body?.text, { max: LIMITS.message, newlines: true });
    if (!text) throw new ApiError(400, "Say something first.");
    assertSafeAuthoredText(text, { field: "artist update" });
    const id = uid("ap");
    atomicWrite(() => {
      claimArtistManagement(u, key);
      db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)").run(id, key, u.id, text, now());
    });
    return { id };
  },
  "DELETE /api/artists/:key/posts/:id": (ctx) => {
    const u = requireUser(ctx);
    const key = decodedPathParam(ctx, "key", { max: 200, label: "artist link" }).toLowerCase();
    assertArtistManagementCandidate(u, key);
    atomicWrite(() => {
      claimArtistManagement(u, key);
      db.prepare("DELETE FROM artist_posts WHERE id=? AND artist_key=?").run(ctx.params.id, key);
    });
    return { ok: true };
  },
};
