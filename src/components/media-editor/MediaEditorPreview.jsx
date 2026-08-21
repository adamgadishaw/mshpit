import { Image, StyleSheet, View } from "react-native";

export default function MediaEditorPreview({ asset }) {
  return (
    <View style={styles.wrap} accessible accessibilityRole="image" accessibilityLabel={asset.altText || "Media editing preview"}>
      <Image source={{ uri: asset.posterUri || asset.uri }} style={styles.image} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, width: "100%", minHeight: 220, backgroundColor: "#030409" },
  image: { flex: 1, width: "100%" },
});
