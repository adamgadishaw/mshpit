import { useState } from "react";
import { View, Text, Image, StyleSheet, Pressable } from "react-native";
import { colors, mono } from "../theme";
import Icon from "./Icon";
import { proxied, isHttp, displaySrc, isVideoUrl } from "../lib/img";

// Fits any image (portrait or landscape) without ugly cropping: a blurred,
// zoomed copy fills the frame behind the real image shown in full. Apple/Spotify
// do exactly this for artist shots. Optional onPress opens it in the gallery.
// Load ladder: direct -> wsrv.nl proxy (rescues hotlink/CORS-blocked hosts) ->
// clean on-theme placeholder. Never a broken tile.
// Clip URLs (post media mixes photos and videos) render a play tile instead of
// a broken image, in every grid/wall/strip that uses this component; tapping
// still opens the viewer, which actually plays them.
export default function SmartImage({ uri, style, contain = true, onPress }) {
  const [stage, setStage] = useState(0); // 0 direct (HEIC pre-transcoded), 1 proxy, 2 dead
  const fail = () => setStage((s) => s + 1);
  const src = stage === 1 && isHttp(uri) ? proxied(uri) : displaySrc(uri);
  if (isVideoUrl(uri)) {
    const clip = (
      <View style={[StyleSheet.absoluteFill, styles.clipTile]}>
        <View style={styles.clipRing}><Icon name="play" size={16} color={colors.amber} /></View>
        <Text style={styles.clipTag}>CLIP</Text>
      </View>
    );
    if (onPress) return <Pressable style={[styles.base, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel="Play video clip">{clip}</Pressable>;
    return <View style={[styles.base, style]}>{clip}</View>;
  }
  const inner = stage > 1 || !uri ? (
    <View style={[StyleSheet.absoluteFill, styles.fallback]}>
      <Icon name="music" size={22} color={colors.textFaint} />
    </View>
  ) : (
    <>
      {contain && <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={28} />}
      {contain && <View style={[StyleSheet.absoluteFill, styles.scrim]} />}
      <Image source={{ uri: src }} style={StyleSheet.absoluteFill} resizeMode={contain ? "contain" : "cover"} onError={fail} />
    </>
  );
  if (onPress) return <Pressable style={[styles.base, style]} onPress={onPress}>{inner}</Pressable>;
  return <View style={[styles.base, style]}>{inner}</View>;
}

const styles = StyleSheet.create({
  base: { overflow: "hidden", backgroundColor: colors.bgElev },
  scrim: { backgroundColor: "rgba(0,0,0,0.28)" },
  fallback: { alignItems: "center", justifyContent: "center", backgroundColor: colors.bgElev },
  clipTile: { alignItems: "center", justifyContent: "center", backgroundColor: "#0b0d13", gap: 6 },
  clipRing: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: colors.amber, alignItems: "center", justifyContent: "center", paddingLeft: 3, backgroundColor: "rgba(242,166,90,0.10)" },
  clipTag: { color: colors.textFaint, fontFamily: mono, fontSize: 9, letterSpacing: 1.6, fontWeight: "800" },
});
