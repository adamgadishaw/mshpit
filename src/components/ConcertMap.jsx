import { useState } from "react";
import { View, Text, Image, Pressable, StyleSheet, Platform } from "react-native";
import CityMap from "./CityMap";
import LiveMap from "./LiveMap";
import { HAS_MAP, MAP_PROVIDER, GOOGLE_KEY, mapStaticUrl } from "../mapConfig";
import { linearProjector, pixelProjector, MAP_W, MAP_H } from "../lib/mapProject";
import { colors, mono, radius } from "../theme";

const web = Platform.OS === "web" && typeof window !== "undefined";

// The map shown on concert / venue / nearby pages. On web with a Google key it's
// a REAL interactive map (LiveMap: pan, zoom, clickable pins). Without that it
// falls back to a Mapbox static snapshot or the drawn CityMap, with tappable pin
// overlays. Focal venue glows; blue pins are nearby venues (tap opens the page).
export default function ConcertMap({ points = [], highlight, focalName, label, onOpenVenue, onPressPoint, height }) {
  const [active, setActive] = useState(null);
  const [liveFailed, setLiveFailed] = useState(false);
  const all = highlight ? [...points, highlight] : points;
  const coords = all.filter((p) => p && p.lat != null && p.lng != null);
  if (coords.length === 0) return null;

  // Interactive Google map (web only). If the JS API fails to load, drop through
  // to the static/drawn fallback below so the map is never blank.
  if (web && MAP_PROVIDER === "google" && GOOGLE_KEY && !liveFailed) {
    return (
      <LiveMap
        points={points}
        highlight={highlight}
        focalName={focalName}
        label={label}
        onOpenVenue={onOpenVenue}
        onPressPoint={onPressPoint}
        height={height}
        onFail={() => setLiveFailed(true)}
        key="live"
      />
    );
  }

  const proj = HAS_MAP ? pixelProjector(coords, MAP_W, MAP_H) : linearProjector(coords);
  const at = (p) => ({ left: `${proj.xPct(p.lng) * 100}%`, top: `${proj.yPct(p.lat) * 100}%` });
  const others = points.filter((p) => p && p.lat != null && (!focalName || p.name !== focalName));

  const tap = (name) => {
    if (!name) return;
    if (active === name) onOpenVenue?.(name);
    else setActive(name);
  };

  return (
    <View style={styles.wrap}>
      {HAS_MAP ? (
        <Image source={{ uri: mapStaticUrl(proj.center, proj.zoom, MAP_W, MAP_H) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <CityMap points={points} highlight={highlight} label={label} showPins={false} />
      )}

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {others.map((p, i) => (
          <Pin
            key={`o${i}`}
            pos={at(p)}
            name={p.name}
            show={active === p.name}
            onHoverIn={() => setActive(p.name)}
            onHoverOut={() => setActive((a) => (a === p.name ? null : a))}
            onPress={() => tap(p.name)}
          />
        ))}
        {highlight && (
          <Pin
            pos={at(highlight)}
            name={focalName}
            focal
            show
            onPress={focalName ? () => onOpenVenue?.(focalName) : undefined}
          />
        )}
      </View>

      {HAS_MAP && label ? <Text style={styles.cityLabel}>{label}</Text> : null}
    </View>
  );
}

function Pin({ pos, name, focal, show, onPress, onHoverIn, onHoverOut }) {
  return (
    <View style={[styles.anchor, pos, focal ? styles.anchorFocal : styles.anchorOther]} pointerEvents="box-none">
      {show && name ? (
        <View style={styles.tip}>
          <Text style={styles.tipTxt} numberOfLines={1}>{name}</Text>
        </View>
      ) : null}
      <Pressable onPress={onPress} onHoverIn={onHoverIn} onHoverOut={onHoverOut} hitSlop={8} style={[styles.dot, focal ? styles.dotFocal : styles.dotOther]}>
        {focal ? <View style={styles.focalCore} /> : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", aspectRatio: 320 / 206, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  // Top-left, in a readable pill — keeps clear of Google's bottom-left logo /
  // attribution (which their terms require us to leave visible).
  cityLabel: { position: "absolute", left: 10, top: 10, color: colors.text, fontFamily: mono, fontSize: 12, fontWeight: "800", letterSpacing: 0.5, backgroundColor: "rgba(7,9,15,0.66)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, overflow: "hidden" },
  anchor: { position: "absolute", alignItems: "center", justifyContent: "center" },
  anchorFocal: { width: 18, height: 18, marginLeft: -9, marginTop: -9 },
  anchorOther: { width: 14, height: 14, marginLeft: -7, marginTop: -7 },
  dot: { alignItems: "center", justifyContent: "center", borderRadius: 999 },
  dotFocal: { width: 18, height: 18, backgroundColor: colors.amberStrong, borderWidth: 2, borderColor: "#0B0E16" },
  focalCore: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#1A1206" },
  dotOther: { width: 14, height: 14, backgroundColor: colors.cool, borderWidth: 2, borderColor: "#0B0E16" },
  tip: { position: "absolute", bottom: "100%", marginBottom: 6, left: -60, width: 120, alignItems: "center" },
  tipTxt: { backgroundColor: colors.surface, color: colors.text, fontSize: 11, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
});
