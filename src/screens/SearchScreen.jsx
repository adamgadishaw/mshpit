import { useMemo, useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import { ratedShows } from "../data";
import { ingestedArtists } from "../seed/ingested";
import { useStore } from "../store";
import Icon from "../components/Icon";
import { BadgeRow } from "../components/Badge";

// Type → icon + accent, so a mixed result list still reads at a glance.
const KIND = {
  artist: { icon: "music", color: colors.amber, tag: "Artist" },
  venue: { icon: "pin", color: colors.cool, tag: "Venue" },
  event: { icon: "calendar", color: colors.gold, tag: "Event" },
  club: { icon: "comment", color: colors.magenta, tag: "Fan club" },
};

// One dropdown row — a matched result of any type.
function ResultRow({ r, onPress }) {
  const k = KIND[r.kind];
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.dot, { borderColor: k.color }]}><Icon name={k.icon} size={14} color={k.color} /></View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameLine}>
          <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
          {r.badges?.length ? <BadgeRow badges={r.badges} size={14} /> : null}
        </View>
        {!!r.sub && <Text style={styles.rowSub} numberOfLines={1}>{r.sub}</Text>}
      </View>
      <Text style={[styles.kindTag, { color: k.color }]}>{k.tag}</Text>
    </Pressable>
  );
}

// Search is now a single TYPEAHEAD: type characters, get one dropdown of matched
// artists / venues / events / fan clubs (prefix matches first), tap to open. No
// People column, no columns that just re-fill — a proper autocomplete. Empty state
// shows a little browse shelf so the tab is never blank.
export default function SearchScreen({ onOpenArtist, onOpenVenue, onOpenFanClub }) {
  const { tourDates, searchVenues, upcomingEvents, fanClubsDirectory, commentsFor, track,
    artistBadges, topArtists, trendingVenues } = useStore();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const query = q.trim().toLowerCase();

  // Log searches once they settle (debounced), as an ad-interest signal.
  useEffect(() => {
    if (query.length < 2) return;
    const id = setTimeout(() => track("search", { q: query }), 900);
    return () => clearTimeout(id);
  }, [query]);

  // Matched artists (from logged shows + tour dates + the ingested roster).
  const artists = useMemo(() => {
    if (!query) return [];
    const map = new Map();
    const add = (name, genre) => { const k = name.toLowerCase(); if (!map.has(k)) map.set(k, { name, genre }); };
    ratedShows.forEach((s) => s.artist.toLowerCase().includes(query) && add(s.artist, s.genre));
    tourDates.forEach((t) => t.artist.toLowerCase().includes(query) && add(t.artist, t.genre));
    Object.values(ingestedArtists).forEach((a) => a.name.toLowerCase().includes(query) && add(a.name, a.genre));
    return [...map.values()].slice(0, 40);
  }, [query, tourDates]);

  const venues = useMemo(() => (query ? searchVenues(query, 30) : []), [query, tourDates]);
  const events = useMemo(
    () => (query ? tourDates.filter((t) => `${t.artist} ${t.venue} ${t.place || t.city || ""}`.toLowerCase().includes(query)).slice(0, 25) : []),
    [query, tourDates]
  );
  const clubs = useMemo(() => {
    if (!query) return [];
    return fanClubsDirectory().filter((c) => c.artist.toLowerCase().includes(query)).slice(0, 12);
  }, [query]);

  // Merge into one ranked dropdown — startsWith matches float to the top.
  const results = useMemo(() => {
    if (!query) return [];
    const rows = [];
    artists.forEach((a) => rows.push({ kind: "artist", key: "a_" + a.name, name: a.name, sub: a.genre, badges: artistBadges(a.name), open: () => onOpenArtist?.(a.name) }));
    venues.forEach((v) => rows.push({ kind: "venue", key: "v_" + v.name, name: v.name, sub: v.place || "—", open: () => onOpenVenue?.(v.name) }));
    events.forEach((t) => rows.push({ kind: "event", key: "e_" + t.id, name: t.artist, sub: `${t.venue} · ${t.date}`, open: () => onOpenArtist?.(t.artist) }));
    clubs.forEach((c) => rows.push({ kind: "club", key: "c_" + c.artist, name: `${c.artist} fan club`, sub: c.members > 0 ? `${c.members} members` : "Be the first to join", open: () => onOpenFanClub?.(c.artist) }));
    const score = (r) => (r.name.toLowerCase().startsWith(query) ? 0 : 1);
    return rows.sort((a, b) => score(a) - score(b)).slice(0, 60);
  }, [query, artists, venues, events, clubs]);

  // Empty-state browse shelf.
  const popular = useMemo(() => topArtists(8), []);
  const venuesHot = useMemo(() => (trendingVenues ? trendingVenues(6) : []), []);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View style={[styles.field, focused && styles.fieldFocused]}>
          <Icon name="search" size={18} color={focused ? colors.amber : colors.textDim} />
          <TextInput
            style={styles.input}
            placeholder="Search artists, venues, shows, cities"
            placeholderTextColor={colors.textFaint}
            value={q}
            onChangeText={setQ}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            autoCapitalize="none"
            maxLength={80}
          />
          {!!q && <Pressable onPress={() => setQ("")} hitSlop={8}><Icon name="x" size={16} color={colors.textFaint} /></Pressable>}
        </View>
      </View>

      {query ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {results.length === 0 ? (
            <Text style={styles.empty}>No matches for “{q}”.</Text>
          ) : (
            <View style={styles.dropdown}>
              {results.map((r) => <ResultRow key={r.key} r={r} onPress={r.open} />)}
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {popular.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>POPULAR ARTISTS</Text>
              <View style={styles.dropdown}>
                {popular.map((a) => (
                  <ResultRow key={"pa_" + a.name} r={{ kind: "artist", name: a.name, sub: a.genre, badges: artistBadges(a.name) }} onPress={() => onOpenArtist?.(a.name)} />
                ))}
              </View>
            </>
          )}
          {venuesHot.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>TRENDING VENUES</Text>
              <View style={styles.dropdown}>
                {venuesHot.map((v) => (
                  <ResultRow key={"tv_" + v.name} r={{ kind: "venue", name: v.name, sub: v.place || `${v.upcoming || 0} upcoming` }} onPress={() => onOpenVenue?.(v.name)} />
                ))}
              </View>
            </>
          )}
          {popular.length === 0 && venuesHot.length === 0 && (
            <Text style={styles.empty}>Start typing to find artists, venues, shows and fan clubs.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  header: { padding: 16, paddingBottom: 12 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14 },
  fieldFocused: { borderColor: colors.amber },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 13 },

  list: { paddingHorizontal: 16, paddingBottom: 24 },
  sectionLabel: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800", marginTop: 8, marginBottom: 8, marginLeft: 4 },
  dropdown: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, overflow: "hidden", marginBottom: 8, padding: 4 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 10, borderRadius: radius.sm },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.bgElev, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowName: { color: colors.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  rowSub: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  kindTag: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6, fontFamily: mono, textTransform: "uppercase", opacity: 0.85 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", padding: 16 },
});
