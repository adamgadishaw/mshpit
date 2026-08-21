import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { clipPosterPhase } from "../domain/clipPoster.mjs";
import { generateVideoPosterAsset, releaseVideoPosterAsset } from "../lib/videoPoster";
import { scheduleVideoPosterGeneration } from "../lib/videoPosterScheduler.mjs";
import { colors, mono } from "../theme";
import Icon from "./Icon";

// Cross-platform clip cover:
// - iOS/Android generate a native image reference at a representative time.
// - Web decodes and scores representative frames into a bounded JPEG because
//   expo-video does not support generateThumbnailsAsync there in SDK 56.
// Until a frame is actually visible, a branded loading/error cover prevents the
// browser or native decoder's black surface from leaking into the feed.
export default function ClipPoster({
  uri,
  posterUri = null,
  style,
  enabled = true,
  contain = false,
  compact = false,
  showPlayBadge = true,
  accessibilityLabel = "Video clip preview",
  accessible = true,
}) {
  const [durablePosterState, setDurablePosterState] = useState({ uri: null, ready: false, failed: false });
  const durablePosterReady = durablePosterState.uri === posterUri && durablePosterState.ready;
  const durablePosterFailed = durablePosterState.uri === posterUri && durablePosterState.failed;
  const useDurablePoster = !!(enabled && posterUri && !durablePosterFailed);
  const [generatedPosterState, setGeneratedPosterState] = useState({ uri: null, value: null });
  const [thumbnailError, setThumbnailError] = useState(null);
  const thumbnailRef = useRef(null);
  const generatedForRef = useRef(null);

  const releaseThumbnail = () => {
    try { thumbnailRef.current?.release?.(); } catch {}
    thumbnailRef.current = null;
  };

  useEffect(() => {
    releaseThumbnail();
    generatedForRef.current = null;
    setGeneratedPosterState({ uri: null, value: null });
    setThumbnailError(null);
    setDurablePosterState({ uri: posterUri, ready: false, failed: false });
  }, [uri, posterUri, enabled]);

  useEffect(() => () => {
    releaseThumbnail();
  }, []);

  useEffect(() => {
    if (useDurablePoster || !enabled || !uri || generatedForRef.current === uri) return undefined;
    generatedForRef.current = uri;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let cancelled = false;
    scheduleVideoPosterGeneration(
      () => generateVideoPosterAsset({ type: "video", uri }, { signal: controller?.signal, maxDimension: 1200 }),
      { signal: controller?.signal },
    )
      .then((result) => {
        if (cancelled) {
          releaseVideoPosterAsset(result.asset);
          return;
        }
        releaseThumbnail();
        thumbnailRef.current = { release: () => releaseVideoPosterAsset(result.asset) };
        setGeneratedPosterState({ uri, value: result.asset });
      })
      .catch((error) => {
        if (!cancelled && error?.code !== "PIT_POSTER_ABORTED") setThumbnailError(error);
      });
    return () => {
      cancelled = true;
      controller?.abort?.();
    };
  }, [enabled, uri, useDurablePoster]);

  const generatedPoster = generatedPosterState.uri === uri ? generatedPosterState.value : null;
  const hasVisual = useDurablePoster
    ? durablePosterReady
    : !!generatedPoster;
  const phase = clipPosterPhase({
    enabled: !!(enabled && uri),
    hasVisual,
    error: thumbnailError,
    status: enabled ? "loading" : "idle",
  });
  const fit = contain ? "contain" : "cover";

  return (
    <View style={[styles.base, style]} pointerEvents="none" accessible={accessible} accessibilityRole={accessible ? "image" : undefined} accessibilityLabel={accessible ? accessibilityLabel : undefined} accessibilityElementsHidden={!accessible} importantForAccessibility={accessible ? "auto" : "no-hide-descendants"}>
      {useDurablePoster ? (
        <Image
          source={{ uri: posterUri }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          transition={120}
          onLoad={() => setDurablePosterState({ uri: posterUri, ready: true, failed: false })}
          onError={() => setDurablePosterState({ uri: posterUri, ready: false, failed: true })}
          accessibilityElementsHidden
        />
      ) : null}
      {generatedPoster ? (
        <Image
          source={generatedPoster}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          transition={120}
          accessibilityElementsHidden
        />
      ) : null}
      {phase !== "ready" ? (
        <View style={styles.cover} pointerEvents="none">
          <View style={[styles.glow, compact && styles.glowCompact]} />
          <View style={[styles.playRing, compact && styles.playRingCompact]}>
            {phase === "loading" && enabled ? (
              <ActivityIndicator size="small" color={colors.amber} />
            ) : (
              <Icon name="play" size={compact ? 13 : 17} color={colors.amber} />
            )}
          </View>
          {!compact ? (
            <Text style={styles.label}>{phase === "error" ? "PREVIEW UNAVAILABLE" : phase === "idle" ? "CLIP" : "LOADING CLIP"}</Text>
          ) : null}
        </View>
      ) : null}
      {phase === "ready" ? <View style={styles.readabilityScrim} pointerEvents="none" /> : null}
      {phase === "ready" && showPlayBadge ? (
        <View style={[styles.readyBadge, compact && styles.readyBadgeCompact]} pointerEvents="none">
          <Icon name="play" size={compact ? 13 : 17} color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: "hidden", backgroundColor: "#11131a" },
  cover: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#11131a" },
  glow: { position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(242,166,90,0.10)", transform: [{ scaleX: 1.7 }] },
  glowCompact: { width: 90, height: 90, borderRadius: 45 },
  playRing: { width: 44, height: 44, borderRadius: 22, borderCurve: "continuous", borderWidth: 1, borderColor: "rgba(242,166,90,0.72)", backgroundColor: "rgba(8,9,14,0.68)", alignItems: "center", justifyContent: "center", paddingLeft: 2 },
  playRingCompact: { width: 34, height: 34, borderRadius: 17 },
  label: { color: "rgba(255,255,255,0.62)", fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  readabilityScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,5,10,0.08)" },
  readyBadge: { position: "absolute", left: "50%", top: "50%", marginLeft: -24, marginTop: -24, width: 48, height: 48, borderRadius: 24, borderCurve: "continuous", backgroundColor: "rgba(5,7,12,0.64)", borderWidth: 1, borderColor: "rgba(255,255,255,0.72)", alignItems: "center", justifyContent: "center", paddingLeft: 3 },
  readyBadgeCompact: { width: 34, height: 34, borderRadius: 17, marginLeft: -17, marginTop: -17 },
});
