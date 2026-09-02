import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, PixelRatio } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, focusRing, mono } from "../theme";
import { displaySrc, previewSrc } from "../lib/img";

// Shows the user's uploaded photo if set, else initials on their colour.
// Tappable to open a profile.
export default function Avatar({ user, size = 36, onPress, priority = "normal" }) {
  const profileName = user?.name || user?.username || "member";
  const previewWidth = Math.max(96, Math.min(384, Math.ceil((size * PixelRatio.get()) / 32) * 32));
  const originalUri = user?.avatarUri ? displaySrc(user.avatarUri, previewWidth) : null;
  const previewUri = user?.avatarUri ? previewSrc(user.avatarUri, previewWidth) : null;
  const sources = [...new Set([previewUri, originalUri].filter(Boolean))];
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [user?.avatarUri, previewWidth]);
  const avatarUri = sources[sourceIndex] || null;
  const fallback = (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: (user?.avatarColor || colors.surfaceAlt) + "33", borderColor: user?.avatarColor || colors.line },
      ]}
    >
      <Text style={[styles.txt, { fontSize: size * 0.34, color: user?.avatarColor || colors.amber }]}>
        {user?.initials || "?"}
      </Text>
    </View>
  );
  const inner = (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      {fallback}
      {!!avatarUri && (
        <ExpoImage
          accessible={false}
          source={{ uri: avatarUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority={priority}
          loading={priority === "high" ? "eager" : "lazy"}
          allowDownscaling
          enforceEarlyResizing
          recyclingKey={`avatar:${user?.id || user?.handle || "member"}:${avatarUri}`}
          transition={80}
          onError={() => setSourceIndex((current) => current + 1)}
        />
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable style={({ focused }) => focused && focusRing} onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open ${profileName}'s profile`}>
        {inner}
      </Pressable>
    );
  }
  return <View accessible accessibilityRole="image" accessibilityLabel={`${profileName}'s profile photo`}>{inner}</View>;
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  txt: { fontWeight: "800", fontFamily: mono },
});
