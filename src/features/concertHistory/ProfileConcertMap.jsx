import { memo, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { G, Line, Path } from "react-native-svg";
import { colors, focusRing, mono, radius, space } from "../../theme";
import Icon from "../../components/Icon";
import geography from "./worldGeography.json";
import { clusterConcertMapPins, concertHistoryFrame, concertMapViewport } from "./concertHistoryModel.mjs";

const Geography = memo(function Geography({ box, highlightedCodes }) {
  const shifts = [0, ...(box.x < 0 ? [-360] : []), ...(box.x + box.width > 360 ? [360] : [])];
  return (
    <Svg width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} preserveAspectRatio="none" accessible={false}>
      {Array.from({ length: 7 }, (_, index) => <Line key={`lat-${index}`} x1={box.x} x2={box.x + box.width} y1={index * 30} y2={index * 30} stroke={colors.lineSoft} strokeWidth={box.width / 900} />)}
      {shifts.map((shift) => (
        <G key={shift} transform={`translate(${shift} 0)`}>
          {geography.countries.map((country) => <Path key={country.code} d={country.d} fill={highlightedCodes.includes(country.code) ? colors.line : colors.surfaceAlt} stroke={colors.textFaint} strokeOpacity={0.4} strokeWidth={box.width / 1100} />)}
        </G>
      ))}
    </Svg>
  );
});

function MapControl({ label, icon, onPress, disabled = false }) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [styles.control, focused && focusRing, pressed && styles.pressed, disabled && styles.disabled]}><Icon name={icon} size={17} color={colors.text} /></Pressable>;
}

export default function ProfileConcertMap({ model, selectedVenueKey, onSelectVenue, onPreviewVenue, compact = false }) {
  const [width, setWidth] = useState(360), [zoom, setZoom] = useState(1), [clusterKey, setClusterKey] = useState(null);
  const frame = useMemo(() => concertHistoryFrame(model), [model]);
  const height = compact ? 228 : 272;
  const selected = model.venues.find((venue) => venue.key === selectedVenueKey);
  const center = zoom > 1 ? selected?.coordinates : null;
  const box = useMemo(() => concertMapViewport(frame, width, height, zoom, center), [frame, width, height, zoom, center]);
  const clusters = useMemo(() => clusterConcertMapPins(model.venues, box, width, height), [model.venues, box, width, height]);
  const highlightedCodes = useMemo(() => model.countries.map((country) => country.code), [model.countries]);
  const activeCluster = clusters.find((cluster) => cluster.key === clusterKey && cluster.venues.length > 1);
  useEffect(() => { setZoom(1); setClusterKey(null); }, [frame.name]);
  const preview = (cluster) => {
    setClusterKey(cluster.key);
    if (cluster.venues.length === 1) onPreviewVenue?.(cluster.venues[0].key);
  };
  return (
    <View style={styles.panel} testID="profile-concert-map">
      <View style={styles.toolbar}>
        <View style={styles.caption}><Icon name="globe" size={15} color={colors.amber} /><Text style={styles.frameLabel}>{frame.name}</Text></View>
        <View style={styles.controls}>
          <MapControl label="Zoom out concert map" icon="minus" disabled={zoom <= 1} onPress={() => setZoom((value) => Math.max(1, value / 1.6))} />
          <MapControl label="Zoom in concert map" icon="plus" disabled={zoom >= 8} onPress={() => setZoom((value) => Math.min(8, value * 1.6))} />
          <MapControl label="Reset concert map view" icon="globe" onPress={() => { setZoom(1); setClusterKey(null); }} />
        </View>
      </View>
      <View style={[styles.canvas, { height }]} onLayout={(event) => { const next = event.nativeEvent.layout.width; if (next > 0) setWidth(next); }}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants"><Geography box={box} highlightedCodes={highlightedCodes} /></View>
        {clusters.map((cluster) => {
          const multiple = cluster.venues.length > 1, venue = cluster.venues[0];
          const selectedCluster = cluster.venues.some((entry) => entry.key === selectedVenueKey);
          const count = cluster.venues.reduce((total, entry) => total + entry.concerts.length, 0);
          const label = multiple ? `${cluster.venues.length} nearby venues, ${count} logged concerts. Choose a venue.`
            : `${venue.name}${venue.city ? `, ${venue.city}` : ""}. ${count} logged ${count === 1 ? "concert" : "concerts"}${venue.coordinates.precision === "city" ? ". Approximate city location" : ""}.`;
          return <Pressable key={cluster.key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: selectedCluster }} {...(Platform.OS === "web" ? { "aria-pressed": selectedCluster } : {})} onHoverIn={() => preview(cluster)} onFocus={() => preview(cluster)} onPress={() => { preview(cluster); if (!multiple) onSelectVenue?.(venue.key); }} style={({ pressed, focused }) => [styles.pinTarget, { left: `${cluster.xPct * 100}%`, top: `${cluster.yPct * 100}%` }, selectedCluster && styles.selectedTarget, focused && focusRing, pressed && styles.pressed]}>
            <View style={[styles.pin, selectedCluster && styles.selectedPin]}><Text style={[styles.pinCount, selectedCluster && styles.selectedPinCount]}>{multiple || count > 1 ? count : ""}</Text>{!multiple && count === 1 ? <View style={[styles.pinDot, selectedCluster && styles.selectedDot]} /> : null}</View>
          </Pressable>;
        })}
        {!clusters.length ? <View style={styles.noPins} pointerEvents="none"><Text style={styles.noPinsText}>{model.concertCount ? "No mapped venues in this view" : "A map of nights to remember"}</Text></View> : null}
      </View>
      {activeCluster ? <View style={styles.clusterChoices} accessibilityLiveRegion="polite">
        <Text style={styles.hint}>Nearby venues · choose one</Text>
        {activeCluster.venues.map((venue) => <Pressable key={venue.key} accessibilityRole="button" accessibilityLabel={`Show ${venue.concerts.length} logged concerts at ${venue.name}`} accessibilityState={{ selected: venue.key === selectedVenueKey }} {...(Platform.OS === "web" ? { "aria-pressed": venue.key === selectedVenueKey } : {})} onPress={() => onSelectVenue?.(venue.key)} style={({ pressed, focused }) => [styles.venueChoice, venue.key === selectedVenueKey && styles.venueChoiceSelected, focused && focusRing, pressed && styles.pressed]}><Icon name="pin" size={14} color={colors.amber} /><Text style={styles.venueChoiceText}>{venue.name}</Text><Text style={styles.venueCount}>{venue.concerts.length}</Text></Pressable>)}
      </View> : null}
      <View style={styles.footnote}>
        <Text style={styles.hint}>{model.unmappedConcertCount ? `${model.unmappedConcertCount} ${model.unmappedConcertCount === 1 ? "concert has" : "concerts have"} no map location; still listed.` : "Select a pin or a concert to explore."}</Text>
        <Text style={styles.attribution}>Map: Natural Earth · public domain</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.bgElev, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(1), paddingLeft: space(3), paddingRight: space(1) },
  caption: { flexDirection: "row", alignItems: "center", gap: space(2), flex: 1 },
  frameLabel: { color: colors.textDim, fontSize: 11, fontWeight: "700" },
  controls: { flexDirection: "row" },
  control: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  canvas: { position: "relative", overflow: "hidden", backgroundColor: colors.bg },
  pinTarget: { position: "absolute", width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: "center", justifyContent: "center", zIndex: 1, borderRadius: radius.pill },
  selectedTarget: { zIndex: 2 },
  pin: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.amber, backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center" },
  selectedPin: { backgroundColor: colors.amber, borderColor: colors.text, width: 27, height: 27 },
  pinCount: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "800" },
  selectedPinCount: { color: colors.bg },
  pinDot: { position: "absolute", width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.amber },
  selectedDot: { backgroundColor: colors.bg },
  noPins: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(4) },
  noPinsText: { color: colors.textDim, fontSize: 12, textAlign: "center", backgroundColor: colors.bgElev, padding: space(2), borderRadius: radius.sm },
  clusterChoices: { padding: space(2), gap: space(1), borderTopWidth: 1, borderTopColor: colors.lineSoft },
  venueChoice: { flexDirection: "row", alignItems: "center", gap: space(2), minHeight: 44, paddingHorizontal: space(2), borderRadius: radius.sm },
  venueChoiceSelected: { backgroundColor: colors.surfaceAlt },
  venueChoiceText: { color: colors.text, fontSize: 12, flex: 1 },
  venueCount: { color: colors.amber, fontFamily: mono, fontSize: 11 },
  footnote: { padding: space(3), gap: space(1) },
  hint: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  attribution: { color: colors.textFaint, fontSize: 9, lineHeight: 14 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
});
