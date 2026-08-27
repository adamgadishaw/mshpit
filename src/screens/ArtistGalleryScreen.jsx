import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Icon from "../components/Icon";
import ScreenHeader from "../components/ScreenHeader";
import SmartImage from "../components/SmartImage";
import { boundedArtistGalleryMedia } from "../domain/artistGalleryMedia.mjs";
import { mediaDisplayKind, mediaPosterUri } from "../domain/postMediaDisplay.mjs";
import { isStaff, useStore } from "../store";
import { colors, focusRing, mono, radius } from "../theme";

const pageStep = (columns) => columns * 3;

export default function ArtistGalleryScreen({ artistName, artistKey = null, onClose, onOpenPhotos }) {
  const { width } = useWindowDimensions();
  const { session, artistSummary, artistGallery, loadArtistPhotos, removePhoto } = useStore();
  const artist = artistSummary(artistName);
  const resolvedName = artist?.name || artistName || "Artist";
  const resolvedKey = artistKey || artist?.profileKey || null;
  const columns = width >= 1180 ? 5 : width >= 760 ? 4 : width >= 480 ? 3 : 2;
  const availableWidth = Math.min(width, 1120) - 32;
  const tileWidth = Math.max(132, Math.floor((availableWidth - ((columns - 1) * 8)) / columns));
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(() => pageStep(columns));

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.resolve(loadArtistPhotos(resolvedName, resolvedKey))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // The store function changes with its provider render; artist identity is
    // the request boundary and avoids duplicate fetches for the same page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey, resolvedName]);

  useEffect(() => setVisibleCount(pageStep(columns)), [columns, resolvedKey, resolvedName]);

  const rows = boundedArtistGalleryMedia(artistGallery(resolvedName, 60, resolvedKey), 60);
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const canModerate = isStaff(session?.role);
  const loadMore = () => setVisibleCount((current) => Math.min(rows.length, current + pageStep(columns)));

  const openAt = (index) => {
    const item = rows[index];
    if (!item) return;
    onOpenPhotos?.(rows, index, item.postId || null);
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader kicker="ARTIST PHOTOS" title={resolvedName} onBack={onClose} />
      <FlatList
        key={`artist-gallery-${columns}`}
        data={visibleRows}
        numColumns={columns}
        keyExtractor={(item) => item.uri}
        style={styles.list}
        contentContainerStyle={styles.content}
        columnWrapperStyle={columns > 1 ? styles.row : undefined}
        initialNumToRender={pageStep(columns)}
        maxToRenderPerBatch={pageStep(columns)}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        removeClippedSubviews
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <View style={styles.intro}>
            <View style={styles.introIcon}><Icon name="photo" size={20} color={colors.amber} /></View>
            <View style={styles.introCopy}>
              <Text style={styles.eyebrow}>THE FAN LENS</Text>
              <Text style={styles.introTitle}>A living visual archive.</Text>
              <Text style={styles.introText}>Public fan photos and clips sit beside artist imagery. Private, removed, blocked, or moderated media never appears here.</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={loading ? (
          <View style={styles.empty} accessibilityRole="progressbar" accessibilityLabel={`Loading ${resolvedName} photos`}>
            <ActivityIndicator color={colors.amber} />
            <Text style={styles.emptyTitle}>Loading the gallery</Text>
          </View>
        ) : (
          <View style={styles.empty} accessible accessibilityLabel={`No public photos for ${resolvedName} yet`}>
            <View style={styles.emptyIcon}><Icon name="photo" size={28} color={colors.textFaint} /></View>
            <Text style={styles.emptyTitle}>No public photos yet</Text>
            <Text style={styles.emptyText}>Fan media will appear here when someone chooses to share it publicly.</Text>
          </View>
        )}
        renderItem={({ item, index }) => (
          <View style={[styles.tile, { width: tileWidth, maxWidth: tileWidth }]}>
            <SmartImage
              uri={item.uri}
              posterUri={mediaPosterUri(item)}
              mediaKind={mediaDisplayKind(item)}
              style={styles.image}
              contain={false}
              previewWidth={Math.max(360, tileWidth * 2)}
              accessibilityLabel={item.altText || `Open ${resolvedName} ${mediaDisplayKind(item) === "video" ? "clip" : "photo"}${item.by ? ` by ${item.by}` : ""}`}
              onPress={() => openAt(index)}
            />
            <View pointerEvents="none" style={styles.tileScrim} />
            <View pointerEvents="none" style={styles.tileMeta}>
              <Text style={styles.source}>{item.source === "fan" ? "FAN SHOT" : "ARTIST IMAGE"}</Text>
              {item.by ? <Text style={styles.credit} numberOfLines={1}>{item.by}</Text> : null}
            </View>
            {canModerate ? (
              <Pressable
                style={({ pressed, focused }) => [styles.modButton, pressed && styles.pressed, focused && focusRing]}
                onPress={() => removePhoto(item.uri)}
                accessibilityRole="button"
                accessibilityLabel={`Hide this ${resolvedName} media item from the gallery`}
              >
                <Icon name="x" size={13} color="#FFFFFF" />
              </Pressable>
            ) : null}
          </View>
        )}
        ListFooterComponent={rows.length > visibleRows.length ? (
          <Pressable
            style={({ pressed, focused }) => [styles.moreButton, pressed && styles.pressed, focused && focusRing]}
            onPress={loadMore}
            accessibilityRole="button"
            accessibilityLabel={`Load more ${resolvedName} photos`}
          >
            <Text style={styles.moreText}>LOAD MORE</Text>
            <Icon name="chevron-down" size={15} color={colors.amber} />
          </Pressable>
        ) : rows.length ? <Text style={styles.endText}>END OF PUBLIC GALLERY · {rows.length} ITEMS</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  content: { width: "100%", maxWidth: 1120, alignSelf: "center", paddingHorizontal: 16, paddingBottom: 64 },
  row: { gap: 8 },
  intro: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 12, marginBottom: 18, padding: 16, borderRadius: radius.lg, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  introIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgElev },
  introCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: colors.amber, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.8 },
  introTitle: { color: colors.text, fontSize: 21, lineHeight: 25, fontWeight: "900", letterSpacing: -0.4, marginTop: 3 },
  introText: { maxWidth: 720, color: colors.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  tile: { flexGrow: 0, aspectRatio: 0.86, overflow: "hidden", marginBottom: 8, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surfaceAlt },
  image: { ...StyleSheet.absoluteFillObject },
  tileScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "38%", backgroundColor: "rgba(3,5,9,0.58)" },
  tileMeta: { position: "absolute", left: 10, right: 10, bottom: 9 },
  source: { color: "#FFB56B", fontFamily: mono, fontSize: 8.5, fontWeight: "900", letterSpacing: 1.2 },
  credit: { color: "rgba(255,255,255,0.78)", fontSize: 10.5, marginTop: 3 },
  modButton: { position: "absolute", top: 8, right: 8, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)", backgroundColor: "rgba(163,35,58,0.86)" },
  empty: { minHeight: 300, alignItems: "center", justifyContent: "center", padding: 28 },
  emptyIcon: { width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 12 },
  emptyText: { maxWidth: 360, color: colors.textDim, fontSize: 12.5, lineHeight: 18, textAlign: "center", marginTop: 6 },
  moreButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  moreText: { color: colors.amber, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  endText: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "800", letterSpacing: 1.1, textAlign: "center", paddingVertical: 24 },
  pressed: { opacity: 0.72 },
});
