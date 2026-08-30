import { useMemo, useState } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import ScreenHeader from "../components/ScreenHeader";
import Icon from "../components/Icon";
import { VenueDiscoveryCard } from "../components/VenueDiscoveryCards";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import { venueDirectoryTotals, venueHomePlaceId } from "../domain/venueDiscovery.mjs";
import { discoverRowMatchesRegion } from "../domain/discoverScene.mjs";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { countryForCity } from "../geo";
import useScopedRefresh from "../hooks/useScopedRefresh";

export default function VenuesScreen({ initialRegion = "Worldwide", onClose, onOpenVenue }) {
  const { venuesByCity, searchVenues, session, tourDates, refreshTourDates } = useStore();
  const [q, setQ] = useState("");
  const [city, setCity] = useState(null); // complete place identity, not ambiguous city text
  const [refreshError, setRefreshError] = useState(false);
  const query = q.trim();
  // The core catalog is static, but upcoming dates hydrate after mount. Rebuild
  // only when that source changes so counts/order cannot remain stuck at zero.
  const region = String(initialRegion || "Worldwide").trim() || "Worldwide";
  const cities = useMemo(() => venuesByCity().filter((entry) => discoverRowMatchesRegion({
    city: entry.city,
    place: [entry.city, entry.region].filter(Boolean).join(", "),
  }, region, { countryForCity })), [region, tourDates]);
  const totals = useMemo(() => venueDirectoryTotals(cities), [cities]);
  const homePlaceId = useMemo(() => venueHomePlaceId(session?.home, cities), [cities, session?.home]);
  const cityList = useMemo(() => {
    return cities.slice().sort((a, b) => {
      const aHome = a.id === homePlaceId;
      const bHome = b.id === homePlaceId;
      return Number(bHome) - Number(aHome) || b.upcoming - a.upcoming || b.count - a.count || a.city.localeCompare(b.city);
    });
  }, [cities, homePlaceId]);
  const selected = city ? cities.find((entry) => entry.id === city) : null;
  const venueResults = query ? searchVenues(query).filter((venue) => (
    discoverRowMatchesRegion(venue, region, { countryForCity })
  )) : [];
  const mode = query ? "search" : selected ? "city" : "cities";
  const data = mode === "search" ? venueResults : mode === "city" ? selected.venues : cityList;
  const title = mode === "search" ? "Venue search" : selected?.city || (region === "Worldwide" ? "Find venues" : `Venues in ${region}`);
  const venueRefreshTarget = [region, city || "all", query || "browse"].join(":");
  const venueRefreshScope = refreshScope(session?.id, "venue-directory", venueRefreshTarget);
  const { refresh: refreshVenues, refreshing: venuesRefreshing } = useScopedRefresh({
    scope: venueRefreshScope,
    task: async ({ signal }) => {
      setRefreshError(false);
      return refreshTourDates({ signal });
    },
    onError: () => setRefreshError(true),
  });

  const goBack = () => {
    if (query) setQ("");
    else if (selected) setCity(null);
    else onClose?.();
  };

  const renderCity = ({ item }) => {
    const isHome = item.id === homePlaceId;
    return (
      <Pressable
        style={({ pressed, hovered, focused }) => [styles.cityCard, hovered && styles.cardHover, pressed && styles.cardPressed, focused && focusRing]}
        onPress={() => setCity(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.city}, ${item.count} venues${item.upcoming ? `, ${item.upcoming} upcoming shows` : ""}`}
      >
        <View style={styles.cityMark}>
          <Text style={styles.cityInitial}>{item.city.slice(0, 2).toLocaleUpperCase()}</Text>
        </View>
        <View style={styles.cityCopy}>
          <View style={styles.cityTitleRow}>
            <Text style={styles.cityName} numberOfLines={1}>{item.city}</Text>
            {isHome ? <Text style={styles.homePill}>HOME</Text> : null}
          </View>
          <Text style={styles.cityRegion} numberOfLines={1}>{item.region || "Region unavailable"}</Text>
          <View style={styles.citySignals}>
            <Text style={styles.citySignal}>{item.count} venue{item.count === 1 ? "" : "s"}</Text>
            <View style={styles.signalDot} />
            <Text style={[styles.citySignal, item.upcoming > 0 && styles.citySignalLive]}>{item.upcoming || "No"} upcoming</Text>
          </View>
        </View>
        <Icon name="chevron-right" size={20} color={colors.textFaint} />
      </Pressable>
    );
  };

  const renderVenue = ({ item }) => <VenueDiscoveryCard venue={item} onPress={() => onOpenVenue?.(item)} />;

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="VENUES" title={title} onBack={goBack} />
      <VinylRefreshBoundary
        refreshing={venuesRefreshing}
        onRefresh={refreshVenues}
        accessibilityLabel="Refresh venues and upcoming shows"
      >
      <FlatList
        key={mode}
        data={data}
        renderItem={mode === "cities" ? renderCity : renderVenue}
        keyExtractor={(item) => mode === "cities" ? item.id : item.identity || `${item.name}|${item.place || ""}`}
        ItemSeparatorComponent={ListGap}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        ListHeaderComponent={(
          <View style={styles.headerContent}>
            {refreshError ? (
              <Text style={styles.refreshError} accessibilityRole="alert">Venues could not refresh. Your current city, search, and results are unchanged.</Text>
            ) : null}
            {mode === "cities" ? (
              <View style={styles.hero}>
                <View style={styles.heroGlow} />
                <Text style={styles.eyebrow}>YOUR NEXT FAVOURITE ROOM</Text>
                <Text style={styles.heroTitle}>Find the stage before the lights go down.</Text>
                <Text style={styles.heroBody}>Explore rooms by city, see where shows are landing, and learn which venues fans trust.</Text>
                <View style={styles.statsRow}>
                  <DirectoryStat value={totals.venues} label="VENUES" />
                  <DirectoryStat value={totals.cities} label="CITIES" />
                  <DirectoryStat value={totals.upcoming} label="SHOWS AHEAD" accent />
                </View>
              </View>
            ) : null}

            <View style={styles.searchField}>
              <Icon name="search" size={19} color={colors.textDim} />
              <TextInput
                style={styles.input}
                placeholder="Search venues or cities"
                placeholderTextColor={colors.textFaint}
                value={q}
                onChangeText={setQ}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={80}
                returnKeyType="search"
                accessibilityLabel="Search venues or cities"
              />
              {q ? (
                <Pressable style={styles.clearButton} onPress={() => setQ("")} accessibilityRole="button" accessibilityLabel="Clear venue search">
                  <Icon name="x" size={16} color={colors.textDim} />
                </Pressable>
              ) : null}
            </View>

            {mode === "city" ? (
              <View style={styles.cityOverview}>
                <View style={styles.overviewIcon}><Icon name="map" size={22} color={colors.amber} /></View>
                <View style={styles.cityCopy}>
                  <Text style={styles.overviewTitle}>{selected.city}</Text>
                  <Text style={styles.overviewBody}>{selected.region || "Region unavailable"} · {selected.count} venue{selected.count === 1 ? "" : "s"}</Text>
                </View>
                {selected.upcoming > 0 ? <Text style={styles.overviewUpcoming}>{selected.upcoming} shows ahead</Text> : null}
              </View>
            ) : null}

            <View style={styles.sectionHead}>
              <View>
                <Text style={styles.sectionKicker}>{mode === "cities" ? "CITY GUIDE" : mode === "search" ? "SEARCH RESULTS" : "ROOMS TO EXPLORE"}</Text>
                <Text style={styles.sectionTitle}>{mode === "cities" ? "Browse the live-music map" : `${data.length} ${data.length === 1 ? "venue" : "venues"}`}</Text>
              </View>
              {mode === "search" ? <Text style={styles.queryLabel} numberOfLines={1}>“{query}”</Text> : null}
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Icon name="search" size={24} color={colors.textFaint} /></View>
            <Text style={styles.emptyTitle}>No venues found</Text>
            <Text style={styles.emptyBody}>Try a city, neighbourhood, or a shorter venue name.</Text>
            {query ? <Pressable style={styles.emptyAction} onPress={() => setQ("")}><Text style={styles.emptyActionText}>Clear search</Text></Pressable> : null}
          </View>
        )}
      />
      </VinylRefreshBoundary>
    </View>
  );
}

function DirectoryStat({ value, label, accent = false }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, accent && styles.statValueAccent]}>{Number(value || 0).toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ListGap() {
  return <View style={styles.listGap} />;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { width: "100%", maxWidth: 980, alignSelf: "center", paddingHorizontal: 16, paddingBottom: 56 },
  headerContent: { gap: 16, paddingTop: 12, paddingBottom: 14 },
  refreshError: { color: colors.danger, fontSize: 12.5, lineHeight: 18 },
  hero: { minHeight: 250, justifyContent: "flex-end", overflow: "hidden", padding: 24, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  heroGlow: { position: "absolute", width: 300, height: 300, borderRadius: 150, top: -170, right: -55, backgroundColor: colors.amber, opacity: 0.13, ...Platform.select({ web: { filter: "blur(12px)" } }) },
  eyebrow: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 },
  heroTitle: { maxWidth: 620, color: colors.text, fontFamily: displayFont, fontSize: 30, lineHeight: 34, fontWeight: "900", letterSpacing: -0.8, marginTop: 8 },
  heroBody: { maxWidth: 620, color: colors.textDim, fontSize: 14, lineHeight: 21, marginTop: 8 },
  statsRow: { flexDirection: "row", alignItems: "stretch", gap: 8, marginTop: 22 },
  stat: { flex: 1, minWidth: 0, padding: 11, borderRadius: radius.sm, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  statValue: { color: colors.text, fontFamily: mono, fontSize: 20, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statValueAccent: { color: colors.amber },
  statLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "800", letterSpacing: 0.8, marginTop: 3 },
  searchField: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 15, paddingRight: 6, backgroundColor: colors.surface, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, ...shadow.control },
  input: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, paddingVertical: 13 },
  clearButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  cityOverview: { minHeight: 78, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  overviewIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line },
  overviewTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900" },
  overviewBody: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  overviewUpcoming: { color: colors.amber, fontFamily: mono, fontSize: 11, fontWeight: "800" },
  sectionHead: { minHeight: 48, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingTop: 4 },
  sectionKicker: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900", marginTop: 3 },
  queryLabel: { maxWidth: "45%", color: colors.amber, fontSize: 12, fontStyle: "italic" },
  cityCard: { minHeight: 94, flexDirection: "row", alignItems: "center", gap: 13, padding: 15, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, ...shadow.card, ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "background-color, border-color, transform" } }) },
  cityMark: { width: 54, height: 54, borderRadius: 18, borderCurve: "continuous", alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber },
  cityInitial: { color: colors.amber, fontFamily: mono, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },
  cityCopy: { flex: 1, minWidth: 0 },
  cityTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  cityName: { flexShrink: 1, color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900" },
  homePill: { color: "#1A1206", fontFamily: mono, fontSize: 7, fontWeight: "900", letterSpacing: 0.7, paddingHorizontal: 7, paddingVertical: 3, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.amberStrong },
  cityRegion: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  citySignals: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 8 },
  citySignal: { color: colors.textFaint, fontFamily: mono, fontSize: 10 },
  citySignalLive: { color: colors.amber, fontWeight: "800" },
  signalDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.line },
  cardHover: { backgroundColor: colors.surfaceAlt, borderColor: colors.line },
  cardPressed: { transform: [{ scale: 0.99 }], opacity: 0.9 },
  listGap: { height: 10 },
  emptyCard: { alignItems: "center", justifyContent: "center", padding: 28, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev, marginBottom: 12 },
  emptyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900" },
  emptyBody: { color: colors.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 },
  emptyAction: { minHeight: 42, justifyContent: "center", paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, marginTop: 14 },
  emptyActionText: { color: colors.amber, fontFamily: displayFont, fontSize: 13, fontWeight: "800" },
});
