import { useMemo, useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, Linking } from "react-native";
import { colors, mono, radius } from "../theme";
import { ratedShows } from "../data";
import { ingestedArtists } from "../seed/ingested";
import { useStore } from "../store";
import Stars from "../components/Stars";
import Icon from "../components/Icon";

// ---- compact rows shared by the panes ----
function ArtistRow({ name, genre, onPress }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.dot, { borderColor: colors.amber }]}><Icon name="music" size={14} color={colors.amber} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
        {!!genre && <Text style={styles.rowSub} numberOfLines={1}>{genre}</Text>}
      </View>
      <Icon name="chevron-right" size={16} color={colors.textDim} />
    </Pressable>
  );
}
function VenueRow({ v, onPress }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.dot, { borderColor: colors.cool }]}><Icon name="pin" size={14} color={colors.cool} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>{v.name}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{v.place || "—"}</Text>
      </View>
      {v.upcoming > 0 && <View style={styles.pill}><Text style={styles.pillTxt}>{v.upcoming}</Text></View>}
    </Pressable>
  );
}
function EventRow({ t, onOpenArtist, onOpenVenue }) {
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { borderColor: colors.line }]}><Icon name="calendar" size={14} color={colors.amber} /></View>
      <Pressable style={{ flex: 1 }} onPress={() => onOpenArtist?.(t.artist)}>
        <Text style={styles.rowName} numberOfLines={1}>{t.artist}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          <Text style={styles.link} onPress={() => onOpenVenue?.(t.venue)}>{t.venue}</Text> · {t.date}
        </Text>
      </Pressable>
      {t.soldOut
        ? <Text style={styles.soldOut}>SOLD</Text>
        : <Pressable onPress={() => Linking.openURL(t.ticketUrl)} hitSlop={6}><Icon name="external" size={15} color={colors.amber} /></Pressable>}
    </View>
  );
}

export default function SearchScreen({ onOpen, onOpenArtist, onOpenVenue, onOpenFanClub }) {
  const { tourDates, searchVenues, artistsAlphabetical, venuesByCity, upcomingEvents, fanClubsDirectory, commentsFor, track } = useStore();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [w, setW] = useState(0);
  const [activePane, setActivePane] = useState("artists"); // mobile: which category
  const query = q.trim().toLowerCase();

  // Log searches once they settle (debounced), as an ad-interest signal.
  useEffect(() => {
    if (query.length < 2) return;
    const id = setTimeout(() => track("search", { q: query }), 900);
    return () => clearTimeout(id);
  }, [query]);

  const artists = useMemo(() => {
    if (!query) return artistsAlphabetical(400).map((a) => ({ name: a.name, genre: a.genre }));
    const map = new Map();
    const add = (name, genre) => { const k = name.toLowerCase(); if (!map.has(k)) map.set(k, { name, genre }); };
    ratedShows.forEach((s) => s.artist.toLowerCase().includes(query) && add(s.artist, s.genre));
    tourDates.forEach((t) => t.artist.toLowerCase().includes(query) && add(t.artist, t.genre));
    Object.values(ingestedArtists).forEach((a) => a.name.toLowerCase().includes(query) && add(a.name, a.genre));
    return [...map.values()].slice(0, 200);
  }, [query, tourDates]);

  const venues = useMemo(() => {
    if (query) return searchVenues(query, 200);
    return venuesByCity().flatMap((c) => c.venues); // whole catalog, grouped order
  }, [query, tourDates]);

  const events = useMemo(() => {
    if (query) return tourDates.filter((t) => `${t.artist} ${t.venue} ${t.place || t.city || ""}`.toLowerCase().includes(query));
    return upcomingEvents(300);
  }, [query, tourDates]);

  // Community: fan clubs + afterparties, searchable instead of buried inside
  // artist/show pages.
  const clubs = useMemo(() => {
    const dir = fanClubsDirectory();
    if (!query) return dir;
    const seen = new Set(dir.map((c) => c.artist.toLowerCase()));
    const extra = artists
      .filter((a) => !seen.has(a.name.toLowerCase()))
      .map((a) => ({ artist: a.name, members: 0, messages: 0 }));
    return [...dir.filter((c) => c.artist.toLowerCase().includes(query)), ...extra].slice(0, 60);
  }, [query, artists]);

  const afterparties = useMemo(() => {
    const list = query
      ? ratedShows.filter((s) => `${s.artist} ${s.venue} ${s.city}`.toLowerCase().includes(query))
      : ratedShows.filter((s) => commentsFor(s.id).length > 0 || s.reviews > 100);
    return list.slice(0, 40);
  }, [query]);

  const wide = w >= 720; // enough room for side-by-side panes

  const panes = [
    { key: "artists", title: "ARTISTS", count: artists.length, empty: "No artists match.",
      rows: artists.map((a) => <ArtistRow key={a.name} name={a.name} genre={a.genre} onPress={() => onOpenArtist?.(a.name)} />) },
    { key: "venues", title: "VENUES", count: venues.length, empty: "No venues match.",
      rows: venues.map((v) => <VenueRow key={v.name} v={v} onPress={() => onOpenVenue?.(v.name)} />) },
    { key: "events", title: "EVENTS", count: events.length, empty: "No upcoming dates.",
      rows: events.map((t) => <EventRow key={t.id} t={t} onOpenArtist={onOpenArtist} onOpenVenue={onOpenVenue} />) },
    { key: "community", title: "COMMUNITY", count: clubs.length + afterparties.length, empty: "No clubs or afterparties match.",
      rows: [
        ...clubs.map((c) => (
          <Pressable key={"fc_" + c.artist} style={styles.row} onPress={() => onOpenFanClub?.(c.artist)}>
            <View style={[styles.dot, { borderColor: colors.amber }]}><Icon name="comment" size={14} color={colors.amber} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>{c.artist} fan club</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{c.members > 0 ? `${c.members} members` : "Be the first to join"}{c.messages ? ` · ${c.messages} msgs` : ""}</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        )),
        ...afterparties.map((s) => (
          <Pressable
            key={"ap_" + s.id}
            style={styles.row}
            onPress={() => onOpen?.({
              id: s.id, user: { name: "Community", handle: "pit", initials: "PT" }, timeAgo: "aggregate",
              artist: s.artist, venue: s.venue, city: s.city, date: "2026 · tour", media: 0, overall: s.rating,
              band: s.band, room: s.room, review: `Aggregate of ${s.reviews} logs.`, setlist: s.setlist || [],
              likes: s.reviews, comments: commentsFor(s.id).length, inTourWindow: false,
            })}
          >
            <View style={[styles.dot, { borderColor: colors.magenta }]}><Icon name="star" size={14} color={colors.magenta} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>{s.artist} afterparty</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{s.venue} · {commentsFor(s.id).length || s.reviews} talking</Text>
            </View>
            <Icon name="chevron-right" size={16} color={colors.textDim} />
          </Pressable>
        )),
      ] },
  ];

  const active = panes.find((p) => p.key === activePane) || panes[0];

  return (
    <View style={styles.wrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={styles.header}>
        <View style={[styles.field, focused && styles.fieldFocused]}>
          <Icon name="search" size={18} color={focused ? colors.amber : colors.textDim} />
          <TextInput
            style={styles.input}
            placeholder="Search artists, venues, cities"
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

      {wide ? (
        // Desktop: side-by-side panes, each scrolling independently.
        <View style={[styles.panes, styles.panesRow]}>
          {panes.map((p) => (
            <View key={p.key} style={[styles.pane, styles.paneWide]}>
              <View style={styles.paneHead}>
                <Text style={styles.paneTitle}>{p.title}</Text>
                <Text style={styles.paneCount}>{p.count}</Text>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.paneBody} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {p.rows.length === 0 ? <Text style={styles.empty}>{p.empty}</Text> : p.rows}
              </ScrollView>
            </View>
          ))}
        </View>
      ) : (
        // Mobile: a segmented control picks the category; ONE list scrolls the page.
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabsScroll}
            contentContainerStyle={styles.tabs}
            keyboardShouldPersistTaps="handled"
          >
            {panes.map((p) => {
              const on = p.key === active.key;
              return (
                <Pressable key={p.key} style={[styles.tab, on && styles.tabOn]} onPress={() => setActivePane(p.key)}>
                  <Text style={[styles.tabTxt, on && styles.tabTxtOn]}>{p.title}</Text>
                  <View style={[styles.tabCount, on && styles.tabCountOn]}><Text style={[styles.tabCountTxt, on && styles.tabCountTxtOn]}>{p.count}</Text></View>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.mobileList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {active.rows.length === 0 ? <Text style={styles.empty}>{active.empty}</Text> : active.rows}
          </ScrollView>
        </>
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

  panes: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  panesRow: { flexDirection: "row", gap: 12 },

  // mobile segmented control + single list
  tabsScroll: { flexGrow: 0, flexShrink: 0 }, // don't stretch to fill column height
  tabs: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  tab: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.amberStrong, borderColor: colors.amberStrong },
  tabTxt: { color: colors.textDim, fontSize: 12.5, fontWeight: "800", letterSpacing: 0.5 },
  tabTxtOn: { color: "#1A1206" },
  tabCount: { backgroundColor: colors.bgElev, borderRadius: radius.pill, minWidth: 20, paddingHorizontal: 6, paddingVertical: 1, alignItems: "center" },
  tabCountOn: { backgroundColor: "rgba(26,18,6,0.18)" },
  tabCountTxt: { color: colors.textDim, fontSize: 11, fontWeight: "800", fontFamily: mono },
  tabCountTxtOn: { color: "#1A1206" },
  mobileList: { paddingHorizontal: 16, paddingBottom: 24 },
  pane: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineSoft, overflow: "hidden" },
  paneWide: { flex: 1 },
  paneTall: { height: 320 },
  paneHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, backgroundColor: colors.bgElev },
  paneTitle: { color: colors.textFaint, fontSize: 11, letterSpacing: 1.5, fontWeight: "800" },
  paneCount: { color: colors.amber, fontFamily: mono, fontSize: 12, fontWeight: "800" },
  paneBody: { padding: 8 },

  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 9, borderRadius: radius.sm },
  dot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.bgElev, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowName: { color: colors.text, fontSize: 14, fontWeight: "700" },
  rowSub: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  link: { color: colors.text, fontWeight: "700" },
  pill: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.pill, minWidth: 22, paddingHorizontal: 7, paddingVertical: 1, alignItems: "center" },
  pillTxt: { color: colors.amber, fontSize: 11, fontWeight: "800" },
  soldOut: { color: colors.danger, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  empty: { color: colors.textDim, fontSize: 13, fontStyle: "italic", padding: 12 },
});
