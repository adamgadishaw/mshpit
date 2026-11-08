import { useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { colors, font, radius, space } from "../../theme";
import useImageAttempt from "../../hooks/useImageAttempt";
import { creditedFestivalImage } from "./festivalPresentation.ios.mjs";

export default function FestivalArtwork({ edition, compact = false, onOpen }) {
  const image = creditedFestivalImage(edition);
  const [retry, setRetry] = useState(0);
  const attempt = useImageAttempt(JSON.stringify([edition?.id || edition?.festivalSlug, retry]), image ? [image.uri] : []);
  const latest = useRef(null);
  const live = useRef(true);
  latest.current = attempt.nativeAttemptKey;
  useLayoutEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const retryImage = () => {
    if (live.current && latest.current === attempt.nativeAttemptKey && image && !attempt.uri) setRetry(value => value + 1);
  };
  if (!image) return <View style={styles.missing}><Text style={styles.muted}>No credited festival image listed</Text></View>;
  return <View style={styles.root}>
    <View style={[styles.frame, compact && styles.compact, !attempt.uri && styles.failedFrame]}>
      {attempt.uri ? <Pressable disabled={!onOpen} onPress={onOpen} style={StyleSheet.absoluteFill} accessibilityRole={onOpen ? "button" : "image"} accessibilityLabel={onOpen ? `Open ${edition.name}` : `${edition.name} festival artwork`}><Image key={attempt.nativeAttemptKey} source={{ uri: attempt.uri }} style={StyleSheet.absoluteFill}
        recyclingKey={`${edition.id}:${attempt.nativeAttemptKey}`} contentFit="contain" cachePolicy="disk" transition={0}
        accessible={false} accessibilityIgnoresInvertColors
        onError={attempt.onError} onDisplay={attempt.onDisplay} /></Pressable> : <View style={styles.failure}>
        <Text style={styles.muted} accessibilityLiveRegion="polite">Festival image could not load.</Text>
        <Pressable onPress={retryImage} style={styles.retry} accessibilityRole="button" accessibilityLabel={`Retry image for ${edition.name}`}>
          <Text style={styles.retryText}>Retry image</Text>
        </Pressable>
      </View>}
    </View>
    <Text style={styles.credit}>{`Image: ${image.credit}`}</Text>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 6 }, frame: { width: "100%", aspectRatio: 4 / 3, backgroundColor: colors.bgElev, borderRadius: radius.md, overflow: "hidden" },
  failedFrame: { aspectRatio: undefined, minHeight: 140 },
  compact: { aspectRatio: 16 / 10 }, missing: { paddingVertical: space(3), paddingHorizontal: space(3), borderRadius: radius.md, backgroundColor: colors.bgElev },
  failure: { flex: 1, alignItems: "center", justifyContent: "center", padding: space(4), gap: space(2) },
  muted: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 19 },
  credit: { color: colors.textDim, fontFamily: font, fontSize: 11, lineHeight: 16 },
  retry: { minHeight: 44, minWidth: 100, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  retryText: { color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "700" },
});
