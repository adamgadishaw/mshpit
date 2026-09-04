import { useCallback, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, mono } from "../theme";
import Icon from "./Icon";
import ClipPoster from "./ClipPoster";
import { proxied, previewSrc, isHttp, displaySrc, isVideoUrl } from "../lib/img";
import { imageLoadPolicy } from "../domain/imageLoadPolicy.mjs";

// Fits any image (portrait or landscape) without ugly cropping: a blurred,
// zoomed copy fills the frame behind the real image shown in full. Apple/Spotify
// do exactly this for artist shots. Optional onPress opens it in the gallery.
// Load ladder: direct -> wsrv.nl proxy (rescues hotlink/CORS-blocked hosts) ->
// clean on-theme placeholder. Never a broken tile.
// Descriptor-declared clips (plus URL-only historical videos) render a play
// tile instead of a broken image in every grid/wall/strip; tapping still opens
// the viewer, which actually plays them.
export default function SmartImage({ uri, posterUri = null, mediaKind = null, viewable = null, style, contain = true, onPress, previewWidth = 0, cachePolicy = "memory-disk", priority = "normal", loading = null, accessibilityLabel = "Open image", accessible = true }) {
  const requestScope = `${String(uri || "")}|${previewWidth}|${String(mediaKind || "")}`;
  const activeScopeRef = useRef(requestScope);
  activeScopeRef.current = requestScope;
  const [loadState, setLoadState] = useState({ scope: requestScope, stage: 0 });
  const stage = loadState.scope === requestScope ? loadState.stage : 0; // 0 preferred source, 1 fallback, 2 dead
  const fail = useCallback(() => {
    setLoadState((current) => {
      if (activeScopeRef.current !== requestScope) return current;
      const currentStage = current.scope === requestScope ? current.stage : 0;
      if (currentStage >= 2) return current.scope === requestScope ? current : { scope: requestScope, stage: 2 };
      return { scope: requestScope, stage: currentStage + 1 };
    });
  }, [requestScope]);
  const original = displaySrc(uri);
  const preview = previewWidth > 0 ? previewSrc(uri, previewWidth) : original;
  const src = stage === 1 ? (preview === original && isHttp(uri) ? proxied(uri) : original) : preview;
  const policy = imageLoadPolicy({ priority, loading, viewable });
  // ExpoImage is a PureComponent. A stable source object avoids asking it to
  // reconcile the same cached image whenever a feed card updates its counters.
  const source = useMemo(() => ({ uri: src, cacheKey: src }), [src]);
  if (mediaKind === "video" || (!mediaKind && isVideoUrl(uri))) {
    const clip = <ClipPoster uri={uri} posterUri={posterUri} viewable={viewable} style={StyleSheet.absoluteFill} contain={contain} compact={!previewWidth} priority={policy.priority} loading={policy.loading} accessible={accessible} />;
    if (onPress) return <Pressable style={[styles.base, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel === "Open image" ? "Play video clip" : accessibilityLabel}>{clip}</Pressable>;
    return <View style={[styles.base, style]}>{clip}</View>;
  }
  const inner = stage > 1 || !uri ? (
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
        source={source}
        style={StyleSheet.absoluteFill}
        contentFit={contain ? "contain" : "cover"}
        cachePolicy={cachePolicy}
        priority={policy.priority}
        loading={policy.loading}
        autoplay={policy.autoplay}
        allowDownscaling
        enforceEarlyResizing
        recyclingKey={`smart-image:${src}`}
        transition={policy.transition}
        onError={fail}
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
