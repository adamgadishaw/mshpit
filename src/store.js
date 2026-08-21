import { createContext, useContext, useState, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { seedFeed, ratedShows, haversineKm } from "./data";
import { catalogVenues, catalogTourDates, catalogArtists } from "./seed/catalog";
import { clean, cleanEmail, isEmail, cleanName, isName, cleanHandle, isPassword, clampRating, LIMITS } from "./lib/validate";
import { load, save } from "./lib/persist";
import { api, captureAppError, configureApiIdentity } from "./lib/api";
import { clearStoredTheme, setTheme as applyTheme, storedThemeSelection, syncThemeFromAccount } from "./theme";
import { artistMeta } from "./seed/ingested";
import { ACHIEVEMENTS } from "./lib/badges";
import { ENABLE_DEMO_DATA, remoteIdentityValidationEnabled } from "./config/runtime.mjs";
import { isUpcomingEventDate, PERSISTED_FEED_LIMIT, publicProfileCacheEntry, sanitizePersistedStoreValue, sanitizeTourDates } from "./domain/dataPolicy.mjs";
import { toIsoDate } from "./domain/dates.mjs";
import { createTicketRegistry } from "./domain/latestWins.mjs";
import { withoutBlockedPersonSearches } from "./domain/unifiedSearch.mjs";
import {
  createRecommendationPreferenceCoordinator,
  recommendationPreferenceMutationKey,
} from "./domain/recommendationPreferenceMutation.mjs";
import { createAccountReadCoordinator } from "./domain/accountReadCoordinator.mjs";
import {
  applyFanClubMembership,
  createFanClubDirectoryReadCoordinator,
  normalizeFanClubDirectory,
} from "./domain/fanClubDirectory.mjs";
import { createDiscoverCache, discoverGenreCacheKey, discoverOverviewCacheKey } from "./domain/discoverCache.mjs";
import { mergeUniquePage, reconcileMemberMutationPage } from "./domain/pageMerge.mjs";
import { mergeChatMessages, reconcileRemovedDirectMessages } from "./domain/chatMessages.mjs";
import {
  chatOutboxFor,
  chatOutboxMessageId,
  confirmedChatMessage,
  createChatClientMutationId,
  updateChatOutboxItem,
  withChatOutboxItem,
  withoutChatOutboxItem,
} from "./domain/chatDelivery.mjs";
import { createStaffReadCoordinator, staffScopeFor } from "./domain/staffReadCoordinator.mjs";
import { patchModerationMemberContext } from "./domain/moderationConsole.mjs";
import {
  deleteAccountDraft,
  draftsForAccount,
  migrateLegacyDrafts,
  resolveQuarantinedLegacyDrafts,
  upsertAccountDraft,
} from "./domain/draftPolicy.mjs";
import { buildReviewCreateBody, buildReviewEditBody, cleanArtistKey } from "./domain/post-payload.mjs";
import { mergeEditedPost, resolvePostEditTarget } from "./domain/postEditTarget.mjs";
import { postMatchesEditIntent, shouldReconcileEditFailure } from "./domain/postReconciliation.mjs";
import { classifyResolve, backoffFor, RESOLVE_ATTEMPTS, CACHE_MS } from "./domain/playback.mjs";
import { recommendTracks as recommendFromCandidates } from "./domain/recommend.mjs";
import { trackKey, trackMetadataKey, trackTupleKey, youtubeLookupCacheKey } from "./lib/playback";
import {
  configureProductAnalytics,
  installProductAnalyticsLifecycle,
  productAnalyticsPlatform,
  purgeProductAnalyticsAccount,
  trackProductEvent,
} from "./lib/productAnalytics";
import { analyticsDurationBucket } from "./domain/analyticsPolicy.mjs";
import { isVenuePlaceActionable, locationCenterFromVenues, venuePlaceIdentity } from "./domain/venueDiscovery.mjs";
import {
  confirmEmailWithReconciliation,
  matchingEmailVerifiedSessionUser,
  verificationResendState,
} from "./domain/emailVerification.mjs";
import {
  cleanVenuePhotoResponse,
  isFreshVenuePhotoEntry,
  mergeVenuePhotoSources,
  venuePhotoStateFor,
  withBoundedVenuePhotoCache,
} from "./domain/venuePhotos.mjs";
import { venueCatalogPhotoFields } from "./domain/venuePhotoProvenance.mjs";
import {
  mediaReactionsForAccountTransition,
  replaceVenueReviewSnapshot,
  venueReviewStorageKey,
  withoutVenueReviewsByUser,
} from "./domain/accountMediaCache.mjs";
import { mediaDisplayItems } from "./domain/postMediaDisplay.mjs";
import { artistGalleryIdentityKey, mergeArtistGalleryMedia, postMatchesArtistGallery } from "./domain/artistGalleryMedia.mjs";
import { deleteMediaDraftsForOwner, releaseMediaDraftAssets } from "./lib/mediaDraftStaging";
import {
  privateListeningActive as isPrivateListeningActive,
  privateListeningStorageKey,
  startPrivateListening,
} from "./domain/privateListening.mjs";
import { createGoingIntentCoordinator, goingIntentKey } from "./domain/goingIntent.mjs";
import { accountMutationIsCurrent, captureAccountMutation } from "./domain/accountMutation.mjs";

// Legacy client facade: combines server hydration, small persisted caches, social
// state, and compatibility data behind one screen-facing shape. Server responses
// and the HttpOnly session remain authoritative; split domains incrementally.

const AV = ["#F2A65A", "#E0457B", "#5B8DEF", "#6FCF97", "#B98AE0", "#E8B65A"];
// Local plaintext accounts exist only to keep the prototype usable while running
// an explicit development build without the API. Production must never treat a
// network failure as a successful local authentication or signup.
const LOCAL_AUTH_FALLBACK = ENABLE_DEMO_DATA;
const demoSeed = (value, emptyValue) => (ENABLE_DEMO_DATA ? value : emptyValue);

// One-way upgrade migration. Production identity is cookie-owned, so retaining
// the old full local session (email, precise home, consent metadata) serves no
// authentication purpose. Preserve only its account id in memory long enough
// to safely recover an ownerless legacy draft after /api/me confirms the same
// account, then erase the device copy before App renders.
const migrateLegacyProductionSession = () => {
  if (ENABLE_DEMO_DATA) return null;
  const legacy = load("pit.session", null);
  const legacyAccountId = legacy?.id == null || legacy.id === "" ? null : String(legacy.id);
  save("pit.session", null);
  return legacyAccountId;
};
const LEGACY_PRODUCTION_SESSION_ACCOUNT_ID = migrateLegacyProductionSession();
const emptyAdminStats = () => ({ total: 0, banned: 0, verified: 0, regions: [] });
const emptyAdminMemberDirectory = () => ({
  query: "",
  role: "",
  status: "",
  matchingTotal: 0,
  nextCursor: null,
});
const emptyModerationConsole = () => ({
  summary: { open: 0, actioned: 0, dismissed: 0, totalRecent: 0, byType: {}, queueTruncated: false },
  reports: [],
  recentActions: [],
  nextCursor: null,
});

// Compact relative time ("now" / "5m" / "3h" / "2d") for server timestamps that
// arrive as epoch ms, so hydrated DMs/comments read like the seed ones.
const ago = (ms) => {
  if (!ms) return "now";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60); if (m < 60) return m + "m";
  const h = Math.floor(m / 60); if (h < 24) return h + "h";
  const d = Math.floor(h / 24); if (d < 7) return d + "d";
  const w = Math.floor(d / 7); if (w < 5) return w + "w";
  return Math.floor(d / 30) + "mo";
};

const FEED_PAGE_LIMIT = 20;
const FEED_REFRESH_MS = 45_000;
const FEED_REFRESH_MAX_BACKOFF_MS = 120_000;
const feedStorageKey = (accountId) => `pit.feed.v2.${accountId || "guest"}`;
const recommendationPreferenceStorageKey = (accountId) => `pit.feed.preferences.v1.${accountId}`;
const AUTH_EPOCH_STORAGE_KEY = "pit.auth.epoch.v1";
const broadcastAuthEpoch = () => {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  // This key is a one-way notification only. Validation never writes it, so two
  // tabs cannot trigger each other in a lock/revalidate loop.
  save(AUTH_EPOCH_STORAGE_KEY, { at: Date.now(), nonce: Math.random().toString(36).slice(2) });
};
const loadRecommendationHiddenIds = (accountId) => new Set(accountId ? load(recommendationPreferenceStorageKey(accountId), []) : []);
const loadScopedFeed = (accountId) => {
  const scoped = load(feedStorageKey(accountId), null);
  if (Array.isArray(scoped)) return sanitizePersistedStoreValue("pit.feed", scoped, ENABLE_DEMO_DATA);
  // The legacy cache was device-global. Only a guest may migrate its public
  // cards, and personalization metadata is stripped during that one-way move.
  if (accountId) return [];
  const legacy = sanitizePersistedStoreValue("pit.feed", load("pit.feed", demoSeed(seedFeed, [])), ENABLE_DEMO_DATA);
  return legacy.map(({ recommendation: _recommendation, liked: _liked, ...post }) => ({ ...post, liked: false }));
};
const normalizeServerPost = (post) => ({
  ...post,
  photos: Array.isArray(post?.photos) ? post.photos : [],
  media: Array.isArray(post?.media) ? post.media : [],
  mediaAssetIds: Array.isArray(post?.mediaAssetIds) ? post.mediaAssetIds : [],
  setlist: Array.isArray(post?.setlist) ? post.setlist : [],
  timeAgo: ago(post?.createdAt),
});

// Poll responses contain fresh objects even when the underlying post is exactly
// the same. Preserve the prior object in that case so a quiet feed refresh does
// not rerender every Context consumer or rewrite the persisted feed cache.
const sameServerPost = (a, b) => !!a && !!b
  && a.id === b.id
  && a.version === b.version
  && a.likes === b.likes
  && a.comments === b.comments
  && a.liked === b.liked
  && a.flags === b.flags
  && JSON.stringify(a.recommendation || null) === JSON.stringify(b.recommendation || null)
  && JSON.stringify(a.commentPreview || null) === JSON.stringify(b.commentPreview || null)
  && JSON.stringify(a.user || null) === JSON.stringify(b.user || null);

const demoUsers = [
  // NOTE: the real admin account lives ONLY on the server (server/index.js
  // seedAdmin), never ship admin credentials in the client bundle.
  { id: "u_demo", name: "Demo Fan", handle: "demo", home: { city: "San Francisco", lat: 37.7749, lng: -122.4194 }, email: "demo@example.com", password: "password123", role: "fan", initials: "DF", avatarColor: AV[2], avatarUri: null, bio: "Just here for the pit.", genres: ["Indie"], banner: null, nowPlaying: { title: "Not Strong Enough", artist: "boygenius" }, treble: { title: "Not Strong Enough", artist: "boygenius" }, bass: { title: "3D Country", artist: "Geese" }, playlists: [{ id: "pl1", name: "Front row faves", tracks: [{ title: "Be Sweet", artist: "Japanese Breakfast" }, { title: "$20", artist: "boygenius" }] }] },
  { id: "u_artist", name: "Turnstile", handle: "turnstile", home: { city: "Los Angeles", lat: 34.0522, lng: -118.2437 }, email: "band@turnstile.com", password: "password123", role: "artist", artistName: "Turnstile", initials: "TS", avatarColor: AV[1], avatarUri: null, bio: "GLOW ON. Official.", genres: ["Hardcore"], playlists: [] },
  { id: "u_mara", name: "Mara Quinn", handle: "maraq", home: { city: "San Francisco", lat: 37.7749, lng: -122.4194 }, email: "mara@example.com", password: "x", role: "fan", initials: "MQ", avatarColor: AV[1], avatarUri: null, bio: "Hardcore shows + disposable cameras.", genres: ["Hardcore", "Punk"], banner: null, nowPlaying: { title: "HEALING", artist: "Turnstile" }, treble: { title: "HEALING", artist: "Turnstile" }, bass: { title: "Do It Faster", artist: "Militarie Gun" }, playlists: [{ id: "pl2", name: "Two-step starters", tracks: [{ title: "HEALING", artist: "Turnstile" }, { title: "Do It Faster", artist: "Militarie Gun" }] }] },
  { id: "u_devon", name: "Devon Ash", handle: "dash", home: { city: "New York City", lat: 40.7128, lng: -74.006 }, email: "devon@example.com", password: "x", role: "fan", initials: "DA", avatarColor: AV[3], avatarUri: null, bio: "Indie sad boy. Will cry at the barricade.", genres: ["Indie", "Shoegaze"], playlists: [{ id: "pl3", name: "Cry at the barricade", tracks: [{ title: "Paprika", artist: "Japanese Breakfast" }, { title: "Pristine", artist: "Snail Mail" }] }] },
  { id: "u_priya", name: "Priya N.", handle: "priyalive", home: { city: "Denver", lat: 39.7392, lng: -104.9903 }, email: "priya@example.com", password: "x", role: "fan", initials: "PN", avatarColor: AV[4], avatarUri: null, bio: "Jam bands & amphitheaters.", genres: ["Psych Rock"], playlists: [] },
];
const seedUsers = demoSeed(demoUsers, []);

const now = Date.now();
const DAY = 86400000;
const demoTourDates = [
  { id: "t1", artist: "Turnstile", venue: "The Greek Theatre", place: "Los Angeles, California, United States", date: "2026 · 08 · 14", ticketUrl: "", releaseAt: now - DAY, createdBy: "u_artist" },
  { id: "t2", artist: "Geese", venue: "Brooklyn Steel", place: "Brooklyn, New York, United States", date: "2026 · 09 · 02", ticketUrl: "", releaseAt: now - DAY, createdBy: "u_admin" },
  { id: "t3", artist: "Japanese Breakfast", venue: "The Fillmore", place: "San Francisco, California, United States", date: "2026 · 10 · 11", ticketUrl: "", releaseAt: now - DAY, createdBy: "u_admin" },
  // a scheduled (not-yet-public) date the Turnstile team can see but fans can't:
  { id: "t4", artist: "Turnstile", venue: "Madison Square Garden", place: "New York City, New York, United States", date: "2026 · 12 · 31", ticketUrl: "", releaseAt: now + 7 * DAY, createdBy: "u_artist" },
  ...catalogTourDates,
];
const seedTourDates = demoSeed(demoTourDates, []);
const publicTourDateCache = (value, at = Date.now()) => {
  const accepted = sanitizeTourDates(value, ENABLE_DEMO_DATA);
  return ENABLE_DEMO_DATA ? accepted : accepted.filter((event) => {
    const releaseAt = Number(event?.releaseAt);
    return !Number.isFinite(releaseAt) || releaseAt <= at;
  });
};

const seedRequests = demoSeed(
  [{ id: "r1", userId: "u_demo", artistName: "Demo Band", note: "I front Demo Band, want to post our tour dates.", status: "pending" }],
  [],
);

export const isStaff = (role) => role === "admin";
// Moderators can moderate (reports, members, content) but not administer roles,
// see ad analytics, or approve artists, those stay admin-only. Discord-style tier.
export const isMod = (role) => role === "admin" || role === "moderator";
export const isArtist = (role) => role === "artist" || role === "admin";

// Popularity ranking for the Top-100 badge, computed once from the bundled
// catalog (Spotify popularity, tie-break followers). Names still missing a
// popularity score (not yet enriched) are simply unranked. Rebuilds on reload
// after each scrape refreshes the bundled catalog.
const ARTIST_RANK = (() => {
  const rows = Object.values(catalogArtists || {})
    .filter((a) => a && a.popularity != null)
    .sort((x, y) => (y.popularity - x.popularity) || ((y.followers || 0) - (x.followers || 0)));
  const m = new Map();
  rows.forEach((a, i) => m.set((a.name || "").toLowerCase(), i + 1));
  return m;
})();
export const artistRankOf = (name) => ARTIST_RANK.get((name || "").trim().toLowerCase()) || null;

// role → the official badge it earns (Pit team / moderator / verified artist).
export const roleBadge = (role) =>
  role === "admin" ? "staff" : role === "moderator" ? "mod" : role === "artist" ? "verified" : null;

// Bump when the Terms/Privacy change materially, so we can tell who consented to
// which version (recorded on the account at sign-up).
export const TERMS_VERSION = "2026-08";

const StoreContext = createContext(null);
export const useStore = () => useContext(StoreContext);

// State that survives a reload: hydrates from localStorage on init and writes back
// on every change. This is the offline cache (server hydration layers on top for
// signed-in accounts). Without it, interactions like joining a fan club, DMs, or
// "going" were dropped on refresh because they lived only in memory.
function usePersisted(key, seed) {
  const [value, setValue] = useState(() =>
    sanitizePersistedStoreValue(key, load(key, seed), ENABLE_DEMO_DATA));
  useEffect(() => { save(key, value); }, [key, value]);
  return [value, setValue];
}

// Message bodies, private requests, notifications, and taste memberships must
// not survive an account handoff in device-global storage. Production hydrates
// these from authenticated endpoints into memory; demo mode alone keeps its
// prototype continuity behavior. The mount scrub migrates legacy plaintext keys.
function usePrivateEphemeral(key, seed) {
  const empty = Array.isArray(seed) ? [] : {};
  const [value, setValue] = useState(() => ENABLE_DEMO_DATA
    ? sanitizePersistedStoreValue(key, load(key, seed), true)
    : empty);
  useEffect(() => {
    if (ENABLE_DEMO_DATA) save(key, value);
    else save(key, empty);
  }, [key, value]);
  return [value, setValue];
}

const RECENT_SEARCH_LEGACY_KEY = "pit.recentSearches";
const recentSearchStorageKey = (accountId) => accountId
  ? `pit.recentSearches.user.${encodeURIComponent(String(accountId))}`
  : "pit.recentSearches.guest";
const cleanRecentSearches = (stored) => Array.isArray(stored)
  ? stored.filter((entry) => entry && typeof entry.label === "string" && entry.label.trim()).slice(0, 8)
  : [];
const loadRecentSearches = (accountId) => {
  const scoped = load(recentSearchStorageKey(accountId), null);
  if (Array.isArray(scoped)) return cleanRecentSearches(scoped);
  // One-way compatibility migration: only a guest can inherit the legacy
  // device-global list. The provider's persistence effect writes the guest key.
  return accountId ? [] : cleanRecentSearches(load(RECENT_SEARCH_LEGACY_KEY, []));
};

export function StoreProvider({ children }) {
  // Hydrate the identity-critical state from storage so a refresh / new page keeps
  // you logged in and keeps your data. (See src/lib/persist.js.)
  const [users, setUsers] = useState(() =>
    sanitizePersistedStoreValue("pit.users", load("pit.users", seedUsers), ENABLE_DEMO_DATA));
  const [memberCount, setMemberCount] = useState(0); // total signed-up members (from the server)
  const [remoteArtists, setRemoteArtists] = useState({}); // norm -> meta, from the DB artist catalog API
  const [discoverySidebar, setDiscoverySidebar] = useState({ topArtists: [], trendingVenues: [], upcomingEvents: [], location: null, source: null });
  const [discoverySidebarStatus, setDiscoverySidebarStatus] = useState("loading");
  const [rewardProfiles, setRewardProfiles] = useState({}); // user id -> authoritative server rewards
  // The HttpOnly cookie, not local storage, owns identity. Production starts
  // locked until /api/me confirms it; otherwise a stale local account B and a
  // cookie for A can attribute B's personalized analytics/actions to A.
  const [session, setSession] = useState(() => ENABLE_DEMO_DATA
    ? sanitizePersistedStoreValue("pit.session", load("pit.session", null), true)
    : null);
  const sessionRef = useRef(session);
  const [authReady, setAuthReady] = useState(ENABLE_DEMO_DATA);
  const authReadyRef = useRef(ENABLE_DEMO_DATA);
  const authValidationSequenceRef = useRef(0);
  const accountMutationEpochRef = useRef(0);
  sessionRef.current = session;
  authReadyRef.current = authReady;
  const historyStorageKey = (userId = session?.id) => `pit.playhistory.${userId || "guest"}`;
  const [playHistory, setPlayHistory] = useState(() => load(historyStorageKey(), [])); // every song played, newest first
  const [playHistoryAccountId, setPlayHistoryAccountId] = useState(session?.id || null);
  const [playHistoryStatus, setPlayHistoryStatus] = useState(session?.id ? "loading" : "ready");
  const [playHistoryNextCursor, setPlayHistoryNextCursor] = useState(null);
  const playHistoryRequestRef = useRef({ sequence: 0, accountId: session?.id || null });
  const [privateListeningUntil, setPrivateListeningUntil] = useState(() => {
    const key = privateListeningStorageKey(session?.id);
    return key ? Number(load(key, 0)) || 0 : 0;
  });
  // Read the current account's scoped value during render as well as in the
  // synchronization effect. That closes the one-commit handoff window where a
  // newly adopted account could otherwise inherit the previous account's mode.
  const currentPrivateListeningKey = privateListeningStorageKey(session?.id);
  const currentPrivateListeningUntil = currentPrivateListeningKey
    ? Number(load(currentPrivateListeningKey, privateListeningUntil)) || 0
    : 0;
  const [snapshots, setSnapshots] = useState(() => ENABLE_DEMO_DATA ? load("pit.snapshots", []) : []); // private listening sessions stay memory-only in production
  const [drafts, setDrafts] = useState(() =>
    migrateLegacyDrafts(load("pit.drafts", []), session?.id)); // unfinished reviews, account-scoped on this device
  const draftsRef = useRef(drafts);
  const legacyDraftMigrationHandledRef = useRef(ENABLE_DEMO_DATA);
  draftsRef.current = drafts;
  useEffect(() => {
    if ((session?.id || null) === playHistoryAccountId) save(historyStorageKey(playHistoryAccountId), playHistory);
  }, [session?.id, playHistoryAccountId, playHistory]);
  useEffect(() => { save("pit.snapshots", ENABLE_DEMO_DATA ? snapshots : []); }, [snapshots]);
  useEffect(() => {
    const key = privateListeningStorageKey(session?.id);
    setPrivateListeningUntil(key ? Number(load(key, 0)) || 0 : 0);
  }, [session?.id]);
  useEffect(() => {
    if (!isPrivateListeningActive(currentPrivateListeningUntil)) return undefined;
    const delay = Math.max(1, currentPrivateListeningUntil - Date.now());
    const timer = setTimeout(() => {
      const key = privateListeningStorageKey(sessionRef.current?.id);
      if (key) save(key, 0);
      setPrivateListeningUntil(0);
    }, delay);
    return () => clearTimeout(timer);
  }, [currentPrivateListeningUntil]);
  const setPrivateListening = (enabled) => {
    const accountId = sessionRef.current?.id;
    const key = privateListeningStorageKey(accountId);
    if (!key) return { ok: false };
    const until = enabled ? startPrivateListening() : 0;
    save(key, until);
    setPrivateListeningUntil(until);
    return { ok: true, until };
  };
  const commitDrafts = (updater) => {
    const current = draftsRef.current;
    const next = typeof updater === "function" ? updater(current) : updater;
    draftsRef.current = next;
    // Composer backgrounding is a process-lifecycle boundary. Persist before
    // returning instead of waiting for React's post-render effect.
    save("pit.drafts", next);
    setDrafts(next);
    return next;
  };
  const resolveLegacyDraftsForIdentity = (accountId) => {
    if (legacyDraftMigrationHandledRef.current) return;
    legacyDraftMigrationHandledRef.current = true;
    commitDrafts((all) => resolveQuarantinedLegacyDrafts(
      all,
      accountId,
      LEGACY_PRODUCTION_SESSION_ACCOUNT_ID,
    ));
  };
  // Review drafts: save an unfinished log to resume later.
  const saveDraft = (d) => {
    const id = d.id || "draft_" + Date.now();
    const entry = { ...d, id, at: Date.now() };
    commitDrafts((all) => upsertAccountDraft(all, entry, session?.id));
    return id;
  };
  const deleteDraft = (id) => {
    const target = draftsRef.current.find((draft) => draft?.id === id && String(draft?.ownerId || "") === String(session?.id || ""));
    void releaseMediaDraftAssets(target?.mediaProject?.assets || []);
    return commitDrafts((all) => deleteAccountDraft(all, id, session?.id));
  };
  // Staff-only member fields never enter the device-wide, persisted `users`
  // profile cache. This collection is intentionally process-memory only and is
  // cleared whenever the staff identity or role changes.
  const [adminMembers, setAdminMembers] = useState([]);
  const adminMembersRef = useRef(adminMembers);
  adminMembersRef.current = adminMembers;
  const [adminStats, setAdminStats] = useState(emptyAdminStats); // admin member console stats
  const adminStatsRef = useRef(adminStats);
  adminStatsRef.current = adminStats;
  const [adminMemberDirectory, setAdminMemberDirectory] = useState(emptyAdminMemberDirectory);
  const adminMemberDirectoryRef = useRef(adminMemberDirectory);
  adminMemberDirectoryRef.current = adminMemberDirectory;
  // Production does not render a persisted personalized cache until the cookie
  // identity and server safety rules have been revalidated. This prevents a
  // removed/blocked card (or account A's taste reasons) flashing for account B.
  const [feed, setFeed] = useState(() => ENABLE_DEMO_DATA ? loadScopedFeed(session?.id) : []);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const feedAccountIdRef = useRef(session?.id || null);
  // Polling and mutations can finish out of order. A revision invalidates a
  // response that started before a local create/edit/like, while the request
  // state prevents overlapping refreshes from racing each other.
  const feedMutationRevisionRef = useRef(0);
  const feedRefreshRef = useRef({ inFlight: false, sequence: 0 });
  const feedModeRef = useRef("for-you");
  const feedAlgorithmRef = useRef("global-personal-v1");
  const feedSnapshotIdentityRef = useRef(null);
  const feedPageRef = useRef(1);
  const feedRevalidationOffsetRef = useRef(0);
  const [recommendationHiddenIds, setRecommendationHiddenIds] = useState(() => loadRecommendationHiddenIds(session?.id));
  const recommendationPreferenceRevisionRef = useRef(0);
  const recommendationPreferenceMutationsRef = useRef(null);
  if (!recommendationPreferenceMutationsRef.current) {
    recommendationPreferenceMutationsRef.current = createRecommendationPreferenceCoordinator();
  }
  const [removedIds, setRemovedIds] = useState([]);
  // Per-image moderation: individual photo URLs pulled from galleries. Reactive,
  // like the rest of moderation, but removing one photo backfills the gallery
  // from the next available source instead of leaving a hole.
  const [removedPhotos, setRemovedPhotos] = useState([]);
  const [requests, setRequests] = usePrivateEphemeral("pit.requests", seedRequests);
  // A scheduled artist batch is private until release. It can live in memory
  // for the authenticated owner, but only already-public rows may cross a
  // refresh/account boundary through device storage.
  const [tourDates, setTourDates] = useState(() => ENABLE_DEMO_DATA
    ? sanitizeTourDates(load("pit.tourDates", seedTourDates), true)
    : publicTourDateCache(load("pit.tourDates", [])));
  const tourDatesRef = useRef(tourDates);
  tourDatesRef.current = tourDates;
  const tourDateReadRef = useRef({ sequence: 0, accountId: session?.id || null });
  useEffect(() => { save("pit.tourDates", publicTourDateCache(tourDates)); }, [tourDates]);
  const [reports, setReports] = useState([]);
  const [moderationConsole, setModerationConsole] = useState(emptyModerationConsole);
  const moderationConsoleRef = useRef(moderationConsole);
  moderationConsoleRef.current = moderationConsole;
  const staffReadsRef = useRef(null);
  if (!staffReadsRef.current) staffReadsRef.current = createStaffReadCoordinator();
  const staffStateScopeRef = useRef(staffScopeFor(session));

  const resetStaffState = () => {
    staffReadsRef.current.reset();
    adminMembersRef.current = [];
    adminStatsRef.current = emptyAdminStats();
    adminMemberDirectoryRef.current = emptyAdminMemberDirectory();
    moderationConsoleRef.current = emptyModerationConsole();
    setAdminMembers([]);
    setAdminStats(adminStatsRef.current);
    setAdminMemberDirectory(adminMemberDirectoryRef.current);
    setModerationConsole(moderationConsoleRef.current);
    setReports([]);
  };

  // A role change is a privacy boundary even when the account id stays the
  // same (admin -> moderator must drop admin-only email-confirmation state).
  useEffect(() => {
    const nextScope = staffScopeFor(session);
    if (staffStateScopeRef.current !== nextScope) {
      resetStaffState();
      staffStateScopeRef.current = nextScope;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.role]);
  const [follows, setFollows] = useState(() =>
    sanitizePersistedStoreValue("pit.follows", load("pit.follows", demoSeed({ u_demo: ["u_mara", "u_devon"] }, {})), ENABLE_DEMO_DATA));
  const [blockedIds, setBlockedIds] = useState(() =>
    sanitizePersistedStoreValue("pit.blocked", load("pit.blocked", []), ENABLE_DEMO_DATA));
  const blockedIdsRef = useRef(blockedIds);
  blockedIdsRef.current = blockedIds;
  useEffect(() => { save("pit.blocked", blockedIds); }, [blockedIds]);
  // Afterparty: like + comment a concert (keyed by the concert/log id)
  const [comments, setComments] = usePersisted("pit.comments", demoSeed({
    log_1: [
      { id: "c1", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "The two-step during HEALING was unreal. Worth the bruises.", likes: 5 },
      { id: "c2", userId: "u_priya", name: "Priya N.", initials: "PN", text: "Back of the room sound was rough but the pit didn't care.", likes: 2 },
    ],
  }, {}));
  const [likes, setLikes] = usePersisted("pit.likes", demoSeed({ log_1: 42, log_2: 88, log_3: 156 }, {}));
  const [myLikes, setMyLikes] = usePersisted("pit.myLikes", {});

  // Concert Lounge: a gated, Discord-style chat per concert (keyed by concertKey)
  const [lounge, setLounge] = usePrivateEphemeral("pit.lounge", demoSeed({
    "turnstile|the fillmore|2026 · 06 · 21": [
      { id: "m1", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "anyone else lose a shoe in the pit lol", ts: "2h" },
      { id: "m2", userId: "u_priya", name: "Priya N.", initials: "PN", text: "the HEALING singalong gave me chills", ts: "2h" },
    ],
  }, {}));
  // Planned attendance ("Going") - per user, list of concert refs
  const [going, setGoing] = usePrivateEphemeral("pit.going", demoSeed({
    u_mara: [{ key: "geese|the independent|2026 · 08 · 26", artist: "Geese", venue: "The Independent", city: "San Francisco", date: "2026 · 08 · 26" }],
  }, {}));
  const goingRef = useRef(going);
  goingRef.current = going;
  const goingConfirmedRef = useRef(new Map());
  const goingIntentRef = useRef(null);
  if (!goingIntentRef.current) goingIntentRef.current = createGoingIntentCoordinator();
  const [goingPending, setGoingPending] = useState({});
  const goingPendingRef = useRef(goingPending);
  goingPendingRef.current = goingPending;
  const goingMutationRevisionRef = useRef(0);
  // Artist fan clubs: permanent chat per artist + membership
  const [fanClubMsgs, setFanClubMsgs] = usePrivateEphemeral("pit.fanClubMsgs", demoSeed({
    turnstile: [
      { id: "fc1", userId: "u_mara", name: "Mara Quinn", initials: "MQ", text: "GLOW ON changed my life, no notes", ts: "3h" },
      { id: "fc2", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "who's getting the MSG tickets??", ts: "1h" },
    ],
  }, {}));
  const [fanClubs, setFanClubs] = usePrivateEphemeral("pit.fanClubs", demoSeed({ u_demo: ["Turnstile"], u_mara: ["Turnstile", "Militarie Gun"] }, {}));
  // Server-truth member counts per fan club (slice 5), keyed by fcKey. Preferred
  // over the local-graph count when present so totals reflect everyone, not just
  // the users this browser happens to know about.
  const [fanClubMeta, setFanClubMeta] = useState({});
  const [fanClubDirectorySnapshot, setFanClubDirectorySnapshot] = useState([]);
  const [fanClubDirectoryStatus, setFanClubDirectoryStatus] = useState("idle");
  const fanClubDirectoryReadsRef = useRef(null);
  if (!fanClubDirectoryReadsRef.current) fanClubDirectoryReadsRef.current = createFanClubDirectoryReadCoordinator();
  // Artist-owned profile overrides (banner/avatar/bio/feedEnabled) + updates feed
  const [artistProfiles, setArtistProfiles] = usePersisted("pit.artistProfiles", demoSeed({
    turnstile: { feedEnabled: true },
  }, {}));
  const [artistPosts, setArtistPosts] = usePersisted("pit.artistPosts", demoSeed({
    turnstile: [{ id: "ap1", text: "New tour dates just dropped. MSG we're coming for you.", ts: "2d" }],
  }, {}));
  // Venue reviews are public, but the visible snapshot is personalized by
  // blocks/moderation. Keep each account's bounded cache separate so a shared
  // device cannot carry account A's hidden/visible rows into account B.
  const venueReviewsAccountIdRef = useRef(session?.id || null);
  const [venueReviews, setVenueReviews] = useState(() => {
    const key = venueReviewStorageKey(session?.id || null);
    return sanitizePersistedStoreValue(key, load(key, {}), ENABLE_DEMO_DATA);
  });
  useEffect(() => {
    save(venueReviewStorageKey(venueReviewsAccountIdRef.current), venueReviews);
  }, [venueReviews]);
  useEffect(() => { save("pit.venueReviews", {}); }, []);
  // Reaction counts are public; `mine` is account-private and is synchronously
  // reset by adoptFeedAccount before a new identity can render.
  const [mediaReactions, setMediaReactions] = useState({});
  const mediaReactionsAccountIdRef = useRef(session?.id || null);
  // Only pools for venues this session actually opens. The 2.1 MB seed stays on
  // the server; this LRU is capped at 32 normalized pools and expires after 15m.
  const [venuePhotoPools, setVenuePhotoPools] = useState({});
  const venuePhotoCacheRef = useRef(new Map());
  const venuePhotoInflightRef = useRef(new Map());
  // Direct messages - keyed by the sorted pair of user ids; plus read markers.
  const [dms, setDms] = usePrivateEphemeral("pit.dms", demoSeed({
    u_demo__u_mara: [
      { id: "dm1", from: "u_mara", text: "yo are you going to the Geese show?", ts: "1d" },
      { id: "dm2", from: "u_demo", text: "trying to get tickets! you?", ts: "1d" },
      { id: "dm3", from: "u_mara", text: "got mine. @priyalive is coming too", ts: "23h" },
    ],
    // A message from someone the demo user doesn't follow and hasn't replied to
    // yet, lands in Requests, not the main inbox. Reply to promote it.
    u_demo__u_priya: [
      { id: "dm4", from: "u_priya", text: "hey! saw you were at the Fillmore show too, small world", ts: "3h" },
    ],
  }, {}));
  const [dmRead, setDmRead] = usePrivateEphemeral("pit.dmRead", {});
  // Pending/failed authored bodies are intentionally memory-only. Confirmed
  // rows continue through the existing private ephemeral caches, but an outbox
  // must never be written to device storage (including in prototype/demo mode).
  const [chatOutbox, setChatOutboxState] = useState([]);
  const chatOutboxRef = useRef([]);
  const commitChatOutbox = (updater) => {
    const next = typeof updater === "function" ? updater(chatOutboxRef.current) : updater;
    chatOutboxRef.current = Array.isArray(next) ? next : [];
    setChatOutboxState(chatOutboxRef.current);
    return chatOutboxRef.current;
  };
  const chatReadsRef = useRef(null);
  if (!chatReadsRef.current) chatReadsRef.current = createAccountReadCoordinator();
  const [chatAuthEpoch, setChatAuthEpoch] = useState(0);
  const chatAuthEpochRef = useRef(0);
  // Notifications / activity, the social heartbeat. Each item is addressed to a
  // recipient (userId) and generated when someone acts on their content/graph.
  const [notifications, setNotifications] = usePrivateEphemeral("pit.notifications", demoSeed([
    { id: "nf1", userId: "u_demo", type: "follow", actorId: "u_mara", actorName: "Mara Quinn", actorInitials: "MQ", ts: Date.now() - 3600000, read: false },
    { id: "nf2", userId: "u_demo", type: "like", actorId: "u_devon", actorName: "Devon Ash", actorInitials: "DA", postId: "log_1", artist: "Turnstile", ts: Date.now() - 7200000, read: false },
    { id: "nf3", userId: "u_demo", type: "comment", actorId: "u_priya", actorName: "Priya N.", actorInitials: "PN", postId: "log_1", artist: "Turnstile", ts: Date.now() - 10800000, read: true },
  ], []));
  // Album + song ratings (stand-in for stream data) keyed by artist|title
  const [albumRatings, setAlbumRatings] = usePersisted("pit.albumRatings", demoSeed({ "turnstile|glow on": { u_mara: 5, u_devon: 4.5 }, "turnstile|never enough": { u_mara: 4 } }, {}));
  const [songRatings, setSongRatings] = usePersisted("pit.songRatings", demoSeed({ "turnstile|healing": { u_mara: 5, u_demo: 5 } }, {}));
  // Server-truth rating aggregates keyed by `${kind}|${ref}` (slice 7).
  const [ratingAgg, setRatingAgg] = useState({});
  const [feedNextCursor, setFeedNextCursor] = useState(null);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const feedLoadMoreRef = useRef(false);

  // Persist identity + continuity state so a refresh doesn't wipe your session,
  // account, posts, or follows.
  // A production identity is owned by the HttpOnly cookie. Persisting transient
  // validation state under the same key used for cross-tab signalling created a
  // two-tab null/user ping-pong. Demo mode alone keeps the local prototype key.
  useEffect(() => { if (ENABLE_DEMO_DATA) save("pit.session", session); }, [session]);
  useEffect(() => save("pit.users", ENABLE_DEMO_DATA
    ? users
    : users.map(publicProfileCacheEntry).filter(Boolean)), [users]);
  // localStorage is synchronous on browsers. Persist only a bounded continuity
  // window so a long scrolling session cannot turn every like/poll into a large
  // main-thread JSON serialization on a phone.
  useEffect(() => save(feedStorageKey(feedAccountIdRef.current), feed.slice(0, PERSISTED_FEED_LIMIT)), [feed]);
  const adoptFeedAccount = (nextAccountId) => {
    if (nextAccountId === feedAccountIdRef.current) return;
    accountMutationEpochRef.current += 1;
    tourDateReadRef.current.sequence += 1;
    tourDateReadRef.current.accountId = nextAccountId;
    if (!ENABLE_DEMO_DATA) {
      const publicDates = publicTourDateCache(tourDatesRef.current);
      tourDatesRef.current = publicDates;
      setTourDates(publicDates);
    }
    goingIntentRef.current.reset();
    goingConfirmedRef.current.clear();
    goingMutationRevisionRef.current += 1;
    goingPendingRef.current = {};
    setGoingPending({});
    // This is the synchronous privacy boundary for chat. Resetting the read
    // epoch rejects every prior response before React commits the new session;
    // changing the exposed epoch also remounts each screen's polling loop.
    chatReadsRef.current.reset();
    chatAuthEpochRef.current += 1;
    setChatAuthEpoch(chatAuthEpochRef.current);
    commitChatOutbox([]);
    fanClubDirectoryReadsRef.current.reset();
    setMediaReactions((current) => mediaReactionsForAccountTransition(
      current,
      mediaReactionsAccountIdRef.current,
      nextAccountId,
    ));
    mediaReactionsAccountIdRef.current = nextAccountId;
    venueReviewsAccountIdRef.current = nextAccountId;
    const venueKey = venueReviewStorageKey(nextAccountId);
    setVenueReviews(sanitizePersistedStoreValue(venueKey, load(venueKey, {}), ENABLE_DEMO_DATA));
    feedAccountIdRef.current = nextAccountId;
    feedRefreshRef.current.sequence += 1;
    feedRefreshRef.current.inFlight = false;
    feedLoadMoreRef.current = false;
    feedModeRef.current = "for-you";
    feedAlgorithmRef.current = "global-personal-v1";
    feedSnapshotIdentityRef.current = null;
    feedPageRef.current = 1;
    feedRevalidationOffsetRef.current = 0;
    recommendationPreferenceRevisionRef.current += 1;
    setRecommendationHiddenIds(loadRecommendationHiddenIds(nextAccountId));
    setFeed(ENABLE_DEMO_DATA ? loadScopedFeed(nextAccountId) : []);
    setFeedNextCursor(null);
    setFeedHasMore(true);
    setFeedLoadingMore(false);
    setMyLikes({});
    blockedIdsRef.current = [];
    setBlockedIds([]);
    if (!ENABLE_DEMO_DATA) {
      setRequests([]);
      setLounge({});
      goingRef.current = {};
      setGoing({});
      setFanClubMsgs({});
      setFanClubs({});
      setDms({});
      setDmRead({});
      setNotifications([]);
      setSnapshots([]);
    }
    if (!ENABLE_DEMO_DATA) setUsers((current) => current.map(publicProfileCacheEntry).filter(Boolean));
  };
  useEffect(() => {
    const nextAccountId = session?.id || null;
    adoptFeedAccount(nextAccountId);
  }, [session?.id]);
  useEffect(() => {
    const accountId = session?.id;
    if (!accountId) {
      setRecommendationHiddenIds(new Set());
      return undefined;
    }
    const preferenceRevision = recommendationPreferenceRevisionRef.current;
    const controller = new AbortController();
    api("/api/feed/preferences", { signal: controller.signal, silent: true, context: "Loading your feed preferences" })
      .then(({ hiddenPostIds }) => {
        if (!controller.signal.aborted && sessionRef.current?.id === accountId
          && recommendationPreferenceRevisionRef.current === preferenceRevision) {
          const ids = (hiddenPostIds || []).filter((id) => typeof id === "string");
          save(recommendationPreferenceStorageKey(accountId), ids);
          setRecommendationHiddenIds(new Set(ids));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [session?.id]);
  useEffect(() => save("pit.follows", follows), [follows]);
  useEffect(() => () => {
    for (const request of venuePhotoInflightRef.current.values()) request.controller.abort();
    venuePhotoInflightRef.current.clear();
  }, []);

  // A local theme only wins when it belongs to THIS account. The previous global
  // device choice leaked one member's appearance into the next member's session
  // on a shared browser. Account ownership keeps reload-loop protection without
  // treating the computer itself as the user.
  useEffect(() => {
    if (!session?.theme) return;
    const { theme: localTheme, ownerId } = storedThemeSelection();
    if (localTheme && ownerId === session.id) {
      if (session.theme !== localTheme) api("/api/me", { method: "PATCH", body: { theme: localTheme } }).catch(() => {});
    } else {
      syncThemeFromAccount(session.theme, session.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.theme]);
  // Keep the current user's playlists loaded (for the "add to playlist" picker + profile).
  useEffect(() => { loadMyPlaylists(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session?.id]);

  // --- SQLite migration slices 2 & 3: public feed + likes/comments -----------
  // Pull server posts (with current counts and viewer-like state) and upsert them
  // into the local cache. Existing IDs must be replaced, not skipped, otherwise
  // edits and cross-device likes/comments remain stale forever.
  const mergeServerFeed = (posts, { prepend = true, preserveOrder = false, authoritative = false } = {}) => {
    if (!Array.isArray(posts) || !posts.length) return;
    const incoming = posts.map(normalizeServerPost);
    setFeed((current) => {
      const currentById = new Map(current.map((post) => [post.id, post]));
      const normalized = incoming.map((post) => {
        const previous = currentById.get(post.id);
        return sameServerPost(previous, post) ? previous : post;
      });
      const serverIds = new Set(normalized.map((post) => post.id));
      const remaining = current.filter((post) => !serverIds.has(post.id)
        && (!authoritative || post.pending || String(post.id || "").startsWith("p_local_")));
      let next;
      if (preserveOrder) {
        const byId = new Map(normalized.map((post) => [post.id, post]));
        const replaced = current.map((post) => byId.get(post.id) || post);
        const existingIds = new Set(current.map((post) => post.id));
        const missing = normalized.filter((post) => !existingIds.has(post.id));
        next = [...replaced, ...missing].sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
      } else {
        next = prepend ? [...normalized, ...remaining] : [...remaining, ...normalized];
      }
      return next.length === current.length && next.every((post, index) => post === current[index]) ? current : next;
    });
    // Like model: likes[id] is the count EXCLUDING the viewer; myLikes[id] is
    // their own toggle. The server total includes me, so subtract it back out.
    setLikes((current) => {
      const next = { ...current };
      let changed = false;
      incoming.forEach((post) => {
        const value = (post.likes || 0) - (post.liked ? 1 : 0);
        if (next[post.id] !== value) { next[post.id] = value; changed = true; }
      });
      return changed ? next : current;
    });
    setMyLikes((current) => {
      const next = { ...current };
      let changed = false;
      incoming.forEach((post) => {
        const value = !!post.liked;
        if (next[post.id] !== value) { next[post.id] = value; changed = true; }
      });
      return changed ? next : current;
    });
  };

  const hydrateFeed = async ({ resetPagination = true, signal } = {}) => {
    const refresh = feedRefreshRef.current;
    if (refresh.inFlight) return null;
    const sequence = ++refresh.sequence;
    const mutationRevision = feedMutationRevisionRef.current;
    refresh.inFlight = true;
    try {
      const startedAt = Date.now();
      let payload;
      let fallback = false;
      try {
        payload = await api(`/api/feed/for-you?limit=${FEED_PAGE_LIMIT}`, {
          context: "Refreshing your recommended concert feed",
          silent: true,
          signal,
        });
        feedModeRef.current = "for-you";
        feedAlgorithmRef.current = payload?.algorithm?.id || "global-personal-v1";
      } catch (error) {
        if (signal?.aborted) throw error;
        fallback = true;
        payload = await api(`/api/feed?limit=${FEED_PAGE_LIMIT}`, {
          context: "Loading the chronological concert feed",
          silent: true,
          signal,
        });
        feedModeRef.current = "legacy";
        feedAlgorithmRef.current = "chronological-v1";
      }
      const { posts, nextCursor } = payload || {};
      // A create/edit/like that happened after this read began is newer than the
      // response. Ignore the response and let the next poll reconcile it.
      if (signal?.aborted || sequence !== refresh.sequence || mutationRevision !== feedMutationRevisionRef.current) return null;
      // The initial server page is authoritative for a production cache. Demo
      // mode keeps its bundled cards alongside the live page for prototyping.
      mergeServerFeed(posts, { prepend: true, authoritative: resetPagination && !ENABLE_DEMO_DATA });
      const snapshotAt = Number(payload?.algorithm?.snapshotAt);
      const snapshotIdentity = feedModeRef.current === "for-you" && Number.isFinite(snapshotAt)
        ? `for-you:${snapshotAt}`
        : `legacy:${Array.isArray(posts) && posts[0]?.id ? posts[0].id : "empty"}`;
      // Quiet polls reuse the immutable snapshot and must not rewind somebody
      // who has loaded older pages. A genuinely new head adopts its matching
      // cursor atomically, making newly published posts visible without a reload
      // while keeping subsequent pagination inside one snapshot.
      if (resetPagination || feedSnapshotIdentityRef.current !== snapshotIdentity) {
        feedSnapshotIdentityRef.current = snapshotIdentity;
        setFeedNextCursor(nextCursor || null);
        setFeedHasMore(!!nextCursor);
        feedPageRef.current = 1;
      }
      trackProductEvent("feed_request", { surface: "everyone", algorithm: feedAlgorithmRef.current, page: 1, fallback });
      trackProductEvent("performance", {
        metric: "feed_load",
        durationBucket: analyticsDurationBucket(Date.now() - startedAt),
        surface: "everyone",
        outcome: "ok",
      });
      return true;
    } catch {
      if (!signal?.aborted) trackProductEvent("performance", {
        metric: "feed_load",
        durationBucket: "over_5s",
        surface: "everyone",
        outcome: "error",
      });
      return signal?.aborted ? null : false;
    } finally {
      if (sequence === refresh.sequence) refresh.inFlight = false;
    }
  };
  const loadMoreFeed = async () => {
    // React state does not update until the next render. FlatList may fire
    // onEndReached more than once in that window, so use an immediate lock too.
    if (feedLoadMoreRef.current || feedLoadingMore || !feedHasMore || !feedNextCursor) return false;
    feedLoadMoreRef.current = true;
    setFeedLoadingMore(true);
    const startedAt = Date.now();
    try {
      let payload;
      let fallback = false;
      if (feedModeRef.current === "for-you") {
        try {
          payload = await api(`/api/feed/for-you?limit=${FEED_PAGE_LIMIT}&cursor=${encodeURIComponent(feedNextCursor)}`, {
            context: "Loading more recommended concert posts",
            silent: true,
          });
          feedAlgorithmRef.current = payload?.algorithm?.id || feedAlgorithmRef.current;
        } catch {
          // Recommendation cursors are intentionally incompatible with the
          // chronological endpoint. Preserve existing card positions while a
          // legacy first page establishes a compatible cursor.
          fallback = true;
          payload = await api(`/api/feed?limit=${FEED_PAGE_LIMIT}`, {
            context: "Loading the chronological concert feed",
            silent: true,
          });
          feedModeRef.current = "legacy";
          feedAlgorithmRef.current = "chronological-v1";
        }
      } else {
        payload = await api(`/api/feed?limit=${FEED_PAGE_LIMIT}&before=${encodeURIComponent(feedNextCursor)}`, {
          context: "Loading more concert reviews",
          silent: true,
        });
      }
      const { posts, nextCursor } = payload || {};
      mergeServerFeed(posts, { prepend: false, preserveOrder: fallback });
      setFeedNextCursor(nextCursor || null);
      setFeedHasMore(!!nextCursor);
      feedPageRef.current += 1;
      trackProductEvent("feed_request", { surface: "everyone", algorithm: feedAlgorithmRef.current, page: feedPageRef.current, fallback });
      trackProductEvent("performance", {
        metric: "feed_next_page",
        durationBucket: analyticsDurationBucket(Date.now() - startedAt),
        surface: "everyone",
        outcome: "ok",
      });
      return true;
    } catch {
      trackProductEvent("performance", {
        metric: "feed_next_page",
        durationBucket: analyticsDurationBucket(Date.now() - startedAt),
        surface: "everyone",
        outcome: "error",
      });
      return false;
    } finally {
      feedLoadMoreRef.current = false;
      setFeedLoadingMore(false);
    }
  };
  const revalidateCachedFeed = async ({ signal } = {}) => {
    const accountId = sessionRef.current?.id || null;
    const allIds = feedRef.current.map((post) => post?.id)
      .filter((id) => typeof id === "string" && /^p_[A-Za-z0-9_-]{1,77}$/.test(id));
    const start = allIds.length ? feedRevalidationOffsetRef.current % allIds.length : 0;
    const ids = [...allIds.slice(start), ...allIds.slice(0, start)].slice(0, 200);
    feedRevalidationOffsetRef.current = allIds.length ? (start + ids.length) % allIds.length : 0;
    if (!ids.length) return true;
    try {
      const { invalidPostIds } = await api("/api/feed/revalidate", {
        method: "POST",
        body: { postIds: ids },
        expectedAccountId: accountId,
        context: "Checking feed safety updates",
        silent: true,
        signal,
      });
      if (signal?.aborted || (sessionRef.current?.id || null) !== accountId) return null;
      const invalid = new Set(Array.isArray(invalidPostIds) ? invalidPostIds : []);
      if (invalid.size) {
        feedMutationRevisionRef.current += 1;
        setFeed((current) => current.filter((post) => !invalid.has(post.id)));
        setRemovedIds((current) => [...new Set([...current, ...invalid])]);
      }
      return true;
    } catch {
      return signal?.aborted ? null : false;
    }
  };

  // Clips reel (the vertical swipe-through of posted videos). Cursor-paginated
  // off the same feed ordering; `reset` reloads from the top, otherwise it
  // appends the next page. Returns the merged list so the screen can swap in
  // one setState.
  const loadClips = async ({ before, signal } = {}) => {
    try {
      const q = before ? `?limit=12&before=${encodeURIComponent(before)}` : "?limit=12";
      const { clips, nextCursor } = await api("/api/clips" + q, { context: "Loading concert clips", silent: true, signal });
      return { ok: true, clips: Array.isArray(clips) ? clips.map((c) => normalizeServerPost(c)) : [], nextCursor: nextCursor || null };
    } catch (error) { return { ok: false, clips: [], nextCursor: before || null, error }; }
  };

  // Keep the public feed fresh without requiring a browser reload. Refreshes
  // pause in the background, abort on unmount, back off after failures, and do
  // not reset the older-page cursor after the initial load.
  useEffect(() => {
    let stopped = false;
    let timer = null;
    let delay = FEED_REFRESH_MS;
    const controller = new AbortController();
    const canRefresh = () => {
      if (Platform.OS === "web" && typeof document !== "undefined" && document.hidden) return false;
      return Platform.OS === "web" || AppState.currentState == null || AppState.currentState === "active";
    };
    const schedule = (ms) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => run(false), ms);
    };
    const run = async (initial) => {
      if (stopped) return;
      if (!canRefresh()) return;
      // Re-read the head as well as tombstoning cached IDs. The server reuses a
      // quiet snapshot cheaply and creates a fresh one only after a post is
      // published, so an open session can receive new community activity.
      let result = await hydrateFeed({ resetPagination: initial, signal: controller.signal });
      if (!initial && result === true) {
        const revalidated = await revalidateCachedFeed({ signal: controller.signal });
        if (revalidated !== true) result = revalidated;
      }
      if (stopped) return;
      if (result === true) delay = FEED_REFRESH_MS;
      else if (result === false) delay = Math.min(delay * 2, FEED_REFRESH_MAX_BACKOFF_MS);
      schedule(delay);
    };
    const wake = () => schedule(0);
    const appStateSubscription = AppState.addEventListener("change", (state) => { if (state === "active") wake(); });
    run(true);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
      feedRefreshRef.current.sequence += 1;
      feedRefreshRef.current.inFlight = false;
      appStateSubscription?.remove?.();
    };
    // Restart immediately when account scope changes. The cleanup aborts the old
    // viewer's request before the new personalized cache can accept a response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Canonical server snapshot, re-read at every authenticated scope boundary so
  // an owner's scheduled dates appear on a new device and disappear before a
  // different account can render. Empty snapshots are authoritative too.
  useEffect(() => {
    if (!authReady) return undefined;
    const controller = new AbortController();
    const accountId = session?.id || null;
    const sequence = ++tourDateReadRef.current.sequence;
    tourDateReadRef.current.accountId = accountId;
    api("/api/tourdates", { signal: controller.signal, silent: true, context: "Loading tour dates" })
      .then(({ tourDates: live }) => {
        if (controller.signal.aborted || tourDateReadRef.current.sequence !== sequence
          || tourDateReadRef.current.accountId !== accountId
          || (sessionRef.current?.id || null) !== accountId) return;
        const accepted = sanitizeTourDates(live, ENABLE_DEMO_DATA);
        const next = ENABLE_DEMO_DATA
          ? [...new Map([...accepted, ...tourDatesRef.current].map((event) => [event.id, event])).values()]
          : accepted;
        tourDatesRef.current = next;
        setTourDates(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [authReady, session?.id]);

  // The server ranks real provider dates against the signed-in account's saved
  // location and widens gracefully if the exact city has no upcoming listings.
  useEffect(() => {
    let active = true;
    setDiscoverySidebarStatus("loading");
    api("/api/discovery/sidebar", { context: "Loading your local concert lineup", silent: true })
      .then((data) => {
        if (!active) return;
        const next = {
          topArtists: Array.isArray(data?.topArtists) ? data.topArtists : [],
          trendingVenues: Array.isArray(data?.trendingVenues) ? data.trendingVenues : [],
          upcomingEvents: Array.isArray(data?.upcomingEvents) ? data.upcomingEvents : [],
          location: data?.location || null,
          source: data?.source || null,
        };
        setDiscoverySidebar(next);
        setDiscoverySidebarStatus("ready");
        if (next.upcomingEvents.length) {
          setTourDates((current) => {
            const byId = new Map(current.map((event) => [event.id, event]));
            next.upcomingEvents.forEach((event) => byId.set(event.id, { ...(byId.get(event.id) || {}), ...event }));
            const merged = [...byId.values()];
            tourDatesRef.current = merged;
            return merged;
          });
        }
      })
      .catch(() => { if (active) setDiscoverySidebarStatus("error"); });
    return () => { active = false; };
  }, [session?.id, session?.home?.city, session?.home?.lat, session?.home?.lng]);

  // --- Privacy-safe first-party product analytics ----------------------------
  // The facade sanitizes before a durable retry batch is written, while the API
  // independently applies the same allow-list. Authored text, searches, DMs and
  // media URLs therefore never enter either queue. Guests and opted-out accounts
  // are not profiled.
  const track = (name, props = {}, options = {}) => {
    // Child screen effects can run before this provider's passive effect on a
    // persisted session. Configure synchronously at the facade boundary so the
    // first screen_view is not marked seen and then silently dropped.
    configureProductAnalytics(sessionRef.current);
    return trackProductEvent(name, props, options);
  };
  const analyticsAccountRef = useRef(null);
  useEffect(() => {
    configureProductAnalytics(session);
    if (session?.id && (session?.analyticsConsentAt || session?.consentAt) && !session?.analyticsOptOut && analyticsAccountRef.current !== session.id) {
      trackProductEvent("app_open", {
        platform: productAnalyticsPlatform(),
        entry: analyticsAccountRef.current == null ? "launch" : "login",
      });
    }
    analyticsAccountRef.current = session?.id || null;
  }, [session?.id, session?.analyticsConsentAt, session?.consentAt, session?.analyticsOptOut]);
  useEffect(() => installProductAnalyticsLifecycle(), []);

  const userById = (id) => users.find((u) => u.id === id);
  const userByHandle = (h) => users.find((u) => u.handle === h);
  const logsByUser = (id) => feed.filter((l) => l.userId === id);

  // "Crossed paths", shows YOU and another user have BOTH logged (same exact
  // performance: artist + venue + date). The overlap tracker: "this person's been
  // to N of the same concerts as you." Returns the list of shared performances,
  // most recent first. Also exposes the set of artists you've both seen live.
  const sharedShows = (otherId) => {
    const me = session?.id;
    if (!me || !otherId || me === otherId) return { shows: [], artists: [] };
    const mine = new Map();
    logsByUser(me).forEach((l) => mine.set(concertKey(l), l));
    const shows = [];
    const seen = new Set();
    const artists = new Set();
    const myArtists = new Set(logsByUser(me).map((l) => norm(l.artist)));
    logsByUser(otherId).forEach((l) => {
      const k = concertKey(l);
      if (mine.has(k) && !seen.has(k)) { seen.add(k); shows.push(mine.get(k)); }
      if (myArtists.has(norm(l.artist))) artists.add(l.artist);
    });
    shows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return { shows, artists: [...artists] };
  };

  // Merge found users (people search) into local state so their profiles, avatars,
  // and follow buttons resolve everywhere, without touching the session.
  const absorbUsers = (list) => {
    if (!Array.isArray(list) || !list.length) return;
    setUsers((all) => {
      let next = all;
      for (const su of list) {
        if (!su?.id) continue;
        const publicSu = ENABLE_DEMO_DATA ? { playlists: [], genres: [], favoriteArtists: [], ...su } : publicProfileCacheEntry(su);
        const i = next.findIndex((x) => x.id === su.id);
        if (i === -1) next = [...next, publicSu];
        else next = next.map((x, j) => (j === i ? { ...x, ...publicSu } : x)); // refresh stale public profile data
      }
      return next;
    });
  };
  // Server-truth follower/following counts per user (the local follows map only
  // ever knows the graph this device has seen; these are the real numbers).
  const [userStats, setUserStats] = useState({});
  // Fetch one user from the server and absorb them, so ANY profile can open (a
  // follower from a notification, a handle in a comment) even if this device has
  // never seen them. Returns the user or null (deleted / no such account).
  const loadUser = async (id) => {
    if (!id) return null;
    try {
      const { user: su, followers, following, isFollowing: fol } = await api(`/api/users/${id}`);
      if (!su) return null;
      absorbUsers([su]);
      setUserStats((m) => ({ ...m, [su.id]: { followers: followers || 0, following: following || 0 } }));
      // Sync my follow state for this person (another device may have followed).
      if (session && fol && !(follows[session.id] || []).includes(su.id)) {
        setFollows((f) => ({ ...f, [session.id]: [...new Set([...(f[session.id] || []), su.id])] }));
      }
      // A profile is a user's complete wall, not merely the subset already in
      // the first global feed page. Merge its bounded server-backed post list.
      api(`/api/users/${encodeURIComponent(id)}/posts`, { context: "Loading profile posts", silent: true })
        .then(({ posts }) => mergeServerFeed(posts, { preserveOrder: true }))
        .catch(() => {});
      return su;
    } catch { return null; }
  };
  // Recent searches are device-local but identity-scoped. The old global key is
  // eligible to seed the guest bucket only; a signed-in account must never see
  // searches left by a guest or another account on this browser.
  const recentSearchAccountId = session?.id || null;
  const recentSearchScope = recentSearchAccountId ? `user:${recentSearchAccountId}` : "guest";
  const [recentSearchState, setRecentSearchState] = useState(() => ({
    scope: recentSearchScope,
    entries: loadRecentSearches(recentSearchAccountId),
  }));
  const recentSearches = recentSearchState.scope === recentSearchScope ? recentSearchState.entries : [];
  const setRecentSearches = (updater) => {
    setRecentSearchState((current) => {
      const entries = current.scope === recentSearchScope
        ? current.entries
        : loadRecentSearches(recentSearchAccountId);
      const next = typeof updater === "function" ? updater(entries) : updater;
      return { scope: recentSearchScope, entries: cleanRecentSearches(next) };
    });
  };
  useEffect(() => {
    setRecentSearchState((current) => current.scope === recentSearchScope
      ? current
      : { scope: recentSearchScope, entries: loadRecentSearches(recentSearchAccountId) });
  }, [recentSearchScope]);
  useEffect(() => {
    if (recentSearchState.scope === recentSearchScope) {
      save(recentSearchStorageKey(recentSearchAccountId), recentSearchState.entries);
    }
  }, [recentSearchAccountId, recentSearchScope, recentSearchState]);
  const addRecentSearch = (entry) => {
    if (!entry || !entry.label) return;
    const type = entry.type || "query";
    const key = `${type}:${String(entry.label).toLowerCase()}`;
    setRecentSearches((list) => [
      { type, label: String(entry.label).slice(0, 80), id: entry.id || null, sub: entry.sub || null, at: Date.now() },
      ...list.filter((e) => `${e.type || "query"}:${String(e.label).toLowerCase()}` !== key),
    ].slice(0, 8));
  };
  const removeRecentSearch = (label, type = "query") => {
    const key = `${type}:${String(label).toLowerCase()}`;
    setRecentSearches((list) => list.filter((e) => `${e.type || "query"}:${String(e.label).toLowerCase()}` !== key));
  };
  const clearRecentSearches = () => setRecentSearches([]);
  // Search users by name/handle on the server (cross-device friend finding).
  // Also captures the member count (`total`) so the app can show a real stat.
  const searchPeople = async (q, { signal } = {}) => {
    const accountId = sessionRef.current?.id || null;
    try {
      const { users: found, total } = await api(`/api/people?q=${encodeURIComponent(q || "")}`, { signal, silent: true, context: "Searching people" });
      if (signal?.aborted || (sessionRef.current?.id || null) !== accountId) return [];
      const blocked = new Set(blockedIdsRef.current.map(String));
      const visible = (found || []).filter((u) => u?.id && !blocked.has(String(u.id)));
      absorbUsers(visible);
      if (typeof total === "number") setMemberCount(total);
      // Belt-and-suspenders: hide anyone I've blocked immediately, even before the
      // server's own block filter (which needs my block to have persisted).
      return visible;
    } catch { return []; }
  };
  // Browse the member directory (newest first), used when the search box is empty
  // so you can find people without knowing their exact handle.
  const loadMembers = () => searchPeople("");

  // --- DB-backed artist catalog (scales past the bundled JSON) ---------------
  // Cache artist metadata pulled from the server so it resolves everywhere.
  const cacheArtists = (list) => {
    if (!Array.isArray(list) || !list.length) return;
    setRemoteArtists((m) => {
      const n = { ...m };
      for (const a of list) if (a?.name) n[norm(a.name)] = a;
      return n;
    });
  };
  // Search the DB catalog (notable-first). Powers Search so ANY catalog artist is
  // findable, not just the ~1.6k bundled ones.
  const searchArtistsApi = async (query, { signal } = {}) => {
    try { const { artists } = await api(`/api/artists?q=${encodeURIComponent(query || "")}`, { signal, silent: true, context: "Searching artists" }); cacheArtists(artists); return artists || []; }
    catch { return []; }
  };
  // Song search for the search box, so not knowing the artist is no longer a
  // dead end. Server-side this is Deezer (keyless), so it costs no YouTube
  // quota; playback resolves a video only when a result is actually played.
  const searchSongsApi = async (query, { signal } = {}) => {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    try { const { songs } = await api(`/api/songs/search?q=${encodeURIComponent(q)}`, { signal, silent: true, context: "Searching songs" }); return songs || []; }
    catch { return []; }
  };
  // Resolve one artist by name, creates it from MusicBrainz on the server if it's
  // not in the catalog yet, so no artist page is ever empty. Cached client-side.
  const resolveArtist = async (name) => {
    const k = norm(name);
    if (remoteArtists[k]) return remoteArtists[k];
    try { const { artist } = await api(`/api/artists/resolve?name=${encodeURIComponent(name)}`); if (artist) cacheArtists([artist]); return artist || null; }
    catch { return null; }
  };
  const remoteArtistMeta = (name) => remoteArtists[norm(name)] || null;
  // Full discography (albums + tracklists) from the server (Deezer-backed).
  const artistDiscography = async (name) => {
    try { return await api(`/api/artists/discography?name=${encodeURIComponent(name)}`); } catch { return { albums: [] }; }
  };
  // Resolve a track title (+ artist) to a YouTube video ID, so the in-app player
  // streams the full song/video for everyone. The server performs identity and
  // quality scoring; this small client cache never outlives the session for long.
  const ytCache = useRef({});
  // Resolve a song to a YouTube video, retrying the failures that deserve it.
  //
  // This used to be one attempt, and any failure — a timeout, a 429 from our own
  // rate limiter, the daily search budget being spent — returned null and was
  // cached as "no video" for five minutes. The player has no way to tell that
  // apart from "this song genuinely has no upload", so it played a 30-second
  // preview and never tried again. That is why obviously-available songs kept
  // coming out as previews. See src/domain/playback.mjs for the policy.
  const resolveYouTube = async (title, artist, duration = 0, { force = false } = {}) => {
    if (!title) return null;
    const tupleKey = trackTupleKey(title, artist);
    const k = youtubeLookupCacheKey(title, artist, sessionRef.current);
    const hit = ytCache.current[k];
    // `force` is for the player's background upgrade: it is retrying precisely
    // because the cached answer is a temporary failure, so honouring that cache
    // would make the retry a no-op.
    if (!force && hit && hit.expiresAt > Date.now()) return hit.videoId;

    let last = null;
    for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
      let outcome;
      try {
        const query = new URLSearchParams({ title, artist: artist || "" });
        if (Number(duration) > 0) query.set("duration", String(Math.round(Number(duration))));
        outcome = classifyResolve(await api(`/api/youtube/track?${query.toString()}`));
      } catch (error) {
        outcome = classifyResolve({ error });
      }
      last = outcome;
      if (outcome.videoId || !outcome.retry) break;
      // Keep the preview playing while this happens; nothing here blocks audio.
      if (attempt < RESOLVE_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, backoffFor(attempt)));
    }

    ytCache.current[k] = {
      tupleKey,
      videoId: last?.videoId || null,
      status: last?.status || null,
      retryable: !!last?.transient,
      expiresAt: Date.now() + (last?.cacheMs || CACHE_MS.transient),
    };
    if (last && !last.videoId && last.transient) {
      captureAppError(new Error("YouTube lookup capacity is temporarily unavailable"), {
        code: "PIT-MEDIA-002",
        context: `Resolving ${artist || "artist"} - ${title} (${last.status})`,
        source: "youtube-resolver",
        severity: "warning",
        toast: false,
      });
    }
    return last?.videoId || null;
  };
  // Whether the last answer for a track was a temporary failure, so the player
  // can quietly try again and upgrade a preview to the real video mid-play.
  const youtubeLookupWasTransient = (title, artist) => {
    const entry = ytCache.current[youtubeLookupCacheKey(title, artist, sessionRef.current)];
    return !!(entry && !entry.videoId && entry.retryable);
  };
  const invalidateYouTube = async (title, artist, videoId) => {
    if (!title || !videoId) return { ok: false };
    const tupleKey = trackTupleKey(title, artist);
    for (const [key, entry] of Object.entries(ytCache.current)) {
      if (entry?.tupleKey === tupleKey) delete ytCache.current[key];
    }
    try {
      return await api("/api/youtube/invalidate", {
        method: "POST",
        body: { title, artist: artist || "", videoId },
        context: "Replacing an unavailable video",
        silent: true,
      });
    } catch { return { ok: false }; }
  };
  // Resolve any song to a Deezer 30s preview mp3, the fallback when YouTube has no
  // match. Cached per title+artist on this device.
  const previewCache = useRef({});
  // --- Discover: DB-backed charts / genre share / regions (live, not the bundle) ---
  const discoverChart = async ({ by = "popularity", genre, country, limit = 24 } = {}) => {
    try {
      const p = new URLSearchParams({ by, limit: String(limit) });
      if (genre) p.set("genre", genre);
      if (country && country !== "Worldwide") p.set("country", country);
      const r = await api("/api/discover/chart?" + p.toString());
      return r || { rows: [], source: by };
    } catch { return { rows: [], source: by }; }
  };
  const discoverGenres = async ({ country, n = 8 } = {}) => {
    try {
      const p = new URLSearchParams({ n: String(n) });
      if (country && country !== "Worldwide") p.set("country", country);
      return await api("/api/discover/genres?" + p.toString());
    } catch { return { genres: [], total: 0 }; }
  };
  const discoverCountries = async ({ min = 5 } = {}) => {
    try { return await api("/api/discover/countries?min=" + min); } catch { return { countries: [] }; }
  };
  // One authoritative, cancellable read for Discover's first paint. Keeping the
  // chart, genre totals, and region list in one response prevents three loading
  // states from racing and lets the screen distinguish a real empty catalogue
  // from a network failure. Unlike the legacy compatibility helpers above,
  // errors intentionally reject so the page can offer an honest retry.
  const discoverOverviewCacheRef = useRef(null);
  if (!discoverOverviewCacheRef.current) discoverOverviewCacheRef.current = createDiscoverCache({ maxEntries: 12, ttlMs: 60_000 });
  const discoverGenreCacheRef = useRef(null);
  if (!discoverGenreCacheRef.current) discoverGenreCacheRef.current = createDiscoverCache({ maxEntries: 24, ttlMs: 120_000 });
  const loadDiscoverOverview = async ({ by = "popularity", country = "Worldwide", signal, force = false } = {}) => {
    const params = new URLSearchParams({ by });
    if (country && country !== "Worldwide") params.set("country", country);
    const key = discoverOverviewCacheKey({ by, country });
    const cache = discoverOverviewCacheRef.current;
    if (!force) {
      const cached = cache.get(key);
      if (cached) return cached;
    }
    const revision = cache.claim(key);
    const result = await api(`/api/discover/overview?${params.toString()}`, {
      signal,
      silent: true,
      context: "Loading Discover",
    });
    if (!signal?.aborted) cache.commit(key, revision, result);
    return result;
  };
  const loadDiscoverGenre = async ({ genre, country = "Worldwide", limit = 12, signal, force = false } = {}) => {
    const params = new URLSearchParams({ genre: genre || "", limit: String(limit) });
    if (country && country !== "Worldwide") params.set("country", country);
    const key = discoverGenreCacheKey({ genre, country, limit });
    const cache = discoverGenreCacheRef.current;
    if (!force) {
      const cached = cache.get(key);
      if (cached) return cached;
    }
    const revision = cache.claim(key);
    const result = await api(`/api/discover/chart?${params.toString()}`, {
      signal,
      silent: true,
      context: `Loading ${genre || "genre"} artists`,
    });
    if (!signal?.aborted) cache.commit(key, revision, result);
    return result;
  };
  // Authoritative server clock (so the calendar marks "today" without trusting the
  // device clock). Returns { now, iso, tz, offsetMinutes } or null when offline.
  const serverTime = async () => { try { return await api("/api/time"); } catch { return null; } };

  // How many times the signed-in user has logged this artist (artist profile
  // "you've been in the pit with them" counter). Cached per session per artist.
  const seenCountCache = useRef({});
  const artistSeenCount = async (name) => {
    if (!session || !name) return null;
    const key = name.toLowerCase();
    if (seenCountCache.current[key] !== undefined) return seenCountCache.current[key];
    try {
      const r = await api(`/api/artists/seen?name=${encodeURIComponent(name)}`, { silent: true });
      seenCountCache.current[key] = r || null;
      return r || null;
    } catch { return null; }
  };

  // Flag a playback failure or identity problem; optionally carry the correct
  // YouTube link so a moderator can validate and pin it in one action.
  // --- Per-photo reactions (full-screen media viewer) ---
  // Cached by URL so the viewer, feed thumbnails, and artist galleries all read
  // one truth. Server-authoritative; optimistic flip reconciled on response.
  const loadMediaReactions = async (urls) => {
    const wanted = (urls || []).filter((u) => typeof u === "string" && u.startsWith("http")).slice(0, 24);
    if (!wanted.length) return;
    const accountId = sessionRef.current?.id || null;
    try {
      const { reactions } = await api("/api/media/reactions", { method: "POST", silent: true, body: { urls: wanted } });
      if (reactions && (sessionRef.current?.id || null) === accountId) {
        setMediaReactions((m) => ({ ...m, ...reactions }));
      }
    } catch {}
  };
  const toggleMediaReaction = async (url, postId) => {
    if (!session || !url) return { ok: false };
    const accountId = sessionRef.current?.id || null;
    setMediaReactions((m) => {
      const cur = m[url] || { count: 0, mine: false };
      return { ...m, [url]: { count: Math.max(0, cur.count + (cur.mine ? -1 : 1)), mine: !cur.mine } };
    });
    try {
      const r = await api("/api/media/react", { method: "POST", context: "Liking a photo", body: { url, postId } });
      if ((sessionRef.current?.id || null) !== accountId) return { ok: false, stale: true };
      setMediaReactions((m) => ({ ...m, [url]: { count: r.count, mine: r.liked } }));
      if (postId) track("interaction", { postId, action: r.liked ? "like" : "unlike", surface: "media_viewer" });
      return { ok: true };
    } catch (error) {
      // Roll back the optimistic flip; the server said no.
      if ((sessionRef.current?.id || null) === accountId) {
        setMediaReactions((m) => {
          const cur = m[url] || { count: 0, mine: false };
          return { ...m, [url]: { count: Math.max(0, cur.count + (cur.mine ? -1 : 1)), mine: !cur.mine } };
        });
      }
      return { ok: false, error };
    }
  };

  const reportTrack = async ({ title, artist, category = "wrong_video", url, note }) => {
    try {
      const r = await api("/api/tracks/report", { method: "POST", context: "Reporting a song playback issue", body: { title, artist, category, url: url || undefined, note: note || undefined } });
      return { ok: true, duplicate: !!r?.duplicate };
    } catch (error) { return { ok: false, error }; }
  };

  // Admin: pin the correct video for a song (or confirm none exists).
  const adminSetTrackVideo = async ({ title, artist, url, none }) => {
    const scope = staffScopeFor(sessionRef.current);
    try {
      const r = await api("/api/admin/tracks/override", { method: "POST", context: "Pinning the correct song video", body: { title, artist, url: url || undefined, none: !!none } });
      if (scope && scope === staffScopeFor(sessionRef.current)) {
        staffReadsRef.current.invalidate("moderation", sessionRef.current);
        loadModerationConsole().catch(() => {});
      }
      return { ok: true, ...r };
    } catch (error) { return { ok: false, error }; }
  };
  // Admin: every current pin, live from the server (survives any refresh).
  const trackOverridesList = async () => {
    try { const { overrides } = await api("/api/admin/tracks/overrides", { silent: true }); return overrides || []; } catch { return []; }
  };
  const removeTrackOverride = async ({ title, artist }) => {
    try { await api("/api/admin/tracks/override", { method: "DELETE", context: "Removing a song video pin", body: { title, artist } }); return { ok: true }; } catch (error) { return { ok: false, error }; }
  };
  // Staff first paint comes from one privacy-projected server response. The
  // strict loader rejects on failure so the console can distinguish offline or
  // unauthorized from a genuinely empty queue. The legacy wrapper below keeps
  // older callers' boolean contract until the remaining admin tabs are split.
  const loadModerationConsole = async ({ signal, append = false } = {}) => {
    const previous = moderationConsoleRef.current;
    const cursor = append ? previous.nextCursor : null;
    if (append && !cursor) return previous;
    const read = staffReadsRef.current.claim("moderation", sessionRef.current);
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("before", cursor);
    const payload = await api(`/api/admin/moderation?${params.toString()}`, {
      signal,
      silent: true,
      context: append ? "Loading older moderation reports" : "Loading the moderation queue",
    });
    // A newer refresh/mutation, logout, account switch, or role change owns the
    // Store now. Resolve harmlessly for the old caller without committing its
    // private snapshot or making lifecycle cancellation look like an error.
    if (signal?.aborted || !staffReadsRef.current.isCurrent(read, sessionRef.current)) {
      return moderationConsoleRef.current;
    }
    const fresh = Array.isArray(payload?.reports) ? payload.reports : [];
    const mergedReports = append
      ? mergeUniquePage(previous.reports, fresh)
      : fresh;
    const normalized = {
      summary: payload?.summary && typeof payload.summary === "object"
        ? payload.summary
        : { open: fresh.length, actioned: 0, dismissed: 0, totalRecent: fresh.length, byType: {}, queueTruncated: false },
      reports: mergedReports,
      recentActions: Array.isArray(payload?.recentActions) ? payload.recentActions : [],
      nextCursor: typeof payload?.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null,
    };
    moderationConsoleRef.current = normalized;
    setModerationConsole(normalized);
    setReports((current) => {
      const freshIds = new Set(mergedReports.map((report) => report.id));
      return [...mergedReports, ...current.filter((report) => report.status !== "open" && !freshIds.has(report.id))];
    });
    return normalized;
  };
  const loadMoreModerationConsole = (options = {}) => loadModerationConsole({ ...options, append: true });
  const loadModerationQueue = async (options) => {
    try {
      await loadModerationConsole(options);
      return true;
    } catch {
      return false;
    }
  };

  const moderateReport = async ({ action, reportId, reason = "" } = {}) => {
    const actionScope = staffScopeFor(sessionRef.current);
    const result = await api("/api/admin/moderation/actions", {
      method: "POST",
      body: { action, reportId, ...(reason ? { reason } : {}) },
      context: action === "dismiss" ? "Dismissing this report" : "Removing reported content",
    });
    // The server may have committed just before this account signed out. Do not
    // repopulate the next session with the previous staff member's result.
    if (!actionScope || actionScope !== staffScopeFor(sessionRef.current)) return result;
    staffReadsRef.current.invalidate("moderation", sessionRef.current);
    const status = action === "dismiss" ? "dismissed" : "actioned";
    setReports((current) => current.map((report) => report.id === reportId ? { ...report, status } : report));
    setModerationConsole((current) => {
      const handled = current.reports.find((report) => report.id === reportId);
      if (!handled) return current;
      const byType = { ...(current.summary?.byType || {}) };
      if (handled.targetType && Number(byType[handled.targetType]) > 0) byType[handled.targetType] -= 1;
      return {
        ...current,
        summary: {
          ...current.summary,
          open: Math.max(0, Number(current.summary?.open || 0) - 1),
          [status]: Number(current.summary?.[status] || 0) + 1,
          byType,
        },
        reports: current.reports.filter((report) => report.id !== reportId),
      };
    });
    // Refresh audit history/counts without making a completed write look failed
    // if this follow-up read is interrupted or the connection drops afterward.
    loadModerationConsole().catch(() => {});
    return result;
  };

  const resolveDeezerPreview = async (title, artist) => {
    if (!title) return null;
    const k = trackTupleKey(title, artist);
    const hit = previewCache.current[k];
    if (hit && hit.expiresAt > Date.now()) return hit.preview;
    try {
      const { preview, expiresAt } = await api(`/api/deezer/track?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist || "")}`);
      previewCache.current[k] = { preview: preview || null, expiresAt: preview ? Math.min(Number(expiresAt) || Date.now() + 4 * 60 * 1000, Date.now() + 4 * 60 * 1000) : Date.now() + 60 * 1000 };
      return preview || null;
    } catch { return null; }
  };
  // Listening history is account-scoped locally and server-backed. Preserve the
  // exact resolved YouTube id so replay does not search for a different upload.
  const recordPlay = (t) => {
    // Private Listening is deliberately checked before local history, product
    // analytics, or the server write. A private play leaves no recommendation
    // or social-activity trail and the six-hour device timer expires itself.
    if (isPrivateListeningActive(currentPrivateListeningUntil)) return;
    const key = trackKey(t);
    if (!key) return;
    const played = { title: t.title, artist: t.artist, url: t.url, id: t.id, videoId: t.videoId || null, provider: t.provider || null, sourceId: t.sourceId || t.id || null, preview: t.preview || null, art: t.art || null, at: Date.now() };
    setPlayHistory((h) => (h[0] && trackKey(h[0]) === key ? h : [played, ...h].slice(0, 300)));
    const analyticsSource = String(t.provider || t.source || "player").trim().toLowerCase();
    track("play", { source: ["player", "catalog", "provider", "deezer", "youtube", "spotify", "playlist", "profile", "discover"].includes(analyticsSource) ? analyticsSource : "player" });
    // Cross-device history + "friends listening" (best-effort, offline keeps local).
    if (session) api("/api/plays", { method: "POST", body: { title: t.title, artist: t.artist, url: t.url || null, videoId: t.videoId || null, art: t.art || null } }).catch(() => {});
  };

  const loadPlayHistory = async ({ more = false, accountId = session?.id || null, cachedFallback = null } = {}) => {
    if (!accountId) {
      setPlayHistoryStatus("ready");
      setPlayHistoryNextCursor(null);
      return load(historyStorageKey(null), []);
    }
    const before = more ? playHistoryNextCursor : null;
    if (more && !before) return [];
    const sequence = ++playHistoryRequestRef.current.sequence;
    playHistoryRequestRef.current.accountId = accountId;
    setPlayHistoryStatus(more ? "loading-more" : "loading");
    try {
      const query = `?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`;
      const { plays, nextCursor } = await api(`/api/me/plays${query}`, { context: more ? "Loading more listening history" : "Loading listening history", silent: true });
      if (playHistoryRequestRef.current.sequence !== sequence || playHistoryRequestRef.current.accountId !== accountId) return [];
      // `p.id` identifies the play EVENT, not the track. Keeping it in `id`
      // made the same song look different on every device and defeated recent-
      // history exclusion. Preserve it separately and let trackKey use media/meta.
      const rows = Array.isArray(plays) ? plays.map((p) => ({ playId: p.id, title: p.title, artist: p.artist, url: p.url, videoId: p.videoId || null, art: p.art, at: p.at })) : [];
      setPlayHistory((current) => {
        if (!more) return rows.length || !Array.isArray(cachedFallback) ? rows : cachedFallback;
        const seen = new Set(current.map((item) => item.playId || `${item.at}:${trackKey(item)}`));
        const fresh = rows.filter((item) => !seen.has(item.playId || `${item.at}:${trackKey(item)}`));
        return fresh.length ? [...current, ...fresh].slice(0, 300) : current;
      });
      setPlayHistoryNextCursor(nextCursor || null);
      setPlayHistoryStatus("ready");
      return rows;
    } catch {
      if (playHistoryRequestRef.current.sequence === sequence && playHistoryRequestRef.current.accountId === accountId) setPlayHistoryStatus("error");
      return [];
    }
  };

  // Switch caches synchronously per account, then reconcile with server truth.
  // A stale response from the prior login is rejected by the sequence/account guard.
  useEffect(() => {
    const accountId = session?.id || null;
    playHistoryRequestRef.current = { sequence: playHistoryRequestRef.current.sequence + 1, accountId };
    const cached = load(historyStorageKey(accountId), []);
    setPlayHistoryAccountId(accountId);
    setPlayHistory(Array.isArray(cached) ? cached : []);
    setPlayHistoryNextCursor(null);
    if (accountId) loadPlayHistory({ accountId, cachedFallback: Array.isArray(cached) ? cached : [] });
    else setPlayHistoryStatus("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // The latest track each person you follow played (for the "friends listening" rail).
  const [friendsListening, setFriendsListening] = useState([]);
  const friendsReadsRef = useRef(null);
  if (!friendsReadsRef.current) friendsReadsRef.current = createAccountReadCoordinator();
  const loadFriendsListeningStrict = async ({ signal } = {}) => {
    const read = friendsReadsRef.current.claim("friends", sessionRef.current);
    if (!read) return [];
    const { listening } = await api("/api/plays/friends", {
      signal,
      silent: true,
      context: "Loading friends listening",
    });
    const rows = Array.isArray(listening) ? listening : [];
    if (!signal?.aborted && friendsReadsRef.current.isCurrent(read, sessionRef.current)) {
      setFriendsListening(rows);
    }
    return rows;
  };
  const loadFriendsListening = async (options) => {
    try { return await loadFriendsListeningStrict(options); } catch { return []; }
  };
  useEffect(() => {
    friendsReadsRef.current.reset();
    setFriendsListening([]);
  }, [session?.id]);
  const userPlaylists = async (id, { signal } = {}) => { try { const { playlists } = await api(`/api/users/${id}/playlists`, { signal, context: "Loading playlists", silent: true }); return playlists || []; } catch { return []; } };

  // --- Listening algorithm (drives autoplay "up next") -----------------------
  // Favorite genre = the genre you play most (falls back to your picked genres).
  const genreOfArtist = (name) => remoteArtists[norm(name)]?.genre || catalogArtists[norm(name)]?.genre || artistMeta(name)?.genre || null;
  const favoriteGenre = () => {
    const counts = {};
    (playHistory || []).slice(0, 60).forEach((t) => { const g = genreOfArtist(t.artist); if (g) counts[g] = (counts[g] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : (session?.genres?.[0] || null);
  };
  const autoplayRotationRef = useRef(0);
  // Recommend a diverse tail: three taste-matched artists, then one discovery
  // artist, with one song per artist before any artist gets a second turn. A
  // session rotation prevents every listener from receiving the same popularity-
  // sorted sequence while recent tracks and artists are deferred.
  // Gathers the candidate pool; `recommendTracks` in src/domain/recommend.mjs
  // does the selection, so the anti-repetition rules are testable outside React.
  const recommendTracks = (seed, n = 24, rotation = 0) => {
    const mergedArtists = new Map();
    for (const artist of [...Object.values(catalogArtists || {}), ...Object.values(remoteArtists || {})]) {
      if (artist?.name) mergedArtists.set(norm(artist.name), { ...(mergedArtists.get(norm(artist.name)) || {}), ...artist });
    }
    const candidates = [...mergedArtists.values()].map((a) => {
      const meta = remoteArtists[norm(a.name)] || artistMeta(a.name) || a;
      return {
        name: a.name,
        genre: genreOfArtist(a.name),
        popularity: meta.popularity ?? a.popularity,
        art: meta.photo || a.photo || null,
        tracks: meta.topTracks || [],
      };
    });
    return recommendFromCandidates({
      candidates,
      history: playHistory || [],
      seed,
      genre: (seed && genreOfArtist(seed.artist)) || favoriteGenre(),
      count: n,
      rotation,
      trackKey,
    });
  };
  // Build the queue the top player runs: whatever was explicitly queued, then a
  // recommended tail so "up next" is always populated and playback never dead-ends
  // after one song.
  const autoplayQueue = (seed, baseList) => {
    const isTrackRef = (t) => !!(t && (t.url || t.id || t.preview || (t.title && t.artist)));
    const base = ((Array.isArray(baseList) && baseList.length ? baseList : (seed ? [seed] : [])) || []).filter(isTrackRef);
    const keys = (t) => [trackKey(t), trackMetadataKey(norm(t?.title), norm(t?.artist))].filter(Boolean);
    const seen = new Set(base.flatMap(keys));
    const rotation = autoplayRotationRef.current++;
    const recs = recommendTracks(seed || base[0], 30, rotation).filter((t) => {
      const trackKeys = keys(t);
      if (trackKeys.some((key) => seen.has(key))) return false;
      trackKeys.forEach((key) => seen.add(key));
      return true;
    });
    return [...base, ...recs].slice(0, 60);
  };

  // --- Playlists (build one song at a time, not just whole-session snapshots) --
  const [myPlaylists, setMyPlaylists] = useState([]);
  const [myPlaylistsStatus, setMyPlaylistsStatus] = useState(session ? "loading" : "ready");
  const playlistRequestRef = useRef({ sequence: 0, accountId: session?.id || null });
  const loadMyPlaylists = async () => {
    const accountId = session?.id || null;
    const previousAccountId = playlistRequestRef.current.accountId;
    const sequence = ++playlistRequestRef.current.sequence;
    playlistRequestRef.current.accountId = accountId;
    if (!accountId) { setMyPlaylists([]); setMyPlaylistsStatus("ready"); return []; }
    if (previousAccountId !== accountId) setMyPlaylists([]); // never flash the previous account's private library
    setMyPlaylistsStatus("loading");
    try {
      const { playlists } = await api(`/api/users/${accountId}/playlists`, { context: "Loading your playlists", silent: true });
      if (playlistRequestRef.current.sequence !== sequence || playlistRequestRef.current.accountId !== accountId) return [];
      const rows = Array.isArray(playlists) ? playlists : [];
      setMyPlaylists(rows);
      setMyPlaylistsStatus("ready");
      return rows;
    } catch {
      if (playlistRequestRef.current.sequence === sequence && playlistRequestRef.current.accountId === accountId) setMyPlaylistsStatus("error");
      return [];
    }
  };
  const loadPlaylist = async (id) => {
    if (!id) return null;
    try { const { playlist } = await api(`/api/playlists/${encodeURIComponent(id)}`, { context: "Loading this playlist", silent: true }); return playlist || null; }
    catch { return null; }
  };
  const cleanTrack = (t) => ({
    title: t.title,
    artist: t.artist || null,
    url: t.url || null,
    videoId: t.videoId || null,
    provider: t.provider || null,
    sourceId: t.sourceId || t.id || null,
    duration: Number(t.duration) > 0 ? Number(t.duration) : null,
    preview: t.preview || null,
    art: t.art || null,
  });
  const createPlaylist = async (name, tracks, visibility = "public") => {
    const actor = sessionRef.current;
    if (!actor) return null;
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t && t.title).map(cleanTrack);
    if (!list.length) return null;
    const accountMutation = captureAccountMutation(actor.id, accountMutationEpochRef.current);
    try {
      const playlist = await api("/api/playlists", { method: "POST", context: "Creating your playlist", body: { name: name || "New playlist", tracks: list, visibility } });
      if (!accountMutationIsCurrent(accountMutation, sessionRef.current?.id, accountMutationEpochRef.current)) return null;
      setMyPlaylists((current) => [playlist, ...current.filter((item) => item.id !== playlist.id)]);
      return playlist;
    } catch { return null; }
  };
  const addToPlaylist = async (id, track) => {
    if (!session || !track?.title) return false;
    try {
      const { playlist } = await api(`/api/playlists/${encodeURIComponent(id)}`, { method: "PATCH", context: "Adding this song to your playlist", body: { track: cleanTrack(track) } });
      if (playlist) setMyPlaylists((current) => current.map((item) => (item.id === playlist.id ? playlist : item)));
      return true;
    } catch { return false; }
  };
  const updatePlaylist = async (id, changes) => {
    if (!session || !id) return null;
    const body = {};
    if (Object.prototype.hasOwnProperty.call(changes || {}, "name")) body.name = changes.name;
    if (Object.prototype.hasOwnProperty.call(changes || {}, "visibility")) body.visibility = changes.visibility;
    if (Object.prototype.hasOwnProperty.call(changes || {}, "tracks")) body.tracks = (changes.tracks || []).map(cleanTrack);
    try {
      const { playlist } = await api(`/api/playlists/${encodeURIComponent(id)}`, { method: "PATCH", context: "Saving your playlist", body });
      if (playlist) setMyPlaylists((current) => current.map((item) => (item.id === playlist.id ? playlist : item)));
      return playlist || null;
    } catch { return null; }
  };
  const deletePlaylist = async (id) => {
    if (!session || !id) return false;
    try {
      await api(`/api/playlists/${encodeURIComponent(id)}`, { method: "DELETE", context: "Deleting your playlist" });
      setMyPlaylists((current) => current.filter((item) => item.id !== id));
      return true;
    } catch { return false; }
  };
  // Snapshot a listening session (queue) into a saved playlist seed that shows on
  // the profile and can be resumed.
  const saveSnapshot = async (tracks, name) => {
    const list = (tracks || []).filter((t) => !!trackKey(t)).map(cleanTrack);
    if (!list.length) return null;
    const playlistName = name || `Session ${new Date().toLocaleDateString()}`;
    if (session) {
      const playlist = await createPlaylist(playlistName, list);
      if (!playlist) return null;
      const snap = { ...playlist, serverId: playlist.id, by: session.id };
      setSnapshots((current) => [snap, ...current.filter((item) => item.serverId !== playlist.id)].slice(0, 50));
      return snap;
    }
    const snap = { id: "snap_" + Date.now(), name: playlistName, tracks: list, at: Date.now(), by: null };
    setSnapshots((current) => [snap, ...current].slice(0, 50));
    return snap;
  };
  const removeSnapshot = (id) => setSnapshots((s) => s.filter((x) => x.id !== id));

  // Fold a server user into local state so profiles/avatars resolve everywhere.
  const absorbServerUser = (su, { announce = false } = {}) => {
    const merged = { playlists: [], genres: [], favoriteArtists: [], ...su };
    resolveLegacyDraftsForIdentity(merged.id);
    authValidationSequenceRef.current += 1;
    adoptFeedAccount(merged.id);
    const nextStaffScope = staffScopeFor(merged);
    if (staffStateScopeRef.current !== nextStaffScope) {
      resetStaffState();
      staffStateScopeRef.current = nextStaffScope;
    }
    const publicMerged = ENABLE_DEMO_DATA ? merged : publicProfileCacheEntry(merged);
    setUsers((all) => (all.some((x) => x.id === su.id) ? all.map((x) => (x.id === su.id ? { ...x, ...publicMerged } : x)) : [...all, publicMerged]));
    configureApiIdentity(merged.id, { ready: true });
    authReadyRef.current = true;
    setAuthReady(true);
    configureProductAnalytics(merged);
    sessionRef.current = merged;
    setSession(merged);
    if (announce) broadcastAuthEpoch();
    // Hydrate the follow graph for this account from the server (see MIGRATION.md,
    // slice 1). Best-effort: if the endpoint/back-end isn't there we keep whatever
    // is cached locally.
    api("/api/me/following")
      .then(({ following }) => { if (sessionRef.current?.id === su.id && Array.isArray(following)) setFollows((f) => ({ ...f, [su.id]: following })); })
      .catch(() => {});
    // Hydrate who this account has blocked (drives feed/DM/profile filtering).
    api("/api/me/blocked")
      .then(({ users: list }) => {
        if (sessionRef.current?.id !== su.id || !Array.isArray(list)) return;
        const ids = list.map((x) => x.id);
        blockedIdsRef.current = ids;
        setBlockedIds(ids);
        absorbUsers(list);
      })
      .catch(() => {});
    // The account-scoped feed effect restarts after setSession and owns the one
    // initial hydrate. Avoid a second request racing that immutable snapshot.
    // Slice 4: hydrate my DM threads (+ absorb the people I've messaged so their
    // names/avatars resolve in the inbox). Bucket/unread stay computed client-side.
    const dmHydrationRead = chatReadsRef.current.claim("dm-inbox", sessionRef.current);
    api("/api/me/threads")
      .then(({ threads, removedIds = [] }) => {
        if (!chatReadsRef.current.isCurrent(dmHydrationRead, sessionRef.current) || !Array.isArray(threads)) return;
        setUsers((all) => {
          let next = all;
          threads.forEach((t) => {
            if (t.otherUser && !next.some((x) => x.id === t.otherUser.id)) next = [...next,
              ENABLE_DEMO_DATA ? { playlists: [], genres: [], favoriteArtists: [], ...t.otherUser } : publicProfileCacheEntry(t.otherUser)];
          });
          return next;
        });
        setDms((d) => {
          const n = { ...reconcileRemovedDirectMessages(d, su.id, removedIds) };
          threads.forEach((t) => {
            const key = dmKey(su.id, t.otherId);
            const incoming = t.messages.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.createdAt, ts: ago(m.createdAt), server: true }));
            n[key] = mergeChatMessages(n[key] || [], incoming, removedIds, 750);
          });
          return n;
        });
      })
      .catch(() => {});
    // Slice 5: hydrate the fan clubs I've joined (drives the join button + counts).
    api("/api/me/fanclubs")
      .then(({ artists }) => { if (sessionRef.current?.id === su.id && Array.isArray(artists)) setFanClubs((f) => ({ ...f, [su.id]: artists })); })
      .catch(() => {});
    // Slice 7: hydrate my "going" list so planned attendance survives a new device.
    const goingHydrationRevision = goingMutationRevisionRef.current;
    api("/api/me/going")
      .then(({ going: rows }) => {
        if (sessionRef.current?.id !== su.id || !Array.isArray(rows)
          || goingMutationRevisionRef.current !== goingHydrationRevision) return;
        const next = { ...goingRef.current, [su.id]: rows };
        goingRef.current = next;
        rows.forEach((entry) => goingConfirmedRef.current.set(goingIntentKey(su.id, entry.key), true));
        setGoing(next);
      })
      .catch(() => {});
    // Server-backed notifications: replace MY notifications with the authoritative
    // server list (keep local welcome/system ones), so activity is real cross-device.
    api("/api/me/notifications")
      .then(({ notifications: rows }) => {
        if (sessionRef.current?.id !== su.id || !Array.isArray(rows)) return;
        const mine = rows.map((r) => ({ ...r, userId: su.id }));
        setNotifications((all) => [...mine, ...all.filter((n) => n.userId !== su.id || n.type === "welcome")]);
      })
      .catch(() => {});
    // Staff queue hydration uses the same normalized, account-scoped loader as
    // the console. The legacy endpoint remains on the server for old clients.
    if (isMod(su.role)) {
      loadModerationConsole().catch(() => {});
      // Slice 7: admins hydrate pending artist-account requests.
      if (su.role === "admin") api("/api/admin/artist-requests")
        .then(({ requests: rows }) => {
          if (sessionRef.current?.id !== su.id || !Array.isArray(rows) || !rows.length) return;
          setRequests((rs) => {
            const have = new Set(rs.map((x) => x.id));
            const fresh = rows.filter((r) => !have.has(r.id));
            return fresh.length ? [...fresh, ...rs] : rs;
          });
        })
        .catch(() => {});
    }
  };

  // Restore the session on reload. The httpOnly session cookie survives a refresh,
  // so ask the server who we are and re-absorb, which re-runs ALL the per-account
  // hydration (follows, DM threads, fan clubs, going, admin queues). Before this,
  // a refresh skipped hydration entirely, so server-only state looked like it
  // "didn't save." No-op for guests / offline (returns null / rejects).
  useEffect(() => {
    let stopped = false;
    let retryTimer = null;
    let lastValidationAt = 0;
    const validate = ({ force = false } = {}) => {
      if (stopped || (!force && Date.now() - lastValidationAt < 1_000)) return;
      lastValidationAt = Date.now();
      if (retryTimer) clearTimeout(retryTimer);
      // An explicitly opted-in development demo has no API identity to
      // reconcile. Locking it behind /api/me makes Metro-only QA sit on the
      // loading screen forever, because the development server is not PIT's
      // API. Production can never enter this branch (runtime.mjs requires both
      // __DEV__ and the public demo flag).
      if (!remoteIdentityValidationEnabled(ENABLE_DEMO_DATA)) {
        configureApiIdentity(sessionRef.current?.id || null, { ready: true });
        authReadyRef.current = true;
        setAuthReady(true);
        return;
      }
      const sequence = ++authValidationSequenceRef.current;
      configureProductAnalytics(null);
      configureApiIdentity(sessionRef.current?.id || null, { ready: false });
      authReadyRef.current = false;
      setAuthReady(false);
      if (!ENABLE_DEMO_DATA) {
        sessionRef.current = null;
        adoptFeedAccount(null);
        setSession(null);
      }
      api("/api/me", { silent: true, context: "Validating your account", skipIdentityCheck: true })
        .then(({ user }) => {
          if (stopped || sequence !== authValidationSequenceRef.current) return;
          if (user) absorbServerUser(user);
          else {
            resolveLegacyDraftsForIdentity(null);
            configureApiIdentity(null, { ready: true });
            authReadyRef.current = true;
            setAuthReady(true);
            sessionRef.current = null;
            adoptFeedAccount(null);
            setSession(null);
          }
        })
        .catch((error) => {
          if (stopped || sequence !== authValidationSequenceRef.current) return;
          if (error?.status === 401) {
            resolveLegacyDraftsForIdentity(null);
            configureApiIdentity(null, { ready: true });
            authReadyRef.current = true;
            setAuthReady(true);
            sessionRef.current = null;
            adoptFeedAccount(null);
            setSession(null);
            return;
          }
          // Render cold starts and transient mobile failures keep private state
          // locked, then retry. A focus/resume also forces an immediate retry.
          retryTimer = setTimeout(() => validate({ force: true }), 5_000);
        });
    };
    validate({ force: true });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") validate();
    });
    const onStorage = (event) => {
      if (event.key !== AUTH_EPOCH_STORAGE_KEY) return;
      // Cookies are origin-wide. Another tab may have replaced the authenticated
      // account, so immediately lock this tab and ask /api/me before any further
      // account-scoped analytics or personalized requests.
      validate({ force: true });
    };
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      appStateSubscription?.remove?.();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-first auth (real accounts, hashed passwords, httpOnly sessions).
  // Falls back to the local in-memory demo accounts only in an explicit dev build.
  // A production network failure must never authenticate a bundled plaintext user.
  const login = async (email, password) => {
    if (remoteIdentityValidationEnabled(LOCAL_AUTH_FALLBACK)) {
      try {
        const { user } = await api("/api/login", { method: "POST", body: { email, password }, context: "Signing in", silent: true, skipIdentityCheck: true });
        absorbServerUser(user, { announce: true });
        track("login", { method: "password" });
        return { ok: true };
      } catch (e) {
        if (e.status) return { ok: false, error: e.message }; // real server verdict
      }
      return { ok: false, error: "Couldn't connect. Check your connection and try again." };
    }
    // The explicit development demo is intentionally self-contained. Do not
    // let Metro's HTML/404 response masquerade as an API login verdict.
    const em = cleanEmail(email);
    const pw = typeof password === "string" ? password.slice(0, 100) : "";
    const u = users.find((x) => x.email.toLowerCase() === em);
    if (!u || !u.password || u.password !== pw) return { ok: false, error: "Wrong email or password." };
    if (u.isBanned) return { ok: false, error: "This account is banned." };
    configureApiIdentity(u.id, { ready: true });
    authReadyRef.current = true;
    setAuthReady(true);
    sessionRef.current = u;
    adoptFeedAccount(u.id);
    configureProductAnalytics(u);
    setSession(u);
    return { ok: true };
  };

  const adoptEmailVerifiedSession = (candidate) => {
    const current = sessionRef.current;
    const verified = matchingEmailVerifiedSessionUser(candidate, current?.id);
    if (!current || !verified) return false;
    const merged = { ...current, ...verified, emailVerified: true };
    sessionRef.current = merged;
    setSession(merged);
    const publicMerged = ENABLE_DEMO_DATA ? merged : publicProfileCacheEntry(merged);
    setUsers((all) => all.some((user) => user.id === merged.id)
      ? all.map((user) => user.id === merged.id ? { ...user, ...publicMerged } : user)
      : [...all, publicMerged]);
    return true;
  };

  const confirmEmailVerification = async (token, { signal } = {}) => {
    const accountIdAtStart = sessionRef.current?.id || null;
    const emailVerifiedAtStart = sessionRef.current?.emailVerified;
    const result = await confirmEmailWithReconciliation({
      token,
      signal,
      accountIdAtStart,
      emailVerifiedAtStart,
      getCurrentAccountId: () => sessionRef.current?.id || null,
      requestConfirmation: (value, options) => api("/api/verify-email", {
        method: "POST",
        body: { token: value },
        signal: options?.signal,
        context: "Confirming your email",
        silent: true,
      }),
      readCurrentSession: (expectedAccountId, options) => api("/api/me", {
        signal: options?.signal,
        expectedAccountId,
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        context: "Checking email confirmation",
        silent: true,
      }),
    });
    const sessionUpdated = adoptEmailVerifiedSession(result.user);
    return { ...result, sessionUpdated };
  };

  const resendEmailVerification = async ({ signal } = {}) => {
    const expectedAccountId = sessionRef.current?.id || null;
    let result = await api("/api/verify-email/resend", {
      method: "POST",
      body: {},
      signal,
      context: "Resending the confirmation email",
      silent: true,
    });
    let candidate = matchingEmailVerifiedSessionUser(result?.user, sessionRef.current?.id);
    // Rolling deployments and a previously stale client may return the older
    // already-verified shape without `user`. Re-read only this same account.
    if (!candidate && result?.reason === "already-verified" && expectedAccountId
      && sessionRef.current?.id === expectedAccountId && !signal?.aborted) {
      try {
        const fresh = await api("/api/me", {
          signal,
          expectedAccountId,
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          context: "Refreshing email confirmation",
          silent: true,
        });
        candidate = matchingEmailVerifiedSessionUser(fresh?.user, expectedAccountId);
        if (candidate) result = { ...result, verified: true, user: candidate };
      } catch {}
    }
    const sessionUpdated = adoptEmailVerifiedSession(candidate);
    return { ...result, state: verificationResendState(result), sessionUpdated };
  };

  // Request a password-reset email. Always resolves ok (never leaks which emails
  // have accounts); the server emails a 1-hour link.
  const forgotPassword = async (email) => {
    try { await api("/api/forgot", { method: "POST", body: { email }, context: "Requesting a password reset", silent: true }); } catch {}
    return { ok: true };
  };
  // Complete a reset from the emailed token; on success we're signed in.
  const resetPassword = async (token, password) => {
    try {
      const { user } = await api("/api/reset", { method: "POST", body: { token, password }, context: "Resetting your password", silent: true, skipIdentityCheck: true });
      absorbServerUser(user, { announce: true });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.status ? e.message : "Couldn't reset. Try requesting a new link." }; }
  };

  // Ensure a handle is unique by suffixing a number if taken.
  const uniqueHandle = (base) => {
    let h = cleanHandle(base) || "fan";
    if (h.length < 3) h = (h + "fan").slice(0, 20);
    let candidate = h, i = 1;
    while (users.some((u) => u.handle === candidate)) candidate = (h.slice(0, 17) + i++).slice(0, 20);
    return candidate;
  };

  const signup = async ({ name, email, password, city, location = null, agreedToTerms, analyticsConsent = false }) => {
    const nm = cleanName(name);
    const em = cleanEmail(email);
    if (!isName(nm)) return { ok: false, error: "Enter a name (letters or numbers, up to 40 chars)." };
    if (!isEmail(em)) return { ok: false, error: "Enter a valid email address." };
    if (!isPassword(password)) return { ok: false, error: "Password needs 8+ characters with letters and numbers." };
    if (!city) return { ok: false, error: "Pick your city - it powers your local feed." };
    if (!agreedToTerms) return { ok: false, error: "Please agree to the Terms & Conditions and Privacy policy." };
    // Record consent to the current Terms/Privacy at the moment of sign-up.
    const acceptedAt = Date.now();
    const consent = { termsAcceptedAt: acceptedAt, termsVersion: TERMS_VERSION, ...(analyticsConsent ? { analyticsConsentAt: acceptedAt } : {}) };
    const pickedLocation = location?.city ? location : { city };
    const srvCoords = locationCenter(pickedLocation);
    if (remoteIdentityValidationEnabled(LOCAL_AUTH_FALLBACK)) {
      try {
        const { user } = await api("/api/signup", {
          method: "POST",
          body: { name: nm, email: em, password, city, lat: srvCoords?.lat, lng: srvCoords?.lng, analyticsConsent: !!analyticsConsent, termsVersion: TERMS_VERSION },
          context: "Creating your Pit account",
          silent: true,
          skipIdentityCheck: true,
        });
        absorbServerUser(user, { announce: true });
        // Signup persists consent in the same server transaction as the account;
        // configure only from the authoritative response so the first batch cannot
        // race a fire-and-forget profile PATCH and disappear.
        configureProductAnalytics(user);
        track("signup", { method: "password" });
        pushWelcome(user.id);
        return { ok: true };
      } catch (e) {
        if (e.status) return { ok: false, error: e.message };
      }
      return { ok: false, error: "Couldn't connect. Check your connection and try again." };
    }
    // Explicit development demos create only local prototype accounts.
    if (users.some((x) => x.email.toLowerCase() === em)) return { ok: false, error: "That email is already registered." };
    const coords = locationCenter(pickedLocation);
    const u = {
      id: "u_" + Date.now(),
      name: nm,
      handle: uniqueHandle(em.split("@")[0]),
      email: em,
      password,
      role: "fan",
      initials: (nm.match(/\p{L}|\p{N}/gu) || ["N", "F"]).slice(0, 2).join("").toUpperCase(),
      avatarColor: AV[Math.floor(Math.random() * AV.length)],
      avatarUri: null,
      bio: "",
      genres: [],
      favoriteArtists: [],
      playlists: [],
      home: { ...pickedLocation, city, lat: coords?.lat ?? null, lng: coords?.lng ?? null },
      ...consent,
    };
    setUsers((all) => [...all, ENABLE_DEMO_DATA ? u : publicProfileCacheEntry(u)]);
    configureApiIdentity(u.id, { ready: true });
    authReadyRef.current = true;
    setAuthReady(true);
    sessionRef.current = u;
    adoptFeedAccount(u.id);
    configureProductAnalytics(u);
    setSession(u);
    pushWelcome(u.id);
    return { ok: true };
  };

  const logout = () => {
    authValidationSequenceRef.current += 1;
    const departingAccountId = sessionRef.current?.id || null;
    const request = api("/api/logout", { method: "POST", expectedAccountId: departingAccountId })
      .catch(() => {}) // best-effort server-side
      .finally(() => broadcastAuthEpoch());
    playHistoryRequestRef.current = { sequence: playHistoryRequestRef.current.sequence + 1, accountId: null };
    playlistRequestRef.current = { sequence: playlistRequestRef.current.sequence + 1, accountId: null };
    setPlayHistory([]);
    setPlayHistoryAccountId(null);
    setPlayHistoryNextCursor(null);
    setPlayHistoryStatus("ready");
    setMyPlaylists([]);
    setMyPlaylistsStatus("ready");
    setSnapshots([]);
    setFriendsListening([]);
    resetStaffState();
    staffStateScopeRef.current = null;
    // Clear identity synchronously before a theme-triggered reload can occur.
    save("pit.session", null);
    clearStoredTheme();
    sessionRef.current = null;
    configureProductAnalytics(null);
    configureApiIdentity(null, { ready: true });
    authReadyRef.current = true;
    setAuthReady(true);
    adoptFeedAccount(null);
    setSession(null);
    return request;
  };

  const setAnalyticsEnabled = async (enabled) => {
    if (!session?.id) return { ok: false };
    const accountId = session.id;
    try {
      const { user } = await api("/api/me/analytics-consent", {
        method: "POST",
        body: { enabled: !!enabled },
        context: enabled ? "Enabling product analytics" : "Turning off product analytics",
        silent: true,
      });
      if (!user || sessionRef.current?.id !== accountId) return { ok: false };
      const merged = { ...sessionRef.current, ...user };
      setUsers((all) => all.map((entry) => entry.id === accountId
        ? (ENABLE_DEMO_DATA ? { ...entry, ...user } : publicProfileCacheEntry({ ...entry, ...user }))
        : entry));
      sessionRef.current = merged;
      setSession(merged);
      configureProductAnalytics(merged);
      return { ok: true, user: merged };
    } catch (error) {
      return { ok: false, error };
    }
  };

  // Permanent deletion is deliberately server-first. Nothing is cleared from
  // this device until the password is verified and the database transaction has
  // committed, so a network/auth failure leaves the account and form recoverable.
  const deleteAccount = async (password) => {
    if (!session) return { ok: false, error: "Log in before deleting your account." };
    const deleted = session;
    let confirmedDeleted = false;
    try {
      await api("/api/me", {
        method: "DELETE",
        body: { password },
        context: "Deleting your Pit account",
        silent: true,
      });
      confirmedDeleted = true;
    } catch (error) {
      const ambiguous = !error?.status || error?.code === "PIT-NET-001" || error?.code === "PIT-NET-002";
      if (!ambiguous) return { ok: false, error: error?.message || "Your account couldn't be deleted. Try again.", appError: error };
      try {
        // The DELETE may have committed even if its response was lost. Confirm
        // the authoritative session before inviting a destructive retry.
        const check = await api("/api/me", { context: "Confirming account deletion", silent: true, skipIdentityCheck: true });
        confirmedDeleted = !check?.user;
        if (!confirmedDeleted) return { ok: false, error: "Pit did not delete the account. Your account is still active.", appError: error };
      } catch (verificationError) {
        return {
          ok: false,
          unknown: true,
          error: "Pit could not confirm whether deletion finished. Do not retry yet. Reconnect, then sign in or contact support with the diagnostic request ID.",
          appError: verificationError,
        };
      }
    }

    if (!confirmedDeleted) return { ok: false, unknown: true, error: "Pit could not confirm account deletion." };

    await deleteMediaDraftsForOwner(deleted.id);
    purgeProductAnalyticsAccount(deleted.id);
    save(feedStorageKey(deleted.id), []);
    save(recommendationPreferenceStorageKey(deleted.id), []);
    save(historyStorageKey(deleted.id), []);
    save("pit.snapshots", []);
    save("pit.session", null);

    const withoutUserEntries = (map) => Object.fromEntries(
      Object.entries(map || {}).map(([key, rows]) => [key, Array.isArray(rows) ? rows.filter((row) => row?.userId !== deleted.id && row?.user_id !== deleted.id) : rows])
    );
    const withoutRating = (map) => Object.fromEntries(
      Object.entries(map || {}).map(([key, ratings]) => {
        const next = { ...(ratings || {}) };
        delete next[deleted.id];
        return [key, next];
      }).filter(([, ratings]) => Object.keys(ratings).length)
    );

    setUsers((all) => all.filter((user) => user.id !== deleted.id));
    setFeed((all) => all.filter((post) => post.userId !== deleted.id));
    setComments(withoutUserEntries);
    setMyLikes({});
    setFollows((all) => Object.fromEntries(
      Object.entries(all || {})
        .filter(([id]) => id !== deleted.id)
        .map(([id, ids]) => [id, (ids || []).filter((otherId) => otherId !== deleted.id)])
    ));
    blockedIdsRef.current = [];
    setBlockedIds([]);
    setRequests((all) => all.filter((request) => request.userId !== deleted.id));
    setReports((all) => all.filter((report) => report.reporterId !== deleted.id));
    setLounge(withoutUserEntries);
    setFanClubMsgs(withoutUserEntries);
    setGoing((all) => { const next = { ...all }; delete next[deleted.id]; return next; });
    setFanClubs((all) => { const next = { ...all }; delete next[deleted.id]; return next; });
    setVenueReviews(withoutUserEntries);
    setDms((all) => Object.fromEntries(Object.entries(all || {}).filter(([key]) => !key.split("__").includes(deleted.id))));
    setDmRead((all) => Object.fromEntries(Object.entries(all || {}).filter(([key]) => !key.split("__").includes(deleted.id))));
    setNotifications((all) => all.filter((item) => item.userId !== deleted.id && item.actorId !== deleted.id));
    setAlbumRatings(withoutRating);
    setSongRatings(withoutRating);
    setUserStats((all) => { const next = { ...all }; delete next[deleted.id]; return next; });
    setPlayHistory([]);
    setSnapshots([]);
    commitDrafts((all) => all.filter((draft) => String(draft?.ownerId || "") !== String(deleted.id)));
    setMyPlaylists([]);
    setFriendsListening([]);
    setRatingAgg({});
    // Drop rating request ordering with the data it ordered, so a request still
    // in flight from the deleted account cannot write into the fresh state.
    ratingTicketsRef.current?.clear();
    setFanClubMeta({});
    setFeedNextCursor(null);
    setFeedHasMore(true);

    // Account deletion also clears this account's device-local search bucket;
    // the guest and other account buckets remain isolated and untouched.
    save(recentSearchStorageKey(deleted.id), []);

    // Artist-owned client caches do not retain author IDs on every legacy row;
    // remove the deleted artist's own page cache while preserving unrelated
    // public artist pages. The server deletes all attributable rows precisely.
    if (deleted.artistName) {
      const artistKey = norm(deleted.artistName);
      setArtistProfiles((all) => { const next = { ...all }; delete next[artistKey]; return next; });
      setArtistPosts((all) => { const next = { ...all }; delete next[artistKey]; return next; });
    }

    save("pit.session", null);
    resetStaffState();
    staffStateScopeRef.current = null;
    sessionRef.current = null;
    configureProductAnalytics(null);
    configureApiIdentity(null, { ready: true });
    authReadyRef.current = true;
    setAuthReady(true);
    adoptFeedAccount(null);
    setSession(null);
    broadcastAuthEpoch();
    setMemberCount((count) => Math.max(0, count - 1));
    return { ok: true };
  };

  // Pick a theme. Saved on the account (so it survives sign-out and follows you
  // to a new device) AND applied immediately. applyTheme reloads to re-resolve
  // the StyleSheet colors, so we persist to disk + the server first. An optional
  // `mergePatch` (already-sanitized profile fields) is persisted in the same
  // write, used at signup so the artist picks aren't lost to the reload.
  const chooseTheme = async (next, mergePatch = null) => {
    if (session) {
      const extra = mergePatch || {};
      const updated = { ...session, ...extra, theme: next };
      setUsers((all) => all.map((u) => (u.id === session.id
        ? (ENABLE_DEMO_DATA ? { ...u, ...extra, theme: next } : publicProfileCacheEntry({ ...u, ...extra, theme: next }))
        : u)));
      setSession(updated);
      if (ENABLE_DEMO_DATA) save("pit.session", updated); // demo-only local identity
      try { await api("/api/me", { method: "PATCH", body: { theme: next, ...extra } }); } catch {}
    }
    applyTheme(next, session?.id || null);
  };

  const updateProfile = (patch) => {
    if (!session) return Promise.resolve({ ok: false });
    const previousSession = session;
    // Sanitize the free-text fields; pass structured fields (home, songs) through.
    const safe = { ...patch };
    if ("name" in safe) safe.name = cleanName(safe.name) || session.name;
    if ("bio" in safe) safe.bio = clean(safe.bio, { max: LIMITS.bio, newlines: true });
    if ("handle" in safe) {
      const h = cleanHandle(safe.handle);
      // only accept a valid, unused handle; otherwise keep the current one
      safe.handle = h.length >= 3 && !users.some((u) => u.handle === h && u.id !== session.id) ? h : session.handle;
    }
    if (Array.isArray(safe.genres)) safe.genres = safe.genres.map((g) => clean(g, { max: 30 })).filter(Boolean).slice(0, 12);
    if (Array.isArray(safe.favoriteArtists)) safe.favoriteArtists = safe.favoriteArtists.map((n) => clean(n, { max: 80 })).filter(Boolean).slice(0, 50);
    if ("name" in safe) safe.initials = (safe.name.match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase();
    setUsers((all) => all.map((u) => (u.id === session.id
      ? (ENABLE_DEMO_DATA ? { ...u, ...safe } : publicProfileCacheEntry({ ...u, ...safe }))
      : u)));
    setSession((s) => ({ ...s, ...safe }));
    // Persist to the server so profile edits (incl. your @handle) survive sign-out
    // and follow you to a new device. The server is the authority on handle
    // uniqueness, re-absorb its response so a taken handle reverts cleanly.
    const body = {};
    for (const k of ["name", "bio", "handle", "avatarUri", "banner"]) if (k in safe) body[k] = safe[k];
    if (safe.home) { body.city = safe.home.city; body.lat = safe.home.lat; body.lng = safe.home.lng; }
    if (Array.isArray(safe.genres)) body.genres = safe.genres;
    if (Array.isArray(safe.favoriteArtists)) body.favoriteArtists = safe.favoriteArtists;

    // Music picks live in the bounded profile extras object on the server. Send
    // the complete known set whenever one changes so saving a song cannot erase
    // the account theme or its recorded Terms consent.
    const extraKeys = ["theme", "consentAt", "analyticsConsentAt", "termsAcceptedAt", "termsVersion", "analyticsOptOut", "nowPlaying", "treble", "bass", "playlists"];
    if (["analyticsOptOut", "nowPlaying", "treble", "bass", "playlists"].some((key) => key in safe)) {
      const merged = { ...previousSession, ...safe };
      body.extras = Object.fromEntries(extraKeys.filter((key) => merged[key] !== undefined).map((key) => [key, merged[key]]));
    }
    if (!Object.keys(body).length) return Promise.resolve({ ok: true, patch: safe });

    return api("/api/me", { method: "PATCH", body, context: "Saving your profile" })
      .then(({ user }) => {
        if (user) {
          setUsers((all) => all.map((u) => (u.id === user.id
            ? (ENABLE_DEMO_DATA ? { ...u, ...user } : publicProfileCacheEntry({ ...u, ...user }))
            : u)));
          setSession((s) => ({ ...s, ...user }));
        }
        return { ok: true, user, patch: safe };
      })
      .catch((error) => {
        // Server rejected something (e.g. handle taken / cooldown / role tag).
        // Restore the last server-backed snapshot instead of leaving a false save.
        setUsers((all) => all.map((u) => (u.id === previousSession.id
          ? (ENABLE_DEMO_DATA ? previousSession : publicProfileCacheEntry(previousSession))
          : u)));
        setSession(previousSession);
        return { ok: false, error };
      });
  };

  const addLog = (log) => {
    const localId = log.id || "p_local_" + Date.now();
    // A plain status/update post ("post whatever") shares this path with a show
    // review; it just carries no artist/venue/rating and renders as a social card.
    const kind = log.kind === "status" ? "status" : "review";
    const safe = {
      ...log,
      id: localId,
      kind,
      artist: clean(log.artist, { max: 80 }),
      artistKey: cleanArtistKey(log.artistKey),
      venue: clean(log.venue, { max: 80 }),
      review: clean(log.review, { max: LIMITS.review, newlines: true }),
      overall: clampRating(log.overall),
      band: log.band == null ? log.band : clampRating(log.band),
      room: log.room == null ? log.room : clampRating(log.room),
      userId: session?.id,
    };
    feedMutationRevisionRef.current += 1;
    setFeed((f) => [safe, ...f]);
    // Slice 2 write-through: persist the post server-side, then adopt the server
    // id so likes/comments on it key correctly. Best-effort (offline keeps local).
    if (session) {
      const body = kind === "status"
        ? { clientMutationId: localId, kind: "status", review: safe.review, song: safe.song || null, photos: safe.photos || [], ...(Array.isArray(safe.mediaAssetIds) ? { mediaAssetIds: safe.mediaAssetIds } : {}), photosPublic: safe.photosPublic === false ? 0 : 1, ...(log.playlistId ? { playlistId: log.playlistId } : {}) }
        : buildReviewCreateBody(safe);
      return api("/api/posts", {
        method: "POST",
        context: kind === "status" ? "Posting your update" : "Posting your concert review",
        body,
      })
        .then(({ id, post }) => {
          feedMutationRevisionRef.current += 1;
          if (post) {
            const published = { ...normalizeServerPost(post), dims: post.dims || safe.dims };
            // The canonical row may already have arrived through feed polling
            // while the original POST response was lost. Collapse both IDs so
            // an idempotent retry cannot render the same post twice.
            setFeed((f) => [published, ...f.filter((l) => l.id !== localId && l.id !== published.id)]);
          } else if (id && id !== localId) {
            setFeed((f) => [{ ...safe, id }, ...f.filter((l) => l.id !== localId && l.id !== id)]);
          }
          track("post", { kind: kind === "status" ? "status" : "review", mediaCount: Array.isArray(safe.photos) ? safe.photos.length : 0 });
          return { ok: true, id: id || localId };
        })
        .catch((error) => {
          feedMutationRevisionRef.current += 1;
          // A failed write must not remain looking published on this device.
          setFeed((f) => f.filter((l) => l.id !== localId));
          return { ok: false, error };
        });
    }
    track("post", { kind: kind === "status" ? "status" : "review", mediaCount: Array.isArray(safe.photos) ? safe.photos.length : 0 });
    return Promise.resolve({ ok: true, localOnly: true });
  };

  const reconcileEditedPost = async (id, body, error) => {
    if (!shouldReconcileEditFailure(error)) return null;
    try {
      const { post } = await api(`/api/posts/${encodeURIComponent(id)}`, {
        context: "Confirming whether your update saved",
        silent: true,
      });
      if (!postMatchesEditIntent(post, body)) return null;
      const updated = normalizeServerPost(post);
      setFeed((all) => mergeEditedPost(all, updated));
      return updated;
    } catch {
      return null;
    }
  };

  const editLog = async (target, changes) => {
    const id = typeof target === "string" ? target : target?.id;
    if (!session || !id) return { ok: false };
    // Author-only, admins included: moderation removes content, never rewrites it.
    const previous = resolvePostEditTarget(feed, target);
    if (!previous || previous.userId !== session.id) return { ok: false };

    // A status post has no artist/venue/rating, so it only sends the fields it
    // actually owns; sending empty artist/venue would trip the review validators.
    if ((previous.kind || changes.kind) === "status") {
      const version = previous.version ?? previous.editedAt ?? previous.createdAt;
      const playlistId = changes.playlistId ?? changes.playlist?.id ?? null;
      const body = {
        review: clean(changes.review, { max: LIMITS.review, newlines: true }),
        song: changes.song?.videoId ? changes.song : null,
        playlistId,
        photos: Array.isArray(changes.photos) ? changes.photos.filter((item) => typeof item === "string").slice(0, 8) : [],
        ...(Array.isArray(changes.mediaAssetIds) ? { mediaAssetIds: changes.mediaAssetIds } : {}),
        photosPublic: changes.photosPublic !== false,
        ...(Number.isSafeInteger(version) ? { version } : {}),
      };
      if (!body.review && !body.photos.length && !body.song && !playlistId) return { ok: false };
      feedMutationRevisionRef.current += 1;
      try {
        const { post } = await api(`/api/posts/${encodeURIComponent(id)}`, { method: "PATCH", context: "Saving your update", body, silent: true });
        feedMutationRevisionRef.current += 1;
        const updated = normalizeServerPost(post);
        setFeed((all) => mergeEditedPost(all, updated));
        return { ok: true, post: updated };
      } catch (error) {
        feedMutationRevisionRef.current += 1;
        const reconciled = await reconcileEditedPost(id, body, error);
        if (reconciled) return { ok: true, post: reconciled, reconciled: true };
        return { ok: false, error };
      }
    }

    const safe = buildReviewEditBody(changes);
    if (!safe.artist || !safe.venue || safe.overall <= 0) return { ok: false };
    const version = previous.version ?? previous.editedAt ?? previous.createdAt;
    feedMutationRevisionRef.current += 1;
    try {
      const { post } = await api(`/api/posts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        context: "Saving your concert review",
        body: { ...safe, ...(Number.isSafeInteger(version) ? { version } : {}) },
        silent: true,
      });
      feedMutationRevisionRef.current += 1;
      const updated = normalizeServerPost(post);
      setFeed((all) => mergeEditedPost(all, updated));
      return { ok: true, post: updated };
    } catch (error) {
      feedMutationRevisionRef.current += 1;
      const body = { ...safe, ...(Number.isSafeInteger(version) ? { version } : {}) };
      const reconciled = await reconcileEditedPost(id, body, error);
      if (reconciled) return { ok: true, post: reconciled, reconciled: true };
      return { ok: false, error };
    }
  };

  // Reports write through before appearing locally: a safety report must never
  // look filed when the server did not receive it. The same boundary handles
  // posts, people, comments, private messages and gated community messages.
  const reportContent = async (targetId, reason, targetType = "post", { mediaUri = null } = {}) => {
    const r = clean(reason, { max: LIMITS.note });
    if (!session) return { ok: false, error: "Log in to send this to the moderators." };
    try {
      const result = await api("/api/reports", {
        method: "POST",
        body: { targetType, targetId, reason: r, ...(mediaUri ? { mediaUri } : {}) },
        context: "Sending your report",
        silent: true, // the screen shows a specific message, not a generic toast
      });
      setReports((current) => current.some((entry) => entry.id === result.id)
        ? current
        : [{
            id: result.id,
            targetType,
            targetId,
            reason: r,
            reporterId: session.id,
            status: "open",
          }, ...current]);
      if (targetType === "post") track("interaction", { postId: targetId, action: "report", surface: "post_detail" });
      return { ok: true, id: result.id, duplicate: !!result.duplicate };
    } catch (error) {
      // Deliberately NOT the generic transport message ("Pit could not finish
      // that action"), which never says the report was not filed. For this one
      // action the outcome matters more than the HTTP reason, and `appError`
      // still carries the reference for diagnostics.
      return { ok: false, error: "Your report wasn't sent, so no moderator has seen it yet. Tap a reason to try again.", appError: error };
    }
  };
  const actionReport = (repId) => {
    const r = reports.find((x) => x.id === repId);
    return moderateReport({ action: "remove", reportId: repId })
      .then(() => {
        if (r?.targetType === "post" || !r?.targetType) setRemovedIds((ids) => (ids.includes(r.targetId) ? ids : [...ids, r.targetId]));
        setReports((rs) => rs.map((x) => (x.id === repId ? { ...x, status: "actioned" } : x)));
        return true;
      })
      .catch(() => false);
  };
  const dismissReport = (repId) => {
    return moderateReport({ action: "dismiss", reportId: repId })
      .then(() => { setReports((rs) => rs.map((x) => (x.id === repId ? { ...x, status: "dismissed" } : x))); return true; })
      .catch(() => false);
  };
  const moderateContent = async (type, id, removed) => {
    const scope = staffScopeFor(sessionRef.current);
    const result = await api(`/api/admin/content/${type}/${id}`, {
      method: "POST",
      body: { removed },
      context: removed ? "Removing community content" : "Restoring community content",
    });
    if (scope && scope === staffScopeFor(sessionRef.current)) {
      staffReadsRef.current.invalidate("moderation", sessionRef.current);
      loadModerationConsole().catch(() => {});
    }
    return result;
  };
  const removeContent = (id) => moderateContent("post", id, true)
    .then(() => { setRemovedIds((rows) => (rows.includes(id) ? rows : [...rows, id])); return true; })
    .catch(() => false);
  const restoreContent = (id) => moderateContent("post", id, false)
    .then(() => { setRemovedIds((rows) => rows.filter((value) => value !== id)); return true; })
    .catch(() => false);

  // Artist account requests
  const requestArtist = (artistName, note) => {
    if (!session) return { ok: false, error: "Log in first." };
    const an = clean(artistName, { max: LIMITS.artist });
    if (an.length < 2) return { ok: false, error: "Enter the artist name." };
    setRequests((rs) => [...rs, { id: "r_" + Date.now(), userId: session.id, artistName: an, note: clean(note, { max: LIMITS.note, newlines: true }), status: "pending" }]);
    api("/api/artist-requests", { method: "POST", body: { artistName: an, note } }).catch(() => {}); // slice 7
    return { ok: true };
  };
  const approveArtist = (reqId) => {
    setRequests((rs) => rs.map((r) => (r.id === reqId ? { ...r, status: "approved" } : r)));
    const req = requests.find((r) => r.id === reqId);
    if (req) {
      setUsers((all) => all.map((u) => (u.id === req.userId ? { ...u, role: "artist", artistName: req.artistName } : u)));
      setSession((s) => (s && s.id === req.userId ? { ...s, role: "artist", artistName: req.artistName } : s));
    }
    api(`/api/admin/artist-requests/${reqId}/approve`, { method: "POST" }).catch(() => {}); // flips role server-side
  };
  const rejectArtist = (reqId) => {
    setRequests((rs) => rs.map((r) => (r.id === reqId ? { ...r, status: "rejected" } : r)));
    api(`/api/admin/artist-requests/${reqId}/reject`, { method: "POST" }).catch(() => {});
  };

  // Tour dates - bulk batch with a scheduled release time.
  const addTourDatesBatch = async (list, releaseAt) => {
    const actor = sessionRef.current;
    const rows = Array.isArray(list) ? list : [];
    if (!actor || !rows.length) return { ok: false, error: "Add at least one complete tour date." };
    const artist = rows[0]?.artist || actor.artistName || "";
    try {
      const result = await api("/api/tourdates", {
        method: "POST",
        context: "Publishing tour dates",
        body: {
          artist,
          releaseAt,
          dates: rows.map(({ venue, place, date, ticketUrl }) => ({ venue, place, date, ticketUrl: ticketUrl || "" })),
        },
      });
      if (sessionRef.current?.id !== actor.id || !Array.isArray(result?.tourDates)) {
        return { ok: false, stale: true, error: "Your account changed before the tour dates finished publishing." };
      }
      tourDateReadRef.current.sequence += 1;
      const byId = new Map(tourDatesRef.current.map((event) => [event.id, event]));
      result.tourDates.forEach((event) => byId.set(event.id, event));
      const next = [...byId.values()];
      tourDatesRef.current = next;
      setTourDates(next);
      return { ok: true, tourDates: result.tourDates };
    } catch (error) {
      return { ok: false, error: error?.message || "Tour dates were not published. Try again." };
    }
  };

  // --- Notifications / activity ---------------------------------------------
  // Address a notification to a recipient when someone acts on their stuff. Never
  // notify yourself. (Client-side in this prototype, like the rest of the graph.)
  const notify = (recipientId, type, payload = {}) => {
    if (!session || !recipientId || recipientId === session.id) return;
    const n = {
      id: "n_" + Date.now() + Math.random().toString(36).slice(2, 6),
      userId: recipientId, type,
      actorId: session.id, actorName: session.name, actorInitials: session.initials,
      actorColor: session.avatarColor, actorUri: session.avatarUri,
      ts: Date.now(), read: false, ...payload,
    };
    setNotifications((all) => [n, ...all].slice(0, 300));
  };
  // A system "welcome" notification so a new account's Activity isn't empty and
  // the first thing they see guides them into the product.
  const pushWelcome = (uid) => setNotifications((all) => [
    { id: "nw_" + Date.now(), userId: uid, type: "welcome", actorName: "Pit", actorInitials: "PT", actorColor: "#FF8C42", ts: Date.now(), read: false },
    ...all,
  ]);
  const myNotifications = () => (session ? notifications.filter((n) => n.userId === session.id).sort((a, b) => b.ts - a.ts) : []);
  const unreadNotifications = () => myNotifications().filter((n) => !n.read).length;
  const markNotificationsRead = () => {
    if (!session) return;
    setNotifications((all) => all.map((n) => (n.userId === session.id ? { ...n, read: true } : n)));
    api("/api/me/notifications/read", { method: "POST" }).catch(() => {});
  };
  const postOwner = (postId) => feed.find((l) => l.id === postId)?.userId;

  // Social graph. First slice of the SQLite migration (see MIGRATION.md): follow
  // state is still cached locally + persisted, but mutations now WRITE THROUGH to
  // the server (best-effort) and login HYDRATES the follow list from the server,
  // so a real account's follows survive a new device. Falls back to local-only
  // when the backend is unreachable (dev / offline).
  const isFollowing = (id) => (follows[session?.id] || []).includes(id);
  const bumpFollowers = (id, d) =>
    setUserStats((m) => (m[id] ? { ...m, [id]: { ...m[id], followers: Math.max(0, (m[id].followers || 0) + d) } } : m));
  const follow = (id) => {
    if (!session || isFollowing(id)) return;
    setFollows((f) => ({ ...f, [session.id]: [...new Set([...(f[session.id] || []), id])] }));
    bumpFollowers(id, 1);
    api(`/api/users/${id}/follow`, { method: "POST", body: { following: true }, context: "Following this fan" })
      .then(() => { track("follow"); notify(id, "follow"); })
      .catch(() => {
        setFollows((f) => ({ ...f, [session.id]: (f[session.id] || []).filter((x) => x !== id) }));
        bumpFollowers(id, -1);
      });
  };
  const unfollow = (id) => {
    if (!session || !isFollowing(id)) return;
    setFollows((f) => ({ ...f, [session.id]: (f[session.id] || []).filter((x) => x !== id) }));
    bumpFollowers(id, -1);
    api(`/api/users/${id}/follow`, { method: "POST", body: { following: false }, context: "Unfollowing this fan" })
      .catch(() => {
        setFollows((f) => ({ ...f, [session.id]: [...new Set([...(f[session.id] || []), id])] }));
        bumpFollowers(id, 1);
      });
  };
  // Prefer the server's real numbers (loadUser fills them); the local follows map
  // only knows what this device has seen and undercounts everyone else.
  const followerCount = (id) => userStats[id]?.followers ?? Object.values(follows).filter((arr) => arr.includes(id)).length;
  const followingCount = (id) => userStats[id]?.following ?? (follows[id] || []).length;
  // The people lists behind those numbers (server-truth, absorbed so rows resolve).
  const followersOf = async (id) => {
    try { const { users: list } = await api(`/api/users/${id}/followers`); absorbUsers(list); return list || []; } catch { return []; }
  };
  const followingOf = async (id) => {
    try { const { users: list } = await api(`/api/users/${id}/following`); absorbUsers(list); return list || []; } catch { return []; }
  };

  // --- Blocks: a real block, not a mute. Server severs follows both ways, stops
  // DMs, hides posts; locally we mirror the list so the UI reacts instantly. ---
  const isBlocked = (id) => blockedIds.includes(id);
  const blockUser = (id) => {
    if (!session || !id || isBlocked(id)) return;
    const mineBefore = follows[session.id] || [];
    const theirsBefore = follows[id] || [];
    const nextBlocked = [...new Set([...blockedIdsRef.current, id])];
    blockedIdsRef.current = nextBlocked;
    setBlockedIds(nextBlocked);
    setRecentSearches((entries) => withoutBlockedPersonSearches(entries, [id]));
    setVenueReviews((groups) => withoutVenueReviewsByUser(groups, id));
    // Sever locally the way the server does.
    setFollows((f) => ({ ...f, [session.id]: (f[session.id] || []).filter((x) => x !== id), [id]: (f[id] || []).filter((x) => x !== session.id) }));
    api(`/api/users/${id}/block`, { method: "POST", body: { blocked: true }, context: "Blocking this account" })
      .then(() => {
        setFeed((rows) => rows.filter((post) => post.userId !== id));
        setArtistPhotosSrv((groups) => Object.fromEntries(Object.entries(groups)
          .map(([key, photos]) => [key, (photos || []).filter((photo) => photo.ownerId !== id)])));
        setComments((groups) => Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter((row) => row.userId !== id)])));
        setFanClubMsgs((groups) => Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter((row) => row.userId !== id)])));
        setLounge((groups) => Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter((row) => row.userId !== id)])));
        setDms((threads) => { const next = { ...threads }; delete next[dmKey(session.id, id)]; return next; });
        setNotifications((rows) => rows.filter((notification) => notification.actorId !== id));
      })
      .catch(() => {
        const restored = blockedIdsRef.current.filter((x) => x !== id);
        blockedIdsRef.current = restored;
        setBlockedIds(restored);
        setFollows((f) => ({ ...f, [session.id]: mineBefore, [id]: theirsBefore }));
      });
    track("block");
  };
  const unblockUser = (id) => {
    if (!session || !isBlocked(id)) return;
    const nextBlocked = blockedIdsRef.current.filter((x) => x !== id);
    blockedIdsRef.current = nextBlocked;
    setBlockedIds(nextBlocked);
    api(`/api/users/${id}/block`, { method: "POST", body: { blocked: false }, context: "Unblocking this account" })
      .catch(() => {
        const restored = [...new Set([...blockedIdsRef.current, id])];
        blockedIdsRef.current = restored;
        setBlockedIds(restored);
      });
  };
  const blockedUsers = () => blockedIds.map((id) => userById(id)).filter(Boolean);

  // Personal data backup: pull the server's portable account export and hand it
  // to the user as a downloadable JSON file.
  const exportMyData = async () => {
    if (!session) return { ok: false, error: "Log in before exporting your data." };
    try {
      const data = await api("/api/me/export", { context: "Preparing your account export", silent: true });
      const fileName = `pit-backup-${session.handle || "me"}-${new Date().toISOString().slice(0, 10)}.json`;
      const json = JSON.stringify(data, null, 2);
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        const [{ File, Paths }, Sharing] = await Promise.all([
          import("expo-file-system"),
          import("expo-sharing"),
        ]);
        if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is unavailable on this device.");
        const file = new File(Paths.cache, fileName);
        file.create({ overwrite: true, intermediates: true });
        file.write(json);
        await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "Save your Pit data" });
      }
      return { ok: true, fileName };
    } catch (error) {
      const appError = captureAppError(error, {
        code: error?.status ? undefined : "PIT-STORE-001",
        context: "Saving your account export",
        source: "account-export",
        toast: false,
      });
      return { ok: false, error: appError.userMessage || "Pit could not prepare your data file.", appError };
    }
  };

  // Afterparty interactions
  const commentsFor = (id) => comments[id] || [];
  // Inline comment previews on the feed call this per card; a small in-flight
  // guard stops the same post being fetched twice at once (card + PostScreen).
  const commentsInflight = useRef(new Set());
  const commentsLoadedAt = useRef(new Map());
  // Slice 3: pull a post's comments from the server and merge them in (dedupe by
  // id). For bundled demo posts the server has none, so the seed comments stand.
  const loadComments = (id, { limit = 50, force = false } = {}) => {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const requestKey = `${id}:${safeLimit}`;
    if (!id || commentsInflight.current.has(requestKey)) return;
    if (!force && Date.now() - (commentsLoadedAt.current.get(requestKey) || 0) < 30_000) return;
    commentsInflight.current.add(requestKey);
    api(`/api/posts/${id}/comments?limit=${safeLimit}`)
      .then(({ comments: rows, removedIds = [] }) => {
        if (!Array.isArray(rows)) return;
        commentsLoadedAt.current.set(requestKey, Date.now());
        setComments((m) => {
          const existing = m[id] || [];
          const byId = new Map(existing.map((c) => [c.id, c]));
          const incomingIds = new Set(rows.map((comment) => comment.id));
          // Leaf deletions disappear. Deleted parents returned as tombstones stay
          // long enough to hold their replies in the right place.
          for (const removedId of removedIds) if (!incomingIds.has(removedId)) byId.delete(removedId);
          // Merge server rows over local (adopt parentId/avatar/role), keep any
          // optimistic locals not yet on the server. Sorted oldest→newest.
          for (const c of rows) byId.set(c.id, { id: c.id, userId: c.userId, name: c.name, initials: c.initials, avatarUri: c.avatarUri, avatarColor: c.avatarColor, role: c.role, verified: c.verified, text: c.text, deleted: !!c.deleted, parentId: c.parentId || null, at: c.createdAt, likes: 0 });
          const merged = [...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0));
          const unchanged = merged.length === existing.length && merged.every((comment, index) => {
            const previous = existing[index];
            return previous?.id === comment.id && previous.text === comment.text && previous.deleted === comment.deleted && previous.parentId === comment.parentId && previous.at === comment.at;
          });
          return unchanged ? m : { ...m, [id]: merged };
        });
      })
      .catch(() => {})
      .finally(() => commentsInflight.current.delete(requestKey));
  };
  const addComment = (id, text, parentId = null) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!session || !t) return Promise.resolve({ ok: false });
    const localId = "c_" + Date.now();
    const c = { id: localId, userId: session.id, name: session.name, initials: session.initials, avatarUri: session.avatarUri, avatarColor: session.avatarColor, role: session.role, text: t, parentId: parentId || null, at: Date.now(), likes: 0, pending: true };
    setComments((m) => ({ ...m, [id]: [...(m[id] || []), c] }));
    // Write-through + adopt the server id so a later loadComments() dedupes it
    // instead of showing my comment twice.
    return api(`/api/posts/${id}/comments`, { method: "POST", body: { text: t, parentId: parentId || null }, context: "Adding your afterparty comment" })
      .then(({ id: sid }) => {
        const published = { ...c, id: sid || localId, pending: false, createdAt: c.at };
        setComments((m) => ({ ...m, [id]: (m[id] || []).map((x) => (x.id === localId ? published : x)) }));
        feedMutationRevisionRef.current += 1;
        setFeed((posts) => posts.map((post) => {
          if (post.id !== id) return post;
          const preview = [...(Array.isArray(post.commentPreview) ? post.commentPreview : []), published]
            .filter((comment, index, all) => all.findIndex((candidate) => candidate.id === comment.id) === index)
            .slice(-2);
          return {
            ...post,
            ...(Array.isArray(post.commentPreview) ? { commentPreview: preview } : {}),
            comments: (Number(post.comments) || 0) + 1,
          };
        }));
        const owner = postOwner(id);
        track("interaction", { postId: id, action: "comment", surface: "afterparty" });
        if (owner) notify(owner, "comment", { postId: id, artist: feed.find((l) => l.id === id)?.artist, text: t.slice(0, 60) });
        return { ok: true, id: sid || localId };
      })
      .catch((error) => {
        setComments((m) => ({ ...m, [id]: (m[id] || []).filter((x) => x.id !== localId) }));
        return { ok: false, error };
      });
  };
  const deleteOwnComment = (postId, commentId) => {
    if (!session || !postId || !commentId) return Promise.resolve({ ok: false });
    return api(`/api/posts/${postId}/comments/${commentId}`, {
      method: "DELETE",
      context: "Deleting your comment",
    }).then(({ tombstone }) => {
      setComments((all) => {
        const current = all[postId] || [];
        const next = tombstone
          ? current.map((comment) => (comment.id === commentId
            ? { ...comment, userId: null, name: null, initials: null, avatarUri: null, text: "", deleted: true }
            : comment))
          : current.filter((comment) => comment.id !== commentId);
        return { ...all, [postId]: next };
      });
      return { ok: true, tombstone: !!tombstone };
    }).catch((error) => ({ ok: false, error }));
  };
  // Delete your own post. Optimistic: drop it from the feed immediately, and if
  // the write fails put it back exactly where it was so nothing is silently
  // lost. The server soft-deletes, so a failed request never orphans comments.
  const deleteOwnPost = (postId) => {
    if (!session || !postId) return Promise.resolve({ ok: false });
    let removed = null;
    let removedIndex = -1;
    feedMutationRevisionRef.current += 1;
    setFeed((f) => {
      removedIndex = f.findIndex((l) => l.id === postId);
      removed = removedIndex >= 0 ? f[removedIndex] : null;
      return f.filter((l) => l.id !== postId);
    });
    return api(`/api/posts/${postId}`, { method: "DELETE", context: "Deleting your post" })
      .then(() => { track("delete_post", { postId }); return { ok: true }; })
      .catch((error) => {
        // Restore at the original position, not just at the top of the feed.
        if (removed) {
          feedMutationRevisionRef.current += 1;
          setFeed((f) => {
            if (f.some((l) => l.id === postId)) return f;
            const next = [...f];
            next.splice(Math.max(0, Math.min(removedIndex, next.length)), 0, removed);
            return next;
          });
        }
        return { ok: false, error };
      });
  };
  const likeInfo = (id, base = 0) => ({ count: (likes[id] ?? base) + (myLikes[id] ? 1 : 0), liked: !!myLikes[id] });
  const toggleLike = (id, base = 0) => {
    const previous = !!myLikes[id];
    const liked = !previous;
    feedMutationRevisionRef.current += 1;
    setMyLikes((m) => ({ ...m, [id]: liked }));
    setLikes((l) => ({ ...l, [id]: l[id] ?? base }));
    if (session) api(`/api/posts/${id}/like`, { method: "POST", body: { liked }, context: liked ? "Liking this review" : "Removing your like" })
      .then((result) => {
        feedMutationRevisionRef.current += 1;
        if (typeof result?.liked === "boolean") setMyLikes((m) => ({ ...m, [id]: result.liked }));
        track("interaction", { postId: id, action: liked ? "like" : "unlike", surface: "feed" });
        if (liked) { track("like", { postId: id }); const o = postOwner(id); if (o) notify(o, "like", { postId: id, artist: feed.find((l) => l.id === id)?.artist }); }
      })
      .catch(() => {
        feedMutationRevisionRef.current += 1;
        setMyLikes((m) => ({ ...m, [id]: previous }));
      });
  };

  const notInterested = (postId) => {
    if (!session?.id || !postId) return Promise.resolve({ ok: false });
    const accountId = session.id;
    const mutationKey = recommendationPreferenceMutationKey(accountId, postId);
    recommendationPreferenceRevisionRef.current += 1;
    setRecommendationHiddenIds((current) => {
      const next = new Set([...current, postId]);
      save(recommendationPreferenceStorageKey(accountId), [...next]);
      return next;
    });
    const operation = recommendationPreferenceMutationsRef.current.hide(mutationKey, () => api(
      `/api/feed/preferences/${encodeURIComponent(postId)}`,
      {
        method: "POST",
        body: { action: "not_interested" },
        context: "Tuning your recommendations",
        silent: true,
      },
    ));
    return operation.promise.then((result) => {
      track("recommendation_feedback", { postId, action: "not_interested", surface: "everyone" }, { expectedAccountId: accountId });
      return result;
    }).catch((error) => {
      if (!recommendationPreferenceMutationsRef.current.isCurrent(operation)) throw error;
      const persisted = loadRecommendationHiddenIds(accountId);
      persisted.delete(postId);
      save(recommendationPreferenceStorageKey(accountId), [...persisted]);
      if (sessionRef.current?.id === accountId) {
        setRecommendationHiddenIds((current) => {
          const next = new Set(current);
          next.delete(postId);
          save(recommendationPreferenceStorageKey(accountId), [...next]);
          return next;
        });
      }
      throw error;
    });
  };
  const undoNotInterested = (postId) => {
    if (!session?.id || !postId) return Promise.resolve({ ok: false });
    const accountId = session.id;
    const mutationKey = recommendationPreferenceMutationKey(accountId, postId);
    recommendationPreferenceRevisionRef.current += 1;
    setRecommendationHiddenIds((current) => {
      const next = new Set(current);
      next.delete(postId);
      save(recommendationPreferenceStorageKey(accountId), [...next]);
      return next;
    });
    const operation = recommendationPreferenceMutationsRef.current.undo(mutationKey, () => api(
      `/api/feed/preferences/${encodeURIComponent(postId)}`,
      {
        method: "DELETE",
        context: "Restoring this recommendation",
        silent: true,
      },
    ));
    return operation.promise.catch((error) => {
      if (!recommendationPreferenceMutationsRef.current.isCurrent(operation)) throw error;
      const persisted = loadRecommendationHiddenIds(accountId);
      persisted.add(postId);
      save(recommendationPreferenceStorageKey(accountId), [...persisted]);
      if (sessionRef.current?.id === accountId) {
        setRecommendationHiddenIds((current) => {
          const next = new Set([...current, postId]);
          save(recommendationPreferenceStorageKey(accountId), [...next]);
          return next;
        });
      }
      throw error;
    });
  };

  const visibleFeed = (staff) =>
    (staff ? feed : feed.filter((l) => !removedIds.includes(l.id)))
      .filter((l) => !l.userId || !blockedIds.includes(l.userId))
      .filter((l) => staff || !recommendationHiddenIds.has(l.id));

  // Feed of only the people you follow (plus yourself).
  const followingFeed = (staff) => {
    const ids = new Set([...(follows[session?.id] || []), session?.id]);
    return visibleFeed(staff).filter((l) => ids.has(l.userId));
  };

  // Roll a single artist's live reputation up across every logged night +
  // community-aggregated show, with their upcoming dates. This is the answer to
  // "is this band worth seeing?" - the core question the app exists for.
  const norm = (s) => (s || "").trim().toLowerCase();

  // A stable id for a concert (artist + venue + date) so the lounge, the going
  // list, and attendees all key off the same thing. The date is canonicalized
  // first: bundled seed data, legacy local posts and server rows have all been
  // written in different date formats, and without this they would key as
  // different performances. An unparseable date falls back to the raw value so
  // such a log still gets a consistent key of its own.
  const concertKey = (log) => `${norm(log.artist)}|${norm(log.venue)}|${toIsoDate(log.date) || log.date || ""}`.toLowerCase();

  const commitGoingState = (accountId, entry, desired) => {
    const current = goingRef.current;
    const mine = current[accountId] || [];
    const nextMine = desired
      ? [...mine.filter((item) => item.key !== entry.key), entry]
      : mine.filter((item) => item.key !== entry.key);
    const next = { ...current, [accountId]: nextMine };
    goingRef.current = next;
    setGoing(next);
  };
  const setGoingIntent = (log, desired, context) => {
    const actor = sessionRef.current;
    if (!actor || !log) return Promise.resolve({ ok: false });
    const key = concertKey(log);
    const entry = { key, artist: log.artist, venue: log.venue, city: log.city, date: log.date };
    const scope = goingIntentKey(actor.id, key);
    const currentGoing = (goingRef.current[actor.id] || []).some((item) => item.key === key);
    if (!goingConfirmedRef.current.has(scope)) goingConfirmedRef.current.set(scope, currentGoing);
    goingMutationRevisionRef.current += 1;
    commitGoingState(actor.id, entry, desired);
    const operation = goingIntentRef.current.begin({
      accountId: actor.id,
      showKey: key,
      desired,
      send: () => api("/api/going", {
        method: "POST",
        body: { ...entry, going: desired },
        context,
      }),
    });
    goingPendingRef.current = { ...goingPendingRef.current, [scope]: operation.revision };
    setGoingPending(goingPendingRef.current);
    return operation.result.then((result) => {
      const coordinator = goingIntentRef.current;
      if (!coordinator.isActive(operation, sessionRef.current?.id) || result.stale) {
        return { ok: false, stale: true };
      }
      const confirmed = result.ok && typeof result.value?.going === "boolean"
        ? result.value.going
        : goingConfirmedRef.current.get(scope);
      if (result.ok && typeof result.value?.going === "boolean") goingConfirmedRef.current.set(scope, confirmed);
      if (!coordinator.isLatest(operation, sessionRef.current?.id)) return { ok: false, stale: true };
      commitGoingState(actor.id, entry, !!confirmed);
      if (goingPendingRef.current[scope] === operation.revision) {
        const { [scope]: _finished, ...rest } = goingPendingRef.current;
        goingPendingRef.current = rest;
        setGoingPending(rest);
      }
      return { ok: result.ok && typeof result.value?.going === "boolean", going: !!confirmed };
    });
  };

  const nextChatMutationId = (kind) => {
    let candidate = createChatClientMutationId(kind);
    for (let attempt = 0; attempt < 4 && chatOutboxRef.current.some((item) => item.clientMutationId === candidate); attempt += 1) {
      candidate = createChatClientMutationId(kind);
    }
    return candidate;
  };
  const commitConfirmedChatMessage = (item, serverId) => {
    const message = confirmedChatMessage(item, serverId);
    if (!message) return;
    if (item.kind === "dm") {
      setDms((all) => ({ ...all, [item.channelKey]: mergeChatMessages(all[item.channelKey] || [], [message], [], 750) }));
    } else if (item.kind === "fan") {
      setFanClubMsgs((all) => ({ ...all, [item.channelKey]: mergeChatMessages(all[item.channelKey] || [], [message], [], 600) }));
    } else if (item.kind === "lounge") {
      setLounge((all) => ({ ...all, [item.channelKey]: mergeChatMessages(all[item.channelKey] || [], [message], [], 600) }));
    }
  };
  const deliverChatMessage = async (localId) => {
    const item = chatOutboxRef.current.find((entry) => entry.id === localId);
    if (!item || item.ownerId !== sessionRef.current?.id || item.authEpoch !== chatAuthEpochRef.current) {
      return { ok: false, stale: true };
    }
    if (item.status === "sending") return { ok: false, pending: true, localId };
    commitChatOutbox((current) => updateChatOutboxItem(current, localId, {
      status: "sending",
      pending: true,
      failed: false,
    }));
    try {
      const { id } = await api(item.endpoint, {
        method: "POST",
        body: { text: item.text, clientMutationId: item.clientMutationId },
        context: item.context,
      });
      if (!id) throw new Error("Message delivery was not confirmed");
      const live = chatOutboxRef.current.find((entry) => entry.id === localId);
      if (!live || live.ownerId !== sessionRef.current?.id || live.authEpoch !== chatAuthEpochRef.current) {
        return { ok: false, stale: true };
      }
      commitChatOutbox((current) => withoutChatOutboxItem(current, localId));
      commitConfirmedChatMessage(live, id);
      return { ok: true, id, localId };
    } catch {
      const live = chatOutboxRef.current.find((entry) => entry.id === localId);
      if (live && live.ownerId === sessionRef.current?.id && live.authEpoch === chatAuthEpochRef.current) {
        commitChatOutbox((current) => updateChatOutboxItem(current, localId, {
          status: "failed",
          pending: false,
          failed: true,
        }));
        return { ok: false, retryable: true, localId };
      }
      return { ok: false, stale: true };
    }
  };
  const queueChatMessage = (item) => {
    commitChatOutbox((current) => withChatOutboxItem(current, item));
    return deliverChatMessage(item.id);
  };
  const retryChatMessage = (localId) => deliverChatMessage(localId);
  const cancelChatMessage = (localId) => {
    const item = chatOutboxRef.current.find((entry) => entry.id === localId);
    if (!item || item.ownerId !== sessionRef.current?.id || item.status !== "failed") return false;
    commitChatOutbox((current) => withoutChatOutboxItem(current, localId));
    return true;
  };

  // --- Concert Lounge (gated attendee chat, now server-backed + live) ---
  const loungeFor = (key) => mergeChatMessages(
    lounge[key] || [],
    chatOutboxFor(chatOutbox, { ownerId: session?.id, kind: "lounge", channelKey: key }),
    [],
    600,
  );
  // Pull a lounge's messages from the server and merge by id (dedup-safe, so this
  // can be polled while the screen is open to get live chat like the fan clubs).
  const loadLounge = (key, { after, signal } = {}) => {
    const read = key ? chatReadsRef.current.claim(`lounge:${key}`, sessionRef.current) : null;
    if (!read) return Promise.resolve({ syncCursor: after || null, hasMore: false });
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return api(`/api/lounges/${encodeURIComponent(key)}/messages${query}`, {
      signal,
      silent: true,
      context: "Refreshing the concert lounge",
    })
      .then(({ messages, syncCursor, hasMore, removedIds }) => {
        if (signal?.aborted || !chatReadsRef.current.isCurrent(read, sessionRef.current)) {
          return { syncCursor: after || null, hasMore: false, stale: true };
        }
        if (!Array.isArray(messages)) return { syncCursor: after || null, hasMore: false };
        setLounge((L) => {
          const existing = L[key] || [];
          const incoming = messages.map((m) => ({ id: m.id, userId: m.userId, name: m.name, initials: m.initials, avatarUri: m.avatarUri, avatarColor: m.avatarColor, role: m.role, text: m.text, at: m.createdAt, ts: ago(m.createdAt), server: true }));
          return { ...L, [key]: mergeChatMessages(existing, incoming, removedIds, 600) };
        });
        return { syncCursor: syncCursor || after || null, hasMore: !!hasMore };
      })
      .catch((error) => {
        if (signal?.aborted) throw error;
        return { syncCursor: after || null, hasMore: false };
      });
  };
  // Entering a lounge is also the user's explicit "I'm going" action. Save it
  // before revealing the composer so the server-side attendance gate cannot race
  // the first message. The desired state is idempotent and never removes an
  // existing attendee when entry is retried.
  const enterLounge = async (log) => {
    if (!log) return { ok: false };
    if (!sessionRef.current) return { ok: true, guest: true };
    const key = concertKey(log);
    const result = await setGoingIntent(log, true, "Entering the concert lounge");
    return result.ok && result.going ? { ok: true, key } : { ok: false, stale: !!result.stale };
  };
  const addLoungeMessage = (key, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    const actor = sessionRef.current;
    if (!actor || !key || !t) return Promise.resolve({ ok: false, retryable: false });
    const clientMutationId = nextChatMutationId("lounge");
    const localId = chatOutboxMessageId(clientMutationId);
    return queueChatMessage({
      id: localId,
      ownerId: actor.id,
      authEpoch: chatAuthEpochRef.current,
      kind: "lounge",
      channelKey: key,
      target: key,
      endpoint: `/api/lounges/${encodeURIComponent(key)}/messages`,
      context: "Sending your afterparty message",
      clientMutationId,
      status: "queued",
      userId: actor.id,
      name: actor.name,
      initials: actor.initials,
      avatarUri: actor.avatarUri,
      avatarColor: actor.avatarColor,
      role: actor.role,
      text: t,
      at: Date.now(),
      ts: "now",
      pending: true,
      failed: false,
    });
  };

  // --- Album + song ratings (Apple-Music-style stars), slice 7 ---
  // Local map stays the offline model; ratingAgg overlays the server aggregate
  // ({ avg, count, mine }) once loaded, so counts reflect everyone, not just this
  // browser. Reads prefer the server aggregate when present.
  const rKey = (artist, title) => `${norm(artist)}|${norm(title)}`;
  const aggKey = (kind, artist, title) => `${kind}|${rKey(artist, title)}`;
  const aggRate = (map, artist, title) => {
    const r = map[rKey(artist, title)];
    if (!r) return { avg: 0, count: 0, mine: 0 };
    const vals = Object.values(r);
    return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length, mine: (session && r[session.id]) || 0 };
  };
  // Two independent requests write the same aggregate key: the GET below and
  // the POST in `rate`. Without ordering, a GET issued before a rating could
  // land after it and overwrite the fresh value with the pre-rating one, so the
  // star visibly reverted. Likewise a failed OLD rating could roll back a newer
  // successful one. Every request claims a ticket for its key; only the newest
  // ticket is allowed to write.
  // Ordering lives in src/domain/latestWins.mjs so the invariant is unit-tested.
  const ratingTicketsRef = useRef(null);
  if (!ratingTicketsRef.current) ratingTicketsRef.current = createTicketRegistry();
  const claimRatingTicket = (key) => ratingTicketsRef.current.claim(key);
  const ratingTicketIsCurrent = (key, ticket) => ratingTicketsRef.current.isCurrent(key, ticket);

  const loadRating = (kind, artist, title) => {
    const aggregateKey = aggKey(kind, artist, title);
    const ticket = claimRatingTicket(aggregateKey);
    api(`/api/ratings?kind=${kind}&ref=${encodeURIComponent(rKey(artist, title))}`)
      .then((r) => {
        if (!ratingTicketIsCurrent(aggregateKey, ticket)) return; // a newer rating won
        setRatingAgg((m) => ({ ...m, [aggregateKey]: { avg: r.avg, count: r.count, mine: r.mine } }));
      })
      .catch(() => {});
  };
  const albumRating = (artist, title) => ratingAgg[aggKey("album", artist, title)] || aggRate(albumRatings, artist, title);
  const songRating = (artist, title) => ratingAgg[aggKey("song", artist, title)] || aggRate(songRatings, artist, title);
  const rate = (kind, setMap, artist, title, n) => {
    if (!session) return;
    const nn = clampRating(n);
    const key = rKey(artist, title);
    const aggregateKey = aggKey(kind, artist, title);
    const sourceMap = kind === "album" ? albumRatings : songRatings;
    const previous = sourceMap[key]?.[session.id];
    const previousAggregate = ratingAgg[aggregateKey];
    const ticket = claimRatingTicket(aggregateKey);
    setMap((m) => ({ ...m, [key]: { ...(m[key] || {}), [session.id]: nn } }));
    setRatingAgg((m) => { const cur = m[aggregateKey]; return cur ? { ...m, [aggregateKey]: { ...cur, mine: nn } } : m; });
    api("/api/ratings", { method: "POST", body: { kind, ref: key, rating: nn }, context: `Rating this ${kind}` })
      .then((r) => {
        if (!ratingTicketIsCurrent(aggregateKey, ticket)) return; // superseded
        setRatingAgg((m) => ({ ...m, [aggregateKey]: { avg: r.avg, count: r.count, mine: r.mine } }));
      })
      .catch(() => {
        // Only the newest attempt may roll back. Otherwise rating twice quickly
        // and having the FIRST request fail would undo the second, successful one.
        if (!ratingTicketIsCurrent(aggregateKey, ticket)) return;
        setMap((m) => {
          const ratings = { ...(m[key] || {}) };
          if (previous == null) delete ratings[session.id]; else ratings[session.id] = previous;
          const next = { ...m };
          if (Object.keys(ratings).length) next[key] = ratings; else delete next[key];
          return next;
        });
        setRatingAgg((m) => {
          const next = { ...m };
          if (previousAggregate) next[aggregateKey] = previousAggregate; else delete next[aggregateKey];
          return next;
        });
      });
  };
  const rateAlbum = (artist, title, n) => rate("album", setAlbumRatings, artist, title, n);
  const rateSong = (artist, title, n) => rate("song", setSongRatings, artist, title, n);

  // --- Artist fan clubs (permanent chat, keyed by artist) ---
  const fcKey = (artist) => norm(artist);
  const fanClubFor = (artist) => {
    const key = fcKey(artist);
    return mergeChatMessages(
      fanClubMsgs[key] || [],
      chatOutboxFor(chatOutbox, { ownerId: session?.id, kind: "fan", channelKey: key }),
      [],
      600,
    );
  };
  const loadFanClubsDirectory = ({ signal } = {}) => {
    const accountId = sessionRef.current?.id || null;
    const claim = fanClubDirectoryReadsRef.current.claim(accountId);
    setFanClubDirectoryStatus("loading");
    return api("/api/fanclubs", { signal, silent: true, context: "Refreshing fan clubs" })
      .then(({ clubs }) => {
        if (signal?.aborted || !fanClubDirectoryReadsRef.current.isCurrent(claim, sessionRef.current?.id || null)) {
          return { ok: false, stale: true };
        }
        const snapshot = normalizeFanClubDirectory(clubs);
        setFanClubDirectorySnapshot(snapshot);
        setFanClubDirectoryStatus("ready");
        return { ok: true, clubs: snapshot };
      })
      .catch((error) => {
        if (!signal?.aborted && fanClubDirectoryReadsRef.current.isCurrent(claim, sessionRef.current?.id || null)) {
          setFanClubDirectoryStatus("error");
        }
        if (signal?.aborted) throw error;
        return { ok: false };
      });
  };
  // Slice 5: pull a club's messages + real member count from the server, merging
  // messages by id. No-op offline; bundled seed clubs keep their seed chatter.
  const loadFanClub = (artist, { after, signal } = {}) => {
    const key = fcKey(artist);
    const read = key ? chatReadsRef.current.claim(`fan:${key}`, sessionRef.current) : null;
    if (!read) return Promise.resolve({ syncCursor: after || null, hasMore: false });
    const enc = encodeURIComponent(key);
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return api(`/api/fanclubs/${enc}/messages${query}`, {
      signal,
      silent: true,
      context: "Refreshing the fan-club chat",
    })
      .then(({ members, messages, syncCursor, hasMore, removedIds }) => {
        if (signal?.aborted || !chatReadsRef.current.isCurrent(read, sessionRef.current)) {
          return { syncCursor: after || null, hasMore: false, stale: true };
        }
        if (typeof members === "number") setFanClubMeta((meta) => ({ ...meta, [key]: { members } }));
        if (Array.isArray(messages)) setFanClubMsgs((L) => {
          const incoming = messages.map((m) => ({ id: m.id, userId: m.userId, name: m.name, initials: m.initials, text: m.text, at: m.createdAt, ts: ago(m.createdAt), server: true }));
          return { ...L, [key]: mergeChatMessages(L[key] || [], incoming, removedIds, 600) };
        });
        return { syncCursor: syncCursor || after || null, hasMore: !!hasMore };
      })
      .catch((error) => {
        if (signal?.aborted) throw error;
        return { syncCursor: after || null, hasMore: false };
      });
  };
  const addFanClubMessage = (artist, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    const actor = sessionRef.current;
    const key = fcKey(artist);
    if (!actor || !key || !t) return Promise.resolve({ ok: false, retryable: false });
    const clientMutationId = nextChatMutationId("fan");
    const localId = chatOutboxMessageId(clientMutationId);
    return queueChatMessage({
      id: localId,
      ownerId: actor.id,
      authEpoch: chatAuthEpochRef.current,
      kind: "fan",
      channelKey: key,
      target: key,
      endpoint: `/api/fanclubs/${encodeURIComponent(key)}/messages`,
      context: "Sending your fan-club message",
      clientMutationId,
      status: "queued",
      userId: actor.id,
      name: actor.name,
      initials: actor.initials,
      text: t,
      at: Date.now(),
      ts: "now",
      pending: true,
      failed: false,
    });
  };
  const isFanClubMember = (artist) => (fanClubs[session?.id] || []).some((a) => norm(a) === norm(artist));
  const joinFanClub = (artist) => {
    if (!session) return Promise.resolve({ ok: false, joined: false });
    const accountId = session.id;
    const has = isFanClubMember(artist);
    const enc = encodeURIComponent(norm(artist));
    const joined = !has;
    const applyMembership = (state, previous) => {
      setFanClubs((groups) => {
        const mine = groups[accountId] || [];
        return { ...groups, [accountId]: state
          ? [...mine.filter((name) => norm(name) !== norm(artist)), artist]
          : mine.filter((name) => norm(name) !== norm(artist)) };
      });
      setFanClubDirectorySnapshot((rows) => fanClubDirectoryStatus === "ready"
        ? applyFanClubMembership(rows, { artist, joined: state, wasMember: previous })
        : rows);
    };
    applyMembership(joined, has);
    return api(`/api/fanclubs/${enc}/join`, { method: "POST", body: { joined }, context: joined ? "Joining this fan club" : "Leaving this fan club" })
      .then((result) => {
        const confirmed = typeof result?.joined === "boolean" ? result.joined : joined;
        if (confirmed !== joined) applyMembership(confirmed, joined);
        if (confirmed && !has) track("join_fanclub");
        return { ok: true, joined: confirmed };
      })
      .catch(() => {
        applyMembership(has, joined);
        return { ok: false, joined: has };
      });
  };
  const fanClubCount = (artist) => {
    const key = fcKey(artist);
    const authoritative = fanClubDirectorySnapshot.find((club) => fcKey(club.artist) === key);
    if (authoritative) return authoritative.members;
    if (fanClubDirectoryStatus === "ready") return isFanClubMember(artist) ? 1 : 0;
    return fanClubMeta[key]?.members ?? Object.values(fanClubs).filter((arr) => arr.some((a) => norm(a) === key)).length;
  };

  // Directory of fan clubs, most members first, powers the Fan clubs screen and
  // the Community search pane so clubs are findable, not buried on artist pages.
  const fanClubsDirectory = () => {
    if (fanClubDirectoryStatus === "ready") {
      return fanClubDirectorySnapshot.map((club) => ({
        ...club,
        artist: catalogArtists[fcKey(club.artist)]?.name || club.artist.replace(/\b\w/g, (character) => character.toUpperCase()),
      }));
    }
    const byKey = {};
    Object.values(fanClubs).forEach((arr) =>
      arr.forEach((name) => {
        const k = norm(name);
        (byKey[k] ||= { artist: name, members: 0, messages: 0 }).members++;
      })
    );
    Object.keys(fanClubMsgs).forEach((k) => {
      (byKey[k] ||= { artist: k.replace(/\b\w/g, (c) => c.toUpperCase()), members: 0, messages: 0 });
      byKey[k].messages = fanClubMsgs[k].length;
    });
    return Object.values(byKey).sort((a, b) => b.members - a.members || b.messages - a.messages || a.artist.localeCompare(b.artist));
  };

  // --- Artist-owned profile (banner/avatar/bio overrides + updates feed) ------
  // An artist account "owns" the page whose artistName matches theirs; admins
  // can edit any. The seed (catalog/ingested) is the fallback; overrides win.
  const isArtistOwner = (name) => {
    if (!session) return false;
    if (isStaff(session.role)) return true;
    return session.role === "artist" && norm(session.artistName) === norm(name);
  };
  const artistProfile = (name) => artistProfiles[norm(name)] || {};
  // Slice 7: hydrate an artist page's owner overrides + updates feed.
  const loadArtistPage = (name) => {
    const enc = encodeURIComponent(norm(name));
    api(`/api/artists/${enc}/profile`)
      .then(({ profile, posts }) => {
        setArtistProfiles((m) => ({ ...m, [norm(name)]: profile ? { ...(m[norm(name)] || {}), ...profile } : {} }));
        if (Array.isArray(posts)) {
          // This is an authoritative moderation-aware snapshot. Replacing it also
          // removes a post that staff hid since this device last opened the page.
          setArtistPosts((m) => ({
            ...m,
            [norm(name)]: posts.map((p) => ({ id: p.id, userId: p.userId, text: p.text, ts: ago(p.createdAt) })),
          }));
        }
      })
      .catch(() => {});
  };
  const updateArtistProfile = (name, patch) => {
    if (!isArtistOwner(name)) return Promise.resolve({ ok: false });
    const key = norm(name);
    const previous = artistProfiles[key] || {};
    const safe = { ...patch };
    if ("bio" in safe) safe.bio = clean(safe.bio, { max: 600, newlines: true });
    setArtistProfiles((m) => ({ ...m, [key]: { ...(m[key] || {}), ...safe } }));
    const enc = encodeURIComponent(key);
    return api(`/api/artists/${enc}/profile`, { method: "PATCH", body: safe, context: "Saving this artist page" })
      .then(() => ({ ok: true }))
      .catch((error) => {
        setArtistProfiles((m) => ({ ...m, [key]: previous }));
        return { ok: false, error };
      });
  };
  const artistFeedEnabled = (name) => !!artistProfiles[norm(name)]?.feedEnabled;
  const artistPostsFor = (name) => artistPosts[norm(name)] || [];
  const addArtistPost = (name, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!isArtistOwner(name) || !t) return;
    const localId = "ap_" + Date.now();
    const p = { id: localId, userId: session.id, text: t, ts: "now" };
    setArtistPosts((m) => ({ ...m, [norm(name)]: [p, ...(m[norm(name)] || [])] }));
    const enc = encodeURIComponent(norm(name));
    api(`/api/artists/${enc}/posts`, { method: "POST", body: { text: t } })
      .then(({ id }) => { if (id) setArtistPosts((m) => ({ ...m, [norm(name)]: (m[norm(name)] || []).map((x) => (x.id === localId ? { ...x, id } : x)) })); })
      .catch(() => setArtistPosts((m) => ({ ...m, [norm(name)]: (m[norm(name)] || []).filter((x) => x.id !== localId) })));
  };
  const removeArtistPost = (name, id) => {
    if (!isArtistOwner(name)) return;
    setArtistPosts((m) => ({ ...m, [norm(name)]: (m[norm(name)] || []).filter((p) => p.id !== id) }));
    const enc = encodeURIComponent(norm(name));
    api(`/api/artists/${enc}/posts/${id}`, { method: "DELETE" }).catch(() => {});
  };

  // --- Ban / suspend (staff) ---
  const patchStaffMember = (id, patch, { publicPatch = null } = {}) => {
    const previous = adminMembersRef.current.find((member) => member.id === id);
    const reconciled = reconcileMemberMutationPage(
      adminMembersRef.current,
      adminMemberDirectoryRef.current,
      id,
      patch,
    );
    adminMembersRef.current = reconciled.members;
    setAdminMembers(reconciled.members);
    if (reconciled.directory !== adminMemberDirectoryRef.current) {
      adminMemberDirectoryRef.current = reconciled.directory;
      setAdminMemberDirectory(reconciled.directory);
    }
    if (previous && Object.hasOwn(patch, "isBanned") && !!previous.isBanned !== !!patch.isBanned) {
      setAdminStats((current) => {
        const next = { ...current, banned: Math.max(0, Number(current.banned || 0) + (patch.isBanned ? 1 : -1)) };
        adminStatsRef.current = next;
        return next;
      });
    }
    if (previous && Object.hasOwn(patch, "verified") && !!previous.verified !== !!patch.verified) {
      setAdminStats((current) => {
        const next = { ...current, verified: Math.max(0, Number(current.verified || 0) + (patch.verified ? 1 : -1)) };
        adminStatsRef.current = next;
        return next;
      });
    }
    setModerationConsole((current) => {
      const next = patchModerationMemberContext(current, id, patch);
      moderationConsoleRef.current = next;
      return next;
    });
    setReports((current) => patchModerationMemberContext({ reports: current }, id, patch).reports);
    if (publicPatch) {
      setUsers((current) => current.map((user) => user.id === id ? { ...user, ...publicPatch } : user));
    }
  };
  const staffMutationStillOwned = (scope) => !!scope && scope === staffScopeFor(sessionRef.current);
  const invalidateStaffMemberReads = () => {
    staffReadsRef.current.invalidate("members", sessionRef.current);
    staffReadsRef.current.invalidate("moderation", sessionRef.current);
  };

  const accountStatus = (u) => {
    if (!u) return "ok";
    if (u.isBanned) return "banned";
    if (u.suspendedUntil && u.suspendedUntil > Date.now()) return "suspended";
    return "ok";
  };
  const banUser = async (id) => {
    const scope = staffScopeFor(sessionRef.current);
    try {
      await api(`/api/admin/users/${id}/ban`, { method: "POST", context: "Banning this account" });
      if (staffMutationStillOwned(scope)) {
        invalidateStaffMemberReads();
        patchStaffMember(id, { isBanned: true });
      }
      return true;
    } catch { return false; }
  };
  const unbanUser = async (id) => {
    const scope = staffScopeFor(sessionRef.current);
    try {
      await api(`/api/admin/users/${id}/unban`, { method: "POST", context: "Unbanning this account" });
      if (staffMutationStillOwned(scope)) {
        invalidateStaffMemberReads();
        patchStaffMember(id, { isBanned: false, suspendedUntil: null });
      }
      return true;
    } catch { return false; }
  };
  const suspendUser = async (id, days = 7) => {
    const scope = staffScopeFor(sessionRef.current);
    try {
      const { suspendedUntil } = await api(`/api/admin/users/${id}/suspend`, { method: "POST", body: { days }, context: "Timing out this account" });
      if (staffMutationStillOwned(scope)) {
        invalidateStaffMemberReads();
        patchStaffMember(id, { suspendedUntil });
      }
      return true;
    } catch { return false; }
  };
  const liftSuspension = async (id) => {
    const scope = staffScopeFor(sessionRef.current);
    try {
      await api(`/api/admin/users/${id}/unsuspend`, { method: "POST", context: "Lifting this timeout" });
      if (staffMutationStillOwned(scope)) {
        invalidateStaffMemberReads();
        patchStaffMember(id, { suspendedUntil: null });
      }
      return true;
    } catch { return false; }
  };
  // Full member directory for the admin console (all signups, incl. banned) + live
  // counts and a per-region breakdown. Rows stay in an ephemeral staff-only
  // collection; they never flow through the persisted public profile cache.
  const loadAdminMembersStrict = async ({ signal, query = "", role = "", status = "", append = false } = {}) => {
    const normalizedQuery = String(query || "").trim().slice(0, 80);
    const normalizedRole = ["fan", "artist", "moderator", "admin"].includes(role) ? role : "";
    const normalizedStatus = ["active", "banned", "suspended"].includes(status) ? status : "";
    const previousDirectory = adminMemberDirectoryRef.current;
    const sameScope = previousDirectory.query === normalizedQuery
      && previousDirectory.role === normalizedRole
      && previousDirectory.status === normalizedStatus;
    const cursor = append && sameScope ? previousDirectory.nextCursor : null;
    if (append && !cursor) return {
      users: adminMembersRef.current,
      ...adminStatsRef.current,
      ...previousDirectory,
    };
    const read = staffReadsRef.current.claim("members", sessionRef.current);
    const params = new URLSearchParams({ limit: "50" });
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (normalizedRole) params.set("role", normalizedRole);
    if (normalizedStatus) params.set("status", normalizedStatus);
    if (cursor) params.set("before", cursor);
    const payload = await api(`/api/admin/members?${params.toString()}`, {
      signal,
      silent: true,
      context: append ? "Loading more members" : "Loading the member directory",
    });
    const list = Array.isArray(payload?.users) ? payload.users : [];
    const total = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : list.length;
    const banned = Number.isFinite(Number(payload?.banned)) ? Number(payload.banned) : 0;
    const verified = Number.isFinite(Number(payload?.verified)) ? Number(payload.verified) : 0;
    const regions = Array.isArray(payload?.regions) ? payload.regions : [];
    if (signal?.aborted || !staffReadsRef.current.isCurrent(read, sessionRef.current)) {
      return { users: adminMembersRef.current, ...adminStatsRef.current, ...adminMemberDirectoryRef.current };
    }
    const stats = { total, banned, verified, regions };
    const users = append && sameScope
      ? mergeUniquePage(adminMembersRef.current, list)
      : list;
    const directory = {
      query: normalizedQuery,
      role: normalizedRole,
      status: normalizedStatus,
      matchingTotal: Number.isFinite(Number(payload?.matchingTotal)) ? Number(payload.matchingTotal) : users.length,
      nextCursor: typeof payload?.nextCursor === "string" && payload.nextCursor ? payload.nextCursor : null,
    };
    adminMembersRef.current = users;
    adminStatsRef.current = stats;
    adminMemberDirectoryRef.current = directory;
    setAdminMembers(users);
    setAdminStats(stats);
    setAdminMemberDirectory(directory);
    setMemberCount(total);
    return { users, total, banned, verified, regions, ...directory };
  };
  const loadMoreAdminMembersStrict = (options = {}) => loadAdminMembersStrict({
    ...options,
    query: adminMemberDirectoryRef.current.query,
    role: adminMemberDirectoryRef.current.role,
    status: adminMemberDirectoryRef.current.status,
    append: true,
  });
  const loadAdminMembers = async (options) => {
    try { return (await loadAdminMembersStrict(options)).users; }
    catch { return []; }
  };
  // Catalog queue (admin): thin/blank artists + searched-but-not-found names, and
  // the on-demand seed + purge actions.
  const adminArtistQueue = async () => { try { return await api("/api/admin/artist-queue"); } catch { return { thin: [], missing: [], thinTotal: 0 }; } };
  const enrichArtists = async (names) => { try { const r = await api("/api/admin/artists/enrich", { method: "POST", body: { names } }); return r.enriched || 0; } catch { return 0; } };
  const purgeArtist = async (norm) => { try { await api("/api/admin/artists/purge", { method: "POST", body: { norm } }); } catch {} };
  // Kick off / poll the background "grow the catalog to N artists" job (admin).
  const startCatalogSeed = async (addOrOpts) => {
    const body = typeof addOrOpts === "object" && addOrOpts ? addOrOpts : { add: addOrOpts };
    try { return await api("/api/admin/catalog/seed", { method: "POST", body }); } catch { return { started: false }; }
  };
  const catalogSeedStatus = async () => { try { return await api("/api/admin/catalog/seed"); } catch { return null; } };
  const stopCatalogSeed = async () => { try { return await api("/api/admin/catalog/seed", { method: "DELETE" }); } catch { return null; } };
  // Durable job history, so the console can show what a run actually did even
  // after a restart (an in-memory "done" once hid a run that added nothing).
  const catalogSeedRuns = async () => { try { return (await api("/api/admin/catalog/runs"))?.runs || []; } catch { return []; } };

  // moderation: drop a single chat/lounge/comment message (staff)
  const removeLoungeMessage = (key, msgId) => moderateContent("lounge_message", msgId, true)
    .then(() => { setLounge((L) => ({ ...L, [key]: (L[key] || []).filter((m) => m.id !== msgId) })); return true; }).catch(() => false);
  const removeComment = (logId, cId) => moderateContent("comment", cId, true)
    .then(() => { setComments((m) => ({ ...m, [logId]: (m[logId] || []).filter((c) => c.id !== cId) })); return true; }).catch(() => false);
  const removeFanClubMessage = (artistKey, msgId) => moderateContent("fan_message", msgId, true)
    .then(() => { setFanClubMsgs((L) => ({ ...L, [artistKey]: (L[artistKey] || []).filter((m) => m.id !== msgId) })); return true; }).catch(() => false);
  // Promote/demote a member (fan ⇄ artist ⇄ admin). Admin grants full moderation.
  const setUserRole = async (id, role) => {
    if (!["fan", "artist", "moderator", "admin"].includes(role)) return;
    // Staff carry their role in their @ (admin → "admin", moderator → "mod"); on
    // promotion, tag the handle if it isn't already, keeping it unique.
    const directory = adminMembersRef.current;
    const target = directory.find((u) => u.id === id);
    let handle = target?.handle;
    const tag = role === "admin" ? "admin" : role === "moderator" ? "mod" : null;
    if (target && tag && handle && !handle.includes(tag)) {
      let cand = `${handle}_${tag}`.slice(0, 20), i = 1;
      while (directory.some((x) => x.id !== id && x.handle === cand)) cand = `${handle}_${tag}${i++}`.slice(0, 20);
      handle = cand;
    }
    const scope = staffScopeFor(sessionRef.current);
    try {
      const result = await api(`/api/admin/users/${id}/role`, { method: "POST", body: { role, handle }, context: "Changing this account role" });
      if (staffMutationStillOwned(scope)) {
        // The server allocates against the complete directory, not merely this
        // loaded page, so its collision-safe handle is authoritative.
        const authoritativeHandle = result?.handle || handle || target?.handle;
        invalidateStaffMemberReads();
        patchStaffMember(id, { role, handle: authoritativeHandle }, {
          publicPatch: { role, handle: authoritativeHandle },
        });
      }
      return true;
    } catch { return false; }
  };

  // Admin-granted verification (the blue check), independent of role, so any
  // account can be verified. (Groundwork for a paid tier later; not surfaced as
  // paid yet.) Admin-only.
  const setVerified = async (id, val) => {
    if (!isStaff(sessionRef.current?.role)) return;
    const verified = !!val;
    const scope = staffScopeFor(sessionRef.current);
    try {
      await api(`/api/admin/users/${id}/verified`, { method: "POST", body: { verified }, context: "Updating verification" });
      if (staffMutationStillOwned(scope)) {
        invalidateStaffMemberReads();
        patchStaffMember(id, { verified }, { publicPatch: { verified } });
        setSession((s) => (s && s.id === id ? { ...s, verified } : s));
      }
      return true;
    } catch { return false; }
  };
  // Confirm someone's address for them. Distinct from setVerified above: this is
  // private account state and grants no public badge, so it only ever moves to
  // true and there is no "unconfirm".
  const markEmailVerified = async (id) => {
    if (!isStaff(sessionRef.current?.role)) return false;
    const scope = staffScopeFor(sessionRef.current);
    try {
      await api(`/api/admin/users/${id}/verify-email`, { method: "POST", body: {}, context: "Confirming a member's email" });
      if (staffMutationStillOwned(scope)) {
        invalidateStaffMemberReads();
        patchStaffMember(id, { emailVerified: true });
        setSession((s) => (s && s.id === id ? { ...s, emailVerified: true } : s));
      }
      return true;
    } catch { return false; }
  };
  const setSponsor = async (id, val) => {
    if (!isStaff(sessionRef.current?.role)) return;
    const sponsor = !!val;
    const scope = staffScopeFor(sessionRef.current);
    try {
      await api(`/api/admin/users/${id}/sponsor`, { method: "POST", body: { sponsor }, context: "Updating sponsorship" });
      if (staffMutationStillOwned(scope)) {
        invalidateStaffMemberReads();
        patchStaffMember(id, { sponsor }, { publicPatch: { sponsor } });
        setSession((s) => (s && s.id === id ? { ...s, sponsor } : s));
      }
      return true;
    } catch { return false; }
  };

  // --- Planned attendance ---
  const goingFor = (userId) => going[userId] || [];
  const isGoing = (key) => (going[session?.id] || []).some((g) => g.key === key);
  const isGoingBusy = (key) => !!goingPending[goingIntentKey(session?.id, key)];
  const toggleGoing = (log) => {
    const actor = sessionRef.current;
    if (!actor) return Promise.resolve({ ok: false });
    const key = concertKey(log);
    const desired = !(goingRef.current[actor.id] || []).some((entry) => entry.key === key);
    return setGoingIntent(log, desired, desired
      ? "Adding this show to your calendar"
      : "Removing this show from your calendar");
  };
  const attendeesFor = (key) => users.filter((u) => (going[u.id] || []).some((g) => g.key === key));

  // --- Venue reviews + photos ---
  const venueReviewsFor = (venueName) => venueReviews[norm(venueName)] || [];
  // Slice 7: hydrate a venue's reviews from the server. This is an
  // authoritative snapshot, including an empty array after moderation; merging
  // would preserve removed/blocked photos forever in the local cache.
  const loadVenueReviews = (venueName) => {
    const venueKey = norm(venueName);
    const enc = encodeURIComponent(venueKey);
    const accountId = sessionRef.current?.id || null;
    api(`/api/venues/${enc}/reviews`)
      .then(({ reviews }) => {
        if (!Array.isArray(reviews) || (sessionRef.current?.id || null) !== accountId) return;
        const blocked = new Set(blockedIdsRef.current);
        const snapshot = reviews
          .filter((r) => !blocked.has(r.userId))
          .map((r) => ({
            id: r.id,
            userId: r.userId,
            name: r.name,
            initials: r.initials,
            rating: r.rating,
            text: r.text,
            photos: r.photos || [],
            ts: ago(r.createdAt),
          }));
        setVenueReviews((m) => replaceVenueReviewSnapshot(m, venueKey, snapshot));
      })
      .catch(() => {});
  };
  const addVenueReview = (venueName, { rating, text, photos }) => {
    if (!session) return Promise.resolve({ ok: false });
    const localId = "vr_" + Date.now();
    const r = { id: localId, userId: session.id, name: session.name, initials: session.initials, rating: clampRating(rating), text: clean(text, { max: LIMITS.review, newlines: true }), photos: (photos || []).slice(0, 8), ts: "now" };
    setVenueReviews((m) => ({ ...m, [norm(venueName)]: [r, ...(m[norm(venueName)] || [])] }));
    const enc = encodeURIComponent(norm(venueName));
    return api(`/api/venues/${enc}/reviews`, { method: "POST", body: { rating: r.rating, text: r.text, photos: r.photos }, context: "Posting your venue review" })
      .then(({ id }) => {
        if (id) setVenueReviews((m) => ({ ...m, [norm(venueName)]: (m[norm(venueName)] || []).map((x) => (x.id === localId ? { ...x, id } : x)) }));
        return { ok: true, id: id || localId };
      })
      .catch((error) => {
        setVenueReviews((m) => ({ ...m, [norm(venueName)]: (m[norm(venueName)] || []).filter((x) => x.id !== localId) }));
        return { ok: false, error };
      });
  };
  const venueRating = (venueName) => { const rs = venueReviewsFor(venueName); return rs.length ? rs.reduce((s, r) => s + r.rating, 0) / rs.length : 0; };
  const venueTopPhotos = (venueName, n = 20) => venueReviewsFor(venueName)
    .flatMap((r) => r.photos.map((p) => ({ uri: p, by: r.name, venueReviewId: r.id, ownerId: r.userId })))
    .slice(0, n);
  // All photos for a venue's widget, self-healing like the artist gallery:
  //   1. official Commons building photo(s)  2. fan-uploaded review photos
  //   3. the Openverse backfill pool (licensed, attributed)
  // Moderated URLs drop out at every layer, so a pulled photo is replaced rather
  // than leaving the venue on the blank gradient card.
  // Relaxed catalog lookup: exact key first, then a punctuation/"the"-insensitive
  // match so "Fillmore Detroit" still finds "The Fillmore Detroit" instead of
  // rendering a blank hero.
  const venueCatalogKey = (venueName) => {
    const k = norm(venueName);
    if (catalogVenues[k]) return k;
    const loose = (s) => s.replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
    const lk = loose(k);
    if (!lk) return null;
    for (const key of Object.keys(catalogVenues)) {
      if (loose(key) === lk) return key;
    }
    return null;
  };
  const venuePhotoState = (venueName) => {
    const key = venueCatalogKey(venueName);
    return venuePhotoStateFor(key, venuePhotoPools);
  };

  const commitVenuePhotoEntry = (key, entry) => {
    const next = withBoundedVenuePhotoCache(venuePhotoCacheRef.current, key, entry);
    venuePhotoCacheRef.current = next;
    setVenuePhotoPools(Object.fromEntries(next));
  };

  // Concurrent VenueScreen/ShowScreen opens share one request. Results live in a
  // small session LRU; the browser/CDN also observes the endpoint's HTTP cache.
  const loadVenuePhotos = (venueName, { force = false } = {}) => {
    const key = venueCatalogKey(venueName);
    if (!key) return Promise.resolve([]);
    const cached = venuePhotoCacheRef.current.get(key);
    if (!force && isFreshVenuePhotoEntry(cached)) {
      commitVenuePhotoEntry(key, cached); // touch its LRU position
      return Promise.resolve(cached.photos);
    }
    const active = venuePhotoInflightRef.current.get(key);
    if (active) return active.promise;

    const controller = new AbortController();
    commitVenuePhotoEntry(key, { status: "loading", photos: cached?.photos || [], error: null, loadedAt: cached?.loadedAt || 0 });
    const promise = api(`/api/venues/${encodeURIComponent(key)}/photos`, {
      signal: controller.signal,
      silent: true,
      context: "Loading venue photos",
    })
      .then(({ photos }) => {
        const cleanPhotos = cleanVenuePhotoResponse(photos);
        commitVenuePhotoEntry(key, { status: "ready", photos: cleanPhotos, error: null, loadedAt: Date.now() });
        return cleanPhotos;
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          commitVenuePhotoEntry(key, { status: "error", photos: cached?.photos || [], error, loadedAt: cached?.loadedAt || 0 });
        }
        throw error;
      })
      .finally(() => {
        if (venuePhotoInflightRef.current.get(key)?.promise === promise) venuePhotoInflightRef.current.delete(key);
      });
    venuePhotoInflightRef.current.set(key, { controller, promise });
    return promise;
  };

  const venuePhotos = (venueName) => {
    const remote = venuePhotoState(venueName).photos;
    const fan = venueTopPhotos(venueName, 12).map((p) => ({ ...p, source: "fan" }));
    return mergeVenuePhotoSources(remote, fan, isPhotoRemoved);
  };

  // --- Direct messages + inbox ---
  const dmKey = (a, b) => [a, b].sort().join("__");
  const loadInboxThreads = ({ signal } = {}) => {
    const read = chatReadsRef.current.claim("dm-inbox", sessionRef.current);
    if (!read) return Promise.resolve([]);
    const accountId = read.scope;
    return api("/api/me/threads?summary=1", { signal, silent: true, context: "Refreshing your inbox" })
      .then(({ threads, removedIds = [] }) => {
        if (signal?.aborted || !chatReadsRef.current.isCurrent(read, sessionRef.current) || !Array.isArray(threads)) return [];
        absorbUsers(threads.map((thread) => thread.otherUser).filter(Boolean));
        setDms((all) => {
          const next = { ...reconcileRemovedDirectMessages(all, accountId, removedIds) };
          for (const thread of threads) {
            const key = dmKey(accountId, thread.otherId);
            const incoming = (thread.messages || []).map((message) => ({
              id: message.id,
              from: message.from,
              text: message.text,
              at: message.createdAt,
              ts: ago(message.createdAt),
              server: true,
            }));
            next[key] = mergeChatMessages(next[key] || [], incoming, removedIds, 750);
          }
          return next;
        });
        return threads;
      })
      .catch((error) => {
        if (signal?.aborted) throw error;
        return [];
      });
  };
  const threadMessages = (otherId) => {
    if (!session) return [];
    const key = dmKey(session.id, otherId);
    return mergeChatMessages(
      dms[key] || [],
      chatOutboxFor(chatOutbox, { ownerId: session.id, kind: "dm", channelKey: key }),
      [],
      750,
    );
  };
  // Slice 4: pull a thread's messages from the server and merge them (dedupe by
  // id, keeping any optimistic local-only message not yet echoed back).
  const loadThread = (otherId, { after, signal } = {}) => {
    const read = otherId ? chatReadsRef.current.claim(`dm-thread:${otherId}`, sessionRef.current) : null;
    if (!read) return Promise.resolve({ syncCursor: after || null, hasMore: false });
    const key = dmKey(read.scope, otherId);
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return api(`/api/dms/${encodeURIComponent(otherId)}${query}`, {
      signal,
      silent: true,
      context: "Refreshing direct messages",
    })
      .then(({ messages, removedIds = [], syncCursor, hasMore }) => {
        if (signal?.aborted || !chatReadsRef.current.isCurrent(read, sessionRef.current)) {
          return { syncCursor: after || null, hasMore: false, stale: true };
        }
        if (!Array.isArray(messages)) return { syncCursor: after || null, hasMore: false };
        setDms((d) => {
          const incoming = messages.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.createdAt, ts: ago(m.createdAt), server: true }));
          const live = mergeChatMessages(d[key] || [], incoming, removedIds, 750);
          const next = { ...d };
          if (live.length) next[key] = live;
          else delete next[key];
          return next;
        });
        return { syncCursor: syncCursor || after || null, hasMore: !!hasMore };
      })
      .catch((error) => {
        if (signal?.aborted) throw error;
        return { syncCursor: after || null, hasMore: false };
      });
  };
  const sendDM = (otherId, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    const actor = sessionRef.current;
    if (!actor || !otherId || !t || blockedIdsRef.current.includes(otherId)) {
      return Promise.resolve({ ok: false, retryable: false });
    }
    const key = dmKey(actor.id, otherId);
    const clientMutationId = nextChatMutationId("dm");
    const localId = chatOutboxMessageId(clientMutationId);
    return queueChatMessage({
      id: localId,
      ownerId: actor.id,
      authEpoch: chatAuthEpochRef.current,
      kind: "dm",
      channelKey: key,
      target: otherId,
      endpoint: `/api/dms/${encodeURIComponent(otherId)}`,
      context: "Sending your direct message",
      clientMutationId,
      status: "queued",
      from: actor.id,
      text: t,
      at: Date.now(),
      ts: "now",
      pending: true,
      failed: false,
    });
  };
  const markThreadRead = (otherId) => {
    if (!session) return;
    const key = dmKey(session.id, otherId);
    setDmRead((r) => ({ ...r, [key]: dms[key]?.length || 0 }));
  };
  const inboxThreads = () => {
    if (!session) return [];
    const pendingDmChannels = chatOutbox
      .filter((item) => item.ownerId === session.id && item.kind === "dm")
      .map((item) => item.channelKey);
    return [...new Set([...Object.keys(dms), ...pendingDmChannels])]
      .filter((k) => k.split("__").includes(session.id))
      .filter((k) => !k.split("__").some((id) => blockedIds.includes(id)))
      .filter((k) => (dms[k]?.length || chatOutboxFor(chatOutbox, { ownerId: session.id, kind: "dm", channelKey: k }).length))
      .map((k) => {
        const msgs = mergeChatMessages(
          dms[k] || [],
          chatOutboxFor(chatOutbox, { ownerId: session.id, kind: "dm", channelKey: k }),
          [],
          750,
        );
        const otherId = k.split("__").find((id) => id !== session.id);
        const last = msgs[msgs.length - 1];
        const unread = msgs.filter((m, i) => m.from !== session.id && i >= (dmRead[k] || 0)).length;
        // A thread is a "request" until you accept it: someone you don't follow
        // messaged you and you haven't replied yet. Following them or sending a
        // single reply promotes it to the main inbox (Instagram-style gating).
        const iReplied = msgs.some((m) => m.from === session.id);
        const bucket = (isFollowing(otherId) || iReplied) ? "main" : "requests";
        const lastAt = Number(last?.at || last?.createdAt) || 0;
        return { otherId, otherUser: userById(otherId), last, lastAt, unread, count: msgs.length, bucket };
      })
      .sort((a, b) => b.lastAt - a.lastAt);
  };
  const mainThreads = () => inboxThreads().filter((t) => t.bucket === "main");
  const requestThreads = () => inboxThreads().filter((t) => t.bucket === "requests");
  // The tab/feed badge counts only accepted conversations, so strangers can't
  // light it up; pending requests are surfaced separately by requestCount().
  const inboxUnread = () => mainThreads().reduce((s, t) => s + t.unread, 0);
  const requestCount = () => requestThreads().length;

  const artistSummary = (name) => {
    const key = norm(name);
    const liveLogs = feed.filter((l) => !removedIds.includes(l.id) && norm(l.artist) === key);
    const venues = new Set(liveLogs.map((l) => norm(l.venue)));
    // community aggregate nights for venues not already covered by a real log
    const aggregateNights = ratedShows
      .filter((r) => norm(r.artist) === key && !venues.has(norm(r.venue)))
      .map((r) => ({
        id: r.id,
        user: { name: "Community", handle: "pit", initials: "PT" },
        artist: r.artist,
        genre: r.genre,
        venue: r.venue,
        city: r.city,
        date: "aggregate",
        media: 0,
        overall: r.rating,
        band: r.band,
        room: r.room,
        review: "",
        setlist: r.setlist || [],
        likes: r.reviews,
        comments: 0,
        inTourWindow: false,
      }));
    const nights = [...liveLogs, ...aggregateNights];
    const avg = (sel) => (nights.length ? nights.reduce((s, n) => s + sel(n), 0) / nights.length : 0);
    const upcoming = tourDates
      .filter((t) => isUpcomingEventDate(t)
        && norm(t.artist) === key
        && (t.releaseAt <= Date.now() || isStaff(session?.role) || t.createdBy === session?.id))
      .map((t) => ({ ...t, scheduled: t.releaseAt > Date.now() }));
    const totalRatings = nights.reduce((s, n) => s + (n.likes || 0), 0);
    const cat = catalogArtists[key];
    const prof = artistProfiles[key] || {};
    return {
      name,
      genre: nights.find((n) => n.genre)?.genre || cat?.genre || "-",
      photo: prof.avatarUri || cat?.photo || null,
      profileAvatarUri: prof.avatarUri || null,
      photoCredit: prof.avatarUri ? null : cat?.photoCredit || null,
      banner: prof.banner || null,
      ownerBio: prof.bio || null,
      ownerId: prof.ownerId || null,
      profileKey: key,
      feedEnabled: !!prof.feedEnabled,
      nights,
      upcoming,
      avgOverall: avg((n) => n.overall),
      avgBand: avg((n) => n.band),
      avgRoom: avg((n) => n.room),
      totalRatings,
    };
  };

  // Public sees released dates; the creating team + admins also see scheduled.
  const visibleTourDates = ({ staff, viewerId }) => {
    const at = Date.now();
    return tourDates
      .filter((t) => isUpcomingEventDate(t, at) && (t.releaseAt <= at || staff || t.createdBy === viewerId))
      .map((t) => ({ ...t, scheduled: t.releaseAt > Date.now() }));
  };

  // Venue page - the room's reputation across every show held there. Sound,
  // views, and crowd live with the building, not the touring band.
  const venueSummary = (name) => {
    const key = norm(name);
    const liveLogs = feed.filter((l) => !removedIds.includes(l.id) && norm(l.venue) === key);
    const covered = new Set(liveLogs.map((l) => norm(l.artist)));
    const aggregateNights = ratedShows
      .filter((r) => norm(r.venue) === key && !covered.has(norm(r.artist)))
      .map((r) => ({
        id: r.id,
        user: { name: "Community", handle: "pit", initials: "PT" },
        artist: r.artist,
        genre: r.genre,
        venue: r.venue,
        city: r.city,
        date: "aggregate",
        media: 0,
        overall: r.rating,
        band: r.band,
        room: r.room,
        review: "",
        setlist: r.setlist || [],
        likes: r.reviews,
        comments: 0,
        inTourWindow: false,
      }));
    const nights = [...liveLogs, ...aggregateNights];
    const avg = (sel) => (nights.length ? nights.reduce((s, n) => s + sel(n), 0) / nights.length : 0);
    const upcoming = tourDates
      .filter((t) => isUpcomingEventDate(t)
        && norm(t.venue) === key
        && (t.releaseAt <= Date.now() || isStaff(session?.role) || t.createdBy === session?.id))
      .map((t) => ({ ...t, scheduled: t.releaseAt > Date.now() }));
    const cat = catalogVenues[key];
    const place = (cat && cat.place) || nights.find((n) => n.city)?.city || upcoming.find((u) => u.place)?.place || "";
    const catalogPhoto = venueCatalogPhotoFields(cat);
    return {
      name: (cat && cat.name) || name,
      place,
      photo: catalogPhoto.photo,
      photoCredit: catalogPhoto.photoCredit,
      capacity: (cat && cat.capacity) || null,
      nights,
      upcoming,
      avgRoom: avg((n) => n.room),
      avgOverall: avg((n) => n.overall),
      avgBand: avg((n) => n.band),
      totalShows: nights.length,
    };
  };

  // --- Location & recommendation layer ---------------------------------------
  const home = session?.home && session.home.lat != null ? session.home : null;

  const artistGenre = (name) => {
    const k = norm(name);
    return ratedShows.find((r) => norm(r.artist) === k)?.genre || feed.find((l) => norm(l.artist) === k)?.genre || null;
  };

  const venueCoord = (name) => {
    const k = norm(name);
    const cat = catalogVenues[k];
    if (cat && cat.lat != null) return { lat: cat.lat, lng: cat.lng };
    const rs = ratedShows.find((r) => norm(r.venue) === k);
    return rs ? { lat: rs.lat, lng: rs.lng } : null;
  };

  const allVenues = () => {
    const map = {};
    const add = (name, place) => {
      const k = norm(name);
      if (!k || map[k]) return;
      map[k] = { name: catalogVenues[k]?.name || name, place: catalogVenues[k]?.place || place || "", coord: venueCoord(name) };
    };
    Object.values(catalogVenues).forEach((v) => add(v.name, v.place));
    ratedShows.forEach((r) => add(r.venue, r.city));
    tourDates.forEach((t) => add(t.venue, t.place));
    return Object.values(map);
  };

  const locationCenter = (place) => locationCenterFromVenues(place, allVenues());

  // # of public upcoming dates at a venue (released only).
  const venueUpcomingCount = (name) =>
    tourDates.filter((t) => isUpcomingEventDate(t)
      && norm(t.venue) === norm(name)
      && t.releaseAt <= Date.now()).length;

  // --- Sidebar data (desktop rails) ------------------------------------------
  // Every artist we know of, from the scraped catalog + rated shows + tour dates.
  const allArtists = () => {
    const map = {};
    const add = (name, genre) => {
      const k = norm(name);
      if (!k || map[k]) return;
      map[k] = { name, genre: genre || null };
    };
    Object.values(catalogArtists).forEach((a) => add(a.name, a.genre));
    ratedShows.forEach((r) => add(r.artist, r.genre));
    tourDates.forEach((t) => add(t.artist, t.genre));
    return Object.values(map);
  };

  // Artists ranked by live reputation (Bayesian-ish: avg pulled toward the mean
  // by low review counts) so a single 5-star night can't top a proven act.
  const topArtists = (n = 8) => {
    const agg = {};
    ratedShows.forEach((r) => {
      const k = norm(r.artist);
      (agg[k] ||= { name: r.artist, genre: r.genre, sum: 0, reviews: 0, nights: 0 });
      agg[k].sum += (r.rating || 0) * (r.reviews || 1);
      agg[k].reviews += r.reviews || 1;
      agg[k].nights += 1;
    });
    const rows = Object.values(agg).map((a) => ({ name: a.name, genre: a.genre, nights: a.nights, reviews: a.reviews, avg: a.reviews ? a.sum / a.reviews : 0 }));
    const C = 40; // prior weight
    const M = rows.length ? rows.reduce((s, a) => s + a.avg, 0) / rows.length : 4;
    const ranked = rows
      .map((a) => ({ ...a, score: (a.avg * a.reviews + M * C) / (a.reviews + C) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
    if (ranked.length) return ranked;
    return Object.values(catalogArtists || {})
      .filter((artist) => artist?.name)
      .sort((a, b) => (b.popularity ?? -1) - (a.popularity ?? -1) || (b.followers || 0) - (a.followers || 0) || a.name.localeCompare(b.name))
      .slice(0, n)
      .map((artist) => ({ name: artist.name, genre: artist.genre || null, avg: 0, popularity: artist.popularity ?? null }));
  };

  const artistsAlphabetical = (n = 12) =>
    allArtists().sort((a, b) => a.name.localeCompare(b.name)).slice(0, n);

  // --- Verification & badges -------------------------------------------------
  // An artist is "verified" when a claimed account was admin-approved for that
  // name (Twitter-style: only claimed + approved get the check).
  const isVerifiedArtist = (name) => {
    const k = norm(name);
    return !!k && users.some((u) => isArtist(u.role) && norm(u.artistName) === k);
  };
  const artistRank = (name) => artistRankOf(name);
  const isTop100 = (name) => { const r = artistRankOf(name); return !!r && r <= 100; };
  // Badge types to show after an ARTIST name (profile page / rows).
  const artistBadges = (name) => {
    const b = [];
    if (isVerifiedArtist(name)) b.push("verified");
    if (isTop100(name)) b.push("top100");
    return b;
  };
  // Badge types to show after a USER name (their role, plus Top-100 if their
  // claimed artist charts).
  const userBadges = (u) => {
    if (!u) return [];
    const b = new Set();
    const rb = roleBadge(u.role);
    if (rb) b.add(rb);
    if (u.verified) b.add("verified"); // admin-granted check, any account
    if (u.sponsor) b.add("sponsor");   // admin-granted partner/sponsor mark
    if (u.artistName && isTop100(u.artistName)) b.add("top100");
    return [...b];
  };

  // --- Gamification: activity → stats → points + achievement badges -----------
  // Stats are derived from what we already store (a user's logs/follows/clubs), so
  // there's no separate ledger to keep in sync. Best-effort for other users (only
  // their cached posts count); complete for the signed-in user.
  const activityStats = (u) => {
    if (!u) return { shows: 0, reviews: 0, likes: 0, photos: 0, cities: 0, artists: 0, follows: 0, fanClubs: 0 };
    if (rewardProfiles[u.id]?.stats) return rewardProfiles[u.id].stats;
    const logs = logsByUser(u.id);
    // Legacy concert logs predate `kind`, so a missing value remains a review.
    // Plain status posts can earn social likes, but never concert achievements.
    const concertLogs = logs.filter((log) => (log.kind || "review") === "review");
    return {
      shows: concertLogs.length,
      reviews: concertLogs.filter((l) => (l.review || "").trim().length > 0).length,
      likes: logs.reduce((s, l) => s + (l.likes || 0), 0),
      photos: concertLogs.reduce((s, l) => s + (l.photos?.length || 0), 0),
      cities: new Set(concertLogs.map((l) => l.city).filter(Boolean)).size,
      artists: new Set(concertLogs.map((l) => norm(l.artist)).filter(Boolean)).size,
      follows: followingCount(u.id),
      fanClubs: (fanClubs[u.id] || []).length,
    };
  };
  const userAchievements = (u) => rewardProfiles[u?.id]?.earnedIds || (() => { const s = activityStats(u); return ACHIEVEMENTS.filter((a) => a.test(s)).map((a) => a.id); })();
  const userPoints = (u) => rewardProfiles[u?.id]?.points ?? (() => { const s = activityStats(u); return ACHIEVEMENTS.reduce((sum, a) => sum + (a.test(s) ? a.points : 0), 0); })();
  const loadRewards = async (userId) => {
    if (!userId) return null;
    try {
      const rewards = await api(`/api/users/${userId}/rewards`, { context: "Loading badge progress", silent: true });
      setRewardProfiles((all) => ({ ...all, [userId]: rewards }));
      return rewards;
    } catch { return null; }
  };

  // --- Discover: chart ranking + region genres + top photos ------------------
  // The ranking SOURCE is abstracted so we can swap in Billboard Hot 100 or an
  // in-app score later without touching the Discover UI. Today it prefers Spotify
  // popularity, then follower count, then live fan-reputation, then A-Z, so the
  // podium always has a top 3 even before the popularity scrape has run.
  const CHART_SOURCE = "spotify-popularity"; // future: "billboard-hot-100" | "in-app-score"
  const chartTop = (n = 10) => {
    const arts = Object.values(catalogArtists || {});
    const withPop = arts.filter((a) => a.popularity != null);
    let ranked, basis;
    if (withPop.length >= 3) {
      ranked = withPop.slice().sort((x, y) => (y.popularity - x.popularity) || ((y.followers || 0) - (x.followers || 0)));
      basis = "popularity";
    } else {
      const rep = topArtists(Math.max(n, 40));
      if (rep.length >= 3) { ranked = rep; basis = "reputation"; }
      else { ranked = arts.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")); basis = "az"; }
    }
    return ranked.slice(0, n).map((a, i) => {
      const meta = artistMeta(a.name) || a;
      return { rank: i + 1, name: a.name, genre: a.genre || meta.genre || null, popularity: a.popularity ?? null, followers: a.followers ?? null, rating: a.avg ?? null, photo: meta.photo || null, basis };
    });
  };
  const chartInfo = () => {
    const withPop = Object.values(catalogArtists || {}).filter((a) => a.popularity != null).length;
    return { source: CHART_SOURCE, live: withPop >= 3, label: withPop >= 3 ? "By popularity" : "By fan reputation" };
  };

  // Genre distribution, optionally scoped to one country, the region pies.
  const catalogCountries = (min = 12) => {
    const c = {};
    Object.values(catalogArtists || {}).forEach((a) => { if (a.country) c[a.country] = (c[a.country] || 0) + 1; });
    return Object.entries(c).filter(([, v]) => v >= min).sort((a, b) => b[1] - a[1]).map(([country, count]) => ({ country, count }));
  };
  const topGenres = (country, n = 10) => {
    const g = {};
    Object.values(catalogArtists || {}).forEach((a) => {
      if (country && a.country !== country) return;
      if (a.genre) g[a.genre] = (g[a.genre] || 0) + 1;
    });
    const rows = Object.entries(g).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, [, v]) => s + v, 0) || 1;
    const out = rows.slice(0, n).map(([genre, count]) => ({ genre, count, pct: count / total }));
    const rest = rows.slice(n).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) out.push({ genre: "Other", count: rest, pct: rest / total });
    return out;
  };

  // Top artists in a genre and/or region, ranked by popularity. Powers Discover's
  // "explore by genre" so people can dig past the global top 100.
  const topArtistsBy = ({ genre, country, n = 12 } = {}) => {
    const g = genre ? norm(genre) : null;
    const c = country && country !== "Worldwide" ? country : null;
    return Object.values(catalogArtists || {})
      .filter((a) => a.popularity != null && (!g || norm(a.genre) === g) && (!c || a.country === c))
      .sort((x, y) => (y.popularity || 0) - (x.popularity || 0))
      .slice(0, n)
      .map((a) => ({ name: a.name, genre: a.genre, photo: a.photo, popularity: a.popularity }));
  };
  // Top songs in a genre/region: the lead track from the most popular artists that
  // match. Ranked by artist popularity (a stand-in for song popularity). Playable.
  const topSongsBy = ({ genre, country, n = 12 } = {}) => {
    const g = genre ? norm(genre) : null;
    const c = country && country !== "Worldwide" ? country : null;
    const arts = Object.values(catalogArtists || {})
      .filter((a) => a.popularity != null && (a.topTracks || []).length && (!g || norm(a.genre) === g) && (!c || a.country === c))
      .sort((x, y) => (y.popularity || 0) - (x.popularity || 0))
      .slice(0, n);
    return arts.map((a) => { const t = a.topTracks[0]; return { title: t.title, artist: a.name, url: t.url || null, art: a.photo, pop: a.popularity }; });
  };

  // Most-liked uploaded photos across the feed (the "top photos" wall).
  const topPhotos = (n = 12) => {
    const out = [];
    visibleFeed(false).forEach((l) => {
      (l.photos || []).forEach((uri) => uri && out.push({ uri, artist: l.artist, venue: l.venue, by: l.user?.name || "", likes: l.likes || 0, logId: l.id }));
    });
    return out.sort((a, b) => b.likes - a.likes).slice(0, n);
  };

  const discoverStats = () => ({
    members: memberCount,
    artists: Object.keys(catalogArtists || {}).length,
    venues: Object.keys(catalogVenues || {}).length,
    countries: catalogCountries(1).length,
    genres: new Set(Object.values(catalogArtists || {}).map((a) => a.genre).filter(Boolean)).size,
  });

  // Soonest released upcoming dates across the whole catalog.
  const upcomingEvents = (n = 8) =>
    tourDates
      .filter((t) => isUpcomingEventDate(t) && t.releaseAt <= Date.now())
      .map((t) => ({ ...t }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(0, n);

  // Venues with the most upcoming shows, ranked LOCAL-first: your home city, then
  // its region, then Canada/USA. With no session it defaults to the top Canada/USA
  // venues, so the rail is never empty or irrelevant.
  const trendingVenues = (n = 8) => {
    const homeCity = norm(session?.home?.city || "");
    // Region of the home city, learned from any venue placed in that city.
    const homeRegion = homeCity
      ? norm((allVenues().find((v) => norm((v.place || "").split(",")[0]) === homeCity)?.place || "").split(",")[1] || "")
      : "";
    const NA = /(canada|united states)$/i;
    const tierOf = (place) => {
      const parts = (place || "").split(",").map((s) => s.trim());
      const city = norm(parts[0] || "");
      const region = norm(parts[1] || "");
      if (homeCity && city === homeCity) return 3;          // your city
      if (homeRegion && region === homeRegion) return 2;    // your province/state
      if (NA.test(place || "")) return 1;                   // Canada / USA default
      return 0;
    };
    return allVenues()
      .map((v) => ({ ...v, upcoming: venueUpcomingCount(v.name), tier: tierOf(v.place) }))
      .filter((v) => v.upcoming > 0)
      .sort((a, b) => b.tier - a.tier || b.upcoming - a.upcoming || a.name.localeCompare(b.name))
      .slice(0, n);
  };

  // Free-text venue search across the WHOLE catalog (not just venues that happen
  // to have a logged show). This is what makes "Toronto" surface all 22 rooms.
  const searchVenues = (query, limit = 50) => {
    const q = norm(query);
    if (!q) return [];
    return allVenues()
      .filter((v) => norm(v.name).includes(q) || norm(v.place).includes(q))
      .map((v) => ({ ...v, upcoming: venueUpcomingCount(v.name) }))
      .sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name))
      .slice(0, limit);
  };

  // Every known venue grouped by city, with venue + upcoming counts. Powers the
  // "find venues by city" browser reached from the menu.
  const venuesByCity = () => {
    const groups = {};
    allVenues().forEach((v) => {
      if (!isVenuePlaceActionable(v.place)) return;
      const place = venuePlaceIdentity(v.place);
      (groups[place.id] ||= { ...place, venues: [] }).venues.push({ ...v, upcoming: venueUpcomingCount(v.name) });
    });
    return Object.values(groups)
      .map((g) => ({
        ...g,
        count: g.venues.length,
        upcoming: g.venues.reduce((s, v) => s + v.upcoming, 0),
        venues: g.venues.sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
  };

  // Venues within `maxKm` of a center (defaults to your home city), nearest first.
  const localVenues = (maxKm = 75, center = home) => {
    if (!center || center.lat == null) return [];
    return allVenues()
      .filter((v) => v.coord)
      .map((v) => ({
        ...v,
        distanceKm: haversineKm(center, v.coord),
        upcoming: tourDates.filter((t) => isUpcomingEventDate(t)
          && norm(t.venue) === norm(v.name)
          && t.releaseAt <= Date.now()).length,
      }))
      .filter((v) => v.distanceKm <= maxKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  };

  // Upcoming shows in a region (within maxKm of center), nearest first, with soldOut.
  const regionShows = (maxKm = 75, center = home) => {
    if (!center || center.lat == null) return [];
    return tourDates
      .filter((t) => isUpcomingEventDate(t) && t.releaseAt <= Date.now())
      .map((t) => ({ ...t, coord: venueCoord(t.venue), genre: artistGenre(t.artist) }))
      .filter((t) => t.coord && haversineKm(center, t.coord) <= maxKm)
      .map((t) => ({ ...t, distanceKm: haversineKm(center, t.coord) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
  };

  // Feed of people in your city.
  const localFeed = (staff) => {
    const city = home?.city;
    if (!city) return [];
    const localIds = new Set(users.filter((u) => u.home?.city === city).map((u) => u.id));
    return visibleFeed(staff).filter((l) => localIds.has(l.userId));
  };

  // Push relevant content: rank upcoming shows by the artists you PICKED at
  // signup (strongest signal), then genre affinity + proximity + who you follow.
  // Affinity genres = declared + logged + the genres of your picked artists.
  const recommendedShows = (maxKm = 120) => {
    if (!session) return [];
    const favs = new Set((session.favoriteArtists || []).map(norm));
    const genres = new Set(session.genres || []);
    (session.favoriteArtists || []).forEach((n) => { const g = catalogArtists[norm(n)]?.genre; if (g) genres.add(g); });
    logsByUser(session.id).forEach((l) => l.genre && genres.add(l.genre));
    const followed = new Set(follows[session.id] || []);
    const followedArtists = new Set(feed.filter((l) => followed.has(l.userId)).map((l) => norm(l.artist)));
    return tourDates
      .filter((t) => isUpcomingEventDate(t) && t.releaseAt <= Date.now())
      .map((t) => {
        const genre = artistGenre(t.artist);
        const coord = venueCoord(t.venue);
        const dist = home && coord ? haversineKm(home, coord) : null;
        let score = 0;
        const reasons = [];
        if (favs.has(norm(t.artist))) { score += 5; reasons.push("One of your artists"); }
        if (genre && genres.has(genre)) { score += 3; reasons.push(`Matches your ${genre}`); }
        if (dist != null && dist <= maxKm) { score += 2 - dist / 100; if (dist <= 75) reasons.push("Near you"); }
        if (followedArtists.has(norm(t.artist))) { score += 2; reasons.push("Seen by people you follow"); }
        return { ...t, genre, distanceKm: dist, score, reason: reasons[0] || "Trending live" };
      })
      .filter((t) => t.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  };

  // --- Per-image moderation (reactive, with backfill) ------------------------
  const isPhotoRemoved = (uri) => removedPhotos.includes(uri);
  const removePhoto = (uri) => setRemovedPhotos((r) => (r.includes(uri) ? r : [...r, uri]));
  const restorePhoto = (uri) => setRemovedPhotos((r) => r.filter((x) => x !== uri));

  // Top fan photos for an artist's page - only from reviewers who opted in,
  // ranked by the review's likes so the best shots rise (and unknown ones don't).
  // Fan photos for an artist. The SERVER list is the truth (every public post
  // photo for the artist, forever); the viewer's feed cache only supplements it
  // so a just-posted photo appears instantly before the next server load.
  const [artistPhotosSrv, setArtistPhotosSrv] = useState({});
  const artistPhotoCacheKey = (name, artistKey = null) => artistGalleryIdentityKey(name, artistKey);
  const loadArtistPhotos = async (name, artistKey = null) => {
    const k = artistPhotoCacheKey(name, artistKey);
    if (!k) return;
    try {
      const query = new URLSearchParams({ name: String(name || "") });
      if (artistKey) query.set("artistKey", String(artistKey));
      const { photos } = await api(`/api/artists/photos?${query.toString()}`, { silent: true });
      if (Array.isArray(photos)) setArtistPhotosSrv((m) => ({ ...m, [k]: photos.map((p) => ({ ...p, uri: p.uri, by: p.by, postId: p.postId, ownerId: p.userId, source: "fan" })) }));
    } catch {}
  };
  const artistFanPhotos = (name, artistKey = null) => {
    const k = artistPhotoCacheKey(name, artistKey);
    const local = feed
      .filter((l) => !removedIds.includes(l.id)
        && !blockedIds.includes(l.userId)
        && postMatchesArtistGallery(l, { name, artistKey })
        && l.photosPublic
        && (l.photos?.length || l.media?.length))
      .flatMap((l) => mediaDisplayItems(l).map((item) => ({ ...item, uri: item.uri, by: l.user?.name, postId: l.id, ownerId: l.userId, source: "fan" })));
    const srv = artistPhotosSrv[k] || [];
    return mergeArtistGalleryMedia(local, srv, { blockedIds, removedUris: removedPhotos });
  };

  // The self-healing 5-pick gallery. Pools, in priority order:
  //   1. fan photos from the feed (best on-site shots, by likes)
  //   2. the artist's explicitly attributed catalogue gallery
  //   3. the Openverse backfill pool (CC-licensed web photos, with attribution)
  // Moderated URLs are filtered at every layer, so pulling one photo simply
  // promotes the next available image to keep the gallery full (up to n).
  const artistGallery = (name, n = 5, artistKey = null) => {
    const meta = artistMeta(name) || {};
    const fan = artistFanPhotos(name, artistKey);
    const pool = (meta.galleryPool && meta.galleryPool.length
      ? meta.galleryPool
      : (meta.photos || []).map((uri) => ({ uri, credit: meta.photoCredit || null, source: "catalog" })))
      .map((p) => ({ ...p, uri: p.uri, by: p.credit || null, source: p.source || "catalog" }));

    const out = [];
    const seen = new Set();
    for (const p of [...fan, ...pool]) {
      if (!p.uri || seen.has(p.uri) || isPhotoRemoved(p.uri)) continue;
      seen.add(p.uri);
      out.push(p);
      if (out.length >= n) break;
    }
    return out;
  };

  const value = {
    users, adminMembers, adminMemberDirectory, session, authReady, feed, removedIds, blockedIds, requests, tourDates, reports, moderationConsole, follows, discoverySidebar, discoverySidebarStatus,
    userById, userByHandle, logsByUser, sharedShows,
    login, signup, logout, deleteAccount, forgotPassword, resetPassword, confirmEmailVerification, resendEmailVerification, updateProfile, setAnalyticsEnabled, chooseTheme,
    addLog, editLog, reportContent, actionReport, dismissReport, removeContent, restoreContent,
    requestArtist, approveArtist, rejectArtist,
    addTourDatesBatch,
    isFollowing, follow, unfollow, followerCount, followingCount, absorbUsers, searchPeople, loadMembers, memberCount,
    recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches,
    loadUser, followersOf, followingOf,
    isBlocked, blockUser, unblockUser, blockedUsers, exportMyData,
    searchArtistsApi, resolveArtist, remoteArtistMeta, artistDiscography, resolveYouTube, invalidateYouTube, youtubeLookupWasTransient, resolveDeezerPreview,
    discoverChart, discoverGenres, discoverCountries, loadDiscoverOverview, loadDiscoverGenre, serverTime,
    artistSeenCount, reportTrack, adminSetTrackVideo, trackOverridesList, removeTrackOverride, loadModerationQueue, loadModerationConsole, loadMoreModerationConsole, moderateReport,
    mediaReactions, loadMediaReactions, toggleMediaReaction,
    playHistory, playHistoryStatus, playHistoryNextCursor, loadPlayHistory, recordPlay,
    privateListeningActive: isPrivateListeningActive(currentPrivateListeningUntil), privateListeningUntil: currentPrivateListeningUntil, setPrivateListening,
    snapshots, saveSnapshot, removeSnapshot, friendsListening, loadFriendsListening, loadFriendsListeningStrict, userPlaylists,
    favoriteGenre, genreOfArtist, recommendTracks, autoplayQueue, searchSongsApi, myPlaylists, myPlaylistsStatus, loadMyPlaylists, loadPlaylist, createPlaylist, addToPlaylist, updatePlaylist, deletePlaylist,
    drafts: draftsForAccount(drafts, session?.id), saveDraft, deleteDraft,
    visibleFeed, followingFeed, loadMoreFeed, feedHasMore, feedLoadingMore, loadClips, notInterested, undoNotInterested, visibleTourDates, artistSummary, venueSummary,
    localVenues, regionShows, localFeed, recommendedShows, venueCoord, locationCenter,
    searchVenues, venuesByCity, venueUpcomingCount,
    allArtists, topArtists, artistsAlphabetical, upcomingEvents, trendingVenues,
    isVerifiedArtist, isTop100, artistRank, artistBadges, userBadges,
    activityStats, userAchievements, userPoints, loadRewards,
    chartTop, chartInfo, catalogCountries, topGenres, topPhotos, discoverStats, topArtistsBy, topSongsBy,
    commentsFor, addComment, deleteOwnComment, deleteOwnPost, loadComments, likeInfo, toggleLike,
    concertKey, loungeFor, enterLounge, addLoungeMessage, loadLounge,
    albumRating, songRating, rateAlbum, rateSong, loadRating,
    fanClubFor, loadFanClub, loadFanClubsDirectory, fanClubDirectoryStatus, addFanClubMessage, isFanClubMember, joinFanClub, fanClubCount, fanClubsDirectory,
    isArtistOwner, artistProfile, loadArtistPage, updateArtistProfile, artistFeedEnabled,
    artistPostsFor, addArtistPost, removeArtistPost,
    accountStatus, banUser, unbanUser, suspendUser, liftSuspension, setUserRole, setVerified, markEmailVerified, setSponsor, loadAdminMembers, loadAdminMembersStrict, loadMoreAdminMembersStrict, adminStats, adminArtistQueue, enrichArtists, purgeArtist, startCatalogSeed, catalogSeedStatus, stopCatalogSeed, catalogSeedRuns, removeLoungeMessage, removeComment, removeFanClubMessage,
    comments, fanClubMsgs, lounge,
    goingFor, isGoing, isGoingBusy, toggleGoing, attendeesFor,
    venueReviewsFor, loadVenueReviews, addVenueReview, venueRating, venueTopPhotos,
    venuePhotos, venuePhotoState, loadVenuePhotos, artistFanPhotos, loadArtistPhotos,
    artistGallery, isPhotoRemoved, removePhoto, restorePhoto,
    chatAuthEpoch, retryChatMessage, cancelChatMessage,
    threadMessages, sendDM, loadThread, loadInboxThreads, markThreadRead, inboxThreads, mainThreads, requestThreads, inboxUnread, requestCount,
    track,
    myNotifications, unreadNotifications, markNotificationsRead,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
