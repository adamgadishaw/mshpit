import { Component, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import { colors, font, radius, space } from "../../theme";
import { iosVenueMapModel, iosVenueMapsURL, IOS_VENUE_MAP_TIMEOUT_MS } from "../../domain/iosVenueMap.mjs";

// Older development binaries and Expo Go do not contain the app-local view.
// Missing native code must not crash venue discovery or resemble a loaded map.
let NativeVenueMap = null;
try {
  if (requireOptionalNativeModule("MshpitVenueMap")) NativeVenueMap = requireNativeViewManager("MshpitVenueMap");
} catch { /* The accessible list remains available. */ }

export class VenueMapBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <MapUnavailable onRetry={this.props.onRetry} /> : this.props.children; }
}

export function MapUnavailable({ onRetry, missing = false }) {
  return <View style={styles.unavailable} accessibilityRole="alert">
    <Text style={styles.body}>{missing ? "Street maps aren’t included in this app build." : "The street map couldn’t load."} Every venue is still in the list below.</Text>
    {!missing && <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry venue street map" style={styles.button}><Text style={styles.link}>Retry map</Text></Pressable>}
  </View>;
}

export function VenueMapSession({ revision, points, selectedId, city, onSelect, onRetry }) {
  const [status, setStatus] = useState("loading");
  const state = useRef({ live: true, status: "loading", rendered: false });
  const acceptStatus = next => {
    if (!state.current.live || state.current.status === "error") return;
    state.current.status = next;
    if (next === "ready") state.current.rendered = true;
    setStatus(next);
  };
  useEffect(() => {
    state.current.live = true;
    const timer = setTimeout(() => {
      if (!state.current.rendered) acceptStatus("error");
    }, IOS_VENUE_MAP_TIMEOUT_MS);
    return () => { state.current.live = false; clearTimeout(timer); };
  }, []);
  if (status === "error") return <MapUnavailable onRetry={onRetry} />;
  return <View>
    <View style={styles.map}>
      <NativeVenueMap style={StyleSheet.absoluteFill} snapshot={{ revision, venues: points, selectedId: selectedId ?? "" }}
        accessibilityLabel={`Venue street map of ${city || "the selected area"}`}
        onVenueSelect={({ nativeEvent }) => {
          if (state.current.live && state.current.status !== "error" && nativeEvent?.revision === revision) onSelect(nativeEvent);
        }}
        onMapStatus={({ nativeEvent }) => {
          if (nativeEvent?.revision === revision && ["ready", "partial"].includes(nativeEvent.status)) acceptStatus(nativeEvent.status);
        }} />
    </View>
    {status === "loading" && <Text style={styles.caption}>Loading street map. Venue details remain available below.</Text>}
    {status === "partial" && <View accessibilityRole="alert"><Text style={styles.caption}>Some street map tiles couldn’t load. Venue details remain available below.</Text><Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry venue street map" style={styles.button}><Text style={styles.link}>Retry map</Text></Pressable></View>}
  </View>;
}

export default function DiscoverVenueMap({ venues, selected, onSelect, city }) {
  const model = useMemo(() => iosVenueMapModel(venues, selected), [venues, selected]);
  const [attempt, setAttempt] = useState(0);
  const [linkError, setLinkError] = useState(null);
  const revision = `${city || ""}:${model.key}:${attempt}`;
  // Fence callbacks immediately on render, including before an old effect cleans
  // up. Selecting a removed venue must never update the caller's current list.
  const latest = useRef(null);
  const actionKey = JSON.stringify([revision, model.active?.id || null]);
  if (latest.current?.key !== actionKey) latest.current = { key: actionKey, flight: null };
  const owner = latest.current;
  owner.revision = revision; owner.model = model; owner.onSelect = onSelect;
  const current = useRef(owner);
  current.current = owner;
  useEffect(() => {
    current.current = latest.current;
    return () => { current.current = null; };
  }, []);
  const choose = event => {
    const now = current.current;
    if (now !== owner || event?.revision !== now?.revision) return;
    const point = now.model.points.find(point => point.id === event.id);
    if (point) now.onSelect?.(point.sourceId);
  };
  const retry = () => {
    if (current.current !== owner) return;
    current.current = null;
    setAttempt(value => value + 1);
  };
  const mapsURL = iosVenueMapsURL(model.active);
  const openMaps = async () => {
    if (!mapsURL || current.current !== owner || owner.flight) return;
    const flight = {};
    owner.flight = flight;
    setLinkError(null);
    try { await Linking.openURL(mapsURL); }
    catch {
      if (current.current === owner) {
        setLinkError({ owner, message: "Couldn’t open Maps. Try again or use the venue details below." });
      }
    } finally { if (owner.flight === flight) owner.flight = null; }
  };
  return <View>
    {!model.points.length ? <View style={styles.unavailable}><Text style={styles.body}>Venue coordinates aren’t available for this selection. You can still view venue details and shows below.</Text></View>
      : !NativeVenueMap ? <MapUnavailable missing />
        : <VenueMapBoundary key={revision} onRetry={retry}><VenueMapSession revision={revision} points={model.nativePoints} selectedId={model.active?.id || null} city={city} onSelect={choose} onRetry={retry} /></VenueMapBoundary>}
    {!!model.points.length && <>
      <Text style={styles.caption}>{model.points.length} venue locations{model.mappedCount > model.points.length ? ` of ${model.mappedCount} available` : ""}{model.unmappedCount ? ` · ${model.unmappedCount} awaiting a map location` : ""}. Select a pin or a venue below. These buttons also reach overlapping pins.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="Venue map selections" contentContainerStyle={styles.choices}>
        {model.points.map(point => <Pressable key={point.id} accessibilityRole="button" accessibilityLabel={`Select venue ${point.number}: ${point.name}`}
          accessibilityState={{ selected: point.id === model.active?.id }} onPress={() => choose({ revision, id: point.id })}
          style={[styles.choice, point.id === model.active?.id && styles.selected]}><Text style={styles.choiceText}>{point.number}. {point.name}</Text></Pressable>)}
      </ScrollView>
    </>}
    {!!mapsURL && <Pressable onPress={openMaps} accessibilityRole="link" accessibilityLabel={`Open ${model.active.name} in Apple Maps`} style={styles.button}><Text style={styles.link}>Open {model.active.name} in Maps</Text></Pressable>}
    {linkError?.owner === owner && <Text accessibilityRole="alert" style={styles.caption}>{linkError.message}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  map: { width: "100%", aspectRatio: 640 / 420, minHeight: 220, backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden" },
  unavailable: { minHeight: 120, justifyContent: "center", padding: space(4), backgroundColor: colors.surface, borderRadius: radius.md },
  body: { fontFamily: font, fontSize: 14, lineHeight: 21, color: colors.textDim },
  caption: { fontFamily: font, fontSize: 12, lineHeight: 18, color: colors.textDim, paddingVertical: space(2) },
  choices: { gap: space(2), paddingVertical: space(2) },
  choice: { minHeight: 44, maxWidth: 250, justifyContent: "center", padding: space(3), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  selected: { borderColor: colors.amber, backgroundColor: colors.surfaceAlt },
  choiceText: { fontFamily: font, fontSize: 13, lineHeight: 19, color: colors.text },
  button: { minHeight: 44, justifyContent: "center", paddingVertical: space(2) },
  link: { fontFamily: font, fontSize: 13, lineHeight: 20, fontWeight: "800", color: colors.amber },
});
