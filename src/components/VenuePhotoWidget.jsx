import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Image, Pressable, Linking } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { colors, mono, radius } from "../theme";
import Icon from "../components/Icon";
import { mapsDir } from "../lib/afterparty";
import { proxied, isHttp } from "../lib/img";

// An iOS-photo-widget-style rolling compilation for a venue: real photos when we
// have them, a stage-light title card always on top (venue + city), and a Get
// Directions deep link. Replaces the live map to keep map costs down.
const GELS = [
  ["#3A1E2E", "#0B0E16"],
  ["#23303F", "#0B0E16"],
  ["#3A2A14", "#0B0E16"],
  ["#2A2140", "#0B0E16"],
  ["#13302A", "#0B0E16"],
];

function Slide({ photo, idx, viaProxy, onError }) {
  if (photo?.uri) {
    const src = viaProxy && isHttp(photo.uri) ? proxied(photo.uri) : photo.uri;
    return <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={onError} />;
  }
  const [a, b] = GELS[idx % GELS.length];
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={`g${idx}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={a} />
          <Stop offset="100%" stopColor={b} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#g${idx})`} />
    </Svg>
  );
}

export default function VenuePhotoWidget({ photos = [], venueName, city, coord }) {
  // Some hosts block browser loads (hotlink/CORS) even when the URL is alive.
  // Retry ladder per URL: direct -> wsrv.nl proxy -> drop. Only when every photo
  // exhausts both attempts does the themed gradient card show.
  const [attempt, setAttempt] = useState({}); // uri -> "proxy" | "dead"
  const real = photos.filter((p) => p?.uri && attempt[p.uri] !== "dead").slice(0, 5);
  const slides = real.length ? real : [{ uri: null }];
  const [i, setI] = useState(0);
  const failCur = (uri) => uri && setAttempt((a) => ({ ...a, [uri]: a[uri] === "proxy" ? "dead" : "proxy" }));

  useEffect(() => {
    if (slides.length < 2) return;
    const id = setInterval(() => setI((x) => (x + 1) % slides.length), 3600);
    return () => clearInterval(id);
  }, [slides.length]);

  const realCount = real.length;
  const cur = i % slides.length;

  return (
    <View>
      <Pressable style={styles.frame} onPress={() => setI((x) => (x + 1) % slides.length)}>
        <Slide photo={slides[cur]} idx={cur} viaProxy={attempt[slides[cur]?.uri] === "proxy"} onError={() => failCur(slides[cur]?.uri)} />
        {/* legibility scrim */}
        <View style={styles.scrim} />
        {/* title card */}
        <View style={styles.title}>
          <Text style={styles.venue} numberOfLines={1}>{venueName}</Text>
          {!!city && <Text style={styles.city}>{city}</Text>}
        </View>
        {/* dots */}
        <View style={styles.dots}>
          {slides.length > 1 && slides.map((_, d) => (
            <View key={d} style={[styles.dot, d === cur && styles.dotOn]} />
          ))}
        </View>
        {/* attribution for licensed (non-fan) photos */}
        {slides[cur]?.uri && slides[cur]?.source && slides[cur].source !== "fan" && !!slides[cur].by && (
          <View style={styles.credit}><Text style={styles.creditTxt} numberOfLines={1}>{slides[cur].by}</Text></View>
        )}
      </Pressable>

      {coord && coord.lat != null && (
        <Pressable style={styles.dir} onPress={() => Linking.openURL(mapsDir(coord.lat, coord.lng))}>
          <Icon name="pin" size={15} color={colors.amber} />
          <Text style={styles.dirTxt}>Get directions</Text>
          <Icon name="external" size={14} color={colors.textDim} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 10, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "transparent", borderRadius: 16 },
  title: { position: "absolute", left: 16, bottom: 16, right: 16 },
  venue: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.4, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 8 },
  city: { color: "#fff", fontFamily: mono, fontSize: 12, marginTop: 3, opacity: 0.9, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 6 },
  credit: { position: "absolute", right: 10, bottom: 10, maxWidth: "60%", backgroundColor: "rgba(5,6,10,0.55)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  creditTxt: { color: "rgba(255,255,255,0.8)", fontSize: 9 },
  dots: { position: "absolute", top: 12, right: 12, flexDirection: "row", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.4)" },
  dotOn: { backgroundColor: colors.amber, width: 16 },
  placeholderTag: { position: "absolute", top: 12, left: 12, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  placeholderTxt: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontFamily: mono, letterSpacing: 0.5 },
  dir: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  dirTxt: { color: colors.text, fontSize: 14, fontWeight: "700" },
});
