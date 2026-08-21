import { useEffect, useState } from "react";
import { View, Image, StyleSheet, Pressable, Text } from "react-native";
import { colors, mono } from "../theme";
import Icon from "./Icon";
import ClipPoster from "./ClipPoster";
import { proxied, isHttp, displaySrc, isVideoUrl } from "../lib/img";

// Fits any image (portrait or landscape) without ugly cropping: a blurred,
// zoomed copy fills the frame behind the real image shown in full. Apple/Spotify
// do exactly this for artist shots. Optional onPress opens it in the gallery.
// Load ladder: direct -> wsrv.nl proxy (rescues hotlink/CORS-blocked hosts) ->
// clean on-theme placeholder. Never a broken tile.
// Descriptor-declared clips (plus URL-only historical videos) render a play
// tile instead of a broken image in every grid/wall/strip; tapping still opens
// the viewer, which actually plays them.
export default function SmartImage({ uri, posterUri = null, mediaKind = null, viewable = null, style, contain = true, onPress, previewWidth = 0, accessibilityLabel = "Open image", accessible = true }) {
  const [stage, setStage] = useState(0); // 0 preferred source, 1 fallback, 2 dead
  useEffect(() => setStage(0), [uri, previewWidth]);
  const fail = () => setStage((s) => s + 1);
  const original = displaySrc(uri);
  const preview = previewWidth > 0 && isHttp(uri) ? proxied(uri, previewWidth) : original;
  const src = stage === 1 ? (preview === original && isHttp(uri) ? proxied(uri) : original) : preview;
  if (mediaKind === "video" || (!mediaKind && isVideoUrl(uri))) {
    const clip = <ClipPoster uri={uri} posterUri={posterUri} viewable={viewable} style={StyleSheet.absoluteFill} contain={contain} compact={!previewWidth} accessible={accessible} />;
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
      {contain && <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={28} accessible={false} />}
      {contain && <View style={[StyleSheet.absoluteFill, styles.scrim]} />}
      <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode={contain ? "contain" : "cover"} onError={fail} accessible={accessible} accessibilityLabel={accessible ? accessibilityLabel : undefined} />
    </>
  );
  if (onPress) return <Pressable style={[styles.base, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>{inner}</Pressable>;
  return <View style={[styles.base, style]}>{inner}</View>;
}

const styles = StyleSheet.create({
  base: { overflow: "hidden", backgroundColor: colors.bgElev },
  scrim: { backgroundColor: "rgba(0,0,0,0.28)" },
  fallback: { alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.bgElev },
  fallbackText: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
});
