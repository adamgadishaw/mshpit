import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { clipPosterPhase, durablePosterEventOwnsInstance, durablePosterFailurePlan } from "../domain/clipPoster.mjs";
import { posterGenerationEnabled } from "../domain/posterVisibility.mjs";
import { videoPosterContain } from "../domain/postMediaGridLayout.mjs";
import { generateVideoPosterAsset, releaseVideoPosterAsset } from "../lib/videoPoster";
import { scheduleVideoPosterGeneration } from "../lib/videoPosterScheduler.mjs";
import { sharedVideoPosterRetryPolicy } from "../lib/videoPosterRetryPolicy.mjs";
import { releaseVideoPosterAssetLease, replaceVideoPosterAssetLease } from "../lib/videoPosterAssetLease.mjs";
import usePosterViewability from "../lib/usePosterViewability";
import { colors, mono } from "../theme";
import Icon from "./Icon";

// Cross-platform clip cover:
// - iOS/Android generate a native image reference at a representative time.
// - Web decodes and scores representative frames into a bounded JPEG because
//   expo-video does not support generateThumbnailsAsync there in SDK 57.
// Until a frame is actually visible, a branded loading/error cover prevents the
// browser or native decoder's black surface from leaking into the feed.
export default function ClipPoster({
  uri,
  posterUri = null,
  style,
  enabled = true,
  viewable = null,
  // null means "decide from the viewport": cover on phone tiles, contain on the
  // much wider desktop tiles. A boolean from the caller always wins.
  contain = null,
  compact = false,
  showPlayBadge = true,
  priority = "normal",
  loading = "eager",
  accessibilityLabel = "Video clip preview",
  accessible = true,
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const { targetRef, autoViewable, onLayout } = usePosterViewability(viewable);
  const generationEnabled = posterGenerationEnabled({
    enabled: !!(enabled && uri),
    explicitViewable: viewable,
    autoViewable,
  });
  const initialDurablePosterState = { uri: posterUri, ready: false, failed: false, failures: 0, retrying: false, retryVersion: 0 };
  const [durablePosterState, setDurablePosterState] = useState(initialDurablePosterState);
  const durablePosterStateRef = useRef(initialDurablePosterState);
  const durableRetryTimerRef = useRef(null);
  if (durablePosterStateRef.current.uri !== posterUri) {
    // Fence stale Image events during the render -> effect window of a recycled
    // tile. The effect below performs the actual state/resource reset.
    durablePosterStateRef.current = { ...initialDurablePosterState };
  }
  const durablePosterReady = durablePosterState.uri === posterUri && durablePosterState.ready;
  const durablePosterFailed = durablePosterState.uri === posterUri && durablePosterState.failed;
  // A server-produced poster is a normal bounded image and remains useful even
  // when expensive client video-frame generation is disabled or offscreen.
  const useDurablePoster = !!(posterUri && !durablePosterFailed);
  const [generatedPosterState, setGeneratedPosterState] = useState({ uri: null, value: null, ready: false, failed: false });
  const [thumbnailError, setThumbnailError] = useState(null);
  const [attemptVersion, setAttemptVersion] = useState(0);
  const thumbnailRef = useRef(null);

  const releaseThumbnail = (expected = null) => releaseVideoPosterAssetLease(thumbnailRef, expected);
  const clearDurableRetry = () => {
    if (durableRetryTimerRef.current) clearTimeout(durableRetryTimerRef.current);
    durableRetryTimerRef.current = null;
  };
  const commitDurablePosterState = (next) => {
    durablePosterStateRef.current = next;
    setDurablePosterState(next);
  };

  useEffect(() => {
    clearDurableRetry();
    releaseThumbnail();
    setGeneratedPosterState({ uri: null, value: null, ready: false, failed: false });
    setThumbnailError(null);
    commitDurablePosterState({ uri: posterUri, ready: false, failed: false, failures: 0, retrying: false, retryVersion: 0 });
  }, [uri, posterUri, enabled]);

  useEffect(() => () => {
    clearDurableRetry();
    releaseThumbnail();
  }, []);

  useEffect(() => {
    if (useDurablePoster || !generationEnabled || !uri || (generatedPosterState.uri === uri && generatedPosterState.value)) return undefined;
    let retryTimer = null;
    const decision = sharedVideoPosterRetryPolicy.claim(uri);
    if (decision.action === "wait") {
      retryTimer = setTimeout(() => setAttemptVersion((value) => value + 1), decision.retryAfterMs);
      return () => clearTimeout(retryTimer);
    }
    if (decision.action === "fallback") {
      setThumbnailError(decision.error);
      return undefined;
    }

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
        sharedVideoPosterRetryPolicy.succeed(uri, decision.lease);
        replaceVideoPosterAssetLease(thumbnailRef, {
          uri,
          asset: result.asset,
          release: () => releaseVideoPosterAsset(result.asset),
        });
        // Creating a JPEG/native image reference is not the same as painting it.
        // Keep the branded cover mounted until expo-image confirms the frame is
        // visible, mirroring VideoView's onFirstFrameRender boundary.
        setGeneratedPosterState({ uri, value: result.asset, ready: false, failed: false });
      })
      .catch((error) => {
        if (cancelled) return;
        const outcome = sharedVideoPosterRetryPolicy.fail(uri, decision.lease, error);
        if (outcome.action === "retry") {
          retryTimer = setTimeout(() => setAttemptVersion((value) => value + 1), outcome.retryAfterMs);
        } else if (outcome.action === "fallback") {
          setThumbnailError(outcome.error);
        }
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort?.();
      sharedVideoPosterRetryPolicy.cancel(uri, decision.lease);
    };
  }, [attemptVersion, generatedPosterState.uri, generatedPosterState.value, generationEnabled, uri, useDurablePoster]);

  const generatedPoster = generatedPosterState.uri === uri && !generatedPosterState.failed
    ? generatedPosterState.value
    : null;
  const generatedPosterReady = generatedPosterState.uri === uri && generatedPosterState.ready;
  const hasVisual = useDurablePoster
    ? durablePosterReady
    : generatedPosterReady;
  const phase = clipPosterPhase({
    enabled: !!(uri && (useDurablePoster || generationEnabled || generatedPoster)),
    hasVisual,
    error: thumbnailError,
    status: enabled ? "loading" : "idle",
  });
  const fit = videoPosterContain({ viewportWidth, explicit: contain }) ? "contain" : "cover";
  const showDurablePoster = useDurablePoster && !durablePosterState.retrying;

  const handleDurablePosterDisplay = (expectedRetryVersion) => {
    const current = durablePosterStateRef.current;
    if (!durablePosterEventOwnsInstance(current, { uri: posterUri, retryVersion: expectedRetryVersion })) return;
    clearDurableRetry();
    commitDurablePosterState({ ...current, ready: true, failed: false, retrying: false });
  };

  const handleDurablePosterError = (expectedRetryVersion) => {
    const current = durablePosterStateRef.current;
    if (!durablePosterEventOwnsInstance(current, { uri: posterUri, retryVersion: expectedRetryVersion }) || current.failed || current.ready) return;
    const plan = durablePosterFailurePlan(current.failures);
    const next = {
      ...current,
      ready: false,
      failed: plan.terminal,
      failures: plan.failures,
      retrying: !plan.terminal,
    };
    commitDurablePosterState(next);
    if (plan.terminal) return;
    clearDurableRetry();
    durableRetryTimerRef.current = setTimeout(() => {
      const latest = durablePosterStateRef.current;
      if (latest.uri !== posterUri || latest.failed || !latest.retrying) return;
      commitDurablePosterState({
        ...latest,
        retrying: false,
        retryVersion: latest.retryVersion + 1,
      });
      durableRetryTimerRef.current = null;
    }, plan.retryAfterMs);
  };

  return (
    <View ref={targetRef} onLayout={onLayout} style={[styles.base, style]} pointerEvents="none" accessible={accessible} accessibilityRole={accessible ? "image" : undefined} accessibilityLabel={accessible ? accessibilityLabel : undefined} accessibilityElementsHidden={!accessible} importantForAccessibility={accessible ? "auto" : "no-hide-descendants"}>
      {showDurablePoster ? (
        <Image
          key={`durable:${posterUri}:${durablePosterState.retryVersion}`}
          source={{ uri: posterUri }}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          cachePolicy="memory-disk"
          priority={priority}
          loading={loading}
          allowDownscaling
          enforceEarlyResizing
          recyclingKey={`durable:${posterUri}`}
          transition={120}
          onDisplay={() => handleDurablePosterDisplay(durablePosterState.retryVersion)}
          onError={() => handleDurablePosterError(durablePosterState.retryVersion)}
          accessibilityElementsHidden
        />
      ) : null}
      {generatedPoster ? (
        <Image
          source={generatedPoster}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          cachePolicy="memory"
          priority={priority}
          loading={loading}
          allowDownscaling
          enforceEarlyResizing
          recyclingKey={`generated:${uri}:${generatedPoster?.uri || "frame"}`}
          transition={120}
          onDisplay={() => setGeneratedPosterState((current) => (
            current.uri === uri && current.value === generatedPoster
              ? { ...current, ready: true, failed: false }
              : current
          ))}
          onError={() => {
            if (!releaseThumbnail({ uri, asset: generatedPoster })) return;
            const displayError = new Error("The generated clip preview could not be displayed.");
            sharedVideoPosterRetryPolicy.block(uri, displayError);
            setGeneratedPosterState((current) => (
              current.uri === uri && current.value === generatedPoster
                ? { uri, value: null, ready: false, failed: true }
                : current
            ));
            setThumbnailError((current) => current || displayError);
          }}
          accessibilityElementsHidden
        />
      ) : null}
      {phase !== "ready" ? (
        <View style={styles.cover} pointerEvents="none">
          {showPlayBadge ? <View style={[styles.playBadge, compact && styles.playBadgeCompact]}>
            {phase === "loading" && enabled ? (
              <ActivityIndicator size="small" color="#1A1206" />
            ) : (
              <Icon name="play" size={compact ? 13 : 17} color="#1A1206" />
            )}
          </View> : null}
          {!compact && showPlayBadge ? (
            <Text style={styles.label}>{phase === "error" ? "PREVIEW UNAVAILABLE" : phase === "idle" ? "CLIP" : "LOADING CLIP"}</Text>
          ) : null}
        </View>
      ) : null}
      {phase === "ready" ? <View style={styles.readabilityScrim} pointerEvents="none" /> : null}
      {phase === "ready" && showPlayBadge ? (
        <View style={[styles.playBadge, styles.readyBadge, compact && styles.playBadgeCompact, compact && styles.readyBadgeCompact]} pointerEvents="none">
          <Icon name="play" size={compact ? 13 : 17} color="#1A1206" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { overflow: "hidden", backgroundColor: "#11131a" },
  cover: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#11131a" },
  playBadge: { width: 48, height: 48, borderRadius: 24, borderCurve: "continuous", backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center", paddingLeft: 3 },
  playBadgeCompact: { width: 36, height: 36, borderRadius: 18, paddingLeft: 2 },
  label: { color: "rgba(255,255,255,0.62)", fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  readabilityScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,5,10,0.08)" },
  readyBadge: { position: "absolute", left: "50%", top: "50%", marginLeft: -24, marginTop: -24 },
  readyBadgeCompact: { marginLeft: -18, marginTop: -18 },
});
