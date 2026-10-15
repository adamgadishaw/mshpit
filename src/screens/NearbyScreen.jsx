import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, radius } from "../theme";
import { useStore } from "../store";
import { GEO } from "../geo";
import { cityCoords } from "../data";
import LocationPicker from "../components/LocationPicker";
import DatePicker from "../components/DatePicker";
import ScreenHeader from "../components/ScreenHeader";
import { NearbyShowRow, NearbyVenueRow } from "../components/NearbyFinderRows";
import VinylRefreshBoundary from "../components/VinylRefreshBoundary";
import { refreshScope } from "../domain/scopedRefresh.mjs";
import { mapCoordinate } from "../domain/mapCoordinates.mjs";
import { nearbyInitialTab, nearbyLocationPrompt } from "../domain/nearbyEntry.mjs";
import { nearbyManualCenter, nearbyPlaceMatches, nearbyShowResults, nearbyToday } from "../domain/nearbyShowFinder.mjs";
import useScopedRefresh from "../hooks/useScopedRefresh";
const RADII = [25, 50, 75, 150];
const FILTERS = [["all", "All dates"], ["tonight", "Tonight"], ["weekend", "This weekend"], ["date", "Pick a date"]];
function Choice({
  label,
  selected,
  onPress
}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{
    selected
  }} style={({
    focused
  }) => [styles.choice, selected && styles.choiceOn, focused && focusRing]}><Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{label}</Text></Pressable>;
}
export default function NearbyScreen({
  onClose,
  onOpenVenue,
  onOpenArtist,
  onOpenEvent,
  initialTab,
  initialSelection,
  onSelectionChange
}) {
  const {
    session,
    localVenues,
    regionShows,
    refreshTourDates,
    tourDates,
    searchVenues
  } = useStore();
  const [center, setCenter] = useState(initialSelection?.center || session?.home || null),
    [km, setKm] = useState(initialSelection?.km || 75);
  const [tab, setTab] = useState(() => nearbyInitialTab(initialTab || initialSelection?.tab));
  useEffect(() => {
    if (initialTab) setTab(nearbyInitialTab(initialTab));
  }, [initialTab]);
  const [mode, setMode] = useState(initialSelection?.mode || "all"),
    [picked, setPicked] = useState(initialSelection?.picked || ""),
    [pickingDate, setPickingDate] = useState(false),
    [pickingCity, setPickingCity] = useState(false),
    [refreshError, setRefreshError] = useState(false),
    [now, setNow] = useState(Date.now);
  const started = useRef(false);
  useEffect(() => { onSelectionChange?.({ center, km, tab, mode, picked }); }, [center, km, tab, mode, picked, onSelectionChange]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const nearbyRefreshScope = refreshScope(session?.id, "nearby", [center?.lat, center?.lng, center?.city, km].join(":"));
  const {
    refresh: refreshNearby,
    refreshing
  } = useScopedRefresh({
    scope: nearbyRefreshScope,
    task: async ({
      signal
    }) => {
      setRefreshError(false);
      return refreshTourDates({
        signal
      });
    },
    onError: () => setRefreshError(true)
  });
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void refreshNearby();
    }
  }, [refreshNearby]);
  const hasCoords = !!mapCoordinate(center),
    hasCity = !!center?.city?.trim();
  const results = useMemo(() => {
    if (!hasCity) return {
      venues: [],
      shows: []
    };
    if (hasCoords) return {
      venues: localVenues(km, center),
      shows: regionShows(km, center)
    };
    return {
      venues: searchVenues(center.city, 500).filter(v => nearbyPlaceMatches(v, center)),
      shows: tourDates.filter(e => nearbyPlaceMatches(e, center))
    };
  }, [center, km, hasCity, hasCoords, localVenues, regionShows, searchVenues, tourDates]);
  const shows = useMemo(() => nearbyShowResults(results.shows, {
    mode,
    picked,
    now
  }), [results.shows, mode, picked, now]);
  const data = tab === "shows" ? shows : results.venues,
    locationPrompt = nearbyLocationPrompt(center);
  if (pickingCity) return <LocationPicker onClose={() => setPickingCity(false)} onSelect={place => {
    setCenter(nearbyManualCenter(place, GEO, cityCoords));
    setPickingCity(false);
  }} />;
  return <View style={styles.wrap}><ScreenHeader title="Near you" onBack={onClose} /><VinylRefreshBoundary refreshing={refreshing} onRefresh={refreshNearby} accessibilityLabel="Refresh nearby shows and venues"><FlatList key={tab} data={data} keyExtractor={item => String(item.id || item.name)} initialNumToRender={7} maxToRenderPerBatch={7} windowSize={5} showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} ItemSeparatorComponent={() => <View style={{
        height: 10
      }} />} renderItem={({
        item
      }) => tab === "shows" ? <NearbyShowRow event={item} onOpenArtist={onOpenArtist} onOpenVenue={onOpenVenue} onOpenEvent={onOpenEvent} /> : <NearbyVenueRow venue={item} onOpenVenue={onOpenVenue} />} ListHeaderComponent={<View style={styles.header}>
      <Text style={styles.heading}>{hasCity ? "Find shows near " + center.city : "Find your next show"}</Text>
      <View style={styles.controls}><Choice label={center?.label || center?.city || "Choose a city"} onPress={() => setPickingCity(true)} />{hasCoords ? <View style={styles.choices}>{RADII.map(value => <Choice key={value} label={value + " km"} selected={km === value} onPress={() => setKm(value)} />)}</View> : null}</View>
      {hasCity && !hasCoords ? <Text style={styles.caption}>City results · distance unavailable</Text> : null}
      <View style={styles.choices}><Choice label={"Shows (" + shows.length + ")"} selected={tab === "shows"} onPress={() => setTab("shows")} /><Choice label={"Venues (" + results.venues.length + ")"} selected={tab === "venues"} onPress={() => setTab("venues")} /></View>
      {tab === "shows" ? <><View style={styles.choices}>{FILTERS.map(([value, label]) => <Choice key={value} label={value === "date" && mode === "date" ? picked : label} selected={mode === value} onPress={() => {
              setMode(value);
              if (value === "date" && !picked) setPicked(nearbyToday(now, results.shows.find(e => e.eventTimezone)?.eventTimezone || "UTC"));
              setPickingDate(value === "date");
            }} />)}</View>{pickingDate ? <View style={styles.picker}><DatePicker value={picked} onChange={setPicked} years={[new Date(now).getUTCFullYear(), new Date(now).getUTCFullYear() + 1, new Date(now).getUTCFullYear() + 2]} accessibilityLabel="Show date" /><Choice label="Done" onPress={() => setPickingDate(false)} /></View> : null}</> : null}
      {refreshError ? <View><Text style={styles.error} accessibilityRole="alert">Could not refresh. Showing available results.</Text><Choice label="Try again" onPress={refreshNearby} /></View> : null}
      {refreshing ? <View style={styles.loading}><ActivityIndicator size="small" color={colors.amber} /><Text style={styles.caption}>Updating shows…</Text></View> : null}
      {tab === "shows" && shows.some(e => !e.eventTimezone) ? <Text style={styles.caption}>Dates use venue time; UTC where unavailable.</Text> : null}
    </View>} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>{!hasCity ? locationPrompt.title : refreshing ? "Finding shows…" : tab === "shows" ? "No shows for these filters" : "No venues listed here yet"}</Text><Text style={styles.caption}>{!hasCity ? locationPrompt.body : tab === "shows" ? "Try all dates, a wider distance or another city." : "Try a wider distance or another city."}</Text>{hasCity && tab === "shows" && mode !== "all" ? <Choice label="Show all dates" onPress={() => {
          setMode("all");
          setPickingDate(false);
        }} /> : null}</View>} /></VinylRefreshBoundary></View>;
}
const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg
  },
  content: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingBottom: 56
  },
  header: {
    gap: 12,
    paddingTop: 18,
    paddingBottom: 18
  },
  heading: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 25,
    lineHeight: 31,
    fontWeight: "900"
  },
  controls: {
    gap: 10
  },
  choices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  choice: {
    minHeight: 44,
    paddingHorizontal: 13,
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgElev,
    alignSelf: "flex-start"
  },
  choiceOn: {
    borderColor: colors.amber,
    backgroundColor: colors.surface
  },
  choiceText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "700"
  },
  choiceTextOn: {
    color: colors.amber
  },
  caption: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18
  },
  error: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18
  },
  loading: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center"
  },
  picker: {
    padding: 12,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    gap: 10
  },
  empty: {
    paddingVertical: 24,
    gap: 10
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700"
  }
});
