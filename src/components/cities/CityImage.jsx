import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import SmartImage from "../SmartImage";
import Icon from "../Icon";
import { colors } from "../../theme";
import useImageAttempt from "../../hooks/useImageAttempt";
import { isHostedCityImage } from "./cityImagePolicy.mjs";

function HostedCityImage({ uri, style, onPress, accessibilityLabel, contain, priority }) {
  const [attempt, setAttempt] = useState(0);
  const scope = JSON.stringify([uri, attempt]);
  const { uri: currentUri, onError, onDisplay } = useImageAttempt(scope, [uri]);
  const source = useMemo(() => ({ uri, cacheKey: uri }), [uri]);
  const artwork = currentUri ? (
    <Image key={scope} source={source} style={StyleSheet.absoluteFill} contentFit={contain ? "contain" : "cover"}
      priority={priority} cachePolicy="memory-disk" recyclingKey={scope} transition={0}
      onError={onError} onDisplay={onDisplay} accessibilityLabel={accessibilityLabel} />
  ) : (
    <Pressable style={[StyleSheet.absoluteFill, styles.fallback]} onPress={() => setAttempt((value) => value + 1)}
      accessibilityRole="button" accessibilityLabel={`${accessibilityLabel || "City photo"}. Photo unavailable. Retry photo`}>
      <Icon name="photo" size={18} color={colors.textFaint} />
      <Text style={styles.retry} numberOfLines={1}>Retry photo</Text>
    </Pressable>
  );
  return onPress && currentUri
    ? <Pressable style={[styles.image, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>{artwork}</Pressable>
    : <View style={[styles.image, style]}>{artwork}</View>;
}

// Hosted assets stay direct, including retries; external image proxies cannot
// repair a missing app asset. A failed photo should not leave an empty tile.
export default function CityImage({ uri, style, onPress, accessibilityLabel, contain = true, priority = "normal", ...props }) {
  if (!isHostedCityImage(uri)) return <SmartImage uri={uri} style={style} onPress={onPress} accessibilityLabel={accessibilityLabel} contain={contain} priority={priority} {...props} />;
  return <HostedCityImage uri={uri} style={style} onPress={onPress} accessibilityLabel={accessibilityLabel} contain={contain} priority={priority} />;
}

const styles = StyleSheet.create({
  image: { overflow: "hidden" },
  fallback: { alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: colors.bgElev },
  retry: { color: colors.textDim, fontSize: 9, fontWeight: "700" },
});
