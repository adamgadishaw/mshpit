import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, focusRing, mono } from "../theme";

// Shows the user's uploaded photo if set, else initials on their colour.
// Tappable to open a profile.
export default function Avatar({ user, size = 36, onPress }) {
  const profileName = user?.name || user?.username || "member";
  const [failedUri, setFailedUri] = useState(null);
  useEffect(() => setFailedUri(null), [user?.avatarUri]);
  const avatarUri = user?.avatarUri && failedUri !== user.avatarUri ? user.avatarUri : null;
  const inner = avatarUri ? (
    <ExpoImage
      accessible={false}
      source={{ uri: avatarUri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={`avatar:${user?.id || user?.handle || "member"}:${avatarUri}`}
      transition={80}
      onError={() => setFailedUri(avatarUri)}
    />
  ) : (
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
