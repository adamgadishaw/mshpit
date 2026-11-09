import useNativeTabPreview from "../hooks/useNativeTabPreview";
import { useLayoutEffect, useMemo, useRef } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, mono } from "../theme";
import useFeedPresentation from "../hooks/useFeedPresentation";
import useReducedMotion from "../hooks/useReducedMotion";
import useAppActive from "../lib/useAppActive";
import Icon from "./Icon";
import ClipPoster from "./ClipPoster";
import { proxied, previewSrc, isHttp, displaySrc, isVideoUrl } from "../lib/img";
import { imageLoadPolicy } from "../domain/imageLoadPolicy.mjs";
import useImageAttempt from "../hooks/useImageAttempt";
import { useFeedImageRetryPulse } from "../hooks/feedImageRetry";

function setAnimating(image, playing) {
  // architecture: allow-empty-catch -- Navigation cleanup may reach an already detached native image; a removed image needs no recovery and must not interrupt Back.
  try { image?.[playing ? "startAnimating" : "stopAnimating"]?.()?.catch?.(() => {}); } catch {}
}

// Fits any image (portrait or landscape) without ugly cropping: a blurred,
// zoomed copy fills the frame behind the real image shown in full. Apple/Spotify
// do exactly this for artist shots. Optional onPress opens it in the gallery.
// Load ladder: direct -> wsrv.nl proxy (rescues hotlink/CORS-blocked hosts) ->
// clean on-theme placeholder. Never a broken tile.
// Descriptor-declared clips (plus URL-only historical videos) render a play
// tile instead of a broken image in every grid/wall/strip; tapping still opens
// the viewer, which actually plays them.
export default function SmartImage({ uri, posterUri = null, mediaKind = null, viewable = null, style, contain = true, onPress, previewWidth = 0, cachePolicy = "memory-disk", priority = "normal", loading = null, accessibilityLabel = "Open image", accessible = true }) {
  const tabPreview = useNativeTabPreview();
  const reduced = useReducedMotion(), active = useAppActive();
  const imageRef = useRef(null);
  const original = displaySrc(uri);
  const preview = previewWidth > 0 ? previewSrc(uri, previewWidth) : original;
  const fallback = preview === original && isHttp(uri) ? proxied(uri) : original;
  const requestScope = JSON.stringify([uri, previewWidth, mediaKind]);
  const { uri: src, onError, onDisplay, nativeAttemptKey } = useImageAttempt(requestScope, [preview, fallback], useFeedImageRetryPulse());
  const policy = imageLoadPolicy({ priority, loading, viewable });
  const playing = !tabPreview && policy.autoplay && !reduced && active;
  const { current } = useFeedPresentation({ active: playing, scope: `${requestScope}:${nativeAttemptKey}:${src}` });
  // SDK57 autoplay governs image assignment; pausing an already displayed
  // GIF/WebP requires the native command too. Keep its pixels and view intact.
  useLayoutEffect(() => {
    const image = imageRef.current;
    setAnimating(image, playing && current());
    return () => setAnimating(image, false);
  }, [playing, current, src, nativeAttemptKey]);
  const displayed = (...args) => {
    onDisplay?.(...args);
    if (current()) setAnimating(imageRef.current, true);
  };
  // ExpoImage is a PureComponent. A stable source object avoids asking it to
  // reconcile the same cached image whenever a feed card updates its counters.
  const source = useMemo(() => ({ uri: src, cacheKey: src }), [src]);
  if (mediaKind === "video" || (!mediaKind && isVideoUrl(uri))) {
    const clip = <ClipPoster uri={uri} posterUri={posterUri} viewable={viewable} style={StyleSheet.absoluteFill} contain={contain} compact={!previewWidth} priority={policy.priority} loading={policy.loading} cachePolicy={cachePolicy} accessible={accessible} />;
    if (onPress) return <Pressable style={[styles.base, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel === "Open image" ? "Play video clip" : accessibilityLabel}>{clip}</Pressable>;
    return <View style={[styles.base, style]}>{clip}</View>;
  }
  // Native errors do not identify their source. A separate view per rendition
  // keeps queued primary errors bound to the primary callback after fallback.
  const inner = !src || !uri ? (
    <View
      style={[StyleSheet.absoluteFill, styles.fallback]}
      accessible={accessible}
      accessibilityRole={accessible ? "image" : undefined}
      accessibilityLabel={accessible ? `${accessibilityLabel}. Photo unavailable.` : undefined}
    >
      <Icon name="photo" size={24} color={colors.textFaint} />
      <Text style={styles.fallbackText}>PHOTO UNAVAILABLE</Text>
    </View>
  ) : (
    <>
      {contain && <View style={[StyleSheet.absoluteFill, styles.containBackdrop]} />}
      {contain && <View style={[StyleSheet.absoluteFill, styles.scrim]} />}
      <ExpoImage
        ref={imageRef}
        key={nativeAttemptKey == null ? src : `${src}:${nativeAttemptKey}`}
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit={contain ? "contain" : "cover"}
        cachePolicy={cachePolicy}
        priority={policy.priority}
        loading={policy.loading}
        autoplay={playing}
        allowDownscaling
        enforceEarlyResizing
        recyclingKey={`smart-image:${src}`}
        transition={policy.transition}
        onError={onError}
        onDisplay={displayed}
        accessible={accessible}
        accessibilityLabel={accessible ? accessibilityLabel : undefined}
      />
    </>
  );
  if (onPress) return <Pressable style={[styles.base, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>{inner}</Pressable>;
  return <View style={[styles.base, style]}>{inner}</View>;
}

const styles = StyleSheet.create({
  base: { overflow: "hidden", backgroundColor: colors.bgElev },
  containBackdrop: { backgroundColor: "#11131a" },
  scrim: { backgroundColor: "rgba(0,0,0,0.28)" },
  fallback: { alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.bgElev },
  fallbackText: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
});
