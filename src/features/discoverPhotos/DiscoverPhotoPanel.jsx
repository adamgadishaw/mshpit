import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, focusRing, font, radius } from "../../theme";
import { DiscoverPhotos } from "../../components/discover/DiscoverCommunity";
import { useDiscoverPhotos } from "./useDiscoverPhotos";
import { visibleDiscoverPhotos } from "./discoverPhotosApi.mjs";

export default function DiscoverPhotoPanel({
  region = "Worldwide", city = "", accountId = null, removedIds = [], blockedIds = [], compact, width, onOpenPhotos,
}) {
  const gallery = useDiscoverPhotos({ region, city, accountId });
  const photos = useMemo(() => visibleDiscoverPhotos(gallery.photos, { removedIds, blockedIds }),
    [gallery.photos, removedIds, blockedIds]);
  const location = city || (region === "Worldwide" ? "around the world" : `in ${region}`);
  return <View style={styles.panel}>
    {gallery.status === "loading" && !photos.length && <View style={styles.notice} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.amberStrong} /><Text style={styles.copy}>Loading concert photos…</Text>
    </View>}
    {gallery.error && <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text selectable style={styles.copy}>{photos.length ? "Photos could not refresh. Your loaded photos are still here." : "Concert photos could not load. Please try again."}</Text>
      <Pressable onPress={gallery.retry} accessibilityRole="button" accessibilityLabel="Retry concert photos"
        style={({ focused }) => [styles.retry, focused && focusRing]}><Text style={styles.retryText}>Try again</Text></Pressable>
    </View>}
    {!!photos.length && <DiscoverPhotos photos={photos} photoUris={photos} compact={compact} width={width} onOpenPhotos={onOpenPhotos}
      title="From the crowd" detail={`Public concert photos and clips ${location}, newest first.`} />}
    {gallery.status === "ready" && !photos.length && <View style={styles.notice} accessibilityLiveRegion="polite">
      <Text selectable style={styles.copy}>No public concert photos or videos are shared {location} yet.</Text>
      <Text style={styles.hint}>{region === "Worldwide" ? "Only photos shared publicly by their owners appear here." : "Choose Worldwide above to see photos from other places."}</Text>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, minWidth: 0 },
  notice: { paddingVertical: 24, paddingHorizontal: 18, gap: 12, alignItems: "flex-start" },
  copy: { color: colors.text, fontFamily: font, fontSize: 14, lineHeight: 21 },
  hint: { color: colors.textDim, fontFamily: font, fontSize: 12, lineHeight: 18 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  retryText: { color: colors.text, fontFamily: font, fontWeight: "700" },
});
