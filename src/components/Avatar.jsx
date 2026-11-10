import { useMemo } from "react";
import { View, Text, Pressable, StyleSheet, PixelRatio, Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, focusRing, mono } from "../theme";
import { displaySrc, previewSrc } from "../lib/img";
import { imageLoadPolicy, versionedImageCacheKey } from "../domain/imageLoadPolicy.mjs";
import useImageAttempt from "../hooks/useImageAttempt";
import { useFeedImageRetryPulse } from "../hooks/feedImageRetry";

// Shows the user's uploaded photo if set, else initials on their colour.
// Tappable to open a profile.
export default function Avatar({ user, size = 36, onPress, priority = "normal", fallbackTextColor, preferOriginal: requestedOriginal = false }) {
  const preferOriginal = Platform.OS === "ios" && requestedOriginal;
  const profileName = user?.name || user?.username || "member";
  const previewWidth = Math.max(96, Math.min(384, Math.ceil((size * PixelRatio.get()) / 32) * 32));
  const rawAvatarUri = user?.avatarUri || null;
  const sources = useMemo(() => {
    if (!rawAvatarUri) return [];
    return [...new Set([
      // Profile identity is a hero, not a feed thumbnail. iOS can decode HEIC
      // directly too; retain the established delivery fallback only on error.
      preferOriginal ? rawAvatarUri : null,
      previewSrc(rawAvatarUri, previewWidth),
      displaySrc(rawAvatarUri, previewWidth),
    ].filter(Boolean))];
  }, [preferOriginal, previewWidth, rawAvatarUri]);
  const requestScope = JSON.stringify([rawAvatarUri, previewWidth, preferOriginal, user?.id || user?.handle, user?.profileUpdatedAt]);
  const { uri: avatarUri, index: sourceIndex, onError, onDisplay, nativeAttemptKey } = useImageAttempt(requestScope, sources, useFeedImageRetryPulse());
  const cacheKey = versionedImageCacheKey({
    namespace: "avatar",
    id: user?.id || user?.handle,
    version: user?.profileUpdatedAt,
    variant: `${preferOriginal ? "original:" : ""}${previewWidth}:${sourceIndex}`,
    uri: avatarUri,
  });
  const source = useMemo(() => avatarUri ? { uri: avatarUri, cacheKey } : null, [avatarUri, cacheKey]);
  const policy = imageLoadPolicy({ priority });
  const fallback = (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: (user?.avatarColor || colors.surfaceAlt) + "33", borderColor: user?.avatarColor || colors.line },
      ]}
    >
      <Text style={[styles.txt, { fontSize: size * 0.34, color: fallbackTextColor || (Platform.OS === "ios" ? colors.text : user?.avatarColor || colors.amber) }]}>
        {user?.initials || "?"}
      </Text>
    </View>
  );
  const inner = (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      {fallback}
      {!!avatarUri && (
        <ExpoImage
          key={nativeAttemptKey == null ? cacheKey : `${cacheKey}:${nativeAttemptKey}`}
          accessible={false}
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority={policy.priority}
          loading={policy.loading}
          autoplay={false}
          allowDownscaling
          enforceEarlyResizing={!preferOriginal}
          recyclingKey={`avatar:${cacheKey}`}
          transition={80}
          onError={onError}
          onDisplay={onDisplay}
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
