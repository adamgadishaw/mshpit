import { useState } from "react";
import { FlatList, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../theme";
import { useStore } from "../store";
import Icon from "../components/Icon";
import ConcertMap from "../components/ConcertMap";
import LocationPicker from "../components/LocationPicker";
import ScreenHeader from "../components/ScreenHeader";
import { UpcomingEventCard, VenueDiscoveryCard } from "../components/VenueDiscoveryCards";
import { nearestMapPoints } from "../domain/venueDiscovery.mjs";

const RADII = [25, 50, 75, 150];
const MAP_POINT_LIMIT = 60;

export default function NearbyScreen({ onClose, onOpenVenue, onOpenArtist }) {
  const { session, localVenues, regionShows, venueSummary, locationCenter } = useStore();
  const [center, setCenter] = useState(session?.home || null);
  const [km, setKm] = useState(75);
  const [tab, setTab] = useState("venues");
  const [pickingCity, setPickingCity] = useState(false);

  if (pickingCity) {
    return (
      <LocationPicker
        onClose={() => setPickingCity(false)}
        onSelect={(place) => {
          setCenter(locationCenter(place));
          setPickingCity(false);
        }}
      />
    );
  }

  const hasCoords = center?.lat != null && center?.lng != null;
  const venues = hasCoords ? localVenues(km, center) : [];
  const shows = hasCoords ? regionShows(km, center) : [];
  const mapPoints = nearestMapPoints(venues.map((venue) => {
    const summary = venueSummary(venue.name);
    return {
      name: venue.name,
      lat: venue.coord.lat,
      lng: venue.coord.lng,
      distanceKm: venue.distanceKm,
      photo: summary.photo || null,
      sub: venue.place || center?.city || "",
      rating: summary.avgOverall || 0,
      reviews: summary.totalShows || 0,
      capacity: summary.capacity || null,
    };
  }), MAP_POINT_LIMIT);
  const data = tab === "venues" ? venues : shows;

  const renderItem = ({ item }) => {
    if (tab === "venues") {
      const summary = venueSummary(item.name);
      return (
        <VenueDiscoveryCard
          venue={{ ...item, rating: summary.avgRoom, capacity: summary.capacity }}
          onPress={() => onOpenVenue?.(item.name)}
        />
      );
    }
    return (
      <UpcomingEventCard
        event={item}
        onOpenArtist={() => onOpenArtist?.(item.artist)}
        onOpenVenue={() => onOpenVenue?.(item.venue)}
        onTickets={() => { if (item.ticketUrl) void Linking.openURL(item.ticketUrl).catch(() => {}); }}
      />
    );
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="LOCAL LINEUP" title="Near you" onBack={onClose} />
      <FlatList
        key={tab}
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id || item.name)}
        ItemSeparatorComponent={ListGap}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        ListHeaderComponent={(
          <View style={styles.headerContent}>
            <View style={styles.locationHero}>
              <View style={styles.heroGlow} />
              <Text style={styles.eyebrow}>EXPLORE AROUND YOU</Text>
              <Text style={styles.heroTitle}>{center?.city ? `What’s playing near ${center.city}?` : "Put live music on the map."}</Text>
              <Text style={styles.heroBody}>Move the radius from neighbourhood rooms to road-trip shows. Results use the city and distance you choose.</Text>
              <Pressable
                style={({ pressed, focused }) => [styles.cityButton, pressed && styles.controlPressed, focused && focusRing]}
                onPress={() => setPickingCity(true)}
                accessibilityRole="button"
                accessibilityLabel={`Browse another city${center?.city ? `, currently ${center.city}` : ""}`}
              >
                <View style={styles.cityIcon}><Icon name="pin" size={17} color={colors.amber} /></View>
                <View style={styles.cityCopy}>
                  <Text style={styles.cityLabel}>BROWSING FROM</Text>
                  <Text style={styles.cityName}>{center?.label || center?.city || "Choose a city"}</Text>
                </View>
                <Text style={styles.changeText}>Browse another city</Text>
                <Icon name="chevron-right" size={17} color={colors.textFaint} />
              </Pressable>
            </View>

            <View accessibilityRole="radiogroup" accessibilityLabel="Search radius" style={styles.radii}>
              {RADII.map((radiusKm) => (
                <Pressable
                  key={radiusKm}
                  style={({ pressed, focused }) => [styles.radiusChip, km === radiusKm && styles.radiusChipOn, pressed && styles.controlPressed, focused && focusRing]}
                  onPress={() => setKm(radiusKm)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: km === radiusKm }}
                  accessibilityLabel={`${radiusKm} kilometre radius`}
                >
                  <Text style={[styles.radiusText, km === radiusKm && styles.radiusTextOn]}>{radiusKm}</Text>
                  <Text style={[styles.radiusUnit, km === radiusKm && styles.radiusTextOn]}>KM</Text>
                </Pressable>
              ))}
            </View>

            {!hasCoords ? (
              <View style={styles.emptyLocation}>
                <View style={styles.emptyLocationIcon}><Icon name="map" size={25} color={colors.textFaint} /></View>
                <Text style={styles.emptyTitle}>This city is not mapped yet</Text>
                <Text style={styles.emptyBody}>Choose another major city to see nearby venues and shows.</Text>
                <Pressable style={styles.chooseButton} onPress={() => setPickingCity(true)}><Text style={styles.chooseText}>Choose a city</Text></Pressable>
              </View>
            ) : (
              <>
                <View style={styles.statsRow}>
                  <LocalStat value={venues.length} label="VENUES" icon="pin" />
                  <LocalStat value={shows.length} label="UPCOMING" icon="calendar" accent />
                  <LocalStat value={km} label="KM RADIUS" icon="map" />
                </View>
                <View style={styles.mapCard}>
                  <ConcertMap points={mapPoints} highlight={{ lat: center.lat, lng: center.lng }} label={center.city} onOpenVenue={onOpenVenue} />
                  <View style={styles.mapFooter}>
                    <Icon name="map" size={14} color={colors.cool} />
                    <Text style={styles.mapCaption}>
                      {venues.length > MAP_POINT_LIMIT ? `Nearest ${MAP_POINT_LIMIT} of ${venues.length} venues shown` : `${venues.length} venue${venues.length === 1 ? "" : "s"} mapped`} · {shows.length} show{shows.length === 1 ? "" : "s"} within {km} km
                    </Text>
                  </View>
                </View>
                <View style={styles.segment} accessibilityRole="tablist">
                  <Segment label="Venues" count={venues.length} selected={tab === "venues"} onPress={() => setTab("venues")} />
                  <Segment label="Upcoming" count={shows.length} selected={tab === "shows"} onPress={() => setTab("shows")} />
                </View>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionKicker}>{tab === "venues" ? "ROOMS IN RANGE" : "YOUR LOCAL LINEUP"}</Text>
                  <Text style={styles.sectionTitle}>{tab === "venues" ? "Closest stages first" : "Shows worth leaving home for"}</Text>
                </View>
              </>
            )}
          </View>
        )}
        ListEmptyComponent={hasCoords ? (
          <View style={styles.resultsEmpty}>
            <Icon name={tab === "venues" ? "pin" : "calendar"} size={25} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{tab === "venues" ? "No venues in this radius" : "No upcoming shows in this radius"}</Text>
            <Text style={styles.emptyBody}>Try widening the search or browsing another city.</Text>
          </View>
        ) : null}
      />
    </View>
  );
}

function Segment({ label, count, selected, onPress }) {
  return (
    <Pressable
      style={({ pressed, focused }) => [styles.segmentButton, selected && styles.segmentButtonOn, pressed && styles.controlPressed, focused && focusRing]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${count}`}
    >
      <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{label}</Text>
      <View style={[styles.segmentCount, selected && styles.segmentCountOn]}><Text style={[styles.segmentCountText, selected && styles.segmentCountTextOn]}>{count}</Text></View>
    </Pressable>
  );
}

function LocalStat({ value, label, icon, accent = false }) {
  return (
    <View style={styles.stat}>
      <Icon name={icon} size={15} color={accent ? colors.amber : colors.textFaint} />
      <View>
        <Text style={[styles.statValue, accent && styles.statValueAccent]}>{Number(value || 0).toLocaleString()}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

function ListGap() {
  return <View style={styles.listGap} />;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { width: "100%", maxWidth: 980, alignSelf: "center", paddingHorizontal: 16, paddingBottom: 56 },
  headerContent: { gap: 14, paddingTop: 12, paddingBottom: 14 },
  locationHero: { overflow: "hidden", padding: 22, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  heroGlow: { position: "absolute", width: 270, height: 270, borderRadius: 135, top: -160, right: -50, backgroundColor: colors.cool, opacity: 0.14, ...Platform.select({ web: { filter: "blur(12px)" } }) },
  eyebrow: { color: colors.cool, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.7 },
  heroTitle: { maxWidth: 630, color: colors.text, fontFamily: displayFont, fontSize: 28, lineHeight: 33, fontWeight: "900", letterSpacing: -0.75, marginTop: 7 },
  heroBody: { maxWidth: 640, color: colors.textDim, fontSize: 13, lineHeight: 20, marginTop: 7 },
  cityButton: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 10, padding: 10, marginTop: 18, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, ...shadow.control },
  cityIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.amber },
  cityCopy: { flex: 1, minWidth: 0 },
  cityLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  cityName: { color: colors.text, fontFamily: displayFont, fontSize: 16, fontWeight: "900", marginTop: 2 },
  changeText: { color: colors.amber, fontSize: 12, fontWeight: "800" },
  controlPressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  radii: { flexDirection: "row", gap: 8 },
  radiusChip: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 3, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  radiusChipOn: { backgroundColor: colors.surfaceAlt, borderColor: colors.amber },
  radiusText: { color: colors.textDim, fontFamily: mono, fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
  radiusUnit: { color: colors.textFaint, fontFamily: mono, fontSize: 8, fontWeight: "800" },
  radiusTextOn: { color: colors.amber },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minWidth: 0, minHeight: 66, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, padding: 9, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  statValue: { color: colors.text, fontFamily: mono, fontSize: 17, fontWeight: "900", fontVariant: ["tabular-nums"] },
  statValueAccent: { color: colors.amber },
  statLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 7, fontWeight: "900", letterSpacing: 0.6 },
  mapCard: { overflow: "hidden", padding: 8, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  mapFooter: { minHeight: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 8 },
  mapCaption: { flexShrink: 1, color: colors.textFaint, fontFamily: mono, fontSize: 10, textAlign: "center" },
  segment: { flexDirection: "row", gap: 8, padding: 4, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  segmentButton: { flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14 },
  segmentButtonOn: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.line },
  segmentText: { color: colors.textDim, fontFamily: displayFont, fontSize: 13, fontWeight: "800" },
  segmentTextOn: { color: colors.amber },
  segmentCount: { minWidth: 24, height: 22, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, borderRadius: 11, backgroundColor: colors.bgElev },
  segmentCountOn: { backgroundColor: colors.amberStrong },
  segmentCountText: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", fontVariant: ["tabular-nums"] },
  segmentCountTextOn: { color: "#1A1206" },
  sectionHead: { paddingTop: 3 },
  sectionKicker: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900", marginTop: 3 },
  listGap: { height: 10 },
  emptyLocation: { alignItems: "center", padding: 28, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  emptyLocationIcon: { width: 54, height: 54, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: colors.bgElev, marginBottom: 12 },
  resultsEmpty: { alignItems: "center", padding: 28, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft },
  emptyTitle: { color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "900", textAlign: "center", marginTop: 9 },
  emptyBody: { maxWidth: 440, color: colors.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 5 },
  chooseButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 17, borderRadius: radius.pill, backgroundColor: colors.amberStrong, marginTop: 15 },
  chooseText: { color: "#1A1206", fontFamily: displayFont, fontSize: 13, fontWeight: "900" },
});
