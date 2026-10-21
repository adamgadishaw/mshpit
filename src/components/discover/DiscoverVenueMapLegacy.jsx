import { useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, font, mono, radius, space } from "../../theme";
import { HAS_MAP, MAP_PROVIDER, mapStaticUrl } from "../../mapConfig";
import { clusterDiscoverVenuePins, discoverVenueMap } from "../../domain/discoverVenues.mjs";
import { discoverVenueMapPoints } from "../../domain/discoverVenueExplorer.mjs";
import Icon from "../Icon";
const feedback = ({ pressed, hovered, focused }) => [hovered && styles.hover, pressed && styles.pressed, focused && focusRing];
export default function DiscoverVenueMapLegacy({ venues, selected, onSelect, city }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const [mapSize, setMapSize] = useState({ width: 640, height: 420 });
  const { points, mappedCount, unmappedCount } = useMemo(() => discoverVenueMapPoints(venues, selected), [venues, selected]);
  const projection = useMemo(() => discoverVenueMap(points), [points]);
  const url = projection && HAS_MAP ? mapStaticUrl(projection.center, MAP_PROVIDER === "mapbox" ? Math.max(0, projection.zoom - 1) : projection.zoom, projection.width, projection.height)
    .replace("attribution=false&logo=false", "attribution=true&logo=true") : null;
  const showMap = !!url && failedUrl !== url;
  // Group overlapping touch targets at the actual rendered size, not only
  // identical coordinates. Repeated taps cycle rooms; the list is equivalent.
  const clusters = useMemo(() => clusterDiscoverVenuePins(points, projection, mapSize), [points, projection, mapSize]);
  const measureMap = ({ nativeEvent }) => {
    const width = Math.round(nativeEvent.layout.width), height = Math.round(nativeEvent.layout.height);
    if (!(width > 0 && height > 0)) return;
    setMapSize(current => current.width === width && current.height === height ? current : { width, height });
  };
  return <View>
    <View style={[styles.map, !points.length && styles.unmapped]} onLayout={measureMap} accessibilityLabel={`Venue locations in ${city}`}>
      {showMap ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="stretch" onError={() => setFailedUrl(url)} accessibilityLabel={`Street map of ${city}`} />
        : <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {[20, 40, 60, 80].map(offset => <View key={`h${offset}`} style={[styles.gridLine, { top: `${offset}%`, left: 0, right: 0, height: 1 }]} />)}
          {[20, 40, 60, 80].map(offset => <View key={`v${offset}`} style={[styles.gridLine, { left: `${offset}%`, top: 0, bottom: 0, width: 1 }]} />)}
          <Text style={styles.plotLabel}>{projection ? "LOCATION PLOT · STREET MAP UNAVAILABLE" : "VENUE COORDINATES NOT YET AVAILABLE"}</Text>
        </View>}
      {clusters.map(({ venues: group, position }) => {
        const active = group.some(row => row.id === selected);
        const venue = group.find(row => row.id === selected) || group[0];
        const number = venues.findIndex(row => row.id === venue.id) + 1;
        return <Pressable key={group[0].id} onPress={() => onSelect(group[(group.findIndex(row => row.id === selected) + 1) % group.length].id)}
          accessibilityRole="button" accessibilityLabel={`Map pin ${number}: ${group.map(row => row.name).join(", ")}${group.length > 1 ? ". Tap to cycle venues" : ""}`}
          accessibilityState={{ selected: active }} aria-pressed={active} accessibilityHint="Selects this venue in the list and shows its upcoming concerts."
          title={group.map(row => row.name).join(" · ")}
          style={state => [styles.pinTarget, { left: `${position.x * 100}%`, top: `${position.y * 100}%`, zIndex: active ? 2 : 1 }, ...feedback(state)]}>
          <View style={[styles.pin, active && styles.pinSelected]}><Text style={[styles.pinText, active && styles.pinTextSelected]}>{group.length > 1 ? `${group.length}×` : number}</Text></View>
        </Pressable>;
      })}
    </View>
    <View style={styles.mapCaption}><Icon name="pin" size={14} color={colors.textDim} /><Text style={[styles.small, { flex: 1 }]}>{points.length} venues plotted{mappedCount > points.length ? ` of ${mappedCount} with locations` : ""}{unmappedCount ? ` · ${unmappedCount} awaiting a map location` : ""}. {points.length ? "Select a numbered pin or venue below. Grouped pins cycle through nearby venues." : "You can still view venue details and shows below."}</Text></View>
  </View>;
}

const styles=StyleSheet.create({
  map: { width: "100%", aspectRatio: 640 / 420, backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden", position: "relative" }, unmapped: { aspectRatio: undefined, minHeight: 120 },
  mapCaption: { flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }, gridLine: { position: "absolute", backgroundColor: colors.lineSoft }, plotLabel: { position: "absolute", bottom: 12, left: 12, right: 12, fontSize: 9, fontFamily: mono, color: colors.textFaint },
  pinTarget: { position: "absolute", width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: "center", justifyContent: "center", borderRadius: radius.pill }, pin: { width: 29, height: 29, borderRadius: radius.pill, backgroundColor: colors.bgElev, borderColor: colors.amber, borderWidth: 1, alignItems: "center", justifyContent: "center" }, pinSelected: { width: 36, height: 36, borderWidth: 3, backgroundColor: colors.amber }, pinText: { fontFamily: mono, fontSize: 11, color: colors.text, fontWeight: "800" }, pinTextSelected: { color: colors.bgElev },
  small:{fontFamily:font,fontSize:12,lineHeight:18,color:colors.textDim}, hover:{backgroundColor:colors.surfaceAlt}, pressed:{opacity:.8}
});
