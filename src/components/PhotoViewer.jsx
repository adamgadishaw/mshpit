import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, View, Text, StyleSheet, Pressable, Platform, Modal } from "react-native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { colors, focusRing, mono, radius } from "../theme";
import Icon from "./Icon";
import ClipPoster from "./ClipPoster";
import SmartImage from "./SmartImage";
import { mediaDisplayKind, mediaDisplayUri, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import {
  galleryItemPostId,
  galleryKeyAction,
  normalizedGalleryIndex,
  trappedGalleryFocusIndex,
  videoViewerDecodedSize,
  videoViewerPhase,
  videoViewerPosterVisible,
  videoViewerViewportSize,
  videoViewerWebFrameReady,
} from "../domain/mediaViewer.mjs";
import { analyticsDurationBucket } from "../domain/analyticsPolicy.mjs";
import { pendingVideoMilestones } from "../domain/mediaAnalytics.mjs";
import { venuePhotoAttribution, verifiedHttpsUrl } from "../domain/venuePhotoProvenance.mjs";

const web = Platform.OS === "web";

function webAttributionLinkProps(value) {
  const href = verifiedHttpsUrl(value);
  return web && href
    ? { href, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } }
    : {};
}

function ClipPlayer({ uri, posterUri, postId, onRetry, onTrack, onVideoSize, altText }) {
  const player = useVideoPlayer(uri);
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
  const publishedVideoSizeRef = useRef("");
  const publishVideoSize = useCallback((size) => {
    const decoded = videoViewerDecodedSize(size);
    if (!decoded) return;
    const key = `${decoded.width}:${decoded.height}`;
    if (key === publishedVideoSizeRef.current) return;
    publishedVideoSizeRef.current = key;
    onVideoSize?.(decoded);
  }, [onVideoSize]);

  useEffect(() => {
    // Expo 56's web track metadata APIs are stubs. Web publishes dimensions
    // from VideoView's HTMLVideoElement in recordFirstFrame below; native keeps
    // using the supported track events.
    if (web) return undefined;
    const currentTrackSize = () => player.videoTrack?.size || null;
    publishVideoSize(currentTrackSize());
    const sourceSubscription = player.addListener?.("sourceLoad", ({ availableVideoTracks }) => {
      publishVideoSize(currentTrackSize() || availableVideoTracks?.find((track) => track?.size)?.size);
    });
    const trackSubscription = player.addListener?.("videoTrackChange", ({ videoTrack }) => {
      publishVideoSize(videoTrack?.size || currentTrackSize());
    });
    const statusSubscription = player.addListener?.("statusChange", () => publishVideoSize(currentTrackSize()));
    return () => {
      sourceSubscription?.remove?.();
      trackSubscription?.remove?.();
      statusSubscription?.remove?.();
    };
  }, [player, publishVideoSize]);

  useEffect(() => {
    const subscription = player.addListener?.("playingChange", ({ isPlaying }) => {
      if (isPlaying) setHasStarted(true);
    });
    return () => subscription?.remove?.();
  }, [player]);

  useEffect(() => {
    if (!player || !postId) return;
    const milestones = new Set();
    let started = false;
    try { player.timeUpdateEventInterval = 1; } catch {}
    const recordStart = (isPlaying) => {
      if (!isPlaying || started) return;
      started = true;
      trackRef.current?.("video_start", { postId, surface: "media_viewer", muted: !!player.muted });
    };
    const recordMilestone = (milestone) => {
      if (milestones.has(milestone)) return;
      milestones.add(milestone);
      trackRef.current?.("video_progress", { postId, surface: "media_viewer", milestone });
    };
    const playingSubscription = player.addListener?.("playingChange", ({ isPlaying }) => recordStart(isPlaying));
    const timeSubscription = player.addListener?.("timeUpdate", ({ currentTime }) => {
      for (const milestone of pendingVideoMilestones({ currentTime, duration: player.duration, seen: milestones })) recordMilestone(milestone);
    });
    const endSubscription = player.addListener?.("playToEnd", () => {
      for (const milestone of pendingVideoMilestones({ seen: milestones, ended: true })) recordMilestone(milestone);
    });
    recordStart(player.playing);
    return () => {
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
    if (web) publishVideoSize(videoViewRef.current?.nativeRef?.current);
    else publishVideoSize(player.videoTrack?.size);
    setHasFirstFrame(true);
    trackRef.current?.("performance", {
      metric: "video_first_frame",
      durationBucket: analyticsDurationBucket(Date.now() - mountedAt.current),
      surface: "media_viewer",
      outcome: "ok",
    });
  }, [player, publishVideoSize]);

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
    try { player.play(); }
    catch {
      trackRef.current?.("product_error", { code: "video_play_failed", surface: "media_viewer", retryable: true });
    }
  };

  return (
    <>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={web ? styles.webVideo : styles.img}
        contentFit="contain"
        nativeControls
        playsInline
        useExoShutter={false}
        onFirstFrameRender={recordFirstFrame}
        accessibilityLabel={altText || "Video clip player"}
        accessible={hasFirstFrame}
        accessibilityElementsHidden={!hasFirstFrame}
        importantForAccessibility={hasFirstFrame ? "auto" : "no-hide-descendants"}
      />
      {posterVisible && (
        <ClipPoster uri={uri} posterUri={posterUri} viewable style={styles.videoStatus} contain accessibilityLabel={altText || "Video preview; use the player controls to play"} accessible={false} />
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
      {phase === "error" && (
        <View style={styles.videoError} accessibilityLiveRegion="assertive">
          <Text style={styles.videoErrorTitle}>This video could not play</Text>
          <Text style={styles.videoErrorText}>The browser may not support its format, or the connection was interrupted.</Text>
          <View style={styles.videoErrorActions}>
            <Pressable style={styles.videoAction} onPress={onRetry} accessibilityRole="button">
              <Text style={styles.videoActionText}>Try again</Text>
            </Pressable>
            <Pressable style={styles.videoAction} onPress={() => Linking.openURL(uri).catch(() => {})} accessibilityRole="link">
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
function ClipStage({ uri, posterUri, postId, onTrack, altText, width = 0, height = 0 }) {
  const [attempt, setAttempt] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState({ width: Number(width) || 0, height: Number(height) || 0 });
  const handleVideoSize = useCallback((next) => {
    setVideoSize((current) => current.width === next.width && current.height === next.height ? current : next);
  }, []);
  const viewportSize = web ? videoViewerViewportSize({
    containerWidth: containerSize.width,
    containerHeight: containerSize.height,
    videoWidth: videoSize.width,
    videoHeight: videoSize.height,
  }) : null;
  return (
    <View
      style={styles.clipStageBounds}
      onLayout={web ? (event) => {
        const next = event.nativeEvent.layout;
        setContainerSize((current) => current.width === next.width && current.height === next.height
          ? current
          : { width: next.width, height: next.height });
      } : undefined}
    >
      <View style={[
        styles.clipViewport,
        web && styles.clipViewportWeb,
        web && viewportSize ? {
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: viewportSize.height,
          width: viewportSize.width,
          height: viewportSize.height,
        } : null,
      ]}>
        <ClipPlayer key={`${uri}:${attempt}`} uri={uri} posterUri={posterUri} postId={postId} onTrack={onTrack} onVideoSize={handleVideoSize} altText={altText} onRetry={() => setAttempt((value) => value + 1)} />
      </View>
    </View>
  );
}

// Facebook-style full-screen media viewer: every photo set on the app (review
// photos, fan galleries, venue shots) opens here. Arrows / keyboard to move,
// backdrop or Esc to close, and each photo carries its OWN like - reactions
// key on the photo's durable URL, so a like given from a post follows the same
// photo into the artist's rolling gallery.
export default function PhotoViewer({
  photos = [],
  index = 0,
  postId = null,
  returnFocusRef = null,
  session,
  mediaReactions = {},
  loadMediaReactions,
  toggleMediaReaction,
  track,
  onReport,
  onClose,
}) {
  const [i, setI] = useState(() => normalizedGalleryIndex(index, photos.length));
  const viewerRef = useRef(null);
  const p = photos[i] || photos[0];
  const uri = mediaDisplayUri(p);
  const posterUri = mediaPosterUri(p);
  const mediaWidth = typeof p === "object" && p ? Number(p.width) || 0 : 0;
  const mediaHeight = typeof p === "object" && p ? Number(p.height) || 0 : 0;
  const altText = typeof p === "object" && p ? p.altText || "" : "";
  const by = typeof p === "object" && p ? p.by : null;
  const venueAttribution = venuePhotoAttribution(p);
  const [attributionError, setAttributionError] = useState("");
  const currentPostId = galleryItemPostId(p, postId);
  const reactionItems = photos.map((item) => ({
    url: mediaDisplayUri(item),
    postId: galleryItemPostId(item, postId),
  })).filter((item) => item.url && item.postId);
  const reactionScope = reactionItems.map((item) => `${item.postId}:${item.url}`).join("|");
  const prev = () => setI((x) => (x - 1 + photos.length) % photos.length);
  const next = () => setI((x) => (x + 1) % photos.length);
  const dotWindowSize = 12;
  const dotStart = Math.max(0, Math.min(
    i - Math.floor(dotWindowSize / 2),
    photos.length - dotWindowSize,
  ));
  const visibleDots = photos.slice(dotStart, dotStart + dotWindowSize);

  useEffect(() => {
    setI(normalizedGalleryIndex(index, photos.length));
  }, [index, photos.length]);

  useEffect(() => {
    setAttributionError("");
  }, [venueAttribution?.sourcePage, venueAttribution?.licenseUrl]);

  // One batch read when the set opens; likes render instantly after.
  useEffect(() => { loadMediaReactions(reactionItems); }, [reactionScope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: arrows navigate, Escape closes (web).
  useEffect(() => {
    if (!web || typeof window === "undefined") return;
    const onKey = (e) => {
      const action = galleryKeyAction({
        key: e.key,
        tagName: e.target?.tagName,
        isContentEditable: !!e.target?.isContentEditable,
      });
      if (action === "close") onClose?.();
      else if (action === "previous" && photos.length > 1) prev();
      else if (action === "next" && photos.length > 1) next();
      if (action) e.preventDefault?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length, onClose]);

  // React Native's web Modal does not consistently trap focus or return it to
  // the thumbnail that opened the viewer. Keep keyboard users inside the modal,
  // focus the real close button first, and restore the opener on teardown.
  useEffect(() => {
    if (!web || typeof document === "undefined") return undefined;
    const root = viewerRef.current;
    if (!root?.querySelectorAll) return undefined;
    // RN Web's Modal portal may already have focused <body> by this effect.
    // App captures the real thumbnail synchronously in openPhotos and passes it
    // through a ref that is deliberately excluded from persisted nav state.
    const previous = returnFocusRef?.current || document.activeElement;
    const focusable = () => Array.from(root.querySelectorAll(
      'button,[href],[role="button"],[role="link"],video,[tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      !element.hasAttribute?.("disabled")
      && element.getAttribute?.("aria-disabled") !== "true"
      && element.getAttribute?.("aria-hidden") !== "true"
      && !element.closest?.('[aria-hidden="true"]')
      && element.getClientRects?.().length > 0
      && (!!element.getAttribute?.("aria-label") || !!element.textContent?.trim() || element.tagName === "VIDEO")
    ));
    const focusElement = (element) => {
      try { element?.focus?.({ preventScroll: true }); } catch { try { element?.focus?.(); } catch {} }
    };
    const frame = requestAnimationFrame(() => {
      focusElement(root.querySelector?.('[aria-label="Close"]') || focusable()[0]);
    });
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const target = trappedGalleryFocusIndex({
        currentIndex: elements.indexOf(document.activeElement),
        count: elements.length,
        shiftKey: event.shiftKey,
      });
      if (target == null) return;
      event.preventDefault();
      focusElement(elements[target]);
    };
    root.addEventListener("keydown", trapFocus);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("keydown", trapFocus);
      // The app shell owns focus restoration when it supplied an opener ref.
      // RN Web's Modal portal is still tearing down during this cleanup and
      // would overwrite a synchronous focus() call with <body>.
      if (!returnFocusRef && previous?.isConnected) {
        setTimeout(() => {
          if (previous?.isConnected) focusElement(previous);
        }, 0);
      }
    };
  }, [returnFocusRef]);

  if (!photos.length) return null;
  const r = (uri && mediaReactions[uri]) || { count: 0, mine: false };
  const video = mediaDisplayKind(p) === "video";
  const ownerId = typeof p === "object" && p ? p.ownerId : null;
  const parentTarget = typeof p === "object" && p?.artistProfileKey
    ? { targetType: "artist_profile", targetId: p.artistProfileKey, targetName: video ? "artist profile video" : "artist profile photo" }
    : typeof p === "object" && p?.venueReviewId
    ? { targetType: "venue_review", targetId: p.venueReviewId, targetName: video ? "video" : "photo" }
    : currentPostId
      ? { targetType: "post", targetId: currentPostId, targetName: video ? "video" : "photo" }
      : null;
  const canReport = !!onReport && !!parentTarget?.targetId && (!session || !ownerId || session.id !== ownerId);
  const openAttributionLink = (value, label) => {
    setAttributionError("");
    const url = verifiedHttpsUrl(value);
    if (!url) {
      setAttributionError(`${label} is unavailable.`);
      return;
    }
    if (web) return;
    void Linking.openURL(url).catch(() => setAttributionError(`${label} could not be opened on this device.`));
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onClose}
    >
    <View ref={viewerRef} style={styles.wrap} accessibilityViewIsModal>
      {/* Backdrop closes, like every photo lightbox people already know. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessible={false}
        focusable={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        {...(web ? { tabIndex: -1, "aria-hidden": true } : null)}
      />

      <View style={styles.top} pointerEvents="box-none">
        <Text style={styles.count}>{i + 1} / {photos.length}</Text>
        <View style={styles.topActions}>
          {canReport ? (
            <Pressable
              onPress={() => onReport({
                ...parentTarget,
                ownerId,
                mediaUri: uri,
                mediaLabel: `Specific ${video ? "video" : "photo"} ${i + 1} of ${photos.length}`,
                title: `${video ? "Video" : "Photo"}${by ? ` by ${by}` : " from a community post"}`,
                summary: "Only this attachment is identified in the report sent to moderators.",
              })}
              hitSlop={8}
              style={styles.reportBtn}
              accessibilityRole="button"
              accessibilityLabel={`Report this ${video ? "video" : "photo"}`}
            >
              <Icon name="flag" size={17} color="#fff" />
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="x" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>

      <View style={styles.stage} pointerEvents="box-none">
        {/* SmartImage = HEIC transcode + proxy-rescue ladder, so an iPhone photo
            renders here instead of a black void. Clips get a real player. */}
        {video
          ? <ClipStage key={uri} uri={uri} posterUri={posterUri} postId={currentPostId} onTrack={track} altText={altText} width={mediaWidth} height={mediaHeight} />
          : <SmartImage uri={uri} mediaKind="image" style={styles.img} contain accessibilityLabel={altText || "Full-size photo"} />}
        {photos.length > 1 && (
          <>
            <Pressable style={[styles.arrow, { left: 10 }]} onPress={prev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous media">
              <Icon name="chevron-left" size={26} color="#fff" />
            </Pressable>
            <Pressable style={[styles.arrow, { right: 10 }]} onPress={next} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next media">
              <Icon name="chevron-right" size={26} color="#fff" />
            </Pressable>
          </>
        )}
      </View>

      {/* The photo's own footer: who shot it + its own like. */}
      <View style={styles.footer} pointerEvents="box-none">
        {venueAttribution ? (
          <View style={styles.venueAttribution} accessible={false}>
            <Text style={styles.by} selectable>{`Photo by ${venueAttribution.creator} · ${venueAttribution.license}`}</Text>
            <View style={styles.venueAttributionActions}>
              <Pressable
                {...webAttributionLinkProps(venueAttribution.sourcePage)}
                onPress={() => openAttributionLink(venueAttribution.sourcePage, "Photo source")}
                style={({ pressed, focused }) => [styles.venueAttributionLink, pressed && styles.venueAttributionLinkPressed, focused && focusRing]}
                accessibilityRole="link"
                accessibilityLabel={`Photo by ${venueAttribution.creator}. Open original source in browser.`}
              >
                <Text style={styles.venueAttributionLinkText}>SOURCE</Text>
                <Icon name="external" size={12} color="rgba(255,255,255,0.72)" />
              </Pressable>
              <Pressable
                {...webAttributionLinkProps(venueAttribution.licenseUrl)}
                onPress={() => openAttributionLink(venueAttribution.licenseUrl, "License terms")}
                style={({ pressed, focused }) => [styles.venueAttributionLink, pressed && styles.venueAttributionLinkPressed, focused && focusRing]}
                accessibilityRole="link"
                accessibilityLabel={`Open ${venueAttribution.license} license terms in browser`}
              >
                <Text style={styles.venueAttributionLinkText}>LICENSE</Text>
                <Icon name="external" size={12} color="rgba(255,255,255,0.72)" />
              </Pressable>
            </View>
            {venueAttribution.modificationNotice ? (
              <Text style={styles.venueModificationNotice} selectable>{venueAttribution.modificationNotice}</Text>
            ) : null}
            {attributionError ? (
              <Text style={styles.venueAttributionError} accessibilityRole="alert" accessibilityLiveRegion="assertive">{attributionError}</Text>
            ) : null}
          </View>
        ) : !!by ? (
          <Text style={styles.by}>{video ? "Shared" : "Photo"} by {by}</Text>
        ) : null}
        <Pressable
          style={[styles.likeBtn, r.mine && styles.likeBtnOn, (!session || !currentPostId) && styles.likeBtnDisabled]}
          onPress={() => toggleMediaReaction(uri, currentPostId)}
          disabled={!session || !currentPostId}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${r.mine ? "Unlike" : "Like"} this ${video ? "video" : "photo"}, ${r.count} ${r.count === 1 ? "like" : "likes"}`}
        >
          <Icon name="heart" size={18} color={r.mine ? colors.magenta : "#fff"} filled={r.mine} />
          <Text style={[styles.likeTxt, r.mine && { color: colors.magenta }]}>{r.count}</Text>
        </Pressable>
        {photos.length > 1 && (
          <View style={styles.dots}>
            {visibleDots.map((_, offset) => {
              const mediaIndex = dotStart + offset;
              return <View key={mediaIndex} style={[styles.dot, mediaIndex === i && styles.dotOn]} />;
            })}
          </View>
        )}
      </View>
    </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(6,7,11,0.98)" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  count: { color: "#fff", fontFamily: mono, fontSize: 13, opacity: 0.85 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  reportBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  stage: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  img: { flex: 1, backgroundColor: "transparent" },
  clipStageBounds: { flex: 1, width: "100%", height: "100%", minWidth: 0, minHeight: 0, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  clipViewport: { flex: 1, width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: "#06070b" },
  clipViewportWeb: { maxWidth: 1280, alignSelf: "center" },
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
  arrow: { position: "absolute", top: "50%", marginTop: -24, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  footer: { alignItems: "center", gap: 8, paddingBottom: 22, paddingTop: 8 },
  by: { color: "rgba(255,255,255,0.7)", fontSize: 13, textAlign: "center" },
  venueAttribution: { width: "100%", maxWidth: 680, alignItems: "center", gap: 7, paddingHorizontal: 16 },
  venueAttributionActions: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  venueAttributionLink: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.08)" },
  venueAttributionLinkPressed: { opacity: 0.72 },
  venueAttributionLinkText: { color: "rgba(255,255,255,0.84)", fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 0.7 },
  venueModificationNotice: { color: "rgba(255,255,255,0.56)", fontSize: 10.5, lineHeight: 15, textAlign: "center" },
  venueAttributionError: { color: colors.danger, fontSize: 11.5, lineHeight: 16, textAlign: "center" },
  likeBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,255,255,0.10)", borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9 },
  likeBtnOn: { backgroundColor: "rgba(217,70,160,0.16)" },
  likeBtnDisabled: { opacity: 0.55 },
  likeTxt: { color: "#fff", fontFamily: mono, fontSize: 14, fontWeight: "800" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, paddingTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotOn: { backgroundColor: colors.amber, width: 16 },
});
