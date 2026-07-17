import { useState } from "react";
import { View, Image, StyleSheet, Pressable } from "react-native";
import { colors } from "../theme";
import Icon from "./Icon";
import { proxied, isHttp, displaySrc } from "../lib/img";

// Fits any image (portrait or landscape) without ugly cropping: a blurred,
// zoomed copy fills the frame behind the real image shown in full. Apple/Spotify
// do exactly this for artist shots. Optional onPress opens it in the gallery.
// Load ladder: direct -> wsrv.nl proxy (rescues hotlink/CORS-blocked hosts) ->
// clean on-theme placeholder. Never a broken tile.
export default function SmartImage({ uri, style, contain = true, onPress }) {
  const [stage, setStage] = useState(0); // 0 direct (HEIC pre-transcoded), 1 proxy, 2 dead
  const fail = () => setStage((s) => s + 1);
  const src = stage === 1 && isHttp(uri) ? proxied(uri) : displaySrc(uri);
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
});
