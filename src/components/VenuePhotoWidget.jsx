import { useState, useEffect } from "react";
import { View, Text, StyleSheet, Image, Pressable, Linking, Platform, ActivityIndicator, AccessibilityInfo } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { colors, mono, radius } from "../theme";
import Icon from "../components/Icon";
import { mapsDir } from "../lib/afterparty";
import { displaySrc, proxied, isHttp } from "../lib/img";
import { venuePhotoAttemptScope } from "../domain/venuePhotos.mjs";

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
    const src = viaProxy && isHttp(photo.uri) ? proxied(photo.uri) : displaySrc(photo.uri, 1600);
    return <Image accessible={false} source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={onError} />;
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

export default function VenuePhotoWidget({ photos = [], venueName, city, coord, loading = false, error = false, onRetry, onPress }) {
  // Some hosts block browser loads (hotlink/CORS) even when the URL is alive.
  // Retry ladder per URL: direct -> wsrv.nl proxy -> drop. Only when every photo
  // exhausts both attempts does the themed gradient card show.
  const [attempt, setAttempt] = useState({}); // uri -> "proxy" | "dead"
  const attemptScope = venuePhotoAttemptScope(venueName, photos);
  const real = photos.filter((p) => p?.uri && attempt[p.uri] !== "dead").slice(0, 5);
  const slides = real.length ? real : [{ uri: null }];
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [directionError, setDirectionError] = useState("");
  const failCur = (uri) => uri && setAttempt((a) => ({ ...a, [uri]: a[uri] === "proxy" ? "dead" : "proxy" }));

  useEffect(() => {
    setAttempt({});
    setI(0);
  }, [attemptScope]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReduceMotion(enabled); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  useEffect(() => {
    setI((current) => current % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2 || paused || reduceMotion) return undefined;
    const id = setInterval(() => setI((x) => (x + 1) % slides.length), 3600);
    return () => clearInterval(id);
  }, [paused, reduceMotion, slides.length]);

  const realCount = real.length;
  const cur = i % slides.length;
  const hadPhotoCandidates = photos.some((photo) => !!photo?.uri);
  const deliveryFailed = hadPhotoCandidates && realCount === 0;
  const move = (delta) => {
    setPaused(true);
    setI((current) => (current + delta + slides.length) % slides.length);
  };
  const retryPhotos = () => {
    setAttempt({});
    setI(0);
    if (error) onRetry?.();
  };
  const canRetryPhotos = realCount === 0 && ((error && !!onRetry) || deliveryFailed);
  const activatePhoto = () => {
    if (canRetryPhotos) retryPhotos();
    else if (onPress) onPress();
    else if (slides.length > 1) move(1);
  };
  const emptyMessage = loading
    ? "Loading venue photos..."
    : error
      ? onRetry ? "Photos unavailable - tap to retry" : "Photos are temporarily unavailable"
      : deliveryFailed
        ? "Photos could not be displayed - tap to retry"
      : "No verified venue photos yet";
  const photoInteractive = !!(canRetryPhotos || onPress || slides.length > 1);
  const frameLabel = realCount
    ? `Photos of ${venueName}, photo ${cur + 1} of ${slides.length}`
    : loading
      ? `Loading photos of ${venueName}`
      : canRetryPhotos
        ? `Retry displaying photos of ${venueName}`
        : error
          ? `Photos of ${venueName} are temporarily unavailable`
        : `No verified photos of ${venueName} are available yet`;

  return (
    <View>
      <View style={styles.frame}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={activatePhoto}
          disabled={!photoInteractive}
          accessibilityRole={photoInteractive ? "button" : "image"}
          accessibilityLabel={frameLabel}
          accessibilityHint={photoInteractive && slides.length > 1 && !onPress ? "Shows the next photo" : undefined}
          accessibilityState={{ disabled: !photoInteractive }}
          accessibilityValue={slides.length > 1 ? { text: `${cur + 1} of ${slides.length}` } : undefined}
        >
          <Slide photo={slides[cur]} idx={cur} viaProxy={attempt[slides[cur]?.uri] === "proxy"} onError={() => failCur(slides[cur]?.uri)} />
          <View style={styles.scrim} />
          {!realCount && (
            <View style={styles.emptyArtwork} pointerEvents="none" accessible={false}>
              <View style={styles.emptyArtworkIcon}>
                <Icon name="photo" size={28} color="rgba(255,255,255,0.78)" />
              </View>
            </View>
          )}
          <View style={styles.title}>
            <Text style={styles.venue} numberOfLines={1}>{venueName}</Text>
            {!!city && <Text style={styles.city}>{city}</Text>}
          </View>
          <View style={styles.dots} accessible={false}>
            {slides.length > 1 && slides.map((_, d) => (
              <View key={d} style={[styles.dot, d === cur && styles.dotOn]} />
            ))}
          </View>
          {slides[cur]?.uri && slides[cur]?.source && slides[cur].source !== "fan" && !!slides[cur].by && (
            <View style={styles.credit}><Text style={styles.creditTxt} numberOfLines={1}>{slides[cur].by}</Text></View>
          )}
        </Pressable>
        {!realCount && (
          <View style={styles.photoStatus} pointerEvents="none" accessibilityLiveRegion="polite" role="status">
            {loading && <ActivityIndicator size="small" color={colors.amber} />}
            {!loading && <Icon name="photo" size={14} color={colors.amber} />}
            <Text style={styles.photoStatusText}>{emptyMessage}</Text>
          </View>
        )}
      </View>

      {slides.length > 1 && (
        <View style={styles.carouselControls} accessibilityLabel="Venue photo controls">
          <Pressable style={styles.carouselButton} onPress={() => move(-1)} accessibilityRole="button" accessibilityLabel="Previous venue photo">
            <Icon name="chevron-left" size={17} color={colors.text} />
          </Pressable>
          <Pressable
            style={[styles.autoplayButton, reduceMotion && styles.controlDisabled]}
            onPress={() => setPaused((value) => !value)}
            disabled={reduceMotion}
            accessibilityRole="button"
            accessibilityLabel={reduceMotion ? "Auto-play disabled by Reduce Motion" : paused ? "Play venue photo slideshow" : "Pause venue photo slideshow"}
            accessibilityState={{ disabled: reduceMotion }}
          >
            <Text style={styles.autoplayText}>{reduceMotion ? "AUTO-PLAY OFF" : paused ? "PLAY" : "PAUSE"}</Text>
          </Pressable>
          <Pressable style={styles.carouselButton} onPress={() => move(1)} accessibilityRole="button" accessibilityLabel="Next venue photo">
            <Icon name="chevron-right" size={17} color={colors.text} />
          </Pressable>
        </View>
      )}

      {coord && coord.lat != null && (
        <Pressable
          style={styles.dir}
          onPress={() => {
            setDirectionError("");
            void Linking.openURL(mapsDir(coord.lat, coord.lng)).catch(() => setDirectionError("Directions could not be opened on this device."));
          }}
          accessibilityRole="link"
          accessibilityLabel={`Get directions to ${venueName}`}
        >
          <Icon name="pin" size={15} color={colors.amber} />
          <Text style={styles.dirTxt}>Get directions</Text>
          <Icon name="external" size={14} color={colors.textDim} />
        </Pressable>
      )}
      {!!directionError && <Text style={styles.directionError} accessibilityRole="alert" accessibilityLiveRegion="assertive">{directionError}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 10, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.bgElev },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "transparent", borderRadius: 16 },
  emptyArtwork: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  emptyArtworkIcon: { width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(5,6,10,0.34)" },
  title: { position: "absolute", left: 16, bottom: 16, right: 16 },
  venue: {
    color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.4,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 8px rgba(0,0,0,0.7)" } : { textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 8 }),
  },
  city: {
    color: "#fff", fontFamily: mono, fontSize: 12, marginTop: 3, opacity: 0.9,
    ...(Platform.OS === "web" ? { textShadow: "0 1px 6px rgba(0,0,0,0.7)" } : { textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 6 }),
  },
  credit: { position: "absolute", right: 10, bottom: 10, maxWidth: "60%", backgroundColor: "rgba(5,6,10,0.55)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  creditTxt: { color: "rgba(255,255,255,0.8)", fontSize: 9 },
  dots: { position: "absolute", top: 12, right: 12, flexDirection: "row", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.4)" },
  dotOn: { backgroundColor: colors.amber, width: 16 },
  photoStatus: { position: "absolute", top: 12, left: 12, maxWidth: "75%", flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "rgba(5,6,10,0.72)", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  photoStatusText: { color: "rgba(255,255,255,0.9)", fontFamily: mono, fontSize: 10, fontWeight: "700" },
  carouselControls: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 },
  carouselButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  autoplayButton: { minWidth: 92, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  autoplayText: { color: colors.text, fontFamily: mono, fontSize: 10, fontWeight: "800", letterSpacing: 0.7 },
  controlDisabled: { opacity: 0.62 },
  placeholderTag: { position: "absolute", top: 12, left: 12, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  placeholderTxt: { color: "rgba(255,255,255,0.85)", fontSize: 10, fontFamily: mono, letterSpacing: 0.5 },
  dir: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  dirTxt: { color: colors.text, fontSize: 14, fontWeight: "700" },
  directionError: { color: colors.danger, fontSize: 12.5, lineHeight: 18, marginTop: 8, textAlign: "center" },
});
