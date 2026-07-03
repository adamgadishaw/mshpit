import { useState } from "react";
import { View, Text, Image, Pressable, StyleSheet } from "react-native";
import CityMap from "./CityMap";
import { HAS_MAP, mapStaticUrl } from "../mapConfig";
import { linearProjector, pixelProjector, MAP_W, MAP_H } from "../lib/mapProject";
import { colors, mono, radius } from "../theme";

// The map shown on concert / venue pages. Renders a real Mapbox dark map when a
// token is set, else the drawn CityMap - and overlays interactive venue pins on
// either. Focal venue glows; blue pins are nearby venues: hover (or tap once)
// shows the name, click (or tap again) opens that venue's page.
export default function ConcertMap({ points = [], highlight, focalName, label, onOpenVenue }) {
  const [active, setActive] = useState(null);
  const all = highlight ? [...points, highlight] : points;
  const coords = all.filter((p) => p && p.lat != null && p.lng != null);
  if (coords.length === 0) return null;

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
  cityLabel: { position: "absolute", left: 12, bottom: 10, color: colors.text, fontFamily: mono, fontSize: 12, fontWeight: "700", textShadowColor: "#000", textShadowRadius: 4 },
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
