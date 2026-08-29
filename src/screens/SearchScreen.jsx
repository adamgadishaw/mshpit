import { useMemo, useState, useEffect, useRef } from "react";
import { ActivityIndicator, View, Text, StyleSheet, ScrollView, TextInput, Pressable, Image } from "react-native";
import { colors, mono, radius, roleColor } from "../theme";
import { ratedShows } from "../data";
import { ingestedArtists } from "../seed/ingested";
import { useStore } from "../store";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import Badge from "../components/Badge";
import { formatDate } from "../domain/dates.mjs";
import {
  recentSongSearchEntry,
  recentSongTrack,
  settleUnifiedSearchRequests,
  unifiedSearchCategories,
  unifiedSearchPreviewRows,
  unifiedPeopleSearchScope,
  unifiedSearchRequestOptions,
  unifiedSearchState,
  visibleUnifiedPeople,
  withoutBlockedPersonSearches,
} from "../domain/unifiedSearch.mjs";
import { searchLiveAnnouncement } from "../domain/searchAccessibility.mjs";
import { accountTargetScope, isCurrentScreenRequest, scopedScreenValue } from "../domain/screenScope.mjs";
import { createUnifiedEventSearchIndex, searchUnifiedEventIndex } from "../domain/unifiedLocationSearch.mjs";
import { openTicketLink } from "../lib/ticketLinks";
import { recordGuestSearch } from "../features/analytics/services/guestSearchAnalyticsApi.mjs";
import { ENABLE_DEMO_DATA, ENABLE_MUSIC_PLAYER } from "../config/runtime.mjs";

const EMPTY_LOOKUP_STATE = Object.freeze({ busy: false, message: "" });
const EMPTY_ROWS = Object.freeze([]);
const SEARCH_ALL_PREVIEW_LIMIT = 5;

// ---- result rows (shared by every section of the unified dropdown) ----
function PersonRow({ u, following, canFollow, onFollow, onOpen }) {
  const rc = roleColor(u.role);
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Open ${u.name}'s profile${u.handle ? `, @${u.handle}` : ""}`}>
        <Avatar user={u} size={36} />
        <View style={{ flex: 1 }}>
          <View style={styles.nameLine}>
            <Text style={styles.rowName} numberOfLines={1}>{u.name}</Text>
            {u.verified && <Badge type="verified" size={15} />}
          </View>
          <Text style={[styles.rowSub, rc && { color: rc, fontWeight: "800" }]} numberOfLines={1}>@{u.handle}{u.home?.city ? ` · ${u.home.city}` : ""}</Text>
        </View>
      </Pressable>
      {canFollow && (
        <Pressable style={[styles.followBtn, following && styles.followingBtn]} onPress={onFollow} accessibilityRole="button" accessibilityLabel={`${following ? "Unfollow" : "Follow"} ${u.name}`} accessibilityState={{ selected: following }}>
          <Text style={[styles.followTxt, following && styles.followingTxt]}>{following ? "Following" : "Follow"}</Text>
        </Pressable>
      )}
    </View>
  );
}
function ArtistRow({ name, genre, memorial, onPress }) {
  const remembered = memorial?.deceased === true;
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open artist ${name}${genre ? `, ${genre}` : ""}${remembered ? ", memorial tribute" : ""}`}>
      <View style={[styles.dot, { borderColor: remembered ? colors.gold : colors.amber }]}><Icon name={remembered ? "dove" : "music"} size={14} color={remembered ? colors.gold : colors.amber} /></View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameLine}>
          <Text style={[styles.rowName, { flexShrink: 1 }]} numberOfLines={1}>{name}</Text>
          {remembered ? (
            <View style={styles.memorialPill} accessible={false}>
              <Icon name="dove" size={11} color={colors.gold} />
              <Text style={styles.memorialPillText}>IN MEMORY</Text>
            </View>
          ) : null}
        </View>
        {!!genre && <Text style={styles.rowSub} numberOfLines={1}>{genre}</Text>}
      </View>
      <Icon name="chevron-right" size={16} color={colors.textDim} />
    </Pressable>
  );
}
function SongRow({ song, onPress, onAdd }) {
  const mins = song.duration ? `${Math.floor(song.duration / 60)}:${String(song.duration % 60).padStart(2, "0")}` : null;
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onPress || undefined} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={onPress ? `Play ${song.title} by ${song.artist}` : `${song.title} by ${song.artist}`} accessibilityState={onPress ? undefined : { disabled: true }}>
        {song.art
          ? <Image source={{ uri: song.art }} style={styles.songArt} accessible={false} />
          : <View style={[styles.dot, { borderColor: colors.good }]}><Icon name="music" size={14} color={colors.good} /></View>}
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={1}>{song.title}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{song.artist}{mins ? ` · ${mins}` : ""}</Text>
        </View>
        {onPress && <Icon name="play" size={14} color={colors.amber} />}
      </Pressable>
      {onAdd && (
        <Pressable style={styles.secondaryAction} onPress={onAdd} accessibilityRole="button" accessibilityLabel={`Add ${song.title} to a playlist`}>
          <Icon name="plus" size={16} color={colors.textDim} />
        </Pressable>
      )}
    </View>
  );
}
function VenueRow({ v, onPress }) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open venue ${v.name}${v.place ? `, ${v.place}` : ""}${v.upcoming > 0 ? `, ${v.upcoming} upcoming` : ""}`}>
      <View style={[styles.dot, { borderColor: colors.cool }]}><Icon name="pin" size={14} color={colors.cool} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{v.name}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{v.place || "Location not listed"}</Text>
      </View>
      {v.upcoming > 0 && <View style={styles.pill}><Text style={styles.pillTxt}>{v.upcoming}</Text></View>}
    </Pressable>
  );
}
function EventRow({ t, onOpenShow, onOpenVenue, onOpenTicket }) {
  const venue = {
    name: t.venue,
    place: t.place || t.city || "",
    source: t.source || null,
    providerVenueId: t.providerVenueId || null,
    venueCity: t.venueCity || t.city || null,
    venueRegion: t.venueRegion || null,
    venueCountryCode: t.venueCountryCode || null,
    venueCountry: t.venueCountry || null,
  };
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={() => onOpenShow?.(t)} accessibilityRole="button" accessibilityLabel={`Open show for ${t.artist} at ${t.venue}, ${formatDate(t.date, t.date)}`}>
        <View style={[styles.dot, { borderColor: colors.line }]}><Icon name="calendar" size={14} color={colors.amber} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={1}>{t.artist}</Text>
          <Text style={styles.rowSub} numberOfLines={1}>{t.venue} · {formatDate(t.date, t.date)}</Text>
        </View>
      </Pressable>
      <Pressable style={styles.secondaryAction} onPress={() => onOpenVenue?.(venue)} accessibilityRole="button" accessibilityLabel={`Open venue ${t.venue}`}>
        <Icon name="pin" size={15} color={colors.cool} />
      </Pressable>
      {t.soldOut
        ? <Text style={styles.soldOut}>SOLD OUT</Text>
        : t.ticketUrl ? <Pressable style={styles.secondaryAction} onPress={() => onOpenTicket?.(t)} accessibilityRole="link" accessibilityLabel={`Open tickets for ${t.artist} at ${t.venue}`}><Icon name="external" size={15} color={colors.amber} /></Pressable> : null}
    </View>
  );
}

// A collapsible-free section: header + rows. Renders nothing when empty.
function Section({ icon, tint, title, count, rows, hidden = false }) {
  if (hidden || !rows || rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.secHead}>
        <Icon name={icon} size={13} color={tint} />
        <Text style={styles.secTitle} accessibilityRole="header">{title}</Text>
        <Text style={styles.secCount}>{count}</Text>
      </View>
      {rows}
    </View>
  );
}

function searchResultBucket(count) {
  if (count <= 0) return "zero";
  if (count <= 5) return "one_to_five";
  if (count <= 20) return "six_to_twenty";
  return "over_twenty";
}

export default function SearchScreen({ onOpen, onOpenArtist, onOpenVenue, onOpenFanClub, onOpenProfile, onPlay, onAddToPlaylist }) {
  const { tourDates, searchVenues, artistsAlphabetical, fanClubsDirectory, fanClubDirectoryStatus, loadFanClubsDirectory, track,
    session, blockedIds, isFollowing, follow, unfollow, searchPeople, searchArtistsApi, resolveArtist,
    recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches, searchSongsApi } = useStore();
  const searchAccountScope = accountTargetScope(session?.id, "search");
  const lookupRequestRef = useRef({ sequence: 0, scope: searchAccountScope, target: null });
  const [queryState, setQueryState] = useState(() => ({ scope: searchAccountScope, value: "" }));
  const q = scopedScreenValue(queryState, searchAccountScope, "");
  const setQ = (value) => {
    const active = lookupRequestRef.current;
    lookupRequestRef.current = { sequence: active.sequence + 1, scope: searchAccountScope, target: null };
    setQueryState({ scope: searchAccountScope, value: String(value || "") });
  };
  const [focused, setFocused] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [artistCache, setArtistCache] = useState({ scope: null, rows: [] });
  const [songCache, setSongCache] = useState({ scope: null, rows: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const query = q.trim().toLowerCase();
  const [settledQuery, setSettledQuery] = useState(query);
  const activeSearchControllerRef = useRef(null);
  const previousQueryRef = useRef(query);
  const lookupScope = accountTargetScope(session?.id, `search:${query}`);
  const remoteSearchScope = accountTargetScope(session?.id, `search:${settledQuery}`);
  const dbArtists = artistCache.scope === lookupScope ? artistCache.rows : EMPTY_ROWS;
  const songs = songCache.scope === lookupScope ? songCache.rows : EMPTY_ROWS;
  const searchCategories = useMemo(() => unifiedSearchCategories({
    canSearchPeople: Boolean(session?.id),
    canSearchSongs: ENABLE_MUSIC_PLAYER,
  }), [session?.id]);
  const lookupScopeRef = useRef(lookupScope);
  lookupScopeRef.current = lookupScope;
  const [lookupState, setLookupState] = useState(() => ({ scope: lookupScope, value: EMPTY_LOOKUP_STATE }));
  const { busy: lookupBusy, message: actionMessage } = scopedScreenValue(lookupState, lookupScope, EMPTY_LOOKUP_STATE);
  const updateLookupState = (changes) => setLookupState((current) => ({
    scope: lookupScope,
    value: { ...scopedScreenValue(current, lookupScope, EMPTY_LOOKUP_STATE), ...changes },
  }));
  const setActionMessage = (message) => updateLookupState({ message });
  const changeQuery = (value) => {
    setQ(value);
    // Case-only and whitespace-only edits keep the same normalized scope. Clear
    // an old lookup message explicitly, but avoid another state write while the
    // lookup state is already empty.
    if (lookupBusy || actionMessage) {
      setLookupState({ scope: lookupScope, value: EMPTY_LOOKUP_STATE });
    }
  };
  const peopleScope = unifiedPeopleSearchScope(session?.id, blockedIds);
  const [peopleCache, setPeopleCache] = useState({ scope: null, query: "", rows: [] });
  const fanClubDirectoryLoaderRef = useRef(loadFanClubsDirectory);
  fanClubDirectoryLoaderRef.current = loadFanClubsDirectory;

  useEffect(() => {
    setQueryState({ scope: searchAccountScope, value: "" });
    setFocused(false);
    setActiveCategory("all");
    setSearchError("");
    setLookupState({ scope: accountTargetScope(session?.id, "search:"), value: EMPTY_LOOKUP_STATE });
  }, [searchAccountScope, session?.id]);
  useEffect(() => () => {
    const active = lookupRequestRef.current;
    lookupRequestRef.current = { sequence: active.sequence + 1, scope: null, target: null };
  }, []);
  useEffect(() => {
    // Stop the previous request as soon as the text changes, not after the next
    // debounce finishes. Expensive local scans and remote requests then share the
    // same settled query and execute only once for a typing pause.
    const previousQuery = previousQueryRef.current;
    previousQueryRef.current = query;
    activeSearchControllerRef.current?.abort();
    if (!query) {
      setSettledQuery("");
      setSearchLoading(false);
      setSearchError("");
      setActiveCategory("all");
      if (previousQuery) setSearchRevision((value) => value + 1);
      return undefined;
    }
    setSearchLoading(true);
    setSearchError("");
    const id = setTimeout(() => setSettledQuery(query), 250);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    fanClubDirectoryLoaderRef.current?.({ signal: controller.signal })
      .catch(() => { /* architecture: allow-empty-catch -- search keeps its existing local fan-club snapshot when the optional directory refresh fails */ });
    return () => controller.abort();
  }, [searchAccountScope]);

  // Local sections are computed once for each query and reused by rendering and
  // analytics. Previously venue/event/club matching ran again after the remote
  // branches settled, which doubled the most expensive catalog work on every
  // successful search.
  const eventSearchIndex = useMemo(() => createUnifiedEventSearchIndex(tourDates), [tourDates]);
  const searchedVenues = useMemo(() => (settledQuery ? searchVenues(settledQuery, 24) : []), [settledQuery, tourDates]);
  const searchedEvents = useMemo(() => (settledQuery
    ? searchUnifiedEventIndex(eventSearchIndex, settledQuery, { limit: 24 })
    : []), [eventSearchIndex, settledQuery]);
  const searchedClubs = useMemo(() => {
    if (!settledQuery) return [];
    return fanClubsDirectory().filter((c) => c.artist.toLowerCase().includes(settledQuery)).slice(0, 12);
  }, [fanClubDirectoryStatus, settledQuery]);
  const queryIsSettled = query === settledQuery;
  const venues = queryIsSettled ? searchedVenues : [];
  const events = queryIsSettled ? searchedEvents : [];
  const clubs = queryIsSettled ? searchedClubs : [];
  // Local venue/event/club indexes can finish hydrating while the remote search
  // is in flight. Keep their latest count for analytics without making those
  // unrelated updates cancel and restart people/artist/song requests.
  const localResultCountRef = useRef(0);
  localResultCountRef.current = venues.length + events.length + clubs.length;

  // Pull the artist catalog on open and whenever the box is cleared. A typed
  // query searches every available remote source together. The caches are
  // request-scoped, so an old query disappears synchronously and never flashes
  // beneath newly typed text while its replacement is debouncing.
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    activeSearchControllerRef.current = controller;
    const requestOptions = unifiedSearchRequestOptions(controller);
    const requestScope = remoteSearchScope;
    const searchQuery = settledQuery;
    if (!searchQuery) {
      setSearchLoading(false);
      setSearchError("");
      searchArtistsApi("", requestOptions)
        .then((rows) => {
          if (live && !controller.signal.aborted) setArtistCache({ scope: requestScope, rows: rows || [] });
        })
        .catch((error) => {
          if (live && !controller.signal.aborted && error?.name !== "AbortError") {
            setArtistCache({ scope: requestScope, rows: [] });
          }
        })
        .finally(() => {
          if (activeSearchControllerRef.current === controller) activeSearchControllerRef.current = null;
        });
      return () => {
        live = false;
        controller.abort();
        if (activeSearchControllerRef.current === controller) activeSearchControllerRef.current = null;
      };
    }
    setSearchLoading(true);
    setSearchError("");
    const run = async () => {
      try {
        const remote = await settleUnifiedSearchRequests({
          // People search is intentionally member-only. Guests should not see a
          // People filter that can never produce a result or call its private API.
          people: session?.id ? searchPeople(searchQuery, requestOptions) : null,
          artists: searchArtistsApi(searchQuery, requestOptions),
          songs: ENABLE_MUSIC_PLAYER ? searchSongsApi(searchQuery, requestOptions) : null,
        });
        if (!live || controller.signal.aborted || remote.aborted) return;
        setPeopleCache({ scope: peopleScope, query: searchQuery, rows: remote.people });
        setArtistCache({ scope: requestScope, rows: remote.artists });
        setSongCache({ scope: requestScope, rows: remote.songs });

        const localResultCount = localResultCountRef.current;

        // Search text stays inside the search requests. Analytics receives only a
        // coarse result-count bucket, computed after this query's remote and local
        // result sets settle, so stale requests cannot emit a misleading funnel.
        const resultCount = remote.people.length
          + remote.artists.length
          + remote.songs.length
          + localResultCount;
        const requestHadSuccess = remote.succeeded > 0 || localResultCount > 0;
        if (remote.failures.length) {
          setSearchError(resultCount > 0
            ? "Some results could not load. The matches below are still ready."
            : requestHadSuccess
              ? "Some parts of search could not load. Try again to check every source."
              : "Search could not update. Check your connection and try again.");
        }
        const resultBucket = searchResultBucket(resultCount);
        if (session?.id) {
          track("search", { kind: "all", resultBucket });
        } else if (requestHadSuccess) {
          // This request contains no search text or browser/account identity;
          // the server increments one coarse daily aggregate counter only.
          void recordGuestSearch({ kind: "all", resultBucket, outcome: "success" }, { signal: controller.signal });
        } else {
          void recordGuestSearch({ kind: "all", resultBucket: "unknown", outcome: "failed" }, { signal: controller.signal });
        }
      } catch (error) {
        if (live && !controller.signal.aborted && error?.name !== "AbortError") {
          setSearchError("Search could not update. Check your connection and try again.");
          if (!session?.id) {
            void recordGuestSearch({ kind: "all", resultBucket: "unknown", outcome: "failed" }, { signal: controller.signal });
          }
        }
      } finally {
        if (live && !controller.signal.aborted) setSearchLoading(false);
        if (activeSearchControllerRef.current === controller) activeSearchControllerRef.current = null;
      }
    };
    void run();
    return () => {
      live = false;
      controller.abort();
      if (activeSearchControllerRef.current === controller) activeSearchControllerRef.current = null;
    };
  }, [peopleScope, remoteSearchScope, searchRevision, session?.id, settledQuery]);

  const mine = session?.id;
  // People are pure type-ahead (like every social app): never a full list, always
  // narrowing as you type. Empty query shows nobody.
  const people = useMemo(() => {
    return visibleUnifiedPeople(peopleCache, {
      scope: peopleScope, query, viewerId: mine, blockedIds, limit: 20,
    });
  }, [peopleCache, peopleScope, query, mine, blockedIds]);
  const visibleRecentSearches = useMemo(
    () => withoutBlockedPersonSearches(recentSearches, blockedIds)
      .filter((entry) => ENABLE_MUSIC_PLAYER || entry?.type !== "song"),
    [recentSearches, blockedIds],
  );

  const searchedArtists = useMemo(() => {
    const map = new Map();
    const add = (name, genre, memorial = null) => { const k = name.toLowerCase(); if (name && !map.has(k)) map.set(k, { name, genre, memorial }); };
    // DB catalog first (notable-first, includes on-demand-resolved artists).
    dbArtists.forEach((a) => add(a.name, a.genre, a.memorial));
    if (!settledQuery) {
      // The API already returned ranked browse rows. Only fall back to a local
      // alphabetical sort while that first response is unavailable.
      if (!map.size) artistsAlphabetical(24).forEach((a) => add(a.name, a.genre));
      return [...map.values()].slice(0, 24);
    }
    ratedShows.forEach((s) => s.artist.toLowerCase().includes(settledQuery) && add(s.artist, s.genre));
    tourDates.forEach((t) => t.artist.toLowerCase().includes(settledQuery) && add(t.artist, t.genre));
    // This mutable fixture is development-only. Production must not scan a
    // second full artist catalog after the indexed server result arrives.
    if (ENABLE_DEMO_DATA) Object.values(ingestedArtists).forEach((a) => a.name.toLowerCase().includes(settledQuery) && add(a.name, a.genre));
    return [...map.values()].slice(0, 30);
  }, [settledQuery, tourDates, dbArtists]);
  const artists = queryIsSettled ? searchedArtists : [];

  const showBrowse = !query;
  const exactArtist = artists.some((a) => a.name.toLowerCase() === query);
  const resultState = unifiedSearchState({ query, loading: searchLoading || !queryIsSettled, people, artists, songs, venues, events, clubs });
  const resultGroups = { people, artists, songs, venues, events, clubs };
  const categoryGroupKey = activeCategory === "shows" ? "events" : activeCategory;
  const selectedRows = activeCategory === "all" ? [] : resultGroups[categoryGroupKey] || [];
  const visibleResultState = activeCategory === "all"
    ? resultState
    : (searchLoading || !queryIsSettled) ? "loading" : selectedRows.length ? "results" : "no-results";
  const visibleResultGroups = activeCategory === "all" ? resultGroups : { [categoryGroupKey]: selectedRows };
  const activeCategoryLabel = searchCategories.find((item) => item.key === activeCategory)?.label || "Results";
  const showCategory = (key) => activeCategory === "all" || activeCategory === key;
  const visibleSearchError = queryIsSettled ? searchError : "";
  const liveAnnouncement = actionMessage || searchLiveAnnouncement({ query, state: visibleResultState, error: visibleSearchError, groups: visibleResultGroups });
  const previewRows = (rows, category) => showBrowse ? rows : unifiedSearchPreviewRows(rows, {
    activeCategory, category, limit: SEARCH_ALL_PREVIEW_LIMIT,
  });
  const peopleRows = previewRows(people, "people");
  const artistRows = previewRows(artists, "artists");
  const songRows = previewRows(songs, "songs");
  const venueRows = previewRows(venues, "venues");
  const eventRows = previewRows(events, "shows");
  const clubRows = previewRows(clubs, "clubs");

  // Opening any result records it as a recent search, so the empty state stays
  // useful (like every big app). Re-opening a recent bumps it back to the top.
  const openArtist = (artist) => {
    const payload = artist && typeof artist === "object" ? artist : null;
    const name = String(payload?.name || artist || "").trim();
    if (!name) return;
    addRecentSearch?.({ type: "artist", label: name });
    onOpenArtist?.(payload || name);
  };
  const openVenue = (venue) => {
    const payload = venue && typeof venue === "object" ? venue : { name: venue };
    const name = String(payload?.name || "").trim();
    if (!name) return;
    addRecentSearch?.({ type: "venue", label: name });
    onOpenVenue?.(payload);
  };
  const openPerson = (u) => { addRecentSearch?.({ type: "person", label: u.name, id: u.id, sub: `@${u.handle}` }); onOpenProfile?.(u.id); };
  const reopenRecent = (e) => {
    if (e.type === "artist") openArtist(e.label);
    else if (e.type === "venue") openVenue(e.label);
    else if (e.type === "person" && e.id) openPerson({ id: e.id, name: e.label, handle: (e.sub || "").replace(/^@/, "") });
    else if (ENABLE_MUSIC_PLAYER && e.type === "song") {
      const recentTrack = recentSongTrack(e);
      if (recentTrack && onPlay) {
        addRecentSearch?.(recentSongSearchEntry(recentTrack));
        onPlay(recentTrack);
      } else setQ(e.label);
    }
    else setQ(e.label);
  };
  const recentIcon = (type) => (type === "venue" ? "pin" : type === "person" ? "you" : type === "query" ? "search" : "music");
  const recentTint = (type) => (type === "venue" ? colors.cool : type === "person" ? colors.gold : colors.amber);

  // First person to search a not-yet-catalogued artist: resolve it from
  // MusicBrainz on the server (creates the page), then open it.
  const lookUp = async (name) => {
    if (lookupBusy) return;
    const target = String(name || "").trim().toLowerCase();
    const active = lookupRequestRef.current;
    const request = { sequence: active.sequence + 1, scope: lookupScope, target };
    lookupRequestRef.current = request;
    const isCurrent = () => lookupScopeRef.current === request.scope
      && isCurrentScreenRequest(lookupRequestRef.current, request);
    updateLookupState({ busy: true, message: "" });
    try {
      const artist = await resolveArtist(name);
      if (!isCurrent()) return;
      if (!artist?.name) {
        updateLookupState({ message: `Mshpit could not find an artist named ${name}.` });
        return;
      }
      addRecentSearch?.({ type: "artist", label: artist.name });
      onOpenArtist?.(artist);
    } catch {
      if (isCurrent()) updateLookupState({ message: `Mshpit could not look up ${name}. Check your connection and try again.` });
    } finally {
      if (isCurrent()) updateLookupState({ busy: false });
    }
  };
  const openTicket = (event) => openTicketLink(event.ticketUrl, {
    onFailure: () => setActionMessage(`The ticket link for ${event.artist} could not be opened.`),
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={[styles.field, focused && styles.fieldFocused]}>
          <Icon name="search" size={18} color={focused ? colors.amber : colors.textDim} />
          <TextInput
            style={styles.input}
            placeholder={session?.id ? "Search artists, people, shows, venues" : "Search artists, shows, venues"}
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={changeQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            accessibilityLabel="Search Mshpit"
            accessibilityHint={session?.id ? "Find artists, people, shows, venues, and fan clubs" : "Find artists, shows, venues, and fan clubs"}
            accessibilityState={{ busy: searchLoading || !queryIsSettled }}
            returnKeyType="search"
          />
          {!!q && <Pressable style={styles.fieldAction} onPress={() => { changeQuery(""); setSearchError(""); }} accessibilityRole="button" accessibilityLabel="Clear search"><Icon name="x" size={16} color={colors.textFaint} /></Pressable>}
        </View>
        {!!query && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRail}
            accessibilityLabel="Filter search results"
          >
            {searchCategories.map((item) => {
              const selected = item.key === activeCategory;
              return (
                <Pressable key={item.key} style={[styles.categoryChip, selected && styles.categoryChipSelected]} onPress={() => setActiveCategory(item.key)} accessibilityRole="tab" accessibilityState={{ selected }}>
                  <Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {!!liveAnnouncement && (
          <Text style={[styles.resultStatus, (visibleSearchError || actionMessage) && styles.resultError]} accessibilityRole="summary" accessibilityLiveRegion={visibleSearchError || actionMessage ? "assertive" : "polite"}>{liveAnnouncement}</Text>
        )}
        {!!visibleSearchError && (
          <Pressable style={styles.retrySearch} onPress={() => { setSearchError(""); setSearchRevision((value) => value + 1); }} accessibilityRole="button" accessibilityLabel="Retry search">
            <Text style={styles.retrySearchText}>Try search again</Text>
          </Pressable>
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {showBrowse && (
          <Text style={styles.browseHint}>
            {ENABLE_MUSIC_PLAYER
              ? "Find artists, people, songs, shows, venues, and fan clubs."
              : session?.id
                ? "Find artists, people, shows, venues, and fan clubs."
                : "Find artists, shows, venues, and fan clubs."}
          </Text>
        )}

        {showBrowse && visibleRecentSearches.length > 0 && (
          <View style={styles.section}>
            <View style={styles.recentHead}>
              <Icon name="search" size={13} color={colors.textDim} />
              <Text style={[styles.secTitle, { flex: 1 }]}>RECENT</Text>
              <Pressable style={styles.clearAction} onPress={clearRecentSearches} accessibilityRole="button" accessibilityLabel="Clear all recent searches">
                <Text style={styles.clearTxt}>Clear</Text>
              </Pressable>
            </View>
            {visibleRecentSearches.slice(0, 5).map((e, i) => (
              <View key={`${e.type}:${e.label}:${i}`} style={styles.row}>
                <Pressable style={styles.rowMain} onPress={() => reopenRecent(e)} accessibilityRole="button" accessibilityLabel={`Reopen ${e.label}`}>
                  <View style={[styles.dot, { borderColor: recentTint(e.type) }]}><Icon name={recentIcon(e.type)} size={14} color={recentTint(e.type)} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{e.label}</Text>
                    {!!e.sub && <Text style={styles.rowSub} numberOfLines={1}>{e.sub}</Text>}
                  </View>
                </Pressable>
                <Pressable style={styles.secondaryAction} onPress={() => removeRecentSearch(e.label, e.type)} accessibilityRole="button" accessibilityLabel={`Remove ${e.label} from recent searches`}>
                  <Icon name="x" size={15} color={colors.textFaint} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {resultState === "loading" && (
          <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Searching Mshpit" accessibilityState={{ busy: true }}>
            <ActivityIndicator size="small" color={colors.amber} />
            <Text style={styles.loadingText}>Searching Mshpit...</Text>
          </View>
        )}

        <Section
          hidden={!showCategory("people")}
          icon="you" tint={colors.gold}
          title="PEOPLE" count={people.length}
          rows={peopleRows.map((u) => (
            <PersonRow
              key={u.id}
              u={u}
              following={isFollowing(u.id)}
              canFollow={!!session && u.id !== session?.id}
              onFollow={() => (isFollowing(u.id) ? unfollow(u.id) : follow(u.id))}
              onOpen={() => openPerson(u)}
            />
          ))}
        />

        <Section
          hidden={!showCategory("artists")}
          icon="music" tint={colors.amber}
          title={showBrowse ? "SUGGESTED ARTISTS" : "ARTISTS"} count={artists.length}
          rows={[
            ...artistRows.map((a) => <ArtistRow key={a.name} name={a.name} genre={a.genre} memorial={a.memorial} onPress={() => openArtist(a)} />),
            showCategory("artists") && query.length >= 2 && !exactArtist ? (
              <Pressable key="_lookup" style={styles.row} onPress={() => lookUp(q.trim())} disabled={lookupBusy} accessibilityRole="button" accessibilityLabel={`Search the full artist directory for ${q.trim()}`} accessibilityHint="Use this when the artist is not on Mshpit yet" accessibilityState={{ busy: lookupBusy, disabled: lookupBusy }}>
                <View style={[styles.dot, { borderColor: colors.good }]}><Icon name="search" size={14} color={colors.good} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName} numberOfLines={1}>Search the full directory for “{q.trim()}”</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>Find an artist who is not on Mshpit yet</Text>
                </View>
                {lookupBusy ? <ActivityIndicator size="small" color={colors.good} /> : <Icon name="chevron-right" size={16} color={colors.textDim} />}
              </Pressable>
            ) : null,
          ].filter(Boolean)}
        />

        {ENABLE_MUSIC_PLAYER && <Section
          hidden={!showCategory("songs")}
          icon="music" tint={colors.good}
          title="SONGS" count={songs.length}
          rows={songRows.map((song) => (
            <SongRow
              key={`${song.id || song.title}|${song.artist}`}
              song={song}
              onAdd={onAddToPlaylist ? () => {
                const selected = recentSongTrack(song);
                if (selected) onAddToPlaylist(selected);
              } : null}
              onPress={onPlay ? () => {
                const selected = recentSongTrack(song);
                if (!selected) return;
                addRecentSearch?.(recentSongSearchEntry(selected));
                onPlay(selected);
              } : null}
            />
          ))} />}

        <Section hidden={!showCategory("venues")} icon="pin" tint={colors.cool} title="VENUES" count={venues.length}
          rows={venueRows.map((v) => <VenueRow key={v.identity || `${v.name}|${v.place || ""}|${v.source || ""}|${v.providerVenueId || ""}`} v={v} onPress={() => openVenue(v)} />)} />

        <Section hidden={!showCategory("shows")} icon="calendar" tint={colors.amber} title="SHOWS" count={events.length}
          rows={eventRows.map((t) => <EventRow key={t.id || `${t.artist}|${t.venue}|${t.date}`} t={t} onOpenShow={onOpen} onOpenVenue={openVenue} onOpenTicket={openTicket} />)} />

        <Section hidden={!showCategory("clubs")} icon="comment" tint={colors.magenta} title="FAN CLUBS" count={clubs.length}
          rows={clubRows.map((c) => (
            <Pressable key={"fc_" + c.artist} style={styles.row} onPress={() => onOpenFanClub?.(c.artist)} accessibilityRole="button" accessibilityLabel={`Open ${c.artist} fan club${c.members > 0 ? `, ${c.members} members` : ""}`}>
              <View style={[styles.dot, { borderColor: colors.magenta }]}><Icon name="comment" size={14} color={colors.magenta} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{c.artist} fan club</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{c.members > 0 ? `${c.members} members` : "Be the first to join"}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textDim} />
            </Pressable>
          ))}
        />

        {!visibleSearchError && visibleResultState === "no-results" && (
          <Text style={styles.empty}>No {activeCategory === "all" ? "matches" : activeCategoryLabel.toLowerCase()} for “{q}”.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  songArt: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  wrap: { flex: 1, backgroundColor: colors.bg },
  header: { padding: 16, paddingBottom: 12 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  fieldFocused: { borderColor: colors.amber },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 13 },
  fieldAction: { width: 44, height: 44, marginRight: -12, alignItems: "center", justifyContent: "center" },
  categoryRail: { gap: 8, paddingTop: 10, paddingRight: 8 },
  categoryChip: { minHeight: 36, justifyContent: "center", paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  categoryChipSelected: { borderColor: colors.amber, backgroundColor: colors.bgElev },
  categoryChipText: { color: colors.textDim, fontSize: 12, fontWeight: "700" },
  categoryChipTextSelected: { color: colors.amber, fontWeight: "900" },
  resultStatus: { color: colors.textDim, fontSize: 11.5, lineHeight: 17, marginTop: 7, paddingHorizontal: 2 },
  resultError: { color: colors.danger },
  retrySearch: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center", marginTop: 2, paddingHorizontal: 2 },
  retrySearchText: { color: colors.amber, fontSize: 12, fontWeight: "800" },

  list: { paddingHorizontal: 16, paddingBottom: 32, maxWidth: 640, width: "100%", alignSelf: "center" },
  browseHint: { color: colors.textDim, fontSize: 12, marginBottom: 8, fontWeight: "600" },
  loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, paddingVertical: 14 },
  loadingText: { color: colors.textDim, fontSize: 12.5, fontWeight: "600" },

  section: { marginBottom: 18 },
  recentHead: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4, paddingBottom: 6, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  clearAction: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  clearTxt: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  secHead: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4, paddingBottom: 6, marginBottom: 2, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  secTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", flex: 1 },
  secCount: { color: colors.amber, fontFamily: mono, fontSize: 12, fontWeight: "800" },

  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 4, borderRadius: radius.sm },
  rowMain: { flex: 1, minWidth: 0, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 4 },
  secondaryAction: { width: 44, height: 44, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgElev, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowName: { color: colors.text, fontSize: 14.5, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 11.5, marginTop: 1 },
  pill: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, minWidth: 22, paddingHorizontal: 7, paddingVertical: 1, alignItems: "center" },
  pillTxt: { color: colors.amber, fontSize: 11, fontWeight: "800" },
  memorialPill: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: `${colors.gold}66`, backgroundColor: `${colors.gold}12` },
  memorialPillText: { color: colors.gold, fontFamily: mono, fontSize: 8, lineHeight: 11, letterSpacing: 0.7, fontWeight: "900" },
  soldOut: { color: colors.danger, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", padding: 12, textAlign: "center" },
  followBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  followTxt: { color: "#1A1206", fontSize: 12.5, fontWeight: "800" },
  followingBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.line },
  followingTxt: { color: colors.textDim },
});
