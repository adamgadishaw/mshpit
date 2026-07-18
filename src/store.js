import { createContext, useContext, useState, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { seedFeed, ratedShows, cityCoords, haversineKm } from "./data";
import { catalogVenues, catalogTourDates, catalogArtists } from "./seed/catalog";
import { clean, cleanEmail, isEmail, cleanName, isName, cleanHandle, isPassword, clampRating, LIMITS } from "./lib/validate";
import { load, save } from "./lib/persist";
import { api, captureAppError } from "./lib/api";
import { setTheme as applyTheme, syncThemeFromAccount } from "./theme";
import { artistMeta } from "./seed/ingested";
import { ACHIEVEMENTS } from "./lib/badges";
import { ENABLE_DEMO_DATA } from "./config/runtime.mjs";
import { isUpcomingEventDate, sanitizePersistedStoreValue, sanitizeTourDates } from "./domain/dataPolicy.mjs";
import { trackKey } from "./lib/playback";

// Legacy client facade: combines server hydration, small persisted caches, social
// state, and compatibility data behind one screen-facing shape. Server responses
// and the HttpOnly session remain authoritative; split domains incrementally.

const AV = ["#F2A65A", "#E0457B", "#5B8DEF", "#6FCF97", "#B98AE0", "#E8B65A"];
// Local plaintext accounts exist only to keep the prototype usable while running
// an explicit development build without the API. Production must never treat a
// network failure as a successful local authentication or signup.
const LOCAL_AUTH_FALLBACK = ENABLE_DEMO_DATA;
const demoSeed = (value, emptyValue) => (ENABLE_DEMO_DATA ? value : emptyValue);

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

const chatTime = (message) => Number.isFinite(message?.at) ? message.at : 0;
const mergeChatMessages = (existing, incoming, removedIds = [], max = 600) => {
  const removed = new Set(removedIds);
  const byId = new Map();
  for (const message of existing || []) {
    if (message?.id && !removed.has(message.id)) byId.set(message.id, message);
  }
  for (const message of incoming || []) {
    if (message?.id && !removed.has(message.id)) byId.set(message.id, { ...byId.get(message.id), ...message });
  }
  const ordered = [...byId.values()].sort((a, b) => chatTime(a) - chatTime(b) || String(a.id).localeCompare(String(b.id)));
  return ordered.length > max ? ordered.slice(-max) : ordered;
};
const adoptChatMessageId = (messages, localId, serverId, max) => mergeChatMessages(
  [],
  (messages || []).map((message) => message.id === localId
    ? { ...message, id: serverId, pending: false, server: true }
    : message),
  [],
  max,
);

const FEED_REFRESH_MS = 12_000;
const FEED_REFRESH_MAX_BACKOFF_MS = 120_000;
const normalizeServerPost = (post) => ({
  ...post,
  photos: Array.isArray(post?.photos) ? post.photos : [],
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
  { id: "t1", artist: "Turnstile", venue: "The Greek Theatre", place: "Los Angeles, California, United States", date: "2026 · 08 · 14", ticketUrl: "https://www.ticketmaster.com/search?q=Turnstile", releaseAt: now - DAY, createdBy: "u_artist" },
  { id: "t2", artist: "Geese", venue: "Brooklyn Steel", place: "Brooklyn, New York, United States", date: "2026 · 09 · 02", ticketUrl: "https://www.ticketmaster.com/search?q=Geese", releaseAt: now - DAY, createdBy: "u_admin" },
  { id: "t3", artist: "Japanese Breakfast", venue: "The Fillmore", place: "San Francisco, California, United States", date: "2026 · 10 · 11", ticketUrl: "https://www.ticketmaster.com/search?q=Japanese%20Breakfast", releaseAt: now - DAY, createdBy: "u_admin" },
  // a scheduled (not-yet-public) date the Turnstile team can see but fans can't:
  { id: "t4", artist: "Turnstile", venue: "Madison Square Garden", place: "New York City, New York, United States", date: "2026 · 12 · 31", ticketUrl: "https://www.ticketmaster.com/search?q=Turnstile", releaseAt: now + 7 * DAY, createdBy: "u_artist" },
  ...catalogTourDates,
];
const seedTourDates = demoSeed(demoTourDates, []);

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
export const TERMS_VERSION = "2026-07";

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
  const [playHistory, setPlayHistory] = useState(() => load("pit.playhistory", [])); // every song played, newest first
  const [snapshots, setSnapshots] = useState(() => load("pit.snapshots", [])); // saved listening sessions (playlist seeds)
  const [drafts, setDrafts] = useState(() => load("pit.drafts", [])); // unfinished reviews, saved locally
  useEffect(() => { save("pit.playhistory", playHistory); }, [playHistory]);
  useEffect(() => { save("pit.snapshots", snapshots); }, [snapshots]);
  useEffect(() => { save("pit.drafts", drafts); }, [drafts]);
  // Review drafts: save an unfinished log to resume later.
  const saveDraft = (d) => {
    const id = d.id || "draft_" + Date.now();
    const entry = { ...d, id, at: Date.now() };
    setDrafts((all) => [entry, ...all.filter((x) => x.id !== id)].slice(0, 30));
    return id;
  };
  const deleteDraft = (id) => setDrafts((all) => all.filter((x) => x.id !== id));
  const [adminStats, setAdminStats] = useState({ total: 0, banned: 0, verified: 0, regions: [] }); // admin member console stats
  const [session, setSession] = useState(() =>
    sanitizePersistedStoreValue("pit.session", load("pit.session", null), ENABLE_DEMO_DATA));
  const [feed, setFeed] = useState(() =>
    sanitizePersistedStoreValue("pit.feed", load("pit.feed", demoSeed(seedFeed, [])), ENABLE_DEMO_DATA));
  // Polling and mutations can finish out of order. A revision invalidates a
  // response that started before a local create/edit/like, while the request
  // state prevents overlapping refreshes from racing each other.
  const feedMutationRevisionRef = useRef(0);
  const feedRefreshRef = useRef({ inFlight: false, sequence: 0 });
  const [removedIds, setRemovedIds] = useState([]);
  // Per-image moderation: individual photo URLs pulled from galleries. Reactive,
  // like the rest of moderation, but removing one photo backfills the gallery
  // from the next available source instead of leaving a hole.
  const [removedPhotos, setRemovedPhotos] = useState([]);
  const [requests, setRequests] = usePersisted("pit.requests", seedRequests);
  const [tourDates, setTourDates] = usePersisted("pit.tourDates", seedTourDates);
  const [reports, setReports] = useState([]);
  const [follows, setFollows] = useState(() =>
    sanitizePersistedStoreValue("pit.follows", load("pit.follows", demoSeed({ u_demo: ["u_mara", "u_devon"] }, {})), ENABLE_DEMO_DATA));
  const [blockedIds, setBlockedIds] = useState(() =>
    sanitizePersistedStoreValue("pit.blocked", load("pit.blocked", []), ENABLE_DEMO_DATA));
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
  const [lounge, setLounge] = usePersisted("pit.lounge", demoSeed({
    "turnstile|the fillmore|2026 · 06 · 21": [
      { id: "m1", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "anyone else lose a shoe in the pit lol", ts: "2h" },
      { id: "m2", userId: "u_priya", name: "Priya N.", initials: "PN", text: "the HEALING singalong gave me chills", ts: "2h" },
    ],
  }, {}));
  // Planned attendance ("Going") - per user, list of concert refs
  const [going, setGoing] = usePersisted("pit.going", demoSeed({
    u_mara: [{ key: "geese|the independent|2026 · 08 · 26", artist: "Geese", venue: "The Independent", city: "San Francisco", date: "2026 · 08 · 26" }],
  }, {}));
  // Artist fan clubs: permanent chat per artist + membership
  const [fanClubMsgs, setFanClubMsgs] = usePersisted("pit.fanClubMsgs", demoSeed({
    turnstile: [
      { id: "fc1", userId: "u_mara", name: "Mara Quinn", initials: "MQ", text: "GLOW ON changed my life, no notes", ts: "3h" },
      { id: "fc2", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "who's getting the MSG tickets??", ts: "1h" },
    ],
  }, {}));
  const [fanClubs, setFanClubs] = usePersisted("pit.fanClubs", demoSeed({ u_demo: ["Turnstile"], u_mara: ["Turnstile", "Militarie Gun"] }, {}));
  // Server-truth member counts per fan club (slice 5), keyed by fcKey. Preferred
  // over the local-graph count when present so totals reflect everyone, not just
  // the users this browser happens to know about.
  const [fanClubMeta, setFanClubMeta] = useState({});
  // Artist-owned profile overrides (banner/avatar/bio/feedEnabled) + updates feed
  const [artistProfiles, setArtistProfiles] = usePersisted("pit.artistProfiles", demoSeed({
    turnstile: { feedEnabled: true },
  }, {}));
  const [artistPosts, setArtistPosts] = usePersisted("pit.artistPosts", demoSeed({
    turnstile: [{ id: "ap1", text: "New tour dates just dropped. MSG we're coming for you.", ts: "2d" }],
  }, {}));
  // Venue reviews (rating + text + photos), keyed by venue name
  const [venueReviews, setVenueReviews] = usePersisted("pit.venueReviews", {});
  // Direct messages - keyed by the sorted pair of user ids; plus read markers.
  const [dms, setDms] = usePersisted("pit.dms", demoSeed({
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
  const [dmRead, setDmRead] = usePersisted("pit.dmRead", {});
  // Notifications / activity, the social heartbeat. Each item is addressed to a
  // recipient (userId) and generated when someone acts on their content/graph.
  const [notifications, setNotifications] = usePersisted("pit.notifications", demoSeed([
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

  // Persist identity + continuity state so a refresh doesn't wipe your session,
  // account, posts, or follows.
  useEffect(() => save("pit.session", session), [session]);
  useEffect(() => save("pit.users", users), [users]);
  useEffect(() => save("pit.feed", feed), [feed]);
  useEffect(() => save("pit.follows", follows), [follows]);

  // Theme reconciliation. A DEVICE choice (localStorage `pit_theme`, written when
  // you pick a theme) always wins over the account, so hydrating /api/me can never
  // yank the theme you just set out from under you and reload-loop back to it (the
  // old "can't switch off Forest" bug). If the account is stale, we heal it up to
  // the server instead of reloading. Only a device with NO local choice (a fresh
  // login) adopts the account's theme.
  useEffect(() => {
    if (!session?.theme) return;
    let localTheme = null;
    try { localTheme = typeof window !== "undefined" && window.localStorage ? window.localStorage.getItem("pit_theme") : null; } catch {}
    if (localTheme) {
      if (session.theme !== localTheme) api("/api/me", { method: "PATCH", body: { theme: localTheme } }).catch(() => {});
    } else {
      syncThemeFromAccount(session.theme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.theme]);
  // Keep the current user's playlists loaded (for the "add to playlist" picker + profile).
  useEffect(() => { loadMyPlaylists(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [session?.id]);

  // --- SQLite migration slices 2 & 3: public feed + likes/comments -----------
  // Pull server posts (with current counts and viewer-like state) and upsert them
  // into the local cache. Existing IDs must be replaced, not skipped, otherwise
  // edits and cross-device likes/comments remain stale forever.
  const mergeServerFeed = (posts, { prepend = true, preserveOrder = false } = {}) => {
    if (!Array.isArray(posts) || !posts.length) return;
    const incoming = posts.map(normalizeServerPost);
    setFeed((current) => {
      const currentById = new Map(current.map((post) => [post.id, post]));
      const normalized = incoming.map((post) => {
        const previous = currentById.get(post.id);
        return sameServerPost(previous, post) ? previous : post;
      });
      const serverIds = new Set(normalized.map((post) => post.id));
      const remaining = current.filter((post) => !serverIds.has(post.id));
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
      const { posts, nextCursor } = await api("/api/feed?limit=50", {
        context: "Refreshing the concert feed",
        silent: true,
        signal,
      });
      // A create/edit/like that happened after this read began is newer than the
      // response. Ignore the response and let the next poll reconcile it.
      if (signal?.aborted || sequence !== refresh.sequence || mutationRevision !== feedMutationRevisionRef.current) return null;
      mergeServerFeed(posts, { prepend: true });
      if (resetPagination) {
        setFeedNextCursor(nextCursor || null);
        setFeedHasMore(!!nextCursor);
      }
      return true;
    } catch {
      return signal?.aborted ? null : false;
    } finally {
      if (sequence === refresh.sequence) refresh.inFlight = false;
    }
  };
  const loadMoreFeed = async () => {
    if (feedLoadingMore || !feedHasMore || !feedNextCursor) return false;
    setFeedLoadingMore(true);
    try {
      const { posts, nextCursor } = await api(`/api/feed?limit=50&before=${encodeURIComponent(feedNextCursor)}`, {
        context: "Loading more concert reviews",
        silent: true,
      });
      mergeServerFeed(posts, { prepend: false });
      setFeedNextCursor(nextCursor || null);
      setFeedHasMore(!!nextCursor);
      return true;
    } catch {
      return false;
    } finally {
      setFeedLoadingMore(false);
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
      return { clips: Array.isArray(clips) ? clips.map((c) => normalizeServerPost(c)) : [], nextCursor: nextCursor || null };
    } catch { return { clips: [], nextCursor: null }; }
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
      const result = await hydrateFeed({ resetPagination: initial, signal: controller.signal });
      if (stopped) return;
      if (result === true) delay = FEED_REFRESH_MS;
      else if (result === false) delay = Math.min(delay * 2, FEED_REFRESH_MAX_BACKOFF_MS);
      schedule(delay);
    };
    const wake = () => schedule(0);
    const appStateSubscription = AppState.addEventListener("change", (state) => { if (state === "active") wake(); });
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", wake);
    run(true);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller.abort();
      feedRefreshRef.current.sequence += 1;
      feedRefreshRef.current.inFlight = false;
      appStateSubscription?.remove?.();
      if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", wake);
    };
    // This lifecycle intentionally owns one polling loop for the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live provider-backed tour dates from the DB. Production also rejects legacy
  // generated IDs so an old server/cache cannot reintroduce prototype concerts.
  useEffect(() => {
    api("/api/tourdates")
      .then(({ tourDates: live }) => {
        const accepted = sanitizeTourDates(live, ENABLE_DEMO_DATA);
        if (!accepted.length) return;
        setTourDates((cur) => {
          const have = new Set(cur.map((t) => t.id));
          const fresh = accepted.filter((t) => !have.has(t.id));
          return fresh.length ? [...fresh, ...cur] : cur;
        });
      })
      .catch(() => {});
  }, []);

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
            return [...byId.values()];
          });
        }
      })
      .catch(() => { if (active) setDiscoverySidebarStatus("error"); });
    return () => { active = false; };
  }, [session?.id, session?.home?.city, session?.home?.lat, session?.home?.lng]);

  // --- Activity tracking (data collection for personalization + ads) ---------
  // Every meaningful action queues an event; a background flush batches them to
  // the server. This is the behavioral data disclosed in the Privacy policy and
  // consented to at sign-up. Best-effort: failures are dropped, never surfaced.
  const eventQueue = useRef([]);
  const track = (name, props = {}) => {
    if (!name) return;
    eventQueue.current.push({ name, props });
    if (eventQueue.current.length >= 25) flushEvents();
  };
  const flushEvents = () => {
    if (!eventQueue.current.length) return;
    const batch = eventQueue.current.splice(0, 50);
    api("/api/events", { method: "POST", body: { events: batch } }).catch(() => {});
  };
  useEffect(() => {
    const id = setInterval(flushEvents, 8000);
    const onHide = () => flushEvents();
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", onHide);
      window.addEventListener("visibilitychange", onHide);
    }
    return () => {
      clearInterval(id);
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeunload", onHide);
        window.removeEventListener("visibilitychange", onHide);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const i = next.findIndex((x) => x.id === su.id);
        if (i === -1) next = [...next, { playlists: [], genres: [], favoriteArtists: [], ...su }];
        else next = next.map((x, j) => (j === i ? { ...x, ...su } : x)); // refresh stale profile data
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
  // Search users by name/handle on the server (cross-device friend finding).
  // Also captures the member count (`total`) so the app can show a real stat.
  const searchPeople = async (q) => {
    try {
      const { users: found, total } = await api(`/api/people?q=${encodeURIComponent(q || "")}`);
      absorbUsers(found);
      if (typeof total === "number") setMemberCount(total);
      // Belt-and-suspenders: hide anyone I've blocked immediately, even before the
      // server's own block filter (which needs my block to have persisted).
      return (found || []).filter((u) => !blockedIds.includes(u.id));
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
  const searchArtistsApi = async (query) => {
    try { const { artists } = await api(`/api/artists?q=${encodeURIComponent(query || "")}`); cacheArtists(artists); return artists || []; }
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
  const resolveYouTube = async (title, artist, duration = 0) => {
    if (!title) return null;
    const k = (artist || "") + "|" + title;
    const hit = ytCache.current[k];
    if (hit && hit.expiresAt > Date.now()) return hit.videoId;
    try {
      const query = new URLSearchParams({ title, artist: artist || "" });
      if (Number(duration) > 0) query.set("duration", String(Math.round(Number(duration))));
      const { videoId } = await api(`/api/youtube/track?${query.toString()}`);
      ytCache.current[k] = { videoId: videoId || null, expiresAt: Date.now() + (videoId ? 30 * 60 * 1000 : 5 * 60 * 1000) };
      return videoId || null;
    } catch { return null; }
  };
  const invalidateYouTube = async (title, artist, videoId) => {
    if (!title || !videoId) return { ok: false };
    delete ytCache.current[(artist || "") + "|" + title];
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

  // Flag a song whose in-app video is the wrong version; optionally carry the
  // correct YouTube link so an admin can pin it in one tap.
  // --- Per-photo reactions (full-screen media viewer) ---
  // Cached by URL so the viewer, feed thumbnails, and artist galleries all read
  // one truth. Server-authoritative; optimistic flip reconciled on response.
  const [mediaReactions, setMediaReactions] = useState({});
  const loadMediaReactions = async (urls) => {
    const wanted = (urls || []).filter((u) => typeof u === "string" && u.startsWith("http")).slice(0, 24);
    if (!wanted.length) return;
    try {
      const { reactions } = await api("/api/media/reactions", { method: "POST", silent: true, body: { urls: wanted } });
      if (reactions) setMediaReactions((m) => ({ ...m, ...reactions }));
    } catch {}
  };
  const toggleMediaReaction = async (url, postId) => {
    if (!session || !url) return { ok: false };
    setMediaReactions((m) => {
      const cur = m[url] || { count: 0, mine: false };
      return { ...m, [url]: { count: Math.max(0, cur.count + (cur.mine ? -1 : 1)), mine: !cur.mine } };
    });
    try {
      const r = await api("/api/media/react", { method: "POST", context: "Liking a photo", body: { url, postId } });
      setMediaReactions((m) => ({ ...m, [url]: { count: r.count, mine: r.liked } }));
      return { ok: true };
    } catch (error) {
      // Roll back the optimistic flip; the server said no.
      setMediaReactions((m) => {
        const cur = m[url] || { count: 0, mine: false };
        return { ...m, [url]: { count: Math.max(0, cur.count + (cur.mine ? -1 : 1)), mine: !cur.mine } };
      });
      return { ok: false, error };
    }
  };

  const reportTrack = async ({ title, artist, url, note }) => {
    try {
      const r = await api("/api/tracks/report", { method: "POST", context: "Reporting a wrong song version", body: { title, artist, url: url || undefined, note: note || undefined } });
      return { ok: true, duplicate: !!r?.duplicate };
    } catch (error) { return { ok: false, error }; }
  };

  // Admin: pin the correct video for a song (or confirm none exists).
  const adminSetTrackVideo = async ({ title, artist, url, none }) => {
    try {
      const r = await api("/api/admin/tracks/override", { method: "POST", context: "Pinning the correct song video", body: { title, artist, url: url || undefined, none: !!none } });
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
  // Re-pull the open moderation queue from the server. The login-time absorb
  // only merges NEW ids into local state; this makes the console authoritative
  // every time it opens, so reports survive refreshes and devices.
  const loadModerationQueue = async () => {
    try {
      const { reports: rows } = await api("/api/admin/reports", { silent: true });
      if (!Array.isArray(rows)) return false;
      const fresh = rows.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, reporterId: r.reporter_id, status: "open" }));
      setReports((rs) => {
        const freshIds = new Set(fresh.map((x) => x.id));
        // Server list IS the open queue; keep local non-open rows for history.
        return [...fresh, ...rs.filter((x) => x.status !== "open" && !freshIds.has(x.id))];
      });
      return true;
    } catch { return false; }
  };

  const resolveDeezerPreview = async (title, artist) => {
    if (!title) return null;
    const k = (artist || "") + "|" + title;
    const hit = previewCache.current[k];
    if (hit && hit.expiresAt > Date.now()) return hit.preview;
    try {
      const { preview, expiresAt } = await api(`/api/deezer/track?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist || "")}`);
      previewCache.current[k] = { preview: preview || null, expiresAt: preview ? Math.min(Number(expiresAt) || Date.now() + 4 * 60 * 1000, Date.now() + 4 * 60 * 1000) : Date.now() + 60 * 1000 };
      return preview || null;
    } catch { return null; }
  };
  // Listening history: log every song played (the framework for "listening now",
  // playlists, and taste snapshots). Skips consecutive repeats, caps at 200.
  const recordPlay = (t) => {
    const key = trackKey(t);
    if (!key) return;
    setPlayHistory((h) => (h[0] && trackKey(h[0]) === key ? h : [{ title: t.title, artist: t.artist, url: t.url, id: t.id, preview: t.preview || null, art: t.art || null, at: Date.now() }, ...h].slice(0, 200)));
    track("play", { artist: t.artist, title: t.title }); // analytics signal
    // Cross-device history + "friends listening" (best-effort, offline keeps local).
    if (session) api("/api/plays", { method: "POST", body: { title: t.title, artist: t.artist, url: t.url || null, art: t.art || null } }).catch(() => {});
  };
  // Cross-device listening history: every play writes through to the server, so
  // on login the SERVER list is the account's truth (a fresh device shows your
  // real history, not an empty one). Device-local history stays as the fallback
  // for logged-out listening and rows that predate the plays table.
  useEffect(() => {
    if (!session?.id) return;
    let ok = true;
    api("/api/me/plays", { silent: true })
      .then(({ plays }) => { if (ok && Array.isArray(plays) && plays.length) setPlayHistory(plays.map((p) => ({ title: p.title, artist: p.artist, url: p.url, art: p.art, at: p.at }))); })
      .catch(() => {});
    return () => { ok = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // The latest track each person you follow played (for the "friends listening" rail).
  const [friendsListening, setFriendsListening] = useState([]);
  const loadFriendsListening = async () => {
    if (!session) return [];
    try { const { listening } = await api("/api/plays/friends"); setFriendsListening(listening || []); return listening || []; } catch { return []; }
  };
  const userPlaylists = async (id) => { try { const { playlists } = await api(`/api/users/${id}/playlists`); return playlists || []; } catch { return []; } };
  const deletePlaylist = async (id) => { try { await api(`/api/playlists/${id}`, { method: "DELETE" }); } catch {} };

  // --- Listening algorithm (drives autoplay "up next") -----------------------
  // Favorite genre = the genre you play most (falls back to your picked genres).
  const genreOfArtist = (name) => catalogArtists[norm(name)]?.genre || artistMeta(name)?.genre || null;
  const favoriteGenre = () => {
    const counts = {};
    (playHistory || []).slice(0, 60).forEach((t) => { const g = genreOfArtist(t.artist); if (g) counts[g] = (counts[g] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : (session?.genres?.[0] || null);
  };
  // Recommend the next tracks to keep the player going: same genre as what you're
  // playing (or your favorite genre) first, then the rest of the catalog, ranked by
  // popularity, capped at ~2 per artist so one band never hogs the queue. Skips the
  // seed and anything you just heard. Works even when Spotify popularity is missing.
  const recommendTracks = (seed, n = 24) => {
    const keyOf = (t) => String(t?.url || t?.id || t?.preview || `${t?.artist || ""}|${t?.title || ""}`).toLowerCase();
    const seen = new Set();
    if (seed) seen.add(keyOf(seed));
    (playHistory || []).slice(0, 25).forEach((t) => seen.add(keyOf(t)));
    const seedGenre = (seed && genreOfArtist(seed.artist)) || favoriteGenre();
    const g = seedGenre ? norm(seedGenre) : null;
    const withTracks = Object.values(catalogArtists || {})
      .map((a) => ({ a, meta: artistMeta(a.name) || a }))
      .filter((x) => (x.meta.topTracks || []).length);
    const score = (x) => (x.a.popularity ?? 0);
    const inGenre = withTracks.filter((x) => g && norm(x.a.genre) === g).sort((p, q) => score(q) - score(p));
    const rest = withTracks.filter((x) => !(g && norm(x.a.genre) === g)).sort((p, q) => score(q) - score(p));
    const out = [];
    for (const x of [...inGenre, ...rest]) {
      let taken = 0;
      for (const t of x.meta.topTracks || []) {
        // Artist + title is a complete track reference. Provider URLs are optional
        // enrichments that the player resolves only when this track becomes current.
        if (!t.title) continue;
        const track = { kind: "track", title: t.title, artist: x.a.name, id: t.id || null, url: t.url || null, preview: t.preview || null, art: x.meta.photo || x.a.photo || null };
        const k = keyOf(track);
        if (seen.has(k)) continue;
        seen.add(k); out.push(track); taken++;
        if (taken >= 2 || out.length >= n) break;
      }
      if (out.length >= n) break;
    }
    return out;
  };
  // Build the queue the top player runs: whatever was explicitly queued, then a
  // recommended tail so "up next" is always populated and playback never dead-ends
  // after one song.
  const autoplayQueue = (seed, baseList) => {
    const keyOf = (t) => String(t?.url || t?.id || t?.preview || `${t?.artist || ""}|${t?.title || ""}`).toLowerCase();
    const isTrackRef = (t) => !!(t && (t.url || t.id || t.preview || (t.title && t.artist)));
    const base = ((Array.isArray(baseList) && baseList.length ? baseList : (seed ? [seed] : [])) || []).filter(isTrackRef);
    const seen = new Set(base.map(keyOf));
    const recs = recommendTracks(seed || base[0], 30).filter((t) => { const k = keyOf(t); if (seen.has(k)) return false; seen.add(k); return true; });
    return [...base, ...recs].slice(0, 60);
  };

  // --- Playlists (build one song at a time, not just whole-session snapshots) --
  const [myPlaylists, setMyPlaylists] = useState([]);
  const loadMyPlaylists = async () => {
    if (!session) { setMyPlaylists([]); return []; }
    try { const { playlists } = await api(`/api/users/${session.id}/playlists`); setMyPlaylists(playlists || []); return playlists || []; } catch { return []; }
  };
  const cleanTrack = (t) => ({ title: t.title, artist: t.artist || null, url: t.url || null, preview: t.preview || null, art: t.art || null });
  const createPlaylist = async (name, tracks) => {
    if (!session) return null;
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t && t.title).map(cleanTrack);
    if (!list.length) return null;
    try { const pl = await api("/api/playlists", { method: "POST", body: { name: name || "New playlist", tracks: list } }); await loadMyPlaylists(); return pl; } catch { return null; }
  };
  const addToPlaylist = async (id, track) => {
    if (!session || !track?.title) return false;
    try { await api(`/api/playlists/${id}`, { method: "PATCH", body: { track: cleanTrack(track) } }); await loadMyPlaylists(); return true; } catch { return false; }
  };
  // Snapshot a listening session (queue) into a saved playlist seed that shows on
  // the profile and can be resumed.
  const saveSnapshot = (tracks, name) => {
    const list = (tracks || []).filter((t) => !!trackKey(t));
    if (!list.length) return null;
    const snap = { id: "snap_" + Date.now(), name: name || `Session ${new Date().toLocaleDateString()}`, tracks: list, at: Date.now(), by: session?.id || null };
    setSnapshots((s) => [snap, ...s].slice(0, 50));
    // Persist as a real playlist on the account (shows on the profile, shareable).
    if (session) api("/api/playlists", { method: "POST", body: { name: snap.name, tracks: list } })
      .then(({ id }) => { if (id) setSnapshots((s) => s.map((x) => (x.id === snap.id ? { ...x, serverId: id } : x))); loadMyPlaylists(); }).catch(() => {});
    return snap;
  };
  const removeSnapshot = (id) => setSnapshots((s) => s.filter((x) => x.id !== id));

  // Fold a server user into local state so profiles/avatars resolve everywhere.
  const absorbServerUser = (su) => {
    const merged = { playlists: [], genres: [], favoriteArtists: [], ...su };
    setUsers((all) => (all.some((x) => x.id === su.id) ? all.map((x) => (x.id === su.id ? { ...x, ...merged } : x)) : [...all, merged]));
    setSession(merged);
    // Hydrate the follow graph for this account from the server (see MIGRATION.md,
    // slice 1). Best-effort: if the endpoint/back-end isn't there we keep whatever
    // is cached locally.
    api("/api/me/following")
      .then(({ following }) => { if (Array.isArray(following)) setFollows((f) => ({ ...f, [su.id]: following })); })
      .catch(() => {});
    // Hydrate who this account has blocked (drives feed/DM/profile filtering).
    api("/api/me/blocked")
      .then(({ users: list }) => { if (Array.isArray(list)) { setBlockedIds(list.map((x) => x.id)); absorbUsers(list); } })
      .catch(() => {});
    // Re-hydrate the feed now that we're authenticated, so `liked` reflects THIS
    // account (a guest hydrate always reports liked:false).
    hydrateFeed();
    // Slice 4: hydrate my DM threads (+ absorb the people I've messaged so their
    // names/avatars resolve in the inbox). Bucket/unread stay computed client-side.
    api("/api/me/threads")
      .then(({ threads }) => {
        if (!Array.isArray(threads) || !threads.length) return;
        setUsers((all) => {
          let next = all;
          threads.forEach((t) => {
            if (t.otherUser && !next.some((x) => x.id === t.otherUser.id)) next = [...next, { playlists: [], genres: [], favoriteArtists: [], ...t.otherUser }];
          });
          return next;
        });
        setDms((d) => {
          const n = { ...d };
          threads.forEach((t) => { n[dmKey(su.id, t.otherId)] = t.messages.map((m) => ({ id: m.id, from: m.from, text: m.text, ts: ago(m.createdAt) })); });
          return n;
        });
      })
      .catch(() => {});
    // Slice 5: hydrate the fan clubs I've joined (drives the join button + counts).
    api("/api/me/fanclubs")
      .then(({ artists }) => { if (Array.isArray(artists)) setFanClubs((f) => ({ ...f, [su.id]: artists })); })
      .catch(() => {});
    // Slice 7: hydrate my "going" list so planned attendance survives a new device.
    api("/api/me/going")
      .then(({ going: rows }) => { if (Array.isArray(rows)) setGoing((G) => ({ ...G, [su.id]: rows })); })
      .catch(() => {});
    // Server-backed notifications: replace MY notifications with the authoritative
    // server list (keep local welcome/system ones), so activity is real cross-device.
    api("/api/me/notifications")
      .then(({ notifications: rows }) => {
        if (!Array.isArray(rows)) return;
        const mine = rows.map((r) => ({ ...r, userId: su.id }));
        setNotifications((all) => [...mine, ...all.filter((n) => n.userId !== su.id || n.type === "welcome")]);
      })
      .catch(() => {});
    // Slice 6: admins hydrate the open report queue (server rows → client shape).
    if (isMod(su.role)) {
      api("/api/admin/reports")
        .then(({ reports: rows }) => {
          if (!Array.isArray(rows) || !rows.length) return;
          setReports((rs) => {
            const have = new Set(rs.map((x) => x.id));
            const fresh = rows
              .filter((r) => !have.has(r.id))
              .map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, reporterId: r.reporter_id, status: "open" }));
            return fresh.length ? [...fresh, ...rs] : rs;
          });
        })
        .catch(() => {});
      // Slice 7: admins hydrate pending artist-account requests.
      if (su.role === "admin") api("/api/admin/artist-requests")
        .then(({ requests: rows }) => {
          if (!Array.isArray(rows) || !rows.length) return;
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
    api("/api/me")
      .then(({ user }) => { if (user) absorbServerUser(user); else setSession(null); })
      .catch((e) => { if (e?.status === 401) setSession(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-first auth (real accounts, hashed passwords, httpOnly sessions).
  // Falls back to the local in-memory demo accounts only in an explicit dev build.
  // A production network failure must never authenticate a bundled plaintext user.
  const login = async (email, password) => {
    try {
      const { user } = await api("/api/login", { method: "POST", body: { email, password }, context: "Signing in", silent: true });
      absorbServerUser(user);
      track("login");
      return { ok: true };
    } catch (e) {
      if (e.status) return { ok: false, error: e.message }; // real server verdict
    }
    if (!LOCAL_AUTH_FALLBACK) return { ok: false, error: "Couldn't connect. Check your connection and try again." };
    // offline/dev fallback
    const em = cleanEmail(email);
    const pw = typeof password === "string" ? password.slice(0, 100) : "";
    const u = users.find((x) => x.email.toLowerCase() === em);
    if (!u || !u.password || u.password !== pw) return { ok: false, error: "Wrong email or password." };
    if (u.isBanned) return { ok: false, error: "This account is banned." };
    setSession(u);
    return { ok: true };
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
      const { user } = await api("/api/reset", { method: "POST", body: { token, password }, context: "Resetting your password", silent: true });
      absorbServerUser(user);
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

  const signup = async ({ name, email, password, city, agreedToTerms }) => {
    const nm = cleanName(name);
    const em = cleanEmail(email);
    if (!isName(nm)) return { ok: false, error: "Enter a name (letters or numbers, up to 40 chars)." };
    if (!isEmail(em)) return { ok: false, error: "Enter a valid email address." };
    if (!isPassword(password)) return { ok: false, error: "Password needs 8+ characters with letters and numbers." };
    if (!city) return { ok: false, error: "Pick your city - it powers your local feed." };
    if (!agreedToTerms) return { ok: false, error: "Please agree to the Terms & Conditions and Privacy policy." };
    // Record consent to the current Terms/Privacy at the moment of sign-up.
    const consent = { consentAt: Date.now(), termsVersion: TERMS_VERSION };
    const srvCoords = cityCoords[city] || null;
    try {
      const { user } = await api("/api/signup", {
        method: "POST",
        body: { name: nm, email: em, password, city, lat: srvCoords?.lat, lng: srvCoords?.lng },
        context: "Creating your Pit account",
        silent: true,
      });
      absorbServerUser(user);
      // Persist the consent record on the account (client + best-effort server).
      setSession((s) => (s ? { ...s, ...consent } : s));
      setUsers((all) => all.map((x) => (x.id === user.id ? { ...x, ...consent } : x)));
      api("/api/me", { method: "PATCH", body: { extras: consent } }).catch(() => {});
      track("signup", { city });
      pushWelcome(user.id);
      return { ok: true };
    } catch (e) {
      if (e.status) return { ok: false, error: e.message };
    }
    if (!LOCAL_AUTH_FALLBACK) return { ok: false, error: "Couldn't connect. Check your connection and try again." };
    // offline/dev fallback
    if (users.some((x) => x.email.toLowerCase() === em)) return { ok: false, error: "That email is already registered." };
    const coords = cityCoords[city] || null;
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
      home: { city, lat: coords?.lat ?? null, lng: coords?.lng ?? null },
      ...consent,
    };
    setUsers((all) => [...all, u]);
    setSession(u);
    pushWelcome(u.id);
    return { ok: true };
  };

  const logout = () => {
    api("/api/logout", { method: "POST" }).catch(() => {}); // best-effort server-side
    setSession(null);
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
        const check = await api("/api/me", { context: "Confirming account deletion", silent: true });
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
    setDrafts([]);
    setMyPlaylists([]);
    setFriendsListening([]);
    setRatingAgg({});
    setFanClubMeta({});
    setFeedNextCursor(null);
    setFeedHasMore(true);

    // Artist-owned client caches do not retain author IDs on every legacy row;
    // remove the deleted artist's own page cache while preserving unrelated
    // public artist pages. The server deletes all attributable rows precisely.
    if (deleted.artistName) {
      const artistKey = norm(deleted.artistName);
      setArtistProfiles((all) => { const next = { ...all }; delete next[artistKey]; return next; });
      setArtistPosts((all) => { const next = { ...all }; delete next[artistKey]; return next; });
    }

    save("pit.session", null);
    setSession(null);
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
      setUsers((all) => all.map((u) => (u.id === session.id ? { ...u, ...extra, theme: next } : u)));
      setSession(updated);
      save("pit.session", updated); // synchronous, the reload below would race the effect
      try { await api("/api/me", { method: "PATCH", body: { theme: next, ...extra } }); } catch {}
    }
    applyTheme(next);
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
    setUsers((all) => all.map((u) => (u.id === session.id ? { ...u, ...safe } : u)));
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
    const extraKeys = ["theme", "consentAt", "termsVersion", "nowPlaying", "treble", "bass", "playlists"];
    if (["nowPlaying", "treble", "bass", "playlists"].some((key) => key in safe)) {
      const merged = { ...previousSession, ...safe };
      body.extras = Object.fromEntries(extraKeys.filter((key) => merged[key] !== undefined).map((key) => [key, merged[key]]));
    }
    if (!Object.keys(body).length) return Promise.resolve({ ok: true, patch: safe });

    return api("/api/me", { method: "PATCH", body, context: "Saving your profile" })
      .then(({ user }) => {
        if (user) {
          setUsers((all) => all.map((u) => (u.id === user.id ? { ...u, ...user } : u)));
          setSession((s) => ({ ...s, ...user }));
        }
        return { ok: true, user, patch: safe };
      })
      .catch((error) => {
        // Server rejected something (e.g. handle taken / cooldown / role tag).
        // Restore the last server-backed snapshot instead of leaving a false save.
        setUsers((all) => all.map((u) => (u.id === previousSession.id ? previousSession : u)));
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
      venue: clean(log.venue, { max: 80 }),
      review: clean(log.review, { max: LIMITS.review, newlines: true }),
      overall: clampRating(log.overall),
      band: log.band == null ? log.band : clampRating(log.band),
      room: log.room == null ? log.room : clampRating(log.room),
      userId: session?.id,
    };
    feedMutationRevisionRef.current += 1;
    setFeed((f) => [safe, ...f]);
    track("post", kind === "status" ? { kind: "status" } : { artist: safe.artist, venue: safe.venue });
    // Slice 2 write-through: persist the post server-side, then adopt the server
    // id so likes/comments on it key correctly. Best-effort (offline keeps local).
    if (session) {
      const body = kind === "status"
        ? { kind: "status", review: safe.review, song: safe.song || null, photos: safe.photos || [], photosPublic: safe.photosPublic === false ? 0 : 1 }
        : {
            artist: safe.artist, venue: safe.venue, city: safe.city, date: safe.date,
            overall: safe.overall, band: safe.band, room: safe.room, dims: safe.dims, review: safe.review,
            photos: safe.photos, photosPublic: safe.photosPublic ? 1 : 0, setlist: safe.setlist, tour: safe.tour || null,
            tags: Array.isArray(safe.tags) ? safe.tags : [], song: safe.song || null,
          };
      return api("/api/posts", {
        method: "POST",
        context: kind === "status" ? "Posting your update" : "Posting your concert review",
        body,
      })
        .then(({ id, post }) => {
          feedMutationRevisionRef.current += 1;
          if (post) {
            const published = { ...normalizeServerPost(post), dims: post.dims || safe.dims };
            setFeed((f) => f.map((l) => (l.id === localId ? published : l)));
          } else if (id && id !== localId) {
            setFeed((f) => f.map((l) => (l.id === localId ? { ...l, id } : l)));
          }
          return { ok: true, id: id || localId };
        })
        .catch((error) => {
          feedMutationRevisionRef.current += 1;
          // A failed write must not remain looking published on this device.
          setFeed((f) => f.filter((l) => l.id !== localId));
          return { ok: false, error };
        });
    }
    return Promise.resolve({ ok: true, localOnly: true });
  };

  const editLog = async (id, changes) => {
    if (!session || !id) return { ok: false };
    // Author-only, admins included: moderation removes content, never rewrites it.
    const previous = feed.find((post) => post.id === id) || changes;
    if (!previous || previous.userId !== session.id) return { ok: false };

    // A status post has no artist/venue/rating, so it only sends the fields it
    // actually owns; sending empty artist/venue would trip the review validators.
    if ((previous.kind || changes.kind) === "status") {
      const version = previous.version ?? previous.editedAt ?? previous.createdAt;
      const body = {
        review: clean(changes.review, { max: LIMITS.review, newlines: true }),
        song: changes.song?.videoId ? changes.song : null,
        photos: Array.isArray(changes.photos) ? changes.photos.filter((item) => typeof item === "string").slice(0, 8) : [],
        photosPublic: changes.photosPublic !== false,
        ...(Number.isSafeInteger(version) ? { version } : {}),
      };
      if (!body.review && !body.photos.length && !body.song) return { ok: false };
      feedMutationRevisionRef.current += 1;
      try {
        const { post } = await api(`/api/posts/${encodeURIComponent(id)}`, { method: "PATCH", context: "Saving your update", body });
        feedMutationRevisionRef.current += 1;
        const updated = normalizeServerPost(post);
        setFeed((all) => all.map((item) => (item.id === id ? updated : item)));
        return { ok: true, post: updated };
      } catch (error) {
        feedMutationRevisionRef.current += 1;
        return { ok: false, error };
      }
    }

    const safe = {
      artist: clean(changes.artist, { max: 80 }),
      venue: clean(changes.venue, { max: 80 }),
      city: clean(changes.city, { max: 60 }),
      date: clean(changes.date, { max: 20 }),
      overall: clampRating(changes.overall),
      band: changes.band == null ? null : clampRating(changes.band),
      room: changes.room == null ? null : clampRating(changes.room),
      dims: changes.dims && typeof changes.dims === "object" ? changes.dims : {},
      review: clean(changes.review, { max: LIMITS.review, newlines: true }),
      photos: Array.isArray(changes.photos) ? changes.photos.filter((item) => typeof item === "string").slice(0, 8) : [],
      photosPublic: !!changes.photosPublic,
      setlist: Array.isArray(changes.setlist) ? changes.setlist.filter((item) => typeof item === "string").slice(0, 40) : [],
      tour: clean(changes.tour, { max: 80 }) || null,
      tags: Array.isArray(changes.tags) ? changes.tags.filter((item) => typeof item === "string").slice(0, 5) : [],
      song: changes.song?.videoId ? changes.song : null,
    };
    if (!safe.artist || !safe.venue || safe.overall <= 0) return { ok: false };
    const version = previous.version ?? previous.editedAt ?? previous.createdAt;
    feedMutationRevisionRef.current += 1;
    try {
      const { post } = await api(`/api/posts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        context: "Saving your concert review",
        body: { ...safe, ...(Number.isSafeInteger(version) ? { version } : {}) },
      });
      feedMutationRevisionRef.current += 1;
      const updated = normalizeServerPost(post);
      setFeed((all) => all.map((item) => (item.id === id ? updated : item)));
      return { ok: true, post: updated };
    } catch (error) {
      feedMutationRevisionRef.current += 1;
      return { ok: false, error };
    }
  };

  // Per-report moderation: content is public on post; reports drive action.
  // Slice 6: reports write through to the server so an admin on any device sees
  // them; admins hydrate the open queue on login (see absorbServerUser). Reports
  // are always on a post here. Best-effort/offline-safe.
  const reportContent = (targetId, reason, targetType = "post") => {
    const r = clean(reason, { max: LIMITS.note });
    setReports((rs) => [{ id: "rep_" + Date.now(), targetId, reason: r, reporterId: session?.id, status: "open" }, ...rs]);
    if (session) api("/api/reports", { method: "POST", body: { targetType, targetId, reason: r } }).catch(() => {});
    return { ok: true };
  };
  const actionReport = (repId) => {
    const r = reports.find((x) => x.id === repId);
    return api(`/api/admin/reports/${repId}/action`, { method: "POST", context: "Removing reported content" })
      .then(() => {
        if (r?.targetType === "post" || !r?.targetType) setRemovedIds((ids) => (ids.includes(r.targetId) ? ids : [...ids, r.targetId]));
        setReports((rs) => rs.map((x) => (x.id === repId ? { ...x, status: "actioned" } : x)));
        return true;
      })
      .catch(() => false);
  };
  const dismissReport = (repId) => {
    return api(`/api/admin/reports/${repId}/dismiss`, { method: "POST", context: "Dismissing this report" })
      .then(() => { setReports((rs) => rs.map((x) => (x.id === repId ? { ...x, status: "dismissed" } : x))); return true; })
      .catch(() => false);
  };
  const moderateContent = (type, id, removed) => api(`/api/admin/content/${type}/${id}`, {
    method: "POST",
    body: { removed },
    context: removed ? "Removing community content" : "Restoring community content",
  });
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
  const addTourDatesBatch = (list, releaseAt) => {
    const batch = list.map((d, i) => ({
      id: "t_" + Date.now() + "_" + i,
      ...d,
      ticketUrl: `https://www.ticketmaster.com/search?q=${encodeURIComponent(d.artist)}`,
      releaseAt,
      createdBy: session?.id,
    }));
    setTourDates((t) => [...batch, ...t]);
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
      .then(() => { track("follow", { target: id }); notify(id, "follow"); })
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
    setBlockedIds((b) => [...new Set([...b, id])]);
    // Sever locally the way the server does.
    setFollows((f) => ({ ...f, [session.id]: (f[session.id] || []).filter((x) => x !== id), [id]: (f[id] || []).filter((x) => x !== session.id) }));
    api(`/api/users/${id}/block`, { method: "POST", body: { blocked: true }, context: "Blocking this account" })
      .then(() => {
        setFeed((rows) => rows.filter((post) => post.userId !== id));
        setComments((groups) => Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter((row) => row.userId !== id)])));
        setFanClubMsgs((groups) => Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter((row) => row.userId !== id)])));
        setLounge((groups) => Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.filter((row) => row.userId !== id)])));
        setDms((threads) => { const next = { ...threads }; delete next[dmKey(session.id, id)]; return next; });
        setNotifications((rows) => rows.filter((notification) => notification.actorId !== id));
      })
      .catch(() => {
        setBlockedIds((b) => b.filter((x) => x !== id));
        setFollows((f) => ({ ...f, [session.id]: mineBefore, [id]: theirsBefore }));
      });
    track("block", { target: id });
  };
  const unblockUser = (id) => {
    if (!session || !isBlocked(id)) return;
    setBlockedIds((b) => b.filter((x) => x !== id));
    api(`/api/users/${id}/block`, { method: "POST", body: { blocked: false }, context: "Unblocking this account" })
      .catch(() => setBlockedIds((b) => [...new Set([...b, id])]));
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
      .then(({ comments: rows }) => {
        if (!Array.isArray(rows)) return;
        commentsLoadedAt.current.set(requestKey, Date.now());
        setComments((m) => {
          const existing = m[id] || [];
          const byId = new Map(existing.map((c) => [c.id, c]));
          // Merge server rows over local (adopt parentId/avatar/role), keep any
          // optimistic locals not yet on the server. Sorted oldest→newest.
          for (const c of rows) byId.set(c.id, { id: c.id, userId: c.userId, name: c.name, initials: c.initials, avatarUri: c.avatarUri, avatarColor: c.avatarColor, role: c.role, verified: c.verified, text: c.text, parentId: c.parentId || null, at: c.createdAt, likes: 0 });
          const merged = [...byId.values()].sort((a, b) => (a.at || 0) - (b.at || 0));
          const unchanged = merged.length === existing.length && merged.every((comment, index) => {
            const previous = existing[index];
            return previous?.id === comment.id && previous.text === comment.text && previous.parentId === comment.parentId && previous.at === comment.at;
          });
          return unchanged ? m : { ...m, [id]: merged };
        });
      })
      .catch(() => {})
      .finally(() => commentsInflight.current.delete(requestKey));
  };
  const addComment = (id, text, parentId = null) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!session || !t) return;
    const localId = "c_" + Date.now();
    const c = { id: localId, userId: session.id, name: session.name, initials: session.initials, avatarUri: session.avatarUri, avatarColor: session.avatarColor, role: session.role, text: t, parentId: parentId || null, at: Date.now(), likes: 0 };
    setComments((m) => ({ ...m, [id]: [...(m[id] || []), c] }));
    // Write-through + adopt the server id so a later loadComments() dedupes it
    // instead of showing my comment twice.
    api(`/api/posts/${id}/comments`, { method: "POST", body: { text: t, parentId: parentId || null }, context: "Adding your afterparty comment" })
      .then(({ id: sid }) => {
        if (sid) setComments((m) => ({ ...m, [id]: (m[id] || []).map((x) => (x.id === localId ? { ...x, id: sid } : x)) }));
        const owner = postOwner(id);
        if (owner) notify(owner, "comment", { postId: id, artist: feed.find((l) => l.id === id)?.artist, text: t.slice(0, 60) });
      })
      .catch(() => setComments((m) => ({ ...m, [id]: (m[id] || []).filter((x) => x.id !== localId) })));
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
        if (liked) { track("like", { post: id }); const o = postOwner(id); if (o) notify(o, "like", { postId: id, artist: feed.find((l) => l.id === id)?.artist }); }
      })
      .catch(() => {
        feedMutationRevisionRef.current += 1;
        setMyLikes((m) => ({ ...m, [id]: previous }));
      });
  };

  const visibleFeed = (staff) =>
    (staff ? feed : feed.filter((l) => !removedIds.includes(l.id)))
      .filter((l) => !l.userId || !blockedIds.includes(l.userId));

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
  // list, and attendees all key off the same thing.
  const concertKey = (log) => `${norm(log.artist)}|${norm(log.venue)}|${log.date || ""}`.toLowerCase();

  // --- Concert Lounge (gated attendee chat, now server-backed + live) ---
  const loungeFor = (key) => lounge[key] || [];
  // Pull a lounge's messages from the server and merge by id (dedup-safe, so this
  // can be polled while the screen is open to get live chat like the fan clubs).
  const loadLounge = (key, { after, signal } = {}) => {
    if (!key) return Promise.resolve({ syncCursor: after || null, hasMore: false });
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return api(`/api/lounges/${encodeURIComponent(key)}/messages${query}`, {
      signal,
      silent: true,
      context: "Refreshing the concert lounge",
    })
      .then(({ messages, syncCursor, hasMore, removedIds }) => {
        if (!Array.isArray(messages)) return;
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
    if (!session) return { ok: true, guest: true };
    const key = concertKey(log);
    const mine = going[session.id] || [];
    const wasGoing = mine.some((entry) => entry.key === key);
    const entry = { key, artist: log.artist, venue: log.venue, city: log.city, date: log.date };
    if (!wasGoing) setGoing((all) => ({ ...all, [session.id]: [...(all[session.id] || []).filter((item) => item.key !== key), entry] }));
    try {
      const result = await api("/api/going", {
        method: "POST",
        body: { ...entry, going: true },
        context: "Entering the concert lounge",
      });
      if (result?.going !== true) throw new Error("Lounge entry was not confirmed");
      return { ok: true, key };
    } catch {
      if (!wasGoing) setGoing((all) => ({ ...all, [session.id]: (all[session.id] || []).filter((item) => item.key !== key) }));
      return { ok: false };
    }
  };
  const addLoungeMessage = (key, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!session || !t) return;
    const localId = "m_" + Date.now();
    const m = { id: localId, userId: session.id, name: session.name, initials: session.initials, avatarUri: session.avatarUri, avatarColor: session.avatarColor, role: session.role, text: t, at: Date.now(), ts: "now", pending: true };
    setLounge((L) => ({ ...L, [key]: mergeChatMessages(L[key] || [], [m], [], 600) }));
    return api(`/api/lounges/${encodeURIComponent(key)}/messages`, { method: "POST", body: { text: t }, context: "Sending your afterparty message" })
      .then(({ id }) => { if (id) setLounge((L) => ({ ...L, [key]: adoptChatMessageId(L[key], localId, id, 600) })); return { ok: true, id }; })
      .catch(() => {
        setLounge((L) => ({ ...L, [key]: (L[key] || []).filter((x) => x.id !== localId) }));
        return { ok: false };
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
  const loadRating = (kind, artist, title) => {
    api(`/api/ratings?kind=${kind}&ref=${encodeURIComponent(rKey(artist, title))}`)
      .then((r) => setRatingAgg((m) => ({ ...m, [aggKey(kind, artist, title)]: { avg: r.avg, count: r.count, mine: r.mine } })))
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
    setMap((m) => ({ ...m, [key]: { ...(m[key] || {}), [session.id]: nn } }));
    setRatingAgg((m) => { const cur = m[aggregateKey]; return cur ? { ...m, [aggregateKey]: { ...cur, mine: nn } } : m; });
    api("/api/ratings", { method: "POST", body: { kind, ref: key, rating: nn }, context: `Rating this ${kind}` })
      .then((r) => setRatingAgg((m) => ({ ...m, [aggKey(kind, artist, title)]: { avg: r.avg, count: r.count, mine: r.mine } })))
      .catch(() => {
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
  const fanClubFor = (artist) => fanClubMsgs[fcKey(artist)] || [];
  // Slice 5: pull a club's messages + real member count from the server, merging
  // messages by id. No-op offline; bundled seed clubs keep their seed chatter.
  const loadFanClub = (artist, { after, signal } = {}) => {
    const enc = encodeURIComponent(norm(artist));
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return api(`/api/fanclubs/${enc}/messages${query}`, {
      signal,
      silent: true,
      context: "Refreshing the fan-club chat",
    })
      .then(({ members, messages, syncCursor, hasMore, removedIds }) => {
        if (typeof members === "number") setFanClubMeta((meta) => ({ ...meta, [fcKey(artist)]: { members } }));
        if (Array.isArray(messages)) setFanClubMsgs((L) => {
          const key = fcKey(artist);
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
    if (!session || !t) return;
    const localId = "fc_" + Date.now();
    const m = { id: localId, userId: session.id, name: session.name, initials: session.initials, text: t, at: Date.now(), ts: "now", pending: true };
    setFanClubMsgs((L) => ({ ...L, [fcKey(artist)]: mergeChatMessages(L[fcKey(artist)] || [], [m], [], 600) }));
    const enc = encodeURIComponent(norm(artist));
    return api(`/api/fanclubs/${enc}/messages`, { method: "POST", body: { text: t }, context: "Sending your fan-club message" })
      .then(({ id }) => { if (id) setFanClubMsgs((L) => ({ ...L, [fcKey(artist)]: adoptChatMessageId(L[fcKey(artist)], localId, id, 600) })); return { ok: true, id }; })
      .catch(() => {
        setFanClubMsgs((L) => ({ ...L, [fcKey(artist)]: (L[fcKey(artist)] || []).filter((x) => x.id !== localId) }));
        return { ok: false };
      });
  };
  const isFanClubMember = (artist) => (fanClubs[session?.id] || []).some((a) => norm(a) === norm(artist));
  const joinFanClub = (artist) => {
    if (!session) return Promise.resolve({ ok: false, joined: false });
    const has = isFanClubMember(artist);
    const enc = encodeURIComponent(norm(artist));
    const joined = !has;
    return api(`/api/fanclubs/${enc}/join`, { method: "POST", body: { joined }, context: joined ? "Joining this fan club" : "Leaving this fan club" })
      .then((result) => {
        const confirmed = typeof result?.joined === "boolean" ? result.joined : joined;
        setFanClubs((f) => {
          const mine = f[session.id] || [];
          return { ...f, [session.id]: confirmed
            ? [...mine.filter((a) => norm(a) !== norm(artist)), artist]
            : mine.filter((a) => norm(a) !== norm(artist)) };
        });
        if (confirmed !== has) setFanClubMeta((meta) => {
          const cur = meta[fcKey(artist)];
          return cur ? { ...meta, [fcKey(artist)]: { members: Math.max(0, cur.members + (confirmed ? 1 : -1)) } } : meta;
        });
        if (confirmed && !has) track("join_fanclub", { artist });
        return { ok: true, joined: confirmed };
      })
      .catch(() => ({ ok: false, joined: has }));
  };
  const fanClubCount = (artist) =>
    fanClubMeta[fcKey(artist)]?.members ?? Object.values(fanClubs).filter((arr) => arr.some((a) => norm(a) === norm(artist))).length;

  // Directory of fan clubs, most members first, powers the Fan clubs screen and
  // the Community search pane so clubs are findable, not buried on artist pages.
  const fanClubsDirectory = () => {
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
        if (profile) setArtistProfiles((m) => ({ ...m, [norm(name)]: { ...(m[norm(name)] || {}), ...profile } }));
        if (Array.isArray(posts) && posts.length) {
          setArtistPosts((m) => {
            const existing = m[norm(name)] || [];
            const have = new Set(existing.map((p) => p.id));
            const fresh = posts.filter((p) => !have.has(p.id)).map((p) => ({ id: p.id, text: p.text, ts: ago(p.createdAt) }));
            return fresh.length ? { ...m, [norm(name)]: [...fresh, ...existing] } : m;
          });
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
    const p = { id: localId, text: t, ts: "now" };
    setArtistPosts((m) => ({ ...m, [norm(name)]: [p, ...(m[norm(name)] || [])] }));
    const enc = encodeURIComponent(norm(name));
    api(`/api/artists/${enc}/posts`, { method: "POST", body: { text: t } })
      .then(({ id }) => { if (id) setArtistPosts((m) => ({ ...m, [norm(name)]: (m[norm(name)] || []).map((x) => (x.id === localId ? { ...x, id } : x)) })); })
      .catch(() => {});
  };
  const removeArtistPost = (name, id) => {
    if (!isArtistOwner(name)) return;
    setArtistPosts((m) => ({ ...m, [norm(name)]: (m[norm(name)] || []).filter((p) => p.id !== id) }));
    const enc = encodeURIComponent(norm(name));
    api(`/api/artists/${enc}/posts/${id}`, { method: "DELETE" }).catch(() => {});
  };

  // --- Ban / suspend (admin) ---
  const accountStatus = (u) => {
    if (!u) return "ok";
    if (u.isBanned) return "banned";
    if (u.suspendedUntil && u.suspendedUntil > Date.now()) return "suspended";
    return "ok";
  };
  const banUser = (id) => api(`/api/admin/users/${id}/ban`, { method: "POST", context: "Banning this account" })
    .then(() => { setUsers((all) => all.map((u) => (u.id === id ? { ...u, isBanned: true } : u))); return true; }).catch(() => false);
  const unbanUser = (id) => api(`/api/admin/users/${id}/unban`, { method: "POST", context: "Unbanning this account" })
    .then(() => { setUsers((all) => all.map((u) => (u.id === id ? { ...u, isBanned: false, suspendedUntil: null } : u))); return true; }).catch(() => false);
  const suspendUser = (id, days = 7) => api(`/api/admin/users/${id}/suspend`, { method: "POST", body: { days }, context: "Timing out this account" })
    .then(({ suspendedUntil }) => { setUsers((all) => all.map((u) => (u.id === id ? { ...u, suspendedUntil } : u))); return true; }).catch(() => false);
  const liftSuspension = (id) => api(`/api/admin/users/${id}/unsuspend`, { method: "POST", context: "Lifting this timeout" })
    .then(() => { setUsers((all) => all.map((u) => (u.id === id ? { ...u, suspendedUntil: null } : u))); return true; }).catch(() => false);
  // Full member directory for the admin console (all signups, incl. banned) + live
  // counts and a per-region breakdown. Absorbs everyone into `users` so they're
  // visible/moderatable, and stores the stats for the Members header.
  const loadAdminMembers = async () => {
    try {
      const { users: list, total, banned, verified, regions } = await api("/api/admin/members");
      if (Array.isArray(list)) setUsers((all) => {
        const byId = new Map(all.map((u) => [u.id, u]));
        list.forEach((su) => byId.set(su.id, { playlists: [], genres: [], favoriteArtists: [], ...(byId.get(su.id) || {}), ...su }));
        return [...byId.values()];
      });
      setAdminStats({ total: total || 0, banned: banned || 0, verified: verified || 0, regions: regions || [] });
      if (typeof total === "number") setMemberCount(total);
      return list || [];
    } catch { return []; }
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
    const target = users.find((u) => u.id === id);
    let handle = target?.handle;
    const tag = role === "admin" ? "admin" : role === "moderator" ? "mod" : null;
    if (target && tag && handle && !handle.includes(tag)) {
      let cand = `${handle}_${tag}`.slice(0, 20), i = 1;
      while (users.some((x) => x.id !== id && x.handle === cand)) cand = `${handle}_${tag}${i++}`.slice(0, 20);
      handle = cand;
    }
    try {
      await api(`/api/admin/users/${id}/role`, { method: "POST", body: { role, handle }, context: "Changing this account role" });
      setUsers((all) => all.map((u) => (u.id === id ? { ...u, role, handle: handle || u.handle } : u)));
      setSession((s) => (s && s.id === id ? { ...s, role, handle: handle || s.handle } : s));
      return true;
    } catch { return false; }
  };

  // Admin-granted verification (the blue check), independent of role, so any
  // account can be verified. (Groundwork for a paid tier later; not surfaced as
  // paid yet.) Admin-only.
  const setVerified = async (id, val) => {
    if (!isStaff(session?.role)) return;
    const verified = !!val;
    try {
      await api(`/api/admin/users/${id}/verified`, { method: "POST", body: { verified }, context: "Updating verification" });
      setUsers((all) => all.map((u) => (u.id === id ? { ...u, verified } : u)));
      setSession((s) => (s && s.id === id ? { ...s, verified } : s));
      return true;
    } catch { return false; }
  };
  const setSponsor = async (id, val) => {
    if (!isStaff(session?.role)) return;
    const sponsor = !!val;
    try {
      await api(`/api/admin/users/${id}/sponsor`, { method: "POST", body: { sponsor }, context: "Updating sponsorship" });
      setUsers((all) => all.map((u) => (u.id === id ? { ...u, sponsor } : u)));
      setSession((s) => (s && s.id === id ? { ...s, sponsor } : s));
      return true;
    } catch { return false; }
  };

  // --- Planned attendance ---
  const goingFor = (userId) => going[userId] || [];
  const isGoing = (key) => (going[session?.id] || []).some((g) => g.key === key);
  const toggleGoing = (log) => {
    if (!session) return;
    const key = concertKey(log);
    const wasGoing = isGoing(key);
    setGoing((G) => {
      const mine = G[session.id] || [];
      const exists = mine.some((g) => g.key === key);
      return { ...G, [session.id]: exists ? mine.filter((g) => g.key !== key) : [...mine, { key, artist: log.artist, venue: log.venue, city: log.city, date: log.date }] };
    });
    const desired = !wasGoing;
    api("/api/going", { method: "POST", body: { key, artist: log.artist, venue: log.venue, city: log.city, date: log.date, going: desired }, context: desired ? "Adding this show to your calendar" : "Removing this show from your calendar" })
      .then((result) => {
        if (typeof result?.going !== "boolean" || result.going === desired) return;
        setGoing((G) => {
          const mine = G[session.id] || [];
          return { ...G, [session.id]: result.going ? [...mine.filter((g) => g.key !== key), { key, artist: log.artist, venue: log.venue, city: log.city, date: log.date }] : mine.filter((g) => g.key !== key) };
        });
      })
      .catch(() => {
        setGoing((G) => {
          const mine = G[session.id] || [];
          return { ...G, [session.id]: wasGoing ? [...mine.filter((g) => g.key !== key), { key, artist: log.artist, venue: log.venue, city: log.city, date: log.date }] : mine.filter((g) => g.key !== key) };
        });
      });
  };
  const attendeesFor = (key) => users.filter((u) => (going[u.id] || []).some((g) => g.key === key));

  // --- Venue reviews + photos ---
  const venueReviewsFor = (venueName) => venueReviews[norm(venueName)] || [];
  // Slice 7: hydrate a venue's reviews from the server (merge by id).
  const loadVenueReviews = (venueName) => {
    const enc = encodeURIComponent(norm(venueName));
    api(`/api/venues/${enc}/reviews`)
      .then(({ reviews }) => {
        if (!Array.isArray(reviews) || !reviews.length) return;
        setVenueReviews((m) => {
          const existing = m[norm(venueName)] || [];
          const have = new Set(existing.map((r) => r.id));
          const fresh = reviews
            .filter((r) => !have.has(r.id))
            .map((r) => ({ id: r.id, userId: r.userId, name: r.name, initials: r.initials, rating: r.rating, text: r.text, photos: r.photos || [], ts: ago(r.createdAt) }));
          return fresh.length ? { ...m, [norm(venueName)]: [...fresh, ...existing] } : m;
        });
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
  const venueTopPhotos = (venueName, n = 20) => venueReviewsFor(venueName).flatMap((r) => r.photos.map((p) => ({ uri: p, by: r.name }))).slice(0, n);
  // All photos for a venue's widget, self-healing like the artist gallery:
  //   1. official Commons building photo(s)  2. fan-uploaded review photos
  //   3. the Openverse backfill pool (licensed, attributed)
  // Moderated URLs drop out at every layer, so a pulled photo is replaced rather
  // than leaving the venue on the blank gradient card.
  // Relaxed catalog lookup: exact key first, then a punctuation/"the"-insensitive
  // match so "Fillmore Detroit" still finds "The Fillmore Detroit" instead of
  // rendering a blank hero.
  const venueCatalogEntry = (venueName) => {
    const k = norm(venueName);
    if (catalogVenues[k]) return catalogVenues[k];
    const loose = (s) => s.replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
    const lk = loose(k);
    if (!lk) return {};
    for (const key of Object.keys(catalogVenues)) {
      if (loose(key) === lk) return catalogVenues[key];
    }
    return {};
  };

  const venuePhotos = (venueName) => {
    const cat = venueCatalogEntry(venueName);
    const commons = (cat.photos || []).map((uri) => ({ uri, by: cat.photoCredit || "Wikimedia Commons", source: "commons" }));
    const fan = venueTopPhotos(venueName, 12).map((p) => ({ uri: p.uri, by: p.by, source: "fan" }));
    // Backfill = everything in the pool that isn't a Commons dupe (Openverse +
    // Google). Commons is already laid down above; google is takedown-on-request.
    const backfill = (cat.galleryPool || [])
      .filter((p) => p.source !== "commons")
      .map((p) => ({ uri: p.uri, by: p.credit, source: p.source || "openverse" }));
    const out = [];
    const seen = new Set();
    for (const p of [...commons, ...fan, ...backfill]) {
      if (!p.uri || seen.has(p.uri) || isPhotoRemoved(p.uri)) continue;
      seen.add(p.uri);
      out.push(p);
    }
    return out;
  };

  // --- Direct messages + inbox ---
  const dmKey = (a, b) => [a, b].sort().join("__");
  const threadMessages = (otherId) => (session ? dms[dmKey(session.id, otherId)] || [] : []);
  // Slice 4: pull a thread's messages from the server and merge them (dedupe by
  // id, keeping any optimistic local-only message not yet echoed back).
  const loadThread = (otherId, { after, signal } = {}) => {
    if (!session || !otherId) return Promise.resolve({ syncCursor: after || null, hasMore: false });
    const key = dmKey(session.id, otherId);
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    return api(`/api/dms/${otherId}${query}`, {
      signal,
      silent: true,
      context: "Refreshing direct messages",
    })
      .then(({ messages, syncCursor, hasMore }) => {
        if (!Array.isArray(messages)) return;
        if (!messages.length) return { syncCursor: syncCursor || after || null, hasMore: !!hasMore };
        setDms((d) => {
          const incoming = messages.map((m) => ({ id: m.id, from: m.from, text: m.text, at: m.createdAt, ts: ago(m.createdAt), server: true }));
          return { ...d, [key]: mergeChatMessages(d[key] || [], incoming, [], 750) };
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
    if (!session || !t || blockedIds.includes(otherId)) return;
    const key = dmKey(session.id, otherId);
    const localId = "dm_" + Date.now();
    const m = { id: localId, from: session.id, text: t, at: Date.now(), ts: "now", pending: true };
    setDms((d) => ({ ...d, [key]: mergeChatMessages(d[key] || [], [m], [], 750) }));
    setDmRead((r) => ({ ...r, [key]: (dms[key]?.length || 0) + 1 }));
    // Write-through + adopt the server id so a later loadThread() dedupes it.
    return api(`/api/dms/${otherId}`, { method: "POST", body: { text: t }, context: "Sending your direct message" })
      .then(({ id }) => {
        if (id) setDms((d) => ({ ...d, [key]: adoptChatMessageId(d[key], localId, id, 750) }));
        notify(otherId, "dm", { text: t.slice(0, 60) });
        return { ok: true, id };
      })
      .catch(() => {
        setDms((d) => ({ ...d, [key]: (d[key] || []).filter((x) => x.id !== localId) }));
        setDmRead((r) => ({ ...r, [key]: Math.max(0, (r[key] || 1) - 1) }));
        return { ok: false };
      });
  };
  const markThreadRead = (otherId) => {
    if (!session) return;
    const key = dmKey(session.id, otherId);
    setDmRead((r) => ({ ...r, [key]: dms[key]?.length || 0 }));
  };
  const inboxThreads = () => {
    if (!session) return [];
    return Object.keys(dms)
      .filter((k) => k.split("__").includes(session.id))
      .filter((k) => !k.split("__").some((id) => blockedIds.includes(id)))
      .map((k) => {
        const msgs = dms[k];
        const otherId = k.split("__").find((id) => id !== session.id);
        const last = msgs[msgs.length - 1];
        const unread = msgs.filter((m, i) => m.from !== session.id && i >= (dmRead[k] || 0)).length;
        // A thread is a "request" until you accept it: someone you don't follow
        // messaged you and you haven't replied yet. Following them or sending a
        // single reply promotes it to the main inbox (Instagram-style gating).
        const iReplied = msgs.some((m) => m.from === session.id);
        const bucket = (isFollowing(otherId) || iReplied) ? "main" : "requests";
        return { otherId, otherUser: userById(otherId), last, unread, count: msgs.length, bucket };
      })
      .sort((a, b) => b.count - a.count);
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
      photoCredit: prof.avatarUri ? null : cat?.photoCredit || null,
      banner: prof.banner || null,
      ownerBio: prof.bio || null,
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
    return {
      name: (cat && cat.name) || name,
      place,
      photo: (cat && cat.photo) || null,
      photoCredit: (cat && cat.photoCredit) || null,
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
    return {
      shows: logs.length,
      reviews: logs.filter((l) => (l.review || "").trim().length > 0).length,
      likes: logs.reduce((s, l) => s + (l.likes || 0), 0),
      photos: logs.reduce((s, l) => s + (l.photos?.length || 0), 0),
      cities: new Set(logs.map((l) => l.city).filter(Boolean)).size,
      artists: new Set(logs.map((l) => norm(l.artist)).filter(Boolean)).size,
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
  const topGenres = (country, n = 6) => {
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
      const parts = (v.place || "").split(",").map((s) => s.trim());
      const city = parts[0] || "Unknown";
      const region = parts.slice(1).join(", ");
      (groups[city] ||= { city, region, venues: [] }).venues.push({ ...v, upcoming: venueUpcomingCount(v.name) });
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
  const loadArtistPhotos = async (name) => {
    const k = norm(name);
    if (!k) return;
    try {
      const { photos } = await api(`/api/artists/photos?name=${encodeURIComponent(name)}`, { silent: true });
      if (Array.isArray(photos)) setArtistPhotosSrv((m) => ({ ...m, [k]: photos.map((p) => ({ uri: p.uri, by: p.by, postId: p.postId, source: "fan" })) }));
    } catch {}
  };
  const artistFanPhotos = (name) => {
    const k = norm(name);
    const local = feed
      .filter((l) => !removedIds.includes(l.id) && norm(l.artist) === k && l.photosPublic && l.photos?.length)
      .flatMap((l) => l.photos.map((uri) => ({ uri, by: l.user?.name, source: "fan" })));
    const srv = artistPhotosSrv[k] || [];
    const seen = new Set();
    return [...local, ...srv].filter((p) => {
      if (!p.uri || seen.has(p.uri) || isPhotoRemoved(p.uri)) return false;
      seen.add(p.uri);
      return true;
    });
  };

  // The self-healing 5-pick gallery. Pools, in priority order:
  //   1. fan photos from the feed (best on-site shots, by likes)
  //   2. the artist's licensed photo gallery (Commons portraits/live shots)
  //   3. the Openverse backfill pool (CC-licensed web photos, with attribution)
  // Moderated URLs are filtered at every layer, so pulling one photo simply
  // promotes the next available image to keep the gallery full (up to n).
  const artistGallery = (name, n = 5) => {
    const meta = artistMeta(name) || {};
    const fan = artistFanPhotos(name);
    const pool = (meta.galleryPool && meta.galleryPool.length
      ? meta.galleryPool
      : (meta.photos || []).map((uri) => ({ uri, credit: meta.photoCredit || "Wikimedia Commons", source: "commons" })))
      .map((p) => ({ uri: p.uri, by: p.credit, source: p.source || "commons" }));

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
    users, session, feed, removedIds, requests, tourDates, reports, follows, discoverySidebar, discoverySidebarStatus,
    userById, userByHandle, logsByUser, sharedShows,
    login, signup, logout, deleteAccount, forgotPassword, resetPassword, updateProfile, chooseTheme,
    addLog, editLog, reportContent, actionReport, dismissReport, removeContent, restoreContent,
    requestArtist, approveArtist, rejectArtist,
    addTourDatesBatch,
    isFollowing, follow, unfollow, followerCount, followingCount, absorbUsers, searchPeople, loadMembers, memberCount,
    loadUser, followersOf, followingOf,
    isBlocked, blockUser, unblockUser, blockedUsers, exportMyData,
    searchArtistsApi, resolveArtist, remoteArtistMeta, artistDiscography, resolveYouTube, invalidateYouTube, resolveDeezerPreview,
    discoverChart, discoverGenres, discoverCountries, serverTime,
    artistSeenCount, reportTrack, adminSetTrackVideo, trackOverridesList, removeTrackOverride, loadModerationQueue,
    mediaReactions, loadMediaReactions, toggleMediaReaction,
    playHistory, recordPlay, snapshots, saveSnapshot, removeSnapshot, friendsListening, loadFriendsListening, userPlaylists, deletePlaylist,
    favoriteGenre, genreOfArtist, recommendTracks, autoplayQueue, myPlaylists, loadMyPlaylists, createPlaylist, addToPlaylist,
    drafts, saveDraft, deleteDraft,
    visibleFeed, followingFeed, loadMoreFeed, feedHasMore, feedLoadingMore, loadClips, visibleTourDates, artistSummary, venueSummary,
    localVenues, regionShows, localFeed, recommendedShows, venueCoord,
    searchVenues, venuesByCity, venueUpcomingCount,
    allArtists, topArtists, artistsAlphabetical, upcomingEvents, trendingVenues,
    isVerifiedArtist, isTop100, artistRank, artistBadges, userBadges,
    activityStats, userAchievements, userPoints, loadRewards,
    chartTop, chartInfo, catalogCountries, topGenres, topPhotos, discoverStats, topArtistsBy, topSongsBy,
    commentsFor, addComment, loadComments, likeInfo, toggleLike,
    concertKey, loungeFor, enterLounge, addLoungeMessage, loadLounge,
    albumRating, songRating, rateAlbum, rateSong, loadRating,
    fanClubFor, loadFanClub, addFanClubMessage, isFanClubMember, joinFanClub, fanClubCount, fanClubsDirectory,
    isArtistOwner, artistProfile, loadArtistPage, updateArtistProfile, artistFeedEnabled,
    artistPostsFor, addArtistPost, removeArtistPost,
    accountStatus, banUser, unbanUser, suspendUser, liftSuspension, setUserRole, setVerified, setSponsor, loadAdminMembers, adminStats, adminArtistQueue, enrichArtists, purgeArtist, startCatalogSeed, catalogSeedStatus, stopCatalogSeed, catalogSeedRuns, removeLoungeMessage, removeComment, removeFanClubMessage,
    comments, fanClubMsgs, lounge,
    goingFor, isGoing, toggleGoing, attendeesFor,
    venueReviewsFor, loadVenueReviews, addVenueReview, venueRating, venueTopPhotos, venuePhotos, artistFanPhotos, loadArtistPhotos,
    artistGallery, isPhotoRemoved, removePhoto, restorePhoto,
    threadMessages, sendDM, loadThread, markThreadRead, inboxThreads, mainThreads, requestThreads, inboxUnread, requestCount,
    track,
    myNotifications, unreadNotifications, markNotificationsRead,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
