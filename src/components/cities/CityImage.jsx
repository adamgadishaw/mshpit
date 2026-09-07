import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import SmartImage from "../SmartImage";
import { isHostedCityImage } from "./cityImagePolicy.mjs";

// Hosted assets are already optimized. Do not send them through an external image proxy.
export default function CityImage({ uri, style, onPress, accessibilityLabel, contain = true, priority = "normal", ...props }) {
  if (!isHostedCityImage(uri)) return <SmartImage uri={uri} style={style} onPress={onPress} accessibilityLabel={accessibilityLabel} contain={contain} priority={priority} {...props} />;
  const artwork = <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit={contain ? "contain" : "cover"} priority={priority} cachePolicy="memory-disk" transition={0} accessibilityLabel={accessibilityLabel} />;
  return onPress ? <Pressable style={[styles.image, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>{artwork}</Pressable> : <View style={[styles.image, style]}>{artwork}</View>;
}
const styles = StyleSheet.create({ image: { overflow: "hidden" } });
