import { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, PixelRatio } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, focusRing, mono } from "../theme";
import { displaySrc, previewSrc } from "../lib/img";
import { imageLoadPolicy, versionedImageCacheKey } from "../domain/imageLoadPolicy.mjs";

// Shows the user's uploaded photo if set, else initials on their colour.
// Tappable to open a profile.
export default function Avatar({ user, size = 36, onPress, priority = "normal" }) {
  const profileName = user?.name || user?.username || "member";
  const previewWidth = Math.max(96, Math.min(384, Math.ceil((size * PixelRatio.get()) / 32) * 32));
  const rawAvatarUri = user?.avatarUri || null;
  const sources = useMemo(() => {
    if (!rawAvatarUri) return [];
    return [...new Set([
      previewSrc(rawAvatarUri, previewWidth),
      displaySrc(rawAvatarUri, previewWidth),
    ].filter(Boolean))];
  }, [previewWidth, rawAvatarUri]);
  const requestScope = `${String(rawAvatarUri || "")}|${previewWidth}`;
  const activeScopeRef = useRef(requestScope);
  activeScopeRef.current = requestScope;
  const [loadState, setLoadState] = useState({ scope: requestScope, index: 0 });
  const sourceIndex = loadState.scope === requestScope ? loadState.index : 0;
  const avatarUri = sources[sourceIndex] || null;
  const cacheKey = versionedImageCacheKey({
    namespace: "avatar",
    id: user?.id || user?.handle,
    version: user?.profileUpdatedAt,
    variant: `${previewWidth}:${sourceIndex}`,
    uri: avatarUri,
  });
  const source = useMemo(() => avatarUri ? { uri: avatarUri, cacheKey } : null, [avatarUri, cacheKey]);
  const policy = imageLoadPolicy({ priority });
  const fail = useCallback(() => {
    setLoadState((current) => {
      if (activeScopeRef.current !== requestScope) return current;
      const currentIndex = current.scope === requestScope ? current.index : 0;
      if (currentIndex >= sources.length) return current.scope === requestScope ? current : { scope: requestScope, index: sources.length };
      return { scope: requestScope, index: currentIndex + 1 };
    });
  }, [requestScope, sources.length]);
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
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority={policy.priority}
          loading={policy.loading}
          autoplay={false}
          allowDownscaling
          enforceEarlyResizing
          recyclingKey={`avatar:${cacheKey}`}
          transition={80}
          onError={fail}
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
