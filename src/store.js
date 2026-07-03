import { createContext, useContext, useState, useEffect } from "react";
import { seedFeed, ratedShows, cityCoords, haversineKm } from "./data";
import { catalogVenues, catalogTourDates, catalogArtists } from "./seed/catalog";
import { clean, cleanEmail, isEmail, cleanName, isName, cleanHandle, isPassword, clampRating, LIMITS } from "./lib/validate";
import { load, save } from "./lib/persist";
import { api } from "./lib/api";
import { artistMeta } from "./seed/ingested";

// Prototype in-memory store: auth, profiles, social graph, content, reports,
// artist approvals, scheduled tour dates. NO backend - resets on reload. The
// real build replaces this with a server + DB + sessions, keeping this shape.

const AV = ["#F2A65A", "#E0457B", "#5B8DEF", "#6FCF97", "#B98AE0", "#E8B65A"];

const seedUsers = [
  // NOTE: the real admin account lives ONLY on the server (server/index.js
  // seedAdmin) — never ship admin credentials in the client bundle.
  { id: "u_demo", name: "Demo Fan", handle: "demo", home: { city: "San Francisco", lat: 37.7749, lng: -122.4194 }, email: "demo@example.com", password: "password123", role: "fan", initials: "DF", avatarColor: AV[2], avatarUri: null, bio: "Just here for the pit.", genres: ["Indie"], banner: null, nowPlaying: { title: "Not Strong Enough", artist: "boygenius" }, treble: { title: "Not Strong Enough", artist: "boygenius" }, bass: { title: "3D Country", artist: "Geese" }, playlists: [{ id: "pl1", name: "Front row faves", tracks: [{ title: "Be Sweet", artist: "Japanese Breakfast" }, { title: "$20", artist: "boygenius" }] }] },
  { id: "u_artist", name: "Turnstile", handle: "turnstile", home: { city: "Los Angeles", lat: 34.0522, lng: -118.2437 }, email: "band@turnstile.com", password: "password123", role: "artist", artistName: "Turnstile", initials: "TS", avatarColor: AV[1], avatarUri: null, bio: "GLOW ON. Official.", genres: ["Hardcore"], playlists: [] },
  { id: "u_mara", name: "Mara Quinn", handle: "maraq", home: { city: "San Francisco", lat: 37.7749, lng: -122.4194 }, email: "mara@example.com", password: "x", role: "fan", initials: "MQ", avatarColor: AV[1], avatarUri: null, bio: "Hardcore shows + disposable cameras.", genres: ["Hardcore", "Punk"], banner: null, nowPlaying: { title: "HEALING", artist: "Turnstile" }, treble: { title: "HEALING", artist: "Turnstile" }, bass: { title: "Do It Faster", artist: "Militarie Gun" }, playlists: [{ id: "pl2", name: "Two-step starters", tracks: [{ title: "HEALING", artist: "Turnstile" }, { title: "Do It Faster", artist: "Militarie Gun" }] }] },
  { id: "u_devon", name: "Devon Ash", handle: "dash", home: { city: "New York City", lat: 40.7128, lng: -74.006 }, email: "devon@example.com", password: "x", role: "fan", initials: "DA", avatarColor: AV[3], avatarUri: null, bio: "Indie sad boy. Will cry at the barricade.", genres: ["Indie", "Shoegaze"], playlists: [{ id: "pl3", name: "Cry at the barricade", tracks: [{ title: "Paprika", artist: "Japanese Breakfast" }, { title: "Pristine", artist: "Snail Mail" }] }] },
  { id: "u_priya", name: "Priya N.", handle: "priyalive", home: { city: "Denver", lat: 39.7392, lng: -104.9903 }, email: "priya@example.com", password: "x", role: "fan", initials: "PN", avatarColor: AV[4], avatarUri: null, bio: "Jam bands & amphitheaters.", genres: ["Psych Rock"], playlists: [] },
];

const now = Date.now();
const DAY = 86400000;
const seedTourDates = [
  { id: "t1", artist: "Turnstile", venue: "The Greek Theatre", place: "Los Angeles, California, United States", date: "2026 · 08 · 14", ticketUrl: "https://www.ticketmaster.com/search?q=Turnstile", releaseAt: now - DAY, createdBy: "u_artist" },
  { id: "t2", artist: "Geese", venue: "Brooklyn Steel", place: "Brooklyn, New York, United States", date: "2026 · 09 · 02", ticketUrl: "https://www.ticketmaster.com/search?q=Geese", releaseAt: now - DAY, createdBy: "u_admin" },
  { id: "t3", artist: "Japanese Breakfast", venue: "The Fillmore", place: "San Francisco, California, United States", date: "2026 · 10 · 11", ticketUrl: "https://www.ticketmaster.com/search?q=Japanese%20Breakfast", releaseAt: now - DAY, createdBy: "u_admin" },
  // a scheduled (not-yet-public) date the Turnstile team can see but fans can't:
  { id: "t4", artist: "Turnstile", venue: "Madison Square Garden", place: "New York City, New York, United States", date: "2026 · 12 · 31", ticketUrl: "https://www.ticketmaster.com/search?q=Turnstile", releaseAt: now + 7 * DAY, createdBy: "u_artist" },
  ...catalogTourDates,
];

const seedRequests = [{ id: "r1", userId: "u_demo", artistName: "Demo Band", note: "I front Demo Band, want to post our tour dates.", status: "pending" }];

export const isStaff = (role) => role === "admin";
export const isArtist = (role) => role === "artist" || role === "admin";

const StoreContext = createContext(null);
export const useStore = () => useContext(StoreContext);

export function StoreProvider({ children }) {
  // Hydrate the identity-critical state from storage so a refresh / new page keeps
  // you logged in and keeps your data. (See src/lib/persist.js.)
  const [users, setUsers] = useState(() => load("pit.users", seedUsers));
  const [session, setSession] = useState(() => load("pit.session", null));
  const [feed, setFeed] = useState(() => load("pit.feed", seedFeed));
  const [removedIds, setRemovedIds] = useState([]);
  // Per-image moderation: individual photo URLs pulled from galleries. Reactive,
  // like the rest of moderation — but removing one photo backfills the gallery
  // from the next available source instead of leaving a hole.
  const [removedPhotos, setRemovedPhotos] = useState([]);
  const [requests, setRequests] = useState(seedRequests);
  const [tourDates, setTourDates] = useState(seedTourDates);
  const [reports, setReports] = useState([]);
  const [follows, setFollows] = useState(() => load("pit.follows", { u_demo: ["u_mara", "u_devon"] }));
  // Afterparty: like + comment a concert (keyed by the concert/log id)
  const [comments, setComments] = useState({
    log_1: [
      { id: "c1", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "The two-step during HEALING was unreal. Worth the bruises.", likes: 5 },
      { id: "c2", userId: "u_priya", name: "Priya N.", initials: "PN", text: "Back of the room sound was rough but the pit didn't care.", likes: 2 },
    ],
  });
  const [likes, setLikes] = useState({ log_1: 42, log_2: 88, log_3: 156 });
  const [myLikes, setMyLikes] = useState({});

  // Concert Lounge: a gated, Discord-style chat per concert (keyed by concertKey)
  const [lounge, setLounge] = useState({
    "turnstile|the fillmore|2026 · 06 · 21": [
      { id: "m1", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "anyone else lose a shoe in the pit lol", ts: "2h" },
      { id: "m2", userId: "u_priya", name: "Priya N.", initials: "PN", text: "the HEALING singalong gave me chills", ts: "2h" },
    ],
  });
  // Planned attendance ("Going") - per user, list of concert refs
  const [going, setGoing] = useState({
    u_mara: [{ key: "geese|the independent|2026 · 08 · 26", artist: "Geese", venue: "The Independent", city: "San Francisco", date: "2026 · 08 · 26" }],
  });
  // Artist fan clubs: permanent chat per artist + membership
  const [fanClubMsgs, setFanClubMsgs] = useState({
    turnstile: [
      { id: "fc1", userId: "u_mara", name: "Mara Quinn", initials: "MQ", text: "GLOW ON changed my life, no notes", ts: "3h" },
      { id: "fc2", userId: "u_devon", name: "Devon Ash", initials: "DA", text: "who's getting the MSG tickets??", ts: "1h" },
    ],
  });
  const [fanClubs, setFanClubs] = useState({ u_demo: ["Turnstile"], u_mara: ["Turnstile", "Militarie Gun"] });
  // Artist-owned profile overrides (banner/avatar/bio/feedEnabled) + updates feed
  const [artistProfiles, setArtistProfiles] = useState({
    turnstile: { feedEnabled: true },
  });
  const [artistPosts, setArtistPosts] = useState({
    turnstile: [{ id: "ap1", text: "New tour dates just dropped. MSG we're coming for you.", ts: "2d" }],
  });
  // Venue reviews (rating + text + photos), keyed by venue name
  const [venueReviews, setVenueReviews] = useState({});
  // Direct messages - keyed by the sorted pair of user ids; plus read markers.
  const [dms, setDms] = useState({
    u_demo__u_mara: [
      { id: "dm1", from: "u_mara", text: "yo are you going to the Geese show?", ts: "1d" },
      { id: "dm2", from: "u_demo", text: "trying to get tickets! you?", ts: "1d" },
      { id: "dm3", from: "u_mara", text: "got mine. @priyalive is coming too", ts: "23h" },
    ],
  });
  const [dmRead, setDmRead] = useState({});
  // Album + song ratings (stand-in for stream data) keyed by artist|title
  const [albumRatings, setAlbumRatings] = useState({ "turnstile|glow on": { u_mara: 5, u_devon: 4.5 }, "turnstile|never enough": { u_mara: 4 } });
  const [songRatings, setSongRatings] = useState({ "turnstile|healing": { u_mara: 5, u_demo: 5 } });

  // Persist identity + continuity state so a refresh doesn't wipe your session,
  // account, posts, or follows.
  useEffect(() => save("pit.session", session), [session]);
  useEffect(() => save("pit.users", users), [users]);
  useEffect(() => save("pit.feed", feed), [feed]);
  useEffect(() => save("pit.follows", follows), [follows]);

  const userById = (id) => users.find((u) => u.id === id);
  const userByHandle = (h) => users.find((u) => u.handle === h);
  const logsByUser = (id) => feed.filter((l) => l.userId === id);

  // Fold a server user into local state so profiles/avatars resolve everywhere.
  const absorbServerUser = (su) => {
    const merged = { playlists: [], genres: [], favoriteArtists: [], ...su };
    setUsers((all) => (all.some((x) => x.id === su.id) ? all.map((x) => (x.id === su.id ? { ...x, ...merged } : x)) : [...all, merged]));
    setSession(merged);
  };

  // Server-first auth (real accounts, hashed passwords, httpOnly sessions).
  // Falls back to the local in-memory demo accounts ONLY when the backend is
  // unreachable, so dev without the server still works.
  const login = async (email, password) => {
    try {
      const { user } = await api("/api/login", { method: "POST", body: { email, password } });
      absorbServerUser(user);
      return { ok: true };
    } catch (e) {
      if (e.status) return { ok: false, error: e.message }; // real server verdict
    }
    // offline/dev fallback
    const em = cleanEmail(email);
    const pw = typeof password === "string" ? password.slice(0, 100) : "";
    const u = users.find((x) => x.email.toLowerCase() === em);
    if (!u || !u.password || u.password !== pw) return { ok: false, error: "Wrong email or password." };
    if (u.isBanned) return { ok: false, error: "This account is banned." };
    setSession(u);
    return { ok: true };
  };

  // Ensure a handle is unique by suffixing a number if taken.
  const uniqueHandle = (base) => {
    let h = cleanHandle(base) || "fan";
    if (h.length < 3) h = (h + "fan").slice(0, 20);
    let candidate = h, i = 1;
    while (users.some((u) => u.handle === candidate)) candidate = (h.slice(0, 17) + i++).slice(0, 20);
    return candidate;
  };

  const signup = async ({ name, email, password, city }) => {
    const nm = cleanName(name);
    const em = cleanEmail(email);
    if (!isName(nm)) return { ok: false, error: "Enter a name (letters or numbers, up to 40 chars)." };
    if (!isEmail(em)) return { ok: false, error: "Enter a valid email address." };
    if (!isPassword(password)) return { ok: false, error: "Password needs 8+ characters with letters and numbers." };
    if (!city) return { ok: false, error: "Pick your city - it powers your local feed." };
    const srvCoords = cityCoords[city] || null;
    try {
      const { user } = await api("/api/signup", {
        method: "POST",
        body: { name: nm, email: em, password, city, lat: srvCoords?.lat, lng: srvCoords?.lng },
      });
      absorbServerUser(user);
      return { ok: true };
    } catch (e) {
      if (e.status) return { ok: false, error: e.message };
    }
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
    };
    setUsers((all) => [...all, u]);
    setSession(u);
    return { ok: true };
  };

  const logout = () => {
    api("/api/logout", { method: "POST" }).catch(() => {}); // best-effort server-side
    setSession(null);
  };

  const updateProfile = (patch) => {
    if (!session) return;
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
  };

  const addLog = (log) => {
    const safe = {
      ...log,
      artist: clean(log.artist, { max: 80 }),
      venue: clean(log.venue, { max: 80 }),
      review: clean(log.review, { max: LIMITS.review, newlines: true }),
      overall: clampRating(log.overall),
      band: log.band == null ? log.band : clampRating(log.band),
      room: log.room == null ? log.room : clampRating(log.room),
      userId: session?.id,
    };
    setFeed((f) => [safe, ...f]);
  };

  // Per-report moderation: content is public on post; reports drive action.
  const reportContent = (targetId, reason) => {
    const r = clean(reason, { max: LIMITS.note });
    setReports((rs) => [{ id: "rep_" + Date.now(), targetId, reason: r, reporterId: session?.id, status: "open" }, ...rs]);
    return { ok: true };
  };
  const actionReport = (repId) => {
    const r = reports.find((x) => x.id === repId);
    if (r) setRemovedIds((ids) => (ids.includes(r.targetId) ? ids : [...ids, r.targetId]));
    setReports((rs) => rs.map((x) => (x.id === repId ? { ...x, status: "actioned" } : x)));
  };
  const dismissReport = (repId) => setReports((rs) => rs.map((x) => (x.id === repId ? { ...x, status: "dismissed" } : x)));
  const removeContent = (id) => setRemovedIds((r) => (r.includes(id) ? r : [...r, id]));
  const restoreContent = (id) => setRemovedIds((r) => r.filter((x) => x !== id));

  // Artist account requests
  const requestArtist = (artistName, note) => {
    if (!session) return { ok: false, error: "Log in first." };
    const an = clean(artistName, { max: LIMITS.artist });
    if (an.length < 2) return { ok: false, error: "Enter the artist name." };
    setRequests((rs) => [...rs, { id: "r_" + Date.now(), userId: session.id, artistName: an, note: clean(note, { max: LIMITS.note, newlines: true }), status: "pending" }]);
    return { ok: true };
  };
  const approveArtist = (reqId) => {
    setRequests((rs) => rs.map((r) => (r.id === reqId ? { ...r, status: "approved" } : r)));
    const req = requests.find((r) => r.id === reqId);
    if (req) {
      setUsers((all) => all.map((u) => (u.id === req.userId ? { ...u, role: "artist", artistName: req.artistName } : u)));
      setSession((s) => (s && s.id === req.userId ? { ...s, role: "artist", artistName: req.artistName } : s));
    }
  };
  const rejectArtist = (reqId) => setRequests((rs) => rs.map((r) => (r.id === reqId ? { ...r, status: "rejected" } : r)));

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

  // Social graph
  const isFollowing = (id) => (follows[session?.id] || []).includes(id);
  const follow = (id) => setFollows((f) => ({ ...f, [session.id]: [...new Set([...(f[session.id] || []), id])] }));
  const unfollow = (id) => setFollows((f) => ({ ...f, [session.id]: (f[session.id] || []).filter((x) => x !== id) }));
  const followerCount = (id) => Object.values(follows).filter((arr) => arr.includes(id)).length;
  const followingCount = (id) => (follows[id] || []).length;

  // Afterparty interactions
  const commentsFor = (id) => comments[id] || [];
  const addComment = (id, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!session || !t) return;
    const c = { id: "c_" + Date.now(), userId: session.id, name: session.name, initials: session.initials, text: t, likes: 0 };
    setComments((m) => ({ ...m, [id]: [c, ...(m[id] || [])] }));
  };
  const likeInfo = (id, base = 0) => ({ count: (likes[id] ?? base) + (myLikes[id] ? 1 : 0), liked: !!myLikes[id] });
  const toggleLike = (id, base = 0) => {
    setMyLikes((m) => ({ ...m, [id]: !m[id] }));
    setLikes((l) => ({ ...l, [id]: l[id] ?? base }));
  };

  const visibleFeed = (staff) => (staff ? feed : feed.filter((l) => !removedIds.includes(l.id)));

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
  const concertKey = (log) => `${norm(log.artist)}|${norm(log.venue)}|${log.date || ""}`;

  // --- Concert Lounge (gated attendee chat) ---
  const loungeFor = (key) => lounge[key] || [];
  const addLoungeMessage = (key, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!session || !t) return;
    const m = { id: "m_" + Date.now(), userId: session.id, name: session.name, initials: session.initials, text: t, ts: "now" };
    setLounge((L) => ({ ...L, [key]: [...(L[key] || []), m] }));
  };

  // --- Album + song ratings (Apple-Music-style stars; user reviews for now) ---
  const rKey = (artist, title) => `${norm(artist)}|${norm(title)}`;
  const aggRate = (map, artist, title) => {
    const r = map[rKey(artist, title)];
    if (!r) return { avg: 0, count: 0, mine: 0 };
    const vals = Object.values(r);
    return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length, mine: (session && r[session.id]) || 0 };
  };
  const albumRating = (artist, title) => aggRate(albumRatings, artist, title);
  const songRating = (artist, title) => aggRate(songRatings, artist, title);
  const rateAlbum = (artist, title, n) => { if (!session) return; setAlbumRatings((m) => ({ ...m, [rKey(artist, title)]: { ...(m[rKey(artist, title)] || {}), [session.id]: clampRating(n) } })); };
  const rateSong = (artist, title, n) => { if (!session) return; setSongRatings((m) => ({ ...m, [rKey(artist, title)]: { ...(m[rKey(artist, title)] || {}), [session.id]: clampRating(n) } })); };

  // --- Artist fan clubs (permanent chat, keyed by artist) ---
  const fcKey = (artist) => norm(artist);
  const fanClubFor = (artist) => fanClubMsgs[fcKey(artist)] || [];
  const addFanClubMessage = (artist, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!session || !t) return;
    const m = { id: "fc_" + Date.now(), userId: session.id, name: session.name, initials: session.initials, text: t, ts: "now" };
    setFanClubMsgs((L) => ({ ...L, [fcKey(artist)]: [...(L[fcKey(artist)] || []), m] }));
  };
  const isFanClubMember = (artist) => (fanClubs[session?.id] || []).some((a) => norm(a) === norm(artist));
  const joinFanClub = (artist) => {
    if (!session) return;
    setFanClubs((f) => {
      const mine = f[session.id] || [];
      const has = mine.some((a) => norm(a) === norm(artist));
      return { ...f, [session.id]: has ? mine.filter((a) => norm(a) !== norm(artist)) : [...mine, artist] };
    });
  };
  const fanClubCount = (artist) => Object.values(fanClubs).filter((arr) => arr.some((a) => norm(a) === norm(artist))).length;

  // Directory of fan clubs, most members first — powers the Fan clubs screen and
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
  const updateArtistProfile = (name, patch) => {
    if (!isArtistOwner(name)) return;
    const safe = { ...patch };
    if ("bio" in safe) safe.bio = clean(safe.bio, { max: 600, newlines: true });
    setArtistProfiles((m) => ({ ...m, [norm(name)]: { ...(m[norm(name)] || {}), ...safe } }));
  };
  const artistFeedEnabled = (name) => !!artistProfiles[norm(name)]?.feedEnabled;
  const artistPostsFor = (name) => artistPosts[norm(name)] || [];
  const addArtistPost = (name, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!isArtistOwner(name) || !t) return;
    const p = { id: "ap_" + Date.now(), text: t, ts: "now" };
    setArtistPosts((m) => ({ ...m, [norm(name)]: [p, ...(m[norm(name)] || [])] }));
  };
  const removeArtistPost = (name, id) => {
    if (!isArtistOwner(name)) return;
    setArtistPosts((m) => ({ ...m, [norm(name)]: (m[norm(name)] || []).filter((p) => p.id !== id) }));
  };

  // --- Ban / suspend (admin) ---
  const accountStatus = (u) => {
    if (!u) return "ok";
    if (u.isBanned) return "banned";
    if (u.suspendedUntil && u.suspendedUntil > Date.now()) return "suspended";
    return "ok";
  };
  const banUser = (id) => setUsers((all) => all.map((u) => (u.id === id ? { ...u, isBanned: true } : u)));
  const unbanUser = (id) => setUsers((all) => all.map((u) => (u.id === id ? { ...u, isBanned: false, suspendedUntil: null } : u)));
  const suspendUser = (id, days = 7) => setUsers((all) => all.map((u) => (u.id === id ? { ...u, suspendedUntil: Date.now() + days * 86400000 } : u)));
  // moderation: drop a single chat/lounge/comment message (staff)
  const removeLoungeMessage = (key, msgId) => setLounge((L) => ({ ...L, [key]: (L[key] || []).filter((m) => m.id !== msgId) }));
  const removeComment = (logId, cId) => setComments((m) => ({ ...m, [logId]: (m[logId] || []).filter((c) => c.id !== cId) }));

  // --- Planned attendance ---
  const goingFor = (userId) => going[userId] || [];
  const isGoing = (key) => (going[session?.id] || []).some((g) => g.key === key);
  const toggleGoing = (log) => {
    if (!session) return;
    const key = concertKey(log);
    setGoing((G) => {
      const mine = G[session.id] || [];
      const exists = mine.some((g) => g.key === key);
      return { ...G, [session.id]: exists ? mine.filter((g) => g.key !== key) : [...mine, { key, artist: log.artist, venue: log.venue, city: log.city, date: log.date }] };
    });
  };
  const attendeesFor = (key) => users.filter((u) => (going[u.id] || []).some((g) => g.key === key));

  // --- Venue reviews + photos ---
  const venueReviewsFor = (venueName) => venueReviews[norm(venueName)] || [];
  const addVenueReview = (venueName, { rating, text, photos }) => {
    if (!session) return;
    const r = { id: "vr_" + Date.now(), userId: session.id, name: session.name, initials: session.initials, rating: clampRating(rating), text: clean(text, { max: LIMITS.review, newlines: true }), photos: (photos || []).slice(0, 8), ts: "now" };
    setVenueReviews((m) => ({ ...m, [norm(venueName)]: [r, ...(m[norm(venueName)] || [])] }));
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
  const sendDM = (otherId, text) => {
    const t = clean(text, { max: LIMITS.message, newlines: true });
    if (!session || !t) return;
    const key = dmKey(session.id, otherId);
    const m = { id: "dm_" + Date.now(), from: session.id, text: t, ts: "now" };
    setDms((d) => ({ ...d, [key]: [...(d[key] || []), m] }));
    setDmRead((r) => ({ ...r, [key]: (dms[key]?.length || 0) + 1 }));
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
      .map((k) => {
        const msgs = dms[k];
        const otherId = k.split("__").find((id) => id !== session.id);
        const last = msgs[msgs.length - 1];
        const unread = msgs.filter((m, i) => m.from !== session.id && i >= (dmRead[k] || 0)).length;
        return { otherId, otherUser: userById(otherId), last, unread, count: msgs.length };
      })
      .sort((a, b) => b.count - a.count);
  };
  const inboxUnread = () => inboxThreads().reduce((s, t) => s + t.unread, 0);

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
      .filter((t) => norm(t.artist) === key && (t.releaseAt <= Date.now() || isStaff(session?.role) || t.createdBy === session?.id))
      .map((t) => ({ ...t, scheduled: t.releaseAt > Date.now() }));
    const totalRatings = nights.reduce((s, n) => s + (n.likes || 0), 0);
    const cat = catalogArtists[key];
    const prof = artistProfiles[key] || {};
    return {
      name,
      genre: nights.find((n) => n.genre)?.genre || cat?.genre || "—",
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
  const visibleTourDates = ({ staff, viewerId }) =>
    tourDates
      .filter((t) => t.releaseAt <= Date.now() || staff || t.createdBy === viewerId)
      .map((t) => ({ ...t, scheduled: t.releaseAt > Date.now() }));

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
      .filter((t) => norm(t.venue) === key && (t.releaseAt <= Date.now() || isStaff(session?.role) || t.createdBy === session?.id))
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
    tourDates.filter((t) => norm(t.venue) === norm(name) && t.releaseAt <= Date.now()).length;

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
    return rows
      .map((a) => ({ ...a, score: (a.avg * a.reviews + M * C) / (a.reviews + C) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  };

  const artistsAlphabetical = (n = 12) =>
    allArtists().sort((a, b) => a.name.localeCompare(b.name)).slice(0, n);

  // Soonest released upcoming dates across the whole catalog.
  const upcomingEvents = (n = 8) =>
    tourDates
      .filter((t) => t.releaseAt <= Date.now())
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
        upcoming: tourDates.filter((t) => norm(t.venue) === norm(v.name) && t.releaseAt <= Date.now()).length,
      }))
      .filter((v) => v.distanceKm <= maxKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  };

  // Upcoming shows in a region (within maxKm of center), nearest first, with soldOut.
  const regionShows = (maxKm = 75, center = home) => {
    if (!center || center.lat == null) return [];
    return tourDates
      .filter((t) => t.releaseAt <= Date.now())
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
      .filter((t) => t.releaseAt <= Date.now())
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
  const artistFanPhotos = (name, n = 5) => {
    const k = norm(name);
    return feed
      .filter((l) => !removedIds.includes(l.id) && norm(l.artist) === k && l.photosPublic && l.photos?.length)
      .flatMap((l) => l.photos.map((uri) => ({ uri, by: l.user?.name, likes: l.likes || 0, source: "fan" })))
      .filter((p) => !isPhotoRemoved(p.uri))
      .sort((a, b) => b.likes - a.likes);
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
    users, session, feed, removedIds, requests, tourDates, reports, follows,
    userById, userByHandle, logsByUser,
    login, signup, logout, updateProfile,
    addLog, reportContent, actionReport, dismissReport, removeContent, restoreContent,
    requestArtist, approveArtist, rejectArtist,
    addTourDatesBatch,
    isFollowing, follow, unfollow, followerCount, followingCount,
    visibleFeed, followingFeed, visibleTourDates, artistSummary, venueSummary,
    localVenues, regionShows, localFeed, recommendedShows, venueCoord,
    searchVenues, venuesByCity, venueUpcomingCount,
    allArtists, topArtists, artistsAlphabetical, upcomingEvents, trendingVenues,
    commentsFor, addComment, likeInfo, toggleLike,
    concertKey, loungeFor, addLoungeMessage,
    albumRating, songRating, rateAlbum, rateSong,
    fanClubFor, addFanClubMessage, isFanClubMember, joinFanClub, fanClubCount, fanClubsDirectory,
    isArtistOwner, artistProfile, updateArtistProfile, artistFeedEnabled,
    artistPostsFor, addArtistPost, removeArtistPost,
    accountStatus, banUser, unbanUser, suspendUser, removeLoungeMessage, removeComment,
    goingFor, isGoing, toggleGoing, attendeesFor,
    venueReviewsFor, addVenueReview, venueRating, venueTopPhotos, venuePhotos, artistFanPhotos,
    artistGallery, isPhotoRemoved, removePhoto, restorePhoto,
    threadMessages, sendDM, markThreadRead, inboxThreads, inboxUnread,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
