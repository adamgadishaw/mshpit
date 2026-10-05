import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Linking, View, Text, StyleSheet, Pressable, PanResponder, Platform, Modal } from "react-native";
import { colors, focusRing, mono, radius } from "../theme";
import Icon from "./Icon";
import MshpitVideoPlayer from "./media-player/MshpitVideoPlayer";
import SmartImage from "./SmartImage";
import { mediaDisplayKind, mediaDisplayUri, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import {
  galleryGestureAction,
  galleryGestureAxis,
  galleryItemPostId,
  galleryKeyAction,
  galleryVideoIsFullscreen,
  normalizedGalleryIndex,
  trappedGalleryFocusIndex,
  videoViewerUsesSideControls,
} from "../domain/mediaViewer.mjs";
import { venuePhotoAttribution, verifiedHttpsUrl } from "../domain/venuePhotoProvenance.mjs";

const web = Platform.OS === "web";

function webAttributionLinkProps(value) {
  const href = verifiedHttpsUrl(value);
  return web && href
    ? { href, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } }
    : {};
}

function ClipStage({ uri, posterUri, postId, onTrack, altText }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <View style={styles.clipStageBounds}>
      {/* Fit the picture inside a full-width control surface. Sizing the video
          element to a portrait frame also squeezes Safari's native controls. */}
      <View style={[styles.clipViewport, web && styles.clipViewportWeb]}>
        <MshpitVideoPlayer key={`${uri}:${attempt}`} uri={uri} posterUri={posterUri} postId={postId} onTrack={onTrack} altText={altText} onRetry={() => setAttempt((value) => value + 1)} />
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
  onRequireAuth,
  onRememberIndex,
  onClose,
}) {
  const [i, setI] = useState(() => normalizedGalleryIndex(index, photos.length));
  const viewerRef = useRef(null);
  const fullscreenEscapeRef = useRef(false);
  const [viewerSize, setViewerSize] = useState({ width: 0, height: 0 });
  const p = photos[i] || photos[0];
  const uri = mediaDisplayUri(p);
  const posterUri = mediaPosterUri(p);
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

  // Touch: swipe a photo sideways to move, pull it down to close. The photo
  // follows the finger and springs back when the drag is too short. The
  // responder claims only a clear move, so a tap still reaches its target.
  const swipeDrag = useRef(new Animated.ValueXY()).current;
  const swipeAxis = useRef(null);
  const swipeTargets = useRef({});
  swipeTargets.current = { next, prev, onClose, count: photos.length };
  const settleSwipe = (from = null) => {
    if (from) swipeDrag.setValue(from);
    Animated.spring(swipeDrag, { toValue: { x: 0, y: 0 }, bounciness: 0, speed: 18, useNativeDriver: !web }).start();
  };
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => galleryGestureAxis(gesture) !== null,
    onPanResponderGrant: (_, gesture) => { swipeAxis.current = galleryGestureAxis(gesture); },
    onPanResponderMove: (_, gesture) => {
      if (swipeAxis.current === "x") swipeDrag.setValue({ x: gesture.dx, y: 0 });
      else if (swipeAxis.current === "y") swipeDrag.setValue({ x: 0, y: Math.max(0, gesture.dy) });
    },
    onPanResponderRelease: (_, gesture) => {
      const targets = swipeTargets.current;
      const action = galleryGestureAction({ axis: swipeAxis.current, dx: gesture.dx, dy: gesture.dy, count: targets.count });
      swipeAxis.current = null;
      if (action === "close") { targets.onClose?.(); return; }
      if (action === "next") { targets.next(); settleSwipe({ x: 72, y: 0 }); return; }
      if (action === "prev") { targets.prev(); settleSwipe({ x: -72, y: 0 }); return; }
      settleSwipe();
    },
    onPanResponderTerminate: () => { swipeAxis.current = null; settleSwipe(); },
  }), [swipeDrag]); // eslint-disable-line react-hooks/exhaustive-deps
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
      const fullscreen = galleryVideoIsFullscreen(viewerRef.current, typeof document === "undefined" ? null : document);
      if (e.key === "Escape" && fullscreen) fullscreenEscapeRef.current = true;
      if (e.defaultPrevented || fullscreen) return;
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
    const onKeyUp = (event) => {
      if (event.key !== "Escape") return;
      const fullscreen = galleryVideoIsFullscreen(viewerRef.current, typeof document === "undefined" ? null : document);
      if (!fullscreenEscapeRef.current && !fullscreen) return;
      fullscreenEscapeRef.current = false;
      // RN Web Modal closes on document keyup. Fullscreen can already have
      // exited between keydown and keyup; consume that same dismissal gesture.
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
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
      if (event.key !== "Tab" || galleryVideoIsFullscreen(root, document)) return;
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
  const sideControls = web && video && videoViewerUsesSideControls(viewerSize);
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
      onRequestClose={() => {
        if (web && galleryVideoIsFullscreen(viewerRef.current, typeof document === "undefined" ? null : document)) return;
        onClose?.();
      }}
    >
    <View
      ref={viewerRef}
      nativeID="mshpit-media-viewer"
      style={[styles.wrap, web && styles.wrapWeb, sideControls && styles.wrapLandscape]}
      onLayout={web ? ({ nativeEvent: { layout } }) => {
        setViewerSize((current) => current.width === layout.width && current.height === layout.height
          ? current : { width: layout.width, height: layout.height });
      } : undefined}
      accessibilityViewIsModal
    >
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

      <View style={[styles.top, sideControls && styles.topLandscape]} pointerEvents="box-none">
        <Text style={styles.count}>{i + 1} / {photos.length}</Text>
        <View style={[styles.topActions, sideControls && styles.topActionsLandscape]}>
          {canReport ? (
            <Pressable
              onPress={() => {
                onRememberIndex?.(i);
                onReport({
                ...parentTarget,
                ownerId,
                mediaUri: uri,
                mediaLabel: `Specific ${video ? "video" : "photo"} ${i + 1} of ${photos.length}`,
                title: `${video ? "Video" : "Photo"}${by ? ` by ${by}` : " from a community post"}`,
                summary: "Only this attachment is identified in the report sent to moderators.",
                });
              }}
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

      <View style={[styles.stage, sideControls && styles.stageLandscape]} pointerEvents="box-none">
        {/* SmartImage = HEIC transcode + proxy-rescue ladder, so an iPhone photo
            renders here instead of a black void. Clips get a real player. */}
        {video
          ? <ClipStage key={uri} uri={uri} posterUri={posterUri} postId={currentPostId} onTrack={track} altText={altText} />
          : (
            <Animated.View style={[styles.swipeLayer, { transform: swipeDrag.getTranslateTransform() }]} {...swipe.panHandlers}>
              <SmartImage uri={uri} mediaKind="image" style={styles.img} contain accessibilityLabel={altText || "Full-size photo"} />
            </Animated.View>
          )}
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
      <View style={[styles.footer, sideControls && styles.footerLandscape]} pointerEvents="box-none">
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
          style={[styles.likeBtn, r.mine && styles.likeBtnOn, !currentPostId && styles.likeBtnDisabled]}
          onPress={(event) => {
            event?.stopPropagation?.();
            if (!session?.id) {
              onRememberIndex?.(i);
              onRequireAuth?.();
              return;
            }
            toggleMediaReaction(uri, currentPostId);
          }}
          disabled={!currentPostId}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${r.mine ? "Unlike" : "Like"} this ${video ? "video" : "photo"}, ${r.count} ${r.count === 1 ? "like" : "likes"}`}
        >
          <Icon name="heart" size={18} color={r.mine ? colors.magenta : "#fff"} filled={r.mine} />
          <Text style={[styles.likeTxt, r.mine && { color: colors.magenta }]}>{r.count}</Text>
        </Pressable>
        {photos.length > 1 && (
          <View style={[styles.dots, sideControls && styles.dotsLandscape]}>
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
  // Modal is portalled outside #root, so it needs its own dynamic viewport and
  // safe-area padding. These update on Safari chrome changes and rotation.
  wrapWeb: { flexGrow: 0, flexShrink: 1, flexBasis: "auto", height: "100dvh", maxHeight: "100dvh", width: "100%", minHeight: 0, paddingTop: "env(safe-area-inset-top, 0px)", paddingRight: "env(safe-area-inset-right, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)" },
  wrapLandscape: { flexDirection: "row" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  count: { color: "#fff", fontFamily: mono, fontSize: 13, opacity: 0.85 },
  topActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  topLandscape: { width: 88, flexShrink: 0, flexDirection: "column", justifyContent: "flex-start", gap: 12, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8 },
  topActionsLandscape: { flexDirection: "column" },
  reportBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  stage: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  stageLandscape: { marginVertical: 8 },
  img: { flex: 1, backgroundColor: "transparent" },
  swipeLayer: { flex: 1 },
  clipStageBounds: { flex: 1, width: "100%", height: "100%", minWidth: 0, minHeight: 0, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  clipViewport: { flex: 1, width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", backgroundColor: "#06070b" },
  clipViewportWeb: { maxWidth: 1280, alignSelf: "center" },
  arrow: { position: "absolute", top: "50%", marginTop: -24, width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  footer: { alignItems: "center", gap: 8, paddingBottom: 22, paddingTop: 8 },
  footerLandscape: { width: 88, flexShrink: 0, justifyContent: "center", paddingHorizontal: 8, paddingTop: 8, paddingBottom: 8 },
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
  dotsLandscape: { flexWrap: "wrap" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)" },
  dotOn: { backgroundColor: colors.amber, width: 16 },
});
