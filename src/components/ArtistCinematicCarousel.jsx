import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { artistCinematicMedia } from "../domain/artistGalleryMedia.mjs";
import useReducedMotion from "../hooks/useReducedMotion";
import { colors, displayFont, focusRing, mono, radius, shadow } from "../theme";
import Icon from "./Icon";
import SmartImage from "./SmartImage";

const initialsFor = (name) => String(name || "Artist")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0])
  .join("")
  .toUpperCase();

export default function ArtistCinematicCarousel({
  artistName,
  bannerUri = null,
  profileUri = null,
  gallery = [],
  onOpenMedia,
}) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const fade = useRef(new Animated.Value(1)).current;
  const [index, setIndex] = useState(0);
  const slides = useMemo(
    () => artistCinematicMedia({ bannerUri, profileUri, gallery }, 5),
    [bannerUri, gallery, profileUri],
  );
  const current = slides[index] || null;
  const heroHeight = width >= 1180 ? 420 : width >= 760 ? 340 : 260;
  const previewWidth = width >= 760 ? 1400 : 760;

  useEffect(() => {
    if (index < slides.length) return;
    setIndex(0);
  }, [index, slides.length]);

  useEffect(() => {
    fade.stopAnimation();
    if (reduceMotion) {
      fade.setValue(1);
      return undefined;
    }
    fade.setValue(0.72);
    const animation = Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [fade, index, reduceMotion]);

  const move = (delta) => {
    if (slides.length < 2) return;
    const next = (index + delta + slides.length) % slides.length;
    setIndex(next);
    AccessibilityInfo.announceForAccessibility?.(`${artistName} photo ${next + 1} of ${slides.length}`);
  };

  const openCurrent = () => {
    if (!current) return;
    onOpenMedia?.(slides, index, current.postId || null);
  };

  return (
    <View
      style={[styles.shell, { height: heroHeight }]}
      accessibilityRole="summary"
      accessibilityLabel={`${artistName} featured artist gallery`}
    >
      {current ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <SmartImage
            uri={current.uri}
            style={StyleSheet.absoluteFill}
            contain={false}
            previewWidth={previewWidth}
            accessibilityLabel={`Open featured ${artistName} photo${current.by ? ` by ${current.by}` : ""}`}
            onPress={openCurrent}
          />
        </Animated.View>
      ) : (
        <View style={styles.fallback} accessible accessibilityRole="image" accessibilityLabel={`${artistName} artist image unavailable`}>
          <View style={styles.fallbackGlow} />
          <Text style={styles.fallbackInitials}>{initialsFor(artistName)}</Text>
          <Text style={styles.fallbackLabel}>ARTIST FEATURE</Text>
        </View>
      )}

      <View pointerEvents="none" style={styles.topScrim} />
      <View pointerEvents="none" style={styles.bottomScrim} />

      <View pointerEvents="none" style={styles.copy}>
        <Text style={styles.kicker}>{current?.source === "fan" ? "FROM THE CROWD" : "FEATURED ARTIST"}</Text>
        <Text style={styles.credit} numberOfLines={1}>
          {current?.by ? `Photo by ${current.by}` : current ? "Artist imagery" : "More photos are on the way"}
        </Text>
      </View>

      {slides.length > 1 ? (
        <View style={styles.controls}>
          <Pressable
            style={({ pressed, focused }) => [styles.control, pressed && styles.controlPressed, focused && focusRing]}
            onPress={() => move(-1)}
            accessibilityRole="button"
            accessibilityLabel={`Previous ${artistName} photo`}
          >
            <Icon name="chevron-left" size={18} color="#FFFFFF" />
          </Pressable>
          <View style={styles.counter} accessible accessibilityLiveRegion="polite" accessibilityLabel={`Photo ${index + 1} of ${slides.length}`}>
            <Text style={styles.counterText}>{index + 1} / {slides.length}</Text>
          </View>
          <Pressable
            style={({ pressed, focused }) => [styles.control, pressed && styles.controlPressed, focused && focusRing]}
            onPress={() => move(1)}
            accessibilityRole="button"
            accessibilityLabel={`Next ${artistName} photo`}
          >
            <Icon name="chevron-right" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    overflow: "hidden",
    borderRadius: radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceAlt,
    ...shadow.card,
  },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", overflow: "hidden", backgroundColor: colors.bgElev },
  fallbackGlow: { position: "absolute", width: 420, height: 420, borderRadius: 210, top: -230, right: -110, backgroundColor: colors.amber, opacity: 0.18 },
  fallbackInitials: { color: colors.text, fontFamily: displayFont, fontSize: 76, lineHeight: 82, fontWeight: "900", letterSpacing: -3, opacity: 0.9 },
  fallbackLabel: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 2.4, marginTop: 8 },
  topScrim: { position: "absolute", left: 0, right: 0, top: 0, height: "30%", backgroundColor: "rgba(3,5,9,0.18)" },
  bottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "58%", backgroundColor: "rgba(3,5,9,0.66)" },
  // The profile avatar punches through the lower-left edge of this banner.
  // Keep editorial copy beyond that reserved zone instead of duplicating the
  // artist name beneath the avatar.
  copy: { position: "absolute", left: 116, right: 18, bottom: 18 },
  kicker: { color: "#FFB56B", fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 2 },
  credit: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 5 },
  controls: { position: "absolute", right: 14, top: 14, flexDirection: "row", alignItems: "center", gap: 6 },
  control: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.34)", backgroundColor: "rgba(4,6,10,0.72)" },
  controlPressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
  counter: { minWidth: 46, minHeight: 30, alignItems: "center", justifyContent: "center", paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: "rgba(4,6,10,0.68)" },
  counterText: { color: "#FFFFFF", fontFamily: mono, fontSize: 9.5, fontWeight: "900", fontVariant: ["tabular-nums"] },
});
