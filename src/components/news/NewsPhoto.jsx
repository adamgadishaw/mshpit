import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Image } from "expo-image";
import { colors } from "../../theme";
import { failNewsPhotoAttempt, initialNewsPhotoAttempt, retryNewsPhotoAttempt } from "../../domain/newsPhotoAttempt.mjs";

function PhotoAttempt({ uri, style, accessibilityLabel = "Article photo", contentFit = "cover", ...props }) {
  const [state, setState] = useState(initialNewsPhotoAttempt);
  if (state.failed) return <Pressable style={[style, styles.unavailable]} accessibilityRole="button"
    accessibilityLabel={`Retry ${accessibilityLabel.toLowerCase()}`} onPress={(event) => { event.stopPropagation(); setState(retryNewsPhotoAttempt); }}>
    <Text style={styles.message}>Photo unavailable. Retry photo.</Text>
  </Pressable>;
  return <Image {...props} key={state.attempt} source={{ uri }} style={style} contentFit={contentFit}
    cachePolicy="memory-disk" accessibilityLabel={accessibilityLabel}
    onError={() => setState((current) => failNewsPhotoAttempt(current, state.attempt))} />;
}

// Remount the failed Expo Image node: its web animation manager removes errored
// images from the DOM and does not retry an unchanged source on a parent refresh.
export default function NewsPhoto({ uri, ...props }) {
  return uri ? <PhotoAttempt key={uri} uri={uri} {...props} /> : null;
}
const styles = StyleSheet.create({
  unavailable: { alignItems: "center", justifyContent: "center", minHeight: 44, padding: 3 },
  message: { color: colors.textDim, fontSize: 11, textAlign: "center" },
});
