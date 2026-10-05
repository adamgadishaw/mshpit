import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, radius } from "../../theme";
import Icon from "../Icon";
import ClipPoster from "../ClipPoster";
import useAppActive from "../../lib/useAppActive";
import { videoViewerPhase, videoViewerPosterVisible, videoViewerWebFrameReady } from "../../domain/mediaViewer.mjs";
import { analyticsDurationBucket } from "../../domain/analyticsPolicy.mjs";
import { createPlaybackMeasurement } from "../../domain/playbackMeasurement.mjs";
import { startVideoPlayback } from "../../domain/startVideoPlayback.mjs";
const web = Platform.OS === "web";

// First-party playback of finalized Mshpit media. No ad SDK or tracker.
// YouTube remains a separate provider and cannot inherit monetization rights.
export default function MshpitVideoPlayer({ uri, posterUri, postId, onRetry, onTrack, altText }) {
  const appActive = useAppActive();
  const activeRef = useRef(appActive);
  activeRef.current = appActive;
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.staysActiveInBackground = false;
  });
  const [controlError, setControlError] = useState("");
  useEffect(() => {
    if (!appActive) {
      try { player.pause(); } catch { /* Player may already have been released. */ }
    }
  }, [appActive, player]);
  const videoViewRef = useRef(null);
  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
    error: null,
  });
  const [hasFirstFrame, setHasFirstFrame] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const mountedAt = useRef(Date.now());
  const trackedError = useRef(false);
  const trackedFirstFrame = useRef(false);
  const trackRef = useRef(onTrack);
  trackRef.current = onTrack;
  const phase = videoViewerPhase({ status, error, hasFirstFrame });
  const posterVisible = videoViewerPosterVisible({ phase });

  useEffect(() => {
    const subscription = player.addListener?.("playingChange", ({ isPlaying }) => {
      if (isPlaying) setHasStarted(true);
    });
    return () => subscription?.remove?.();
  }, [player]);

  useEffect(() => {
    if (!player || !postId) return;
    const measurement = createPlaybackMeasurement();
    let started = false;
    player.timeUpdateEventInterval = 1;
    const recordStart = (isPlaying) => {
      if (!isPlaying || !activeRef.current || started) return;
      started = true;
      trackRef.current?.("video_start", { postId, surface: "media_viewer", muted: !!player.muted });
    };
    const measure = (ended = false) => {
      const pending = measurement.sample({
        currentTime: player.currentTime, duration: player.duration,
        playing: ended || player.playing, visible: activeRef.current,
        playbackRate: player.playbackRate, ended,
      });
      for (const milestone of pending) trackRef.current?.("video_progress", {
        postId, surface: "media_viewer", milestone, measurement: "watched-v1",
      });
    };
    const playingSubscription = player.addListener?.("playingChange", ({ isPlaying }) => {
      if (!isPlaying) measurement.interrupt();
      recordStart(isPlaying);
    });
    const timeSubscription = player.addListener?.("timeUpdate", () => measure());
    const endSubscription = player.addListener?.("playToEnd", () => measure(true));
    recordStart(player.playing);
    return () => {
      // Expo web keeps this timer after its VideoView unmounts. Stop the
      // interval we own before releasing listeners or replacing the player.
      try { player.timeUpdateEventInterval = 0; } catch { /* Native player may already be released. */ }
      playingSubscription?.remove?.();
      timeSubscription?.remove?.();
      endSubscription?.remove?.();
    };
  }, [player, postId]);

  useEffect(() => {
    if (phase !== "error" || trackedError.current) return;
    trackedError.current = true;
    trackRef.current?.("product_error", { code: "video_load_failed", surface: "media_viewer", retryable: true });
  }, [phase]);

  const recordFirstFrame = useCallback(() => {
    if (trackedFirstFrame.current) return;
    trackedFirstFrame.current = true;
    setHasFirstFrame(true);
    trackRef.current?.("performance", {
      metric: "video_first_frame",
      durationBucket: analyticsDurationBucket(Date.now() - mountedAt.current),
      surface: "media_viewer",
      outcome: "ok",
    });
  }, []);

  useEffect(() => {
    if (!web || hasFirstFrame || phase === "error") return undefined;
    const probe = () => {
      const element = videoViewRef.current?.nativeRef?.current;
      if (videoViewerWebFrameReady(element)) recordFirstFrame();
    };
    probe();
    const timer = setInterval(probe, 125);
    return () => clearInterval(timer);
  }, [hasFirstFrame, phase, recordFirstFrame]);

  const startPlayback = () => {
    setControlError("");
    startVideoPlayback({ player, web, element: videoViewRef.current?.nativeRef?.current }).catch(() => {
      if (!mountedRef.current) return;
      setControlError("Playback could not start. Try again or reload this video.");
      trackRef.current?.("product_error", { code: "video_play_failed", surface: "media_viewer", retryable: true });
    });
  };

  return (
    <>
      {/* Hand the explicit first gesture to native playback controls, without
          retaining a second control layer over the playing video. */}
      <VideoView
        ref={videoViewRef}
        player={player}
        style={web ? styles.webVideo : styles.img}
        contentFit="contain"
        nativeControls={hasStarted && phase !== "error"}
        fullscreenOptions={{ enable: true }}
        allowsPictureInPicture={web}
        startsPictureInPictureAutomatically={false}
        playsInline
        useExoShutter={false}
        onFirstFrameRender={recordFirstFrame}
        accessibilityLabel={altText || "Mshpit video player"}
        accessible={hasFirstFrame}
        accessibilityElementsHidden={!hasFirstFrame}
        importantForAccessibility={hasFirstFrame ? "auto" : "no-hide-descendants"}
      />
      {posterVisible && (
        <ClipPoster uri={uri} posterUri={posterUri} viewable style={styles.videoStatus} contain showPlayBadge={false} accessibilityLabel={altText || "Video preview; use the player controls to play"} accessible={false} />
      )}
      {phase !== "error" && !hasStarted ? (
        <Pressable
          style={({ pressed, focused }) => [styles.videoStart, pressed && styles.videoStartPressed, focused && styles.videoStartFocused]}
          onPress={startPlayback}
          accessibilityRole="button"
          accessibilityLabel={`Play video${altText ? `. ${altText}` : ""}`}
        >
          <Icon name="play" size={18} color="#1A1206" />
          <Text style={styles.videoStartText}>Play video</Text>
        </Pressable>
      ) : null}
      {!!controlError && <Text selectable accessibilityLiveRegion="polite" style={styles.controlError}>{controlError}</Text>}
      {phase === "error" && (
        <View style={styles.videoError} accessibilityLiveRegion="assertive">
          <Text style={styles.videoErrorTitle}>This video could not play</Text>
          <Text style={styles.videoErrorText}>The browser may not support its format, or the connection was interrupted.</Text>
          <View style={styles.videoErrorActions}>
            <Pressable style={styles.videoAction} onPress={onRetry} accessibilityRole="button">
              <Text style={styles.videoActionText}>Try again</Text>
            </Pressable>
            <Pressable style={styles.videoAction} onPress={() => Linking.openURL(uri).catch(() => {
              if (mountedRef.current) setControlError("This video could not open. Please try again.");
            })} accessibilityRole="link">
              <Text style={styles.videoActionText}>Open video</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}

// A clip inside the viewer: expo-video with the platform's own controls (a
// <video> element on web). The web element must be absolutely bounded: a
// portrait video's intrinsic height otherwise expands React Native Web's flex
// child beyond the modal viewport and pushes its picture/controls off-screen.
// Remounting on retry also releases the failed player cleanly.
const styles = StyleSheet.create({
  img: { flex: 1, backgroundColor: "transparent" },
  webVideo: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", backgroundColor: "transparent" },
  videoStatus: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 10 },
  videoStart: { position: "absolute", left: "50%", top: "50%", zIndex: 4, minHeight: 46, transform: [{ translateX: -62 }, { translateY: -23 }], flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 17, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, backgroundColor: colors.amberStrong },
  videoStartPressed: { opacity: 0.82, transform: [{ translateX: -62 }, { translateY: -21 }] },
  videoStartFocused: { boxShadow: "0 0 0 3px rgba(242,166,90,0.42)" },
  videoStartText: { color: "#1A1206", fontSize: 13, fontWeight: "900" },
  videoError: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24, backgroundColor: "rgba(6,7,11,0.9)" },
  videoErrorTitle: { color: "#fff", fontSize: 17, fontWeight: "800", textAlign: "center" },
  videoErrorText: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 19, textAlign: "center", maxWidth: 380 },
  videoErrorActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 2 },
  videoAction: { minHeight: 44, justifyContent: "center", borderRadius: radius.pill, paddingHorizontal: 16, backgroundColor: "rgba(255,255,255,0.12)" },
  videoActionText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  controlError: { position: "absolute", bottom: 60, left: 12, right: 12, color: "#fff", backgroundColor: "#401923", padding: 12, borderRadius: 8 },
});
