import { memo, useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme";
import Icon from "../../components/Icon";
import SmartImage from "../../components/SmartImage";
import ClipPoster from "../../components/ClipPoster";
import { mediaDisplayKind, mediaPosterUri } from "../../domain/postMediaDisplay.mjs";
import { FeedImageRetryProvider, useFeedImageRetry } from "../../hooks/feedImageRetry";

export const ProfileMediaRetryBoundary = FeedImageRetryProvider;

export function useProfileMediaPresentation({ scope, user, gallery: galleryViewerItems, onOpenPhotos }) {
  // Native event callbacks can arrive after a profile/account or its media
  // changes. Never open an obsolete descriptor (including revoked photos).
  const mediaScope = scope;
  const mediaActionsRef = useRef(null);
  const mediaLifetimeRef = useRef(null);
  const mediaRequestRef = useRef(null);
  if (!mediaLifetimeRef.current || mediaLifetimeRef.current.scope !== mediaScope || mediaLifetimeRef.current.banner !== user?.banner) {
    mediaLifetimeRef.current = { scope: mediaScope, banner: user?.banner };
  }
  const mediaLifetime = mediaLifetimeRef.current;
  const mediaMountedRef = useRef(true);
  mediaActionsRef.current = { lifetime: mediaLifetime, scope: mediaScope, banner: user?.banner, gallery: galleryViewerItems, onOpenPhotos };
  useEffect(() => {
    mediaMountedRef.current = true;
    return () => { mediaMountedRef.current = false; };
  }, []);
  const openIOSGallery = useCallback((items, index, postId) => {
    const current = mediaActionsRef.current;
    if (!mediaMountedRef.current || current.lifetime !== mediaLifetime || current.gallery !== items) return;
    current.onOpenPhotos?.(items, index, postId);
  }, [mediaLifetime]);
  const bannerUri = user?.banner;
  const bannerAlt = `${user?.name || "Member"}'s profile banner`;
  const openIOSBanner = useCallback(() => {
    const current = mediaActionsRef.current;
    if (!mediaMountedRef.current || current.lifetime !== mediaLifetime || current.banner !== bannerUri || !bannerUri) return;
    // A profile banner is not a post attachment. No inherited post ID, owner
    // report target, or reaction identity belongs in this viewer payload.
    current.onOpenPhotos?.([{ uri: bannerUri, kind: "image", altText: bannerAlt }], 0, null);
  }, [bannerAlt, bannerUri, mediaLifetime]);
  const requestIOSGallery = useCallback((action) => {
    if (!mediaMountedRef.current || mediaActionsRef.current.lifetime !== mediaLifetime) return;
    if (mediaRequestRef.current?.lifetime === mediaLifetime) return mediaRequestRef.current.promise;
    const request = { lifetime: mediaLifetime, promise: null };
    mediaRequestRef.current = request;
    request.promise = Promise.resolve().then(() => {
      if (!mediaMountedRef.current || mediaActionsRef.current.lifetime !== mediaLifetime) return;
      return action();
    });
    const settle = () => { if (mediaRequestRef.current === request) mediaRequestRef.current = null; };
    void request.promise.then(settle, settle);
    return request.promise;
  }, [mediaLifetime]);
  const imageRetry = useFeedImageRetry(scope);
  return { openBanner: openIOSBanner, openGallery: openIOSGallery, request: requestIOSGallery, retryImages: imageRetry.accept, retryValue: imageRetry.value };
}

export function ProfileBannerCover({ uri, name, onOpen, largeText = false }) {
  return (
    <Pressable testID="profile-banner-open" style={styles.bannerCover} onPress={onOpen} disabled={!onOpen}
      accessibilityRole={onOpen ? "button" : "image"} accessibilityLabel={onOpen ? `View ${name}'s full-size profile banner` : `${name}'s profile banner`}
      accessibilityHint={onOpen ? "Opens the original photo" : undefined}>
      <SmartImage uri={uri} mediaKind="image" style={StyleSheet.absoluteFill} contain={false} accessible={false} />
      {onOpen ? <View pointerEvents="none" style={styles.bannerView} accessible={false}>
        <Icon name="photo" size={18} color="#FFFFFF" />
        {!largeText ? <Text style={styles.bannerViewText}>View photo</Text> : null}
      </View> : null}
    </Pressable>
  );
}

const GalleryTile = memo(function GalleryTile({ item, index, items, onOpen }) {
  const video = mediaDisplayKind(item) === "video";
  const authoredAlt = typeof item.altText === "string" ? item.altText.trim() : "";
  return (
    <Pressable testID={`profile-gallery-item-${index}`} style={styles.galleryCell} onPress={() => onOpen?.(items, index, item.postId)} disabled={!onOpen}
      accessibilityRole="button" accessibilityLabel={authoredAlt || `Open profile ${video ? "video" : "photo"} ${index + 1}`}
      accessibilityState={{ disabled: !onOpen }} accessibilityHint={video ? "Opens the video player" : "Opens the full-size photo"}>
      {video ? <ClipPoster uri={item.uri} posterUri={mediaPosterUri(item)} style={StyleSheet.absoluteFill} compact accessibilityLabel={authoredAlt || "Concert video preview"} accessible={false} />
        : <SmartImage uri={item.uri} mediaKind="image" style={StyleSheet.absoluteFill} contain={false} previewWidth={720} accessibilityLabel={authoredAlt || "Concert photo"} accessible={false} />}
    </Pressable>
  );
});

export function ProfileGallery({ items, history, isSelf, name, onOpen, onRefresh, refreshing, request }) {
  const loading = history.status === "idle" || history.status === "loading" || history.status === "refreshing";
  const confirmed = history.status === "ready" && history.complete;
  const busy = refreshing || loading || history.loadingMore;
  const preview = items.slice(0, 3);
  const count = items.length || confirmed ? ` · ${items.length}${confirmed ? "" : "+"}` : "";
  return (
    <View testID="profile-gallery">
      <View style={styles.galleryHeader}>
        <Text style={styles.galleryTitle} accessibilityRole="header">Gallery{count}</Text>
        <Pressable testID="profile-gallery-refresh" style={styles.galleryRefresh} onPress={() => request(onRefresh)} disabled={busy}
          accessibilityRole="button" accessibilityLabel="Refresh gallery photos and posts" accessibilityState={{ disabled: busy, busy }}>
          <Text style={styles.actionText}>{refreshing ? "Refreshing…" : "Refresh"}</Text>
        </Pressable>
      </View>
      {preview.length ? <View style={styles.gallery}>
        {preview.map((item, index) => <GalleryTile key={item.id || `${item.postId || "post"}:${item.uri}:${index}`} item={item} index={index} items={items} onOpen={onOpen} />)}
      </View> : null}
      {items.length > preview.length && onOpen ? <Pressable style={styles.gallerySeeAll} onPress={() => onOpen(items, 0, items[0]?.postId || null)}
        accessibilityRole="button" accessibilityLabel={`View ${items.length} loaded media items from ${name}`}>
        <Text style={styles.actionText}>View loaded photos and videos</Text>
        <Icon name="chevron-right" size={16} color={colors.amber} />
      </Pressable> : null}
      <View testID="profile-gallery-state" style={styles.galleryState} accessibilityLiveRegion="polite">
        {loading || history.loadingMore ? <View style={styles.galleryLoading}>
          <ActivityIndicator size="small" color={colors.amber} />
          <Text style={styles.stateText}>{history.loadingMore ? "Loading earlier posts…" : items.length ? "Refreshing gallery…" : "Loading gallery…"}</Text>
        </View> : history.error ? <>
          <Text style={styles.stateText}>{items.length ? "Some photos and videos are shown. More could not be checked." : "Gallery could not be loaded. Try again to check photos and videos."}</Text>
          <Pressable style={styles.galleryRetry} onPress={() => request(onRefresh)} accessibilityRole="button" accessibilityLabel="Refresh gallery after loading error">
            <Text style={styles.actionText}>Refresh gallery</Text>
          </Pressable>
        </> : confirmed && items.length === 0 ? <Text style={styles.stateText}>{isSelf ? "Photos and videos you attach to posts appear here." : "No shared photos or videos yet."}</Text>
          : !history.complete ? <Text style={styles.stateText}>{items.length ? "Showing media from loaded posts. Earlier posts may have more." : "No media in the posts loaded so far. Earlier posts may have photos or videos."}</Text> : null}
        {!loading && !history.loadingMore && history.nextCursor ? (
          <Pressable testID="profile-gallery-load-earlier" style={styles.galleryRetry} onPress={() => request(history.loadMore)} accessibilityRole="button" accessibilityLabel="Load earlier posts for gallery">
            <Text style={styles.actionText}>Load earlier posts</Text>
            <Icon name="chevron-down" size={16} color={colors.amber} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerCover: { marginHorizontal: 20, aspectRatio: 3, minHeight: 100, borderRadius: 18, overflow: "hidden", backgroundColor: colors.surfaceAlt },
  bannerView: { position: "absolute", right: 8, bottom: 8, minHeight: 44, minWidth: 44, maxWidth: "90%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.72)" },
  bannerViewText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", flexShrink: 1 },
  galleryHeader: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, marginHorizontal: 24, marginTop: 24, marginBottom: 8 },
  galleryTitle: { color: colors.text, fontSize: 22, fontWeight: "700", letterSpacing: -0.35, flexShrink: 1 },
  galleryRefresh: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8 },
  gallery: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginHorizontal: 24 },
  galleryCell: { width: "32%", aspectRatio: 1, minWidth: 44, minHeight: 44, backgroundColor: colors.surfaceAlt, borderRadius: 10, overflow: "hidden" },
  gallerySeeAll: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 24, paddingVertical: 10 },
  actionText: { color: colors.amber, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  galleryState: { marginHorizontal: 24, marginTop: 10, gap: 6 },
  stateText: { color: colors.textDim, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  galleryLoading: { flexDirection: "row", alignItems: "center", gap: 10 },
  galleryRetry: { alignSelf: "flex-start", minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
});
